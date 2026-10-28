'use strict';
// A made-up dLive show in the layout a real dLive V2 show uses (see
// plugins/patch/page/dlive-show.js): a .tar.gz with Show/Version.dat and the
// MixRack's and surface's current scenes, each a .tar.gz of one .dat of
// [uint16 BE length][name\0][settings] records, with outputs patched in the
// Channel Mapper's output sections. Every name is invented.
// Used by patch-plugin.test.js; `node dlive-show-sample.js out.tar.gz` writes it.

const zlib = require('zlib');

// One record: its length counts the name, its \0 and the settings
function rec(name, settings) {
  const body = Buffer.concat([Buffer.from(`${name}\0`, 'latin1'), Buffer.from(settings)]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length);
  return Buffer.concat([len, body]);
}
// A tar of files: [path, bytes]
function tar(files) {
  const blocks = [];
  for (const [name, data] of files) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'latin1');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148); h[156] = 0x30; h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const x of h) sum += x;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
const tgz = (files) => zlib.gzipSync(tar(files));
const NONE = [0x14, 0, 0];
const src = (type, n) => [type, ((n - 1) >> 8) & 0xff, (n - 1) & 0xff];
const preamp = (gainDb, pad, phantom) => [1, Math.round(gainDb * 256) >> 8, Math.round(gainDb * 256) & 0xff, pad ? 1 : 0, phantom ? 1 : 0];

// The channels: [channel, name, socket type, socket number]
const CHANNELS = [
  [1, 'Kick In', 0x00, 1], [2, 'Snare', 0x00, 2], [3, 'OH L', 0x00, 3], [4, 'OH R', 0x00, 4], [5, 'Bass DI', 0x00, 5],
  [6, 'E Gtr', 0x00, 6], [7, 'Ac Gtr', 0x00, 7], [8, 'Keys L', 0x00, 8], [9, 'Keys R', 0x00, 9], [10, 'Lead Vox', 0x00, 10],
  [11, 'Vox 2', 0x00, 11], [12, 'Pastor', 0x00, 40], [14, 'Kick Sub', 0x00, 1],
  [20, 'FOH TB', 0x01, 1], [21, 'Video L', 0x01, 9], [22, 'Video R', 0x01, 10],
  [30, 'Choir L', 0x05, 1], [31, 'Choir R', 0x05, 2], [32, 'Wless 1', 0x05, 17],
  [40, 'Tracks L', 0x03, 1], [41, 'Tracks R', 0x03, 2], [42, 'Click', 0x03, 9],
  [50, 'Reverb L', 0x0f, 3],
];
// The outputs: [section start, output (from 1), source type, source number]
// (sections as in dlive-show.js: surface 257, its AES 265, USB 561, MixRack
// 1357, I/O ports 1454 and 1582, DX 1838)
const OUTPUTS = [
  [1357, 1, 0x0f, 1], [1357, 2, 0x0f, 2], [1357, 3, 0x0e, 2], [1357, 20, 0x10, 1],
  [257, 1, 0x11, 1], [265, 1, 0x10, 1], [265, 2, 0x10, 2],
  [1838, 1, 0x0e, 2], [1838, 17, 0x07, 2],
  [1454, 1, 0x07, 1], [1454, 2, 0x07, 2], [1454, 5, 0x00, 3],
  [1582, 1, 0x12, 1], [1582, 2, 0x1c, 1],
  [561, 1, 0x10, 1],
];
// Mix names: [name colour manager, number, name]
const MIX_NAMES = [['Mono Aux', 2, 'Wedge 2'], ['Stereo Aux', 1, 'Drum IEM'], ['Mono Matrix', 1, 'Booth'], ['Stereo Matrix', 1, 'Lobby']];
const nameManager = (list) => {
  const b = Buffer.alloc(1 + 9 * 64);
  b[0] = 1;
  for (const [n, name] of list) b.write(name.slice(0, 8), 1 + 9 * (n - 1), 'latin1');
  return b;
};

function makeShow() {
  const names = Buffer.alloc(1 + 9 * 128);
  names[0] = 1;
  // A byte, 13 per input channel, 256 sources and 128 flags, then 2006 outputs
  const outAt = 1 + 13 * 128 + 256 * 3 + 128;
  const mapper = Buffer.alloc(outAt + 3 * 2006);
  mapper[0] = 6;
  for (let ch = 1; ch <= 128; ch++) Buffer.from([...NONE, ...NONE, ...NONE, ...NONE, 0]).copy(mapper, 2 + 13 * (ch - 1));
  for (let i = 0; i < 2006; i++) Buffer.from(NONE).copy(mapper, outAt + 3 * i);
  for (const [at, n, type, sn] of OUTPUTS) Buffer.from(src(type, sn)).copy(mapper, outAt + 3 * (at + n - 1));
  for (const [ch, name, type, n] of CHANNELS) {
    names.write(name.slice(0, 8), 1 + 9 * (ch - 1), 'latin1');
    Buffer.from(src(type, n)).copy(mapper, 2 + 13 * (ch - 1));
  }
  const rackPreamps = [];
  for (let n = 1; n <= 64; n++) rackPreamps.push(rec(`StageBox Analogue Input, Number ${String(n).padStart(2, '0')}`, preamp(n === 7 ? 10 : 27, n === 7, n === 3 || n === 4)));
  const rack = Buffer.concat([Buffer.from('\x01\x01Scene 65535\0', 'latin1'), Buffer.alloc(64),
    rec('Input Channel Name Colour Manager', names),
    ...MIX_NAMES.map(([what, n, name]) => rec(`${what} Channel Name Colour Manager`, nameManager([[n, name]]))),
    rec('Channel Mapper', mapper), ...rackPreamps, rec('Talkback Highpass Filter', [1, 0, 0])]);
  const surfacePreamps = [];
  for (let n = 1; n <= 8; n++) surfacePreamps.push(rec(`Surface Analogue Input, Number ${String(n).padStart(2, '0')}`, preamp(24, false, n === 1)));
  const surface = Buffer.concat([Buffer.from('\x01\x01Scene 65535\0', 'latin1'), Buffer.alloc(64), ...surfacePreamps]);
  return tgz([
    ['Show/Version.dat', Buffer.from('14\n')],
    ['Show/Scenes/StageBoxScene65535.tar.gz', tgz([['StageBoxScene65535.dat', rack]])],
    ['Show/Scenes/SurfaceScene65535.tar.gz', tgz([['SurfaceScene65535.dat', surface]])],
  ]);
}

module.exports = { makeShow, tgz, CHANNELS, OUTPUTS };
if (require.main === module) require('fs').writeFileSync(process.argv[2] || 'dlive-show-sample.tar.gz', makeShow());
