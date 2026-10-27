'use strict';
// Moving people over: Shure, Smaart and Companion used to be built in. On
// first launch of this version, each one that's on gets its plugin from the
// copy that comes with JPMixer (no internet), runs without Allow plugins, and
// keeps the settings it had. A copy that's been changed isn't official any
// more (it doesn't run, and moving over puts the real one back); another
// plugin can't ask for "integration"; and Patch, official too, runs without
// Allow plugins when it's the approved copy, but not when it's imported.

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-integrations-test-'));
process.env.JPM_TEST_USERDATA = userData;

const test = require('node:test');
const assert = require('node:assert/strict');
const plugins = require('./plugins');
const integrations = require('./integrations');
const smaart = require('./smaart');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await check(); if (v) return v; await wait(50); }
  return check();
}

// The config of someone updating from 2.0.13, with Smaart and Shure on and Companion off
const OLD_CONFIG = {
  smaartEnabled: true, smaartHost: '127.0.0.1', smaartPort: 1, smaartPassword: 'church', smaartMetric: 'LAeq 1', smaartLiveMetric: 'none', smaartHiddenInputs: [],
  wirelessEnabled: true, wirelessKnown: [{ id: 'DD000001', ip: '192.0.2.40', model: 'QLXD4' }], wirelessReceivers: [], wirelessAux: { 'DD000001/1': 3 },
  companionEnabled: false, companionHost: '192.0.2.50', companionPort: 16622, companionColumns: 8, companionRows: 4,
  pluginsEnabled: false,
};

test('moving over: each integration that was on gets its plugin, running without Allow plugins, with its settings', async () => {
  integrations.applyConfig(OLD_CONFIG);
  smaart.applyConfig(OLD_CONFIG);
  await plugins.start({ allowed: OLD_CONFIG.pluginsEnabled === true });
  try {
    assert.equal(plugins.list().length, 0, 'nothing installed yet');
    const moved = await integrations.moveOver(OLD_CONFIG, () => {});
    assert.deepEqual(moved, { smaart: { ok: true, from: 'bundled' }, shure: { ok: true, from: 'bundled' } }, 'from the copy that comes with JPMixer; Companion was off, so not installed');
    const list = plugins.list();
    assert.deepEqual(list.map((p) => [p.id, p.official, p.integration, p.enabled]), [['shure', true, true, true], ['smaart', true, true, true]]);
    // Running, with Allow plugins off, and the settings it had (JPMixer's config, untouched)
    await until(() => plugins.isRunning('smaart') && plugins.isRunning('shure'));
    const status = await until(() => /Can’t reach Smaart at 127\.0\.0\.1:1/.test(smaart.getStatus().message) && smaart.getStatus());
    assert.ok(status, 'Smaart’s plugin uses the address saved before the update');
    assert.equal(fs.existsSync(path.join(userData, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).smaartHost : undefined, undefined, 'nothing was moved out of the config');

    // Moving over again (every start) changes nothing
    assert.deepEqual(await integrations.moveOver(OLD_CONFIG, () => {}), { smaart: { ok: true, from: 'installed' }, shure: { ok: true, from: 'installed' } });

    // Someone changes the installed copy: not official, so it doesn't run; moving over puts the real one back
    const file = path.join(userData, 'plugins', 'smaart', 'index.js');
    fs.appendFileSync(file, '\n// TAMPERED-WITH-HERE\n');
    await plugins.apply();
    assert.equal(plugins.isRunning('smaart'), false, 'a changed copy doesn’t run');
    assert.equal(plugins.list().find((p) => p.id === 'smaart').official, false);
    assert.match(smaart.getStatus().message, /files have changed, so it isn’t running/, 'and its tab says why');
    // Moving over and a Settings save at once: one install, shared
    const [a, b] = await Promise.all([integrations.ensureInstalled('smaart'), integrations.ensureInstalled('smaart')]);
    assert.deepEqual([a, b], [{ ok: true, from: 'bundled' }, { ok: true, from: 'bundled' }]);
    assert.deepEqual((await integrations.moveOver(OLD_CONFIG, () => {})).smaart, { ok: true, from: 'installed' }, 'already put back by the installs above');
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /TAMPERED-WITH-HERE/, 'the real copy is back');
    await until(() => plugins.isRunning('smaart'));

    // Turned off in its tab: it stops (and stays installed)
    integrations.applyConfig({ ...OLD_CONFIG, smaartEnabled: false });
    smaart.applyConfig({ ...OLD_CONFIG, smaartEnabled: false });
    await plugins.apply();
    assert.equal(plugins.isRunning('smaart'), false);
    assert.equal(smaart.getStatus().state, 'off');
    assert.equal(plugins.isInstalled('smaart'), true);
  } finally {
    await plugins.stopAll();
  }
});

test('only JPMixer’s own integrations can ask for "integration"', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-fake-integration-'));
  fs.writeFileSync(path.join(folder, 'index.js'), 'module.exports = () => {};');
  fs.writeFileSync(path.join(folder, 'plugin.json'), JSON.stringify({ id: 'my-wireless', name: 'Mine', permissions: ['integration'], settings: [{ key: 'x', type: 'text' }] }));
  assert.match(plugins.readManifest(folder).error, /Only JPMixer’s own integrations/);
  // An imported plugin with an official id isn't official: it needs Allow plugins like any other
  fs.writeFileSync(path.join(folder, 'plugin.json'), JSON.stringify({ id: 'smaart', name: 'Not Smaart', permissions: ['integration'], settings: [{ key: 'x', type: 'text' }] }));
  assert.equal(plugins.readManifest(folder).ok, true, 'the id is allowed to ask…');
});

test('Patch, official too: runs without Allow plugins as the approved copy, not as an imported one', async () => {
  plugins._reset();
  await plugins.start({ allowed: false });
  try {
    // Imported from a folder: needs Allow plugins
    const imported = await plugins.install(path.join(__dirname, '..', '..', 'plugins', 'patch'), { origin: 'file' });
    assert.equal(imported.ok, true);
    plugins.save({ patch: { enabled: true } });
    await plugins.apply();
    assert.equal(plugins.isRunning('patch'), false, 'imported: off while plugins aren’t allowed');
    assert.deepEqual(plugins.pages(), []);
    // The copy that comes with JPMixer (as from the approved list): runs, and its page is listed
    assert.equal((await plugins.installBundled('patch')).ok, true);
    await plugins.apply();
    await until(() => plugins.isRunning('patch'));
    assert.deepEqual(plugins.pages().map((p) => p.id), ['patch']);
    assert.equal(plugins.list().find((p) => p.id === 'patch').official, true);
    // Installed from the approved list on 2.0.13, before files were recorded: official once it matches
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'plugins.json'), 'utf8'));
    saved.patch = { ...saved.patch, source: 'catalog' };
    delete saved.patch.files;
    fs.writeFileSync(path.join(userData, 'plugins.json'), JSON.stringify(saved));
    plugins._reset();
    await plugins.apply();
    assert.equal(plugins.list().find((p) => p.id === 'patch').official, true, 'the approved copy from 2.0.13');
    assert.ok(JSON.parse(fs.readFileSync(path.join(userData, 'plugins.json'), 'utf8')).patch.files, 'and its files recorded from then on');
  } finally {
    await plugins.stopAll();
  }
});

test('a copy that comes with JPMixer that doesn’t match (line endings changed, as a Windows checkout could): moving over gets it from the approved list', async () => {
  plugins._reset();
  // A packaged JPMixer whose Companion copy has Windows line endings
  const electron = require('electron');
  const repoPlugins = path.join(__dirname, '..', '..', 'plugins');
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-resources-'));
  fs.mkdirSync(path.join(resources, 'plugins'));
  fs.copyFileSync(path.join(repoPlugins, 'catalog.json'), path.join(resources, 'plugins', 'catalog.json'));
  fs.cpSync(path.join(repoPlugins, 'companion'), path.join(resources, 'plugins', 'companion'), { recursive: true });
  const file = path.join(resources, 'plugins', 'companion', 'index.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  electron.app.isPackaged = true;
  process.resourcesPath = resources;
  await plugins.start({ allowed: false });
  try {
    const cfg = { companionEnabled: true, companionHost: '127.0.0.1', companionPort: 1 };
    integrations.applyConfig(cfg);
    const logged = [];
    const fromCatalog = (id) => plugins.install(path.join(repoPlugins, id), { origin: 'catalog' }); // stands in for the download
    assert.deepEqual(await integrations.moveOver(cfg, (m) => logged.push(m), { fromCatalog }), { companion: { ok: true, from: 'catalog' } });
    assert.match(logged[0], /doesn’t match its list.*trying the approved list/);
    assert.equal(plugins.list().find((p) => p.id === 'companion').official, true, 'the approved copy, so it runs without Allow plugins');
    // Without the internet as well: it says why, and isn't installed
    plugins.forget('companion');
    fs.rmSync(path.join(userData, 'plugins', 'companion'), { recursive: true, force: true });
    plugins._reset();
    const offline = await integrations.moveOver(cfg, () => {}, { fromCatalog: async () => ({ ok: false, error: 'no internet' }) });
    assert.equal(offline.companion.ok, false);
    assert.match(integrations.notInstalledMessage('companion'), /Couldn’t install the Companion buttons plugin: The copy of this plugin that comes with JPMixer doesn’t match its list/);
  } finally {
    delete electron.app.isPackaged;
    delete process.resourcesPath;
    await plugins.stopAll();
  }
});
