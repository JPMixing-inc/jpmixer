'use strict';

// ── KLANG OSC Protocol ──────────────────────────────────────────────────────
// Pure, side-effect-free protocol logic: builds {address, args} OSC message
// objects. No sockets here — see klang-client.js for the UDP transport. Kept
// entirely separate from osc-server.js/dlive-*.js on purpose: this is a third,
// independent backend, never imported by either of the other two.
//
// Reference: KLANG "OSC Reference Documentation" (klang.com/manuals/
// osc-reference-documentation/), the "SHORT syntax" addressing scheme
// specifically — it needs no handshake/UID before use, unlike the LONG
// (/KLANGfabrik/...) syntax this integration deliberately doesn't use.
// Verified against the doc's own worked example:
//   KLANGosc 10.10.10.10 9110 /Kf/ui/1/ch/2/gaindB f -11
// which confirms both MIX and channel numbers are 1-indexed.
//
// The `osc` package (already a dependency, used by osc-server.js for DiGiCo)
// auto-infers OSC type tags from plain JS values when sent without metadata —
// number->'f', string->'s', boolean->'T'/'F' — which is exactly the type
// each KLANG address below expects, so these builders just return plain
// {address, args} objects with native JS values, not manually-tagged bytes.
//
// SCOPE (deliberately not full parity with KLANG:app):
//   ✓ Channel gain, mute, solo, name, colour
//   ✓ Azimuth in STEREO placement mode only, which the doc documents as a
//     plain pan control (-90 left, 0 centre, +90 right) — not full 3D/i3D
//     positioning. Mixes are assumed to already be configured in stereo mode
//     via KLANG:app; this integration never sets placement/channel mode.
//   ✗ 3D/i3D orbit positioning (azimuth 0-360, elevation, width)
//   ✗ Groups, snapshots, presets, cue mode, tracker/i3D commands
//   ✗ The handshake/relay mechanism — meaning no read-back of what KLANG:app
//     or another remote actually set a value to. Every message here is
//     fire-and-forget; the caller's own last-sent value is the only source
//     of truth this integration has. See klang-server.js's file header.

function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

function mixAddress(mix) {
  assertPositiveInt('mix', mix);
  return `/Kf/ui/${mix}`;
}

function channelAddress(mix, ch) {
  assertPositiveInt('ch', ch);
  return `${mixAddress(mix)}/ch/${ch}`;
}

// dB values come from client-controlled fader input (see the NaN-propagation
// lesson from the dLive work) — reject rather than silently forward garbage.
function assertFiniteDb(db) {
  if (!Number.isFinite(db)) throw new RangeError(`db must be a finite number, got ${db}`);
}

function gainDbMessage(mix, ch, db) {
  assertFiniteDb(db);
  return { address: `${channelAddress(mix, ch)}/gaindB`, args: [db] };
}

function muteMessage(mix, ch, on) {
  return { address: `${channelAddress(mix, ch)}/mute`, args: [!!on] };
}

function soloMessage(mix, ch, on) {
  return { address: `${channelAddress(mix, ch)}/solo`, args: [!!on] };
}

function nameMessage(mix, ch, name) {
  return { address: `${channelAddress(mix, ch)}/name`, args: [String(name || '')] };
}

// KLANG wants an 8-digit ARGB hex string (e.g. FFFF0000 = opaque red); the
// rest of this app stores/passes around plain 6-digit RGB, so prefix a fixed
// opaque alpha rather than push this conversion out to every call site.
function colourMessage(mix, ch, hex6) {
  const clean = String(hex6 || '').replace(/^#/, '').padStart(6, '0').slice(0, 6);
  return { address: `${channelAddress(mix, ch)}/color`, args: [`FF${clean.toUpperCase()}`] };
}

// Stereo-mode azimuth only, per the doc: "-90 (left), 0 (center), +90
// (right)" — distinct from the 0-360 range documented for 3D/i3D orbit
// placement, which this integration doesn't expose.
function panMessage(mix, ch, deg) {
  if (!Number.isFinite(deg)) throw new RangeError(`deg must be a finite number, got ${deg}`);
  const clamped = Math.max(-90, Math.min(90, deg));
  return { address: `${channelAddress(mix, ch)}/azi`, args: [clamped] };
}

function mixGainDbMessage(mix, db) {
  assertFiniteDb(db);
  return { address: `${mixAddress(mix)}/gaindB`, args: [db] };
}

function mixNameMessage(mix, name) {
  return { address: `${mixAddress(mix)}/name`, args: [String(name || '')] };
}

module.exports = {
  gainDbMessage,
  muteMessage,
  soloMessage,
  nameMessage,
  colourMessage,
  panMessage,
  mixGainDbMessage,
  mixNameMessage,
};
