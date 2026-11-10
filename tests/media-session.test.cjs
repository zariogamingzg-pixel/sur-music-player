const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers/browser.cjs');

test('active playback refreshes stable handlers after song changes/resume without adding listeners', async () => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser({ media: true });
  const session = browser.env.navigator.mediaSession;
  const registrations = [];
  const setHandler = session.setActionHandler;
  session.setActionHandler = (action, handler) => {
    registrations.push({ action, handler });
    setHandler(action, handler);
  };
  const app = createApp(browser.env);
  try {
    await app.library.importFiles([
      new File(['a'], 'A.mp3'), new File(['b'], 'B.mp3'), new File(['c'], 'C.mp3'),
    ]);
    const [a, , c] = app.state.tracks;
    const playlist = await app.library.createPlaylist('Two songs');
    await app.library.togglePlaylistTrack(playlist.id, a.id);
    await app.library.togglePlaylistTrack(playlist.id, c.id);
    const initial = new Map(browser.handlers);
    assert.equal(registrations.length, 7);
    const audio = browser.get('audio');
    const normalPlay = audio.play;
    let startPlaying, playRequested;
    const requested = new Promise((resolve) => { playRequested = resolve; });
    audio.play = () => {
      playRequested();
      return new Promise((resolve) => {
        startPlaying = () => { audio.paused = false; audio.emit('playing'); resolve(); };
      });
    };
    const loading = app.player.select(a.id, app.library.getVisible().map((track) => track.id));
    await requested;
    await audio.emit('play');
    assert.equal(registrations.length, 7); // No refresh on a request alone.
    startPlaying(); await loading;
    assert.equal(registrations.length, 14);
    audio.play = normalPlay;
    app.player.toggleShuffle();
    app.player.cycleRepeat(); app.player.cycleRepeat(); // Repeat one.
    await browser.handlers.get('nexttrack')();
    assert.equal(app.state.current, c.id); // Manual skips still navigate.
    assert.equal(session.metadata.title, 'C');
    audio.currentTime = 42;
    await browser.handlers.get('previoustrack')();
    assert.equal(app.state.current, a.id);
    assert.equal(session.metadata.title, 'A');
    await audio.emit('ended');
    assert.equal(app.state.current, a.id); // Automatic repeat-one is preserved.
    browser.handlers.get('pause')();
    const beforeResume = registrations.length;
    browser.handlers.clear(); // Simulate lost platform registration at resume.
    await initial.get('play')();
    assert.equal(registrations.length, beforeResume + 7);
    assert.equal(session.playbackState, 'playing');
    browser.handlers.get('seekto')({ seekTime: 25 });
    assert.equal(audio.currentTime, 25);
    app.player.seekPercent(50); assert.equal(audio.currentTime, 90);
    for (const { action, handler } of registrations) assert.equal(handler, initial.get(action));
    assert.equal(browser.handlers.get('seekforward'), null);
    assert.equal(browser.handlers.get('seekbackward'), null);
    for (const listeners of audio.listeners.values()) assert.equal(listeners.length, 1);
  } finally { app.dispose(); }
  for (const handler of browser.handlers.values()) assert.equal(handler, null);
});

test('unsupported actions are isolated, reported once, and do not break play/pause or UI seeking', async (context) => {
  const { createApp } = await import('../src/app.js');
  const browser = createBrowser({ media: true });
  const warnings = [];
  context.mock.method(console, 'warn', (...args) => warnings.push(args));
  const setHandler = browser.env.navigator.mediaSession.setActionHandler;
  browser.env.navigator.mediaSession.setActionHandler = (action, handler) => {
    if (action === 'nexttrack' || action === 'seekto') throw new TypeError('unsupported');
    setHandler(action, handler);
  };
  const app = createApp(browser.env);
  try {
    await app.library.importFiles([new File(['audio'], 'Song.mp3')]);
    await app.player.toggle();
    browser.handlers.get('pause')(); assert.equal(browser.get('audio').paused, true);
    await browser.handlers.get('play')(); assert.equal(browser.get('audio').paused, false);
    app.player.seekPercent(50); assert.equal(browser.get('audio').currentTime, 90);
    assert.equal(typeof browser.handlers.get('previoustrack'), 'function');
    assert.equal(warnings.length, 2); // No warning flood after refreshes.
  } finally { app.dispose(); }
});
