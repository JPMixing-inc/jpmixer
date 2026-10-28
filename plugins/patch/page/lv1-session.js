'use strict';

// The patch in an LV1 session file (read with sqlite.js): one stage box per
// SoundGrid I/O device, each socket named for what it's patched to. Worked
// out from LV1 17.6 sessions (2026-10-26):
//   device       every device; gender 0 = an I/O box (others: computers, servers)
//   device_name  each device's name, by MAC address
//   routes       every connection. A device's routes use its slot,
//                io_bank × 8 + assign. Cluster types: 10 = I/O inputs,
//                11 = I/O outputs, 0 = input channels, 8 = talkback,
//                2 = aux buses, 25 = monitor mixes, 3 main, 5 mono,
//                6 matrix, 7 cue. An input channel's section 0 is its
//                input A (1 is B, virtual soundcheck). Status 0 or 4 is a
//                route in use; 1 is one that isn't (LV1's live
//                ExternalService_IOConnections.csv agreed exactly).
//   object + snapshot_chainer (snapshot -1, the current state): names
//   snapshot_iom + iom_chunks (snapshot -1): each slot's preamp settings as
//                text; its line_in_phantom_map is each input's 48V (0/1)
//   PatchLV1.read(db) → { boxes, inputs, outputs, devices, phantom }
(() => {
  const IO_IN = 10, IO_OUT = 11, INPUT = 0, AUX = 2, TALKBACK = 8, MON = 25;
  const KIND_NAME = { 0: 'Ch', 1: 'Group', 2: 'Aux', 3: 'Main', 4: 'Centre', 5: 'Mono', 6: 'Matrix', 7: 'Cue', 8: 'Talkback', 12: 'DCA', 25: 'Mon' };
  // Each model's channels in LV1's order → the drawing's sockets (boxes.js).
  // From LV1's own channel names (Analog_Mic/Line_n, Analog_Line_n,
  // Analog_Phones_nL/R, Digital_AES_n).
  const LAYOUTS = {
    'IONIC 16': {
      model: 'waves-ionic-16',
      in: (i) => (i < 16 ? `in.${i + 1}` : i < 18 ? 'aesin.1' : null),
      out: (i) => (i < 12 ? `out.${i + 1}` : i < 14 ? 'hp.1' : i < 16 ? 'hp.2' : i < 18 ? 'aesout.1' : null),
    },
    // The LV1 Classic console's own I/O: Analog_Mic/Line 1-16 and the AES in;
    // Analog_Line 1-12, Analog_Phones_1L/R, then the two AES outs
    'Classic': {
      model: 'waves-lv1-classic',
      in: (i) => (i < 16 ? `in.${i + 1}` : i < 18 ? 'aesin.1' : null),
      out: (i) => (i < 12 ? `out.${i + 1}` : i < 14 ? 'hp.1' : i < 16 ? 'aesout.1' : i < 18 ? 'aesout.2' : null),
    },
    'IONIC 24': {
      model: 'waves-ionic-24',
      in: (i) => (i < 24 ? `in.${i + 1}` : i < 26 ? 'aesin.1' : null),
      out: (i) => (i < 18 ? `out.${i + 1}` : i < 20 ? 'hp.1' : i < 22 ? 'hp.2' : i < 24 ? 'aesout.1' : i < 26 ? 'aesout.2' : null),
    },
  };
  const inUse = (r) => r.status === 0 || r.status === 4;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isInteger(v) ? v : 0));

  function read(db) {
    const tables = new Set(db.tables());
    for (const t of ['device', 'device_name', 'routes']) if (!tables.has(t)) throw new Error('This file has no LV1 patch in it. Is it an LV1 session (.emo)?');

    // Names of channels, mixes and the rest, as the session has them now
    const names = new Map(); // "kind:index" -> name
    if (tables.has('object') && tables.has('snapshot_chainer')) {
      const objects = new Map(db.rows('object').map((o) => [o.id, o]));
      for (const sc of db.rows('snapshot_chainer')) {
        if (sc.snapshot_id !== -1 || !sc.name) continue;
        const o = objects.get(sc.chainer_id);
        if (o) names.set(`${o.obj_type}:${o.obj_index}`, String(sc.name).trim());
      }
    }
    const nameOf = (kind, index) => names.get(`${kind}:${index}`) || `${KIND_NAME[kind] || 'Track'} ${index + 1}`;
    // JPMixer's aux N on LV1 is LV1's Nth mix: the aux buses, then the monitor mixes
    const auxBuses = tables.has('object') ? db.rows('object').filter((o) => o.obj_type === AUX).length : 0;
    const sourceFor = (kind, index) => (kind === INPUT ? { kind: 'ch', n: index + 1 }
      : kind === AUX ? { kind: 'mix', n: index + 1 }
      : kind === MON ? { kind: 'mix', n: auxBuses + index + 1 } : null);

    // One box per I/O device, whether or not anything is patched to it
    const macNames = new Map(db.rows('device_name').map((d) => [d.mac, d.name]));
    const boxes = new Map(); // slot -> { box, layout }
    const devices = db.rows('device').filter((d) => d.device_gender === 0 && Number.isInteger(d.mac) && Number.isInteger(d.assign) && d.assign >= 0);
    devices.sort((a, b) => (a.io_bank * 8 + a.assign) - (b.io_bank * 8 + b.assign));
    for (const d of devices) {
      const layout = LAYOUTS[String(d.description || '').trim()];
      const name = String(macNames.get(d.mac) || d.description || 'Stage box').slice(0, 40);
      const box = { id: `lv1-${d.mac.toString(16).padStart(12, '0')}`, model: layout ? layout.model : 'generic', name, location: '', ports: {} };
      // No drawing (a MADI interface, a SoundGrid server): a network device its size
      if (!layout) { box.model = 'network'; box.options = /madi|mg[bo]\b/i.test(`${d.description} ${name}`) ? { kind: 'madi' } : { kind: 'soundgrid' }; box.generic = { inputs: clamp(d.in_channel_count, 0, 128), outputs: clamp(d.out_channel_count, 0, 128) }; }
      boxes.set(d.io_bank * 8 + d.assign, { box, layout, device: d });
    }
    // 48V on each box's inputs: slot -> set of input indices
    const phantom = new Map();
    if (tables.has('snapshot_iom') && tables.has('iom_chunks')) {
      const chunks = new Map(db.rows('iom_chunks').map((c) => [c.id, c.iom_chunk]));
      for (const r of db.rows('snapshot_iom')) {
        const text = r.snapshot_id === -1 && chunks.get(r.iom_chunk_id);
        if (typeof text !== 'string') continue;
        const on = new Set();
        let inMap = false;
        for (const line of text.split(/\r?\n/)) {
          if (/^\s{0,2}\S/.test(line)) { inMap = /^\s*line_in_phantom_map:\s*$/.test(line); continue; }
          const m = inMap && line.match(/^\s+(\d+):\s*1\s*$/);
          if (m) on.add(Number(m[1]));
        }
        phantom.set(r.io_bank * 8 + r.io_slot, on);
      }
    }
    const socket = (b, dir, i) => {
      if (b.layout) return b.layout[dir](i);
      const count = dir === 'in' ? b.box.generic.inputs : b.box.generic.outputs;
      return i >= 0 && i < count ? `${dir}.${i + 1}` : null;
    };

    // A stereo source fills two sockets (or both sides of one AES or
    // headphone socket): its sides get L and R where they're apart
    const routes = db.rows('routes').filter(inUse);
    const sides = new Map(); // "dir:kind:index" -> set of sides used
    const noteSide = (key, side) => { if (!sides.has(key)) sides.set(key, new Set()); sides.get(key).add(side); };
    const ins = routes.filter((r) => r.src_cluster_type === IO_IN && (r.dst_cluster_type === INPUT || r.dst_cluster_type === TALKBACK) && r.dst_section_index <= 0);
    const outs = routes.filter((r) => r.dst_cluster_type === IO_OUT && r.src_cluster_type !== IO_IN);
    for (const r of ins) noteSide(`in:${r.dst_cluster_type}:${r.dst_cluster_type_index}`, r.dst_channel_index);
    for (const r of outs) noteSide(`out:${r.src_cluster_type}:${r.src_cluster_type_index}`, r.src_channel_index);

    let inputs = 0, outputs = 0, withPhantom = 0;
    const put = (b, key, kind, index, side, dir) => {
      const base = nameOf(kind, index);
      const stereo = (sides.get(`${dir}:${kind}:${index}`) || new Set()).size > 1;
      const name = stereo ? `${base} ${side ? 'R' : 'L'}` : base;
      const src = sourceFor(kind, index);
      if (src && stereo) src.side = side ? 'R' : 'L';
      const had = b.box.ports[key];
      if (had) {
        // A pair socket (AES, headphones): both sides of the same source share it
        if (had._source === `${kind}:${index}`) { had.name = base.slice(0, 40); if (had.src) delete had.src.side; return; }
        // Two sources on one pair socket (AES in L to one channel, R to
        // another): it isn't a split. Named together; patched to the first,
        // the other noted
        if (/^(aes|hp)/.test(key)) {
          if (!had._names.includes(name)) { had._names.push(name); had.name = had._names.join(' / ').slice(0, 40); }
          if (src) had._pair.push(`${src.kind === 'ch' ? 'Ch' : 'Aux'} ${src.n} (${base.slice(0, 40)})`);
          return;
        }
        // One socket feeding more than one channel (a split): named once, the
        // rest in its note
        if (!had._names.includes(name)) { had._names.push(name); had.name = had._names.join(' / ').slice(0, 40); }
        if (src) had._also.push(`${src.kind === 'ch' ? 'Ch' : 'Aux'} ${src.n} (${base.slice(0, 40)})`);
        return;
      }
      b.box.ports[key] = { name: name.slice(0, 40), ...(src ? { src } : {}), _source: `${kind}:${index}`, _names: [name], _also: [], _pair: [] };
      if (dir === 'in') inputs++; else outputs++;
    };
    for (const r of ins) {
      const b = boxes.get(r.src_cluster_type_index);
      const key = b && socket(b, 'in', r.src_channel_index);
      if (!key) continue;
      put(b, key, r.dst_cluster_type, r.dst_cluster_type_index, r.dst_channel_index, 'in');
      if (/^in\.\d+$/.test(key) && (phantom.get(r.src_cluster_type_index) || new Set()).has(r.src_channel_index) && !b.box.ports[key].phantom) { b.box.ports[key].phantom = true; withPhantom++; }
    }
    for (const r of outs) {
      const b = boxes.get(r.dst_cluster_type_index);
      const key = b && socket(b, 'out', r.dst_channel_index);
      if (key) put(b, key, r.src_cluster_type, r.src_cluster_type_index, r.src_channel_index, 'out');
    }
    const list = [...boxes.values()].map(({ box }) => {
      for (const p of Object.values(box.ports)) {
        if (p._also.length) p.note = `Also patched to ${p._also.join(', ')}.`.slice(0, 120);
        if (p._pair.length) p.note = [p.note, `Also on this pair: ${p._pair.join(', ')}.`].filter(Boolean).join(' ').slice(0, 120);
        delete p._source; delete p._names; delete p._also; delete p._pair;
      }
      return box;
    });
    return { boxes: list, inputs, outputs, devices: list.length, phantom: withPhantom };
  }
  window.PatchLV1 = { read, LAYOUTS };
})();
