// Original system-control and resume regression scenarios, using real services.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createBrowser } = require('./tests/helpers/browser.cjs');

(async () => {
  const { createApp } = await import('./src/app.js');
  const browser = createBrowser({ media: true });
  const { get, handlers, categories } = browser;
  const nav = browser.env.navigator;
  const app = createApp(browser.env);
  await app.ready;
  const { state, player, library } = app;
  assert.equal(handlers.get('seekbackward'), null);
  assert.equal(handlers.get('seekforward'), null);
  assert.equal(typeof handlers.get('nexttrack'), 'function');
  assert.equal(typeof handlers.get('previoustrack'), 'function');
  handlers.get('seekto')({ seekTime: -5 });
  assert.equal(get('audio').currentTime, 0);
  state.current = 'song-one'; get('audio').src = 'blob:existing-song'; get('audio').currentTime = 42;
  assert.equal(await handlers.get('play')(), true);
  assert.equal(get('audio').paused, false);
  assert.equal(nav.mediaSession.playbackState, 'playing');
  assert.equal(get('play').attrs['aria-label'], 'Pause');
  assert.equal(get('record').classes.get('is-playing'), true);
  assert.deepEqual(categories.slice(-2), ['auto', 'playback']);
  handlers.get('pause')();
  assert.equal(nav.mediaSession.playbackState, 'paused');
  assert.equal(get('audio').paused, true);
  assert.equal(get('play').attrs['aria-label'], 'Play');
  assert.equal(get('record').classes.get('is-playing'), false);
  assert.equal(await handlers.get('play')(), true);
  assert.equal(get('audio').currentTime, 42);
  assert.equal(get('audio').src, 'blob:existing-song');
  handlers.get('pause')(); await get('play').onclick();
  assert.equal(get('audio').paused, false);
  await get('play').onclick(); assert.equal(get('audio').paused, true);
  // A play request alone must not mark system or app as playing.
  const audio = get('audio'); const normalPlay = audio.play;
  let start;
  audio.play = () => new Promise((resolve) => {
    start = () => { audio.paused = false; audio.emit('playing'); resolve(); };
  });
  const pending = handlers.get('play')(); audio.emit('play');
  assert.equal(nav.mediaSession.playbackState, 'paused');
  start(); await pending; assert.equal(nav.mediaSession.playbackState, 'playing');
  handlers.get('pause')(); audio.play = () => Promise.reject(new Error('blocked'));
  assert.equal(await handlers.get('play')(), false);
  assert.equal(nav.mediaSession.playbackState, 'paused');
  assert.equal(get('play').attrs['aria-label'], 'Play');
  // A later Pause wins over an earlier pending Play promise.
  audio.play = () => new Promise((resolve, reject) => { start = reject; });
  const cancelled = handlers.get('play')(); handlers.get('pause')(); start(new Error('late failure'));
  assert.equal(await cancelled, false);
  assert.equal(nav.mediaSession.playbackState, 'paused');
  audio.play = normalPlay; nav.rejectCategory = true;
  assert.equal(await handlers.get('play')(), true); nav.rejectCategory = false;
  audio.emit('waiting'); assert.equal(get('record').classes.get('is-playing'), false);
  audio.emit('playing'); assert.equal(get('record').classes.get('is-playing'), true);
  audio.emit('ended'); assert.equal(nav.mediaSession.playbackState, 'paused');
  // System buttons change tracks even well into a song (no function stubs).
  await library.importFiles([
    new File(['a'], 'A.mp3'), new File(['b'], 'B.mp3'), new File(['c'], 'C.mp3'),
  ]);
  const [a, b, c] = state.tracks;
  await player.select(b.id, [a.id, b.id, c.id]);
  audio.currentTime = 42;
  await handlers.get('previoustrack')(); assert.equal(state.current, a.id);
  await handlers.get('nexttrack')(); assert.equal(state.current, b.id);
  await handlers.get('nexttrack')(); assert.equal(state.current, c.id);
  assert.equal(nav.mediaSession.metadata.title, 'C');
  state.current = null; audio.removeAttribute('src');
  assert.equal(await handlers.get('play')(), false);
  assert.equal(nav.mediaSession.playbackState, 'none');
  const shell = fs.readFileSync('sw.js', 'utf8');
  assert(shell.includes('"./src/app.js"'));
  assert(fs.readFileSync('src/services/offline.js', 'utf8').includes('SUR_VERIFY_OFFLINE'));
  app.dispose();
  for (const handler of handlers.values()) assert.equal(handler, null);
  console.log('PASS: shared app/system resume, pause, preserved source and position, event-driven state, rejected and overlapping commands, optional Audio Session API, buffering animation, track skipping, metadata, end/no-track state, offline verification wiring, and disposal. Physical iPhone output remains unverified.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
