'use strict';
// Finding LV1 from its /zDNS announcements (shapes captured from LV1 17.3)
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const dgram = require('dgram');
const P = require('./lv1-protocol.js');
const discovery = require('./lv1-discovery.js');

// A TCP server that greets like LV1's MyMon service, or (greet: false) like
// MyFOH's screen mirroring, which LV1 announces too
function fakeService(greet) {
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    if (greet) sock.write(P.frame('/Notify/ServiceVersion', [{ t: 's', v: 'v.17.6.26.454' }, { t: 'i', v: 454 }, { t: 'i', v: 17 }, { t: 'i', v: 6 }]));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const announce = (service, port, addresses = ['192.168.2.146']) =>
  [service, 'a49e48a843c6a3b5b31ba0a9', 1, 'Mac', port, ...addresses.flatMap((a, i) => [a, 'en0', 11 + i]), 0];

test.afterEach(() => { discovery.close(); discovery._lastGood.clear(); discovery._lastScan.clear(); });

test('reads an announcement the way LV1 sends it', () => {
  const a = discovery.parseAnnouncement(['_waveslv113._tcp', '5e228d7247b7ac36ee7960d3', 1, 'Mac', 57390,
    'fe80::d8:67c4:22d6:8df9', 'en0', 11, '192.168.2.146', 'en0', 11, 2, '00:30:93:19:13:33', '00:30:93:19:13:35']);
  assert.deepEqual(a, { service: '_waveslv113._tcp', name: 'Mac', port: 57390, addresses: ['fe80::d8:67c4:22d6:8df9', '192.168.2.146'] });
  assert.equal(discovery.parseAnnouncement(['nope']), null);
});

test('finds the announced MyMon port and skips the screen-mirroring one', async () => {
  const mymon = await fakeService(true), mirror = await fakeService(false);
  try {
    discovery._noteAnnouncement(announce('_wavesremotelv1._tcp', mirror.address().port), '127.0.0.1');
    discovery._noteAnnouncement(announce('_waveslv113._tcp', mymon.address().port), '127.0.0.1');
    assert.deepEqual(await discovery.find('', { waitMs: 500 }), { host: '127.0.0.1', port: mymon.address().port });
  } finally { mymon.close(); mirror.close(); }
});

test('with an address in Settings, only that computer\'s LV1 counts', async () => {
  const mymon = await fakeService(true);
  try {
    discovery._noteAnnouncement(announce('_waveslv113._tcp', mymon.address().port, ['10.9.9.9']), '10.9.9.9');
    assert.equal(await discovery.find('192.0.2.1', { waitMs: 300, scanRange: [9, 9] }), null, 'a different LV1 is ignored');
  } finally { mymon.close(); }
});

test('an LV1 on another network is found by checking its ports, skipping ones that aren\'t LV1', async () => {
  const mymon = await fakeService(true), other = await fakeService(false);
  try {
    // Only these two: test files run side by side, and a wider sweep would
    // poke other tests' servers
    const ports = [other.address().port, mymon.address().port];
    assert.equal(await discovery._scan('127.0.0.1', { ports }), mymon.address().port);
  } finally { mymon.close(); other.close(); }
});

test('a computer with no LV1 is checked at most once a minute', async () => {
  const t0 = Date.now();
  assert.equal(await discovery.find('192.0.2.1', { waitMs: 200, scanRange: [9, 10] }), null);
  assert.ok(discovery._lastScan.has('192.0.2.1'));
  const t1 = Date.now();
  assert.equal(await discovery.find('192.0.2.1', { waitMs: 200, scanRange: [9, 10] }), null);
  assert.ok(Date.now() - t1 < Date.now() - t0 + 50, 'the second look skips the port check');
});

test('hears a real multicast announcement', async (t) => {
  const mymon = await fakeService(true);
  const sender = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  t.after(() => { mymon.close(); try { sender.close(); } catch (_) {} });
  discovery.listen();
  await new Promise(r => setTimeout(r, 300));
  sender.bind(0, () => {
    sender.setMulticastLoopback(true);
    try { sender.setMulticastInterface('127.0.0.1'); } catch (_) {}
    const msg = P.encodeMessage('/zDNS', announce('_waveslv199._tcp', mymon.address().port, ['127.0.0.1']).map(v => Number.isInteger(v) ? { t: 'i', v } : { t: 's', v }));
    const tick = setInterval(() => sender.send(msg, 13337, '225.1.1.1', () => {}), 200);
    t.after(() => clearInterval(tick));
  });
  const heard = await new Promise(r => {
    const end = Date.now() + 3000;
    const check = setInterval(() => {
      const hit = [...discovery._announcements.values()].find(a => a.service === '_waveslv199._tcp');
      if (hit || Date.now() > end) { clearInterval(check); r(hit); }
    }, 50);
  });
  if (!heard) { t.skip('this machine doesn\'t loop multicast back to itself'); return; }
  assert.equal(heard.port, mymon.address().port);
});
