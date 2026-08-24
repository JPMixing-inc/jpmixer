'use strict';
// Regression test for wing-protocol.js's message shapes against Behringer's
// own "OSC Documentation for WING" (wing-docs.com/pdf/OSC_Documentation.pdf).
// Run with: node src/server/wing-protocol.test.js

const assert = require('node:assert/strict');
const W = require('./wing-protocol.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

// ── The doc's own worked examples, verbatim ────────────────────────────────
// "changing channel 2 fader position to -2 or -3dB":
//   ->W, 20 B: /ch/2/fdr~~~,s~~-2~
//   ->W, 20 B: /ch/2/fdr~~~,f~~[-3.0000]
t('channelFaderSet matches the doc\'s own worked example', () => {
  assert.deepEqual(W.channelFaderSet(2, -3), { address: '/ch/2/fdr', args: [-3] });
});

// "requesting the mute state of channel strip 1": /ch/1/mute
t('channelMuteSet builds the documented address', () => {
  assert.deepEqual(W.channelMuteSet(1, true),  { address: '/ch/1/mute', args: [1] });
  assert.deepEqual(W.channelMuteSet(1, false), { address: '/ch/1/mute', args: [0] });
});

t('channelFaderSet/channelMuteSet reject a non-positive-int channel', () => {
  assert.throws(() => W.channelFaderSet(0, -3), RangeError);
  assert.throws(() => W.channelFaderSet(-1, -3), RangeError);
  assert.throws(() => W.channelFaderSet(1.5, -3), RangeError);
});

t('channelFaderSet rejects a non-finite dB', () => {
  assert.throws(() => W.channelFaderSet(1, NaN), RangeError);
  assert.throws(() => W.channelFaderSet(1, Infinity), RangeError);
});

// ── Send (channel -> bus) addressing, from the appendix's ch.N.send.M tree ──
t('sendLevelSet addresses the per-channel per-bus send, not the channel itself', () => {
  assert.deepEqual(W.sendLevelSet(1, 2, -6), { address: '/ch/1/send/2/lvl', args: [-6] });
});

t('sendPanSet addresses a real per-send pan — WING has one, unlike dLive', () => {
  assert.deepEqual(W.sendPanSet(1, 2, -45), { address: '/ch/1/send/2/pan', args: [-45] });
});

t('sendOnSet is a real per-send mute, not a level-zeroing trick', () => {
  assert.deepEqual(W.sendOnSet(1, 2, false), { address: '/ch/1/send/2/on', args: [0] });
  assert.deepEqual(W.sendOnSet(1, 2, true),  { address: '/ch/1/send/2/on', args: [1] });
});

t('send builders reject a non-positive-int bus number', () => {
  assert.throws(() => W.sendLevelSet(1, 0, -6), RangeError);
  assert.throws(() => W.sendPanSet(1, -1, 0), RangeError);
});

// ── GET (query) messages — empty args, per the doc's own examples ─────────
t('getMessage sends an empty-args query', () => {
  assert.deepEqual(W.getMessage('/ch/1/fdr'), { address: '/ch/1/fdr', args: [] });
});
t('sendLevelGet/sendPanGet/channelNameGet/busNameGet build correct GET addresses', () => {
  assert.deepEqual(W.sendLevelGet(1, 2), { address: '/ch/1/send/2/lvl', args: [] });
  assert.deepEqual(W.sendPanGet(1, 2),   { address: '/ch/1/send/2/pan', args: [] });
  assert.deepEqual(W.channelNameGet(3),  { address: '/ch/3/name', args: [] });
  assert.deepEqual(W.busNameGet(4),      { address: '/bus/4/name', args: [] });
});

// ── Reply decoding — the doc's own worked GET-reply examples ───────────────
// "/ch/1/fdr~~~,sff~~~~-oo~[0.0000][-144.0000]" -> real value is the LAST arg
t('decodeGetReply extracts the real value from a float (sff) reply', () => {
  assert.equal(W.decodeGetReply(['-oo', 0.0, -144.0]), -144.0);
});
// "/ch/1/mute~~,sfi~~~~1~~~[1.0000][ 1]" -> real value is the LAST arg
t('decodeGetReply extracts the real value from an int/enum (sfi) reply', () => {
  assert.equal(W.decodeGetReply(['1', 1.0, 1]), 1);
});
t('decodeGetReply returns a lone string value (e.g. a name reply) unwrapped', () => {
  assert.equal(W.decodeGetReply(['Kick']), 'Kick');
});
t('decodeGetReply returns null for an empty/malformed reply rather than throwing', () => {
  assert.equal(W.decodeGetReply([]), null);
  assert.equal(W.decodeGetReply(undefined), null);
  assert.equal(W.decodeGetReply(null), null);
});

// ── SET confirmation — the doc's own documented reply shape ────────────────
t('isOkReply recognizes the documented OK confirmation and rejects anything else', () => {
  assert.equal(W.isOkReply('/*', 'OK'), true);
  assert.equal(W.isOkReply('/*', 'NODE NOT FOUND'), false);
  assert.equal(W.isOkReply('/*', 'VALUE ERROR'), false);
  assert.equal(W.isOkReply('/ch/1/fdr', 'OK'), false);
});

console.log(`\n${n} tests passed`);
