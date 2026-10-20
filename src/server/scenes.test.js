'use strict';
// Regression test for scenes.js — in particular the prototype-pollution fix
// (snapshot/aux come straight from an unvalidated browser WS message).
// Run with: node src/server/scenes.test.js
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};

const fs = require('fs');
const os = require('os');
const assert = require('node:assert/strict');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-scenes-test-'));
process.env.JPM_TEST_USERDATA = tmpHome;

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

const scenes = require('./scenes.js');

t('saveScene/getScene round-trip normal data', () => {
  scenes.saveScene('Soundcheck', 1, { '1': 0.5, '2': 0.75 });
  assert.deepEqual(scenes.getScene('Soundcheck', 1), { '1': 0.5, '2': 0.75 });
});

t('deleteScene removes it and cleans up an empty snapshot bucket', () => {
  scenes.saveScene('Temp Scene', 2, { '1': 0.2 });
  scenes.deleteScene('Temp Scene', 2);
  assert.equal(scenes.getAll()['Temp Scene'], undefined);
});

t('snapshot "__proto__" cannot pollute Object.prototype', () => {
  scenes.saveScene('__proto__', 1, { '1': 0.4 });
  assert.equal(({})['1'], undefined, 'a brand-new plain object must not have gained a property');
  assert.equal(Object.prototype['1'], undefined);
  assert.deepEqual(scenes.getScene('__proto__', 1), { '1': 0.4 });
});

t('aux "__proto__" cannot hijack a snapshot bucket\'s own prototype', () => {
  scenes.saveScene('Another Scene', '__proto__', { '1': 0.4 });
  const bucket = scenes.getAll()['Another Scene'];
  assert.equal(Object.getPrototypeOf(bucket), null, 'the bucket must still have no prototype of its own');
  assert.deepEqual(bucket['__proto__'], { '1': 0.4 });
});

t('saveScene keeps only channel → 0..1 values, and ignores a missing or non-object payload', () => {
  scenes.saveScene('Junk', 1, null);
  scenes.saveScene('Junk', 2, 'not an object');
  assert.equal(scenes.getAll()['Junk'], undefined, 'a null payload used to be stored and crash every later recall');
  scenes.saveScene('Mixed', 1, { '1': 0.5, '2': -1, '3': 2, '4': null, x: 0.5, '__proto__': 0.5, '5': 1 });
  assert.deepEqual({ ...scenes.getScene('Mixed', 1) }, { '1': 0.5, '5': 1 });
});

t('getScene falls back safely for an unknown snapshot (no live Object.prototype leak)', () => {
  assert.equal(scenes.getScene('never-seen-snapshot', '__proto__'), null);
});

t('clearOnStartup resets to a store that is still immune to the same attack', () => {
  scenes.clearOnStartup();
  scenes.saveScene('__proto__', 1, { evil: true });
  assert.equal(({}).evil, undefined);
});

t('Ear Scenes always start empty on launch, even with recent, valid data on disk', () => {
  // A fresh require() simulates a separate app launch, since scenes.js's
  // load() runs once at module-require time. scenes.json holding real,
  // freshly-saved data (not stale, not corrupt) must still not be loaded
  // back in — Ear Scenes are session-only by design, unlike My Mixes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-scenes-launch-test-'));
  fs.writeFileSync(path.join(dir, 'scenes.json'), JSON.stringify({ 'Song 1': { '3': { '1': 0.5 } } }));
  process.env.JPM_TEST_USERDATA = dir;
  for (const k of Object.keys(require.cache)) if (k.startsWith(__dirname)) delete require.cache[k];
  const freshScenes = require('./scenes.js');
  assert.deepEqual(Object.keys(freshScenes.getAll()), [], 'the store must start empty regardless of what is already saved on disk');
  process.env.JPM_TEST_USERDATA = tmpHome; // restore for any test file run after this one in the same process
});

console.log(`\n${n} tests passed`);
