const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Keep offline verifies the active worker, closes ports and handles incomplete shells', async () => {
  const { createOfflineService } = await import('../src/services/offline.js');
  const notices = [];
  let complete = true;
  let closed = 0;
  let registered;
  class FakeChannel {
    constructor() {
      this.port1 = { close() { closed++; } };
      this.port2 = { close() { closed++; },
        postMessage: (data) => queueMicrotask(() => this.port1.onmessage({ data })),
      };
    }
  }
  const registration = { active: {
    postMessage(data, ports) {
      assert.equal(data.type, 'SUR_VERIFY_OFFLINE');
      ports[0].postMessage({ complete });
    },
  } };
  const offline = createOfflineService({
    navigator: {
      storage: { persist: async () => true },
      serviceWorker: { ready: Promise.resolve(registration), async register(url) { registered = url; } },
    },
    MessageChannel: FakeChannel,
    notify: (message, error) => notices.push({ message, error }),
  });
  await offline.register(); assert.equal(registered, './sw.js');
  await offline.keepOffline();
  assert.match(notices.at(-1).message, /Persistent storage granted/);
  assert.equal(closed, 2);
  complete = false; await offline.keepOffline();
  assert.equal(notices.at(-1).error, true);
  assert.equal(closed, 4);
  offline.dispose();
});

test('Keep offline reports unsupported browsers and times out without leaking pending checks', async () => {
  const { createOfflineService } = await import('../src/services/offline.js');
  let notice;
  const notify = (message, error) => { notice = { message, error }; };
  const unsupported = createOfflineService({ navigator: {}, notify });
  await unsupported.keepOffline();
  assert.match(notice.message, /unavailable here/);
  const stalled = createOfflineService({
    navigator: { serviceWorker: { ready: new Promise(() => {}) } },
    timers: { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout }, notify,
  });
  await stalled.keepOffline();
  assert.equal(notice.error, true);
  assert.match(notice.message, /did not complete/);
  stalled.dispose();
});
