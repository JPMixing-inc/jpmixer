'use strict';

// The patch in a DiGiCo session file (.ses), read in the page. Worked out
// from Quantum 225 sessions ("DiGiCo Q2 .SES vI", 2026-10-26); other DiGiCo
// consoles may differ, and anything this can't find makes it say so.
//   Header: "DiGiCo …SES…", then 27 section offsets (uint32 LE) at 0x100.
//   Section 4, the I/O list: `ca 00 6c 00` group records (id, name) and
//     `cb 00 58 00` socket records (index, group, number, name, mono/stereo).
//     Groups used here: 0x1c/0x4e local I/O, 0x1d/0x4f MADI 1, 0x1e/0x50
//     MADI 2, 0x1f/0x51 Dante, 0x21 USB, 0x22 Waves (in/out); 0x01 input channels, 0x05 auxes,
//     0x06 groups, 0x07 busses (right sides), 0x09 talkback outs, 0x0b solo,
//     0x10 matrix outs.
//   Section 6, the current state: `da 00 3a 00 <type>` records with 8-byte
//     entries [id, type, side, 0, value ×4]. Type 1 records are the input
//     channels in order; entry 0x00 is the input: value bytes [0, 0,
//     socket index, group]. A stereo channel's right side is the next socket.
//     Type 0x0e records are every output (channel direct outs, auxes,
//     groups, busses, talkback, solo, matrices, in the I/O list's order);
//     entry 0xfe is where it goes, the same way. Type 0x11 records are
//     every input socket (groups 0x1b-0x22, in the I/O list's order): entry
//     0x83 is its 48V (float 1 or 0; matched the desk's own answers over
//     OSC), 0x86 probably its gain in dB.
// With a rack on Dante or MADI the session only knows the port's channel
// numbers, not the box, so build() is told which box is there.
//   PatchDiGiCo.read(buffer) → session; PatchDiGiCo.build(session, choices, library)
(() => {
  const latin1 = new TextDecoder('latin1');
  // USB and Waves are inputs only here: what goes out to them is recording
  const IN = { local: 0x1c, madi1: 0x1d, madi2: 0x1e, dante: 0x1f, usb: 0x21, waves: 0x22 };
  const OUT = { local: 0x4e, madi1: 0x4f, madi2: 0x50, dante: 0x51 };
  // short: how one of its channels is named ("Dante 35"); play: its playback box
  const PORTS = [
    { id: 'local', label: 'the console’s own I/O', short: 'Local' },
    { id: 'dante', label: 'Dante', short: 'Dante', play: 'Dante playback', what: 'other Dante devices' },
    { id: 'madi1', label: 'MADI port 1', short: 'MADI 1 ch', play: 'MADI 1 playback', what: 'MADI port 1' },
    { id: 'madi2', label: 'MADI port 2', short: 'MADI 2 ch', play: 'MADI 2 playback', what: 'MADI port 2' },
    { id: 'usb', label: 'USB', short: 'USB', play: 'USB playback', what: 'a computer on USB', noRack: true },
    { id: 'waves', label: 'Waves SoundGrid', short: 'Waves', play: 'Waves SoundGrid', what: 'a SoundGrid server or computer', noRack: true },
  ];
  const portOf = (gid) => Object.keys(IN).find((k) => IN[k] === gid || OUT[k] === gid);
  // A Dante channel with a preamp (DiGiCo names it DntMic): from the rack.
  // Plain ones (Dnt64) come from other Dante devices, like a playback
  // computer, and USB and Waves are a computer or a server: those go on a
  // playback box of their own.
  const fromRack = (session, gid, idx) => (gid === IN.dante ? /Mic/i.test((session.sockets.get(`${gid}:${idx}`) || {}).name || '') : gid !== IN.usb && gid !== IN.waves);
  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function findAll(b, pat, from, to) {
    const out = [];
    for (let i = from; i <= to - pat.length; i++) {
      if (b[i] !== pat[0]) continue;
      let ok = true;
      for (let k = 1; k < pat.length; k++) if (b[i + k] !== pat[k]) { ok = false; break; }
      if (ok) out.push(i);
    }
    return out;
  }

  function read(buffer) {
    const b = new Uint8Array(buffer);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const head = latin1.decode(b.subarray(0, 24));
    if (b.length < 0x200 || !/^DiGiCo/.test(head) || !/SES/.test(head)) throw new Error('This isn’t a DiGiCo session file.');
    const offs = [];
    for (let o = 0x100; o < 0x1c8; o += 4) offs.push(dv.getUint32(o, true));
    const damaged = () => new Error('This DiGiCo session couldn’t be read. It was tested with Quantum sessions; yours may be laid out differently.');
    const [s4, e4, s6, e6] = [offs[4], offs[5], offs[6], offs[7]];
    if (!(s4 < e4 && e4 <= s6 && s6 < e6 && e6 <= b.length)) throw damaged();

    // The I/O list
    const groups = new Map(); // id -> name
    for (const i of findAll(b, [0xca, 0x00, 0x6c, 0x00], s4, e4)) groups.set(b[i + 4], latin1.decode(b.subarray(i + 6, i + 6 + b[i + 5])));
    const sockets = new Map(); // "gid:idx" -> { name, stereo }
    const list = (gid) => [...sockets.entries()].filter(([k]) => Number(k.split(':')[0]) === gid).map(([k, v]) => ({ idx: Number(k.split(':')[1]), ...v })).sort((x, y) => x.idx - y.idx);
    for (const i of findAll(b, [0xcb, 0x00, 0x58, 0x00], s4, e4)) {
      const p = b.subarray(i + 4, i + 4 + 0x58);
      const nameEnd = 5 + p[4];
      let k = nameEnd;
      while (k < p.length - 4 && !(p[k] === 0xff && p[k + 1] === 0xff && p[k + 2] === 0xff && p[k + 3] === 0xff)) k++;
      sockets.set(`${p[1]}:${p[0]}`, { name: latin1.decode(p.subarray(5, nameEnd)), stereo: p[k - 1] === 2 });
    }
    const channels = list(0x01);
    if (!channels.length) throw damaged();

    // Records in the current state, with their entries
    function records(type) {
      const starts = findAll(b, [0xda, 0x00, 0x3a, 0x00, type, 0, 0, 0], s6, e6);
      return starts.map((r, n) => {
        const end = n + 1 < starts.length ? starts[n + 1] : e6;
        let s0 = 0x38;
        while (s0 < 0x46 && ![0, 1, 2].every((k) => b[r + s0 + 8 * k + 1] === type)) s0++;
        const entries = [];
        if (s0 < 0x46) {
          for (let p = r + s0; p + 8 <= end && b[p + 1] === type; p += 8) {
            if (b.subarray(p, p + 8).every((x) => x === 0xff)) break;
            entries.push({ id: b[p], side: b[p + 2], value: b.subarray(p + 4, p + 8) });
          }
        }
        return { name: tidy(latin1.decode(b.subarray(r + 9, r + 9 + b[r + 8]))), entries };
      });
    }
    // An entry pointing at a socket: [0, 0, index, group]
    const target = (rec, id, groupsOk) => {
      const e = rec.entries.find((x) => x.id === id && x.side === 0);
      if (!e || e.value[0] || e.value[1] || !groupsOk.includes(e.value[3])) return null;
      return { gid: e.value[3], idx: e.value[2] };
    };

    const inRecs = records(0x01);
    if (inRecs.length < channels.length) throw damaged();
    const inputs = channels.map((c, n) => ({
      n: n + 1, name: tidy(c.name) || `Ch ${n + 1}`, stereo: c.stereo,
      socket: target(inRecs[n], 0x00, Object.values(IN)),
    }));

    // Outputs: the I/O list's kinds, in its order
    const kinds = [[0x01, 'ch'], [0x05, 'aux'], [0x06, 'group'], [0x07, 'bus'], [0x09, 'talkback'], [0x0b, 'solo'], [0x10, 'matrix']];
    const outRecs = records(0x0e);
    const outputs = [];
    let at = 0;
    if (outRecs.length === kinds.reduce((sum, [g]) => sum + list(g).length, 0)) {
      for (const [gid, kind] of kinds) {
        list(gid).forEach((item, n) => {
          const rec = outRecs[at++];
          const socket = target(rec, 0xfe, Object.values(OUT));
          if (socket) outputs.push({ kind, index: n + 1, name: tidy(item.name) || rec.name, socket });
        });
      }
    }
    // 48V on each input socket. If the records don't line up with the I/O
    // list (another console, another version), the session just has no 48V.
    const ins = [...sockets.keys()].filter((k) => { const g = Number(k.split(':')[0]); return g >= 0x1b && g <= 0x22; })
      .sort((x, y) => { const [a, i] = x.split(':').map(Number), [c, j] = y.split(':').map(Number); return a - c || i - j; });
    const sockRecs = records(0x11);
    const fixedName = (k) => [IN.local, IN.dante].includes(Number(k.split(':')[0]));
    if (sockRecs.length === ins.length && ins.every((k, n) => !fixedName(k) || tidy(sockets.get(k).name) === sockRecs[n].name)) {
      ins.forEach((k, n) => {
        const e = sockRecs[n].entries.find((x) => x.id === 0x83 && x.side === 0);
        if (e && e.value.some(Boolean)) sockets.get(k).phantom = true;
      });
    }
    return { console: tidy(head.replace(/\.SES.*$/, '').replace(/^DiGiCo/, '')), inputs, outputs, sockets, auxes: list(0x05).map((a) => tidy(a.name)) };
  }

  // What's on each port, for the import's choices
  function ports(session) {
    const used = new Map(PORTS.map((p) => [p.id, { ...p, inputs: 0, outputs: 0, maxIn: 0, maxOut: 0, rackInputs: new Set(), others: 0 }]));
    for (const c of session.inputs) {
      if (!c.socket) continue;
      const p = used.get(portOf(c.socket.gid));
      if (!p) continue;
      p.inputs++;
      for (let k = 0; k < (c.stereo ? 2 : 1); k++) {
        if (fromRack(session, c.socket.gid, c.socket.idx + k)) { p.rackInputs.add(c.socket.idx + k); p.maxIn = Math.max(p.maxIn, c.socket.idx + k + 1); } else p.others++;
      }
    }
    for (const o of session.outputs) {
      const p = used.get(portOf(o.socket.gid));
      if (!p) continue;
      p.outputs++; p.maxOut = Math.max(p.maxOut, o.socket.idx + 1);
    }
    return [...used.values()].filter((p) => p.inputs || p.outputs);
  }

  // The boxes, with a choice of model for each rack port: { dante: 'digico-dq-rack', danteOuts: true, … }
  function build(session, choices, L, mixes) {
    const found = ports(session);
    const boxes = [];
    const place = new Map(); // "in|out:gid:idx" -> { box, key }
    const keysOf = (box, kind) => L.layoutFor(box).ports.filter((p) => p.kind === kind && !p.pair && new RegExp(`^${kind}\\.\\d+$`).test(p.key)).map((p) => p.key)
      .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]));
    for (const port of found) {
      if (port.noRack) continue;
      if (port.id === 'local') {
        const local = (gid) => [...session.sockets.keys()].filter((k) => Number(k.split(':')[0]) === gid).map((k) => Number(k.split(':')[1])).sort((a, b) => a - b);
        const ins = local(IN.local), outs = local(OUT.local);
        // Drawn as the console (the one chosen, or the session's own), its
        // sockets in the session's order: mic/line (or line out) 1-N, then
        // AES channel by channel, two to a socket (names can be changed on
        // the console, so they're not used); or a generic box in order
        const model = consoleModels(L).find((m) => m.id === (choices.console || consoleFor(session.console)));
        if (model) {
          const box = { id: 'dg-local', model: model.id, name: model.name.replace(/ \(console\)$/, '').slice(0, 40), location: 'At the console', ports: {} };
          boxes.push(box);
          const keys = L.layoutFor(box).ports.map((p) => p.key);
          for (const [gid, dir, list] of [[IN.local, 'in', ins], [OUT.local, 'out', outs]]) {
            const plain = keys.filter((k) => new RegExp(`^${dir}\\.\\d+$`).test(k)).length;
            const aes = keys.filter((k) => k.startsWith(`aes${dir}.`)).length;
            list.forEach((idx, i) => {
              if (i < plain) place.set(`${dir}:${gid}:${idx}`, { box, key: `${dir}.${i + 1}` });
              else if (i - plain < aes * 2) place.set(`${dir}:${gid}:${idx}`, { box, key: `aes${dir}.${Math.floor((i - plain) / 2) + 1}`, pair: true });
            });
          }
          continue;
        }
        const box = { id: 'dg-local', model: 'generic', name: `${session.console || 'Console'} local I/O`.slice(0, 40), location: 'At the console', ports: {}, generic: { inputs: Math.min(128, ins.length), outputs: Math.min(128, outs.length) } };
        boxes.push(box);
        ins.forEach((idx, i) => place.set(`in:${IN.local}:${idx}`, { box, key: `in.${i + 1}` }));
        outs.forEach((idx, i) => place.set(`out:${OUT.local}:${idx}`, { box, key: `out.${i + 1}` }));
        continue;
      }
      const model = choices[port.id] || (port.id === 'dante' ? 'digico-dq-rack' : 'generic');
      // Not a rack: its inputs are left off (listed); playback: a box for its channels, below
      if (model === 'none' || model === 'playback') continue;
      const label = port.id === 'dante' ? 'Dante' : port.label;
      // Racks of that model, one after another, until every socket in use has a place
      const make = (n) => {
        const box = { id: `dg-${port.id}-${n}`, model, name: `${label} rack${n > 1 ? ` ${n}` : ''}`, location: '', ports: {} };
        if (model === 'generic') box.generic = { inputs: Math.min(128, port.maxIn), outputs: Math.min(128, choices[`${port.id}Outs`] === false ? 0 : port.maxOut) };
        return box;
      };
      let first = make(1);
      const inKeys = keysOf(first, 'in'), outKeys = keysOf(first, 'out');
      // As many as it takes for the inputs in use (a stray one past the end is listed, not given a rack of its own)
      // Every rack its inputs are on (by channel: 1-16 and 33-48 on 16-input
      // racks is three), but not one for a single stray channel past the
      // others (that's listed instead)
      const perRack = new Map();
      for (const idx of port.rackInputs) { const n = Math.floor(idx / (inKeys.length || 1)); perRack.set(n, (perRack.get(n) || 0) + 1); }
      const used = [...perRack].filter(([n, count]) => count > 1 || n === 0).map(([n]) => n);
      const racks = Math.max(1, Math.min(8, Number(choices[`${port.id}Racks`]) || (inKeys.length && used.length ? Math.max(...used) + 1 : 1)));
      for (let n = 1; n <= racks; n++) {
        const box = n === 1 ? first : make(n);
        boxes.push(box);
        inKeys.forEach((key, i) => place.set(`in:${IN[port.id]}:${(n - 1) * inKeys.length + i}`, { box, key }));
        if (choices[`${port.id}Outs`] !== false) outKeys.forEach((key, i) => place.set(`out:${OUT[port.id]}:${(n - 1) * outKeys.length + i}`, { box, key }));
      }
    }

    let inputs = 0, outputs = 0, others = 0, withPhantom = 0;
    const left = []; // patched, but past the racks chosen: "PROD TB (Dante 50)"
    const sockName = (gid, idx) => `${PORTS.find((p) => p.id === portOf(gid)).short} ${idx + 1}`;
    const play = new Map(); // port id -> [{ idx, name, src }] for its playback box
    const put = (where, port) => {
      const had = where.box.ports[where.key];
      if (!had) { where.box.ports[where.key] = { ...port, _names: [port.name], _also: [], _pair: [] }; return true; }
      // An AES socket carries two channels: both sides of one source share
      // its name; two sources are named together (not a split)
      if (where.pair) {
        const base = (n) => n.replace(/ [LR]$/, '');
        const same = had.src && port.src ? had.src.kind === port.src.kind && had.src.n === port.src.n : !had.src && !port.src && base(had.name) === base(port.name);
        if (same) { had.name = base(had.name); if (had.src) delete had.src.side; }
        else {
          if (!had._names.includes(port.name)) { had._names.push(port.name); had.name = had._names.join(' / ').slice(0, 40); }
          if (port.src) had._pair.push(`${port.src.kind === 'ch' ? 'Ch' : 'Aux'} ${port.src.n} (${port.name})`);
        }
        return false;
      }
      if (!had._names.includes(port.name)) { had._names.push(port.name); had.name = had._names.join(' / ').slice(0, 40); }
      if (port.src) had._also.push(`${port.src.kind === 'ch' ? 'Ch' : 'Aux'} ${port.src.n} (${port.name})`);
      return false;
    };
    for (const c of session.inputs) {
      if (!c.socket) continue;
      const sides = c.stereo ? [['L', 0], ['R', 1]] : [[null, 0]];
      for (const [side, plus] of sides) {
        const idx = c.socket.idx + plus;
        // A stereo channel already called "… L" doesn't become "… L L"
        const name = (side ? `${c.name.replace(/\s+L$/i, '')} ${side}` : c.name).slice(0, 40);
        const id = portOf(c.socket.gid);
        if (!fromRack(session, c.socket.gid, idx) || choices[id] === 'playback') {
          if (!play.has(id)) play.set(id, []);
          play.get(id).push({ idx, name, src: { kind: 'ch', n: c.n, ...(side ? { side } : {}) } });
          continue;
        }
        const where = place.get(`in:${c.socket.gid}:${idx}`);
        if (!where) { if (portOf(c.socket.gid)) left.push(`${name} (${sockName(c.socket.gid, idx)})`); continue; }
        const phantom = !!(session.sockets.get(`${c.socket.gid}:${idx}`) || {}).phantom;
        if (put(where, { name, src: { kind: 'ch', n: c.n, ...(side ? { side } : {}) }, ...(phantom ? { phantom: true } : {}) })) { inputs++; if (phantom) withPhantom++; }
      }
    }
    // Playback: a box for each port, a socket for each channel in use, in
    // channel order, its note saying which channel it is ("On the console
    // as Dante 35.")
    const playback = [];
    for (const port of PORTS.filter((p) => play.has(p.id))) {
      const items = play.get(port.id).sort((a, b) => a.idx - b.idx);
      const gid = IN[port.id];
      const channels = [...new Set(items.map((x) => x.idx))];
      playback.push({ id: port.id, name: port.play, what: choices[port.id] === 'playback' ? `everything on ${port.label}` : port.what, inputs: items.length });
      if (choices[`${port.id}Play`] === false || boxes.length >= 40) { others += items.length; continue; }
      const box = { id: `dg-play-${port.id}`, model: 'generic', name: port.play, location: '', ports: {}, generic: { inputs: Math.min(128, channels.length), outputs: 0 } };
      boxes.push(box);
      for (const x of items) {
        const n = channels.indexOf(x.idx);
        if (n >= 128) { others++; continue; }
        if (put({ box, key: `in.${n + 1}` }, { name: x.name, src: x.src, note: `On the console as ${sockName(gid, x.idx)}.` })) inputs++;
      }
    }
    // A mix's number in JPMixer: the console's own when it lists one by that name, else its place in the session
    const mixNumber = (name, index) => {
      const same = (mixes || []).filter((m) => tidy(m.name).toLowerCase() === name.toLowerCase());
      return same.length === 1 ? same[0].number : index;
    };
    const stereoNames = new Set(session.outputs.filter((o) => o.kind === 'bus').map((o) => o.name.replace(/ R$/, '')));
    for (const o of session.outputs) {
      const where = place.get(`out:${o.socket.gid}:${o.socket.idx}`);
      let port;
      if (o.kind === 'aux') port = { name: stereoNames.has(o.name) ? `${o.name} L` : o.name, src: { kind: 'mix', n: mixNumber(o.name, o.index), ...(stereoNames.has(o.name) ? { side: 'L' } : {}) } };
      else if (o.kind === 'bus') {
        const base = o.name.replace(/ R$/, '');
        const aux = session.auxes.indexOf(base);
        port = aux >= 0 ? { name: o.name, src: { kind: 'mix', n: mixNumber(base, aux + 1), side: 'R' } } : { name: o.name };
      } else if (o.kind === 'ch') port = { name: `${o.name} direct`, src: { kind: 'ch', n: o.index } };
      else port = { name: (o.kind === 'group' && stereoNames.has(o.name) ? `${o.name} L` : o.name) };
      port.name = port.name.slice(0, 40);
      if (!where) { if (portOf(o.socket.gid)) left.push(`${port.name} (${sockName(o.socket.gid, o.socket.idx)} out)`); continue; }
      if (put(where, port)) outputs++;
    }
    for (const box of boxes) for (const p of Object.values(box.ports)) {
      if (p._also.length) p.note = [p.note, `Also patched to ${p._also.join(', ')}.`].filter(Boolean).join(' ').slice(0, 120);
      // An AES pair with two channels: the socket is patched to the first, the other is noted
      if (p._pair.length) p.note = [p.note, `Also on this pair: ${p._pair.join(', ')}.`].filter(Boolean).join(' ').slice(0, 120);
      delete p._names; delete p._also; delete p._pair;
    }
    return { boxes, inputs, outputs, others, left, devices: boxes.length, ports: found, playback, phantom: withPhantom };
  }

  // The rack models a port can have: ones whose sockets are fixed (not card slots)
  const rackModels = (L) => L.BOXES.filter((m) => !m.slots && (m.family === 'digico' || m.id === 'generic'));
  // The consoles a session's own I/O can be drawn as, and which one the
  // session is from: its header names it ("Q2" on a Quantum 225; the others
  // are what DiGiCo's other consoles are expected to write, unconfirmed)
  const consoleModels = (L) => L.BOXES.filter((m) => m.family === 'digico-console');
  const CONSOLE_CODES = [[/^Q2/i, 'digico-q225'], [/^Q3|338/i, 'digico-q338'], [/^Q5/i, 'digico-q5'], [/^Q7/i, 'digico-q7'], [/^Q8|852/i, 'digico-q852'],
    [/^SD12/i, 'digico-sd12'], [/^SD11/i, 'digico-sd11'], [/^SD10/i, 'digico-sd10'], [/^SD9/i, 'digico-sd9'], [/^SD7/i, 'digico-q7'], [/^SD5/i, 'digico-sd5'],
    [/^S21/i, 'digico-s21'], [/^S31/i, 'digico-s31']];
  const consoleFor = (code) => (CONSOLE_CODES.find(([re]) => re.test(String(code || '').trim())) || [])[1] || '';
  window.PatchDiGiCo = { read, build, ports, PORTS, rackModels, consoleModels, consoleFor };
})();
