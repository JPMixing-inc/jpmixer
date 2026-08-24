'use strict';
// Regression test for dlive-protocol.js's byte-level correctness against the
// official "dLive MIDI Over TCP/IP Protocol, Firmware V2.0" spec. Run with:
//   node src/server/dlive-protocol.test.js
// No test framework/dependency — matches this project's existing (zero) test
// tooling, just plain assert.

const assert = require('node:assert/strict');
const P = require('./dlive-protocol.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

// ── Channel coordinate math (from the spec's prose rules, page 2) ────────
t('input 1 -> {N, 0x00}',   () => assert.deepEqual(P.coordinate(0, 'input', 1),   { midiCh: 0, ch: 0x00 }));
t('input 128 -> {N, 0x7F}', () => assert.deepEqual(P.coordinate(0, 'input', 128), { midiCh: 0, ch: 0x7F }));
t('monoGroup 1 -> {N+1, 0x00}',   () => assert.deepEqual(P.coordinate(0, 'monoGroup', 1),   { midiCh: 1, ch: 0x00 }));
t('monoGroup 62 -> {N+1, 0x3D}',  () => assert.deepEqual(P.coordinate(0, 'monoGroup', 62),  { midiCh: 1, ch: 0x3D }));
t('stereoGroup 1 -> {N+1, 0x40}', () => assert.deepEqual(P.coordinate(0, 'stereoGroup', 1), { midiCh: 1, ch: 0x40 }));
t('stereoGroup 31 -> {N+1, 0x5E}',() => assert.deepEqual(P.coordinate(0, 'stereoGroup', 31),{ midiCh: 1, ch: 0x5E }));
t('monoAux 1 -> {N+2, 0x00}',     () => assert.deepEqual(P.coordinate(0, 'monoAux', 1),     { midiCh: 2, ch: 0x00 }));
t('stereoAux 31 -> {N+2, 0x5E}',  () => assert.deepEqual(P.coordinate(0, 'stereoAux', 31),  { midiCh: 2, ch: 0x5E }));
t('monoFxSend 1 -> {N+4, 0x00}',  () => assert.deepEqual(P.coordinate(0, 'monoFxSend', 1),  { midiCh: 4, ch: 0x00 }));
t('stereoFxSend 1 -> {N+4, 0x10}',() => assert.deepEqual(P.coordinate(0, 'stereoFxSend', 1),{ midiCh: 4, ch: 0x10 }));
t('fxReturn 1 -> {N+4, 0x20}',    () => assert.deepEqual(P.coordinate(0, 'fxReturn', 1),    { midiCh: 4, ch: 0x20 }));
t('main 1 -> {N+4, 0x30}',        () => assert.deepEqual(P.coordinate(0, 'main', 1),        { midiCh: 4, ch: 0x30 }));
t('main 6 -> {N+4, 0x35}',        () => assert.deepEqual(P.coordinate(0, 'main', 6),        { midiCh: 4, ch: 0x35 }));
t('dca 1 -> {N+4, 0x36}',         () => assert.deepEqual(P.coordinate(0, 'dca', 1),         { midiCh: 4, ch: 0x36 }));
t('dca 24 -> {N+4, 0x4D}',        () => assert.deepEqual(P.coordinate(0, 'dca', 24),        { midiCh: 4, ch: 0x4D }));
t('muteGroup 1 -> {N+4, 0x4E}',   () => assert.deepEqual(P.coordinate(0, 'muteGroup', 1),   { midiCh: 4, ch: 0x4E }));
t('muteGroup 8 -> {N+4, 0x55}',   () => assert.deepEqual(P.coordinate(0, 'muteGroup', 8),   { midiCh: 4, ch: 0x55 }));
t('stereoUfxSend 1 -> {N+4, 0x56}', () => assert.deepEqual(P.coordinate(0, 'stereoUfxSend', 1), { midiCh: 4, ch: 0x56 }));
t('stereoUfxReturn 1 -> {N+4, 0x5E}', () => assert.deepEqual(P.coordinate(0, 'stereoUfxReturn', 1), { midiCh: 4, ch: 0x5E }));
t('baseN offsets carry through (baseN=7)', () => assert.deepEqual(P.coordinate(7, 'monoAux', 1), { midiCh: 9, ch: 0x00 }));
t('out-of-range input rejected', () => assert.throws(() => P.coordinate(0, 'input', 129)));
t('out-of-range baseN rejected', () => assert.throws(() => P.coordinate(12, 'input', 1)));

// ── Fader dB <-> LV anchor points (spec page 9 table, exact) ─────────────
// +5dB is 0x75 (117 dec) here, not the 0x74 an earlier revision of this file
// had — cross-checked against bitfocus/companion-module-allenheath-dlive-ilive,
// a real independent implementation, after 0x74 broke the otherwise-exact
// 0.5dB/LV line every other anchor sits on. See dlive-protocol.js's comment
// on dbToLv/lvToDb.
const ANCHORS = [[-Infinity,0x00],[-45,0x11],[-40,0x1B],[-35,0x25],[-30,0x2F],[-25,0x39],
                 [-20,0x43],[-15,0x4D],[-10,0x57],[-5,0x61],[0,0x6B],[5,0x75],[10,0x7F]];
for (const [db, lv] of ANCHORS) {
  t(`dbToLv(${db}) === 0x${lv.toString(16)}`, () => assert.equal(P.dbToLv(db), lv));
  t(`lvToDb(0x${lv.toString(16)}) === ${db}`, () => assert.equal(P.lvToDb(lv), db));
}
t('dbToLv clamps above +10', () => assert.equal(P.dbToLv(20), 0x7F));
t('lvToDb clamps above 0x7F', () => assert.equal(P.lvToDb(200), 10));

// ── Message builders match the spec's byte layouts exactly ───────────────
t('buildFaderSet layout', () => {
  const msg = P.buildFaderSet(3, 0x05, 0x6B);
  assert.deepEqual(msg, [0xB3, 0x63, 0x05, 0xB3, 0x62, 0x17, 0xB3, 0x06, 0x6B]);
});
// Real bytes captured with a MIDI sniffer against an actual dLive console
// (forum.bome.com/t/connect-fader-midi-device-to-allen-and-heath-dlive/4049)
// for a Stereo Aux 1 send level — not just spec-derived, this is what the
// hardware genuinely accepted. Matches this file's math exactly.
t('buildSendLevelSet matches a real MIDI-sniffer capture from actual dLive hardware', () => {
  const stereoAux1 = P.coordinate(0, 'stereoAux', 1);
  const built = P.buildSendLevelSet(0, 0x00, stereoAux1, 0x50);
  assert.deepEqual(built, [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00, 0x00, 0x0D, 0x00, 0x02, 0x40, 0x50, 0xF7]);
});
t('buildMuteOn layout', () => {
  assert.deepEqual(P.buildMuteOn(0x0B, 0x00), [0x9B, 0x00, 0x7F, 0x9B, 0x00, 0x00]);
});
t('buildMuteOff layout', () => {
  assert.deepEqual(P.buildMuteOff(0x0B, 0x00), [0x9B, 0x00, 0x3F, 0x9B, 0x00, 0x00]);
});
t('buildSendLevelSet embeds both coordinates', () => {
  const snd = P.coordinate(0, 'monoAux', 3); // {midiCh:2, ch:0x02}
  const msg = P.buildSendLevelSet(0, 0x04, snd, 0x6B);
  assert.deepEqual(msg, [...P.SYSEX_HEADER, 0x00, 0x0D, 0x04, 0x02, 0x02, 0x6B, 0xF7]);
});
t('buildSceneRecall: scene 1 -> bank 0, ss 0x00', () => {
  assert.deepEqual(P.buildSceneRecall(0, 1), [0xB0, 0x00, 0x00, 0xC0, 0x00]);
});
t('buildSceneRecall: scene 128 -> bank 0, ss 0x7F', () => {
  assert.deepEqual(P.buildSceneRecall(0, 128), [0xB0, 0x00, 0x00, 0xC0, 0x7F]);
});
t('buildSceneRecall: scene 129 -> bank 1, ss 0x00', () => {
  assert.deepEqual(P.buildSceneRecall(0, 129), [0xB0, 0x00, 0x01, 0xC0, 0x00]);
});
// Spec explicitly states "Scene 385 to 500 = 00 to 73" for bank 3 — cross-check the top end.
t('buildSceneRecall: scene 500 -> bank 3, ss 0x73 (matches spec\'s stated upper bound)', () => {
  assert.deepEqual(P.buildSceneRecall(0, 500), [0xB0, 0x00, 0x03, 0xC0, 0x73]);
});
t('decodeSceneNumber round-trips', () => {
  for (const s of [1, 128, 129, 256, 257, 384, 385, 500]) {
    const [, , bank, , ss] = P.buildSceneRecall(0, s);
    assert.equal(P.decodeSceneNumber(bank, ss), s);
  }
});
t('buildSceneRecall rejects out-of-range', () => {
  assert.throws(() => P.buildSceneRecall(0, 0));
  assert.throws(() => P.buildSceneRecall(0, 501));
});
t('buildSceneRecall rejects an out-of-range baseN too', () => {
  // Scene recall doesn't go through coordinate() at all — it bit-ORs baseN
  // straight into the MIDI status byte, so an unvalidated baseN would
  // silently corrupt the status byte instead of erroring.
  assert.throws(() => P.buildSceneRecall(-1, 1));
  assert.throws(() => P.buildSceneRecall(12, 1));
});

// ── Stream decoder: the doc's own running-status example ─────────────────
// "turning Mute on for Inputs 1, 2 and 3 on MIDI channel 12" (channel 12 = index 0xB)
// Running-status form: 9B,00,7F,01,7F,02,7F  (status omitted for msgs 2 and 3)
t('decoder handles running status exactly like the spec\'s own example', () => {
  const d = new P.Decoder();
  const out = d.push(Buffer.from([0x9B, 0x00, 0x7F, 0x01, 0x7F, 0x02, 0x7F]));
  assert.deepEqual(out, [
    { type: 'noteOn', midiCh: 0x0B, note: 0x00, velocity: 0x7F },
    { type: 'noteOn', midiCh: 0x0B, note: 0x01, velocity: 0x7F },
    { type: 'noteOn', midiCh: 0x0B, note: 0x02, velocity: 0x7F },
  ]);
});
t('decoder handles a message split across two TCP chunks', () => {
  const d = new P.Decoder();
  // First noteOn full, second via running status (note=00, vel=00 — the noteOff half of a Mute ON pair)
  const full = Buffer.from([0x9B, 0x00, 0x7F, 0x00, 0x00]);
  assert.deepEqual(d.push(full.slice(0, 2)), []); // status+note only, incomplete
  assert.deepEqual(d.push(full.slice(2)), [
    { type: 'noteOn', midiCh: 0x0B, note: 0x00, velocity: 0x7F },
    { type: 'noteOn', midiCh: 0x0B, note: 0x00, velocity: 0x00 },
  ]);
});
t('decoder round-trips a SysEx send-level message', () => {
  const d = new P.Decoder();
  const snd = P.coordinate(0, 'monoAux', 3);
  const wire = P.buildSendLevelSet(0, 0x04, snd, 0x6B);
  const out = d.push(Buffer.from(wire));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'sysex');
  assert.deepEqual(out[0].bytes, wire.slice(1, -1)); // between F0 and F7
});
t('decoder handles a SysEx message split across chunks', () => {
  const d = new P.Decoder();
  const wire = Buffer.from(P.buildFaderGet(0, 0x05));
  const mid = Math.floor(wire.length / 2);
  assert.deepEqual(d.push(wire.slice(0, mid)), []);
  const out = d.push(wire.slice(mid));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'sysex');
});

// ── NRPN reassembler: round-trip a fader-set message through decode+reassemble ──
t('NrpnReassembler reconstructs a fader-set event from decoded CCs', () => {
  const decoder = new P.Decoder();
  const reassembler = new P.NrpnReassembler();
  const wire = P.buildFaderSet(3, 0x05, 0x6B);
  const events = decoder.push(Buffer.from(wire));
  assert.equal(events.length, 3);
  let result = null;
  for (const e of events) result = reassembler.feed(e) || result;
  assert.deepEqual(result, { midiCh: 3, ch: 0x05, param: P.PARAM.FADER_LEVEL, value: 0x6B });
});
t('NrpnReassembler tracks multiple MIDI channels independently', () => {
  const decoder = new P.Decoder();
  const reassembler = new P.NrpnReassembler();
  const wireA = P.buildFaderSet(0, 0x01, 0x50);
  const wireB = P.buildFaderSet(1, 0x02, 0x60);
  // Interleave the two channels' messages, like two concurrent fader moves would arrive.
  const interleaved = [];
  for (let i = 0; i < 9; i += 3) {
    interleaved.push(...wireA.slice(i, i + 3), ...wireB.slice(i, i + 3));
  }
  const events = decoder.push(Buffer.from(interleaved));
  const results = events.map(e => reassembler.feed(e)).filter(Boolean);
  assert.deepEqual(results, [
    { midiCh: 0, ch: 0x01, param: P.PARAM.FADER_LEVEL, value: 0x50 },
    { midiCh: 1, ch: 0x02, param: P.PARAM.FADER_LEVEL, value: 0x60 },
  ]);
});

t('NrpnReassembler correctly separates two channels interleaved by phase on the same bank', () => {
  // Same midiCh for both — unlike the "tracks multiple MIDI channels
  // independently" test above, this is the actual risk case: two channels
  // on the *same* bank, with all CC99s arriving before either CC98, then
  // all CC98s before either CC6 — not two whole triples interleaved, but
  // interleaved by phase. A single-slot reassembler would let channel B's
  // CC99 clobber channel A's pending entry before A's CC6 ever arrives.
  const reassembler = new P.NrpnReassembler();
  const wireA = P.buildFaderSet(0, 5,  0x50); // channel select 5,  value 0x50
  const wireB = P.buildFaderSet(0, 80, 0x20); // channel select 80, value 0x20
  const decoder = new P.Decoder();
  const evA = decoder.push(Buffer.from(wireA));
  const evB = new P.Decoder().push(Buffer.from(wireB)); // separate decoder, just to get the 3 cc events cleanly
  const phased = [evA[0], evB[0], evA[1], evB[1], evA[2], evB[2]]; // CC99,CC99,CC98,CC98,CC6,CC6
  const results = phased.map(e => reassembler.feed(e)).filter(Boolean);
  assert.deepEqual(results, [
    { midiCh: 0, ch: 5,  param: P.PARAM.FADER_LEVEL, value: 0x50 },
    { midiCh: 0, ch: 80, param: P.PARAM.FADER_LEVEL, value: 0x20 },
  ]);
});

// ── Colour mapping ─────────────────────────────────────────────────────
t('nearestColourIndex picks exact matches', () => {
  P.COLOURS.forEach((hex, idx) => assert.equal(P.nearestColourIndex(hex), idx));
});

// ── TLS auth message — no literal comma byte, just profile + password ASCII ──
t('buildTlsAuthMessage: profile byte directly followed by password bytes', () => {
  const msg = P.buildTlsAuthMessage(3, 'hunter2');
  assert.deepEqual(msg, [3, ...Buffer.from('hunter2', 'ascii')]);
  assert.ok(!msg.includes(0x2C), 'must not contain a literal comma byte (0x2C) — that was the bug');
});
t('buildTlsAuthMessage: empty password is just the profile byte', () => {
  assert.deepEqual(P.buildTlsAuthMessage(0, ''), [0]);
});
t('buildTlsAuthMessage: clamps profile to the documented 00-1F range', () => {
  assert.equal(P.buildTlsAuthMessage(999, 'x')[0], 0x1F);
  assert.equal(P.buildTlsAuthMessage(-5, 'x')[0], 0x00);
});

console.log(`\n${n} tests passed`);
