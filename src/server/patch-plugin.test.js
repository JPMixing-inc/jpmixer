'use strict';
// The Patch plugin (plugins/patch): its stage box library matches the makers'
// figures, and its process keeps one patch for every screen (saving, 48V marks,
// another screen's newer save, the lock, and nothing but tidy data kept).

const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-patch-plugin-test-'));
process.env.JPM_TEST_USERDATA = userData;

const test = require('node:test');
const assert = require('node:assert/strict');
const plugins = require('./plugins');
const SOURCE = path.join(__dirname, '..', '..', 'plugins', 'patch');

// boxes.js runs in the page; here it runs with a stand-in window
function library() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(SOURCE, 'page', 'boxes.js'), 'utf8'), sandbox);
  return sandbox.window.PATCH_LIBRARY;
}
const count = (L, box, kind) => L.layoutFor(box).ports.filter((p) => p.kind === kind).length;

test('the stage box library: each box’s sockets as on the real panel (an AES pair is one socket)', () => {
  const L = library();
  const expect = {
    'digico-d-rack': [32, 8], 'digico-dq-rack': [48, 24], 'digico-mq-rack': [48, 24], 'digico-d2-rack': [48, 16],
    'digico-a168-stage': [16, 8], 'digico-a168d-stage': [16, 8], 'digico-a164-wall': [16, 4],
    'waves-ionic-16': [16 + 1, 8 + 4 + 1 + 2], 'waves-ionic-24': [24 + 1, 14 + 4 + 2 + 2], 'digigrid-iox': [12, 6 + 4], 'digigrid-ios': [8 + 1, 8 + 1 + 2],
    'ah-cdm32': [32, 16], 'ah-cdm48': [48, 24], 'ah-cdm64': [64, 32], 'ah-dx168': [16, 8], 'ah-s7000': [8 + 2, 8 + 3],
  };
  for (const [model, [ins, outs]] of Object.entries(expect)) {
    assert.equal(count(L, { model }, 'in'), ins, `${model} inputs`);
    assert.equal(count(L, { model }, 'out'), outs, `${model} outputs`);
  }
  assert.equal(count(L, { model: 'digico-d-rack', options: { exp: 'line' } }, 'out'), 16, 'D-Rack with 8 more line outputs');
  assert.equal(count(L, { model: 'digico-d-rack', options: { exp: 'aes' } }, 'out'), 12, 'D-Rack with AES out 1-4');
  assert.equal(count(L, { model: 'digico-d2-rack', options: { inputs: 'aes' } }, 'in'), 24 + 12, 'D2-Rack: 24 mic and 12 AES pairs');
  assert.equal(count(L, { model: 'digico-d2-rack', options: { exp1: 'aes', exp2: 'line' } }, 'out'), 16 + 4 + 8);
  assert.equal(count(L, { model: 'digico-dq-rack', options: { outs: 'aes' } }, 'out'), 20 + 4, 'DQ-Rack: outputs 6, 12, 18 and 24 as AES pairs');
  const dq = L.layoutFor({ model: 'digico-dq-rack', options: { outs: 'aes' } }).ports;
  assert.ok(dq.some((p) => p.key === 'out.7') && !dq.some((p) => p.key === 'out.6'), 'line outputs keep their printed numbers');
  const sd = { model: 'digico-sd-rack', cards: { 1: 'mic', 2: 'mic', 3: 'line', 4: '', 5: '', 6: '', 7: 'aes-in', 8: 'line', 9: '', 10: '', 11: '', 12: '', 13: '', 14: 'other-out' } };
  assert.equal(count(L, sd, 'in'), 8 + 8 + 4, 'SD-Rack: input slots take input cards only (slot 3 can’t hold an output card)');
  assert.equal(count(L, sd, 'out'), 16);
  assert.equal(L.layoutFor(sd).ports.find((p) => p.key === 's2.1').label, 'Input 9', 'rack channels run on along the slots');
  assert.equal(count(L, { model: 'digico-sd-mini-rack', cards: { 1: 'mic', 2: 'line', 3: 'line', 4: '' } }, 'out'), 16, 'SD-MiNi slots take either');
  assert.equal(count(L, { model: 'generic', generic: { inputs: 40, outputs: 999 } }, 'out'), 128, 'generic is capped');
  // A network device: a tile per channel, 8 to a row, no sockets to plug into
  const net = L.layoutFor({ model: 'network', name: 'Tracks', generic: { inputs: 20, outputs: 4 }, options: { kind: 'madi' } });
  assert.deepEqual([net.faces[0].virtual, net.faces[0].label, net.ports.length, new Set(net.ports.map((p) => p.connector)).size, net.ports[0].connector], [true, 'MADI', 24, 1, 'tile']);
  assert.deepEqual([net.ports[8].key, net.ports[8].x === net.ports[0].x, net.ports[8].y > net.ports[0].y, net.ports[20].key, net.ports[20].label], ['in.9', true, true, 'out.1', 'Channel 1'], 'channel 9 starts the second row; then what it receives');
  assert.equal(L.layoutFor({ model: 'network', generic: { inputs: 4 } }).faces[0].label, 'Dante', 'Dante unless another kind is chosen');
  const phone = L.layoutFor({ model: 'network', generic: { inputs: 20, outputs: 4 } }, { cols: 4 });
  assert.deepEqual(phone.ports.map((p) => p.key), net.ports.map((p) => p.key), 'on a phone: the same channels…');
  assert.ok(phone.ports[4].y > phone.ports[0].y && phone.faces[0].w < net.faces[0].w, '…4 to a row');

  // Every box, with every option: sockets inside the panel, none overlapping, keys unique
  const variants = (m) => {
    const out = [{ model: m.id }];
    for (const o of m.options || []) for (const c of o.choices) out.push({ model: m.id, options: { [o.key]: c.value } });
    if (m.slots) out.push({ model: m.id, cards: Object.fromEntries(m.slots.map((allowed, i) => [i + 1, allowed[i % allowed.length]])) });
    if (m.generic) out.push({ model: m.id, generic: { inputs: 128, outputs: 128 } }, { model: m.id, generic: { inputs: 1, outputs: 0 } });
    return out;
  };
  for (const m of L.BOXES) {
    for (const box of variants(m)) {
      const { faces, ports } = L.layoutFor(box);
      assert.equal(new Set(ports.map((p) => p.key)).size, ports.length, `${m.id}: socket keys`);
      for (const f of faces) {
        if (f.rack) assert.ok(Math.abs(f.h - f.rack * L.U) < 0.01 && f.w === L.RACK_W, `${m.id} ${f.id}: a ${f.rack}U 19-inch rack`);
        for (const p of f.sockets) {
          const half = p.size * 0.62;
          assert.ok(p.x - p.size / 2 >= 0 && p.x + p.size / 2 <= f.w && p.y - half >= 0 && p.y + half <= f.h, `${m.id} ${f.id} ${p.key} is inside the panel (${p.x}, ${p.y})`);
          if (f.rack) assert.ok(p.x - p.size / 2 >= L.EAR && p.x + p.size / 2 <= f.w - L.EAR, `${m.id} ${f.id} ${p.key} is between the rack ears (${p.x})`);
        }
        for (let i = 0; i < f.sockets.length; i++) for (let j = i + 1; j < f.sockets.length; j++) {
          const a = f.sockets[i], b = f.sockets[j];
          const apart = Math.abs(a.x - b.x) >= (a.size + b.size) / 2 * 0.84 || Math.abs(a.y - b.y) >= (a.size + b.size) / 2 * 1.0;
          assert.ok(apart, `${m.id} ${f.id}: ${a.key} and ${b.key} overlap`);
        }
      }
    }
  }
  const before = L.layoutFor({ model: 'digico-sd-mini-rack', cards: { 1: 'mic', 2: 'mic' } }).ports.find((p) => p.key === 's2.3');
  const after = L.layoutFor({ model: 'digico-sd-mini-rack', cards: { 1: '', 2: 'mic' } }).ports.find((p) => p.key === 's2.3');
  assert.ok(before && after, 'slot 2’s sockets keep their keys when slot 1 is emptied');
});

test('importing an LV1 session: every stage box, each socket named for what LV1 has patched to it', () => {
  // A made-up session in LV1 17.6's own table layouts (fixtures/make-lv1-session-sample.py)
  const sandbox = { window: {}, TextDecoder };
  for (const f of ['boxes.js', 'sqlite.js', 'lv1-session.js']) vm.runInNewContext(fs.readFileSync(path.join(SOURCE, 'page', f), 'utf8'), sandbox);
  const { PatchSQLite, PatchLV1, PATCH_LIBRARY: L } = sandbox.window;
  const db = PatchSQLite.open(fs.readFileSync(path.join(__dirname, 'fixtures', 'lv1-session-sample.emo')));
  assert.equal(db.rows('snapshot_chainer').length, 434, 'every row, across many small pages');
  const result = JSON.parse(JSON.stringify(PatchLV1.read(db))); // out of the sandbox, as plain objects
  assert.deepEqual(result.boxes.map((b) => [b.name, b.model, b.id]), [
    ['Classic IO', 'waves-lv1-classic', 'lv1-001cd1000003'], ['STAGE LEFT', 'waves-ionic-24', 'lv1-001cd1000001'], ['DRUM RISER', 'waves-ionic-16', 'lv1-001cd1000002'], ['MADI', 'network', 'lv1-001cd1000006'],
  ], 'one box per stage box, in LV1\'s order (the LV1 Classic console\'s own I/O too); the computer and the server aren\'t boxes');
  assert.deepEqual(result.boxes[3].generic, { inputs: 64, outputs: 64 }, 'a device without a drawing is a network device its size');
  assert.deepEqual(result.boxes[3].options, { kind: 'madi' }, 'a MADI interface: marked MADI');
  const [classic, left, riser, madi] = result.boxes;
  const p = (box, key) => JSON.parse(JSON.stringify(box.ports[key] || null));
  assert.deepEqual(p(classic, 'hp.1'), { name: 'AUX A', src: { kind: 'mix', n: 1 } }, 'the Classic\'s headphones (its outputs 13-14)');
  assert.equal(p(madi, 'in.10').name, 'VOX 1');
  assert.deepEqual(p(left, 'in.1'), { name: 'KICK', src: { kind: 'ch', n: 1 } }, 'no 48V now (an older scene had it on)');
  assert.deepEqual([p(left, 'in.15'), p(left, 'in.16')], [{ name: 'OVERHEADS L', src: { kind: 'ch', n: 2, side: 'L' }, phantom: true }, { name: 'OVERHEADS R', src: { kind: 'ch', n: 2, side: 'R' }, phantom: true }], 'a stereo channel\'s sides, so it isn\'t called patched twice; 48V on in the session, so marked 48V');
  const split = p(left, 'in.3');
  assert.equal(split.src.n, 3, 'a split socket: patched to the first channel…');
  assert.equal(split.name.length, 40, 'names are kept to 40 characters (this one ran on past a page)');
  assert.match(split.name, /^VOX 1 \/ LEAD VOCAL X+$/);
  assert.match(split.note, /^Also patched to Ch 4 \(LEAD VOCAL X+\)\.$/, '…and the rest in its note');
  assert.equal(left.ports['in.6'], undefined, 'a route LV1 isn\'t using');
  assert.deepEqual(p(riser, 'aesin.1'), { name: 'PLAYBACK ST', src: { kind: 'ch', n: 5 } }, 'both sides of an AES pair are one socket');
  assert.deepEqual(p(classic, 'in.1'), { name: 'FOH TB' }, 'talkback: named, nothing in JPMixer to patch it to');
  assert.deepEqual([p(left, 'out.1'), p(left, 'out.2')], [{ name: 'MON A L', src: { kind: 'mix', n: 3, side: 'L' } }, { name: 'MON A R', src: { kind: 'mix', n: 3, side: 'R' } }], 'a monitor mix is JPMixer\'s aux after LV1\'s 2 aux buses');
  assert.deepEqual(p(riser, 'hp.1'), { name: 'AUX B', src: { kind: 'mix', n: 2 } });
  assert.deepEqual([p(left, 'out.13'), p(left, 'out.14')], [{ name: 'LR L' }, { name: 'LR R' }]);
  assert.deepEqual(p(left, 'aesout.1'), { name: 'MON C', src: { kind: 'mix', n: 5 } });
  assert.deepEqual(p(left, 'aesin.1'), { name: 'TB A / TB B', src: { kind: 'ch', n: 6 }, note: 'Also on this pair: Ch 7 (TB B).' }, 'an AES pair with two channels: not called a split');
  assert.deepEqual([result.inputs, result.outputs, result.phantom], [8, 7, 2], 'sockets patched: an AES pair or a split is one');
  // Every socket is one the drawing has
  for (const box of result.boxes) {
    const keys = new Set(L.layoutFor(box).ports.map((x) => x.key));
    for (const k of Object.keys(box.ports)) assert.ok(keys.has(k), `${box.name} ${k} is on the drawing`);
  }
  assert.throws(() => PatchSQLite.open(Buffer.from('not a database at all, just some text that goes on for a while to pass 100 bytes. '.repeat(3))), /isn’t an LV1 session/);
});

// A made-up DiGiCo session, laid out the way a Quantum 225 writes one (see
// plugins/patch/page/digico-session.js): the I/O list in section 4, the
// current state in section 6
function fakeDigicoSession() {
  const parts = [];
  const header = Buffer.alloc(0x200);
  header.write('DiGiCo     Q2  .SES vI   \r', 0, 'latin1');
  const group = (gid, name) => { const b = Buffer.alloc(4 + 0x6c); b.set([0xca, 0, 0x6c, 0], 0); b[4] = gid; b[5] = name.length; b.write(name, 6, 'latin1'); return b; };
  const socket = (gid, idx, name, stereo) => { const b = Buffer.alloc(4 + 0x58); b.set([0xcb, 0, 0x58, 0], 0); b[4] = idx; b[5] = gid; b.writeUInt16LE(idx + 1, 6); b[8] = name.length; b.write(name, 9, 'latin1'); b[9 + name.length + 6] = stereo ? 2 : 1; b.fill(0xff, 9 + name.length + 7, 9 + name.length + 11); return b; };
  const list = {
    0x01: [['KICK'], ['OH', true], ['VOX 1'], ['TRACKS', true], ['VERB L', true]], 0x05: [['DRUMS'], ['VOX']], 0x06: [['Master']], 0x07: [['Master R'], ['DRUMS R']],
    0x09: [['EARS']], 0x0b: [['NEAR FIELDS']], 0x10: [['LEFT']],
    0x1c: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`0:Mic ${n}`]).concat([['0:AES in 1'], ['0:AES in 2']]),
    0x4e: [1, 2, 3, 4, 5, 6].map((n) => [`0:Line ${n}`]).concat([['MONITORS L'], ['MONITORS R'], ['0:AES out 1'], ['0:AES out 2']]), // 7-8 renamed on the console
    0x1f: [...[1, 2, 3, 4, 5, 6].map((n) => [`3:DntMic ${n}`]), ['3:Dnt64 7'], ['3:Dnt64 8']], 0x51: [['IEM 1 L'], ['IEM 1 R'], ['3:Dnt64 3']],
    0x22: [['VERB L'], ['VERB R']],
  };
  const sec4 = [];
  for (const [gid, items] of Object.entries(list)) { sec4.push(group(Number(gid), 'G')); items.forEach(([n, st], i) => sec4.push(socket(Number(gid), i, n, st))); }
  const record = (type, name, entries) => {
    const b = Buffer.alloc(0x3d + entries.length * 8 + 8);
    b.set([0xda, 0, 0x3a, 0, type, 0, 0, 0], 0); b[8] = name.length; b.write(name, 9, 'latin1');
    entries.forEach(([id, side, idx, gid], k) => b.set([id, type, side, 0, 0, 0, idx, gid], 0x3d + k * 8));
    b.fill(0xff, 0x3d + entries.length * 8);
    return b;
  };
  const none = [0, 0, 0, 0];
  const sec6 = [
    record(1, 'KICK', [[1, 0, 0, 0], [1, 1, 0, 0], [0, 0, 0, 0x1f]]), record(1, 'OH', [[1, 0, 0, 0], [1, 1, 0, 0], [0, 0, 2, 0x1f]]),
    record(1, 'VOX 1', [[1, 0, 0, 0], [1, 1, 0, 0], [0, 0, 0, 0x1c]]), record(1, 'TRACKS', [[1, 0, 0, 0], [1, 1, 0, 0], [0, 0, 6, 0x1f]]),
    record(1, 'VERB L', [[1, 0, 0, 0], [1, 1, 0, 0], [0, 0, 0, 0x22]]),
    // every output: 5 direct outs, 2 auxes, 1 group, 2 busses, talkback, solo, matrix
    ...['KICK', 'OH', 'VOX 1', 'TRACKS', 'VERB L'].map((n) => record(0x0e, n, [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], none])),
    record(0x0e, 'DRUMS', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], [0xfe, 0, 0, 0x51]]), record(0x0e, 'VOX', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], none]),
    record(0x0e, 'Master', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], [0xfe, 0, 8, 0x4e]]),
    record(0x0e, 'Master R', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], [0xfe, 0, 9, 0x4e]]), record(0x0e, 'DRUMS R', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], [0xfe, 0, 1, 0x51]]),
    record(0x0e, 'EARS', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], none]), record(0x0e, 'NEAR FIELDS', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], [0xfe, 0, 6, 0x4e]]),
    record(0x0e, 'LEFT', [[0xe9, 0, 0, 0], [0xe8, 0, 0, 0], [0xfe, 0, 50, 0x51]]),
    // every input socket, in the I/O list's order: 0x83 is its 48V (float 1.0 = 00 00 80 3f)
    ...[0x1c, 0x1f, 0x22].flatMap((gid) => list[gid].map(([name], i) => {
      const on = gid === 0x1f && [0, 2, 3].includes(i); // KICK, and both sides of OH
      return record(0x11, name, [[0x86, 0, 0, 0], [0x83, 0, on ? 0x80 : 0, on ? 0x3f : 0], [0x84, 0, 0x80, 0x3f]]);
    })),
  ];
  const s4 = Buffer.concat(sec4), s6 = Buffer.concat(sec6);
  const o4 = header.length, o6 = o4 + s4.length;
  for (let i = 0; i < 27; i++) header.writeUInt32LE(i <= 4 ? o4 : i === 5 || i === 6 ? o6 : o6 + s6.length, 0x100 + i * 4);
  parts.push(header, s4, s6);
  return Buffer.concat(parts);
}

test('importing a DiGiCo session: the console\'s own I/O, the rack on Dante you choose and a box for playback, each socket named and patched', () => {
  const sandbox = { window: {}, TextDecoder };
  for (const f of ['boxes.js', 'digico-session.js']) vm.runInNewContext(fs.readFileSync(path.join(SOURCE, 'page', f), 'utf8'), sandbox);
  const { PatchDiGiCo: G, PATCH_LIBRARY: L } = sandbox.window;
  const session = G.read(fakeDigicoSession());
  assert.equal(session.console, 'Q2');
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const r = plain(G.build(session, {}, L, [{ number: 7, name: 'VOX' }, { number: 3, name: 'DRUMS' }]));
  assert.deepEqual(r.boxes.map((b) => [b.id, b.model, b.name]), [['dg-local', 'digico-q225', 'Quantum 225'], ['dg-dante-1', 'digico-dq-rack', 'Dante rack'],
    ['dg-play-dante', 'network', 'Dante playback'], ['dg-play-waves', 'network', 'Waves SoundGrid']], 'a DQ-Rack on Dante unless another is chosen');
  const [local, rack, play, waves] = r.boxes;
  assert.deepEqual([play.options, waves.options], [{}, { kind: 'soundgrid' }], 'playback boxes: a Dante device, a SoundGrid one');
  assert.equal(G.consoleFor(session.console), 'digico-q225', 'the console the session is from: its own I/O drawn as it');
  assert.deepEqual(['SD12', 'SD7', 'S21', 'Q3', 'nonsense'].map(G.consoleFor), ['digico-sd12', 'digico-q7', 'digico-s21', 'digico-q338', '']);
  // Every DiGiCo console drawn: its mic/line inputs, line outputs and AES, and
  // a session's local I/O goes on it in order (here a Quantum 852's 12 + 6)
  const consoles = G.consoleModels(L);
  assert.equal(consoles.length, 12);
  for (const m of consoles) {
    const keys = L.layoutFor({ model: m.id }).ports.map((x) => x.key);
    assert.ok(keys.includes('in.8') && keys.includes('out.8') && keys.includes('aesin.1') && keys.includes('aesout.1'), `${m.name} has its I/O`);
    assert.equal(new Set(keys).size, keys.length, `${m.name}: every socket once`);
  }
  const q852 = plain(G.build(session, { console: 'digico-q852' }, L, [])).boxes[0];
  assert.deepEqual([q852.model, q852.ports['in.1'].name, q852.ports['out.7'].name], ['digico-q852', 'VOX 1', 'NEAR FIELDS']);
  assert.deepEqual(plain(G.build(session, { console: 'generic' }, L, [])).boxes[0].generic, { inputs: 10, outputs: 10 }, 'or a generic box, if chosen');
  assert.deepEqual(rack.ports['in.1'], { name: 'KICK', src: { kind: 'ch', n: 1 }, phantom: true }, '48V on in the session: marked 48V');
  assert.deepEqual([rack.ports['in.3'], rack.ports['in.4']], [{ name: 'OH L', src: { kind: 'ch', n: 2, side: 'L' }, phantom: true }, { name: 'OH R', src: { kind: 'ch', n: 2, side: 'R' }, phantom: true }], 'a stereo channel\'s right side is the next socket');
  assert.equal(r.phantom, 3);
  assert.deepEqual(local.ports['in.1'], { name: 'VOX 1', src: { kind: 'ch', n: 3 } });
  assert.equal(rack.ports['in.7'], undefined, 'plain Dante channels (a playback computer) aren\'t the rack\'s');
  assert.deepEqual(play.generic, { inputs: 2, outputs: 0 });
  assert.deepEqual([play.ports['in.1'], play.ports['in.2']], [{ name: 'TRACKS L', src: { kind: 'ch', n: 4, side: 'L' }, note: 'On the console as Dante 7.' }, { name: 'TRACKS R', src: { kind: 'ch', n: 4, side: 'R' }, note: 'On the console as Dante 8.' }], 'on a playback box of their own, the console\'s channel in the note');
  assert.deepEqual(waves.ports['in.1'], { name: 'VERB L', src: { kind: 'ch', n: 5, side: 'L' }, note: 'On the console as Waves 1.' }, 'a stereo channel called "… L" isn\'t "… L L"');
  assert.deepEqual(r.playback.map((p) => [p.id, p.inputs]), [['dante', 2], ['waves', 2]]);
  assert.equal(r.others, 0);
  const noPlay = plain(G.build(session, { dantePlay: false, wavesPlay: false }, L, []));
  assert.deepEqual([noPlay.boxes.length, noPlay.others], [2, 4], 'playback boxes can be left off');
  assert.equal(plain(G.build(session, { dante: 'playback' }, L, [])).boxes.find((b) => b.id === 'dg-play-dante').generic.inputs, 5, 'Dante as playback: all of its inputs on the playback box');
  const off = plain(G.build(session, { dante: 'none' }, L, []));
  assert.equal(off.boxes.some((b) => b.id === 'dg-dante-1'), false, 'not a rack: no rack drawn');
  assert.equal(off.boxes.find((b) => b.id === 'dg-play-dante').generic.inputs, 2, '…and its rack\'s mics aren\'t called playback');
  assert.ok(off.left.includes('KICK (Dante 1)'), '…they\'re listed as not on a box');
  // Racks by where the inputs are: channels 1 and 33-34 on 16-input A168Ds are racks 1 and 3
  const spread = G.read(fakeDigicoSession());
  spread.inputs[1].socket = { gid: 0x1f, idx: 32 }; spread.sockets.set('31:32', { name: '3:DntMic 33' }); spread.sockets.set('31:33', { name: '3:DntMic 34' });
  const racks = plain(G.build(spread, { dante: 'digico-a168d-stage' }, L, [])).boxes.filter((b) => /^dg-dante-/.test(b.id));
  assert.equal(racks.length, 3, 'enough racks for every channel in use');
  assert.equal(racks[2].ports['in.1'].name, 'OH L');
  assert.deepEqual([rack.ports['out.1'], rack.ports['out.2']], [{ name: 'DRUMS L', src: { kind: 'mix', n: 3, side: 'L' } }, { name: 'DRUMS R', src: { kind: 'mix', n: 3, side: 'R' } }], 'a mix is the console\'s mix by that name');
  assert.deepEqual([local.ports['aesout.1'], local.ports['out.7']], [{ name: 'Master' }, { name: 'NEAR FIELDS' }], 'by place in the session, not name (7 was renamed); both sides of Master on one AES socket');
  assert.deepEqual(r.left, ['LEFT (Dante 51 out)'], 'patched past the rack: listed, not drawn');
  // Two A168D STAGE boxes instead; outputs not the rack's
  const a168 = plain(G.build(session, { dante: 'digico-a168d-stage', danteRacks: '2', danteOuts: false }, L, []));
  assert.deepEqual(a168.boxes.map((b) => b.id), ['dg-local', 'dg-dante-1', 'dg-dante-2', 'dg-play-dante', 'dg-play-waves']);
  assert.equal(a168.boxes[1].ports['out.1'], undefined);
  assert.equal(plain(G.build(session, {}, L, [])).boxes[1].ports['out.1'].src.n, 1, 'with no console names, a mix is its place in the session');
  for (const box of r.boxes) {
    const keys = new Set(L.layoutFor(box).ports.map((x) => x.key));
    for (const k of Object.keys(box.ports)) assert.ok(keys.has(k), `${box.name} ${k} is on the drawing`);
  }
  assert.throws(() => G.read(Buffer.alloc(1024)), /isn’t a DiGiCo session/);
});

test('importing a dLive show: the MixRack, the surface, DX168s and the I/O ports, each input and output named and patched', async () => {
  // A made-up show in a dLive V2 show's own layout (fixtures/dlive-show-sample.js)
  const sample = require('./fixtures/dlive-show-sample');
  const sandbox = { window: {}, TextDecoder, TextEncoder, Blob, Response, DecompressionStream };
  for (const f of ['boxes.js', 'dlive-show.js']) vm.runInNewContext(fs.readFileSync(path.join(SOURCE, 'page', f), 'utf8'), sandbox);
  const { PatchDLive: D, PATCH_LIBRARY: L } = sandbox.window;
  const bytes = sample.makeShow();
  const show = await D.read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  assert.equal(show.version, '14');
  assert.equal(show.inputs.filter((c) => c.type !== undefined).length, sample.CHANNELS.length);
  assert.deepEqual([show.inputs[2].name, show.rackPreamps.get(3).phantom, show.rackPreamps.get(7).pad, show.rackPreamps.get(7).gain, show.surfacePreamps.get(1).phantom], ['OH L', true, true, 10, true]);
  assert.equal(D.rackFor(show), 'ah-cdm48', 'the smallest MixRack with every input the show uses (40)');
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const r = plain(D.build(show, {}, L));
  assert.deepEqual(r.boxes.map((b) => [b.id, b.model, b.name]), [['dl-mixrack', 'ah-cdm48', 'MixRack'], ['dl-surface', 'ah-s7000', 'Surface'], ['dl-dx-1', 'ah-dx168', 'DX168'], ['dl-dx-2', 'ah-dx168', 'DX168 2'],
    ['dl-card', 'network', 'I/O Port 1'], ['dl-card-2', 'network', 'I/O Port 2']]);
  const [rack, surface, dx1, dx2, card, card2] = r.boxes;
  assert.deepEqual(rack.ports['in.3'], { name: 'OH L', src: { kind: 'ch', n: 3 }, phantom: true }, '48V on in the show: marked 48V');
  assert.deepEqual(rack.ports['in.1'], { name: 'Kick In / Kick Sub', src: { kind: 'ch', n: 1 }, note: 'Also patched to Ch 14 (Kick Sub).' }, 'one socket on two channels');
  assert.deepEqual(rack.ports['in.40'], { name: 'Pastor', src: { kind: 'ch', n: 12 } });
  assert.deepEqual(surface.ports['in.1'], { name: 'FOH TB', src: { kind: 'ch', n: 20 }, phantom: true }, 'the surface’s own inputs, with its 48V');
  assert.deepEqual(surface.ports['aesin.1'], { name: 'Video L / Video R', src: { kind: 'ch', n: 21 }, note: 'Also on this pair: Ch 22 (Video R).' }, 'surface inputs 9 and 10: its first AES in');
  assert.deepEqual([dx1.ports['in.1'].name, dx1.ports['in.2'].name, dx2.ports['in.1'].name], ['Choir L', 'Choir R', 'Wless 1'], 'DX inputs 17 on: the next DX168');
  assert.deepEqual(card.generic, { inputs: 3, outputs: 3 });
  assert.deepEqual([card.options, card2.options], [{}, { kind: 'other' }], 'port 1 a Dante device; what’s in the others isn’t in the show');
  assert.deepEqual(card.ports['in.3'], { name: 'Click', src: { kind: 'ch', n: 42 }, note: 'On the console as MixRack I/O port 1 input 9.' }, 'the port’s channels in order, with where each is on the console');
  // Outputs: what feeds each, named from the show
  assert.deepEqual(rack.ports['out.1'], { name: 'Drum IEM L', fed: true, note: 'Stereo aux 1, left.' }, 'a stereo aux on MixRack outputs 1 and 2: patched on the console, to something JPMixer has no number for');
  assert.equal(rack.ports['out.2'].name, 'Drum IEM R');
  assert.deepEqual(rack.ports['out.3'], { name: 'Wedge 2', src: { kind: 'mix', n: 2 }, note: 'Aux 2.' }, 'a mono aux: JPMixer’s aux of that number');
  assert.equal(rack.ports['out.20'].name, 'Main L');
  assert.deepEqual([surface.ports['out.1'].name, surface.ports['aesout.1'].name, surface.ports['aesout.1'].note], ['Booth', 'Main L / Main R', 'The main mix, left. Also on this pair: Main R.'], 'the surface’s outputs and AES pairs');
  assert.deepEqual([dx1.ports['out.1'].name, dx2.ports['out.1'].name, dx2.ports['out.1'].src], ['Wedge 2', 'Snare', { kind: 'ch', n: 2 }], 'DX outputs 17 on: the next DX168; a direct out is patched to its channel');
  assert.deepEqual(Object.entries(card.ports).filter(([k]) => /^out/.test(k)).map(([k, p]) => [k, p.name, p.note]), [
    ['out.1', 'Kick In', 'MixRack I/O port 1 output 1. Direct out of Ch 1.'], ['out.2', 'Snare', 'MixRack I/O port 1 output 2. Direct out of Ch 2.'],
    ['out.3', 'OH L', 'MixRack I/O port 1 output 5. Tie line from MixRack input 3 (Ch 3 OH L).']], 'a tie line is named for the channel on its socket');
  assert.deepEqual([card2.ports['out.1'].name, card2.ports['out.2'].name], ['Lobby L', 'dLive 1c/1'], 'a source not known yet: named by its number');
  assert.equal(r.outputs, 13);
  assert.deepEqual(r.left, ['Reverb L (from St Aux 2 L)', 'Main L (USB recording 1)'], 'an input from a mix, and the surface’s USB recording: listed, not drawn');
  assert.equal(r.phantom, 3, 'MixRack 3 and 4, surface 1');
  for (const box of r.boxes) {
    const keys = new Set(L.layoutFor(box).ports.map((x) => x.key));
    for (const k of Object.keys(box.ports)) assert.ok(keys.has(k), `${box.name} ${k} is on the drawing`);
  }
  // The preview's choices
  const small = plain(D.build(show, { rack: 'ah-cdm32', surface: 'none', dx: 'none', card: false }, L));
  assert.deepEqual(small.boxes.map((b) => b.model), ['ah-cdm32']);
  for (const gone of ['Pastor (MixRack input 40)', 'FOH TB (surface input 1)', 'Choir L (DX input 1)', 'Tracks L (MixRack I/O port 1 input 1)', 'Main L (MixRack output 20)', 'Booth (surface output 1)', 'Wedge 2 (DX output 1)', 'Lobby L (MixRack I/O port 2 output 1)']) assert.ok(small.left.includes(gone), `${gone}: listed when its box isn't drawn`);
  assert.equal(plain(D.build(show, { dx: 'generic' }, L)).boxes[2].model, 'generic', 'a DX as a generic box, if chosen');
  // Not a dLive show
  await assert.rejects(() => D.read(new Uint8Array(sample.tgz([['notes.txt', Buffer.from('hi')]])).buffer), /isn’t a dLive show/);
});

test('the plugin keeps one patch for every screen: each change on its own, two screens at once, junk, and the lock', async () => {
  plugins._reset();
  fs.cpSync(SOURCE, path.join(userData, 'plugins', 'patch'), { recursive: true });
  plugins.save({ patch: { enabled: true, settings: { showCard: true } } });
  const desk = { type: 'digico', connected: true, channels: [{ number: 1, name: 'Kick' }], groups: [{ number: 1, name: 'Drums' }], mixes: [{ number: 1, name: 'Vocal 1' }] };
  await plugins.start({ allowed: true, console: () => desk });
  try {
    const until = async (fn) => { for (let i = 0; i < 160; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };
    await until(() => plugins.list().find((p) => p.id === 'patch')?.state === 'running');
    const first = await plugins.callPage('patch', 'load', {});
    assert.equal(first.rev, 0);
    assert.deepEqual(first.console.groups, [{ number: 1, name: 'Drums' }], 'control groups come through');

    const add = await plugins.callPage('patch', 'change', {
      ops: [
        { op: 'putBox', box: { id: 'b1', model: 'digico-d-rack', name: 'Stage left', ports: { 'in.2': { name: 'x'.repeat(500), src: { kind: 'evil', n: 1 } }, '../x': { name: 'nope' } } } },
        { op: 'putBox', box: { id: 'NOT OK', model: 'digico-d-rack' } },
      ],
    });
    assert.equal(add.rev, 1);
    assert.equal(add.boxes.length, 1, 'a box with a bad id isn’t kept');
    assert.deepEqual(Object.keys(add.boxes[0].ports), ['in.2']);
    assert.equal(add.boxes[0].ports['in.2'].name.length, 40, 'names are kept short');
    assert.equal(add.boxes[0].ports['in.2'].src, undefined, 'only channels, control groups and mixes');
    assert.ok(fs.existsSync(path.join(plugins.dataDir('patch'), 'patch.json')), 'kept in its data folder');

    // Two screens at once, each changing a socket: both changes are kept (nothing undone)
    await Promise.all([
      plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'in.1', port: { name: 'Kick', src: { kind: 'ch', n: 1 }, phantom: true } }] }),
      plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'out.1', port: { src: { kind: 'mix', n: 1, side: 'L' }, phantom: 'yes' } }] }),
    ]);
    const both = await plugins.callPage('patch', 'load', {});
    assert.deepEqual(both.boxes[0].ports['in.1'], { name: 'Kick', note: '', src: { kind: 'ch', n: 1 }, phantom: true }, 'a socket marked as needing 48V keeps it');
    assert.equal(both.boxes[0].ports['out.1'].phantom, undefined, 'only true marks a socket for 48V');
    // A socket only marked for 48V (no name or channel yet) is kept
    await plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'in.9', port: { phantom: true } }] });
    assert.deepEqual((await plugins.callPage('patch', 'load', {})).boxes[0].ports['in.9'], { name: '', note: '', phantom: true });
    // Patched on the console to something JPMixer has no number for (an import's fed): kept, but never alongside a channel or mix
    await plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'out.5', port: { name: 'Drum IEM L', fed: true } }, { op: 'setPort', box: 'b1', key: 'out.6', port: { fed: true, src: { kind: 'mix', n: 2 } } }, { op: 'setPort', box: 'b1', key: 'out.7', port: { fed: 'yes' } }] });
    const fed = (await plugins.callPage('patch', 'load', {})).boxes[0].ports;
    assert.deepEqual([fed['out.5'], fed['out.6'], fed['out.7']], [{ name: 'Drum IEM L', note: '', fed: true }, { name: '', note: '', src: { kind: 'mix', n: 2 } }, undefined]);
    await plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'out.5', port: null }, { op: 'setPort', box: 'b1', key: 'out.6', port: null }] });
    assert.deepEqual(both.boxes[0].ports['out.1'].src, { kind: 'mix', n: 1, side: 'L' }, 'a stereo mix\'s side is kept');
    assert.ok(both.boxes[0].ports['in.2'], 'and the socket set before is still there');
    // Clearing a socket, and a change to a box that's gone
    const cleared = await plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'in.2', port: null }, { op: 'setPort', box: 'gone', key: 'in.1', port: { name: 'x' } }] });
    assert.equal(cleared.boxes[0].ports['in.2'], undefined);
    // A box's details edited: its sockets stay as saved (even ones another
    // screen changed since), less the ones the page says are gone
    const edited = await plugins.callPage('patch', 'change', { ops: [{ op: 'setBox', box: { id: 'b1', model: 'digico-d-rack', name: 'Stage right', location: 'SR', ports: {} }, drop: ['in.9'] }] });
    assert.deepEqual([edited.boxes[0].name, edited.boxes[0].location, edited.boxes[0].ports['in.1'].name, edited.boxes[0].ports['in.9']], ['Stage right', 'SR', 'Kick', undefined]);
    // Too many changes at once: refused, not cut short
    await assert.rejects(plugins.callPage('patch', 'change', { ops: Array.from({ length: 201 }, (_, i) => ({ op: 'setPort', box: 'b1', key: `in.${(i % 32) + 1}`, port: { name: 'x' } })) }), /Too many changes/);
    // The card counts the saved patch itself: Kick (in 1) and out 1 of the D-Rack's 40, then Kick twice
    const card = () => plugins.cards().find((c) => c.id === 'patch')?.card;
    await until(() => card() && card().value === '2' && card().unit === 'of 40');
    await plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'in.3', port: { src: { kind: 'ch', n: 1 } } }] });
    await until(() => card() && card().rows.some((r) => r.label === 'Ch 1 · Kick' && r.value === 'patched twice'));
    await plugins.callPage('patch', 'change', { ops: [{ op: 'setPort', box: 'b1', key: 'in.3', port: null }] });

    // Started again: the same patch
    await plugins.restart('patch');
    await until(() => plugins.list().find((p) => p.id === 'patch')?.state === 'running');
    const again = await plugins.callPage('patch', 'load', {});
    assert.equal(again.rev, 10);
    assert.equal(again.boxes[0].ports['in.1'].name, 'Kick');

    // Locked: it can be looked at, not changed
    plugins.save({ patch: { settings: { locked: true } } });
    await plugins.apply();
    await until(() => plugins.list().find((p) => p.id === 'patch')?.state === 'running');
    assert.equal((await plugins.callPage('patch', 'load', {})).locked, true);
    await assert.rejects(plugins.callPage('patch', 'change', { ops: [{ op: 'removeBox', box: 'b1' }] }), /locked/);
    assert.equal((await plugins.callPage('patch', 'load', {})).boxes.length, 1, 'nothing changed while locked');
    // Unlocked: a box can be removed
    plugins.save({ patch: { settings: { locked: false } } });
    await plugins.apply();
    await until(() => plugins.list().find((p) => p.id === 'patch')?.state === 'running');
    assert.deepEqual((await plugins.callPage('patch', 'change', { ops: [{ op: 'removeBox', box: 'b1' }] })).boxes, []);
  } finally {
    await plugins.stopAll();
  }
});
