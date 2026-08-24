'use strict';
// Regression test for presets.js — in particular the prototype-pollution
// fix (deviceId/name come straight from an unvalidated browser WS message).
// Run with: node src/server/presets.test.js
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

// Use an isolated temp userData dir so this test never touches a real
// presets.json, and reloading the module (see below) starts genuinely fresh.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-presets-test-'));
process.env.JPM_TEST_USERDATA = tmpHome; // read by _fake-electron-for-tests.js

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

const presets = require('./presets.js');

t('savePreset/getPreset round-trip normal data', () => {
  presets.savePreset('musician-1', 'My Mix', { '1': 0.5, '2': 0.75 }, { '1': 0.5 });
  const got = presets.getPreset('musician-1', 'My Mix');
  assert.deepEqual(got, { levels: { '1': 0.5, '2': 0.75 }, pans: { '1': 0.5 } });
});

t('getByDevice returns only that device\'s presets', () => {
  presets.savePreset('musician-2', 'Other Mix', { '1': 0.1 }, {});
  const byDevice = presets.getByDevice('musician-1');
  assert.ok(byDevice['My Mix']);
  assert.equal(byDevice['Other Mix'], undefined);
});

t('deletePreset removes it and cleans up an empty device bucket', () => {
  presets.savePreset('musician-3', 'Temp', { '1': 0.2 }, {});
  presets.deletePreset('musician-3', 'Temp');
  assert.deepEqual(presets.getAll()['musician-3'], undefined);
});

t('deviceId "__proto__" cannot pollute Object.prototype', () => {
  const before = ({}).pwned;
  presets.savePreset('__proto__', 'pwned', { evil: true }, {});
  assert.equal(before, undefined);
  assert.equal(({}).pwned, undefined, 'a brand-new plain object must not have gained a .pwned property');
  assert.equal(Object.prototype.pwned, undefined);
  // The data itself should still be stored safely, just as an ordinary key —
  // not silently dropped, not silently redirected anywhere dangerous.
  assert.deepEqual(presets.getPreset('__proto__', 'pwned'), { levels: { evil: true }, pans: {} });
});

t('name "__proto__" cannot hijack a device bucket\'s own prototype', () => {
  presets.savePreset('musician-4', '__proto__', { evil: true }, {});
  const bucket = presets.getByDevice('musician-4');
  assert.equal(Object.getPrototypeOf(bucket), null, 'the bucket must still have no prototype of its own');
  assert.deepEqual(bucket['__proto__'], { levels: { evil: true }, pans: {} });
});

t('getPreset/getByDevice fall back safely for an unknown deviceId (no live Object.prototype leak)', () => {
  const result = presets.getPreset('never-seen-device', '__proto__');
  assert.equal(result, null, 'must not return a live reference to Object.prototype');
});

console.log(`\n${n} tests passed`);
