/* Migraine Log — all data stays in this browser's localStorage. */
'use strict';

if (window.navigator && window.navigator.standalone === true && document.documentElement) {
  document.documentElement.classList.add('standalone');
}

const LEGACY_KEY = 'migraine-log-v1';
const KEY = 'migraine-log-v2';
const DRAFT_PREFIX = 'migraine-log-draft-v1:';
const META_KEY = 'migraine-log-meta-v1';
const CUSTOM_KEY = 'migraine-log-triggers-v1';

// The best-documented common triggers. Twelve is about as many as anyone will
// actually read while recovering from an attack.
const BUILT_IN_TRIGGERS = [
  'Stress', 'Poor sleep', 'Skipped meal', 'Dehydration',
  'Alcohol', 'Caffeine', 'Hormonal', 'Bright light',
  'Strong smell', 'Weather', 'Screen time', 'Neck tension',
];

const INTENSITIES = LogData.ratings;

// "A few" slots of your own, on top of the built-in list.
const MAX_CUSTOM_TRIGGERS = 6;

const $ = (id) => document.getElementById(id);
const list = $('list');
const tpl = $('entryTpl');

let storageBlocked = false;
let lastRaw = null;
let state = loadState();
let entries = state.entries;
let meta = loadMeta();
const INITIAL_VISIBLE = 5;
const HISTORY_BATCH = 10;
let visibleCount = INITIAL_VISIBLE;
let firstRender = true;
const drafts = new Map();
loadDrafts();

// Entry id to open on the next render - a freshly logged entry shows its whole
// editor rather than making you tap to open it.
let openOnRender = null;
// Entries logged in this session remain cancellable until their first save.
// They are still written immediately, so an app close cannot lose the timestamp.
const freshEntryIds = new Set();
let customTriggers = state.customTriggers;

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

function loadState() {
  try {
    lastRaw = localStorage.getItem(KEY);
    let loaded;
    if (lastRaw !== null) loaded = LogData.parse(JSON.parse(lastRaw), true);
    else {
      const legacy = localStorage.getItem(LEGACY_KEY);
      const triggers = localStorage.getItem(CUSTOM_KEY);
      loaded = LogData.parse({ entries: legacy === null ? [] : JSON.parse(legacy),
        customTriggers: triggers === null ? [] : JSON.parse(triggers) }, true);
    }
    storageBlocked = false;
    loaded.entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { version: 2, entries: loaded.entries, customTriggers: loaded.customTriggers, preferences: loaded.preferences, deletedIds: loaded.deletedIds };
  } catch (err) {
    console.error('Saved data left untouched', err);
    storageBlocked = true;
    return LogData.empty();
  }
}

const normalise = LogData.normalise;
function loadDrafts() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(DRAFT_PREFIX)) continue;
      const draft = JSON.parse(localStorage.getItem(key));
      if (!draft || !draft.values || typeof draft.values.at !== 'string'
        || typeof draft.base !== 'string' || typeof draft.values.notes !== 'string'
        || !Array.isArray(draft.values.triggers) || !draft.values.triggers.every(t => typeof t === 'string')
        || !['auraIntensity', 'headacheIntensity'].every(k => draft.values[k] == null
          || k in draft.values && ['None', ...INTENSITIES].includes(draft.values[k]))) {
        throw new Error('Unreadable draft');
      }
      draft.values.auraIntensity = INTENSITIES.includes(draft.values.auraIntensity)
        ? draft.values.auraIntensity : null;
      draft.values.headacheIntensity = INTENSITIES.includes(draft.values.headacheIntensity)
        ? draft.values.headacheIntensity : null;
      try {
        const base = JSON.parse(draft.base);
        if (Array.isArray(base) && base.length === 7) {
          draft.base = JSON.stringify([
            base[0], base[2] === 'None' ? null : base[2],
            base[3] === 'None' ? null : base[3], base[4], base[5],
          ]);
        }
      } catch { throw new Error('Unreadable draft base'); }
      delete draft.values.endedAt;
      delete draft.values.medication;
      drafts.set(key.slice(DRAFT_PREFIX.length), draft);
    }
  } catch (err) {
    // Never replace an unreadable draft silently. Recovery download includes it.
    storageBlocked = true;
    console.error(err);
  }
}

// Remembers when you last exported, and how many edits you've made since.
function loadMeta() {
  const m = readJSON(META_KEY, {});
  return {
    lastExportAt: m && typeof m.lastExportAt === 'string' && Number.isFinite(Date.parse(m.lastExportAt)) ? m.lastExportAt : null,
    pending: m && Number.isFinite(m.pending) ? Math.max(0, m.pending) : 0,
  };
}

const valid = LogData.valid;

function persistState(next, recovering = false) {
  if (storageBlocked && !recovering) return false;
  try {
    if (!recovering && localStorage.getItem(KEY) !== lastRaw) {
      showError('Your log changed in another tab. Reload this page before saving; your local draft is kept.');
      return false;
    }
    const saved = { version: 2, entries: [...next.entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      customTriggers: next.customTriggers, preferences: next.preferences, deletedIds: next.deletedIds };
    const raw = JSON.stringify(saved);
    localStorage.setItem(KEY, raw);
    lastRaw = raw;
    state = saved;
    entries = saved.entries;
    customTriggers = saved.customTriggers;
    storageBlocked = false;
    $('appError').hidden = true;
    return true;
  } catch (err) { console.error(err); return false; }
}

function persistEntries(nextEntries, deletedId) {
  return persistState({ ...state, entries: nextEntries,
    deletedIds: deletedId ? [...new Set([...state.deletedIds, deletedId])] : state.deletedIds });
}

// Call after any edit, so the backup status can flag a stale export file.
function markChanged(n = 1) {
  const nextMeta = { ...meta, pending: Math.max(0, meta.pending + n) };
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

const uid = LogData.uid;
const contentKey = LogData.contentKey;

/* ---- Date helpers ------------------------------------------------------ */

// <input type="datetime-local"> wants local wall-clock "YYYY-MM-DDTHH:mm".
function toInput(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
         `T${p(date.getHours())}:${p(date.getMinutes())}`;
}

// Caps the date picker at the present moment: a migraine cannot be in the
// future, and the browser's own picker honours `max`.
function capAtNow(input) {
  input.max = toInput(new Date());
}

// Read back as local time, then stored as an ISO (UTC) string.
const fromInput = LogData.fromInput;

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

function draftValues(li) {
  const value = field => li.querySelector(`[data-field="${field}"]`).value;
  return { at: value('at'), notes: value('notes'),
    triggers: readChips(li, 'triggers'), auraIntensity: readChips(li, 'auraIntensity')[0] || null,
    headacheIntensity: readChips(li, 'headacheIntensity')[0] || null };
}

function rememberDraft(li) {
  if (!li) return;
  const entry = entries.find(e => e.id === li.dataset.id);
  if (!entry) return;
  const previous = drafts.get(entry.id);
  const draft = { base: previous?.base || contentKey(entry), values: draftValues(li) };
  drafts.set(entry.id, draft);
  const kept = !storageBlocked && writeJSON(DRAFT_PREFIX + entry.id, draft);
  draft.stored = kept;
  if (!kept) showError('Could not keep this draft. Leave this page open and copy your details before closing it.', li);
}

function clearDraft(id) {
  drafts.delete(id);
  try { localStorage.removeItem(DRAFT_PREFIX + id); }
  catch { showError('Saved data is safe, but an old draft could not be cleared from device storage.'); }
}

function fillEditor(li, entry) {
  const draft = drafts.get(entry.id);
  const values = draft?.values || { ...entry, at: toInput(new Date(entry.at)) };
  for (const field of ['at', 'notes']) li.querySelector(`[data-field="${field}"]`).value = values[field] || '';
  capAtNow(li.querySelector('[data-field="at"]'));
  fillChips(li, values);
}

function render() {
  const openIds = new Set([...list.querySelectorAll('.entry.open')].map(li => li.dataset.id));
  const errors = new Map([...list.querySelectorAll('.entry')].map(li => [li.dataset.id, li.querySelector('.entry-error').textContent]));
  if (openOnRender) { openIds.add(openOnRender); openOnRender = null; }
  list.textContent = '';
  let lastYear = '';
  for (const [index, entry] of entries.slice(0, visibleCount).entries()) {
    const date = new Date(entry.at);
    const year = String(date.getFullYear());
    if (year !== lastYear) {
      const row = document.createElement('li'); row.className = 'year-heading';
      const heading = document.createElement('h2'); heading.textContent = year;
      row.appendChild(heading); list.appendChild(row); lastYear = year;
    }
    const li = tpl.content.firstElementChild.cloneNode(true);
    const head = li.querySelector('.entry-head'), body = li.querySelector('.entry-body');
    li.dataset.id = entry.id;
    const overall = strongestIntensity(entry);
    if (overall) li.classList.add(`severity-${overall.toLowerCase()}`);
    const bodyId = `entry-body-${index}`; body.id = bodyId;
    head.setAttribute('aria-controls', bodyId);
    for (const field of ['at', 'notes']) {
      const input = li.querySelector(`[data-field="${field}"]`);
      input.id = `entry-${field}-${index}`;
      li.querySelector(`.entry-${field}-label`).htmlFor = input.id;
    }
    li.querySelector('.entry-when').textContent = describe(date);
    li.querySelector('.entry-notes').textContent = entry.notes.trim();
    renderEntryMeta(li.querySelector('.entry-meta'), entry);
    fillEditor(li, entry);
    if (freshEntryIds.has(entry.id)) {
      const cancel = li.querySelector('[data-act="cancel"]');
      cancel.textContent = 'Discard'; cancel.classList.replace('btn-ghost', 'btn-danger');
      li.querySelector('[data-act="delete"]').hidden = true;
    }
    const open = openIds.has(entry.id) || (firstRender && drafts.has(entry.id));
    li.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open)); body.hidden = !open;
    if (errors.get(entry.id)) showError(errors.get(entry.id), li);
    list.appendChild(li);
  }
  firstRender = false;
  $('empty').hidden = entries.length > 0 || storageBlocked;
  $('recovery').hidden = !storageBlocked;
  $('logNow').disabled = storageBlocked;
  $('exportBtn').disabled = storageBlocked;
  $('theme').disabled = storageBlocked;
  const remaining = Math.max(0, entries.length - visibleCount);
  const nextCount = Math.min(HISTORY_BATCH, remaining);
  $('showOlder').hidden = remaining === 0;
  $('showOlder').textContent = `Show ${nextCount} older ${nextCount === 1 ? 'entry' : 'entries'} (${remaining} remaining)`;
  renderTally(); renderStats(); renderBackupStatus();
}

list.addEventListener('input', ev => rememberDraft(ev.target.closest('.entry')));
$('showOlder').addEventListener('click', () => { visibleCount += HISTORY_BATCH; render(); });

// The badge and trigger list shown on the collapsed card.
function renderEntryMeta(el, entry) {
  el.textContent = '';

  for (const [label, intensity] of [
    ['Aura', entry.auraIntensity],
    ['Headache', entry.headacheIntensity],
  ]) {
    if (!intensity) continue;
    const badge = document.createElement('span');
    badge.className = `badge badge-${intensity.toLowerCase()}`;
    badge.textContent = `${label} ${intensity}`;
    el.appendChild(badge);
  }

  if (entry.triggers.length) {
    const t = document.createElement('span');
    t.textContent = entry.triggers.join(' · ');
    el.appendChild(t);
  }
}

function strongestIntensity(entry) {
  const levels = [entry.auraIntensity, entry.headacheIntensity]
    .map((value) => INTENSITIES.indexOf(value));
  const strongest = Math.max(...levels);
  return strongest >= 0 ? INTENSITIES[strongest] : null;
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
    const first = list.length ? new Date(Math.min(...list.map(e => Date.parse(e.at)))) : now;
    const before = d < new Date(first.getFullYear(), first.getMonth(), 1);
    out.push({ label: monthFmt.format(d) + (i === 0 ? ' (so far)' : ''), count, before });
  }
  return out;
}

function yearlyCounts(list) {
  const tally = new Map();
  for (const entry of list) {
    const year = new Date(entry.at).getFullYear();
    tally.set(year, (tally.get(year) || 0) + 1);
  }
  return [...tally.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, count]) => ({ label: String(year), count }));
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
    facts.push(['Average gap', gap < 1
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
    const row = statRow(m.label, m.before ? '—' : String(m.count), m.before ? 0 : m.count / monthPeak);
    if (m.before) { row.classList.add('before-records'); row.setAttribute('aria-label', `${m.label}: before first record`); }
    byMonth.appendChild(row);
  }
  const explanation = document.createElement('p'); explanation.className = 'note';
  explanation.textContent = '— means before your first record. Counts describe logged entries; an empty month does not establish that no attacks occurred.';
  byMonth.appendChild(explanation);
  box.appendChild(byMonth);

  // Avoid a redundant one-row chart until the log spans two calendar years.
  const years = yearlyCounts(list);
  if (years.length > 1) {
    const yearPeak = Math.max(...years.map((year) => year.count), 1);
    const byYear = statBlock('By year');
    for (const year of years) {
      byYear.appendChild(statRow(year.label, String(year.count), year.count / yearPeak));
    }
    box.appendChild(byYear);
  }

  // --- Triggers ---------------------------------------------------------
  const triggers = triggerCounts(list);
  const byTrigger = statBlock('Most recorded possible triggers');
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

  appendIntensityStats(box, list, 'Aura intensity', 'auraIntensity');
  appendIntensityStats(box, list, 'Headache intensity', 'headacheIntensity');
}

function appendIntensityStats(box, list, title, field) {
  const counts = INTENSITIES.map((level) => [level, list.filter((e) => e[field] === level).length]);
  const unrated = list.filter((e) => !e[field]).length;
  const intensityPeak = Math.max(...counts.map(([, n]) => n), unrated, 1);

  const byIntensity = statBlock(title);
  for (const [level, n] of counts) {
    byIntensity.appendChild(
      statRow(level, String(n), n / intensityPeak, `--${level.toLowerCase()}`)
    );
  }
  if (unrated) {
    byIntensity.appendChild(statRow('Not recorded', String(unrated), unrated / intensityPeak, '--line-strong'));
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
  const intensity = row.dataset.chips !== 'triggers';
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
  const aura = scope.querySelector('[data-chips="auraIntensity"]');
  const headache = scope.querySelector('[data-chips="headacheIntensity"]');
  if (t) renderChips(t, entry.triggers || []);
  if (aura) renderChips(aura, entry.auraIntensity ? [entry.auraIntensity] : []);
  if (headache) renderChips(headache, entry.headacheIntensity ? [entry.headacheIntensity] : []);
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
  if (!persistState({ ...state, customTriggers: nextTriggers })) {
    toast('Could not save the trigger — device storage is full or blocked');
    return;
  }
  customTriggers = nextTriggers;
  markChanged();
  refreshAllTriggerRows();

  // Select it straight away in the row it was added from.
  const chip = row.querySelector(`.chip[data-value="${CSS.escape(label)}"]`);
  if (chip) { chip.classList.add('on'); chip.setAttribute('aria-pressed', 'true'); }
}

function removeCustomTrigger(label) {
  const nextTriggers = customTriggers.filter((t) => t !== label);
  if (!persistState({ ...state, customTriggers: nextTriggers })) {
    toast('Could not remove the trigger — device storage is full or blocked');
    return;
  }
  customTriggers = nextTriggers;
  markChanged();
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

  // Each intensity row is single-choice; tapping its current value clears it.
  if (row.dataset.chips !== 'triggers') {
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
  const editedCard = ev.target.closest('.entry');
  if (handleChipClick(ev)) { rememberDraft(editedCard); return; }

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
      if (open) capAtNow(atInput);
      break;
    }

    case 'save': {
      const date = fromInput(atInput.value);
      if (!date) {
        showError('Please pick a valid date and time.', li);
        atInput.focus();
        return;
      }
      if (date.getTime() > Date.now()) {
        showError('That is in the future — pick a time up to now.', li);
        atInput.focus();
        return;
      }
      const draft = drafts.get(id);
      if (draft && draft.base !== contentKey(entry)) {
        showError('The saved entry changed since this draft began. Copy any details you need, then Cancel to view the saved version before editing again.', li); return;
      }
      const updated = {
        ...entry,
        updatedAt: new Date().toISOString(),
        at: date.toISOString(),
        notes: notesInput.value,
        triggers: readChips(li, 'triggers'),
        auraIntensity: readChips(li, 'auraIntensity')[0] || null,
        headacheIntensity: readChips(li, 'headacheIntensity')[0] || null,
      };
      const nextEntries = entries.map((e) => e.id === id ? updated : e);
      if (!persistEntries(nextEntries)) {
        showError('Could not save — device storage is full, blocked, or changed in another tab. Your draft remains open.', li);
        return;
      }
      freshEntryIds.delete(id);
      clearDraft(id);
      li.querySelector('.entry-error').textContent = '';
      li.classList.remove('open');
      visibleCount = Math.max(visibleCount, entries.findIndex(e => e.id === id) + 1);
      finishChange('Saved');
      list.querySelector(`.entry[data-id="${CSS.escape(id)}"] .entry-head`)?.focus({ preventScroll: true });
      break;
    }

    case 'cancel': {
      if (freshEntryIds.has(id)) {
        if (!persistEntries(entries.filter((e) => e.id !== id), id)) {
          toast('Could not discard — device storage is full or blocked');
          return;
        }
        freshEntryIds.delete(id);
        clearDraft(id);
        finishChange('Entry discarded', -1);
        $('logNow').focus({ preventScroll: true });
        return;
      }
      clearDraft(id);
      fillEditor(li, entry);
      li.querySelector('.entry-error').textContent = '';
      li.querySelector('.entry-error').hidden = true;
      li.classList.remove('open');
      li.querySelector('.entry-head').setAttribute('aria-expanded', 'false');
      body.hidden = true;
      li.querySelector('.entry-head').focus({ preventScroll: true });
      break;
    }

    case 'delete': {
      if (!confirm(`Delete the entry from ${describe(new Date(entry.at))}?`)) return;
      const wasFresh = freshEntryIds.has(id);
      if (!persistEntries(entries.filter((e) => e.id !== id), id)) {
        toast('Could not delete — device storage is full or blocked');
        return;
      }
      freshEntryIds.delete(id);
      clearDraft(id);
      finishChange('Entry deleted', wasFresh ? -1 : 1);
      $('logNow').focus({ preventScroll: true });
      break;
    }
  }
});

/* ---- Adding ------------------------------------------------------------ */

$('logNow').addEventListener('click', () => {
  const entry = {
    id: uid(), at: new Date().toISOString(), updatedAt: new Date().toISOString(), notes: '', triggers: [],
    auraIntensity: null, headacheIntensity: null,
  };
  if (!persistEntries([...entries, entry])) {
    toast('Could not log — device storage is full or blocked');
    return;
  }
  freshEntryIds.add(entry.id);
  openOnRender = entry.id;
  visibleCount = Math.max(INITIAL_VISIBLE, visibleCount, entries.findIndex(e => e.id === entry.id) + 1);
  finishChange('Logged');

  const card = list.querySelector(`.entry[data-id="${CSS.escape(entry.id)}"]`);
  if (card) card.querySelector('.entry-head').focus({ preventScroll: true });
});

/* ---- Backup ------------------------------------------------------------ */

function downloadJSON(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('exportBtn').addEventListener('click', () => {
  if (storageBlocked) return;
  const stamp = toInput(new Date()).replace(/[:T]/g, '-');
  downloadJSON({ ...state, exportedAt: new Date().toISOString() }, `migraine-log-${stamp}.json`);
  const nextMeta = { lastExportAt: new Date().toISOString(), pending: 0 };
  if (!writeJSON(META_KEY, nextMeta)) { showError('Export started, but the backup reminder could not be saved.'); return; }
  meta = nextMeta; renderBackupStatus(); toast('Export started — check your downloads. Drafts are not included.');
});

function recoveryCopy() {
  const raw = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('migraine-log') && !key.startsWith('migraine-log-recovery-')) raw[key] = localStorage.getItem(key);
  }
  return { recoveredAt: new Date().toISOString(), raw };
}
$('recoveryExport').addEventListener('click', () => {
  try { downloadJSON(recoveryCopy(), `migraine-log-recovery-${Date.now()}.json`); toast('Recovery download started — check your downloads.'); }
  catch { showError('Browser storage cannot be read. Keep this page open and try allowing site storage before retrying.'); }
});
$('recoveryRetry').addEventListener('click', () => location.reload());
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async ev => {
  const file = ev.target.files?.[0]; ev.target.value = '';
  if (!file) return;
  const resultBox = $('importResult');
  let changed = false;
  try {
    const incoming = LogData.parse(JSON.parse(await file.text()));
    if (storageBlocked) {
      if (incoming.invalid || !incoming.entries.length) throw new Error('Recovery requires a backup with readable entries and no invalid records.');
      if (!confirm('Restore this backup as your log? The unreadable data and drafts will first be preserved in a separate recovery copy on this device.')) return;
      const recovery = recoveryCopy();
      if (!writeJSON(`migraine-log-recovery-${Date.now()}`, recovery)) throw new Error('Could not preserve the original data. Download a recovery copy and free device storage before trying again.');
      if (!persistState(incoming, true)) throw new Error('Could not restore. The original data is preserved; check device storage.');
      for (const key of Object.keys(recovery.raw)) if (key.startsWith(DRAFT_PREFIX)) localStorage.removeItem(key);
      drafts.clear();
      changed = true;
      resultBox.textContent = `Restored ${entries.length} entries. The original data is retained in a recovery copy on this device.`;
    } else {
      const { state: merged, result } = LogData.merge(state, incoming);
      merged.entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      changed = JSON.stringify(state) !== JSON.stringify(merged);
      if (changed && !persistState(merged)) throw new Error('Could not import. Device storage may be full, blocked, or changed in another tab.');
      const parts = [`${result.added} imported`, `${result.updated} updated`];
      if (result.duplicates) parts.push(`${result.duplicates} exact duplicates skipped`);
      if (result.conflicts) parts.push(`${result.conflicts} older or undated conflicts kept as local entries`);
      if (result.deleted) parts.push(`${result.deleted} previously deleted entries skipped`);
      if (result.invalid) parts.push(`${result.invalid} invalid records skipped`);
      resultBox.textContent = parts.join(' · ') + '.';
    }
    resultBox.classList.remove('error'); resultBox.hidden = false;
    applyTheme(); if (changed) markChanged(); render();
  } catch (err) {
    resultBox.textContent = `Import stopped: ${err.message}`;
    resultBox.classList.add('error'); resultBox.hidden = false;
  }
});

/* ---- Appearance and print summary -------------------------------------- */
function applyTheme() {
  const theme = state.preferences.theme;
  document.documentElement.dataset.theme = theme;
  $('theme').value = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) tag.content = dark ? '#1b1e20' : '#eceae5';
}
$('theme').addEventListener('change', () => {
  if (!persistState({ ...state, preferences: { theme: $('theme').value } })) {
    $('theme').value = state.preferences.theme; showError('Could not save appearance. Check device storage.'); return;
  }
  applyTheme(); markChanged();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

$('reportMonth').value = toInput(new Date()).slice(0, 7);
$('reportMonth').max = toInput(new Date()).slice(0, 7);
$('reportPeriod').addEventListener('change', () => { $('reportMonthRow').hidden = $('reportPeriod').value !== 'month'; });
function buildPrintSummary() {
  const period = $('reportPeriod').value, month = $('reportMonth').value;
  const rows = LogData.reportEntries(entries, period, month);
  if (!rows || (period === 'month' && month > toInput(new Date()).slice(0, 7))) {
    $('reportError').textContent = 'Choose a valid month up to this month.'; $('reportError').hidden = false; return false;
  }
  $('reportError').hidden = true;
  const root = $('printSummary'); root.textContent = '';
  const add = (parent, tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; parent.appendChild(el); return el; };
  add(root, 'h1', 'Migraine Log');
  const label = period === 'month' ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00`)) : 'Last 90 days';
  add(root, 'p', `${label} · Prepared ${fullFmt.format(new Date())}`);
  const rated = field => rows.filter(e => e[field] != null).length;
  add(root, 'p', `${rows.length} logged ${rows.length === 1 ? 'entry' : 'entries'} · Aura recorded: ${rated('auraIntensity')} · Headache recorded: ${rated('headacheIntensity')}`);
  add(root, 'p', 'Personal record of saved entries. Blank fields mean not recorded; gaps do not establish symptom-free days. Drafts are excluded.');
  if (!rows.length) add(root, 'p', 'No saved entries in this period.');
  for (const e of rows) {
    const article = add(root, 'article', '', 'print-entry');
    add(article, 'h2', `${fullFmt.format(new Date(e.at))}, ${timeFmt.format(new Date(e.at))}`);
    add(article, 'p', `Aura: ${e.auraIntensity || 'Not recorded'} · Headache: ${e.headacheIntensity || 'Not recorded'}`);
    if (e.triggers.length) add(article, 'p', `Possible triggers: ${e.triggers.join(', ')}`);
    if (e.notes) add(article, 'p', e.notes);
  }
  return true;
}
$('printReport').addEventListener('click', () => { if (buildPrintSummary()) window.print(); });
window.addEventListener('beforeprint', buildPrintSummary);

/* ---- Toast ------------------------------------------------------------- */

let toastTimer;
function showError(message, li) {
  const el = li ? li.querySelector('.entry-error') : $('appError');
  el.textContent = message; el.hidden = false;
}
function toast(msg) {
  if (/^(Could not|That file|Please pick|That is in the future)/.test(msg)) { showError(msg); return; }
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---- Boot -------------------------------------------------------------- */

applyTheme();
// A restored draft must be reachable even if its entry is older than page one.
for (const id of drafts.keys()) visibleCount = Math.max(visibleCount, entries.findIndex(e => e.id === id) + 1);
render();

// Keep the "Today / Yesterday" labels honest if the app sits open past midnight.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    renderTally(); renderStats(); renderBackupStatus();
    for (const li of list.querySelectorAll('.entry')) {
      const e = entries.find(e => e.id === li.dataset.id);
      if (e) li.querySelector('.entry-when').textContent = describe(new Date(e.at));
      for (const input of li.querySelectorAll('input[type="datetime-local"]')) capAtNow(input);
    }
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) =>
      console.warn('Service worker registration failed', err)
    );
  });
}
