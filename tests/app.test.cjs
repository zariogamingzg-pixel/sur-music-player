const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers/browser.cjs');
const { createIndexedDB } = require('./helpers/indexeddb.cjs');

test('a pre-refactor v1 library loads and survives an app refresh with all stored fields and bytes', async () => {
  const { createApp } = await import('../src/app.js');
  const database = createIndexedDB();
  const track = {
    id: 'legacy-song', title: 'Old song', artist: 'Old artist', size: 10,
    added: 1730000000000, favourite: true, fingerprint: 'Old artist - Old song.mp3|10|1',
    customField: 'preserve unknown fields too',
  };
  const playlists = [{ id: 'legacy-list', name: 'Before the refactor', tracks: [track.id] }];
  database.stores.set('tracks', new Map([[track.id, structuredClone(track)]]));
  database.stores.set('audio', new Map([[track.id, new Blob(['old-music'])]]));
  database.stores.set('settings', new Map([['playlists', playlists], ['unrelated-setting', { value: 42 }]]));
  const snapshot = structuredClone([...database.stores]);
  const firstBrowser = createBrowser({ database, media: true });
  const first = createApp(firstBrowser.env);
  await first.ready;
  assert.deepEqual(first.state.tracks, [track]);
  assert.deepEqual(first.state.playlists, playlists);
  assert.deepEqual([...database.stores], snapshot);
  await first.player.playTrack(track.id);
  assert.equal(await firstBrowser.activeURLs.values().next().value.text(), 'old-music');
  first.dispose();
  const second = createApp(createBrowser({ database }).env);
  await second.ready;
  assert.deepEqual(second.state.tracks, [track]);
  assert.deepEqual(second.state.playlists, playlists);
  assert.equal(database.control.upgrades, 0);
  assert.deepEqual(database.stores.get('settings').get('unrelated-setting'), { value: 42 });
  second.dispose();
});

test('concurrent playlist mutations preserve membership and failed changes roll back', async () => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser();
  const app = createApp(browser.env);
  await app.library.importFiles([new File(['a'], 'A.mp3'), new File(['b'], 'B.mp3')]);
  const [a, b] = app.state.tracks;
  const playlist = await app.library.createPlaylist('Both songs');
  await Promise.all([
    app.library.togglePlaylistTrack(playlist.id, a.id),
    app.library.togglePlaylistTrack(playlist.id, b.id),
  ]);
  assert.deepEqual(app.state.playlists[0].tracks, [a.id, b.id]);
  assert.deepEqual(browser.database.stores.get('settings').get('playlists')[0].tracks, [a.id, b.id]);
  browser.database.control.failNextWrite = new Error('disk full');
  await app.library.togglePlaylistTrack(playlist.id, a.id);
  assert.deepEqual(app.state.playlists[0].tracks, [a.id, b.id]);
  assert.match(browser.get('status').textContent, /Could not save playlist/);
  browser.database.control.failNextWrite = new Error('disk full');
  await app.library.toggleFavourite(a.id);
  assert.equal(a.favourite, false);
  browser.database.control.failNextWrite = new Error('disk full');
  assert.equal(await app.library.createPlaylist('Must not appear'), null);
  assert.equal(app.state.playlists.length, 1);
  await app.library.toggleFavourite(a.id);
  assert.equal(a.favourite, true);
  app.dispose();
});

test('DOM actions preserve picker, cancellation, favourites, membership, seek and repeat workflows', async () => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser();
  const { get } = browser;
  const app = createApp(browser.env);
  await app.ready;
  let pickerOpened = false;
  get('files').onclick = () => { pickerOpened = true; };
  get('import').onclick(); assert.equal(pickerOpened, true);
  get('files').files = [new File(['audio'], 'Artist - Song.mp3')];
  await get('files').onchange();
  assert.equal(get('files').value, '');
  assert.equal(get('count').textContent, '1 track');
  const track = app.state.tracks[0];
  let row = get('tracks').children[0];
  await row.children[1].onclick();
  assert.equal(track.favourite, true);
  get('new-playlist').onclick(); assert.equal(get('playlist-dialog').open, true);
  get('playlist-name').value = 'My songs';
  await get('playlist-form').onsubmit({ preventDefault() {} });
  assert.equal(get('playlist-dialog').open, false);
  app.library.setCollection({ view: 'all' });
  row = get('tracks').children[0];
  const membership = row.children[2];
  membership.value = app.state.playlists[0].id;
  await membership.onchange();
  assert.deepEqual(app.state.playlists[0].tracks, [track.id]);
  row = get('tracks').children[0];
  row.children.at(-1).onclick();
  get('delete-dialog').returnValue = 'cancel';
  await get('delete-dialog').close();
  assert.equal(app.state.tracks.length, 1);
  await row.children[0].onclick();
  get('seek').value = '50'; get('seek').oninput();
  assert.equal(get('audio').currentTime, 90);
  get('repeat').onclick(); assert.equal(get('repeat').attrs['aria-label'], 'Repeat collection');
  get('repeat').onclick(); assert.equal(get('repeat').dataset.mode, '2');
  get('audio').currentTime = 180;
  await get('audio').emit('ended'); assert.equal(get('audio').currentTime, 0);
  get('repeat').onclick(); assert.equal(get('repeat').attrs['aria-pressed'], 'false');
  app.dispose();
});

test('quota failures recover and storage-open failure disables imports explicitly', async () => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser();
  const app = createApp(browser.env);
  await app.ready;
  const quota = new Error('full'); quota.name = 'QuotaExceededError';
  browser.database.control.failNextWrite = quota;
  const file = new File(['retry'], 'Retry.mp3');
  await app.library.importFiles([file]);
  assert.match(browser.get('status').textContent, /Storage is full/);
  assert.equal(app.state.tracks.length, 0);
  assert.equal(browser.get('import').disabled, false);
  await app.library.importFiles([file]); assert.equal(app.state.tracks.length, 1);
  app.dispose();
  const broken = createBrowser();
  broken.env.indexedDB = { open() { throw new Error('storage denied'); } };
  const failedApp = createApp(broken.env);
  await failedApp.ready;
  assert.equal(failedApp.state.libraryLoaded, false);
  assert.equal(broken.get('import').disabled, true);
  await failedApp.library.importFiles([file]);
  assert.match(broken.get('status').textContent, /storage is unavailable/);
  failedApp.dispose();
});

test('disposing during initialization closes the eventual database connection', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp(createBrowser().env);
  app.dispose();
  await app.ready;
  await assert.rejects(app.storage.loadLibrary(), /Music storage is not open/);
});

test('playlist submission during startup waits for the saved library without overwriting it', async () => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser();
  const legacy = [{ id: 'old', name: 'Old', tracks: [] }];
  browser.database.stores.set('tracks', new Map());
  browser.database.stores.set('audio', new Map());
  browser.database.stores.set('settings', new Map([['playlists', structuredClone(legacy)]]));
  const app = createApp(browser.env);
  let release;
  app.storage.loadLibrary = () => new Promise((resolve) => {
    release = () => resolve({ tracks: [], playlists: structuredClone(legacy) });
  });
  // Connection is open, but its saved playlists have not finished loading.
  await app.storage.open();
  assert.equal(typeof release, 'function');
  const creating = app.library.createPlaylist('Early');
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(browser.database.stores.get('settings').get('playlists'), legacy);
    release();
    const created = await creating;
    assert.equal(created.name, 'Early');
    assert.deepEqual(app.state.playlists.map((item) => item.name), ['Old', 'Early']);
    assert.deepEqual(browser.database.stores.get('settings').get('playlists'), app.state.playlists);
  } finally {
    release?.();
    await app.ready;
    app.dispose();
  }
});

test('repeated renders keep one event binding and each action makes one storage transaction', async () => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser();
  const app = createApp(browser.env);
  await app.ready;
  await app.library.initialize();
  assert.equal(browser.database.control.opens.length, 1);
  assert.equal(browser.database.control.transactions.filter((tx) => tx.mode === 'readonly').length, 2);
  await app.library.importFiles([new File(['song'], 'Song.mp3')]);
  let oldRow = browser.get('tracks').children[0];
  for (let i = 0; i < 3; i++) app.library.setCollection({ sort: 'title' });
  assert.equal(browser.database.control.transactions.length, 3); // Two startup reads, one import write.
  assert.equal(oldRow.children[1].onclick, null);
  const before = browser.database.control.transactions.length;
  const row = browser.get('tracks').children[0];
  await row.children[1].onclick();
  assert.equal(browser.database.control.transactions.length, before + 1);
  oldRow = browser.get('tracks').children[0];
  for (const [event, listeners] of browser.get('audio').listeners) {
    assert.equal(listeners.length, 1, event);
  }
  app.dispose();
  for (const control of oldRow.children) {
    assert.equal(control.onclick ?? null, null);
    assert.equal(control.onchange ?? null, null);
  }
});
