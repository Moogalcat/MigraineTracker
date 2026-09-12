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

// Entry id to open on the next render - a freshly logged entry shows its whole
// editor rather than making you tap to open it.
let openOnRender = null;
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
    return true;
  } catch (err) {
    console.error(err);
    return false;
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

function persistEntries(nextEntries) {
  const sorted = [...nextEntries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!writeJSON(KEY, sorted)) return false;
  entries = sorted;
  return true;
}

// Call after any edit, so the backup status can flag a stale export file.
function markChanged(n = 1) {
  const nextMeta = { ...meta, pending: meta.pending + n };
  if (!writeJSON(META_KEY, nextMeta)) return false;
  meta = nextMeta;
  renderBackupStatus();
  return true;
}

function finishChange(message, count = 1) {
  const reminderSaved = markChanged(count);
  render();
  toast(reminderSaved ? message : `${message}, but the backup reminder could not be saved`);
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
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const fullFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

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
  if (openOnRender) {
    openIds.add(openOnRender);
    openOnRender = null;
  }

  list.textContent = '';
  for (const [index, entry] of entries.entries()) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const date = new Date(entry.at);
    const head = li.querySelector('.entry-head');
    const body = li.querySelector('.entry-body');
    const atInput = li.querySelector('[data-field="at"]');
    const notesInput = li.querySelector('[data-field="notes"]');
    const bodyId = `entry-body-${index}`;
    const atId = `entry-at-${index}`;
    const notesId = `entry-notes-${index}`;

    li.dataset.id = entry.id;
    if (entry.intensity) li.classList.add(`severity-${entry.intensity.toLowerCase()}`);
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', bodyId);
    body.id = bodyId;
    atInput.id = atId;
    notesInput.id = notesId;
    li.querySelector('.entry-at-label').htmlFor = atId;
    li.querySelector('.entry-notes-label').htmlFor = notesId;
    li.querySelector('.entry-when').textContent = describe(date);
    li.querySelector('.entry-notes').textContent = entry.notes.trim();
    atInput.value = toInput(date);
    notesInput.value = entry.notes;
    renderEntryMeta(li.querySelector('.entry-meta'), entry);
    fillChips(li, entry);

    if (openIds.has(entry.id)) {
      li.classList.add('open');
      head.setAttribute('aria-expanded', 'true');
      body.hidden = false;
    }
    list.appendChild(li);
  }

  $('empty').hidden = entries.length > 0;
  renderTally();
  renderStats();
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

  // Both counts use the same rule: only what has actually happened. Counting a
  // future date in one total but not the other made the two disagree.
  const happened = entries.filter((e) => Date.parse(e.at) <= now.getTime());
  const future = entries.length - happened.length;

  const thisMonth = happened.filter((e) => {
    const d = new Date(e.at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const last90 = happened.filter(
    (e) => now.getTime() - Date.parse(e.at) <= 90 * 86400000
  ).length;

  const label = thisMonth === 1 ? '1 entry' : `${thisMonth} entries`;
  let text = `${label} this month — ${last90} in the last 90 days`;

  // Say so rather than letting a mistyped date silently vanish from both.
  if (future) {
    text += ` · ${future} dated in the future`;
  }
  el.textContent = text;
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
  el.textContent = ` — export started ${when}`;
}

/* ---- Statistics -------------------------------------------------------- */

// Stats describe what has happened, so future-dated entries are left out -
// the same rule the header tally uses.
function happenedEntries() {
  const now = Date.now();
  return entries.filter((e) => Date.parse(e.at) <= now);
}

function statRow(label, value, fraction, colourVar) {
  const row = document.createElement('div');
  row.className = 'stat-row';

  const name = document.createElement('span');
  name.className = 'stat-label';
  name.textContent = label;                 // user-supplied trigger names: text only

  const track = document.createElement('span');
  track.className = 'stat-track';
  const bar = document.createElement('span');
  bar.className = 'stat-bar';
  bar.style.width = `${Math.round(fraction * 100)}%`;
  if (colourVar) bar.style.background = `var(${colourVar})`;
  track.appendChild(bar);

  const count = document.createElement('span');
  count.className = 'stat-count';
  count.textContent = value;

  row.append(name, track, count);
  return row;
}

function statBlock(title) {
  const box = document.createElement('section');
  box.className = 'stat-block';
  const h = document.createElement('h3');
  h.textContent = title;
  box.appendChild(h);
  return box;
}

function statFacts(facts) {
  const dl = document.createElement('dl');
  dl.className = 'stat-facts';
  for (const [term, value] of facts) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  return dl;
}

function monthlyCounts(list, months = 6) {
  const now = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const count = list.filter((e) => {
      const x = new Date(e.at);
      return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
    }).length;
    out.push({ label: monthFmt.format(d), count });
  }
  return out;
}

function triggerCounts(list) {
  const tally = new Map();
  for (const e of list) {
    for (const t of e.triggers) tally.set(t, (tally.get(t) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderStats() {
  const box = $('stats');
  const status = $('statsStatus');
  if (!box) return;

  const list = happenedEntries();
  box.textContent = '';

  if (!list.length) {
    if (status) status.textContent = '';
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = entries.length
      ? 'Nothing to summarise yet — every entry is dated in the future.'
      : 'Statistics appear once you have logged an attack.';
    box.appendChild(p);
    return;
  }

  const times = list.map((e) => Date.parse(e.at)).sort((a, b) => a - b);
  const first = times[0];
  const last = times[times.length - 1];
  const sinceLast = daysAgo(new Date(last));

  const sinceText = sinceLast === 0 ? 'today'
    : sinceLast === 1 ? 'yesterday'
    : `${sinceLast} days ago`;
  if (status) status.textContent = ` — last one ${sinceText}`;

  // --- Overview ---------------------------------------------------------
  const facts = [
    ['Logged', `${list.length} ${list.length === 1 ? 'attack' : 'attacks'}`],
    ['Most recent', sinceText],
  ];
  if (list.length >= 2) {
    const gap = (last - first) / (list.length - 1) / 86400000;
    facts.push(['Typical gap', gap < 1
      ? 'under a day'
      : `about ${Math.round(gap) === 1 ? 'a day' : `${Math.round(gap)} days`}`]);
  }
  facts.push(['First logged', fullFmt.format(new Date(first))]);

  const overview = statBlock('Overview');
  overview.appendChild(statFacts(facts));
  box.appendChild(overview);

  // --- By month ---------------------------------------------------------
  const months = monthlyCounts(list);
  const monthPeak = Math.max(...months.map((m) => m.count), 1);
  const byMonth = statBlock('Last six months');
  for (const m of months) {
    byMonth.appendChild(statRow(m.label, String(m.count), m.count / monthPeak));
  }
  box.appendChild(byMonth);

  // --- Triggers ---------------------------------------------------------
  const triggers = triggerCounts(list);
  const byTrigger = statBlock('Most common triggers');
  if (triggers.length) {
    const peak = triggers[0][1];
    for (const [label, count] of triggers.slice(0, 8)) {
      byTrigger.appendChild(statRow(label, String(count), count / peak));
    }
  } else {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'No triggers recorded yet.';
    byTrigger.appendChild(p);
  }
  box.appendChild(byTrigger);

  // --- Intensity --------------------------------------------------------
  const counts = INTENSITIES.map((level) => [
    level, list.filter((e) => e.intensity === level).length,
  ]);
  const unrated = list.filter((e) => !e.intensity).length;
  const intensityPeak = Math.max(...counts.map(([, n]) => n), unrated, 1);

  const byIntensity = statBlock('Intensity');
  for (const [level, n] of counts) {
    byIntensity.appendChild(
      statRow(level, String(n), n / intensityPeak, `--${level.toLowerCase()}`)
    );
  }
  if (unrated) {
    byIntensity.appendChild(statRow('Not rated', String(unrated), unrated / intensityPeak, '--line-strong'));
  }
  box.appendChild(byIntensity);
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

  const nextTriggers = [...customTriggers, label];
  if (!writeJSON(CUSTOM_KEY, nextTriggers)) {
    toast('Could not save the trigger — device storage is full or blocked');
    return;
  }
  customTriggers = nextTriggers;
  refreshAllTriggerRows();

  // Select it straight away in the row it was added from.
  const chip = row.querySelector(`.chip[data-value="${CSS.escape(label)}"]`);
  if (chip) { chip.classList.add('on'); chip.setAttribute('aria-pressed', 'true'); }
}

function removeCustomTrigger(label) {
  const nextTriggers = customTriggers.filter((t) => t !== label);
  if (!writeJSON(CUSTOM_KEY, nextTriggers)) {
    toast('Could not remove the trigger — device storage is full or blocked');
    return;
  }
  customTriggers = nextTriggers;
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
      btn.setAttribute('aria-expanded', String(open));
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
      const updated = {
        ...entry,
        at: date.toISOString(),
        notes: notesInput.value,
        triggers: readChips(li, 'triggers'),
        intensity: readChips(li, 'intensity')[0] || null,
      };
      const nextEntries = entries.map((e) => e.id === id ? updated : e);
      if (!persistEntries(nextEntries)) {
        toast('Could not save — device storage is full or blocked');
        return;
      }
      li.classList.remove('open');
      finishChange('Saved');
      break;
    }

    case 'cancel': {
      li.classList.remove('open');
      li.querySelector('.entry-head').setAttribute('aria-expanded', 'false');
      body.hidden = true;
      break;
    }

    case 'delete': {
      if (!confirm(`Delete the entry from ${describe(new Date(entry.at))}?`)) return;
      if (!persistEntries(entries.filter((e) => e.id !== id))) {
        toast('Could not delete — device storage is full or blocked');
        return;
      }
      finishChange('Entry deleted');
      break;
    }
  }
});

/* ---- Adding ------------------------------------------------------------ */

$('logNow').addEventListener('click', () => {
  const entry = {
    id: uid(), at: new Date().toISOString(), notes: '', triggers: [], intensity: null,
  };
  if (!persistEntries([...entries, entry])) {
    toast('Could not log — device storage is full or blocked');
    return;
  }
  openOnRender = entry.id;
  finishChange('Logged — add details or change the date below');

  const card = list.querySelector(`.entry[data-id="${CSS.escape(entry.id)}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

const statsToggle = $('statsToggle');

statsToggle.addEventListener('click', () => {
  const stats = $('stats');
  const opening = stats.hidden;
  stats.hidden = !opening;
  statsToggle.setAttribute('aria-expanded', String(opening));
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

  // Browsers do not report whether the user ultimately keeps the download, so
  // record this as an export attempt rather than claiming the file was saved.
  const nextMeta = { lastExportAt: new Date().toISOString(), pending: 0 };
  if (!writeJSON(META_KEY, nextMeta)) {
    toast('Export started, but the backup reminder could not be saved');
    return;
  }
  meta = nextMeta;
  renderBackupStatus();
  toast('Export started — check your downloads');
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

    const validRows = incoming.filter(valid);
    const invalid = incoming.length - validRows.length;
    const seen = new Set(entries.map(contentKey));
    const nextEntries = [...entries];
    let added = 0;
    let duplicates = 0;

    for (const raw of validRows) {
      const e = normalise({ ...raw, id: uid(), at: new Date(raw.at).toISOString() });
      const key = contentKey(e);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      nextEntries.push(e);
      added++;
    }

    if (added && !persistEntries(nextEntries)) {
      toast('Could not import — device storage is full or blocked');
      return;
    }

    const parts = [];
    if (added) parts.push(`${added} imported`);
    if (duplicates) parts.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped`);
    if (invalid) parts.push(`${invalid} invalid ${invalid === 1 ? 'record' : 'records'} skipped`);
    const message = parts.length ? parts.join(' · ') : 'The backup contained no entries';

    if (added) {
      finishChange(message, added);
    } else {
      render();
      toast(message);
    }
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
