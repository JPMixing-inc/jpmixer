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
  const { savedAt, ...got } = presets.getPreset('musician-1', 'My Mix');
  assert.deepEqual(got, { levels: { '1': 0.5, '2': 0.75 }, pans: { '1': 0.5 } });
  assert.ok(!isNaN(Date.parse(savedAt)), 'each save is timestamped for Find My Mixes / Settings');
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
  // The mix itself is still stored under that ordinary key — not silently
  // redirected anywhere dangerous. (Its junk levels are dropped: only channel
  // keys with 0..1 positions are kept — see the validation checks below.)
  const { savedAt: _s1, ...pwned } = presets.getPreset('__proto__', 'pwned');
  assert.deepEqual(pwned, { levels: {}, pans: {} });
});

t('name "__proto__" cannot hijack a device bucket\'s own prototype', () => {
  presets.savePreset('musician-4', '__proto__', { evil: true }, {});
  const bucket = presets.getByDevice('musician-4');
  assert.equal(Object.getPrototypeOf(bucket), null, 'the bucket must still have no prototype of its own');
  const { savedAt: _s2, ...stored } = bucket['__proto__'];
  assert.deepEqual(stored, { levels: {}, pans: {} });
});

t('getPreset/getByDevice fall back safely for an unknown deviceId (no live Object.prototype leak)', () => {
  const result = presets.getPreset('never-seen-device', '__proto__');
  assert.equal(result, null, 'must not return a live reference to Object.prototype');
});

t('a saved mix keeps only channel keys with 0..1 positions, and names and counts are capped', () => {
  presets.savePreset('musician-5', 'Clean', { '1': 0.5, '0': 0.5, '2x': 0.5, '3': 7, '4': 'loud', '5': NaN, '999': 0.5, '__proto__': 0.5 }, 'not an object');
  const { savedAt: _s, ...mix } = presets.getPreset('musician-5', 'Clean');
  assert.deepEqual(mix, { levels: { '1': 0.5 }, pans: {} });
  assert.equal(presets.savePreset('musician-5', 'x'.repeat(65), { '1': 0.5 }, {}), false, 'a 65-character name is refused');
  assert.equal(presets.savePreset('musician-5', 123, { '1': 0.5 }, {}), false, 'a non-string name is refused');
  for (let i = 0; i < 199; i++) presets.savePreset('musician-6', 'Mix ' + i, { '1': 0.5 }, {});
  assert.equal(presets.savePreset('musician-6', 'Mix 199', { '1': 0.5 }, {}), true, '200 mixes per device');
  assert.equal(presets.savePreset('musician-6', 'Mix 200', { '1': 0.5 }, {}), false, 'the 201st is refused');
  assert.equal(presets.savePreset('musician-6', 'Mix 0', { '1': 0.9 }, {}), true, 'but an existing name can still be re-saved');
});

console.log(`\n${n} tests passed`);
