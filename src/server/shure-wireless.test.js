'use strict';
// Shure wireless monitoring against a stand-in QLX-D receiver that answers
// the way Shure's "Command Strings for QLX-D Receivers" (rev 11/2/2023) says.
const net = require('net');
const test = require('node:test');
const assert = require('node:assert/strict');
const wireless = require('./shure-wireless.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await wait(25); }
  return false;
}

// An ACN discovery reply as receivers send it (addresses made up)
function announcement(model, ip) {
  const body = `(cid=DD4D3D11-0000-11DD-A000-000EDDCCCCCC),(acn-fctn=${model}),(acn-uacn=${model}),(acn-services=esta.dmp),(csl-esta.dmp=esta.sdt/${ip}:57383;esta.dmp/cd:CCE8D7E4-E139-11DF-86E4-0015C5F3F612),(device-description=$:tftp://${ip}/$.ddl)`;
  return Buffer.concat([Buffer.from([2, 7, 0, 1, 0x39, 0, 0, 0, 0, 0, 0x22, 0x3d, 0, 2, 0x65, 0x6e, 0, 0, 1, 0x24]), Buffer.from(body, 'latin1'), Buffer.from([0])]);
}

// A stand-in QLX-D: answers GET ALL, records everything it's sent, and can
// report a change by itself the way a real receiver does
function standIn() {
  const received = [];
  let client = null;
  const server = net.createServer((sock) => {
    client = sock;
    sock.setEncoding('latin1');
    sock.on('data', (d) => {
      for (const m of d.match(/<[^>]*>/g) || []) {
        received.push(m);
        if (m === '< GET 1 ALL >') sock.write('< REP 1 CHAN_NAME {Lead Voc} >< REP 1 AUDIO_GAIN 028 >< REP 1 GROUP_CHAN 01,04 >< REP 1 FREQUENCY 606700 >< REP 1 BATT_BARS 004 >');
        if (m === '< GET FW_VER >') sock.write('< REP FW_VER {2.6.2             } >');
        // split across two packets, as TCP may deliver it
        if (m === '< GET 1 ALL >') setTimeout(() => sock.write('< REP 1 TX_TY'), 20), setTimeout(() => sock.write('PE QLXD2 >< REP 1 BATT_RUN_TIME 00312 >'), 40);
      }
    });
  });
  return {
    received, server,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    say: (s) => client && client.write(s),
    drop: () => client && client.destroy(),
    close: () => new Promise((r) => { if (client) client.destroy(); server.close(r); }),
  };
}

// The reply a real QLXD4 (firmware 2.3.22.0) gave to < GET 1 ALL > with no
// transmitter on, 2026-10-23: same fields, order and padding; the MAC and
// channel name are made up
const REAL_ALL_NO_TX = '< REP FW_VER {2.3.22.0               } >< REP DEVICE_ID {QLXD4   } >< REP MAC_ADDR 00:0E:DD:00:00:01 >< REP ENCRYPTION OFF >'
  + '< REP 1 CHAN_NAME {VOX 9   } >< REP 1 METER_RATE 00000 >< REP 1 AUDIO_GAIN 016 >< REP 1 AUDIO_LVL 000 >< REP 1 GROUP_CHAN --,-- >< REP 1 FREQUENCY 484000 >'
  + '< REP 1 RX_RF_LVL 040 >< REP 1 RF_ANTENNA XX >< REP 1 BATT_BARS 255 >< REP 1 TX_OFFSET 255 >< REP 1 TX_RF_PWR UNKN >< REP 1 TX_MUTE_STATUS UNKN >'
  + '< REP 1 TX_TYPE UNKN >< REP 1 BATT_TYPE UNKN >< REP 1 BATT_RUN_TIME 65535 >< REP 1 TX_DEVICE_ID {        } >< REP 1 BATT_HEALTH 255 >< REP 1 BATT_CHARGE 255 >'
  + '< REP 1 BATT_CYCLE 65535 >< REP 1 BATT_TEMP_C 255 >< REP 1 BATT_TEMP_F 255 >< REP 1 TX_PWR_LOCK UNKN >< REP 1 TX_MENU_LOCK UNKN >< REP 1 TX_POWER_SOURCE UNKN >'
  + '< REP 1 TX_MUTE_BUTTON_STATUS UNKN >< REP 1 ENCRYPTION_WARNING OFF >';

// A receiver that answers like the real one, including the regular re-reads;
// `quiet` makes it stop answering without closing the connection
function realisticStandIn() {
  const received = [];
  const state = { bars: '255', txType: 'UNKN', name: '{VOX 9   }', runTime: '65535', quiet: false };
  let client = null;
  const server = net.createServer((sock) => {
    client = sock;
    sock.setEncoding('latin1');
    sock.on('data', (d) => {
      for (const m of d.match(/<[^>]*>/g) || []) {
        received.push(m);
        if (state.quiet) continue;
        if (m === '< GET FW_VER >') sock.write('< REP FW_VER {2.3.22.0               } >');
        else if (m === '< GET 1 ALL >') sock.write(REAL_ALL_NO_TX.replace('BATT_BARS 255', `BATT_BARS ${state.bars}`).replace('TX_TYPE UNKN', `TX_TYPE ${state.txType}`));
        else if (m === '< GET 1 BATT_BARS >') sock.write(`< REP 1 BATT_BARS ${state.bars} >`);
        else if (m === '< GET 1 TX_TYPE >') sock.write(`< REP 1 TX_TYPE ${state.txType} >`);
        else if (m === '< GET 1 CHAN_NAME >') sock.write(`< REP 1 CHAN_NAME ${state.name} >`);
        else if (m === '< GET 1 BATT_RUN_TIME >') sock.write(`< REP 1 BATT_RUN_TIME ${state.runTime} >`);
      }
    });
  });
  return {
    received, state,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => new Promise((r) => { if (client) client.destroy(); server.close(r); }),
  };
}

test('finds receivers from their announcements and ignores Wireless Workbench', () => {
  assert.deepEqual(wireless.parseAnnouncement(announcement('QLXD4', '192.168.1.40'), '192.168.1.40'), { ip: '192.168.1.40', model: 'QLXD4', cid: 'DD4D3D11-0000-11DD-A000-000EDDCCCCCC', id: 'DD4D3D11' });
  assert.equal(wireless.parseAnnouncement(announcement('QLXD: Rx', '192.168.1.41'), '10.0.0.9').ip, '192.168.1.41', 'the address in the announcement wins');
  assert.equal(wireless.parseAnnouncement(announcement('WWB6', '192.168.1.5'), '192.168.1.5'), null);
  assert.equal(wireless.parseAnnouncement(Buffer.from('junk'), '1.2.3.4'), null);
});

test('reads values, and Shure’s "not available" codes become empty', () => {
  const ch = {};
  wireless.applyValue(ch, 'BATT_BARS', '255'); assert.equal(ch.battBars, null);
  wireless.applyValue(ch, 'BATT_BARS', '003'); assert.equal(ch.battBars, 3);
  wireless.applyValue(ch, 'BATT_RUN_TIME', '65535'); assert.equal(ch.runTimeMin, null);
  wireless.applyValue(ch, 'AUDIO_GAIN', '028'); assert.equal(ch.gainDb, 10);
  wireless.applyValue(ch, 'FREQUENCY', '606700'); assert.equal(ch.frequency, '606.700');
  wireless.applyValue(ch, 'CHAN_NAME', '{Pastor  }'); assert.equal(ch.name, 'Pastor');
  wireless.applyValue(ch, 'TX_TYPE', 'UNKN'); assert.equal(ch.txType, null);
});

test('reads a receiver, follows what it reports, and only ever asks', async () => {
  const rx = standIn();
  wireless._setCommandPort(await rx.listen());
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }] });
    const ch = () => wireless.channelsForPages()[0];
    assert.ok(await until(() => ch() && ch().runTimeMin === 312), 'got the whole receiver, including a string split across packets');
    assert.equal(ch().name, 'Lead Voc');
    assert.equal(ch().battBars, 4);
    assert.equal(ch().txType, 'QLXD2');
    assert.equal(ch().frequency, '606.700');
    assert.equal(ch().transmitter, 'on');
    assert.equal(wireless.getStatus().receivers[0].firmware, '2.6.2');

    // A new pack goes in: the receiver says so by itself
    rx.say('< REP 1 BATT_BARS 001 >');
    assert.ok(await until(() => ch().battBars === 1));
    // Transmitter switched off
    rx.say('< REP 1 BATT_BARS 255 >< REP 1 TX_TYPE UNKN >');
    assert.ok(await until(() => ch().transmitter === 'off'));

    assert.ok(rx.received.length >= 2);
    assert.ok(rx.received.every((m) => /^< GET (\d )?[A-Z_]+ >$/.test(m)), `only GET strings were sent: ${rx.received.join(' ')}`);
  } finally { wireless.stop(); await rx.close(); }
});

test('a dropped receiver shows as offline and is read again when it comes back', async () => {
  const rx = standIn();
  const port = await rx.listen();
  wireless._setCommandPort(port);
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }] });
    const status = () => wireless.getStatus().receivers[0]?.status;
    assert.ok(await until(() => status() === 'connected'));
    const before = rx.received.length;
    rx.drop();
    assert.ok(await until(() => status() === 'offline'), 'shows offline');
    assert.ok(await until(() => status() === 'connected', 8000), 'reconnects by itself');
    assert.ok(await until(() => rx.received.slice(before).includes('< GET 1 ALL >')), 'reads it again');
  } finally { wireless.stop(); await rx.close(); }
});

test('nothing is read unless it is turned on and the receiver is ticked', async () => {
  const rx = standIn();
  wireless._setCommandPort(await rx.listen());
  try {
    wireless.applyConfig({ wirelessEnabled: false, wirelessReceivers: [{ ip: '127.0.0.1' }] });
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [] });
    await wait(400);
    assert.equal(rx.received.length, 0);
    assert.deepEqual(wireless.getStatus().receivers, []);
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: 'not-an-ip' }] });
    assert.deepEqual(wireless.getStatus().receivers, []);
  } finally { wireless.stop(); await rx.close(); }
});

test('the real receiver’s reply with no transmitter: a clean name, firmware, and nothing made up', async () => {
  const rx = realisticStandIn();
  wireless._setCommandPort(await rx.listen());
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }] });
    const ch = () => wireless.channelsForPages()[0];
    assert.ok(await until(() => ch() && ch().name === 'VOX 9'));
    assert.equal(wireless.getStatus().receivers[0].firmware, '2.3.22.0');
    assert.equal(ch().frequency, '484.000');
    assert.equal(ch().transmitter, 'off');
    for (const key of ['battBars', 'battState', 'runTimeMin', 'charge', 'battType', 'txType', 'txPower', 'txMuted']) assert.equal(ch()[key], null, `${key} stays empty, never 255 or 65535`);
  } finally { wireless.stop(); await rx.close(); }
});

test('battery is read again regularly: Good, Replace, Critical, and the last one after the transmitter goes off', async () => {
  const rx = realisticStandIn();
  wireless._setCommandPort(await rx.listen());
  wireless._setTimings(80, 5000);
  try {
    rx.state.bars = '005'; rx.state.txType = 'QLXD2';
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }] });
    const ch = () => wireless.channelsForPages()[0];
    assert.ok(await until(() => ch()?.battState === 'good'));
    assert.equal(ch().txType, 'QLXD2');
    // The receiver doesn't report these by itself here: only the re-reads find them
    rx.state.bars = '003';
    assert.ok(await until(() => ch().battState === 'replace'), 'a re-read finds the change');
    rx.state.bars = '001';
    assert.ok(await until(() => ch().battState === 'critical'));
    rx.state.bars = '255'; rx.state.txType = 'UNKN';
    assert.ok(await until(() => ch().transmitter === 'off'));
    assert.deepEqual(ch().lastBatt, { bars: 1, state: 'critical', minutesAgo: 0 }, 'what it was before it went off');
    rx.state.bars = '004'; rx.state.txType = 'QLXD1';
    assert.ok(await until(() => ch().battState === 'good'));
    assert.equal(ch().lastBatt, null, 'a transmitter back on shows its own battery');
    assert.ok(rx.received.filter((m) => m === '< GET 1 BATT_BARS >').length >= 3, 'it kept asking');
    assert.ok(rx.received.every((m) => /^< GET (\d )?[A-Z_]+ >$/.test(m)), `only GET strings, never METER_RATE or SET: ${[...new Set(rx.received)].join(' ')}`);
  } finally { wireless.stop(); wireless._setTimings(5000, 60000); await rx.close(); }
});

test('a receiver that stops answering without hanging up is reconnected', async () => {
  const rx = realisticStandIn();
  wireless._setCommandPort(await rx.listen());
  wireless._setTimings(60, 250);
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }] });
    const status = () => wireless.getStatus().receivers[0]?.status;
    assert.ok(await until(() => status() === 'connected'));
    rx.state.quiet = true;
    assert.ok(await until(() => status() === 'offline', 3000), 'silence counts as gone');
    rx.state.quiet = false;
    assert.ok(await until(() => status() === 'connected', 8000), 'and it comes back');
  } finally { wireless.stop(); wireless._setTimings(5000, 60000); await rx.close(); }
});

test('battery states follow Micboard’s levels', () => {
  assert.equal(wireless.batteryState(5), 'good');
  assert.equal(wireless.batteryState(4), 'good');
  assert.equal(wireless.batteryState(3), 'replace');
  assert.equal(wireless.batteryState(2), 'critical');
  assert.equal(wireless.batteryState(0), 'critical');
  assert.equal(wireless.batteryState(null), null);
});

// ── Remembering receivers, and which mix each mic belongs to ──
test('hardware ids: a cid and a MAC address give the same id', () => {
  assert.equal(wireless._idFromMac('00:0E:DD:4D:3C:7A'), 'DD4D3C7A');
  assert.equal(wireless.parseAnnouncement(announcement('QLXD4', '192.168.1.40'), '192.168.1.40').id, 'DD4D3D11');
});

test('a receiver seen once is remembered, still listed after a restart, and followed to a new address', async () => {
  const saves = [];
  wireless._noDiscovery(true);
  wireless.setSaver((patch) => saves.push(JSON.parse(JSON.stringify(patch))));
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [], wirelessKnown: [] });
    wireless._announce(announcement('QLXD4', '192.168.1.40'), '192.168.1.40');
    assert.ok(await until(() => saves.length > 0), 'saved for good');
    assert.deepEqual(saves.at(-1).wirelessKnown, [{ id: 'DD4D3D11', ip: '192.168.1.40', model: 'QLXD4' }]);

    // "Restart": a fresh config with only what was saved, and the receiver silent
    wireless.stop();
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '192.168.1.40', id: 'DD4D3D11' }], wirelessKnown: saves.at(-1).wirelessKnown });
    const listed = wireless.getStatus().discovered;
    assert.deepEqual(listed.map((d) => [d.ip, d.id, d.seenNow, d.watched]), [['192.168.1.40', 'DD4D3D11', false, true]], 'listed and read without announcing');

    // It comes back at a new address: followed, ticked or not
    saves.length = 0;
    wireless._announce(announcement('QLXD4', '192.168.1.77'), '192.168.1.77');
    assert.ok(await until(() => saves.length > 0));
    assert.deepEqual(saves.at(-1).wirelessReceivers, [{ ip: '192.168.1.77', id: 'DD4D3D11' }]);
    assert.deepEqual(saves.at(-1).wirelessKnown, [{ id: 'DD4D3D11', ip: '192.168.1.77', model: 'QLXD4' }]);
    assert.deepEqual(wireless.getStatus().receivers.map((r) => r.ip), ['192.168.1.77'], 'now read at its new address');
  } finally { wireless.stop(); wireless.setSaver(null); wireless._noDiscovery(false); }
});

test('a receiver added by address learns its hardware id from its MAC, and a mic can belong to a mix', async () => {
  const rx = realisticStandIn();
  wireless._setCommandPort(await rx.listen());
  wireless._noDiscovery(true);
  wireless._setTimings(60, 5000);
  const saves = [];
  wireless.setSaver((patch) => saves.push(JSON.parse(JSON.stringify(patch))));
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }], wirelessKnown: [], wirelessAux: { 'DD000001/1': 3 } });
    assert.ok(await until(() => saves.length > 0), 'remembered from its MAC address');
    assert.deepEqual(saves.at(-1).wirelessReceivers, [{ ip: '127.0.0.1', id: 'DD000001' }]);
    assert.equal(wireless.channelsForPages()[0].aux, 3);
    rx.state.bars = '002'; rx.state.txType = 'QLXD1';
    assert.ok(await until(() => wireless.mixesForPages()[3]?.[0]?.battState === 'critical'));
    const mic = wireless.mixesForPages()[3][0];
    assert.equal(mic.name, 'VOX 9');
    assert.equal(mic.ip, undefined, 'no addresses for the phones');
    assert.deepEqual(Object.keys(wireless.mixesForPages()), ['3']);
  } finally { wireless.stop(); wireless.setSaver(null); wireless._noDiscovery(false); wireless._setTimings(5000, 60000); await rx.close(); }
});

test('a mix chosen for a receiver added by address stays with it once its hardware id is known', async () => {
  const rx = realisticStandIn();
  wireless._setCommandPort(await rx.listen());
  wireless._noDiscovery(true);
  const saves = [];
  wireless.setSaver((patch) => saves.push(JSON.parse(JSON.stringify(patch))));
  try {
    // Chosen in Settings before the receiver had been read: keyed by its address
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }], wirelessKnown: [], wirelessAux: { '127.0.0.1/1': 4 } });
    assert.ok(await until(() => saves.length > 0), 'its MAC arrives and it is remembered');
    assert.deepEqual(saves.at(-1).wirelessAux, { 'DD000001/1': 4 }, 'the mix moved to the hardware id');
    assert.equal(wireless.channelsForPages()[0].aux, 4);
    // Settings saving its older copy (still by address) doesn't lose it either
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1', id: 'DD000001' }], wirelessKnown: saves.at(-1).wirelessKnown, wirelessAux: { '127.0.0.1/1': 4 } });
    assert.equal(wireless.channelsForPages()[0].aux, 4);
  } finally { wireless.stop(); wireless.setSaver(null); wireless._noDiscovery(false); await rx.close(); }
});

test('a multi-channel receiver added by address, model unknown, shows every channel it reports', async () => {
  const received = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('latin1');
    sock.on('data', (d) => { for (const m of d.match(/<[^>]*>/g) || []) {
      received.push(m);
      if (m === '< GET 0 ALL >') sock.write([1, 2, 3, 4].map((n) => `< REP ${n} CHAN_NAME {MIC ${n}   } >< REP ${n} BATT_BARS 00${n} >`).join(''));
    } });
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  wireless._setCommandPort(port);
  wireless._noDiscovery(true);
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [{ ip: '127.0.0.1' }], wirelessKnown: [] });
    assert.ok(await until(() => wireless.channelsForPages().length === 4), 'all four channels');
    assert.deepEqual(wireless.channelsForPages().map((c) => [c.name, c.battBars]), [['MIC 1', 1], ['MIC 2', 2], ['MIC 3', 3], ['MIC 4', 4]]);
    assert.ok(received.includes('< GET 0 ALL >'), 'asked for every channel at once');
    assert.ok(received.every((m) => /^< GET (\d )?[A-Z_]+ >$/.test(m)), 'still only GETs');
  } finally { wireless.stop(); wireless._noDiscovery(false); await new Promise((r) => server.close(r)); }
});

test('a receiver seen just before JPMixer quits is still saved', () => {
  const saves = [];
  wireless._noDiscovery(true);
  wireless.setSaver((patch) => saves.push(patch));
  try {
    wireless.applyConfig({ wirelessEnabled: true, wirelessReceivers: [], wirelessKnown: [] });
    wireless._announce(announcement('QLXD4', '192.168.1.41'), '192.168.1.41');
    wireless.stop(); // quitting inside the half-second save delay
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].wirelessKnown, [{ id: 'DD4D3D11', ip: '192.168.1.41', model: 'QLXD4' }]);
  } finally { wireless.setSaver(null); wireless._noDiscovery(false); }
});
