'use strict';

// The patch in a dLive show: the .tar.gz a show is saved as (on the surface
// or in dLive Director), read here in the page. Worked out from a dLive V2
// show (2026-10-27), checked against dLive Director and its factory shows:
//   Show/Scenes/StageBoxScene65535.tar.gz  the MixRack's current state, one
//     .dat of records: [uint16 BE length][name\0][settings], length counting
//     the name, its \0 and the settings
//   "<type> Channel Name Colour Manager"   each channel's or mix's name: a
//     byte, then 8 characters and a colour byte for each
//   "Channel Mapper"   the patch: a byte, then 13 per input channel (a flag
//     byte, then four sources of [source type, number (uint16 BE, from 0)],
//     the first the channel's; type 0x14 is none), 256 3-byte sources and 128
//     flags not used here, then a source for every output, in sections (OUT)
//   "StageBox Analogue Input, Number NN"   the MixRack's mic/line inputs:
//     [1, gain (uint16 BE, 1/256 dB), pad 0|1, 48V 0|1]
//   Show/Scenes/SurfaceScene65535.tar.gz   the surface's, with its own
//     inputs as "Surface Analogue Input, Number NN" (the same settings)
// Sockets as sources: 0x00 the MixRack's own inputs (1-64); 0x01 the
// surface's (mic/line 1-8, AES 9-12, its DX 13-44, I/O port 4 45-172, I/O
// port 5 173-300); 0x03 the MixRack's I/O ports (port 1 1-128, 2 129-256, 3
// 257-384: Dante in that show); 0x05 its DX ports (DX 1/2 1-32, DX 3/4
// 33-64, 16 for each DX168). Mixes and the rest: sourceOf() below; any other
// is named by its number.
//   PatchDLive.read(buffer) → a show; PatchDLive.build(show, choices, L) → { boxes, … }
(() => {
  const NONE = 0x14;
  const TYPE = { MIXRACK: 0x00, SURFACE: 0x01, CARD: 0x03, DX: 0x05 };
  // Where each output's source is after the inputs, in the order of A&H's
  // own list (the factory shows: MixRack outputs 1-32 are Main LR, auxes and
  // matrices): the surface's outputs, then the MixRack's. Insert returns,
  // FX inputs and the ME port aren't sockets here, so they're skipped.
  const OUT = [
    { at: 257, count: 8, area: 'surface' },        // surface outputs 1-8
    { at: 265, count: 6, area: 'surfaceAes' },     // surface AES outs 1-6 (3 pairs)
    { at: 305, count: 128, area: 'surfaceIo', port: 4 },
    { at: 433, count: 128, area: 'surfaceIo', port: 5 },
    { at: 561, count: 2, area: 'usb' },            // the surface's USB recording
    { at: 1357, count: 32, area: 'mixrack' },      // MixRack outputs 1-32
    { at: 1454, count: 128, area: 'io', port: 1 },
    { at: 1582, count: 128, area: 'io', port: 2 },
    { at: 1710, count: 128, area: 'io', port: 3 },
    { at: 1838, count: 64, area: 'dx' },           // DX 1/2 1-32, DX 3/4 33-64
  ];
  const OUT_START = 1 + 13 * 128 + 256 * 3 + 128;
  const OUT_COUNT = 1902; // through the DX ports
  const latin1 = new TextDecoder('latin1');
  const tidy = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim();

  async function gunzip(buffer) {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // A tar's files: path -> bytes (plain files only)
  function untar(bytes) {
    const files = new Map();
    const str = (o, n) => latin1.decode(bytes.subarray(o, o + n)).replace(/\0[\s\S]*$/, '');
    for (let o = 0; o + 512 <= bytes.length;) {
      const name = str(o, 100);
      if (!name) break;
      const size = parseInt(str(o + 124, 12).trim() || '0', 8) || 0;
      const type = bytes[o + 156];
      const prefix = str(o + 257, 6).startsWith('ustar') ? str(o + 345, 155) : '';
      o += 512;
      if (type === 0 || type === 48) files.set((prefix ? `${prefix}/` : '') + name, bytes.subarray(o, o + size));
      o += Math.ceil(size / 512) * 512;
    }
    return files;
  }
  // The file in a tar whose path ends with `tail`
  const fileEnding = (files, tail) => { for (const [path, data] of files) if (path.endsWith(tail)) return data; return null; };
  async function sceneDat(files, name) {
    const gz = fileEnding(files, `Scenes/${name}.tar.gz`);
    if (!gz) return null;
    const inner = untar(await gunzip(gz));
    return fileEnding(inner, `${name}.dat`);
  }

  // A record's settings, by its name
  function record(b, name) {
    const needle = new TextEncoder().encode(`${name}\0`);
    outer: for (let i = 2; i + needle.length <= b.length; i++) {
      for (let k = 0; k < needle.length; k++) if (b[i + k] !== needle[k]) continue outer;
      const len = (b[i - 2] << 8) | b[i - 1];
      if (len < needle.length || i + len > b.length) continue;
      return b.subarray(i + needle.length, i + len);
    }
    return null;
  }
  // The names in a Name Colour Manager, from 1 ('' where it's the default,
  // a plain number)
  function names(b, what) {
    const r = record(b, `${what} Channel Name Colour Manager`);
    const out = [''];
    for (let o = 1; r && o + 9 <= r.length; o += 9) {
      const n = tidy(latin1.decode(r.subarray(o, o + 8)).split('\0')[0]);
      out.push(/^\d*$/.test(n) ? '' : n);
    }
    return out;
  }
  // Preamps by socket number: { gain, pad, phantom }
  function preamps(b, prefix, count) {
    const out = new Map();
    if (!b) return out;
    for (let n = 1; n <= count; n++) {
      const p = record(b, `${prefix}, Number ${String(n).padStart(2, '0')}`);
      if (p && p.length >= 5) out.set(n, { gain: ((p[1] << 8) | p[2]) / 256, pad: p[3] === 1, phantom: p[4] === 1 });
    }
    return out;
  }

  async function read(buffer) {
    const files = untar(await gunzip(buffer));
    const rack = await sceneDat(files, 'StageBoxScene65535');
    if (!rack) throw new Error('This isn’t a dLive show: it has no MixRack scene in it.');
    const mapper = record(rack, 'Channel Mapper');
    if (!mapper || mapper.length < 1 + 13 * 128) throw new Error('This dLive show has no input patch in it.');
    const label = {};
    for (const [key, what] of [['input', 'Input'], ['monoGroup', 'Mono Group'], ['stereoGroup', 'Stereo Group'], ['monoAux', 'Mono Aux'], ['stereoAux', 'Stereo Aux'],
      ['main', 'Main'], ['monoMatrix', 'Mono Matrix'], ['stereoMatrix', 'Stereo Matrix'], ['stereoFx', 'Stereo FX Send']]) label[key] = names(rack, what);
    const inputs = [];
    for (let ch = 1; ch <= 128; ch++) {
      const e = mapper.subarray(1 + 13 * (ch - 1), 1 + 13 * ch);
      const type = e[1], n = ((e[2] << 8) | e[3]) + 1;
      inputs.push({ ch, name: label.input[ch] || `Ch ${ch}`, ...(type === NONE ? {} : { type, n }) });
    }
    // Each output with a source: { area, port?, n (from 1), type, sn (the source's number) }
    const outputs = [];
    if (mapper.length >= OUT_START + 3 * OUT_COUNT) {
      for (const sec of OUT) {
        for (let i = 0; i < sec.count; i++) {
          const o = OUT_START + 3 * (sec.at + i);
          if (mapper[o] !== NONE) outputs.push({ area: sec.area, ...(sec.port ? { port: sec.port } : {}), n: i + 1, type: mapper[o], sn: ((mapper[o + 1] << 8) | mapper[o + 2]) + 1 });
        }
      }
    }
    const surface = await sceneDat(files, 'SurfaceScene65535');
    const version = fileEnding(files, 'Show/Version.dat');
    return {
      version: version ? tidy(latin1.decode(version)) : '',
      inputs,
      outputs,
      names: label,
      rackPreamps: preamps(rack, 'StageBox Analogue Input', 64),
      surfacePreamps: preamps(surface, 'Surface Analogue Input', 8),
    };
  }

  // What feeds an output: { name, src? (JPMixer's channel or mix), note }.
  // Stereo mixes count their sides (1 = mix 1 left, 2 = mix 1 right). JPMixer's
  // dLive aux N is mono aux N (src/server/dlive-protocol.js).
  const pair = (n) => Math.ceil(n / 2);
  const side = (n) => (n % 2 ? 'L' : 'R');
  const sideWord = (n) => (n % 2 ? 'left' : 'right');
  function sourceOf(show, type, n) {
    const L = show.names;
    const ch = (k) => L.input[k] || `Ch ${k}`;
    const stereo = (list, word) => `${list[pair(n)] || `${word} ${pair(n)}`} ${side(n)}`;
    const main = ['L', 'R', 'M'][n - 1] || n;
    // A tie line from a socket: named for the channel on that socket, if any
    const tie = (short, long) => {
      const on = show.inputs.find((c) => c.type === type && c.n === n);
      return { name: on ? on.name : short, note: `Tie line from ${long}${on ? ` (Ch ${on.ch}${on.name === `Ch ${on.ch}` ? '' : ` ${on.name}`})` : ''}.` };
    };
    switch (type) {
      case 0x00: return tie(`MixRack in ${n}`, `MixRack input ${n}`);
      case 0x01: return tie(`Surface in ${n}`, `surface input ${n}`);
      case 0x03: return tie(`I/O ${Math.ceil(n / 128)} in ${((n - 1) % 128) + 1}`, `MixRack I/O port ${Math.ceil(n / 128)} input ${((n - 1) % 128) + 1}`);
      case 0x05: return tie(`DX in ${n}`, `DX input ${n}`);
      case 0x07: return { name: ch(n), src: { kind: 'ch', n }, note: `Direct out of Ch ${n}.` };
      case 0x08: return { name: `${ch(n)} ins`, note: `Insert send of Ch ${n}.` };
      case 0x0c: return { name: L.monoGroup[n] || `Group ${n}`, note: `Group ${n}.` };
      case 0x0d: return { name: stereo(L.stereoGroup, 'St Group'), note: `Stereo group ${pair(n)}, ${sideWord(n)}.` };
      case 0x0e: return { name: L.monoAux[n] || `Aux ${n}`, src: { kind: 'mix', n }, note: `Aux ${n}.` };
      case 0x0f: return { name: stereo(L.stereoAux, 'St Aux'), note: `Stereo aux ${pair(n)}, ${sideWord(n)}.` };
      case 0x10: return { name: `Main ${main}`, note: `The main mix${n <= 2 ? `, ${sideWord(n)}` : ''}.` };
      case 0x11: return { name: L.monoMatrix[n] || `Matrix ${n}`, note: `Matrix ${n}.` };
      case 0x12: return { name: stereo(L.stereoMatrix, 'St Matrix'), note: `Stereo matrix ${pair(n)}, ${sideWord(n)}.` };
      case 0x13: return { name: `PAFL ${pair(n)} ${side(n)}`, note: `PAFL ${pair(n)}, ${sideWord(n)}.` };
      case 0x16: return { name: `${stereo(L.stereoGroup, 'St Group')} ins`, note: `Insert send of stereo group ${pair(n)}.` };
      case 0x18: return { name: `${stereo(L.stereoAux, 'St Aux')} ins`, note: `Insert send of stereo aux ${pair(n)}.` };
      case 0x19: return { name: `Main ${main} ins`, note: 'Insert send of the main mix.' };
      case 0x1d: return { name: L.stereoFx[n] || `FX send ${n}`, note: `FX send ${n}.` };
      default: {
        const t = type.toString(16).padStart(2, '0');
        return { name: `dLive ${t}/${n}`, note: `A dLive source Patch doesn’t know yet (type ${t}, ${n}).` };
      }
    }
  }

  // The models the preview offers for each
  const rackModels = (L) => L.BOXES.filter((m) => /^ah-cdm/.test(m.id));
  const surfaceModels = (L) => L.BOXES.filter((m) => m.family === 'allen-heath-console');
  // The smallest MixRack with every input and output the show uses (a CDM
  // has half as many outputs as inputs)
  function rackFor(show) {
    const top = Math.max(0, ...show.inputs.filter((c) => c.type === TYPE.MIXRACK).map((c) => c.n), ...show.outputs.filter((o) => o.area === 'mixrack').map((o) => o.n * 2));
    return top <= 32 ? 'ah-cdm32' : top <= 48 ? 'ah-cdm48' : 'ah-cdm64';
  }
  const uses = (show, type, areas) => show.inputs.some((c) => c.type === type) || show.outputs.some((o) => areas.includes(o.area));

  function build(show, choices, L) {
    const boxes = [], left = [];
    let inputs = 0, outputs = 0, withPhantom = 0;
    const layoutKeys = new Map(); // box id -> set of its socket keys
    const keysOf = (box) => { if (!layoutKeys.has(box.id)) layoutKeys.set(box.id, new Set(L.layoutFor(box).ports.map((p) => p.key))); return layoutKeys.get(box.id); };
    // One socket. A pair socket (AES), or one socket with more than one
    // channel on it, gets the others in its note.
    const put = (box, key, item, phantom) => {
      const had = box.ports[key];
      if (had) {
        if (!had._names.includes(item.name)) { had._names.push(item.name); had.name = had._names.join(' / ').slice(0, 40); }
        had[/^aes/.test(key) ? '_pair' : '_also'].push(item.also);
        return;
      }
      box.ports[key] = { name: item.name.slice(0, 40), ...(item.src ? { src: item.src } : item.fed ? { fed: true } : {}), ...(phantom ? { phantom: true } : {}), ...(item.note ? { note: item.note } : {}), _names: [item.name], _also: [], _pair: [] };
      if (/^(aes)?out\./.test(key)) outputs++; else inputs++;
      if (phantom) withPhantom++;
    };
    const input = (c) => ({ name: c.name, src: { kind: 'ch', n: c.ch }, also: `Ch ${c.ch} (${c.name})` });
    // An output fed by something JPMixer has no number for (a stereo aux, a
    // tie line) is still patched: fed
    const output = (o) => { const s = sourceOf(show, o.type, o.sn); return { ...s, fed: !s.src, also: s.name }; };

    // The MixRack
    const rackModel = choices.rack || rackFor(show);
    const rack = uses(show, TYPE.MIXRACK, ['mixrack']) ? { id: 'dl-mixrack', model: rackModel, name: 'MixRack', location: 'On stage', ports: {} } : null;
    if (rack) boxes.push(rack);
    // The surface's own I/O
    const surfaceModel = choices.surface || 'ah-s7000';
    const surface = uses(show, TYPE.SURFACE, ['surface', 'surfaceAes']) && surfaceModel !== 'none' ? { id: 'dl-surface', model: surfaceModel, name: 'Surface', location: 'At the console', ports: {} } : null;
    if (surface) boxes.push(surface);
    // DX expanders: 16 inputs and 16 outputs for each (a DX168 has 8 outputs)
    const dxModel = choices.dx || 'ah-dx168';
    const dx = new Map(); // index from 0 -> box
    const dxBox = (k) => {
      if (!dx.has(k)) { const box = { id: `dl-dx-${k + 1}`, model: dxModel, name: `DX168${k ? ` ${k + 1}` : ''}`, location: '', ports: {} }; dx.set(k, box); boxes.push(box); }
      return dx.get(k);
    };
    // The I/O ports (the MixRack's 1-3, the surface's 4 and 5): a network
    // device for each, a tile for each channel in use, in channel order
    const ports = new Map(); // port -> { ins: [{ ch, item }], outs: [...] }
    const onPort = (port, dir, ch, item) => {
      if (!ports.has(port)) ports.set(port, { ins: [], outs: [] });
      ports.get(port)[dir].push({ ch, item });
    };

    for (const c of show.inputs) {
      if (c.type === undefined) continue;
      if (c.type === TYPE.MIXRACK && rack) {
        const key = `in.${c.n}`;
        if (keysOf(rack).has(key)) { put(rack, key, input(c), (show.rackPreamps.get(c.n) || {}).phantom); continue; }
        left.push(`${c.name} (MixRack input ${c.n})`);
      } else if (c.type === TYPE.SURFACE) {
        if (c.n >= 45 && c.n <= 300) { const port = c.n <= 172 ? 4 : 5; onPort(port, 'ins', c.n - (port === 4 ? 44 : 172), input(c)); continue; }
        if (!surface) { left.push(`${c.name} (surface input ${c.n})`); continue; }
        const key = c.n <= 8 ? `in.${c.n}` : c.n <= 12 ? `aesin.${Math.ceil((c.n - 8) / 2)}` : null;
        if (key && keysOf(surface).has(key)) { put(surface, key, input(c), c.n <= 8 && (show.surfacePreamps.get(c.n) || {}).phantom); continue; }
        left.push(`${c.name} (surface input ${c.n})`);
      } else if (c.type === TYPE.DX) {
        if (dxModel === 'none') { left.push(`${c.name} (DX input ${c.n})`); continue; }
        const box = dxBox(Math.floor((c.n - 1) / 16));
        const key = `in.${((c.n - 1) % 16) + 1}`;
        if (keysOf(box).has(key)) put(box, key, input(c), false); else left.push(`${c.name} (DX input ${c.n})`);
      } else if (c.type === TYPE.CARD) {
        onPort(Math.ceil(c.n / 128), 'ins', ((c.n - 1) % 128) + 1, input(c));
      } else left.push(`${c.name} (from ${sourceOf(show, c.type, c.n).name})`); // a mix, say
    }

    for (const o of show.outputs) {
      const item = output(o);
      if (o.area === 'mixrack') {
        if (rack && keysOf(rack).has(`out.${o.n}`)) put(rack, `out.${o.n}`, item, false);
        else left.push(`${item.name} (MixRack output ${o.n})`);
      } else if (o.area === 'surface' || o.area === 'surfaceAes') {
        const key = o.area === 'surface' ? `out.${o.n}` : `aesout.${pair(o.n)}`;
        if (surface && keysOf(surface).has(key)) put(surface, key, item, false);
        else left.push(`${item.name} (surface ${o.area === 'surface' ? 'output' : 'AES out'} ${o.n})`);
      } else if (o.area === 'dx') {
        if (dxModel === 'none') { left.push(`${item.name} (DX output ${o.n})`); continue; }
        const box = dxBox(Math.floor((o.n - 1) / 16));
        const key = `out.${((o.n - 1) % 16) + 1}`;
        if (keysOf(box).has(key)) put(box, key, item, false); else left.push(`${item.name} (DX output ${o.n})`);
      } else if (o.area === 'io' || o.area === 'surfaceIo') onPort(o.port, 'outs', o.n, item);
      else if (o.area === 'usb') left.push(`${item.name} (USB recording ${o.n})`);
    }

    // The I/O ports. Port 1 is the Dante card in the show this was worked
    // out from; what's in the others isn't in the show.
    let card = 0;
    for (const port of [...ports.keys()].sort((a, b) => a - b)) {
      const { ins, outs } = ports.get(port);
      const where = port <= 3 ? `MixRack I/O port ${port}` : `surface I/O port ${port}`;
      if (choices.card === false) {
        for (const x of ins) left.push(`${x.item.name} (${where} input ${x.ch})`);
        for (const x of outs) left.push(`${x.item.name} (${where} output ${x.ch})`);
        continue;
      }
      const inCh = [...new Set(ins.map((x) => x.ch))].sort((a, b) => a - b);
      const outCh = [...new Set(outs.map((x) => x.ch))].sort((a, b) => a - b);
      const box = {
        id: port === 1 ? 'dl-card' : port <= 3 ? `dl-card-${port}` : `dl-sio-${port}`, model: 'network',
        name: port <= 3 ? `I/O Port ${port}` : `Surface I/O Port ${port}`, location: port <= 3 ? '' : 'At the console', ports: {},
        options: port === 1 ? {} : { kind: 'other' }, generic: { inputs: inCh.length, outputs: outCh.length },
      };
      boxes.push(box);
      for (const x of ins) {
        const key = `in.${inCh.indexOf(x.ch) + 1}`;
        put(box, key, { ...x.item, note: `On the console as ${where} input ${x.ch}.` }, false);
      }
      for (const x of outs) put(box, `out.${outCh.indexOf(x.ch) + 1}`, { ...x.item, note: `${where} output ${x.ch}. ${x.item.note}` }, false);
      card += inCh.length + outCh.length;
    }
    for (const b of boxes) for (const p of Object.values(b.ports)) {
      if (p._also.length) p.note = [p.note, `Also patched to ${p._also.join(', ')}.`].filter(Boolean).join(' ');
      if (p._pair.length) p.note = [p.note, `Also on this pair: ${p._pair.join(', ')}.`].filter(Boolean).join(' ');
      if (p.note) p.note = p.note.slice(0, 120);
      delete p._names; delete p._also; delete p._pair;
    }
    return { boxes, inputs, outputs, left, devices: boxes.length, phantom: withPhantom, card };
  }

  window.PatchDLive = { read, build, rackFor, rackModels, surfaceModels, sourceOf, TYPE };
})();
