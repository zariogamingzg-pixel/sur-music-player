const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('the real root bootstrap imports and starts exactly one app', () => {
  const script = String.raw`
    import { createRequire } from 'node:module';
    import assert from 'node:assert/strict';
    const require = createRequire(process.cwd() + '/package.json');
    const { createBrowser } = require('./tests/helpers/browser.cjs');
    const browser = createBrowser({media: true});
    const track = {id:'existing',title:'Existing',artist:'Artist',size:3,favourite:false,added:1};
    browser.database.stores.set('tracks',new Map([[track.id,track]]));
    browser.database.stores.set('audio',new Map([[track.id,new Blob(['old'])]]));
    browser.database.stores.set('settings',new Map());
    for (const key of ['document','navigator','indexedDB','location','URL','MediaMetadata']) {
      Object.defineProperty(globalThis,key,{value:browser.env[key],configurable:true});
    }
    await import('./app.js');
    for (let attempt=0;attempt<50&&!browser.get('tracks').children.length;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(browser.get('tracks').children.length,1);
    assert.equal(browser.database.control.opens.length,1);
    for (const entries of browser.get('audio').listeners.values()) assert.equal(entries.length,1);
    assert.equal(typeof browser.handlers.get('nexttrack'),'function');
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(__dirname, '..'), timeout: 5000, stdio: 'pipe',
  }));
});
