'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const osc = require('osc');
const P = require('./m32-protocol.js');

test('the fader scale matches the protocol document\'s points', () => {
  for (const [f, db] of [[0.0625, -60], [0.25, -30], [0.5, -10], [0.75, 0], [1, 10]]) {
    assert.equal(P.levelToDb(f), db, `${f} is ${db} dB`);
    assert.ok(Math.abs(P.dbToLevel(db) - f) < 1e-9, `${db} dB is ${f}`);
  }
  assert.equal(P.levelToDb(0), P.OFF_DB, '0 is off');
  assert.equal(P.dbToLevel(-150), 0);
  assert.equal(P.dbToLevel(-90), 0);
  assert.equal(P.dbToLevel(20), 1, 'past +10 dB stops at the top');
  for (let db = -89; db <= 10; db += 0.5) assert.ok(Math.abs(P.levelToDb(P.dbToLevel(db)) - db) < 0.01, `${db} dB round trips`);
});

test('channels 1-48 are the input channels, aux ins and FX returns', () => {
  assert.equal(P.inputPath(1), '/ch/01');
  assert.equal(P.inputPath(32), '/ch/32');
  assert.equal(P.inputPath(33), '/auxin/01');
  assert.equal(P.inputPath(41), '/fxrtn/01');
  assert.equal(P.inputPath(48), '/fxrtn/08');
  assert.throws(() => P.inputPath(49), RangeError);
  assert.equal(P.ADDR.sendLevel(34, 16), '/auxin/02/mix/16/level');
  assert.equal(P.ADDR.busLink(1), '/config/buslink/1-2');
  assert.equal(P.ADDR.busLink(8), '/config/buslink/15-16');
  assert.equal(P.ADDR.solo('cg', 1), '/-stat/solosw/73');
  assert.equal(P.ADDR.solo('input', 41), '/-stat/solosw/41');
  assert.equal(P.ADDR.stripFader('cg', 2), '/dca/2/fader');
  assert.equal(P.ADDR.showName('scene', 5), '/-show/showfile/scene/005/name');
});

test('values go out with the types the console expects', () => {
  const bytes = (m) => Buffer.from(osc.writePacket(m)).toString('latin1');
  assert.ok(bytes(P.sendLevel(1, 1, 1)).includes(',f'), 'a level of 1 is a float, not an integer');
  assert.ok(bytes(P.sendLevel(1, 1, 0)).includes(',f'));
  assert.ok(bytes(P.sendOn(1, 1, true)).includes(',i'));
  assert.deepEqual(P.sendOn(3, 2, false), { address: '/ch/03/mix/02/on', args: [{ type: 'i', value: 0 }] });
  assert.deepEqual(P.stripOn('aux', 4, false), { address: '/bus/04/mix/on', args: [{ type: 'i', value: 0 }] });
  assert.deepEqual(P.solo('cg', 8, true), { address: '/-stat/solosw/80', args: [{ type: 'i', value: 1 }] });
  assert.equal(P.sendPan(1, 1, 2).args[0].value, 1, 'kept to 0..1');
  assert.deepEqual(P.get('/xinfo'), { address: '/xinfo', args: [] });
});

test('reads what the console sends', () => {
  assert.deepEqual(P.parseMessage('/ch/02/mix/03/level', [0.5]), { kind: 'send-level', ch: 2, bus: 3, level: 0.5, db: -10 });
  assert.deepEqual(P.parseMessage('/auxin/01/mix/01/on', [0]), { kind: 'send-on', ch: 33, bus: 1, on: false });
  assert.deepEqual(P.parseMessage('/fxrtn/08/mix/15/pan', [0.25]), { kind: 'send-pan', ch: 48, bus: 15, pan: 0.25 });
  assert.deepEqual(P.parseMessage('/ch/01/config/name', ['KICK ']), { kind: 'name', strip: 'input', n: 1, name: 'KICK' });
  assert.deepEqual(P.parseMessage('/bus/16/config/name', ['IEM']), { kind: 'name', strip: 'aux', n: 16, name: 'IEM' });
  assert.deepEqual(P.parseMessage('/dca/3/config/name', ['VOX']), { kind: 'name', strip: 'cg', n: 3, name: 'VOX' });
  assert.deepEqual(P.parseMessage('/config/buslink/3-4', [1]), { kind: 'bus-link', pair: 2, linked: true });
  assert.deepEqual(P.parseMessage('/ch/05/mix/fader', [0.75]), { kind: 'strip', strip: 'input', n: 5, what: 'fader', db: 0, level: 0.75 });
  assert.deepEqual(P.parseMessage('/bus/02/mix/on', [0]), { kind: 'strip', strip: 'aux', n: 2, what: 'on', muted: true });
  assert.deepEqual(P.parseMessage('/dca/8/on', [1]), { kind: 'strip', strip: 'cg', n: 8, what: 'on', muted: false });
  assert.deepEqual(P.parseMessage('/-stat/solosw/74', [1]), { kind: 'solo', strip: 'cg', n: 2, on: true });
  assert.deepEqual(P.parseMessage('/-stat/solosw/50', [1]), { kind: 'solo', strip: 'aux', n: 2, on: true });
  assert.deepEqual(P.parseMessage('/-show/prepos/current', [12]), { kind: 'show-position', n: 12 });
  assert.deepEqual(P.parseMessage('/xinfo', ['192.168.1.20', 'FOH', 'M32', '4.06']), { kind: 'info', ip: '192.168.1.20', name: 'FOH', model: 'M32', firmware: '4.06' });
  // Out of range, the wrong type, or something JPMixer doesn't use
  assert.equal(P.parseMessage('/ch/33/mix/01/level', [0.5]), null);
  assert.equal(P.parseMessage('/ch/01/mix/17/level', [0.5]), null);
  assert.equal(P.parseMessage('/ch/01/mix/01/level', ['x']), null);
  assert.equal(P.parseMessage('/ch/01/mix/01/on', [0.5]), null);
  assert.equal(P.parseMessage('/config/buslink/2-3', [1]), null);
  assert.equal(P.parseMessage('/ch/01/eq/1/g', [0.5]), null);
  assert.equal(P.parseMessage(undefined, []), null);
});
