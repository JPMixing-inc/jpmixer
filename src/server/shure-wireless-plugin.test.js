'use strict';
// Shure wireless end to end: the Shure plugin (plugins/shure) in its own
// process, installed from the copy that comes with JPMixer as moving over
// does, reading a stand-in receiver, and JPMixer's pages answered from what
// it shares (shure-wireless.js): the FOH card's channels, each mix's mics,
// the receivers it learns saved back to the config, and only GET strings
// ever reaching the receiver. shure-wireless.test.js tests its code in detail.

const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-shure-plugin-test-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const plugins = require('./plugins');
const integrations = require('./integrations');
const wireless = require('./shure-wireless');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = check(); if (v) return v; await wait(50); }
  return check();
}

// A stand-in QLX-D that also says its MAC address (so the plugin learns its hardware id)
function standIn() {
  const received = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('latin1');
    sock.on('data', (d) => {
      for (const m of d.match(/<[^>]*>/g) || []) {
        received.push(m);
        if (m === '< GET 1 ALL >') sock.write('< REP MAC_ADDR 00:0E:DD:00:00:01 >< REP 1 CHAN_NAME {Lead Voc} >< REP 1 BATT_BARS 004 >< REP 1 TX_TYPE QLXD2 >< REP 1 BATT_RUN_TIME 00312 >');
        if (m === '< GET FW_VER >') sock.write('< REP FW_VER {2.6.2} >');
      }
    });
  });
  return { received, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
}

test('Shure wireless as a plugin: the pages read it through JPMixer, as before', async () => {
  await plugins.start({ allowed: false }); // official: no Allow plugins needed
  const receiver = standIn();
  const port = await receiver.listen();
  const saved = [];
  wireless.setSaver((patch) => saved.push(patch));
  try {
    assert.deepEqual(await integrations.ensureInstalled('shure'), { ok: true, from: 'bundled' });
    // The config as integrations.js hands it over, plus the stand-in's port (tests only)
    const settings = { wirelessEnabled: true, wirelessKnown: [], wirelessReceivers: [{ ip: '127.0.0.1' }], wirelessAux: { '127.0.0.1/1': 3 }, _testCommandPort: port, _testNoDiscovery: true };
    wireless.applyConfig(settings);
    await plugins.setIntegrations({ shure: { enabled: true, settings } });

    const ch = await until(() => wireless.channelsForPages().find((c) => c.name === 'Lead Voc' && c.battState === 'good'));
    assert.ok(ch, 'FOH Home’s Wireless card gets the channel');
    assert.equal(ch.transmitter, 'on');
    assert.equal(ch.aux, 3);
    assert.deepEqual(wireless.mixesForPages()[3].map((m) => [m.name, m.battState]), [['Lead Voc', 'good']], 'and the musician’s phone its mix’s mic');
    const status = await until(() => wireless.getStatus().receivers.length && wireless.getStatus());
    assert.equal(status.enabled, true);
    assert.equal(status.receivers[0].ip, '127.0.0.1');

    // The receiver it learned (its hardware id, from the MAC), saved back to the config
    const learned = await until(() => saved.find((p) => (p.wirelessKnown || []).some((k) => k.id === 'DD000001')));
    assert.ok(learned, 'saved through JPMixer');
    assert.deepEqual(Object.keys(learned).sort(), ['wirelessAux', 'wirelessKnown', 'wirelessReceivers']);
    assert.equal(learned.wirelessAux['DD000001/1'], 3, 'the mix follows the hardware id');

    assert.ok(receiver.received.every((m) => /^< GET (\d )?[A-Z_]+ >$/.test(m)), `only GET strings: ${receiver.received.join(' ')}`);

    // Off in Settings: the plugin stops, and the pages show nothing
    wireless.applyConfig({ ...settings, wirelessEnabled: false });
    await plugins.setIntegrations({ shure: { enabled: false, settings: { ...settings, wirelessEnabled: false } } });
    assert.equal(plugins.isRunning('shure'), false);
    assert.equal(wireless.getStatus().enabled, false);
    assert.deepEqual(wireless.channelsForPages(), []);
    assert.deepEqual(wireless.mixesForPages(), {});
  } finally {
    await plugins.stopAll();
    await receiver.close();
  }
});

test('quitting straight after a receiver is learned: it still reaches JPMixer’s config', async () => {
  await plugins.start({ allowed: false });
  const receiver = standIn();
  const port = await receiver.listen();
  const saved = [];
  wireless.setSaver((patch) => saved.push(patch));
  try {
    assert.equal((await integrations.ensureInstalled('shure')).ok, true);
    const settings = { wirelessEnabled: true, wirelessKnown: [], wirelessReceivers: [{ ip: '127.0.0.1' }], wirelessAux: {}, _testCommandPort: port, _testNoDiscovery: true };
    wireless.applyConfig(settings);
    await plugins.setIntegrations({ shure: { enabled: true, settings } });
    // Learned with the MAC (the same reply as the name), saved half a second later…
    assert.ok(await until(() => wireless.channelsForPages().some((c) => c.name === 'Lead Voc')), 'reading the receiver');
    assert.equal(saved.length, 0, 'not saved yet');
    // …but JPMixer quits first: the plugin saves as it stops, and JPMixer gets it
    await plugins.stopAll();
    assert.ok(saved.some((p) => (p.wirelessKnown || []).some((k) => k.id === 'DD000001')), 'saved on the way out');
  } finally {
    await plugins.stopAll();
    await receiver.close();
  }
});
