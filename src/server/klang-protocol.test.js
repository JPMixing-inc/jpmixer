'use strict';
// Regression test for klang-protocol.js's message shapes against KLANG's own
// "OSC Reference Documentation" (klang.com/manuals/osc-reference-documentation/).
// Run with: node src/server/klang-protocol.test.js
// No test framework/dependency — matches this project's existing (zero) test
// tooling, just plain assert.

const assert = require('node:assert/strict');
const K = require('./klang-protocol.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

// ── The doc's own worked example, verbatim ─────────────────────────────────
// "Example: Set gain of channel 2 on mix 1 to -11 dB"
//   KLANGosc 10.10.10.10 9110 /Kf/ui/1/ch/2/gaindB f -11
t('gainDbMessage matches the doc\'s own worked example exactly', () => {
  assert.deepEqual(K.gainDbMessage(1, 2, -11), { address: '/Kf/ui/1/ch/2/gaindB', args: [-11] });
});

t('gainDbMessage rejects non-finite dB', () => {
  assert.throws(() => K.gainDbMessage(1, 1, NaN), RangeError);
  assert.throws(() => K.gainDbMessage(1, 1, Infinity), RangeError);
});

t('mute/solo send OSC boolean args, not 0/1 integers', () => {
  assert.deepEqual(K.muteMessage(1, 3, true),  { address: '/Kf/ui/1/ch/3/mute', args: [true] });
  assert.deepEqual(K.muteMessage(1, 3, false), { address: '/Kf/ui/1/ch/3/mute', args: [false] });
  assert.deepEqual(K.soloMessage(2, 5, true),  { address: '/Kf/ui/2/ch/5/solo', args: [true] });
});

t('mute/solo coerce truthy/falsy input to real booleans', () => {
  assert.deepEqual(K.muteMessage(1, 1, 1), { address: '/Kf/ui/1/ch/1/mute', args: [true] });
  assert.deepEqual(K.muteMessage(1, 1, 0), { address: '/Kf/ui/1/ch/1/mute', args: [false] });
});

t('nameMessage', () => {
  assert.deepEqual(K.nameMessage(1, 4, 'Kick'), { address: '/Kf/ui/1/ch/4/name', args: ['Kick'] });
});

t('colourMessage converts 6-digit RGB to 8-digit ARGB with opaque alpha', () => {
  // Doc: "channelColorAs8DigitHexValue contains alpha, red, green, blue, e.g. FFFF0000 is red"
  assert.deepEqual(K.colourMessage(1, 1, 'FF0000'), { address: '/Kf/ui/1/ch/1/color', args: ['FFFF0000'] });
  assert.deepEqual(K.colourMessage(1, 1, '#00ff00'), { address: '/Kf/ui/1/ch/1/color', args: ['FF00FF00'] });
});

t('panMessage uses azi and clamps to the documented stereo range (-90..90)', () => {
  assert.deepEqual(K.panMessage(1, 1, -45), { address: '/Kf/ui/1/ch/1/azi', args: [-45] });
  assert.deepEqual(K.panMessage(1, 1, 0),   { address: '/Kf/ui/1/ch/1/azi', args: [0] });
  assert.deepEqual(K.panMessage(1, 1, 200), { address: '/Kf/ui/1/ch/1/azi', args: [90] });
  assert.deepEqual(K.panMessage(1, 1, -200),{ address: '/Kf/ui/1/ch/1/azi', args: [-90] });
});

t('panMessage rejects non-finite degrees', () => {
  assert.throws(() => K.panMessage(1, 1, NaN), RangeError);
});

t('mixGainDbMessage / mixNameMessage address the mix, not a channel', () => {
  assert.deepEqual(K.mixGainDbMessage(3, -6), { address: '/Kf/ui/3/gaindB', args: [-6] });
  assert.deepEqual(K.mixNameMessage(3, 'Drummer'), { address: '/Kf/ui/3/name', args: ['Drummer'] });
});

t('mix and channel numbers reject 0 and negative values (1-indexed, per the doc example)', () => {
  assert.throws(() => K.gainDbMessage(0, 1, -6), RangeError);
  assert.throws(() => K.gainDbMessage(1, 0, -6), RangeError);
  assert.throws(() => K.gainDbMessage(-1, 1, -6), RangeError);
  assert.throws(() => K.mixNameMessage(0, 'x'), RangeError);
});

t('mix and channel numbers reject non-integers', () => {
  assert.throws(() => K.gainDbMessage(1.5, 1, -6), RangeError);
  assert.throws(() => K.gainDbMessage(1, 2.5, -6), RangeError);
});

console.log(`\n${n} tests passed`);
