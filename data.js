/* Data rules shared by the browser and the dependency-free regression tests. */
'use strict';
const LogData = (() => {
  const ratings = ['Mild', 'Moderate', 'Severe'];
  const legacyRatings = ['None', ...ratings];
  const themes = ['system', 'light', 'dark'];
  const isDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  function valid(e) {
    return !!e && typeof e === 'object' && isDate(e.at)
      && (e.notes == null || typeof e.notes === 'string')
      && (e.triggers == null || (Array.isArray(e.triggers) && e.triggers.every(t => typeof t === 'string')))
      && ['auraIntensity', 'headacheIntensity', 'intensity'].every(k => e[k] == null || legacyRatings.includes(e[k]))
      && (e.updatedAt == null || isDate(e.updatedAt));
  }
  function normalise(e) {
    return {
      id: String(e.id || uid()), at: new Date(e.at).toISOString(),
      updatedAt: isDate(e.updatedAt) ? new Date(e.updatedAt).toISOString() : null,
      notes: e.notes || '',
      triggers: [...new Set((e.triggers || []).map(t => t.trim()).filter(Boolean))],
      auraIntensity: ratings.includes(e.auraIntensity) ? e.auraIntensity : null,
      headacheIntensity: ratings.includes(e.headacheIntensity) ? e.headacheIntensity
        : ratings.includes(e.intensity) ? e.intensity : null,
    };
  }
  function contentKey(e) {
    return JSON.stringify([e.at, e.auraIntensity || null,
      e.headacheIntensity || null, [...e.triggers].sort(), e.notes]);
  }
  function empty() {
    return { version: 2, entries: [], customTriggers: [], preferences: { theme: 'system' }, deletedIds: [] };
  }
  function parse(value, strict = false) {
    const object = Array.isArray(value) ? { entries: value } : value;
    if (!object || !Array.isArray(object.entries)) throw new Error('No entry list found');
    if (object.version != null && object.version !== 2) throw new Error('Unsupported backup version');
    if (object.customTriggers != null && (!Array.isArray(object.customTriggers)
      || !object.customTriggers.every(t => typeof t === 'string' && t.trim()))) throw new Error('Invalid custom triggers');
    if (object.preferences != null && (!object.preferences || typeof object.preferences !== 'object'
      || !themes.includes(object.preferences.theme))) throw new Error('Invalid preferences');
    if (object.deletedIds != null && (!Array.isArray(object.deletedIds)
      || !object.deletedIds.every(id => typeof id === 'string'))) throw new Error('Invalid deleted entry list');
    const rows = object.entries.filter(valid);
    const invalid = object.entries.length - rows.length;
    if (strict && invalid) throw new Error('Some saved entries cannot be read');
    const entries = rows.map(normalise);
    if (strict && new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Repeated saved entry IDs');
    return { ...empty(), entries, invalid,
      customTriggers: [...new Set((object.customTriggers || []).map(t => t.trim()))],
      preferences: object.preferences || { theme: 'system' },
      deletedIds: [...new Set(object.deletedIds || [])],
      hasPreferences: object.preferences != null,
    };
  }
  // Stable IDs prevent an older snapshot from becoming a second attack.
  // Without reliable modification dates, retain the local copy and report it.
  function merge(current, incoming) {
    const result = { added: 0, updated: 0, duplicates: 0, conflicts: 0, deleted: 0, invalid: incoming.invalid || 0 };
    const byId = new Map(current.entries.map(e => [e.id, e]));
    const seen = new Set(current.entries.map(contentKey));
    const deleted = new Set(current.deletedIds);
    for (const e of incoming.entries) {
      if (deleted.has(e.id)) { result.deleted++; continue; }
      const existing = byId.get(e.id);
      if (existing) {
        if (contentKey(existing) === contentKey(e)) { result.duplicates++; continue; }
        if (e.updatedAt && existing.updatedAt && Date.parse(e.updatedAt) > Date.parse(existing.updatedAt)) {
          seen.delete(contentKey(existing)); byId.set(e.id, e); seen.add(contentKey(e)); result.updated++;
        } else result.conflicts++;
      } else if (seen.has(contentKey(e))) result.duplicates++;
      else { byId.set(e.id, e); seen.add(contentKey(e)); result.added++; }
    }
    // A merge never deletes an existing local entry. Remember imported deletions
    // only for IDs absent locally, preventing later old backups resurrecting them.
    for (const id of incoming.deletedIds) if (!byId.has(id)) deleted.add(id);
    const customTriggers = [...new Set([...current.customTriggers, ...incoming.customTriggers])];
    return { state: { version: 2, entries: [...byId.values()], customTriggers,
      preferences: incoming.hasPreferences ? incoming.preferences : current.preferences,
      deletedIds: [...deleted] }, result };
  }
  function fromInput(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || toInput(date) !== value) return null;
    return date;
  }
  function toInput(date) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }
  function reportEntries(entries, period, month, now = new Date()) {
    let start, end;
    if (period === 'month') {
      if (!/^\d{4}-\d{2}$/.test(month || '') || +month.slice(5) < 1 || +month.slice(5) > 12) return null;
      const [year, m] = month.split('-').map(Number);
      start = new Date(year, m - 1, 1); end = new Date(year, m, 1);
    } else { start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89); end = new Date(now.getTime() + 1); }
    return entries.filter(e => Date.parse(e.at) >= start.getTime() && Date.parse(e.at) < end.getTime()
      && Date.parse(e.at) <= now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  // The longest note cloud sync accepts. firestore.rules and the notes editor's maxlength use the same number.
  const notesLimit = 50000;
  return { ratings, themes, notesLimit, uid, valid, normalise, contentKey, empty, parse, merge, fromInput, toInput, reportEntries };
})();
if (typeof module !== 'undefined') module.exports = LogData;
