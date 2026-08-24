'use strict';
// Integration test for wing-client.js against a real UDP socket standing in
// for a WING console, replying with the doc's own documented shapes.
// Run with: node src/server/wing-client.test.js

const dgram = require('dgram');
const assert = require('node:assert/strict');
const osc = require('osc');
const { WingClient } = require('./wing-client.js');

let n = 0;
function t(name) { n++; console.log('ok -', name); }

async function main() {
  const mock = dgram.createSocket('udp4');
  const received = [];
  let mockRemote = null;
  mock.on('message', (buf, rinfo) => {
    mockRemote = rinfo;
    const msg = osc.readMessage(buf);
    received.push(msg);
  });
  await new Promise((resolve) => mock.bind(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  const client = new WingClient({ host: '127.0.0.1', port: mockPort, getTimeoutMs: 800 });
  const opened = new Promise((resolve) => client.once('open', resolve));
  client.connect();
  await opened;
  t('client opens a local UDP socket');

  // ── SET: exact wire bytes match the doc's own worked example ───────────
  received.length = 0;
  client.setChannelFader(2, -3);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { address: '/ch/2/fdr', args: -3 }); // osc.readMessage unwraps a single arg
  t('setChannelFader sends the exact address+float the doc\'s worked example specifies');

  received.length = 0;
  client.setSendLevel(1, 2, -6);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(received[0], { address: '/ch/1/send/2/lvl', args: -6 });
  t('setSendLevel addresses the per-channel per-bus send');

  received.length = 0;
  client.setSendOn(1, 2, false);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(received[0], { address: '/ch/1/send/2/on', args: 0 });
  t('setSendOn sends a real per-send mute, not a level trick');

  // ── GET: mock replies with WING's documented sff/sfi/s reply shapes ────
  const send = (address, args) => {
    const packet = osc.writePacket({ address, args });
    mock.send(Buffer.from(packet), mockRemote.port, mockRemote.address);
  };

  {
    received.length = 0;
    const promise = client.getSendLevel(1, 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received[0].address, '/ch/1/send/2/lvl');
    assert.deepEqual(received[0].args, []); // GET = empty args
    // Reply with WING's documented 'sff' shape: [ascii label, raw 0..1, real dB value]
    send('/ch/1/send/2/lvl', ['-oo', 0.0, -144.0]);
    const value = await promise;
    assert.equal(value, -144.0);
    t('getSendLevel sends an empty-args GET and unwraps the real value from a sff reply');
  }

  {
    const promise = client.getChannelName(3);
    await new Promise((r) => setTimeout(r, 50));
    send('/ch/3/name', ['Kick']);
    const value = await promise;
    assert.equal(value, 'Kick');
    t('getChannelName unwraps a lone-string reply correctly');
  }

  {
    // No reply sent at all — must resolve null on timeout, not hang or throw.
    const start = Date.now();
    const value = await client.getBusName(99);
    const elapsed = Date.now() - start;
    assert.equal(value, null);
    assert.ok(elapsed >= 750 && elapsed < 2000, `expected a ~800ms timeout, got ${elapsed}ms`);
    t('a GET with no reply resolves null on timeout instead of hanging');
  }

  {
    // checkConnected(): a real round trip, unlike KLANG's "socket opened" proxy.
    const checkPromise = client.checkConnected();
    await new Promise((r) => setTimeout(r, 50));
    send('/ch/1/fdr', ['0.0', 0.5, -6.0]);
    assert.equal(await checkPromise, true);
    t('checkConnected resolves true on a real reply from the console');
  }

  // send() before connect() must not throw
  const unopened = new WingClient({ host: '127.0.0.1', port: mockPort });
  assert.equal(unopened.setChannelFader(1, 0), false);
  t('sending before connect() returns false instead of throwing');

  client.disconnect();
  mock.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
