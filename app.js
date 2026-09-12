/* Migraine Log — all data stays in this browser's localStorage. */
'use strict';

const KEY = 'migraine-log-v1';

const $ = (id) => document.getElementById(id);
const list = $('list');
const tpl = $('entryTpl');

let entries = load();

/* ---- Storage ----------------------------------------------------------- */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(valid).map((e) => ({
      id: String(e.id || uid()),
      at: e.at,
      notes: typeof e.notes === 'string' ? e.notes : '',
    }));
  } catch (err) {
    console.error('Could not read saved entries', err);
    return [];
  }
}

function valid(e) {
  return e && typeof e === 'object' && typeof e.at === 'string' && !isNaN(Date.parse(e.at));
}

function save() {
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (err) {
    console.error(err);
    toast('Could not save — device storage is full or blocked');
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Identifies an entry by content, to skip duplicates on import. `at` is always
// a fixed-length ISO string, so this cannot collide across different entries.
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

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function describe(date) {
  const now = new Date();
  const days = Math.round((midnight(now) - midnight(date)) / 86400000);
  const time = timeFmt.format(date);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (date.getFullYear() !== now.getFullYear()) {
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
      entries = entries.filter((e) => e.id !== id);
      save();
      render();
      toast('Entry deleted');
      break;
    }
  }
});

/* ---- Adding ------------------------------------------------------------ */

$('logNow').addEventListener('click', () => {
  entries.push({ id: uid(), at: new Date().toISOString(), notes: '' });
  save();
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
  render();
  newForm.hidden = true;
  toast('Entry added');
});

/* ---- Backup ------------------------------------------------------------ */

$('exportBtn').addEventListener('click', () => {
  const stamp = toInput(new Date()).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `migraine-log-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    // A backup is a plain array of entries; also accept a wrapping object.
    const incoming = Array.isArray(parsed) ? parsed : parsed && parsed.entries;
    if (!Array.isArray(incoming)) throw new Error('no entries in file');

    const seen = new Set(entries.map((e) => contentKey(e.at, e.notes)));
    let added = 0;

    for (const raw of incoming.filter(valid)) {
      const at = new Date(raw.at).toISOString();
      const notes = typeof raw.notes === 'string' ? raw.notes : '';
      const key = contentKey(at, notes);
      if (seen.has(key)) continue;      // merge, skipping exact duplicates
      seen.add(key);
      entries.push({ id: uid(), at, notes });
      added++;
    }

    save();
    render();
    toast(added
      ? `Imported ${added} ${added === 1 ? 'entry' : 'entries'}`
      : 'Nothing new to import');
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
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
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
