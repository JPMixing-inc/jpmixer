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
  scenes.saveScene('__proto__', 1, { evil: true });
  assert.equal(({}).evil, undefined, 'a brand-new plain object must not have gained a .evil property');
  assert.equal(Object.prototype.evil, undefined);
  assert.deepEqual(scenes.getScene('__proto__', 1), { evil: true });
});

t('aux "__proto__" cannot hijack a snapshot bucket\'s own prototype', () => {
  scenes.saveScene('Another Scene', '__proto__', { evil: true });
  const bucket = scenes.getAll()['Another Scene'];
  assert.equal(Object.getPrototypeOf(bucket), null, 'the bucket must still have no prototype of its own');
  assert.deepEqual(bucket['__proto__'], { evil: true });
});

t('getScene falls back safely for an unknown snapshot (no live Object.prototype leak)', () => {
  assert.equal(scenes.getScene('never-seen-snapshot', '__proto__'), null);
});

t('clearOnStartup resets to a store that is still immune to the same attack', () => {
  scenes.clearOnStartup();
  scenes.saveScene('__proto__', 1, { evil: true });
  assert.equal(({}).evil, undefined);
});

console.log(`\n${n} tests passed`);
