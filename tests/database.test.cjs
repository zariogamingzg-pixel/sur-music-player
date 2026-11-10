const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIndexedDB } = require('./helpers/indexeddb.cjs');

test('v1 library, blobs and playlists survive closing and reopening without migration', async () => {
  const { createDatabase } = await import('../src/services/database.js');
  const fixture = createIndexedDB();
  const first = createDatabase({ indexedDB: fixture.indexedDB });
  await first.open();
  const track = { id: 'existing', title: 'Original', favourite: true, size: 5 };
  const playlists = [{ id: 'old-list', name: 'Already here', tracks: ['existing'] }];
  await first.saveImport(track, new Blob(['music']));
  await first.savePlaylists(playlists);
  first.close();
  const second = createDatabase({ indexedDB: fixture.indexedDB });
  await second.open();
  assert.deepEqual(await second.loadLibrary(), { tracks: [track], playlists });
  assert.equal(await (await second.getAudio(track.id)).text(), 'music');
  assert.equal(fixture.control.upgrades, 1);
  assert.deepEqual(fixture.control.opens, [
    { name: 'sur-music', version: 1 }, { name: 'sur-music', version: 1 },
  ]);
  assert.deepEqual([...fixture.stores.keys()], ['tracks', 'audio', 'settings']);
  second.close();
});

test('failed import and removal transactions leave existing data intact', async () => {
  const { createDatabase } = await import('../src/services/database.js');
  const fixture = createIndexedDB();
  const storage = createDatabase({ indexedDB: fixture.indexedDB });
  await storage.open();
  const track = { id: 'keep', title: 'Keep me' };
  const playlists = [{ id: 'p', name: 'P', tracks: ['keep'] }];
  await storage.saveImport(track, new Blob(['keep']));
  await storage.savePlaylists(playlists);
  fixture.control.failNextWrite = new Error('quota');
  await assert.rejects(storage.saveImport({ id: 'failed' }, new Blob(['bad'])), /quota/);
  fixture.control.failNextWrite = new Error('disk');
  await assert.rejects(storage.removeTrack('keep', []), /disk/);
  assert.deepEqual(await storage.loadLibrary(), { tracks: [track], playlists });
  assert.equal(fixture.stores.get('audio').size, 1);
  storage.close();
});
