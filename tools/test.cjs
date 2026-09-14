/* Run with node --test tools/test.cjs. No packages or build step required. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const D = require('../data.js');
global.LogData = D;
const S = require('../sync-data.js');
const at = '2026-09-10T10:00:00.000Z';
const row = (overrides = {}) => D.normalise({ id: 'attack-1', at, notes: 'Original', ...overrides });
const state = (entries = []) => ({ ...D.empty(), entries });

test('sync recognises entry records written before the kind marker fix', () => {
  assert.equal(S.isEntryChange({ id: 'old', deleted: false, entry: row() }), true);
  assert.equal(S.isEntryChange({ id: 'old', deleted: true }), true);
  assert.equal(S.isEntryChange({ kind: 'settings', customTriggers: [] }), false);
});

test('sync collapses identical entries created independently on two devices', () => {
  const first = row({ id: 'device-b', updatedAt: null });
  const second = row({ id: 'device-a', updatedAt: null });
  const result = S.reconcileEntries(state([first]), [{ id: second.id, deleted: false,
    modifiedAt: second.at, entry: second }]);
  assert.equal(result.state.entries.length, 1);
  assert.equal(result.state.entries[0].id, 'device-a');
  assert.equal(result.changed, true);
});

test('sync keeps separate entries saved for the same minute', () => {
  // The editor stores whole minutes, so sharing a start time does not make two entries copies.
  const aura = row({ id: 'aura', auraIntensity: 'Moderate', notes: 'Zigzag lines while driving' });
  const headache = row({ id: 'headache', headacheIntensity: 'Severe', notes: '', updatedAt: '2026-09-11T10:00:00Z' });
  const firstSync = S.reconcileEntries(state([aura, headache]), []);
  assert.deepEqual(firstSync.state.entries.map(entry => entry.id).sort(), ['aura', 'headache']);
  assert.deepEqual(firstSync.uploads.map(record => record.id).sort(), ['aura', 'headache']);
  assert.equal(firstSync.changed, false);
  const fromCloud = S.reconcileEntries(state([aura]), [{ id: headache.id, deleted: false,
    modifiedAt: headache.updatedAt, entry: headache }]);
  assert.deepEqual(fromCloud.state.entries.map(entry => entry.id).sort(), ['aura', 'headache']);
  assert.deepEqual(fromCloud.state.deletedIds, []);
});

test('sync tombstones the dropped identical copy so every device keeps the same survivor', () => {
  // A device clock running ahead must not let the dropped copy outrank its own deletion.
  const kept = row({ id: 'device-a', updatedAt: '2026-09-21T10:00:00Z' });
  const dropped = row({ id: 'device-b', updatedAt: '2026-09-20T10:00:00Z' });
  const result = S.reconcileEntries(state([dropped]), [{ id: kept.id, deleted: false,
    modifiedAt: kept.updatedAt, entry: kept }], {}, Date.parse('2026-09-13T10:00:00Z'));
  assert.deepEqual(result.state.entries.map(entry => entry.id), ['device-a']);
  assert.deepEqual(result.state.deletedIds, ['device-b']);
  const uploads = result.uploads.filter(record => record.id === 'device-b');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].deleted, true);
  assert.ok(Date.parse(uploads[0].modifiedAt) > Date.parse(dropped.updatedAt));
});

test('legacy ratings migrate without inventing an aura rating', () => {
  const e = D.parse([{ at, intensity: 'Severe' }], true).entries[0];
  assert.equal(e.headacheIntensity, 'Severe'); assert.equal(e.auraIntensity, null);
  assert.equal('endedAt' in e, false); assert.equal('medication' in e, false);
});
test('retired None ratings migrate to unselected through a full backup round trip', () => {
  const original = { ...state([row({ auraIntensity: 'None' })]), customTriggers: ['Travel'], preferences: { theme: 'dark' } };
  const restored = D.parse(JSON.parse(JSON.stringify(original)), true);
  assert.equal(restored.entries[0].auraIntensity, null);
  assert.equal(restored.entries[0].headacheIntensity, null);
  assert.deepEqual(restored.customTriggers, ['Travel']); assert.equal(restored.preferences.theme, 'dark');
});
test('strict saved-data reading rejects corruption instead of dropping records', () => {
  for (const value of [{}, { entries: [row(), { at: 'invalid' }] }, { entries: [row(), row()] }, { entries: [], version: 90 }]) {
    assert.throws(() => D.parse(value, true));
  }
  assert.equal(D.parse([row(), { at: 'invalid' }]).invalid, 1);
});
test('invalid intensity and preference fields are rejected', () => {
  assert.equal(D.valid({ at, auraIntensity: 'Extreme' }), false);
  assert.throws(() => D.parse({ entries: [], customTriggers: ['valid', null] }));
  assert.throws(() => D.parse({ entries: [], preferences: { theme: 'unknown' } }));
});
test('import of an older edited snapshot retains the local entry without duplicating it', () => {
  const current = state([row({ notes: 'New', updatedAt: '2026-09-11T12:00:00Z' })]);
  const incoming = D.parse([row({ updatedAt: '2026-09-10T12:00:00Z' })]);
  const merged = D.merge(current, incoming);
  assert.equal(merged.state.entries.length, 1); assert.equal(merged.state.entries[0].notes, 'New');
  assert.equal(merged.result.conflicts, 1);
});
test('a newer version of the same ID updates once, and repeat import is idempotent', () => {
  const current = state([row({ updatedAt: '2026-09-10T12:00:00Z' })]);
  const incoming = D.parse([row({ notes: 'New', updatedAt: '2026-09-11T12:00:00Z' })]);
  const merged = D.merge(current, incoming);
  assert.equal(merged.result.updated, 1); assert.equal(merged.state.entries.length, 1);
  assert.equal(D.merge(merged.state, incoming).result.duplicates, 1);
});
test('legacy conflicts keep local values, while exact content with another ID is skipped', () => {
  const current = state([row()]);
  const incoming = D.parse([row({ notes: 'Different' }), row({ id: 'other' })]);
  const merged = D.merge(current, incoming);
  assert.equal(merged.result.conflicts, 1); assert.equal(merged.result.duplicates, 1);
  assert.equal(merged.state.entries.length, 1);
});
test('deleted IDs prevent old backups resurrecting deleted entries', () => {
  const current = { ...state(), deletedIds: ['attack-1'] };
  const merged = D.merge(current, D.parse([row()]));
  assert.equal(merged.result.deleted, 1); assert.equal(merged.state.entries.length, 0);
});
test('legacy imports retain theme; complete backups restore preferences and merge triggers', () => {
  const current = { ...state(), preferences: { theme: 'dark' }, customTriggers: ['Travel'] };
  assert.equal(D.merge(current, D.parse([])).state.preferences.theme, 'dark');
  const merged = D.merge(current, D.parse({ entries: [], customTriggers: ['Travel', 'Heat'], preferences: { theme: 'light' } }));
  assert.deepEqual(merged.state.customTriggers, ['Travel', 'Heat']);
  assert.equal(merged.state.preferences.theme, 'light');
});
test('content identity is not confused by delimiters in custom trigger labels', () => {
  assert.notEqual(D.contentKey(row({ triggers: ['a,b'] })), D.contentKey(row({ triggers: ['a', 'b'] })));
});
test('date validation rejects impossible and incomplete local dates', () => {
  assert.equal(D.fromInput('2026-02-30T10:00'), null);
  assert.equal(D.fromInput('2026-09-10T10:00junk'), null);
  assert.equal(D.toInput(D.fromInput('2026-09-10T10:00')), '2026-09-10T10:00');
});
test('print period includes month boundaries and excludes future entries', () => {
  const local = value => new Date(value).toISOString();
  const entries = ['2026-08-31T23:59', '2026-09-01T00:00', '2026-09-12T12:00', '2026-09-13T12:00'].map((date, i) => row({ id: String(i), at: local(date) }));
  const result = D.reportEntries(entries, 'month', '2026-09', new Date('2026-09-12T18:00'));
  assert.deepEqual(result.map(e => e.id), ['1', '2']);
  assert.equal(D.reportEntries(entries, 'month', ''), null);
});

test('sync reconciliation merges independent device additions', () => {
  const local = state([row({ id: 'local', updatedAt: '2026-09-11T10:00:00Z' })]);
  const remote = row({ id: 'remote', at: '2026-09-12T09:00:00Z',
    updatedAt: '2026-09-12T10:00:00Z' });
  const result = S.reconcileEntries(local, [{ id: remote.id, deleted: false,
    modifiedAt: remote.updatedAt, entry: remote }], {}, Date.parse('2026-09-13T10:00:00Z'));
  assert.deepEqual(result.state.entries.map(entry => entry.id).sort(), ['local', 'remote']);
  assert.equal(result.uploads.some(record => record.id === 'local' && !record.deleted), true);
  assert.equal(result.uploads.every(record => record.kind === 'entry'), true);
});

test('sync reconciliation applies the newest edit and preserves a newer local edit', () => {
  const local = state([row({ updatedAt: '2026-09-11T10:00:00Z' })]);
  const newer = row({ notes: 'Cloud', updatedAt: '2026-09-12T10:00:00Z' });
  const applied = S.reconcileEntries(local, [{ id: newer.id, deleted: false,
    modifiedAt: newer.updatedAt, entry: newer }]);
  assert.equal(applied.state.entries[0].notes, 'Cloud');
  const older = row({ notes: 'Old cloud', updatedAt: '2026-09-10T10:00:00Z' });
  const retained = S.reconcileEntries(local, [{ id: older.id, deleted: false,
    modifiedAt: older.updatedAt, entry: older }]);
  assert.equal(retained.state.entries[0].notes, 'Original');
  assert.equal(retained.uploads[0].entry.notes, 'Original');
  assert.equal(retained.uploads[0].kind, 'entry');
});

test('sync reconciliation propagates deletions without erasing a newer edit', () => {
  const local = state([row({ updatedAt: '2026-09-11T10:00:00Z' })]);
  const removed = S.reconcileEntries(local, [{ id: 'attack-1', deleted: true,
    modifiedAt: '2026-09-12T10:00:00Z' }]);
  assert.equal(removed.state.entries.length, 0);
  assert.deepEqual(removed.state.deletedIds, ['attack-1']);
  const retained = S.reconcileEntries(local, [{ id: 'attack-1', deleted: true,
    modifiedAt: '2026-09-10T10:00:00Z' }]);
  assert.equal(retained.state.entries.length, 1);
  assert.equal(retained.uploads[0].deleted, false);
  assert.equal(retained.uploads[0].kind, 'entry');
});

test('signing in keeps a diary with the Google account it synced with', () => {
  const withEntry = state([row()]);
  assert.equal(S.signInAction('alice', 'alice', withEntry), 'sync');
  assert.equal(S.signInAction(null, 'alice', withEntry), 'link');
  assert.equal(S.signInAction('alice', 'bob', withEntry), 'ask');
  assert.equal(S.signInAction('alice', 'bob', { ...state(), customTriggers: ['Travel'] }), 'ask');
  // Deletion markers alone are not a diary to protect, but they must not follow the device to another account.
  assert.equal(S.signInAction('alice', 'bob', { ...state(), deletedIds: ['old'] }), 'switch');
});

test('sync removes entry contents once a confirmed deletion supersedes them', () => {
  const change = (cloudId, deleted, modifiedAt, overrides = {}) => ({ kind: 'entry', id: 'attack-1', cloudId,
    deleted, modifiedAt, confirmed: true, ...(deleted ? {} : { entry: row() }), ...overrides });
  const records = [
    change('v1', false, '2026-09-13T10:00:00Z'),
    change('v2', false, '2026-09-13T11:00:00Z'),
    change('legacy-v0', false, '2026-09-13T09:30:00Z', { kind: undefined }),
    change('tombstone', true, '2026-09-13T11:00:00Z'),
    change('restored', false, '2026-09-13T12:00:00Z'),
    change('other-entry', false, '2026-09-13T09:00:00Z', { id: 'other' }),
    { kind: 'settings', cloudId: 'settings', modifiedAt: '2026-09-13T09:00:00Z', confirmed: true },
  ];
  assert.deepEqual(S.supersededContent(records), ['v1', 'v2', 'legacy-v0']);
  // A deletion still waiting to reach the server does not remove the latest copy yet.
  const unconfirmed = records.filter(item => item.cloudId !== 'restored')
    .map(item => (item.cloudId === 'tombstone' ? { ...item, confirmed: false } : item));
  assert.deepEqual(S.supersededContent(unconfirmed), ['v1', 'legacy-v0']);
});

test('sync removes older copies of an edited entry once a newer record reaches the cloud', () => {
  const copy = (cloudId, modifiedAt, overrides = {}) => ({ kind: 'entry', id: 'attack-1', cloudId, deleted: false,
    modifiedAt, confirmed: true, entry: row({ updatedAt: modifiedAt }), ...overrides });
  const records = [
    copy('first', '2026-09-13T10:00:00.000Z'),
    copy('second', '2026-09-13T11:00:00.000Z'),
    // Saved at the same moment on two devices: every device keeps the same one.
    copy('twin-a', '2026-09-13T12:00:00.000Z'),
    copy('twin-b', '2026-09-13T12:00:00.000Z'),
    // Newer copies that are unconfirmed or unreadable never replace a good one.
    copy('pending', '2026-09-13T13:00:00.000Z', { confirmed: false }),
    copy('unreadable', '2026-09-13T14:00:00.000Z', { entry: { at: 'not a date' } }),
    copy('other-entry', '2026-09-13T09:00:00.000Z', { id: 'other', entry: row({ id: 'other' }) }),
    // A deletion outranks a copy saved at the same moment, whatever their cloud IDs.
    copy('zzz-same-moment', '2026-09-13T15:00:00.000Z', { id: 'gone', entry: row({ id: 'gone' }) }),
    { kind: 'entry', id: 'gone', cloudId: 'aaa-deletion', deleted: true, modifiedAt: '2026-09-13T15:00:00.000Z', confirmed: true },
  ];
  assert.deepEqual(S.supersededContent(records), ['first', 'second', 'twin-a', 'zzz-same-moment']);
});

test('records beyond the size caps in the Firestore rules are kept off the upload list', () => {
  const upload = overrides => S.reconcileEntries(state([row(overrides)]), []).uploads[0];
  const many = count => Array.from({ length: count }, (_, i) => `Trigger ${i}`);
  assert.equal(D.notesLimit, 50000);
  assert.equal(S.fitsCloud(upload({ notes: 'x'.repeat(D.notesLimit), triggers: many(200) })), true);
  assert.equal(S.fitsCloud(upload({ notes: 'x'.repeat(D.notesLimit + 1) })), false);
  assert.equal(S.fitsCloud(upload({ triggers: many(201) })), false);
  assert.equal(S.fitsCloud({ kind: 'entry', id: 'gone', deleted: true, modifiedAt: at }), true);
  assert.equal(S.fitsCloud({ kind: 'settings', modifiedAt: at, customTriggers: many(201), preferences: { theme: 'system' } }), false);
});

test('the notes editor stops at the same length the Firestore rules accept', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, new RegExp(`<textarea data-field="notes"[^>]*maxlength="${D.notesLimit}"`));
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  assert.match(rules, new RegExp(`isText\\(entry\\.notes, ${D.notesLimit}\\)`));
});

test('a first settings sync combines custom triggers, and afterwards the newer settings win', () => {
  const local = { customTriggers: ['Red wine', 'travel'], preferences: { theme: 'dark' } };
  const cloud = { customTriggers: ['Travel', 'Cheese'], preferences: { theme: 'light' } };
  // First sync: lists combined whatever the letter case, preferences from the side changed more recently.
  assert.deepEqual(S.chooseSettings(local, 200, cloud, 100, true),
    { customTriggers: ['Travel', 'Cheese', 'Red wine'], preferences: { theme: 'dark' } });
  assert.deepEqual(S.chooseSettings(local, 100, cloud, 200, true).preferences, { theme: 'light' });
  // A device that never changed its settings takes the cloud's.
  const untouched = { customTriggers: [], preferences: { theme: 'system' } };
  assert.deepEqual(S.chooseSettings(untouched, 0, cloud, 0, true), cloud);
  // After the first sync the newer side replaces the other, so removals sync too.
  assert.deepEqual(S.chooseSettings(local, 100, cloud, 200, false), cloud);
  assert.deepEqual(S.chooseSettings(local, 200, cloud, 100, false), local);
});

// Exercise the actual app storage and draft functions in a small host, keeping
// browser rendering for the separate visual/manual checks.
function host(initial = {}, failWrites = false) {
  const storage = new Map(Object.entries(initial));
  const failing = new Set();
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, { textContent: '', hidden: true, value: '', listeners,
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        addEventListener(type, handler) { listeners[type] = handler; } });
    }
    return elements.get(id);
  };
  const context = vm.createContext({ LogData: D, console: { error() {}, warn() {} }, Date, Map, Set,
    setTimeout: () => 0, clearTimeout() {}, Blob: class {}, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { getElementById: get, createElement: () => ({ click() {} }) }, window: { addEventListener() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { get length() { return storage.size; }, key: i => [...storage.keys()][i],
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { if (failWrites || failing.has(key)) throw Error('quota'); storage.set(key, value); },
      removeItem: key => storage.delete(key) },
  });
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').split('/* ---- Boot')[0];
  vm.runInContext(source, context);
  return { storage, elements, failing, run: source => vm.runInContext(source, context) };
}
test('malformed stored JSON locks writes and preserves the exact original bytes', () => {
  const original = '{broken: medical data';
  const h = host({ 'migraine-log-v2': original });
  assert.equal(h.run('storageBlocked'), true);
  assert.equal(h.run('persistEntries([])'), false);
  assert.equal(h.storage.get('migraine-log-v2'), original);
});
test('invalid legacy rows and unreadable drafts also lock writes', () => {
  for (const initial of [{ 'migraine-log-v1': '[{"at":"invalid"}]' }, { 'migraine-log-draft-v1:x': '{bad' }]) {
    const h = host(initial); assert.equal(h.run('storageBlocked'), true); assert.equal(h.run('persistEntries([])'), false);
  }
});
test('legacy migration is atomic and retains the original storage key', () => {
  const raw = JSON.stringify([row()]);
  const h = host({ 'migraine-log-v1': raw, 'migraine-log-triggers-v1': '["Travel"]' });
  assert.equal(h.run('persistEntries(entries)'), true);
  assert.equal(h.storage.get('migraine-log-v1'), raw);
  assert.deepEqual(JSON.parse(h.storage.get('migraine-log-v2')).customTriggers, ['Travel']);
});
test('a failed write keeps the previous in-memory and stored entries', () => {
  const raw = JSON.stringify(state([row()])); const h = host({ 'migraine-log-v2': raw }, true);
  assert.equal(h.run('persistEntries([])'), false); assert.equal(h.run('entries.length'), 1);
  assert.equal(h.storage.get('migraine-log-v2'), raw);
});
test('stale tabs cannot overwrite a newer saved log', () => {
  const h = host({ 'migraine-log-v2': JSON.stringify(state([row()])) });
  const newer = JSON.stringify(state([row({ notes: 'Another tab' })])); h.storage.set('migraine-log-v2', newer);
  assert.equal(h.run('persistEntries([])'), false); assert.equal(h.storage.get('migraine-log-v2'), newer);
});
test('valid drafts reload independently of committed log contents', () => {
  const draft = { base: D.contentKey(row()), values: { at: '2026-09-10T12:00', notes: 'Unfinished', triggers: [], auraIntensity: 'Mild' } };
  const h = host({ 'migraine-log-v2': JSON.stringify(state([row()])), 'migraine-log-draft-v1:attack-1': JSON.stringify(draft) });
  assert.equal(h.run("drafts.get('attack-1').values.notes"), 'Unfinished');
  assert.equal(h.run('entries[0].notes'), 'Original');
});
test('drafts from the retired detail fields remain saveable after migration', () => {
  const oldBase = JSON.stringify([at, null, 'None', null, [], 'Original', 'Old medicine']);
  const draft = { base: oldBase, values: { at: '2026-09-10T12:00', endedAt: '', medication: '',
    notes: 'Unfinished', triggers: [], auraIntensity: 'None' } };
  const h = host({ 'migraine-log-v2': JSON.stringify(state([row()])),
    'migraine-log-draft-v1:attack-1': JSON.stringify(draft) });
  assert.equal(h.run("drafts.get('attack-1').base"), D.contentKey(row()));
  assert.equal(h.run("drafts.get('attack-1').values.auraIntensity"), null);
  assert.equal(h.run("'endedAt' in drafts.get('attack-1').values"), false);
});
test('typing keeps drafts even when a draft storage write fails, without changing the log', () => {
  const h = host({ 'migraine-log-v2': JSON.stringify(state([row()])) }, true);
  h.run(`
    const controls = new Map();
    const values = { at: '2026-09-10T12:00', notes: 'Keep this unfinished note' };
    const card = { dataset: { id: 'attack-1' }, querySelector(selector) {
      const field = selector.match(/data-field="([^"]+)"/);
      if (field) return { value: values[field[1]] };
      if (selector.includes('data-chips')) return { querySelectorAll() { return []; } };
      if (!controls.has(selector)) controls.set(selector, { textContent: '', hidden: true });
      return controls.get(selector);
    } };
    rememberDraft(card);
  `);
  assert.equal(h.run("drafts.get('attack-1').values.notes"), 'Keep this unfinished note');
  assert.equal(h.run("drafts.get('attack-1').stored"), false);
  assert.equal(h.run('entries[0].notes'), 'Original');
  assert.equal(h.run("controls.get('.entry-error').hidden"), false);
});
test('malformed draft fields lock writes instead of being silently replaced', () => {
  const draft = { base: 'original', values: { at: '', notes: '', triggers: [42] } };
  const h = host({ 'migraine-log-draft-v1:x': JSON.stringify(draft) });
  assert.equal(h.run('storageBlocked'), true);
  assert.equal(h.run('persistEntries([])'), false);
});
test('a successful export clears the error an earlier export left, but not other errors', () => {
  const h = host({ 'migraine-log-v2': JSON.stringify(state([row()])) });
  const appError = h.run("$('appError')");
  const exportBackup = () => h.elements.get('exportBtn').listeners.click();
  h.failing.add('migraine-log-meta-v1');
  exportBackup();
  assert.equal(appError.hidden, false);
  assert.match(appError.textContent, /backup reminder could not be saved/);
  h.failing.clear();
  exportBackup();
  assert.equal(appError.hidden, true);
  h.run("showError('Your log changed in another tab. Reload this page before saving; your local draft is kept.')");
  exportBackup();
  assert.equal(appError.hidden, false);
});
test('the app refuses to run inside a frame on another site', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const body = { textContent: 'Migraine Log' };
  const framed = vm.createContext({ window: { top: {}, self: {} }, document: { body } });
  assert.throws(() => vm.runInContext(source, framed), /inside a frame/);
  assert.match(body.textContent, /opened directly/);
});
test('the content security policy matches in index.html and _headers, and only the header forbids framing', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const policy = read('index.html').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.ok(policy, 'index.html carries the policy in a meta tag');
  const authDomain = read('firebase-config.js').match(/authDomain: '([^']+)'/)[1];
  assert.ok(policy.includes(`frame-src https://${authDomain};`), 'sign-in frames are allowed from the configured auth domain');
  assert.ok(!policy.includes('frame-ancestors'), 'browsers ignore frame-ancestors in a meta tag');
  const headers = read('_headers');
  assert.ok(headers.includes(`Content-Security-Policy: ${policy}; frame-ancestors 'none'`), '_headers repeats the policy');
  assert.match(headers, /X-Frame-Options: DENY/);
});
test('a damaged backup reminder cannot crash or lock the diary', () => {
  const h = host({ 'migraine-log-meta-v1': '{"lastExportAt":"bad date","pending":-10}' });
  assert.equal(h.run('meta.lastExportAt'), null);
  assert.equal(h.run('meta.pending'), 0);
  assert.equal(h.run('storageBlocked'), false);
});
