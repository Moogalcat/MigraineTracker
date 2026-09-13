/* Pure conflict-resolution rules shared by cloud sync and its tests. */
'use strict';
const MigraineSyncData = (() => {
  const entryTime = (entry) => Date.parse(entry.updatedAt || entry.at) || 0;
  const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isEntryChange = (record) => record?.kind === 'entry'
    || (record?.kind == null && typeof record?.id === 'string'
      && (record.deleted === true || record.entry != null));

  function reconcileEntries(current, remoteRecords, tombstones = {}, now = Date.now()) {
    const byId = new Map(current.entries.map(entry => [entry.id, entry]));
    const deleted = new Set(current.deletedIds);
    const deletedAt = { ...tombstones };
    const seenRemote = new Set();
    const uploads = [];
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

    for (const entry of byId.values()) {
      if (!seenRemote.has(entry.id)) {
        uploads.push({ kind: 'entry', id: entry.id, deleted: false,
          modifiedAt: entry.updatedAt || entry.at, entry });
      }
    }
    for (const id of deleted) {
      if (!seenRemote.has(id)) {
        uploads.push({ kind: 'entry', id, deleted: true,
          modifiedAt: new Date(deletedAt[id]).toISOString() });
      }
    }

    return {
      state: { ...current, entries: [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
        deletedIds: [...deleted] },
      tombstones: deletedAt,
      uploads,
      changed,
      invalid,
    };
  }

  return { entryTime, isEntryChange, reconcileEntries };
})();
if (typeof module !== 'undefined') module.exports = MigraineSyncData;
