'use strict';
// The LV1 connection: what it does with a port that isn't LV1's MyMon
// service, a garbled stream, and being stopped mid-connect.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const P = require('./lv1-protocol.js');
const { Lv1Client } = require('./lv1-client.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
function server(onSocket) {
  const s = net.createServer((sock) => { sock.on('error', () => {}); onSocket(sock); });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}
const client = (port, extra = {}) => new Lv1Client({ resolveTarget: async () => ({ host: '127.0.0.1', port }), deviceId: 'TEST', retryMs: 50, ...extra });

test('a port that never answers the handshake is dropped and tried again', async () => {
  let connections = 0;
  // Like MyFOH's screen-mirroring port: keeps sending, never a handshake
  const s = await server((sock) => { connections++; const t = setInterval(() => sock.write(Buffer.alloc(64, 7)), 50); sock.on('close', () => clearInterval(t)); });
  const c = client(s.address().port, { handshakeMs: 200 });
  const errors = []; c.on('error', e => errors.push(e.message));
  c.connect();
  await wait(700);
  c.disconnect(); s.close();
  assert.ok(connections >= 2, `reconnected (${connections} connections)`);
  assert.ok(errors.some(e => /handshake|garbled/.test(e)), 'and says why');
  assert.equal(c.connected, false);
});

test('a garbled stream drops the connection, and the next one works', async () => {
  let n = 0;
  const s = await server((sock) => {
    n++;
    const reader = new P.FrameReader();
    sock.on('data', (d) => {
      for (const m of reader.push(d)) if (m.address === '/handshake') {
        sock.write(P.frame('/handshake', [{ t: 'i', v: 1 }]));
        if (n === 1) { const bad = Buffer.alloc(12); bad.writeUInt32BE(0x7fffffff, 0); sock.write(bad); } // an impossible length
      }
    });
  });
  const c = client(s.address().port);
  let ups = 0, downs = 0;
  c.on('connected', () => ups++); c.on('disconnected', () => downs++); c.on('error', () => {});
  c.connect();
  await wait(600);
  c.disconnect(); s.close();
  assert.equal(n >= 2, true, 'reconnected after the garbled data');
  assert.ok(ups >= 2 && downs >= 1);
});

test('stopping mid-connect leaves nothing behind to reach LV1 later', async () => {
  let reached = 0;
  const s = await server(() => { reached++; });
  // A target that takes a moment: resolve, then connect starts
  const c = client(s.address().port);
  c.connect();
  await wait(0); await wait(0);
  c.disconnect();
  await wait(200);
  s.close();
  assert.equal(c._socket, null);
  assert.equal(c._pingTimer, null);
  assert.ok(reached <= 1);
});

test('the reader stops after an impossible frame instead of reading garbage', () => {
  const r = new P.FrameReader();
  const bad = Buffer.alloc(12); bad.writeUInt32BE(0x7fffffff, 0);
  assert.deepEqual(r.push(bad), []);
  assert.equal(r.lost, true);
  assert.deepEqual(r.push(P.msg.getSends(1)), [], 'nothing more is trusted');
});
