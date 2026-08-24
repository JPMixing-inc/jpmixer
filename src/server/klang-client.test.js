'use strict';
// Integration test for klang-client.js against a real UDP socket — same
// shape as dlive-client.test.js one layer down, just UDP instead of TCP
// since that's what KLANG's OSC transport actually is.
// Run with: node src/server/klang-client.test.js

const dgram = require('dgram');
const assert = require('node:assert/strict');
const osc = require('osc');
const { KlangClient } = require('./klang-client.js');

let n = 0;
function t(name) { n++; console.log('ok -', name); }

async function main() {
  const mock = dgram.createSocket('udp4');
  const received = [];
  mock.on('message', (buf) => received.push(osc.readMessage(buf)));
  await new Promise((resolve) => mock.bind(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  const client = new KlangClient({ host: '127.0.0.1', port: mockPort });
  const opened = new Promise((resolve) => client.once('open', resolve));
  client.connect();
  await opened;
  t('client opens a local UDP socket');

  // osc.readMessage() unpacks a single-argument message's args to a bare
  // scalar by default (options.unpackSingleArgs) rather than a 1-element
  // array — a decode-side convenience of the library, not a wire-format
  // difference; every message here happens to carry exactly one argument.
  client.setGain(1, 2, -11);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(received[0], { address: '/Kf/ui/1/ch/2/gaindB', args: -11 });
  t('setGain sends the exact address+float the doc\'s worked example specifies');

  received.length = 0;
  client.setMute(1, 3, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(received[0].address, '/Kf/ui/1/ch/3/mute');
  assert.equal(received[0].args, true);
  t('setMute sends a real OSC boolean arg over the wire');

  received.length = 0;
  client.setPan(2, 1, -45);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(received[0], { address: '/Kf/ui/2/ch/1/azi', args: -45 });
  t('setPan sends azi for the stereo pan model');

  // send() before connect() must not throw — this is a fire-and-forget
  // transport with no connection state; a caller getting the order wrong
  // should get false back, not an exception.
  const unopened = new KlangClient({ host: '127.0.0.1', port: mockPort });
  assert.equal(unopened.setGain(1, 1, 0), false);
  t('sending before connect() returns false instead of throwing');

  client.disconnect();
  mock.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
