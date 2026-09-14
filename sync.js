/* Optional Firebase sync. The diary remains fully local when it is not configured. */
'use strict';

const syncBridge = window.MigraineAppSync;
const syncConfig = window.MIGRAINE_FIREBASE_CONFIG;
const syncStatus = document.getElementById('syncStatus');
const syncDescription = document.getElementById('syncDescription');
const syncAccount = document.getElementById('syncAccount');
const syncSignIn = document.getElementById('syncSignIn');
const syncSignOut = document.getElementById('syncSignOut');
const syncResult = document.getElementById('syncResult');
const SYNC_META_KEY = 'migraine-log-sync-v1';
const FIREBASE_VERSION = '12.18.0';
const CHANGE_GENERATION = 4;
const isEntryChange = MigraineSyncData.isEntryChange || ((record) => record?.kind === 'entry'
  || (record?.kind == null && typeof record?.id === 'string'
    && (record.deleted === true || record.entry != null)));

let firebaseApi;
let auth;
let db;
let activeUser;
let stopChanges;
let baseline = syncBridge?.getState();
let snapshotQueue = Promise.resolve();

function setSyncStatus(value) {
  syncStatus.textContent = ` · ${value}`;
}

function showSyncResult(message, isError = false) {
  syncResult.textContent = message;
  syncResult.classList.toggle('error', isError);
  syncResult.hidden = !message;
}

function friendlyError(error) {
  if (error?.code === 'auth/unauthorized-domain') return 'This site address must be added to Firebase Authentication’s authorized domains.';
  if (error?.code === 'auth/popup-closed-by-user') return 'Sign-in was cancelled.';
  if (error?.code === 'auth/popup-blocked') return 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (error?.code === 'permission-denied') return 'Firebase denied access. Check that the supplied Firestore rules have been deployed.';
  return navigator.onLine ? 'Sync could not connect. Try again in a moment.' : 'You are offline. Changes will sync after reconnecting.';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSyncMeta() {
  try {
    const value = JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}');
    const tombstones = value && typeof value.tombstones === 'object' ? value.tombstones : {};
    return {
      deviceId: typeof value.deviceId === 'string' && value.deviceId ? value.deviceId : LogData.uid(),
      accountUid: typeof value.accountUid === 'string' && value.accountUid ? value.accountUid : null,
      settingsModifiedAt: Number.isFinite(value.settingsModifiedAt) ? value.settingsModifiedAt : 0,
      tombstones: Object.fromEntries(Object.entries(tombstones).filter(([, time]) => Number.isFinite(time))),
    };
  } catch {
    return { deviceId: LogData.uid(), accountUid: null, settingsModifiedAt: 0, tombstones: {} };
  }
}

let syncMeta = loadSyncMeta();
function saveSyncMeta() {
  try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta)); }
  catch (error) { console.warn('Could not save sync metadata', error); }
}
saveSyncMeta();

// Another account starts clean, so no deletion markers or settings time carry over from the last one.
function resetSyncMeta(accountUid) {
  syncMeta = { deviceId: syncMeta.deviceId, accountUid, settingsModifiedAt: 0, tombstones: {} };
  saveSyncMeta();
}

function entryRecord(entry) {
  return { kind: 'entry', id: entry.id, deleted: false,
    modifiedAt: entry.updatedAt || entry.at, entry: clone(entry) };
}

function deletionRecord(id, time) {
  return { kind: 'entry', id, deleted: true, modifiedAt: new Date(time).toISOString() };
}

function settingsRecord(state, time) {
  return { kind: 'settings', modifiedAt: new Date(time).toISOString(),
    customTriggers: [...state.customTriggers], preferences: { ...state.preferences } };
}

function sameSettings(a, b) {
  return JSON.stringify([a.customTriggers, a.preferences]) === JSON.stringify([b.customTriggers, b.preferences]);
}

function newest(records, key) {
  const latest = new Map();
  for (const record of records) {
    const id = key(record);
    const current = latest.get(id);
    const time = Date.parse(record.modifiedAt);
    if (!Number.isFinite(time) || id == null) continue;
    if (!current || time > Date.parse(current.modifiedAt)
      || (time === Date.parse(current.modifiedAt) && record.cloudId > current.cloudId)) latest.set(id, record);
  }
  return [...latest.values()];
}

function appendChanges(records) {
  if (!activeUser || !records.length) return;
  const changes = firebaseApi.collection(db, 'users', activeUser.uid, 'changes');
  setSyncStatus(navigator.onLine ? 'Syncing' : 'Offline');
  const batch = firebaseApi.writeBatch(db);
  for (const record of records) {
    batch.set(firebaseApi.doc(changes), { ...record, generation: CHANGE_GENERATION,
      deviceId: syncMeta.deviceId });
  }
  batch.commit().catch((error) => {
    console.error('Cloud write failed', error);
    setSyncStatus(navigator.onLine ? 'Error' : 'Offline');
    showSyncResult(friendlyError(error), true);
  });
}

function localChanges(previous, current) {
  baseline = clone(current);
  if (!activeUser || !previous) return;
  const before = new Map(previous.entries.map(entry => [entry.id, entry]));
  const after = new Map(current.entries.map(entry => [entry.id, entry]));
  const records = [];
  const now = Date.now();

  for (const entry of after.values()) {
    if (!before.has(entry.id) || JSON.stringify(before.get(entry.id)) !== JSON.stringify(entry)) records.push(entryRecord(entry));
  }
  for (const id of before.keys()) {
    if (!after.has(id)) {
      syncMeta.tombstones[id] = now;
      records.push(deletionRecord(id, now));
    }
  }
  const oldDeleted = new Set(previous.deletedIds);
  for (const id of current.deletedIds) {
    if (!oldDeleted.has(id) && !syncMeta.tombstones[id]) {
      syncMeta.tombstones[id] = now;
      records.push(deletionRecord(id, now));
    }
  }
  if (!sameSettings(previous, current)) {
    syncMeta.settingsModifiedAt = now;
    records.push(settingsRecord(current, now));
  }
  saveSyncMeta();
  appendChanges(records);
}

window.MigraineSyncStateChanged = () => {
  const current = syncBridge?.getState();
  if (current) localChanges(baseline, current);
};

function validCloudSettings(record) {
  return record && Array.isArray(record.customTriggers)
    && record.customTriggers.every(label => typeof label === 'string' && label.trim())
    && record.preferences && LogData.themes.includes(record.preferences.theme);
}

async function applySnapshot(snapshot) {
  if (!activeUser) return;
  const records = snapshot.docs.map(item => ({ ...item.data(), cloudId: item.id }));
  const remoteEntries = newest(records.filter(isEntryChange), record => record.id);
  const remoteSettings = newest(records.filter(record => record.kind === 'settings'), () => 'settings')[0];
  const current = syncBridge.getState();
  for (const id of current.deletedIds) {
    if (!Number.isFinite(syncMeta.tombstones[id])) syncMeta.tombstones[id] = Date.now();
  }
  const reconciled = MigraineSyncData.reconcileEntries(current, remoteEntries, syncMeta.tombstones);
  syncMeta.tombstones = reconciled.tombstones;
  let next = reconciled.state;
  const uploads = [...reconciled.uploads];

  if (remoteSettings && validCloudSettings(remoteSettings)) {
    const remoteTime = Date.parse(remoteSettings.modifiedAt);
    if (remoteTime >= syncMeta.settingsModifiedAt) {
      if (!sameSettings(next, remoteSettings)) {
        next = { ...next, customTriggers: [...remoteSettings.customTriggers],
          preferences: { ...remoteSettings.preferences } };
        reconciled.changed = true;
      }
      syncMeta.settingsModifiedAt = remoteTime;
    } else if (!snapshot.metadata.fromCache) {
      uploads.push(settingsRecord(next, syncMeta.settingsModifiedAt));
    }
  } else if (!remoteSettings && !snapshot.metadata.fromCache) {
    syncMeta.settingsModifiedAt = Date.now();
    uploads.push(settingsRecord(next, syncMeta.settingsModifiedAt));
  }

  if (reconciled.changed) {
    if (!syncBridge.applyState(next)) {
      setSyncStatus('Paused');
      showSyncResult('Cloud changes are waiting because local storage is unavailable or changed in another tab.', true);
      return;
    }
  }
  baseline = clone(next);
  saveSyncMeta();

  if (!snapshot.metadata.fromCache) appendChanges(uploads);
  if (reconciled.invalid) showSyncResult(`${reconciled.invalid} unreadable cloud record${reconciled.invalid === 1 ? '' : 's'} were ignored.`, true);
  else if (!snapshot.metadata.hasPendingWrites) showSyncResult('');
  setSyncStatus(snapshot.metadata.hasPendingWrites ? (navigator.onLine ? 'Syncing' : 'Offline')
    : snapshot.metadata.fromCache && !navigator.onLine ? 'Offline' : 'Synced');
}

let signOutNotice;

// Returns whether this account may sync with the diary on this device. The device may be shared, so a
// diary linked to another account is never uploaded into this one.
function claimDiary(user) {
  const current = syncBridge.getState();
  const action = MigraineSyncData.signInAction(syncMeta.accountUid, user.uid, current);
  if (action === 'sync') return true;
  if (action === 'link') {
    syncMeta.accountUid = user.uid;
    saveSyncMeta();
    return true;
  }
  if (action === 'ask' && !window.confirm('This device has a diary from a different Google account.\n\n'
    + `Remove it from this device and load the diary for ${user.email || 'this account'} instead? `
    + 'Changes made while signed out exist only on this device, so export a backup first if you need them.\n\n'
    + 'Choose Cancel to sign out and keep it.')) {
    signOutNotice = { message: 'Signed out. This device’s diary was not added to that account. To move it there, export a backup, sign in again and choose OK, then import the backup.' };
    return false;
  }
  const cleared = action === 'ask' ? syncBridge.clearDiary()
    : !current.deletedIds.length || syncBridge.applyState({ ...current, deletedIds: [] });
  if (!cleared) {
    signOutNotice = { message: 'Signed out. The diary on this device could not be replaced, so nothing was changed.', isError: true };
    return false;
  }
  resetSyncMeta(user.uid);
  return true;
}

function watchUser(user) {
  if (stopChanges) { stopChanges(); stopChanges = undefined; }
  activeUser = undefined;
  if (user && !claimDiary(user)) {
    firebaseApi.signOut(auth).catch((error) => showSyncResult(friendlyError(error), true));
    return;
  }
  activeUser = user;
  baseline = syncBridge.getState();
  syncSignIn.hidden = !!user;
  syncSignOut.hidden = !user;
  syncAccount.hidden = !user;
  syncAccount.textContent = user ? `Signed in as ${user.email || 'Google user'}` : '';
  if (!user) {
    setSyncStatus('Off');
    showSyncResult(signOutNotice?.message || '', !!signOutNotice?.isError);
    signOutNotice = undefined;
    return;
  }
  setSyncStatus(navigator.onLine ? 'Connecting' : 'Offline');
  const changes = firebaseApi.query(
    firebaseApi.collection(db, 'users', user.uid, 'changes'),
    firebaseApi.where('generation', '==', CHANGE_GENERATION)
  );
  stopChanges = firebaseApi.onSnapshot(changes, { includeMetadataChanges: true }, (snapshot) => {
    snapshotQueue = snapshotQueue.then(() => applySnapshot(snapshot)).catch((error) => {
      console.error('Cloud merge failed', error);
      setSyncStatus('Error');
      showSyncResult(friendlyError(error), true);
    });
  }, (error) => {
    console.error('Cloud listener failed', error);
    setSyncStatus(navigator.onLine ? 'Error' : 'Offline');
    showSyncResult(friendlyError(error), true);
  });
}

async function startSync() {
  if (!syncBridge || !syncConfig || !['apiKey', 'authDomain', 'projectId', 'appId'].every(key => syncConfig[key])) return;
  setSyncStatus('Loading');
  showSyncResult('');
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [appApi, authApi, firestoreApi] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
  ]);
  const firebaseApp = appApi.initializeApp(syncConfig);
  auth = authApi.getAuth(firebaseApp);
  await authApi.setPersistence(auth, authApi.browserLocalPersistence);
  // The diary itself is the durable offline source. Keeping Firestore's own
  // persistent queue as well can retain obsolete retries across app upgrades.
  db = firestoreApi.getFirestore(firebaseApp);
  firebaseApi = { ...authApi, ...firestoreApi };
  syncSignIn.disabled = false;
  syncSignIn.addEventListener('click', async () => {
    syncSignIn.disabled = true;
    setSyncStatus('Signing in');
    showSyncResult('');
    try { await authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider()); }
    catch (error) { setSyncStatus('Off'); showSyncResult(friendlyError(error), true); }
    finally { syncSignIn.disabled = false; }
  });
  syncSignOut.addEventListener('click', async () => {
    syncSignOut.disabled = true;
    try { await authApi.signOut(auth); }
    catch (error) { showSyncResult(friendlyError(error), true); }
    finally { syncSignOut.disabled = false; }
  });
  authApi.onAuthStateChanged(auth, watchUser, (error) => {
    setSyncStatus('Error'); showSyncResult(friendlyError(error), true);
  });
  syncDescription.textContent = 'Sign in with the same Google account on each device to keep saved entries in sync. Logging continues to work offline.';
}

startSync().catch((error) => {
  console.error('Firebase could not start', error);
  setSyncStatus(navigator.onLine ? 'Unavailable' : 'Offline');
  showSyncResult(friendlyError(error), true);
});
