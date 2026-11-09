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
  self: {
    registration: { scope }, location: { origin: new URL(scope).origin },
    addEventListener: (name, fn) => handlers.set(name, fn),
    async skipWaiting() { activated = true; },
    clients: { async claim() { claimed = true; } },
  },
  caches: {
    async open() { return cache; },
    async keys() { return ['sur-shell-v3', 'sur-shell-v4', 'other-app']; },
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
  assert.equal(saved.size, 6); assert.equal(activated, true);
  await lifecycle('activate');
  assert.deepEqual(deleted, ['sur-shell-v3']); assert.equal(claimed, true);
  assert.equal(await (await request('app.js')).text(), 'fresh');
  network = async () => { throw new Error('offline'); };
  assert.equal(await (await request('app.js?version=4')).text(), 'fresh');
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
