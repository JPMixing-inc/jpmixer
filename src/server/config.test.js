'use strict';
// Regression test for config.js — in particular that save()/updateOverride()
// report failure and roll the in-memory config back when the disk write
// fails, instead of silently claiming success (the bug Settings' Save &
// Apply used to have: it would say "Saved!" even if config.json never
// actually got written).
// Run with: node src/server/config.test.js

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

process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-config-test-'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

const config = require('./config.js');

// writeFileAtomic's first step is fs.writeFileSync(tmp, data) — monkeypatch
// the real fs module (the same singleton safe-write.js requires) to force
// that to throw, simulating a full disk / permissions failure, then restore
// it immediately after each use so later tests/files aren't affected.
function withSimulatedDiskFailure(fn) {
  const orig = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try { fn(); } finally { fs.writeFileSync = orig; }
}

t('save() succeeds and is reflected by get()/getAll() under normal conditions', () => {
  assert.equal(config.save({ ...config.getAll(), serverPort: 9999 }), true);
  assert.equal(config.get('serverPort'), 9999);
});

t('save() returns false and rolls back in-memory state when the disk write fails', () => {
  const before = config.getAll();
  withSimulatedDiskFailure(() => {
    const ok = config.save({ ...before, serverPort: 1234 });
    assert.equal(ok, false);
  });
  assert.equal(config.get('serverPort'), before.serverPort, 'in-memory config must not reflect the failed write');
  assert.notEqual(config.get('serverPort'), 1234);
});

t('updateOverride() returns false and rolls back in-memory state when the disk write fails', () => {
  config.save({ ...config.getAll(), channelOverrides: {} }); // known baseline
  withSimulatedDiskFailure(() => {
    const ok = config.updateOverride('channel', 1, { label: 'Should not stick' });
    assert.equal(ok, false);
  });
  assert.equal(config.getAll().channelOverrides['1'], undefined, 'in-memory config must not reflect the failed write');
});

t('a later successful save still works after a prior failed one', () => {
  assert.equal(config.save({ ...config.getAll(), serverPort: 8088 }), true);
  assert.equal(config.get('serverPort'), 8088);
});

t('a removed console type (X32, Yamaha, Custom OSC) is read as DiGiCo, which is what it ran', () => {
  for (const type of ['x32', 'yamaha', 'custom', undefined]) {
    assert.equal(config.save({ ...config.getAll(), consoleType: type, matrices: 8 }), true);
    assert.equal(config.get('consoleType'), 'digico');
    assert.equal('matrices' in config.getAll(), false, 'the unused matrices count is dropped');
  }
  assert.equal(config.save({ ...config.getAll(), consoleType: 'wing' }), true);
  assert.equal(config.get('consoleType'), 'wing', 'supported types are kept');
});

console.log(`\n${n} tests passed`);
