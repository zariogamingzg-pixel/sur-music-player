// Original regression scenarios, adapted from globals to the app's interfaces.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createBrowser } = require('./tests/helpers/browser.cjs');

(async () => {
  if (process.env.SUR_NO_UUID) Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  const { createApp } = await import('./src/app.js');
  const browser = createBrowser();
  const { get, database } = browser;
  const { stores, control } = database;
  const app = createApp(browser.env);
  const { state, library, player } = app;
  assert.equal(state.tracks.length, 0);
  // Import waits for startup and must not require a full ArrayBuffer read.
  const phoneFile = new File(['phone audio'], 'Phone.mp3', { lastModified: 10 });
  phoneFile.arrayBuffer = () => { throw Error('full-file read unavailable'); };
  await library.importFiles([phoneFile]);
  assert.equal(state.tracks.length, 1);
  assert.equal(await stores.get('audio').values().next().value.text(), 'phone audio');
  async function removeFromUI(track) {
    library.setCollection({ view: 'all', search: '' });
    const row = get('tracks').children.find((item) => item.dataset.id === track.id);
    row.children.at(-1).onclick();
    get('delete-dialog').returnValue = 'remove';
    await get('delete-dialog').close();
  }
  await removeFromUI(state.tracks[0]);
  assert.equal(state.tracks.length, 0);
  // Empty provider files fail visibly and leave controls available for retry.
  await library.importFiles([new File([], 'Empty.mp3')]);
  assert.equal(state.tracks.length, 0);
  assert.match(get('status').textContent, /empty/);
  assert.equal(get('import').disabled, false);
  await library.importFiles([new File(['sample'], 'Artist - Song.mp3', { lastModified: 1 })]);
  assert.equal(state.tracks.length, 1);
  assert.equal(state.tracks[0].artist, 'Artist');
  assert.equal(state.tracks[0].title, 'Song');
  assert.equal(stores.get('audio').size, 1);
  await library.importFiles([
    new File(['sample'], 'Artist - Song.mp3', { lastModified: 1 }), new File(['x'], 'skip.txt'),
  ]);
  assert.equal(state.tracks.length, 1);
  assert.match(get('status').textContent, /1 already/);
  await library.importFiles([new File(['sample2'], 'Another - Ballad.mp3', { lastModified: 2 })]);
  assert.equal(state.tracks.length, 2);
  get('search').value = 'artist'; get('search').oninput();
  assert.equal(library.getVisible().length, 1);
  get('search').value = ''; get('search').oninput();
  await library.toggleFavourite(state.tracks[0].id);
  library.setCollection({ view: 'favourites' });
  assert.equal(library.getVisible().length, 1);
  const playlist = await library.createPlaylist('Night');
  await library.togglePlaylistTrack(playlist.id, state.tracks[1].id);
  assert.equal(library.getVisible()[0].title, 'Ballad');
  assert.equal(stores.get('settings').get('playlists')[0].name, 'Night');
  library.setCollection({ view: 'all' });
  player.setQueue(state.tracks.map((track) => track.id), state.tracks[0].id);
  await player.playTrack(state.tracks[0].id);
  assert.equal(get('audio').paused, false);
  assert.equal(get('playing-title').textContent, 'Song');
  await player.next();
  assert.equal(get('playing-title').textContent, 'Ballad');
  state.repeat = 0; await player.next(1, true);
  assert.match(get('status').textContent, /End of/);
  state.repeat = 2; await player.next(1, true);
  assert.equal(get('audio').currentTime, 0);
  // Pause while IndexedDB is still loading must cancel the requested song.
  player.pause();
  const loading = player.playTrack(state.tracks[0].id);
  player.pause(); await loading;
  assert.equal(get('audio').paused, true);
  assert.equal(state.pendingTrack, null);
  assert.equal(get('playing-title').textContent, 'Ballad');
  // The main button must also cancel a pending track load.
  const toggled = player.playTrack(state.tracks[0].id);
  await get('play').onclick(); await toggled;
  assert.equal(get('audio').paused, true);
  // Only the latest selection may replace the source.
  await Promise.all([player.playTrack(state.tracks[0].id), player.playTrack(state.tracks[1].id)]);
  assert.equal(get('playing-title').textContent, 'Ballad');
  // Disabling shuffle restores the original ordering.
  player.setQueue(state.tracks.map((track) => track.id), state.current);
  const original = [...state.queue];
  get('shuffle').onclick(); get('shuffle').onclick();
  assert.deepEqual(state.queue, original);
  // Previous before selecting a song chooses the final track.
  player.pause(); state.current = null; state.queue = []; state.queueIndex = -1;
  get('audio').currentTime = 0;
  await player.next(-1);
  assert.equal(state.current, library.getVisible().at(-1).id);
  // Removing a track before its read finishes must not resurrect it.
  await player.playTrack(state.tracks[1].id);
  const savedRead = app.storage.getAudio;
  let finishRead;
  app.storage.getAudio = () => new Promise((resolve) => { finishRead = resolve; });
  const removedLoad = player.playTrack(state.tracks[0].id);
  const savedTracks = state.tracks;
  state.tracks = state.tracks.slice(1);
  finishRead(new Blob(['deleted audio'])); await removedLoad;
  assert.notEqual(state.current, savedTracks[0].id);
  app.storage.getAudio = savedRead; state.tracks = savedTracks;
  await player.playTrack(state.tracks[1].id);
  // Repeated submits during a save create only one playlist.
  get('playlist-name').value = 'One submission';
  const before = state.playlists.length;
  await Promise.all([
    get('playlist-form').onsubmit({ preventDefault() {} }),
    get('playlist-form').onsubmit({ preventDefault() {} }),
  ]);
  assert.equal(state.playlists.length, before + 1);
  await removeFromUI(state.tracks[1]);
  assert.equal(state.tracks.length, 1);
  assert.equal(stores.get('audio').size, 1);
  assert.equal(stores.get('settings').get('playlists')[0].tracks.length, 0);
  // A stalled transaction aborts and releases import controls.
  control.stallWrites = true;
  browser.env.timers.setTimeout = (fn) => setTimeout(fn, 0);
  await library.importFiles([new File(['stalled'], 'Stalled.mp3')]);
  assert.equal(control.aborted, 1);
  assert.match(get('status').textContent, /timed out/);
  assert.equal(get('import').disabled, false);
  assert.equal(state.importing, false);
  control.stallWrites = false; browser.env.timers.setTimeout = setTimeout;
  const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
  for (const icon of manifest.icons) assert(fs.existsSync('./' + icon.src));
  assert.equal(manifest.display, 'standalone');
  app.dispose();
  console.log('PASS: imports during startup, imports without ArrayBuffer reads, empty-file errors, storage timeouts, ID compatibility, duplicates, filtering, metadata, search, favourites, playlists, playback queue, repeat, deletion, app assets, cancelled/overlapping track loads, shuffle restoration, initial Previous, deleted pending tracks, and duplicate playlist submissions. Browser and iPhone behaviour require device testing.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
