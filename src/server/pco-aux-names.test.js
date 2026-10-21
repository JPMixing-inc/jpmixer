'use strict';
// Turning off "Show performer names on aux mixes" takes the names a Planning
// Center sync put on the mixes back off, and leaves names people typed alone.
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-pco-names-test-'));
const config = require('./config.js');
const names = require('./pco-aux-names.js');
const recordFile = path.join(process.env.JPM_TEST_USERDATA, 'pco-aux-names.json');

// What main.js's runPcoSync does: note the name before, relabel, record
function sync(pairs) {
  const records = [];
  for (const [n, label] of pairs) {
    const before = names.beforeSync(n);
    config.updateOverride('aux', n, { label });
    records.push({ aux: n, label, before });
  }
  names.recordSync(records);
}
const label = n => (config.get('auxOverrides')[String(n)] || {}).label;
// A Settings window saving the aux settings it loaded earlier, with only the
// labels refreshed from disk (what settings.js's mergeExternalLabels does)
function settingsSave(loaded) {
  const fresh = config.get('auxOverrides');
  const out = JSON.parse(JSON.stringify(loaded));
  for (const [n, ov] of Object.entries(fresh)) if (ov.label !== undefined) out[n] = { ...(out[n] || {}), label: ov.label };
  config.save({ ...config.getAll(), auxOverrides: out });
}
function fresh(overrides, mapping = { 'Vocal 1': 1, 'Keys': 2, 'Bass': 3 }) {
  try { fs.unlinkSync(recordFile); } catch (_) {}
  names._reset();
  config.save({ ...config.getAll(), pcoPositionMapping: mapping, auxOverrides: overrides });
}

test('performer names come off, and each mix gets back the name it had', () => {
  fresh({ 2: { label: 'Keys IEM', colour: '#ff0000' } });
  sync([[1, 'Vocal 1 - Sam'], [2, 'Keys - Alex']]);
  sync([[2, 'Keys - Jordan']]); // next week's sync keeps the original name
  assert.deepEqual(names.clear().sort(), [1, 2]);
  assert.equal(label(1), '');            // back to the console's own name
  assert.equal(label(2), 'Keys IEM');
  assert.equal(config.get('auxOverrides')['2'].colour, '#ff0000');
  assert.deepEqual(names.clear(), []);   // nothing left to take off
});

test('a name typed after the sync is kept', () => {
  fresh({});
  sync([[3, 'Bass - Riley']]);
  config.updateOverride('aux', 3, { label: 'Bass wedge' });
  assert.deepEqual(names.clear(), []);
  assert.equal(label(3), 'Bass wedge');
});

test('a Sync Now while Settings is open, then turning names off, still clears them', () => {
  fresh({ 2: { label: 'Keys IEM' } });
  sync([[2, 'Keys - Alex']]);
  const loaded = JSON.parse(JSON.stringify(config.get('auxOverrides'))); // Settings opens
  sync([[2, 'Keys - Jordan']]);                                         // Sync Now
  settingsSave(loaded);                                                  // names off + Save
  assert.deepEqual(names.clear(), [2]);
  assert.equal(label(2), 'Keys IEM', 'the typed name comes back, not last week\'s performer');
});

test('the first sync with Settings open still remembers the name to go back to', () => {
  fresh({ 3: { label: 'Bass wedge' } });
  const loaded = JSON.parse(JSON.stringify(config.get('auxOverrides')));
  sync([[3, 'Bass - Riley']]);
  settingsSave(loaded);
  assert.deepEqual(names.clear(), [3]);
  assert.equal(label(3), 'Bass wedge');
});

test('names from syncs before the record existed are recognised by their shape, ignoring case', () => {
  fresh({ 1: { label: 'Vocal 1 - Casey' }, 2: { label: 'KEYS - Alex' }, 4: { label: 'Vocal 1 - Casey' } }, { 'vocal 1': 1, 'Keys': 2 });
  assert.deepEqual(names.clear().sort(), [1, 2]);
  assert.equal(label(1), ''); assert.equal(label(2), '');
  assert.equal(label(4), 'Vocal 1 - Casey', 'not a position mapped to aux 4');
});

test('turning names off is one settings write, not one per mix', () => {
  fresh({});
  sync([[1, 'Vocal 1 - Sam'], [2, 'Keys - Alex'], [3, 'Bass - Riley']]);
  const calls = [];
  const one = config.updateOverride, many = config.updateOverrides;
  config.updateOverride = (...a) => { calls.push('one'); return one(...a); };
  config.updateOverrides = (...a) => { calls.push('many'); return many(...a); };
  try { assert.equal(names.clear().length, 3); }
  finally { config.updateOverride = one; config.updateOverrides = many; }
  assert.deepEqual(calls, ['many']);
  assert.deepEqual([1, 2, 3].map(label), ['', '', '']);
});

test('a typed name in the "Position - name" shape is kept once records exist, even after names were cleared', () => {
  fresh({});
  sync([[2, 'Keys - Alex']]);
  assert.deepEqual(names.clear(), [2]);
  config.updateOverride('aux', 2, { label: 'Keys - Wedge' }); // typed by the engineer
  assert.deepEqual(names.clear(), [], 'nothing on record for aux 2 now, and the shape alone no longer counts');
  assert.equal(label(2), 'Keys - Wedge');
});

test('two positions on one mix: the name to go back to is the one before the sync, not the first new label', () => {
  const mapping = { 'Keys': 5, 'Keys 2': 5 };
  fresh({ 5: { label: 'Keys IEM' } }, mapping);
  // As main.js's runPcoSync does: each mix's "before" is read once per sync
  const before = names.beforeSync(5, mapping);
  config.updateOverride('aux', 5, { label: 'Keys - A' });
  config.updateOverride('aux', 5, { label: 'Keys - B' });
  names.recordSync([{ aux: 5, label: 'Keys - A', before }, { aux: 5, label: 'Keys - B', before }]);
  assert.deepEqual(names.clear(), [5]);
  assert.equal(label(5), 'Keys IEM');
});

test('beforeSync judges the current label against the mapping this sync uses, not only the saved one', () => {
  fresh({ 4: { label: 'Drums - Pat' } }, {}); // nothing mapped in the saved config
  assert.equal(names.beforeSync(4, { 'Drums': 4 }), '', 'a performer name from an older sync on a newly mapped mix is not the name to go back to');
  assert.equal(names.beforeSync(4), 'Drums - Pat', 'with the saved, empty mapping it reads as a typed name');
});

test('a mix nobody is scheduled on any more gets its own name back; scheduled ones keep theirs', () => {
  fresh({ 2: { label: 'Keys IEM' } });
  sync([[1, 'Vocal 1 - Sam'], [2, 'Keys - Alex'], [3, 'Bass - Riley']]);
  // Next sync: Alex is off the plan, Sam and Riley are still on
  assert.deepEqual(names.releaseUnscheduled(new Set(['1', '3'])), [2]);
  assert.equal(label(2), 'Keys IEM');
  assert.equal(label(1), 'Vocal 1 - Sam');
  assert.equal(label(3), 'Bass - Riley');
  // Later turning names off still clears the ones that are left
  assert.deepEqual(names.clear().sort(), [1, 3]);
});

test('releasing leaves a name someone typed since alone', () => {
  fresh({});
  sync([[3, 'Bass - Riley']]);
  config.updateOverride('aux', 3, { label: 'Bass wedge' });
  assert.deepEqual(names.releaseUnscheduled(new Set()), []);
  assert.equal(label(3), 'Bass wedge');
  assert.deepEqual(names.releaseUnscheduled(new Set()), [], 'and forgets it');
});
