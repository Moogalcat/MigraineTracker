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

The **Backup & data** heading tells you when the file on disk is out of date:
it shows how many changes you've made since your last export, or when that
export happened. Exporting again clears it.

Deleting an entry removes it from the app immediately, but it cannot change a
backup file you already saved — a web page has no way to edit a file on disk.
So if you import an older backup, anything you deleted since then comes back;
delete it again. In practice this only bites with throwaway test entries, which
are easy to spot and remove.

### Backup file format

A backup is a plain JSON array, easy to read or hand-edit:

```json
[
  { "id": "mty9eksz6g7525", "at": "2026-09-09T12:30:00.000Z", "notes": "..." }
]
```

`at` is always UTC; the app converts to local time for display. `id` is
regenerated on import, so you can safely delete or duplicate entries in the file
by hand. An object of the form `{ "entries": [...] }` is also accepted.

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
