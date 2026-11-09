# Sur — Pocket Music

A small, ad-free MP3 player built for iPhone Safari and Home Screen web apps. No music account, subscriptions, backend, external libraries, analytics, or music uploads. Everything in the music library stays in the browser's IndexedDB storage.

## What is included

- Multiple MP3 imports from the Files app, with duplicate detection.
- Search by title or artist, sorting, favourites, and named playlists.
- Play/pause, seeking, previous/next, shuffle, and repeat.
- Standard HTML audio with Media Session lock-screen controls where available.
- A service worker to cache the player for offline opening.
- Responsive layout and a Home Screen icon.

## Current delivery status

The app source and a Node verification script are complete. The hosting service created an unpublished private project, but this session's sandbox approval policy blocked the credential-input step needed to push and publish the source. No deployment was verified. This package has no credentials or private project configuration and can be hosted independently.

Browser visual QA was unavailable because the preview browser could not reach the local server. The verification script checks application logic using simulated browser objects; it does not prove iPhone compatibility. Background audio, lock-screen controls, automatic track changes while locked, file selection, offline installation, and storage persistence must be tested on a physical iPhone. A web app cannot promise the same background execution guarantees as a native iOS app.

## Put it on your iPhone

1. Host the **site files in the project root (the folder containing `index.html`)** on a static web host with HTTPS and service-worker support. There is no build step. Choose a host whose current free tier works for you; this package does not require a paid plan. A `file://` download in Files is not an installed web app. A local server on a Windows computer is only a development preview and does not supply iPhone HTTPS installation.
2. Open the HTTPS address in Safari on your iPhone. If the host protects the site with sign-in, sign in. Private hosting can affect offline access; test it before relying on it.
3. Tap Share → Add to Home Screen. Enable Open as Web App if shown. Open Sur from its new icon **before importing songs**, because its storage can be separate from Safari.
4. In Files, create your Music folder and put your MP3s there. Download any iCloud-only files to the device first.
5. In Sur, tap **Add music**, browse into the folder, and select the MP3 files. Use the file picker's multiple-selection option if available. You select files, not a permanently linked folder.
6. Wait for the import count. Tap **Keep offline** and wait for confirmation. Test opening and playing in airplane mode.
7. Start a track while the app is visible. Lock the phone and test playback, lock-screen controls, and the transition to the next track. If the first play is blocked, tap Play once the song is loaded. If background transitions do not work on your iOS version, this web implementation does not fully meet that requirement.

## Use playlists

Tap **New playlist** and enter a name. The List menu beside a song toggles that song in or out of a playlist; a checkmark means it is already in that playlist. Select the playlist above the library to play its songs. Tap a heart to add to Favourites. Playback follows the selected collection/search at the time you choose a song.

## Files and storage

- Importing makes a separate offline copy, requiring additional device space. It never moves or deletes the source file in Files.
- New files added to your Music folder need another import. The app cannot silently monitor that folder.
- If filenames use `Artist - Title.mp3`, the player separates the artist and title. Embedded ID3 artwork/tags are not parsed in this version.
- Duplicate detection uses filename, size, and last-modified time. Renamed or changed files may be imported again.
- Keep your original music files. iOS can evict website storage when space is low. Clearing website data also deletes the imported library and playlists.
- Imports and playlists do not sync between devices, browsers, or app installations.
- The × button removes the player's copy after confirmation; your original file is unaffected.

## Develop on Windows

No package installation or build tool is required. With a current Node.js installed:

```powershell
node --check app.js
node --check sw.js
node check.cjs
node check-resume.cjs
node check-offline.cjs
```

Serve the project root using a local static web server for desktop development. `localhost` is allowed to use service workers in supporting desktop browsers; an iPhone needs a reachable HTTPS host. A production host should serve `sw.js` with a JavaScript content type and let service workers control the root of this app. Bump `CACHE` in `sw.js` and the matching cache name in `offline()` in `app.js` when changing cached assets.

## Physical iPhone acceptance check

1. Install first, import two short MP3s, then close/reopen the app and confirm both remain.
2. Confirm play/pause, seek, next/previous, search, favourites, and playlist membership.
3. Lock the screen during the first song. Confirm playback continues and that the second song starts without unlocking.
4. Test pause/resume and next/previous from the lock screen or headphones.
5. Confirm shuffle and repeat, including repeat-one at the end of a track.
6. Tap Keep offline, enable airplane mode, reopen from Home Screen, and play both songs.
7. Remove a song and verify that its original is still present in Files.

If the screen-locked or offline checks fail, report the iOS version and whether you opened Sur in Safari or from its Home Screen icon. Do not assume a passing desktop check establishes background playback on iPhone.
