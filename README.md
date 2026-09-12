# Migraine Log

A small installable web app (PWA) for logging migraine attacks. Each entry is a
date + time and a free-text note. Both stay editable forever.

- **One tap to log** — "Log migraine now" stamps the current time immediately;
  add notes whenever you feel up to it.
- **Any time, any date** — backdate an entry, or correct the time later.
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

`_headers` sets `X-Robots-Tag: noindex` site-wide and `Cache-Control: no-cache`
on `sw.js`; `robots.txt` disallows crawlers. Note that neither is access
control — **anyone with the URL can open the app**. They only keep it out of
search results. The app holds no data of yours on the server in any case:
entries never leave your device.

`.nojekyll` is there only so the repo also works on GitHub Pages unchanged, if
you ever switch.

## Install on your phone

- **iPhone / iPad** — open the URL in **Safari** (not Chrome), tap the Share
  button, then **Add to Home Screen**.
- **Android** — open in Chrome and accept the install prompt, or use
  menu → **Install app** / **Add to Home screen**.

It then launches full-screen with its own icon, like any other app.

## Backups matter

Because the data lives only in the browser, it goes away if you delete the app,
clear site data, or reset the phone — and it does not sync between devices. Open
**Backup & data** now and then and tap **Export backup** to save a JSON file.
**Import backup** merges a file back in, skipping entries it already has, so you
can also use export/import to move your history to another device.

The **Backup & data** heading shows how many changes you've made since your last
export, so you can see at a glance when the file on disk is out of date.

### How deletions are handled

A web page cannot reach into a file you already saved and edit it. So a deletion
cannot rewrite an exported backup — you have to export again, which is what the
"N changes not in your backup file" counter is nudging you to do.

What the app does guarantee:

- A **new export contains no trace of a deleted entry** — not its notes, not its
  timestamp.
- The **deleted entry's notes are not kept anywhere** on the device.
- **Deletions stick.** The app records the deleted entry's id and timestamp in
  `migraine-log-deleted-v1`, and importing a backup made *before* the deletion
  will not bring the entry back. The toast tells you when entries were skipped
  for this reason. Matching is by id *or* timestamp, so it still holds if the
  notes or the id in the old file differ.

The one case this cannot cover is hand-editing a backup to change both the id
and the timestamp of a deleted entry — then it looks like a new entry, and it
will import.

### Backup file format

```json
{
  "format": "migraine-log",
  "version": 2,
  "exportedAt": "2026-09-12T10:45:00.000Z",
  "entries": [
    { "id": "mty9eksz6g7525", "at": "2026-09-09T12:30:00.000Z", "notes": "..." }
  ]
}
```

`at` is always UTC; the app converts to local time for display. Older backups
that were a bare JSON array of entries still import fine.

## Changing the app

Edit the files and reload. One thing to remember: when you change
`index.html`, `styles.css` or `app.js`, bump the `CACHE` constant at the top of
`sw.js` (e.g. `migraine-log-v2`). That is what tells installed copies to throw
away the old cached files and pick up the new ones.

The icons are generated, not hand-drawn. To change the colours or the glyph,
edit `tools/make-icons.ps1` and re-run it:

```bash
powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
```

Or just replace the PNGs in `icons/` with your own at the same sizes.
