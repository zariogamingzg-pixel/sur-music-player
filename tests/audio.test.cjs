const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers/browser.cjs');

test('audio module cancels pending reads and releases URLs/listeners without optional browser APIs', async () => {
  const { createAudioPlayer } = await import('../src/services/audio.js');
  const { createMediaSession } = await import('../src/services/media-session.js');
  const { createAppState } = await import('../src/core/app-state.js');
  const browser = createBrowser();
  const state = createAppState();
  state.tracks = [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }];
  let finishRead;
  let delayed = false;
  const player = createAudioPlayer({
    audio: browser.get('audio'), state,
    storage: { getAudio: () => delayed ? new Promise((resolve) => { finishRead = resolve; }) : Promise.resolve(new Blob(['audio'])) },
    mediaSession: createMediaSession(browser.env),
    getVisible: () => state.tracks,
    URL: browser.env.URL,
  });
  await player.playTrack('one');
  const firstURL = browser.get('audio').src;
  await player.playTrack('two');
  assert.deepEqual(browser.revokedURLs, [firstURL]);
  delayed = true;
  const pending = player.playTrack('one');
  player.pause(); finishRead(new Blob(['cancelled'])); await pending;
  assert.equal(state.current, 'two'); assert.equal(browser.get('audio').paused, true);
  const disposedPending = player.playTrack('one');
  player.dispose(); finishRead(new Blob(['cancelled by dispose'])); await disposedPending;
  assert.equal(browser.activeURLs.size, 0); assert.equal(state.current, null);
  assert.equal([...browser.get('audio').listeners.values()].flat().length, 0);
});
