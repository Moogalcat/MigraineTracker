# Migraine Log

A small installable web app (PWA) for logging migraine attacks. Each entry is a
date + time, optional triggers and intensity, and a free-text note. All of it
stays editable forever.

- **One tap to log** — "Log migraine" stamps the current time immediately
  and asks nothing else.
- **The entry opens itself** — the whole editor appears in place, so you can
  fill in what you know now and the rest later without hunting for the entry.
- **Triggers you tap, not type** — twelve common ones built in, plus up to six
  of your own.
- **Intensity afterwards** — you don't know how bad it was until it's over, so
  it's never asked for up front.
- **Any time, any date** — change an entry's date and time to record a past
  attack, or to correct one later.
- **Statistics** — frequency by month, your most common triggers and an
  intensity breakdown, from the entries you already have.
- **Works offline** — once installed it opens with no network at all.
- **Private** — entries live in your browser's `localStorage` on that device.
  Nothing is uploaded, there is no account, and there is no server to trust.

No build step, no dependencies, no framework. Plain HTML, CSS and JavaScript.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and the entry-card template |
| `styles.css` | Styling, light and dark |
| `app.js` | All behaviour: storage, editing, backup |
| `sw.js` | Service worker — the offline cache |
| `manifest.webmanifest` | Makes it installable |
| `icons/` | App icons (generated PNGs) |
| `tools/make-icons.ps1` | Regenerates the icons |
| `_headers`, `robots.txt` | Hosting headers; keeps the site unindexed |

## Run it locally

```bash
python -m http.server 8123 --directory .
```

Then open <http://localhost:8123>. A plain `file://` open will *not* work —
service workers need `http://localhost` or HTTPS.

## Put it online

Service workers require HTTPS, so the app needs hosting. There is no build
step, so any static host works — point it at the repo root.

This repo deploys via **Cloudflare Pages**, which serves a public site from a
*private* GitHub repo on the free plan (GitHub Pages cannot: Pages from a
private repo needs a paid GitHub plan).

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** →
   **Create** → **Pages** → **Connect to Git**.
2. Authorize Cloudflare's GitHub app. Choose *Only select repositories* and
   pick just this one.
3. Select the repo, branch `main`.
4. Build settings: framework preset **None**, build command **empty**, build
   output directory **`/`**.
5. **Save and Deploy.**

The site lands at `https://<project>.pages.dev`, and every `git push` to `main`
redeploys it.

Search engines are asked to stay away three times over, so it works whichever
host you use: a `noindex` meta tag in `index.html` (honoured anywhere),
`robots.txt` (honoured anywhere), and `_headers` setting `X-Robots-Tag`
(**Cloudflare only** — GitHub Pages ignores `_headers` entirely, as it does the
`Cache-Control: no-cache` that file sets on `sw.js`).

None of that is access control — **anyone with the URL can open the app**. It
only keeps it out of search results. The app holds no data of yours on the
server in any case: entries never leave your device.

`.nojekyll` is there only so the repo also works on GitHub Pages unchanged, if
you ever switch.

## Install on your phone

- **iPhone / iPad** — open the URL in **Safari** (not Chrome), tap the Share
  button, then **Add to Home Screen**.
- **Android** — open in Chrome and accept the install prompt, or use
  menu → **Install app** / **Add to Home screen**.

It then launches full-screen with its own icon, like any other app.

## Layout

The page is ordered by how often you need each part:

1. **Log migraine** — the only thing that matters mid-attack, so it is
   first and is a single tap.
2. **The log itself** — newest first. A new entry arrives already open, with
   its date, triggers, intensity and notes all editable in place; tap any
   older entry to open it the same way.
3. **Statistics** — a button that reveals the summary below it.
4. **Backup & data** — last, since it is the least frequently needed.

There is no separate "add a past entry" form. A past attack is just a normal
entry with its date changed, and because a new entry opens with its date field
right there, that takes the same number of taps a dedicated form would — with
one screen to learn instead of two.

Logging is committed the instant you tap, before the editor opens. **Cancel**
therefore discards your unsaved edits but keeps the entry; it is not an undo
for the log itself. That is deliberate — an entry should never be lost because
the app closed mid-typing. Delete an unwanted entry with **Delete**.

### Statistics

A button rather than a disclosure, carrying the useful headline in its own
label (`Statistics — last one 6 days ago`). Pressing it reveals four blocks:

| Block | Shows |
| --- | --- |
| Overview | How many logged, how long since the last one, typical gap between attacks, date first logged |
| Last six months | A count per month, as a bar |
| Most common triggers | Your triggers ranked by frequency, top eight |
| Intensity | Mild / Moderate / Severe counts, plus how many are unrated, in the severity colours |

Like the header counts, statistics describe **what has happened** — entries
dated in the future are excluded. "Typical gap" is the mean interval between
consecutive attacks and needs at least two entries, so it is omitted for a
single one. It is a plain average, not a prediction.

There is deliberately no trigger-correlation analysis. With a few dozen
entries, naive correlation reliably invents patterns that are not there, and a
health diary that fabricates triggers is worse than one that just shows you
the data.

## What the header counts

Both totals count only entries that have actually happened — anything dated in
the future is excluded from each. If an entry is future-dated (usually a
mistyped date) the header says so explicitly, e.g.
`0 entries this month — 0 in the last 90 days · 1 dated in the future`, so a
typo cannot quietly disappear from the counts while its card sits in the list.

## Triggers and intensity

The built-in trigger list is the twelve most commonly reported ones:

> Stress · Poor sleep · Skipped meal · Dehydration · Alcohol · Caffeine ·
> Hormonal · Bright light · Strong smell · Weather · Screen time · Neck tension

Twelve is roughly the limit of what anyone will read while recovering from an
attack, so the list is deliberately short. **+ Add your own** takes up to six
more (`MAX_CUSTOM_TRIGGERS` in `app.js`), kept in `migraine-log-triggers-v1`.
Anything that doesn't fit belongs in the notes.

Removing one of your own triggers only stops it being offered — entries that
already carry that label keep it, and it reappears as a chip whenever such an
entry is open. Deleting a trigger never rewrites history.

Intensity is **Mild / Moderate / Severe**, single-choice, and tapping the
current one clears it. It is intentionally absent from the one-tap path.

To change either list, edit `BUILT_IN_TRIGGERS` or `INTENSITIES` at the top of
`app.js`. Entries store trigger labels as plain strings, so renaming a built-in
does not affect entries already saved with the old label.

## Backups matter

Because the data lives only in the browser, it goes away if you delete the app,
clear site data, or reset the phone — and it does not sync between devices. Open
**Backup & data** now and then and tap **Export backup** to save a JSON file.
**Import backup** merges a file back in, skipping entries it already has, so you
can also use export/import to move your history to another device.

Every export writes a **new file**, named for the moment you made it, e.g.
`migraine-log-2026-09-12-13-13.json`. It does not overwrite the previous one —
a web page cannot overwrite a file on disk, and a browser download that clashes
with an existing name just gets ` (1)` appended. So your Downloads folder
accumulates snapshots. The names sort chronologically, so the newest one is
always the last in the list, and that is the one to keep and to import.

The **Backup & data** heading tells you when your latest export attempt is out of date:
it shows how many changes you've made since the last one, or when it happened.
Exporting again clears it.

Browsers do not tell a page whether you ultimately kept or cancelled a
download. For that reason the app says **export started** and asks you to check
your Downloads folder; it does not claim that the file was saved successfully.

Deleting an entry removes it from the app immediately, but it cannot change a
backup file you already saved — a web page has no way to edit a file on disk.
So if you import an older backup, anything you deleted since then comes back;
delete it again. In practice this only bites with throwaway test entries, which
are easy to spot and remove.

### Backup file format

A backup is a plain JSON array, easy to read or hand-edit:

```json
[
  {
    "id": "mty9eksz6g7525",
    "at": "2026-09-09T12:30:00.000Z",
    "triggers": ["Stress", "Poor sleep"],
    "intensity": "Severe",
    "notes": "..."
  }
]
```

`at` is always UTC; the app converts to local time for display. `id` is
regenerated on import, so you can safely delete or duplicate entries in the file
by hand. An object of the form `{ "entries": [...] }` is also accepted, and
older backups without `triggers` or `intensity` import fine — they come in with
no triggers and no intensity set.

After an import, the confirmation reports imported entries, exact duplicates,
and invalid records separately. A damaged record is never silently treated as
successfully imported.

## Reliability and accessibility

Storage writes are checked before the interface reports an entry as logged,
saved, deleted, or imported. If browser storage is full or blocked, the app
keeps the previous on-screen and stored state and shows an error instead of a
false success message. Entry data and the backup reminder are stored
separately; if only the reminder fails, the message says so explicitly.

Trigger and intensity choices are labelled as control groups, repeated entry
fields receive unique accessible labels, and expandable rows expose their open
or closed state. Interactive targets are at least 44 pixels high for easier use
on a phone and during an attack.

## Visual design

The interface uses a quiet logbook vocabulary: warm paper tones in light mode,
near-black neutral tones in dark mode, restrained terracotta accents, ruled
entry rows, and a serif title. Pills, gradients, and stacked floating cards are
deliberately avoided. Severity appears as a small edge marker rather than a
large coloured surface, keeping the screen calm for light-sensitive users.

The app icon follows the same system: a simple paper log, accent spine, and
three written lines. `tools/make-icons.ps1` is the source for all icon sizes.

## Changing the app

Edit the files and reload. One thing to remember: when you change
`index.html`, `styles.css` or `app.js`, bump the `CACHE` constant at the top of
`sw.js`. That is what tells installed copies to throw away the old cached files
and pick up the new ones.

The worker precaches the shell with `cache: 'reload'` so each request goes past
the HTTP cache. Without that, a worker installing shortly after a deploy can
precache the *previous* page — GitHub Pages serves HTML with `max-age=600`, so
the browser may still hold a fresh-enough copy of the old file — and then pin
it for the life of that cache version. Navigations are also revalidated in the
background, so a stale shell heals on the next launch rather than waiting for
another version bump.

Because the shell is served cache-first, the first launch after a deploy still
shows the previous version; the one after it is current.

The icons are generated, not hand-drawn. To change the colours or the glyph,
edit `tools/make-icons.ps1` and re-run it:

```bash
powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
```

Or just replace the PNGs in `icons/` with your own at the same sizes.
