# Sur — Pocket Music

A lightweight, private MP3 player for iPhone Safari, Home Screen web apps, and desktop browsers. Vanilla JavaScript, native ES modules, IndexedDB, and one HTML audio element. No runtime dependencies, backend, music uploads, analytics, or build step.

## Features and workflows

- Import multiple MP3s from Files, with duplicate detection and offline copies.
- Search by title or artist; sort by title, artist, or import date.
- Favourites and named playlists. The List menu beside a song toggles membership.
- Play/pause, seek, previous/next, shuffle, repeat collection, and repeat song.
- Media Session lock-screen/Control Center controls where the browser supports them. Previous/next change songs; interval seeking is not advertised.
- Keep offline verifies that the installed service worker has the complete player shell.

Import makes a separate copy; it never moves or deletes the original in Files. New files added to a folder must be imported again. Filenames using `Artist - Title.mp3` supply artist/title; ID3 tags and album artwork are not parsed. Duplicates use filename, size, and modification time. Libraries do not sync between browsers, devices, or separate Home Screen installations.

## Project structure and responsibilities

```text
app.js                         Small, backward-compatible module bootstrap
src/
  app.js                       Composition, initialization, and disposal
  core/app-state.js            One state object per application instance
  services/
    database.js                IndexedDB schema, requests, atomic transactions
    library.js                 Imports, collections, favourites, playlists, removal
    audio.js                   Single audio element, queue, commands, object URLs
    media-session.js           System media controls and optional iOS Audio Session
    offline.js                 Worker registration and Keep offline verification
  ui/
    library.js                 Library rows, collection inputs, dialogs, file picker
    player.js                  Transport controls and now-playing presentation
    notifications.js           Status messages and errors
  utils/format.js               Time display, local IDs, filename metadata
sw.js                          Classic service worker and authoritative shell list
index.html                     Existing layout and module script entry
style.css                      Existing responsive styling (unchanged by refactor)
manifest.webmanifest           Existing identity, scope, start URL, and icons
check.cjs                      Library/playback/UI regression scenarios
check-resume.cjs               Resume and system-control regression scenarios
check-offline.cjs              Worker lifecycle, fetch and cache regression scenarios
tests/                         Service, persistence, integration and module-graph tests
scripts/serve.cjs               Local static preview with JavaScript MIME types
generate-icons.ps1             Reproducible Windows icon generation
netlify.toml                   Existing static-root deployment configuration
```

The library and playlist logic share one service because they operate on the same stored library and playlist setting. There is no event bus, framework, dependency injection container, or state-management library. Services receive explicit dependencies and callbacks. UI modules delegate operations to services and do not query IndexedDB. Services do not query the DOM. The app instance exposes its services and state for embedding and testing; services own state changes.

## Initialization and playback

`index.html` loads the root `app.js` as a native module. Its dynamic import also parses in a previously cached classic-script HTML page. The bootstrap imports `src/app.js`, creates one app instance, and reports module-load failure through the existing status element.

`createApp()` builds state, storage, services, and UI; binds controls; and starts loading the existing library. Import and playlist creation wait for initialization. A ready promise completes after library initialization; worker registration follows. Startup errors disable imports and display a message. No state is attached to `window`.

Selecting a song captures the visible collection as the playback queue. The audio service reads its Blob, cancels superseded loads, releases the previous object URL, assigns the new source to the existing audio element, updates presentation and metadata, and calls the shared resume path. UI/system playback state changes on the `playing` event, not merely on a Play request. Pause invalidates pending loads and commands. Next/previous, shuffle order restoration, and repeat modes remain in the audio service.

Media Session is optional. Unsupported actions, Audio Session categories, and transient position updates cannot disable ordinary HTML audio. iOS category reassertion and synchronous calls to `audio.play()` in resume controls are retained. `dispose()` invalidates pending playback, releases the source URL, removes audio listeners and UI bindings, clears system handlers, closes verification channels, and closes the database connection. It is not automatically called when an iPhone backgrounds the app.

## IndexedDB persistence and data safety

The refactor retains the exact storage contract:

| Item | Existing and current value |
| --- | --- |
| Database | `sur-music` |
| Version | `1` |
| Track store | `tracks`, key path `id` |
| Audio store | `audio`, Blob values keyed by track ID |
| Settings store | `settings`, playlists at key `playlists` |
| Track fields | `id`, `title`, `artist`, `size`, `added`, `favourite`, `fingerprint` |
| Playlist fields | `id`, `name`, `tracks` |

No reset, database deletion, version bump, data migration, or background rewriting is performed. Existing records and unrelated settings are retained. Schema creation happens only when IndexedDB creates a new v1 database. Keep the same deployment origin and app identity to retain access to existing data.

Import commits track metadata and its audio Blob together. Removal commits deletion of metadata/audio and playlist cleanup together. In-memory changes follow successful commits. Playlist/favourite mutations are serialized to avoid lost updates while a write is pending. Write errors are reported, and stalled writes reject and abort after 30 seconds. A version-change notification closes the connection so another tab is not blocked indefinitely.

Storage simulations verify preservation of existing fields, favourites, playlist memberships, unrelated settings, and audio bytes through close/reopen and fresh app instances. They do not establish actual Safari persistence behavior. Keep original MP3s: browsers can evict website storage, and clearing website data removes the imported library.

## Service worker and application updates

The worker stays a classic worker at `./sw.js`, with the same registration scope. It caches only the static shell, including every reachable ES module, CSS, manifest, and icons. User audio stays exclusively in IndexedDB; it is never duplicated in Cache Storage.

`SHELL` and `CACHE` in `sw.js` are the only shell asset/version definitions. Installation uses `cache.addAll()` before activation. Activation removes only older `sur-shell-*` caches, after the new shell has installed, and never touches IndexedDB or other applications' caches. Existing network-first fetch behavior is retained, with saved-asset fallback for network/HTTP errors and navigation fallback to the saved HTML.

Keep offline waits for an active registration and asks that worker to verify every shell asset through a MessageChannel. Missing modules, an older worker that cannot answer yet, or a timeout produce the existing setup-failed message. Stay online, reload, and retry after the new worker activates. Verification timers and message ports are cleaned up.

For future module additions, add every new file to `SHELL`, bump `CACHE`, and deploy all files together at the existing URL. The module-graph regression test detects uncached imports. No cache version needs to be copied into app code.

## Run and test

Use Node.js 22 or newer for the verification scripts (including built-in File/Blob). No npm install is required.

```powershell
npm start
# Open http://127.0.0.1:4173
```

The preview binds to loopback and serves native modules with JavaScript MIME types. It is a desktop preview; a phone requires a reachable HTTPS deployment. Existing Netlify configuration still publishes the repository root with no build. Include the entire `src/` directory when deploying. This refactor does not change or publish the deployment URL.

```powershell
npm test
# Individual retained regression scripts:
node check.cjs
node check-resume.cjs
node check-offline.cjs
# Additional service/integration tests:
node --test tests/*.test.cjs
# Older-browser ID fallback:
$env:SUR_NO_UUID = '1'
node check.cjs
Remove-Item Env:SUR_NO_UUID
```

The three original verification scripts were run successfully before extraction. Their scenarios remain, now using module interfaces rather than VM access to production globals. Additional tests cover atomic failure recovery, legacy-library survival, concurrent playlist edits, cancellation/disposal, UI actions, offline verification, and complete module caching. Browser/audio/IndexedDB objects are simulated; these results do not prove iOS compatibility.

## Install and manually verify on iPhone

1. Keep the current HTTPS origin, app identity, and Home Screen installation for update testing. Do not clear website data or reinstall to test whether the existing library survives.
2. Before deploying an update, record a few existing songs, favourites, and playlist memberships. After the complete update activates, reopen the same app and verify those items and audio playback.
3. For a fresh installation, open the HTTPS site in Safari, choose Share → Add to Home Screen, and open that app before importing. Its storage may be separate from Safari.
4. Download iCloud-only MP3s in Files. Import two short songs and a larger file; verify counts, duplicate detection, search, sort, favourites, and playlist membership. Close/reopen and verify persistence.
5. Test play/pause, seeking, next/previous, shuffle, repeat collection, and repeat song. Previous must change tracks even midway through a song.
6. Lock the phone during playback. Confirm audible playback continues, automatic advancement works, and lock-screen, Control Center and headset play/pause/next/previous work.
7. Tap Keep offline, wait for confirmation, enable airplane mode, reopen the same Home Screen app, and play the imported songs.
8. Cancel a removal, then confirm a removal; verify playlist cleanup and that the original file in Files remains untouched.

Background audio, automatic advancement while locked, storage persistence/eviction, native file-provider behavior, PWA installation, and browser-specific system controls require physical iPhone testing. A web app cannot promise native-app background guarantees. When reporting failures, include iOS version, Safari versus Home Screen mode, exact message, and reproduction steps.

## Refactoring decisions and future work

The original implementation had useful atomic transactions, playback cancellation guards, one audio element, and narrowly scoped static caching. Those were preserved. Its main maintenance problems were shared top-level globals, rendering mixed with persistence, playback reading filter inputs directly, duplicated offline configuration, and tests coupled to private globals. These responsibilities are now separated without changing the UI or adding dependencies.

Future work should focus on real-browser integration tests and physical-device acceptance of updates and background playback. Consider ID3 metadata or richer playlist features only as separate product work; neither belongs in this refactor.

## Refactoring self-review

The comparison baseline is Git commit `aad7242` (`logo change`), the last commit before the uncommitted modular refactor. Counts below were taken at the start of the review, including new/untracked files, comments, and blank lines; excluding `.git` and binary assets. `git diff --stat` alone omits untracked modules and cannot give this total.

| Category | Before | At review start | Net growth |
| --- | ---: | ---: | ---: |
| Production JavaScript | 810 | 1,150 | 340 |
| Tests and fixtures | 224 | 799 | 575 |
| Documentation | 68 | 133 | 65 |
| Other text/dev tools | 433 | 469 | 36 |
| Total | 1,535 | 2,551 | 1,016 |

Root `app.js` decreased from 742 lines to 12. It contains only the dynamic module bootstrap and a startup-failure message. No original storage, playback, playlist, import, rendering, or control-binding implementation remains there. `src/app.js` is the composition root, not another player implementation.

| Original code in `aad7242:app.js` | Current owner | Original implementation retained at root? |
| --- | --- | --- |
| `openDB`, `read`, `all`, `write` (lines 35–92) | `src/services/database.js` | No |
| `getVisible`, `render`, `element`, row handlers (97–243) | Library selector/service and `src/ui/library.js` | No |
| `setQueue`, `playTrack`, `next`, resume/pause/toggle (244–396) | `src/services/audio.js` | No |
| Audio category, metadata, position and system controls | `src/services/media-session.js` | No |
| `importFiles`, `removeTrack`, `saveSettings` | Library/database services and confirmation UI | No |
| Inline player/library/dialog bindings | Respective UI modules | No |
| `offline`, worker registration, unused `swRegistration` | Offline service; worker owns the asset list | No; unused registration variable removed |
| `time`, `createID`, filename parsing | `src/utils/format.js` | No |

The actual entry chain is `index.html → app.js → src/app.js`. The composition root creates the state, database, library, audio, Media Session, offline and UI objects once. All 11 source modules are reachable and used. The root-bootstrap regression executes the real entry script and checks one database open, one handler per audio event, and registered system controls. Repeated-render tests verify no extra opens/reads and one write for one favourite action.

Similar names do not imply duplicate operations: library removal coordinates state, database removal commits the atomic transaction, and audio removal releases playback resources and removes queue entries. In-app controls and Media Session handlers are separate input surfaces calling the same player. Test DOM/IndexedDB objects are simulations and are never imported by production. The existing worker fetch logic remains because it is the sole service worker implementation.

Useful additions include explicit dependency wiring, transaction interfaces, command cancellation, lifecycle cleanup, serialized playlist writes, offline verification and regression fixtures. These explain growth without preserving a second runtime implementation. Small state/notification modules are limited boundaries, not a second state manager or event bus. The timeout helper is shared by worker readiness and shell verification. The classic worker and compatibility bootstrap remain to avoid an unnecessary iOS worker-type change or breaking a cached classic-script page.

The review reproduced and fixed a missed startup race: an open database connection was being treated as a loaded library. Early playlist creation could write a snapshot without the old playlists. Creation now awaits initialization before constructing its snapshot. No real user database was used for this reproduction.

Cleanup also consolidated the two different `ended` listeners into one and the two different `error` listeners into one; removed an unreachable second offline-completeness check and the now-unused database `isOpen()` accessor; and completed cleanup of row handlers after render/disposal. Previously those event pairs had different jobs, rather than competing players, but one handler per event is clearer. Row-handler cleanup and the startup guard add some necessary production lines; this review is not a line-count reduction exercise.

Validation after cleanup: all three retained regression scripts and all 14 Node tests pass, including legacy-data survival, atomic rollback, early playlist submission, repeated binding/write counts, and the real bootstrap. Production syntax checks and the ID fallback check pass. The tests use simulated browser APIs; actual Safari IndexedDB, installation, background audio and real-browser worker upgrades remain manual acceptance items. No migration, database reset, UI redesign, new feature, framework or deployment was introduced by this review.

## iOS system previous/next controls

Investigation found one HTML audio element, one Media Session service, and correct existing routing of `previoustrack`/`nexttrack` to the player queue. Track metadata is updated when the source changes; playback state follows actual media events. The optional iOS Audio Session category remains `playback`. There was no evidence of a second player or competing registration. Ten-second seek handlers were already set to `null`.

The compatibility adjustment reasserts the same action callbacks after the audio `playing` event, once the session is active, including resumed playback and track changes. It does not add audio listeners or build another navigation path. `setActionHandler` replaces the callback for an action. A Set tracks successful registrations for disposal without accumulating duplicates. Unsupported actions are caught independently and logged once per action, so they do not disable ordinary audio or other supported actions.

`seekbackward` and `seekforward` remain `null`; `seekto` and Sur's own seek slider remain available. A null action removes the JavaScript handler, not a guaranteed system icon. The [Media Session specification](https://www.w3.org/TR/mediasession/) leaves presentation to the user agent. [WebKit's current source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/mediasession/MediaSession.cpp) maps previous/next and interval seeking to distinct native commands, and action registration updates supported commands. That source is not proof of the exact WebKit build on the target iPhone.

The exact cause of the reported ten-second controls is unconfirmed. Possible causes include an older cached app with seeking handlers, unsupported actions in the target browser, or WebKit/system command presentation or activation behavior. Registration refresh is a bounded compatibility measure, not a verified fix for the target iOS layout. The connected development environment cannot inspect the phone's live capabilities. Actual support is checked by attempting action registration on that browser; failures now appear in its console as `Sur: Media Session action ... is unavailable.`

The focused tests cover refresh only on actual playback, stable callbacks after song changes/resume, playlist navigation under shuffle/repeat, continued UI/system scrubbing, play/pause, unsupported actions and disposal. All three regression scripts and all 16 Node tests pass after this change. They cannot prove audible iPhone background output or system button icons.

### iPhone 15 / iOS 27 manual checklist

1. Deploy the complete updated app at the same URL, then open it online to receive the new worker. Keep the existing installation and library; do not clear website data. Record the exact iOS build and test mode with each result.
2. In Safari, start a song in a playlist containing at least three songs. Lock the phone. Record the displayed buttons, press Next, and confirm that the song title and audible song change rather than advancing ten seconds. After more than ten seconds, press Previous and confirm that it changes songs.
3. Unlock, open Control Center and repeat Next, Previous and play/pause. Pause and resume from Control Center, then check navigation again. Confirm metadata follows each new song.
4. Pause Safari playback. Open the existing Home Screen PWA and repeat the lock-screen and Control Center checks from steps 2–3. Test each mode separately so another active player is not the target of the controls.
5. In the PWA, change songs from Sur, then test system navigation again. Repeat with shuffle, repeat collection and repeat song. Manual Next/Previous should change songs, while automatic repeat-song should restart the current song. Verify Sur's seek slider still works and that playback continues after backgrounding and locking.
6. Tap Keep offline and wait for confirmation. Enable airplane mode, reopen the same PWA, and repeat playback and system navigation. Confirm the existing library, favourites and playlist memberships remain intact.

If ten-second buttons remain, report both the icons and what pressing them actually does, together with mode, iOS build, updated-app status, and any Media Session console warnings. JavaScript cannot force the OS to display a particular layout, and mapping ten-second actions to track skipping would mislabel the controls rather than resolve the platform limitation.
