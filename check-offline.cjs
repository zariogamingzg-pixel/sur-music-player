const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const scope = 'https://sur.test/player/';
const handlers = new Map();
const saved = new Map();
const deleted = [];
let network = async () => new Response('fresh');
let claimed = false;
let activated = false;
const cache = {
  async addAll(requests) {
    for (const request of requests) saved.set(request.url, new Response('saved'));
  },
  async match(url) { return saved.get(url)?.clone(); },
  async put(url, response) { saved.set(url, response); },
};
const context = vm.createContext({
  URL, Request, Response,
  console,
  self: {
    registration: { scope }, location: { origin: new URL(scope).origin },
    addEventListener: (name, fn) => handlers.set(name, fn),
    async skipWaiting() { activated = true; },
    clients: { async claim() { claimed = true; } },
  },
  caches: {
    async open() { return cache; },
    async keys() { return ['sur-shell-v10', 'sur-shell-v11', 'other-app']; },
    async delete(key) { deleted.push(key); },
  },
  fetch: (...args) => network(...args),
});
vm.runInContext(fs.readFileSync(__dirname + '/sw.js', 'utf8'), context);
async function lifecycle(name) {
  let pending;
  handlers.get(name)({ waitUntil(promise) { pending = promise; } });
  await pending;
}
function request(path, mode = 'cors', method = 'GET') {
  let response;
  handlers.get('fetch')({
    request: { url: new URL(path, scope).href, method, mode },
    respondWith(promise) { response = promise; },
  });
  return response;
}
(async () => {
  await lifecycle('install');
  assert.equal(saved.size, 18); assert.equal(activated, true);
  for (const path of fs.readdirSync('src/services')) {
    assert(saved.has(new URL(`src/services/${path}`, scope).href));
  }
  await lifecycle('activate');
  assert.deepEqual(deleted, ['sur-shell-v10']); assert.equal(claimed, true);
  async function verifyShell() {
    let result, pending;
    handlers.get('message')({
      data: {type: 'SUR_VERIFY_OFFLINE'},
      ports: [{postMessage(value) {result = value;}}],
      waitUntil(promise) {pending = promise;},
    });
    await pending;
    return result.complete;
  }
  assert.equal(await verifyShell(), true);
  const missingModule = new URL('src/services/audio.js', scope).href;
  const audioModule = saved.get(missingModule);
  saved.delete(missingModule);
  assert.equal(await verifyShell(), false);
  saved.set(missingModule, audioModule);
  assert.equal(await (await request('app.js')).text(), 'fresh');
  network = async () => { throw new Error('offline'); };
  assert.equal(await (await request('app.js?version=4')).text(), 'fresh');
  assert.equal(await (await request('src/app.js')).text(), 'saved');
  assert.equal(await (await request('unknown', 'navigate')).text(), 'saved');
  network = async () => new Response('host unavailable', { status: 503 });
  assert.equal(await (await request('app.js')).text(), 'fresh');
  assert.equal(await (await request('./', 'navigate')).text(), 'saved');
  assert.equal((await request('unavailable', 'navigate')).status, 200);
  saved.clear();
  assert.equal((await request('app.js')).status, 503);
  assert.equal(request('https://other.test/app.js'), undefined);
  assert.equal(request('music.mp3'), undefined);
  assert.equal(request('app.js', 'cors', 'POST'), undefined);
  network = async () => { throw new Error('offline'); };
  await assert.rejects(request('app.js'), /Offline resource unavailable/);
  console.log('PASS: offline shell installation, activation, scoped cache cleanup, network refresh, query URLs, offline navigation, HTTP-error fallback, missing cache, and excluded requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
