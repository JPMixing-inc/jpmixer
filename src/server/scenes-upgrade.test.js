'use strict';
// First launch after upgrading from a version that wiped Ear Scenes at every
// launch: scenes.json may hold a past show's scenes. Only a recently saved
// file is loaded; an older one is copied aside and not auto-recalled.
// Run with: node src/server/scenes-upgrade.test.js
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

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

// Fresh userData folder + fresh module instances for each case
function launch(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-scenes-upgrade-'));
  process.env.JPM_TEST_USERDATA = dir;
  setup(dir);
  for (const k of Object.keys(require.cache)) if (k.startsWith(__dirname)) delete require.cache[k];
  return { dir, scenes: require('./scenes.js') };
}
const SCENES = { 'Song 1': { 3: { 1: 0.5 } } };
const threeDaysAgo = (Date.now() - 3 * 24 * 3600 * 1000) / 1000;

t('an old scenes.json is not loaded on the first launch after upgrading', () => {
  const { dir, scenes } = launch((d) => {
    fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify(SCENES));
    fs.utimesSync(path.join(d, 'scenes.json'), threeDaysAgo, threeDaysAgo);
  });
  assert.equal(Object.keys(scenes.getAll()).length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scenes.before-upgrade.json'), 'utf8')), SCENES, 'copied aside for recovery');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8')), {}, 'written empty so a later launch cannot reload it');
});

t('a recently saved scenes.json is loaded on the first launch (e.g. lost in a reboot)', () => {
  const { scenes } = launch((d) => fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify(SCENES)));
  assert.equal(scenes.getScene('Song 1', 3)[1], 0.5);
});

t('after the first launch, scenes always load regardless of age', () => {
  const { scenes } = launch((d) => {
    fs.writeFileSync(path.join(d, 'scenes-meta.json'), JSON.stringify({ keyScheme: 'name' }));
    fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify(SCENES));
    fs.utimesSync(path.join(d, 'scenes.json'), threeDaysAgo, threeDaysAgo);
  });
  assert.equal(scenes.getScene('Song 1', 3)[1], 0.5);
});

t('loaded scenes stay null-prototype', () => {
  const { scenes } = launch((d) => fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify(SCENES)));
  assert.equal(Object.getPrototypeOf(scenes.getAll()), null);
  assert.equal(Object.getPrototypeOf(scenes.getAll()['Song 1']), null);
});

console.log(`\n${n} tests passed`);
