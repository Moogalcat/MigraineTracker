/* Migraine Log — all data stays in this browser's localStorage. */
'use strict';

const KEY = 'migraine-log-v1';
const META_KEY = 'migraine-log-meta-v1';
const CUSTOM_KEY = 'migraine-log-triggers-v1';

// The best-documented common triggers. Twelve is about as many as anyone will
// actually read while recovering from an attack.
const BUILT_IN_TRIGGERS = [
  'Stress', 'Poor sleep', 'Skipped meal', 'Dehydration',
  'Alcohol', 'Caffeine', 'Hormonal', 'Bright light',
  'Strong smell', 'Weather', 'Screen time', 'Neck tension',
];

const INTENSITIES = ['Mild', 'Moderate', 'Severe'];

// "A few" slots of your own, on top of the built-in list.
const MAX_CUSTOM_TRIGGERS = 6;

const $ = (id) => document.getElementById(id);
const list = $('list');
const tpl = $('entryTpl');

let entries = load();
let meta = loadMeta();
let customTriggers = loadCustomTriggers();

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
  } catch (err) {
    console.error(err);
    toast('Could not save — device storage is full or blocked');
  }
}

function load() {
  const parsed = readJSON(KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(valid).map(normalise);
}

// Entries saved before triggers and intensity existed simply have neither.
function normalise(e) {
  const triggers = Array.isArray(e.triggers)
    ? e.triggers.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
    : [];
  return {
    id: String(e.id || uid()),
    at: e.at,
    notes: typeof e.notes === 'string' ? e.notes : '',
    triggers: [...new Set(triggers)].slice(0, 24),
    intensity: INTENSITIES.includes(e.intensity) ? e.intensity : null,
  };
}

function loadCustomTriggers() {
  const parsed = readJSON(CUSTOM_KEY, []);
  if (!Array.isArray(parsed)) return [];
  const clean = parsed
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim());
  return [...new Set(clean)].slice(0, MAX_CUSTOM_TRIGGERS);
}

// Remembers when you last exported, and how many edits you've made since.
function loadMeta() {
  const m = readJSON(META_KEY, {});
  return {
    lastExportAt: m && typeof m.lastExportAt === 'string' ? m.lastExportAt : null,
    pending: m && Number.isFinite(m.pending) ? m.pending : 0,
  };
}

function valid(e) {
  return e && typeof e === 'object' && typeof e.at === 'string' && !isNaN(Date.parse(e.at));
}

function save() {
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  writeJSON(KEY, entries);
}

// Call after any edit, so the backup status can flag a stale export file.
function markChanged(n = 1) {
  meta.pending += n;
  writeJSON(META_KEY, meta);
  renderBackupStatus();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Identifies an entry by content, to skip duplicates on import. Two entries
// that differ only in their triggers or intensity are genuinely different.
function contentKey(e) {
  return [
    e.at,
    e.intensity || '',
    [...e.triggers].sort().join(','),
    e.notes,
  ].join('|');
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
  const now = new Date();
  const days = daysAgo(date);
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
    renderEntryMeta(li.querySelector('.entry-meta'), entry);
    fillChips(li, entry);

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

// The badge and trigger list shown on the collapsed card.
function renderEntryMeta(el, entry) {
  el.textContent = '';

  if (entry.intensity) {
    const badge = document.createElement('span');
    badge.className = `badge badge-${entry.intensity.toLowerCase()}`;
    badge.textContent = entry.intensity;
    el.appendChild(badge);
  }

  if (entry.triggers.length) {
    const t = document.createElement('span');
    t.textContent = entry.triggers.join(' · ');
    el.appendChild(t);
  }
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

// Shows at a glance whether the backup file on disk is out of date. The app
// cannot update a file you already saved, so this is the nudge to export again.
function renderBackupStatus() {
  const el = $('backupStatus');
  if (!el) return;

  el.classList.toggle('stale', meta.pending > 0);

  if (meta.pending > 0) {
    const n = meta.pending;
    el.textContent = meta.lastExportAt
      ? ` — ${n} ${n === 1 ? 'change' : 'changes'} not backed up`
      : ' — never backed up';
    return;
  }

  if (!meta.lastExportAt) { el.textContent = ''; return; }

  const d = new Date(meta.lastExportAt);
  const days = daysAgo(d);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : shortFmt.format(d);
  el.textContent = ` — backup exported ${when}`;
}

/* ---- Trigger and intensity chips --------------------------------------- */

// Built-ins, then your own, then any label an entry still carries that has
// since been removed from the offered list - so history never loses a label.
function triggerOptions(selected) {
  return [...new Set([...BUILT_IN_TRIGGERS, ...customTriggers, ...selected])];
}

function renderChips(row, selected) {
  const intensity = row.dataset.chips === 'intensity';
  const options = intensity ? INTENSITIES : triggerOptions(selected);

  row.textContent = '';
  for (const label of options) {
    const wrap = document.createElement('span');
    wrap.className = 'chip-wrap';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = label;
    chip.textContent = label;
    const on = selected.includes(label);
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', String(on));
    wrap.appendChild(chip);

    // Your own triggers can be taken back out of the list.
    if (!intensity && customTriggers.includes(label)) {
      wrap.classList.add('has-x');
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.dataset.removeTrigger = label;
      x.textContent = '\u00d7';
      x.setAttribute('aria-label', `Remove ${label} from my triggers`);
      wrap.appendChild(x);
    }
    row.appendChild(wrap);
  }

  if (!intensity && customTriggers.length < MAX_CUSTOM_TRIGGERS) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip chip-add';
    add.dataset.addTrigger = '1';
    add.textContent = '+ Add your own';
    row.appendChild(add);
  }
}

function fillChips(scope, entry) {
  const t = scope.querySelector('[data-chips="triggers"]');
  const i = scope.querySelector('[data-chips="intensity"]');
  if (t) renderChips(t, entry.triggers || []);
  if (i) renderChips(i, entry.intensity ? [entry.intensity] : []);
}

function readChips(scope, kind) {
  const row = scope.querySelector(`[data-chips="${kind}"]`);
  if (!row) return [];
  return [...row.querySelectorAll('.chip.on')].map((c) => c.dataset.value);
}

// Re-render every chip row in place, keeping whatever is selected right now,
// so adding or removing a trigger never discards an in-progress edit.
function refreshAllTriggerRows() {
  for (const row of document.querySelectorAll('[data-chips="triggers"]')) {
    const on = [...row.querySelectorAll('.chip.on')].map((c) => c.dataset.value);
    renderChips(row, on);
  }
}

function addCustomTrigger(row) {
  const raw = prompt('Add a trigger of your own, e.g. "Red wine"');
  if (raw === null) return;

  const label = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!label) return;

  const taken = [...BUILT_IN_TRIGGERS, ...customTriggers]
    .some((t) => t.toLowerCase() === label.toLowerCase());
  if (taken) { toast(`"${label}" is already in the list`); return; }

  if (customTriggers.length >= MAX_CUSTOM_TRIGGERS) {
    toast(`You can keep ${MAX_CUSTOM_TRIGGERS} of your own — remove one first`);
    return;
  }

  customTriggers.push(label);
  writeJSON(CUSTOM_KEY, customTriggers);
  refreshAllTriggerRows();

  // Select it straight away in the row it was added from.
  const chip = row.querySelector(`.chip[data-value="${CSS.escape(label)}"]`);
  if (chip) { chip.classList.add('on'); chip.setAttribute('aria-pressed', 'true'); }
}

function removeCustomTrigger(label) {
  customTriggers = customTriggers.filter((t) => t !== label);
  writeJSON(CUSTOM_KEY, customTriggers);
  refreshAllTriggerRows();
  toast(`"${label}" removed from your list`);
}

// Returns true when the click was a chip interaction and needs nothing else.
function handleChipClick(ev) {
  const add = ev.target.closest('[data-add-trigger]');
  if (add) { addCustomTrigger(add.closest('[data-chips]')); return true; }

  const rm = ev.target.closest('[data-remove-trigger]');
  if (rm) { removeCustomTrigger(rm.dataset.removeTrigger); return true; }

  const chip = ev.target.closest('.chip[data-value]');
  if (!chip) return false;

  const row = chip.closest('[data-chips]');
  const wasOn = chip.classList.contains('on');

  // Intensity is a single choice; tapping the current one clears it.
  if (row.dataset.chips === 'intensity') {
    for (const c of row.querySelectorAll('.chip.on')) {
      c.classList.remove('on');
      c.setAttribute('aria-pressed', 'false');
    }
  }
  chip.classList.toggle('on', !wasOn);
  chip.setAttribute('aria-pressed', String(!wasOn));
  return true;
}

/* ---- Editing and deleting ---------------------------------------------- */

list.addEventListener('click', (ev) => {
  if (handleChipClick(ev)) return;

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
        fillChips(li, entry);
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
      entry.triggers = readChips(li, 'triggers');
      entry.intensity = readChips(li, 'intensity')[0] || null;
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
      entries = entries.filter((e) => e.id !== id);
      save();
      markChanged();
      render();
      toast('Entry deleted');
      break;
    }
  }
});

/* ---- Adding ------------------------------------------------------------ */

$('logNow').addEventListener('click', () => {
  entries.push({
    id: uid(), at: new Date().toISOString(), notes: '', triggers: [], intensity: null,
  });
  save();
  markChanged();
  render();
  toast('Logged — tap it to add details once it passes');
  const first = list.querySelector('.entry');
  if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

const newForm = $('newForm');

$('addOther').addEventListener('click', () => {
  if (!newForm.hidden) { newForm.hidden = true; return; }
  $('newAt').value = toInput(new Date());
  $('newNotes').value = '';
  fillChips(newForm, { triggers: [], intensity: null });
  newForm.hidden = false;
  $('newAt').focus();
});

newForm.addEventListener('click', (ev) => { handleChipClick(ev); });

$('newCancel').addEventListener('click', () => { newForm.hidden = true; });

newForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const date = fromInput($('newAt').value);
  if (!date) { toast('Please pick a valid date and time'); return; }
  entries.push({
    id: uid(),
    at: date.toISOString(),
    notes: $('newNotes').value,
    triggers: readChips(newForm, 'triggers'),
    intensity: readChips(newForm, 'intensity')[0] || null,
  });
  save();
  markChanged();
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

  // The file on disk now matches what's in the app.
  meta.lastExportAt = new Date().toISOString();
  meta.pending = 0;
  writeJSON(META_KEY, meta);
  renderBackupStatus();
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

    const seen = new Set(entries.map(contentKey));
    let added = 0;

    for (const raw of incoming.filter(valid)) {
      const e = normalise({ ...raw, id: uid(), at: new Date(raw.at).toISOString() });
      const key = contentKey(e);
      if (seen.has(key)) continue;      // merge, skipping exact duplicates
      seen.add(key);
      entries.push(e);
      added++;
    }

    save();
    if (added) markChanged(added);
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
