# Migraine Log

A small installable web app for a private migraine diary. One tap records the
current time; every other detail is optional and can be edited later.

- **Quick logging:** the timestamp is committed immediately and the editor opens.
- **Recoverable drafts:** unfinished dates, ratings, triggers and notes
  are kept on this device as you edit, separately from the saved log. Drafts survive
  collapsing a row, logging another attack, changing tabs and reloading.
- **Separate ratings:** aura and headache each offer Mild / Moderate / Severe.
- **Possible triggers:** all trigger choices remain visible in the editor. There
  are twelve built-in triggers and up to six new custom labels. Imported labels
  are preserved even when they exceed that limit.
- **History:** entries are grouped by year, newest first. The latest five appear
  initially; Show older reveals another ten. A recovered older draft is brought
  into view even if that requires showing more history initially.
- **Statistics:** counts, average gap, monthly/yearly totals, recorded possible
  triggers, and separate rating breakdowns. The current month says “so far”; a
  dash means the month precedes the first record. Missing records do not establish
  attack-free days, and trigger frequency does not establish causation.
- **Print summary:** choose the last 90 calendar days (including today) or a month
  in Statistics, then print or use the browser's Save as PDF option. Reports include
  saved entries, ratings, possible triggers and notes.
- **Appearance:** choose System, Light or Dark independently of the device setting.
- **Offline:** the service worker caches the complete app after the first visit.
- **Private by default:** data stays in this browser unless you choose to sign in
  and sync. Optional Firebase sync keeps each account's records separate. Exports
  and printed summaries contain your diary data.

No build step or framework. Plain HTML, CSS and JavaScript, with pinned Firebase
browser modules loaded only when cloud sync has been configured.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Main page and entry template |
| `styles.css` | Responsive light/dark UI and print styles |
| `app.js` | Storage, drafts, editing, rendering, export and printing |
| `data.js` | Validation, migration, backup merging and date/report helpers |
| `sync-data.js`, `sync.js` | Per-entry cloud conflict resolution and optional Firebase sync |
| `firebase-config.js`, `firestore.rules` | Public Firebase connection settings and private per-user access rules |
| `sw.js` | Offline caching |
| `manifest.webmanifest`, `icons/` | Installation metadata and icons |
| `tools/test.cjs` | Dependency-free data and storage regression tests |
| `tools/make-icons.ps1` | Icon generation |
| `_headers`, `robots.txt` | Hosting headers and indexing preferences |

## Run it locally

```bash
python -m http.server 8123 --directory .
```

Then open <http://localhost:8123>. A plain `file://` open will *not* work —
service workers need `http://localhost` or HTTPS.

## Put it online

Service workers require HTTPS, so the app needs hosting. There is no build
step, so any static host works — point it at the repo root.

This public repo deploys from the root of `main` with **GitHub Pages** at
<https://moogalcat.github.io/MigraineTracker/>. Every push to `main` starts a
new Pages deployment.

Search engines are asked to stay away three times over, so it works whichever
host you use: a `noindex` meta tag in `index.html` and `robots.txt`. The `_headers`
file provides another `X-Robots-Tag` header only on hosts that support that file;
GitHub Pages ignores it.

None of that is access control — **anyone with the URL can open the app**. It
only keeps it out of search results. Without sync, diary data stays in the
browser. After Google sign-in, saved entries are stored in Cloud Firestore and
the security rules restrict them to that Google account.

`.nojekyll` keeps GitHub Pages from processing the static files with Jekyll.

## Install the app

- **Windows / macOS** — open the URL in Edge or Chrome, open the browser menu,
  choose **Apps**, then **Install this site as an app**.

- **iPhone / iPad** — open the URL in **Safari** (not Chrome), tap the Share
  button, then **Add to Home Screen**.
- **Android** — open in Chrome and accept the install prompt, or use
  menu → **Install app** / **Add to Home screen**.

It then launches full-screen with its own icon, like any other app.

## Editing and drafts

Logging saves the timestamp before opening the editor. Typing or selecting a
choice saves a separate local draft. Drafts do not affect statistics, backups or
printed reports until **Save**.

**Save** commits all details and clears the draft. **Cancel** discards edits to an
existing entry. During the session in which an entry is first logged, **Discard**
removes the new entry; after reloading it is an ordinary saved entry with Delete.
Closing an editor only collapses it and does not discard edits.

Start time cannot be in the future.

Storage failures leave a persistent message. A failed draft write retains the
values in the open page but cannot promise recovery after closing it. Failed
entry writes leave both the saved log and visible draft intact. If another tab
has changed the saved log, writes stop until the page is reloaded. A recovered
draft whose saved entry has changed requires reviewing the saved version before
applying edits, to avoid silently overwriting it.

## Backups and restore

Open **Backup & data → Export backup** to download a timestamped JSON snapshot.
The reminder tracks changes since the last export attempt. Browsers cannot tell
whether a downloaded file was kept, so the message says “Export started” and asks
you to check Downloads. Each export creates a new file; it does not update older
backups. Drafts are intentionally excluded; save an entry before backing it up.

Current backups contain a versioned object:

```json
{
  "version": 2,
  "entries": [
    {
      "id": "stable-entry-id",
      "at": "2026-09-09T12:30:00.000Z",
      "updatedAt": "2026-09-09T16:00:00.000Z",
      "auraIntensity": "Mild",
      "headacheIntensity": "Moderate",
      "triggers": ["Poor sleep"],
      "notes": "Optional notes"
    }
  ],
  "customTriggers": ["Travel"],
  "preferences": { "theme": "system" },
  "deletedIds": []
}
```

Dates are stored in UTC and displayed in local time. Either rating can be null.
Legacy arrays and objects containing an `entries` array still import.
The old single `intensity` field migrates to headache intensity; aura remains
unrecorded. Old `None` ratings become unselected. Retired duration and medication
fields in an older backup are ignored.

Import merges entries by stable ID. Matching content is skipped. A conflicting
entry replaces the local copy only when **both** have modification timestamps and
the imported one is newer; otherwise the local entry is kept and the conflict is
reported. Exact content with another ID is also skipped for compatibility with
older imports. Legacy records that lack IDs cannot reliably be matched after
editing; they can only be deduplicated by exact content.

Custom trigger lists are combined; a complete backup restores its appearance
preference. Legacy entry-only backups retain the local appearance. Deleted IDs
prevent older backups from restoring entries deleted by this version. Import is
a merge, so it never deletes an existing local entry based on an imported deletion
record. The import result persistently reports additions, updates, duplicates,
conflicts, previously deleted entries and invalid records.

Entries, custom triggers, preferences and deleted IDs are written together as
one storage value, so an import cannot save only part of that state. The backup
reminder is separate; a reminder write failure does not undo a successful save.

## Sync between devices

Sync is optional. Without Firebase configuration the app behaves exactly as a
local-only diary. Once configured, open **Sync between devices** and sign in with
the same Google account on every device. Existing entries upload on the first
successful connection. Later edits and deletions are appended individually, so
independent offline changes from different devices can be merged safely. The
latest modification of the same entry wins. Appearance and custom-trigger changes
use their latest modification time.

A device's diary stays with the Google account it first synced with. Signing in
with a different account asks first: OK removes this device's diary, custom
triggers and drafts, then loads that account's diary (export a backup first if
you need changes made while signed out); Cancel signs out without uploading
anything. A device with no entries or custom triggers switches without asking.

To connect Firebase:

1. Create a project at <https://console.firebase.google.com>, register a Web app,
   and leave Google Analytics disabled unless you specifically want it.
2. Create a Cloud Firestore database in production mode.
3. Under **Authentication → Sign-in method**, enable Google. Add the deployed
   site's hostname under **Authentication → Settings → Authorized domains**.
4. Copy the Web app's `firebaseConfig` object into `firebase-config.js`, replacing
   `null`. These browser identifiers are public configuration; never add a service
   account key or other private credential to the repository.
5. In Firestore's **Rules** tab, paste `firestore.rules` and publish it. The rules
   let a signed-in user read and append only their own change records; updates and
   deletions of cloud history are denied.

The local diary continues working offline and uploads its saved state after the
connection returns. Local drafts remain device-only and are never synced. Continue
exporting backups: sync also propagates accidental edits and deletions.

## Storage protection and recovery

The current state uses `migraine-log-v2`. On first use it reads the old
`migraine-log-v1` entries and `migraine-log-triggers-v1` custom labels without
modifying them. The next successful change writes the new state atomically. The
old keys are retained as a migration fallback; they are no longer updated.
Drafts use separate `migraine-log-draft-v1:<id>` keys.

Unreadable JSON, invalid saved records, duplicate saved IDs or damaged drafts
pause logging rather than presenting an apparently empty, writable log. A
persistent recovery panel offers a raw recovery download and Retry reading.
Original bytes are left untouched.

To recover, import a known good backup. Recovery requires valid entries and asks
for confirmation in the app. Before replacing the active state, it archives the
original state and drafts under a separate `migraine-log-recovery-<timestamp>`
key. If that archive cannot be written, restoration stops without overwriting
anything. A recovery download contains raw storage values for investigation; it
is not a normal importable diary backup.

Without cloud sync, clearing browser/site data or resetting the device can remove
the diary, drafts and local recovery copies. With sync, unsaved drafts and recovery
copies remain device-only. Keep exported backups outside the browser either way.

## Design and accessibility

The interface retains warm-grey light surfaces, charcoal dark surfaces, muted
severity colours, a serif title and ruled rows. Secondary text is readable without
brightening large surfaces. Selected choices have a clear outline as well as
colour. Interactive targets are at least 44 pixels high. Entry fields have unique
labels, controls expose their selected state, and expanded rows expose their open
state. Validation errors remain next to the entry until resolved or cancelled.
Reduced-motion preferences are respected.

## Development and checks

Run the regression suite with an installed Node.js runtime:

```sh
node --test tools/test.cjs
```

The tests cover legacy migration, intensity validation, corrupt storage protection,
failed writes, stale tabs, draft recovery, backup conflicts and duplicate handling,
and report date boundaries. Also check the browser UI for narrow-screen
layout, keyboard navigation, saving/cancelling drafts and printing.

When changing HTML, CSS or JavaScript, bump `CACHE` in `sw.js`. Add new runtime
files to its `SHELL` list. Navigation is network-first with an offline/error fallback;
other assets are cache-first with a background refresh kept alive by `waitUntil`.
Cache cleanup is limited to this app's cache prefix.

The icons are generated. Edit `tools/make-icons.ps1` and run it to change them.
