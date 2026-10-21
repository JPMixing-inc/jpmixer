'use strict';
// LV1 MyMon protocol: framing and the readers, checked against message
// shapes captured from a real LV1 17.3 show.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./lv1-protocol.js');

test('frames round-trip through the reader, even split across TCP chunks', () => {
  const bytes = Buffer.concat([P.msg.handshake(), P.msg.setSendGain(0, 12, 4, -40.5), P.msg.setSendOn(0, 12, 4, false), P.msg.ping(123456789n, 7)]);
  const reader = new P.FrameReader();
  const out = [];
  for (let o = 0; o < bytes.length; o += 5) out.push(...reader.push(bytes.subarray(o, o + 5)));
  assert.deepEqual(out.map(m => [m.address, m.args]), [
    ['/handshake', [1, -1, 1]],
    ['/Set/Aux/Send/Gain', [0, 12, 4, -40.5]],
    ['/Set/Aux/Send/On', [0, 12, 4, false]],
    ['/ping', ['123456789', 7]],
  ]);
});

test('the frame header is length, 2, 0 — as LV1 sends it', () => {
  const f = P.msg.getSends(4);
  assert.equal(f.readUInt32BE(0), f.length - 12);
  assert.equal(f.readUInt32BE(4), 2);
  assert.equal(f.readUInt32BE(8), 0);
  // LV1's own greeting, byte for byte from a capture
  const greeting = Buffer.from('0000003c00000002000000002f4e6f746966792f5365727669636556657273696f6e00002c73696969000000762e31372e362e32362e343534000000000001c60000001100000006', 'hex');
  const [m] = new P.FrameReader().push(greeting);
  assert.deepEqual([m.address, m.args], ['/Notify/ServiceVersion', ['v.17.6.26.454', 454, 17, 6]]);
});

test('a pong echoes the ping it answers', () => {
  const [ping] = new P.FrameReader().push(P.msg.ping('790076257280833', 4043));
  const [pong] = new P.FrameReader().push(P.msg.pong(ping.args));
  assert.deepEqual([pong.address, pong.args], ['/pong', ['790076257280833', 4043]]);
});

test('levels and pans are kept inside what LV1 accepts', () => {
  const [hi] = new P.FrameReader().push(P.msg.setSendGain(0, 0, 0, 50));
  const [lo] = new P.FrameReader().push(P.msg.setSendGain(0, 0, 0, -1000));
  const [pan] = new P.FrameReader().push(P.msg.setSendPan(0, 0, 0, 1000));
  assert.equal(hi.args[3], 10); assert.equal(lo.args[3], -144); assert.equal(pan.args[3], 45);
  assert.throws(() => P.msg.setSendGain(0, 0, 0, NaN));
  assert.equal(P.panToSlider(-45), 0); assert.equal(P.panToSlider(0), 0.5); assert.equal(P.panFromSlider(1), 45);
});

test('a garbled frame is skipped and the next one still reads', () => {
  const bad = Buffer.alloc(16); bad.writeUInt32BE(4, 0); bad.writeUInt32BE(2, 4); bad.write('nope', 12);
  const out = new P.FrameReader().push(Buffer.concat([bad, P.msg.getSends(3)]));
  assert.deepEqual(out.map(m => m.address), ['/Get/Sends']);
});

test('readers decode the show messages captured from LV1', () => {
  // /Channels: count, then 19 values per track starting name, type, index
  const ch = [3, 'OVERHEADS', 0, 0, -9.3, 0, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 2, '65793', 0,
    'EG 1', 0, 7, -10.3, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, 0, 2, '65796', -15,
    'BC BAND', 2, 4, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1, 0, 2, '65796', 0];
  assert.deepEqual(P.parseChannels(ch), [
    { name: 'OVERHEADS', type: 0, index: 0, gain: -9.3, mute: false, stereo: true },
    { name: 'EG 1', type: 0, index: 7, gain: -10.3, mute: false, stereo: true },
    { name: 'BC BAND', type: 2, index: 4, gain: 0, mute: false, stereo: true },
  ]);
  // A mono monitor mix from a real 80-channel show: 1 mono, 2 stereo
  const mono = ['MON 12', 25, 11, 0, 0, 0, 0, -1, -1, -1, -1, -1, 1, -1, -1, 0, 1, '0', 0];
  assert.equal(P.parseChannels([1, ...mono])[0].stereo, false);
  // The 7th value is the track's mute (seen flipping 0 → 1 on a real LV1)
  const muted = ['Channel 10', 0, 9, -144, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 2, '65794', 0];
  assert.equal(P.parseChannels([1, ...muted])[0].mute, true);
  assert.deepEqual(P.parseAuxTracks([2, 0, 2, 'DRUM VERB', 1, 2, 'BC BAND']), [{ index: 0, kind: 2, name: 'DRUM VERB' }, { index: 1, kind: 2, name: 'BC BAND' }]);
  assert.deepEqual(P.parseSends([4, 3, 0, 7, -5.9, 0, 8, -5.8, 2, 0, -144]).sends.map(s => [s.srcType, s.src, s.value]), [[0, 7, -5.9], [0, 8, -5.8], [2, 0, -144]]);
  assert.deepEqual(P.parseSends([4, 2, 0, 7, true, -20, 0, 8, true, 20], 4).sends.map(s => s.value), [-20, 20]);
  assert.deepEqual(P.parseSceneList([2, 0, 'Kill Tune', 1, 'SONG 1']), [{ index: 0, name: 'Kill Tune' }, { index: 1, name: 'SONG 1' }]);
});
