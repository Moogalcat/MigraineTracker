/* Migraine Log — all data stays in this browser's localStorage. */
'use strict';

const KEY = 'migraine-log-v1';
const DELETED_KEY = 'migraine-log-deleted-v1';
const META_KEY = 'migraine-log-meta-v1';

// Deletions are remembered so importing an older backup can't resurrect them.
// They are tiny; this cap just stops the list growing without bound.
const MAX_TOMBSTONES = 1000;

const $ = (id) => document.getElementById(id);
const list = $('list');
const tpl = $('entryTpl');

let entries = load();
let deleted = loadDeleted();
let meta = loadMeta();

/* ---- Storage ----------------------------------------------------------- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(`Could not read ${key}`, err);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(err);
    toast('Could not save — device storage is full or blocked');
    return false;
  }
}

function load() {
  const parsed = readJSON(KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(valid).map((e) => ({
    id: String(e.id || uid()),
    at: e.at,
    notes: typeof e.notes === 'string' ? e.notes : '',
  }));
}

function loadDeleted() {
  const parsed = readJSON(DELETED_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((d) => d && typeof d === 'object' && (d.id || d.at));
}

function loadMeta() {
  const parsed = readJSON(META_KEY, {});
  const m = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    lastExportAt: typeof m.lastExportAt === 'string' ? m.lastExportAt : null,
    pending: Number.isFinite(m.pending) ? m.pending : 0,
  };
}

function valid(e) {
  return e && typeof e === 'object' && typeof e.at === 'string' && !isNaN(Date.parse(e.at));
}

function save() {
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  writeJSON(KEY, entries);
}

function saveDeleted() {
  // Keep only the most recent tombstones.
  deleted.sort((a, b) => Date.parse(b.deletedAt || 0) - Date.parse(a.deletedAt || 0));
  if (deleted.length > MAX_TOMBSTONES) deleted.length = MAX_TOMBSTONES;
  writeJSON(DELETED_KEY, deleted);
}

function saveMeta() {
  writeJSON(META_KEY, meta);
}

// Counts edits made since the last export, so we can flag a stale backup file.
function markChanged(n = 1) {
  meta.pending += n;
  saveMeta();
  renderBackupStatus();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Identifies an entry by content, for matching across export/import when ids
// differ. `at` is always a fixed-length ISO string, so this cannot collide.
function contentKey(at, notes) {
  return `${at}|${notes}`;
}

/* ---- Date helpers ------------------------------------------------------ */

// <input type="datetime-local"> wants local wall-clock "YYYY-MM-DDTHH:mm".
function toInput(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
         `T${p(date.getHours())}:${p(date.getMinutes())}`;
}

// Read back as local time, then stored as an ISO (UTC) string.
function fromInput(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return isNaN(d.getTime()) ? null : d;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dateFmtYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysAgo(date) {
  return Math.round((midnight(new Date()) - midnight(date)) / 86400000);
}

function describe(date) {
  const days = daysAgo(date);
  const time = timeFmt.format(date);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (date.getFullYear() !== new Date().getFullYear()) {
    return `${dateFmtYear.format(date)}, ${time}`;
  }
  return `${dateFmt.format(date)}, ${time}`;
}

/* ---- Rendering --------------------------------------------------------- */

function render() {
  // Preserve which cards the user had expanded.
  const openIds = new Set(
    [...list.querySelectorAll('.entry.open')].map((li) => li.dataset.id)
  );

  list.textContent = '';
  for (const entry of entries) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const date = new Date(entry.at);

    li.dataset.id = entry.id;
    li.querySelector('.entry-when').textContent = describe(date);
    li.querySelector('.entry-notes').textContent = entry.notes.trim();
    li.querySelector('[data-field="at"]').value = toInput(date);
    li.querySelector('[data-field="notes"]').value = entry.notes;

    if (openIds.has(entry.id)) {
      li.classList.add('open');
      li.querySelector('.entry-body').hidden = false;
    }
    list.appendChild(li);
  }

  $('empty').hidden = entries.length > 0;
  renderTally();
  renderBackupStatus();
}

function renderTally() {
  const el = $('tally');
  if (!entries.length) { el.textContent = ''; return; }

  const now = new Date();
  const thisMonth = entries.filter((e) => {
    const d = new Date(e.at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const last90 = entries.filter(
    (e) => now.getTime() - Date.parse(e.at) <= 90 * 86400000
  ).length;

  const label = thisMonth === 1 ? '1 entry' : `${thisMonth} entries`;
  el.textContent = `${label} this month — ${last90} in the last 90 days`;
}

// Tells the user, without opening the section, whether their backup file is
// out of date — that file is the thing a deletion cannot reach on its own.
function renderBackupStatus() {
  const el = $('backupStatus');
  if (!el) return;

  if (meta.pending > 0) {
    const n = meta.pending;
    el.textContent = ` — ${n} ${n === 1 ? 'change' : 'changes'} not in your backup file`;
    el.classList.add('stale');
    return;
  }

  el.classList.remove('stale');
  if (!meta.lastExportAt) { el.textContent = ''; return; }

  const d = new Date(meta.lastExportAt);
  const days = daysAgo(d);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : shortFmt.format(d);
  el.textContent = ` — backup exported ${when}`;
}

/* ---- Editing and deleting ---------------------------------------------- */

list.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;

  const li = btn.closest('.entry');
  const id = li.dataset.id;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;

  const body = li.querySelector('.entry-body');
  const atInput = li.querySelector('[data-field="at"]');
  const notesInput = li.querySelector('[data-field="notes"]');

  switch (btn.dataset.act) {
    case 'toggle': {
      const open = li.classList.toggle('open');
      body.hidden = !open;
      if (open) {
        // Start from the stored values every time it opens.
        atInput.value = toInput(new Date(entry.at));
        notesInput.value = entry.notes;
      }
      break;
    }

    case 'save': {
      const date = fromInput(atInput.value);
      if (!date) {
        toast('Please pick a valid date and time');
        atInput.focus();
        return;
      }
      entry.at = date.toISOString();
      entry.notes = notesInput.value;
      save();
      markChanged();
      li.classList.remove('open');
      render();
      toast('Saved');
      break;
    }

    case 'cancel': {
      li.classList.remove('open');
      body.hidden = true;
      break;
    }

    case 'delete': {
      if (!confirm(`Delete the entry from ${describe(new Date(entry.at))}?`)) return;

      // Record the deletion so a later import cannot bring it back. Only the
      // id and timestamp are kept - never the notes.
      deleted.push({
        id: entry.id,
        at: entry.at,
        deletedAt: new Date().toISOString(),
      });
      saveDeleted();

      entries = entries.filter((e) => e.id !== id);
      save();
      markChanged();
      render();
      toast(meta.lastExportAt
        ? 'Deleted — export again to update your backup file'
        : 'Entry deleted');
      break;
    }
  }
});

/* ---- Adding ------------------------------------------------------------ */

$('logNow').addEventListener('click', () => {
  entries.push({ id: uid(), at: new Date().toISOString(), notes: '' });
  save();
  markChanged();
  render();
  toast('Logged — tap it to add notes');
  const first = list.querySelector('.entry');
  if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

const newForm = $('newForm');

$('addOther').addEventListener('click', () => {
  if (!newForm.hidden) { newForm.hidden = true; return; }
  $('newAt').value = toInput(new Date());
  $('newNotes').value = '';
  newForm.hidden = false;
  $('newAt').focus();
});

$('newCancel').addEventListener('click', () => { newForm.hidden = true; });

newForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const date = fromInput($('newAt').value);
  if (!date) { toast('Please pick a valid date and time'); return; }
  entries.push({ id: uid(), at: date.toISOString(), notes: $('newNotes').value });
  save();
  markChanged();
  render();
  newForm.hidden = true;
  toast('Entry added');
});

/* ---- Backup ------------------------------------------------------------ */

$('exportBtn').addEventListener('click', () => {
  // Only current entries. Deletions are tracked on the device, never written
  // here, so an exported file contains no trace of a deleted entry.
  const payload = {
    format: 'migraine-log',
    version: 2,
    exportedAt: new Date().toISOString(),
    entries,
  };

  const stamp = toInput(new Date()).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `migraine-log-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  // The file on disk now matches what's in the app.
  meta.lastExportAt = new Date().toISOString();
  meta.pending = 0;
  saveMeta();
  renderBackupStatus();
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());

    // v2 files are an object; v1 files were a bare array of entries.
    const incoming = Array.isArray(parsed) ? parsed : parsed && parsed.entries;
    if (!Array.isArray(incoming)) throw new Error('no entries in file');
    const tombIds = new Set(deleted.map((d) => d.id).filter(Boolean));
    const tombAts = new Set(
      deleted.filter((d) => d.at).map((d) => new Date(d.at).toISOString())
    );

    const seenKeys = new Set(entries.map((e) => contentKey(e.at, e.notes)));
    const seenIds = new Set(entries.map((e) => e.id));

    let added = 0;
    let blocked = 0;

    for (const raw of incoming.filter(valid)) {
      const at = new Date(raw.at).toISOString();
      const notes = typeof raw.notes === 'string' ? raw.notes : '';
      const key = contentKey(at, notes);
      const rawId = raw.id ? String(raw.id) : '';

      if (tombAts.has(at) || (rawId && tombIds.has(rawId))) { blocked++; continue; }
      if (seenKeys.has(key) || (rawId && seenIds.has(rawId))) { continue; }

      // Preserve the id where we can, so round-trips stay stable.
      const id = rawId && !seenIds.has(rawId) ? rawId : uid();
      seenKeys.add(key);
      seenIds.add(id);
      entries.push({ id, at, notes });
      added++;
    }

    save();
    if (added) markChanged(added);
    render();

    const parts = [];
    parts.push(added ? `Imported ${added} ${added === 1 ? 'entry' : 'entries'}` : 'Nothing new to import');
    if (blocked) parts.push(`${blocked} previously deleted ${blocked === 1 ? 'entry' : 'entries'} skipped`);
    toast(parts.join(' — '));
  } catch (err) {
    console.error(err);
    toast('That file does not look like a Migraine Log backup');
  }
});

/* ---- Toast ------------------------------------------------------------- */

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

/* ---- Boot -------------------------------------------------------------- */

render();

// Keep the "Today / Yesterday" labels honest if the app sits open past midnight.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) =>
      console.warn('Service worker registration failed', err)
    );
  });
}
