'use strict';
// dlive-private.js against a stand-in console: one name lookup at a time
// (answers carry no name), a lookup with no answer drops the link (a late
// answer would answer the next one), the stereo flag needs a 2-byte value,
// and Patch's socket names are checked against the console's.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const DP = require('./dlive-private');
const { nameFits, socketsFromPatch } = require('./dlive-sockets');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (src, dst, type, payload = Buffer.alloc(0)) => { const h = Buffer.alloc(19); h[0] = 0xf1; h.writeUInt16BE(1, 1); h.writeUInt32BE(src, 3); h.writeUInt32BE(dst, 7); h.writeUInt32BE(type, 11); h.writeUInt32BE(payload.length, 15); return Buffer.concat([h, payload, Buffer.from([0xf8])]); };

test('lookups go one at a time, and one left unanswered drops the link instead of shifting the answers', async () => {
  const asked = []; let conns = 0; let silent = false;
  const server = net.createServer((s) => {
    conns++;
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!buf.length) break;
        const n = buf[0] === 0xf1 ? (buf.length >= 19 ? 20 + buf.readUInt32BE(15) : null) : buf[0] === 0xe0 ? (buf.length >= 3 ? 4 + buf.readUInt16BE(1) : null) : null;
        if (n === null || buf.length < n) break;
        const f = buf.subarray(0, n); buf = buf.subarray(n);
        if (f[0] !== 0xf1 || f.readUInt32BE(11) !== 4) continue;
        const name = f.subarray(19, n - 1).toString('latin1').replace(/\0/g, '');
        asked.push({ name, at: Date.now() });
        if (silent && name === 'B') continue; // never answered
        const id = Buffer.alloc(4); id.writeUInt32BE(name.charCodeAt(0));
        setTimeout(() => s.write(frame(1, 0, 2, id)), 30);
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const c = new DP.DlivePrivate({ host: '127.0.0.1', port: server.address().port });
  await new Promise((r) => { c.on('connect', r); c.connect(); });
  const [a, b, d] = await Promise.all([c.lookup('A'), c.lookup('B'), c.lookup('D')]);
  assert.deepEqual([a, b, d], [65, 66, 68], 'each answer is its own lookup\'s');
  assert.ok(asked[1].at - asked[0].at >= 25 && asked[2].at - asked[1].at >= 25, 'the next is only asked once the last is answered');
  // B goes unanswered: it resolves null and the link is opened again, so C can't get B's late answer
  silent = true;
  const closed = new Promise((r) => c.once('close', r));
  const lost = await c.lookup('B', 300);
  assert.equal(lost, null);
  await closed;
  assert.equal(c.connected, false, 'dropped');
  c.disconnect(); server.close();
  assert.ok(conns >= 1);
});

test('the stereo flag is only read from a 2-byte value', () => {
  assert.equal(DP.isStereoValue(0x0025, 2), true);
  assert.equal(DP.isStereoValue(0x0125, 2), false);
  assert.equal(DP.isStereoValue(0x01, 1), false, 'a 1-byte answer isn\'t that setting');
});

test('a preamp socket only while Patch\'s name for it fits the console\'s', () => {
  assert.equal(nameFits('Lead Vox', 'Lead Vox'), true);
  assert.equal(nameFits('Snare Top / Ch 40', 'snare top'), true, 'one of a socket\'s names, any case');
  assert.equal(nameFits('Lead Vox', 'Bass DI'), false, 're-patched since the import');
  assert.equal(nameFits('Ch 12', 'GTR'), true, 'a name Patch made up says nothing');
  assert.equal(nameFits('Lead Vox', ''), true, 'nor does a channel with no name');
  const map = socketsFromPatch({ boxes: [
    { id: 'dl-mixrack', model: 'ah-cdm48', ports: { 'in.3': { name: 'Kick', src: { kind: 'ch', n: 1 } } } },
    { id: 'my-dx', model: 'ah-dx168', ports: { 'in.1': { name: 'Snare', src: { kind: 'ch', n: 2 } } } },
    { id: 'dl-dx-2', model: 'ah-dx168', ports: { 'in.1': { name: 'Tom', src: { kind: 'ch', n: 3 } } } },
  ] });
  assert.deepEqual(map.get(1), [{ socket: 2, where: 'MixRack socket 3', name: 'Kick' }]);
  assert.equal(map.get(2), undefined, 'a DX drawn by hand: no preamp (which DX port it\'s on isn\'t known)');
  assert.deepEqual(map.get(3), [{ socket: 0x40 + 16, where: 'DX 17', name: 'Tom' }], 'the import\'s second DX is DX 17-32');
});
