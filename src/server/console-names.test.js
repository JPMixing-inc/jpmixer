'use strict';
// console-names.js: the console's channel and mix names, remembered for
// when it's off, and the order names win in: typed in JPMixer, then the
// console's live name, then the remembered one.

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-console-names-test-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const names = require('./console-names');
const shared = require('./shared-handlers');

test('names the console reports are remembered, kept on disk, and updated when it renames one', () => {
  names._reset();
  names.record('digico', { channels: { 1: 'Kick', 2: 'Snare', x: 'junk', 0: 'zero' }, auxes: { 1: 'Vocal 1' } });
  assert.equal(names.remembered('digico', 'channels', 1), 'Kick');
  assert.equal(names.remembered('digico', 'auxes', 1), 'Vocal 1');
  assert.equal(names.remembered('digico', 'channels', 'x'), undefined, 'only numbered channels');
  assert.equal(names.remembered('dlive', 'channels', 1), undefined, 'each console type keeps its own');
  names.flush();

  // After a restart: read back from console-names.json
  names._reset();
  assert.equal(names.remembered('digico', 'channels', 2), 'Snare');

  // The console renames channel 1 and stops sending channel 2: 1 is updated, 2 kept
  names.record('digico', { channels: { 1: 'Kick In' } });
  assert.deepEqual(names.all('digico', 'channels'), { 1: 'Kick In', 2: 'Snare' });
});

test('a name typed in JPMixer wins, then the console’s live name, then the remembered one', () => {
  names._reset();
  names.record('digico', { channels: { 1: 'Kick', 2: 'Snare', 3: 'Hi-Hat' }, auxes: { 4: 'Keys - Priya' } });
  const cfg = { consoleType: 'digico', channelOverrides: { 3: { label: 'HH (typed)' } } };
  // The console is off: nothing live
  const off = shared.buildChannelList(3, cfg, () => undefined);
  assert.deepEqual(off.map((c) => c.label), ['Kick', 'Snare', 'HH (typed)']);
  // Connected: live names win over remembered ones, even one the console cleared
  const live = { 1: 'Kick Out', 2: '' };
  const on = shared.buildChannelList(3, cfg, (i) => live[i]);
  assert.deepEqual(on.map((c) => c.label), ['Kick Out', '', 'HH (typed)']);
  // Mixes the same way
  assert.equal(shared.consoleNameOr(cfg, 'auxes', 4, undefined), 'Keys - Priya');
  assert.equal(shared.consoleNameOr(cfg, 'auxes', 4, 'Keys'), 'Keys');
  assert.equal(shared.consoleNameOr(cfg, 'auxes', 5, undefined), undefined, 'nothing remembered: the page shows AUX 5');
});
