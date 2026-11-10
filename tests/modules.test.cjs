const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('every reachable ES module is shipped in the offline shell', () => {
  const scope = 'https://sur.test/installed/';
  const context = vm.createContext({
    URL, self: { registration: { scope }, addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8') + ';globalThis.urls = [...shellURLs];', context);
  const cached = new Set(context.urls);
  const visited = new Set();
  function visit(relative) {
    if (visited.has(relative)) return;
    visited.add(relative);
    assert(cached.has(new URL(relative, scope).href), `Module missing from shell: ${relative}`);
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const match of source.matchAll(/^\s*import(?:\s+.*?\s+from\s*|\s*\()\s*["']([^"']+)["']/gm)) {
      assert(match[1].startsWith('.'), `Unexpected external dependency: ${match[1]}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      visit(target);
    }
  }
  visit('app.js');
  assert(visited.has('src/services/audio.js'));
  assert(visited.has('src/ui/library.js'));
  for (const asset of cached) {
    const relative = new URL(asset).pathname.slice(new URL(scope).pathname.length);
    if (relative) assert(fs.existsSync(path.join(root, relative)), `Missing asset: ${relative}`);
    assert(!/\.(mp3|wav|m4a)$/i.test(relative));
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<script src="app\.js" type="module"><\/script>/);
});
