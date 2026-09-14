/* Firestore rules tests. Run inside the local emulator (needs Java 21 or newer):
   npx firebase-tools emulators:exec --only firestore --project demo-migraine-log "node tools/rules-test.cjs" */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../data.js');
global.LogData = D;
const S = require('../sync-data.js');

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('Run through firebase emulators:exec so FIRESTORE_EMULATOR_HOST is set.');
const project = 'demo-migraine-log';
const documents = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
// The emulator treats this bearer token as an administrator that bypasses the rules.
const ADMIN = 'owner';

const encode = value => (value === null ? { nullValue: null }
  : typeof value === 'boolean' ? { booleanValue: value }
    : typeof value === 'number' ? (Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value })
      : typeof value === 'string' ? { stringValue: value }
        : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
          : { mapValue: { fields: fieldsOf(value) } });
const fieldsOf = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encode(value)]));

function idToken({ uid, email, verified = true }) {
  const part = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ iss: `https://securetoken.google.com/${project}`, aud: project,
    iat: now, exp: now + 3600, auth_time: now, sub: uid, user_id: uid, email, email_verified: verified,
    firebase: { sign_in_provider: 'google.com', identities: {} } })}.`;
}

async function call(method, path, auth, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${auth === ADMIN ? ADMIN : idToken(auth)}`;
  const response = await fetch(`${documents}/${path}`, { method, headers, body: body && JSON.stringify(body) });
  await response.text();
  return response.status;
}
const create = (auth, uid, id, data) => call('POST', `users/${uid}/changes?documentId=${id}`, auth, { fields: fieldsOf(data) });
const seed = (uid, id, data) => call('PATCH', `users/${uid}/changes/${id}`, ADMIN, { fields: fieldsOf(data) });
const remove = (auth, uid, id) => call('DELETE', `users/${uid}/changes/${id}`, auth);
const query = (auth, uid) => call('POST', `users/${uid}:runQuery`, auth, { structuredQuery: {
  from: [{ collectionId: 'changes' }],
  where: { fieldFilter: { field: { fieldPath: 'generation' }, op: 'EQUAL', value: { integerValue: '4' } } } } });

const alice = { uid: 'alice-uid', email: 'alice@example.com' };
const stranger = { uid: 'stranger-uid', email: 'stranger@example.com' };

// Records built by the app's sync code, plus the fields appendChanges adds in sync.js.
const withMeta = record => ({ ...record, generation: 4, deviceId: '3f2b6c1e-8d4a-4f7b-9c2e-1a5d7e9b0c3f' });
const rich = D.normalise({ id: 'entry-1', at: '2026-09-13T10:00:00.000Z', updatedAt: '2026-09-13T11:00:00.000Z',
  notes: 'After lunch', triggers: ['Poor sleep'], auraIntensity: 'Mild', headacheIntensity: 'Severe' });
const minimal = D.normalise({ id: 'entry-2', at: '2026-09-13T09:00:00.000Z' });
const { uploads } = S.reconcileEntries({ ...D.empty(), entries: [rich, minimal], deletedIds: ['entry-3'] }, [], {},
  Date.parse('2026-09-13T13:00:00Z'));
const entryChange = withMeta(uploads.find(item => item.id === 'entry-1'));
const minimalChange = withMeta(uploads.find(item => item.id === 'entry-2'));
const deletion = withMeta(uploads.find(item => item.id === 'entry-3'));
// Entry uploads from before the kind marker was added carry no kind. The app no longer writes them.
const { kind: _kind, ...legacyEntryChange } = entryChange;
// Mirrors settingsRecord in sync.js.
const settings = withMeta({ kind: 'settings', modifiedAt: '2026-09-13T13:00:00.000Z', customTriggers: ['Travel'],
  preferences: { theme: 'dark' } });
const everyShape = { entry: entryChange, minimal: minimalChange, deletion, settings };

beforeEach(async () => {
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(await call('PATCH', 'config/access', ADMIN, { fields: fieldsOf({ emails: [alice.email] }) }), 200);
});

test('an allowed account can write every record shape the app sends and query its own records', async () => {
  for (const [id, record] of Object.entries(everyShape)) assert.equal(await create(alice, alice.uid, id, record), 200, id);
  assert.equal(await query(alice, alice.uid), 200);
});

test('the longest note the app allows is accepted', async () => {
  const longest = { ...entryChange, entry: { ...entryChange.entry, notes: 'x'.repeat(D.notesLimit) } };
  assert.equal(await create(alice, alice.uid, 'longest', longest), 200);
});

test('existing records can never be changed', async () => {
  assert.equal(await create(alice, alice.uid, 'entry', entryChange), 200);
  assert.equal(await call('PATCH', `users/${alice.uid}/changes/entry`, alice,
    { fields: fieldsOf({ ...entryChange, entry: { ...entryChange.entry, notes: 'Changed' } }) }), 403);
});

test('an allowed account can remove entry contents, but not the deletion and settings records other devices rely on', async () => {
  for (const [id, record] of Object.entries(everyShape)) assert.equal(await create(alice, alice.uid, id, record), 200, id);
  assert.equal(await seed(alice.uid, 'legacy', legacyEntryChange), 200);
  assert.equal(await remove(alice, alice.uid, 'entry'), 200);
  assert.equal(await remove(alice, alice.uid, 'legacy'), 200);
  assert.equal(await remove(alice, alice.uid, 'already-removed'), 200);
  assert.equal(await remove(alice, alice.uid, 'deletion'), 403);
  assert.equal(await remove(alice, alice.uid, 'settings'), 403);
});

test('the allowlist ignores letter case but requires a verified address', async () => {
  assert.equal(await create({ ...alice, email: 'Alice@Example.com' }, alice.uid, 'entry', entryChange), 200);
  assert.equal(await create({ ...alice, verified: false }, alice.uid, 'unverified', entryChange), 403);
  assert.equal(await query({ ...alice, verified: false }, alice.uid), 403);
});

test('other accounts, signed-out requests and paths of other users are denied', async () => {
  assert.equal(await create(alice, alice.uid, 'entry', entryChange), 200);
  assert.equal(await create(stranger, stranger.uid, 'own', entryChange), 403);
  assert.equal(await query(stranger, stranger.uid), 403);
  assert.equal(await create(stranger, alice.uid, 'intruder', entryChange), 403);
  assert.equal(await query(stranger, alice.uid), 403);
  assert.equal(await remove(stranger, alice.uid, 'entry'), 403);
  assert.equal(await create(null, alice.uid, 'anonymous', entryChange), 403);
  assert.equal(await query(null, alice.uid), 403);
  assert.equal(await remove(null, alice.uid, 'entry'), 403);
  assert.equal(await create(alice, stranger.uid, 'elsewhere', entryChange), 403);
  assert.equal(await query(alice, stranger.uid), 403);
});

test('without the access document nobody can sync', async () => {
  assert.equal(await call('DELETE', 'config/access', ADMIN), 200);
  assert.equal(await create(alice, alice.uid, 'entry', entryChange), 403);
  assert.equal(await query(alice, alice.uid), 403);
});

test('clients cannot read or change the access document', async () => {
  assert.equal(await call('GET', 'config/access', alice), 403);
  assert.equal(await call('PATCH', 'config/access', alice, { fields: fieldsOf({ emails: [stranger.email] }) }), 403);
});

test('records not shaped the way the app writes them are rejected', async () => {
  const { entry } = entryChange;
  const { entry: _entry, ...withoutEntry } = entryChange;
  const { notes: _notes, ...entryWithoutNotes } = entry;
  const { customTriggers: _triggers, ...settingsWithoutTriggers } = settings;
  const invalid = {
    unknownKind: { ...entryChange, kind: 'note' },
    legacyWithoutKind: legacyEntryChange,
    extraField: { ...entryChange, extra: 'x' },
    deletionWithContent: { ...deletion, entry },
    contentWithoutEntry: withoutEntry,
    contentMarkedDeleted: { ...entryChange, deleted: true },
    mismatchedEntryId: { ...entryChange, entry: { ...entry, id: 'other' } },
    extraEntryField: { ...entryChange, entry: { ...entry, mood: 'x' } },
    missingEntryField: { ...entryChange, entry: entryWithoutNotes },
    notesTooLong: { ...entryChange, entry: { ...entry, notes: 'x'.repeat(D.notesLimit + 1) } },
    tooManyTriggers: { ...entryChange, entry: { ...entry, triggers: Array.from({ length: 201 }, (_, i) => `T${i}`) } },
    unknownRating: { ...entryChange, entry: { ...entry, headacheIntensity: 'Extreme' } },
    otherGeneration: { ...entryChange, generation: 3 },
    longDeviceId: { ...entryChange, deviceId: 'd'.repeat(65) },
    unknownTheme: { ...settings, preferences: { theme: 'neon' } },
    extraPreference: { ...settings, preferences: { theme: 'dark', fontSize: 20 } },
    settingsWithoutTriggers,
    tooManyCustomTriggers: { ...settings, customTriggers: Array.from({ length: 201 }, (_, i) => `T${i}`) },
  };
  for (const [name, record] of Object.entries(invalid)) {
    assert.equal(await create(alice, alice.uid, name, record), 403, name);
  }
});
