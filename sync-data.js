/* Pure conflict-resolution rules shared by cloud sync and its tests. */
'use strict';
const MigraineSyncData = (() => {
  const entryTime = (entry) => Date.parse(entry.updatedAt || entry.at) || 0;
  const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isEntryChange = (record) => record?.kind === 'entry'
    || (record?.kind == null && typeof record?.id === 'string'
      && (record.deleted === true || record.entry != null));

  // Only identical copies under different IDs are collapsed. Sharing a start time is not enough:
  // the editor stores whole minutes, so separate entries saved for the same minute must both survive.
  function dedupeEntries(entries) {
    const unique = new Map();
    for (const entry of entries) {
      const key = LogData.contentKey(entry);
      const existing = unique.get(key);
      if (!existing || entryTime(entry) > entryTime(existing)
        || (entryTime(entry) === entryTime(existing) && entry.id < existing.id)) unique.set(key, entry);
    }
    return [...unique.values()];
  }

  function reconcileEntries(current, remoteRecords, tombstones = {}, now = Date.now()) {
    const byId = new Map(current.entries.map(entry => [entry.id, entry]));
    const deleted = new Set(current.deletedIds);
    const deletedAt = { ...tombstones };
    const seenRemote = new Set();
    let uploads = [];
    let changed = false;
    let invalid = 0;

    for (const id of deleted) {
      if (!Number.isFinite(deletedAt[id])) deletedAt[id] = now;
    }

    for (const record of remoteRecords) {
      if (!record || typeof record.id !== 'string' || !record.id
        || !Number.isFinite(Date.parse(record.modifiedAt))) {
        invalid++;
        continue;
      }
      const id = record.id;
      const remoteTime = Date.parse(record.modifiedAt);
      const local = byId.get(id);
      seenRemote.add(id);

      if (record.deleted === true) {
        if (local && entryTime(local) > remoteTime) {
          uploads.push({ kind: 'entry', id, deleted: false,
            modifiedAt: local.updatedAt || local.at, entry: local });
          continue;
        }
        if (local) { byId.delete(id); changed = true; }
        if (!deleted.has(id)) { deleted.add(id); changed = true; }
        deletedAt[id] = Math.max(deletedAt[id] || 0, remoteTime);
        continue;
      }

      if (!LogData.valid(record.entry) || String(record.entry.id || '') !== id) {
        invalid++;
        continue;
      }
      const remote = LogData.normalise(record.entry);
      if (deleted.has(id)) {
        if ((deletedAt[id] || 0) >= remoteTime) {
          uploads.push({ kind: 'entry', id, deleted: true,
            modifiedAt: new Date(deletedAt[id]).toISOString() });
        } else {
          deleted.delete(id); delete deletedAt[id]; byId.set(id, remote); changed = true;
        }
      } else if (!local) {
        byId.set(id, remote); changed = true;
      } else if (remoteTime > entryTime(local)
        || (remoteTime === entryTime(local) && !sameEntry(remote, local))) {
        byId.set(id, remote); changed = true;
      } else if (entryTime(local) > remoteTime) {
        uploads.push({ kind: 'entry', id, deleted: false,
          modifiedAt: local.updatedAt || local.at, entry: local });
      }
    }

    const uniqueEntries = dedupeEntries([...byId.values()]);
    const uniqueById = new Map(uniqueEntries.map(entry => [entry.id, entry]));
    // Tombstone dropped copies so every device and the cloud keep the same survivor. The deletion must
    // outrank the copy it replaces, even when that copy's edit time is ahead of this device's clock.
    const duplicates = new Set([...byId.keys()].filter(id => !uniqueById.has(id)));
    for (const id of duplicates) {
      deleted.add(id);
      deletedAt[id] = Math.max(now, entryTime(byId.get(id)) + 1);
      changed = true;
    }
    uploads = uploads.filter(record => !duplicates.has(record.id));

    for (const entry of uniqueById.values()) {
      if (!seenRemote.has(entry.id)) {
        uploads.push({ kind: 'entry', id: entry.id, deleted: false,
          modifiedAt: entry.updatedAt || entry.at, entry });
      }
    }
    for (const id of deleted) {
      if (!seenRemote.has(id) || duplicates.has(id)) {
        uploads.push({ kind: 'entry', id, deleted: true,
          modifiedAt: new Date(deletedAt[id]).toISOString() });
      }
    }

    return {
      state: { ...current, entries: [...uniqueById.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
        deletedIds: [...deleted] },
      tombstones: deletedAt,
      uploads,
      changed,
      invalid,
    };
  }

  function hasDiary(state) {
    return state.entries.length > 0 || state.customTriggers.length > 0;
  }

  // How signing in treats this device's diary. The device may be shared, so a diary already linked to
  // another account is never added to this one without asking.
  function signInAction(linkedUid, uid, state) {
    if (linkedUid === uid) return 'sync';
    if (!linkedUid) return 'link';
    return hasDiary(state) ? 'ask' : 'switch';
  }

  // Cloud copies of entries that a newer confirmed, readable record replaces: older copies once a newer copy or a
  // deletion has reached the server. Only entry contents are listed, since the rules keep deletion and settings
  // records, so each entry's newest record stays for devices that were offline. A deletion outranks a copy saved
  // at the same moment, matching reconcileEntries; otherwise the larger cloud ID wins, so every device agrees.
  function supersededContent(records) {
    const time = record => Date.parse(record.modifiedAt);
    const readable = record => record.deleted === true
      || (LogData.valid(record.entry) && String(record.entry.id || '') === record.id);
    const outranks = (a, b) => (time(a) !== time(b) ? time(a) > time(b)
      : (a.deleted === true) !== (b.deleted === true) ? a.deleted === true
        : String(a.cloudId) > String(b.cloudId));
    const changes = records.filter(record => isEntryChange(record) && typeof record.id === 'string' && record.id
      && Number.isFinite(time(record)));
    const newest = new Map();
    for (const record of changes) {
      if (record.confirmed && readable(record) && (!newest.has(record.id) || outranks(record, newest.get(record.id)))) {
        newest.set(record.id, record);
      }
    }
    return changes
      .filter(record => record.deleted !== true && newest.has(record.id) && outranks(newest.get(record.id), record))
      .map(record => record.cloudId);
  }

  // Mirrors the size caps in firestore.rules, so the app never sends a record the rules would refuse.
  function fitsCloud(record) {
    if (record.kind === 'settings') return record.customTriggers.length <= 200;
    return record.deleted === true
      || (record.entry.notes.length <= LogData.notesLimit && record.entry.triggers.length <= 200);
  }

  // Custom trigger labels once each, ignoring letter case; the first spelling seen is kept.
  function uniqueLabels(labels) {
    const seen = new Set();
    return labels.filter(label => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Settings to keep when the cloud copy arrives: the side changed more recently wins, and a tie goes to the cloud.
  // The first time a device syncs settings with an account the custom trigger lists are combined instead, so
  // triggers added on either side before they first met both survive.
  function chooseSettings(local, localTime, cloud, cloudTime, firstSync) {
    const newer = cloudTime >= localTime ? cloud : local;
    return {
      customTriggers: firstSync ? uniqueLabels([...cloud.customTriggers, ...local.customTriggers]) : [...newer.customTriggers],
      preferences: { ...newer.preferences },
    };
  }

  // Old copies from sync versions before `generation` that can be removed: records holding the contents of an entry
  // this device has or has deleted, whose current record lives in the current generation. Copies of entries the
  // device has never seen are only counted, never removed, so nothing that exists only in the cloud is lost.
  function legacyCopies(records, state, generation) {
    const known = new Set([...state.entries.map(entry => entry.id), ...state.deletedIds]);
    const remove = [];
    const unknown = new Set();
    for (const record of records) {
      if (record.generation === generation || record.deleted === true || record.entry == null
        || typeof record.id !== 'string' || !record.id) continue;
      if (known.has(record.id)) remove.push(record.cloudId);
      else unknown.add(record.id);
    }
    return { remove, unknownEntries: unknown.size };
  }

  return { entryTime, isEntryChange, dedupeEntries, reconcileEntries, hasDiary, signInAction, supersededContent, fitsCloud,
    chooseSettings, legacyCopies };
})();
if (typeof module !== 'undefined') module.exports = MigraineSyncData;
