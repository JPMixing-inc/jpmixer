'use strict';

// ── Which dLive socket each input channel's preamp is ────────────────────
// dLive's MIDI control sets a preamp's gain, pad and 48V by *socket*, not by
// channel, and has no way to ask the console which socket a channel is
// patched to. The Patch plugin knows: its dLive show import (or a patch drawn
// by hand) is saved in its data folder (plugin-data/patch/patch.json), each
// box's sockets with the channel they feed. JPMixer reads that, and offers
// a channel's preamp only when it knows the socket — guessing input N =
// socket N would put 48V on someone else's mic.
//
// Sockets, as the protocol numbers them: MixRack 1-64 = 00-3F, DX 1/2 1-32 =
// 40-5F, DX 3/4 1-32 = 60-7F (16 for each DX168, in the order Patch made
// them: dl-dx-1 is DX 1-16, dl-dx-2 DX 17-32, and so on). The surface's own
// sockets and I/O cards have no MIDI preamp control.

const fs = require('fs');
const path = require('path');

const MIXRACK = /^ah-cdm(32|48|64)$/;
const DX = /^ah-dx/;

// patch.json's boxes -> Map(channel -> [{ socket, where }]), every socket a
// channel is fed from (usually one)
function socketsFromPatch(data) {
  const out = new Map();
  const boxes = data && Array.isArray(data.boxes) ? data.boxes : [];
  const add = (ch, socket, where, name) => {
    if (!out.has(ch)) out.set(ch, []);
    out.get(ch).push({ socket, where, name });
  };
  // DX boxes as the show import made them: its ids say which (dl-dx-2 is
  // DX 17-32). One drawn by hand says nothing about which DX port it's on,
  // so it gets no preamp control (a guess could put 48V on another mic).
  const dxIndex = new Map();
  for (const b of boxes) {
    if (!b || !DX.test(String(b.model))) continue;
    const m = /^dl-dx-(\d+)$/.exec(String(b.id));
    if (m) dxIndex.set(b, Number(m[1]) - 1);
  }
  let rackSeen = false;
  for (const b of boxes) {
    if (!b || !b.ports || typeof b.ports !== 'object') continue;
    const rack = MIXRACK.test(String(b.model)) && !rackSeen;
    const dx = dxIndex.has(b) ? dxIndex.get(b) : null;
    if (!rack && dx === null) continue;
    if (rack) rackSeen = true; // one MixRack
    for (const [key, port] of Object.entries(b.ports)) {
      const m = /^in\.(\d+)$/.exec(key);
      const src = port && port.src;
      if (!m || !src || src.kind !== 'ch' || !Number.isInteger(src.n) || src.n < 1 || src.n > 128) continue;
      const n = Number(m[1]), name = String(port.name || '');
      if (rack) {
        if (n >= 1 && n <= 64) add(src.n, n - 1, `MixRack socket ${n}`, name);
      } else if (n >= 1 && n <= 16) {
        const dxn = dx * 16 + n; // DX input 1-64
        if (dxn <= 32) add(src.n, 0x40 + dxn - 1, `DX ${dxn}`, name);
        else if (dxn <= 64) add(src.n, 0x60 + dxn - 33, `DX ${dxn}`, name);
      }
    }
  }
  return out;
}

// Read again only when the file changes
let cached = { file: null, stamp: null, map: new Map() };
function socketMap(dataFolder) {
  const file = path.join(dataFolder, 'patch', 'patch.json');
  let stamp = null;
  try { const st = fs.statSync(file); stamp = `${st.mtimeMs}:${st.size}`; } catch (_) { stamp = null; }
  if (cached.file === file && cached.stamp === stamp) return cached.map;
  let map = new Map();
  if (stamp) { try { map = socketsFromPatch(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { map = new Map(); } }
  cached = { file, stamp, map };
  return map;
}

// Does Patch's name for the socket still fit the console's name for the
// channel? A console re-patched since the show was imported would put the
// preamp on another mic. A socket can carry more than one channel's name
// ("Snare Top / Ch 40"); a name Patch made up ("Ch 12") or a channel with no
// name says nothing either way.
const norm = (x) => String(x || '').trim().toLowerCase();
function nameFits(patchName, consoleName) {
  const c = norm(consoleName);
  if (!c) return true;
  const names = String(patchName || '').split(' / ').map(norm).filter((x) => x && !/^ch \d+$/.test(x));
  return !names.length || names.includes(c);
}

module.exports = { socketsFromPatch, socketMap, nameFits };
