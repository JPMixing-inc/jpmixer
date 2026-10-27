'use strict';

// The stage boxes the Patch page draws, to scale, from the makers' photos
// and datasheets. Everything is in millimetres: a 19-inch rack is 482.6 mm
// wide and 44.45 mm per rack unit (U); floor and wall boxes are their
// approximate real size. Each box has the side or sides its sockets are on
// ("faces"), with every socket where it is on the real panel and the number
// printed beside it, plus the panel's other parts (power, network, displays,
// vents, handles) so it looks like the real thing. Logos are shown as plain
// names, not the makers' artwork.
//
// An AES/EBU socket carries a pair of channels, so it's one socket
// ("AES 1–2"). Socket keys (`group.n`) stay put when an option or another
// slot's card changes, so names and patches aren't lost.

(() => {
  const U = 44.45, RACK_W = 482.6, EAR = 15.88;
  const units = (n) => n * U;

  // ── Building blocks ──
  // A socket: kind 'in' | 'out'; connector 'xlr-f' | 'xlr-m' | 'combo' | 'trs' | 'phones' | 'pad'
  const sock = (key, kind, connector, x, y, size, printed, label, where, extra = {}) => ({ key, kind, connector, x, y, size, printed: String(printed), label, where, ...extra });
  // A grid of sockets, in rows (or columns with byColumn)
  function grid(o) {
    const out = [];
    for (let i = 0; i < o.count; i++) {
      const col = o.byColumn ? Math.floor(i / o.rows) : i % o.cols;
      const row = o.byColumn ? i % o.rows : Math.floor(i / o.cols);
      const n = (o.start || 1) + i;
      out.push(sock(`${o.group}.${(o.keyStart || 1) + i}`, o.kind, o.connector, o.x0 + col * o.dx, o.y0 + row * o.dy, o.size || 22,
        o.printed ? o.printed(n, i) : n, o.label ? o.label(n, i) : `${o.kind === 'in' ? 'Input' : 'Output'} ${n}`, o.where, o.extra || {}));
    }
    return out;
  }
  // Panel parts, drawn by app.js
  const T = (x, y, text, o = {}) => ({ type: 'text', x, y, text, ...o });
  const part = (type, x, y, o = {}) => ({ type, x, y, ...o });
  const rowLabel = (x1, x2, y, text) => [{ type: 'line', x1, x2, y }, T((x1 + x2) / 2, y + 3.4, text, { size: 2.6, anchor: 'middle', fill: '#aeb2b9', bg: true })];

  // ── 8-channel cards for the SD racks ──
  const CARDS = {
    mic: { kind: 'in', label: 'Mic/line input card', short: 'SD ADC I/P' },
    'aes-in': { kind: 'in', label: 'AES/EBU input card (4 pairs)', short: 'SD AES I/P', pairs: true },
    'other-in': { kind: 'in', label: 'Other input card (ADAT, Dante, AES-42…)', short: 'DIGITAL I/P', digital: true },
    line: { kind: 'out', label: 'Analogue output card', short: 'SD DAC O/P' },
    'aes-out': { kind: 'out', label: 'AES/EBU output card (4 pairs)', short: 'SD AES O/P', pairs: true },
    'other-out': { kind: 'out', label: 'Other output card (ADAT, Dante…)', short: 'DIGITAL O/P', digital: true },
  };
  const IN_CARDS = ['mic', 'aes-in', 'other-in'];
  const OUT_CARDS = ['line', 'aes-out', 'other-out'];
  const ANY_CARDS = [...IN_CARDS, ...OUT_CARDS];

  // The sockets of one card, along a line from (x, y) every `step` mm (vertical or not)
  function card(slot, cardId, x, y, step, vertical, size, first) {
    const c = CARDS[cardId];
    const group = `s${slot}`;
    const at = (i) => (vertical ? { x, y: y + i * step } : { x: x + i * step, y });
    if (c.pairs) {
      return [0, 1, 2, 3].map((k) => {
        const p = at(k * 2 + 0.5);
        return sock(`${group}.${k + 1}`, c.kind, c.kind === 'in' ? 'xlr-f' : 'xlr-m', p.x, p.y, size, `${k * 2 + 1}-${k * 2 + 2}`, `AES ${c.kind === 'in' ? 'in' : 'out'} ${first + k * 2}-${first + k * 2 + 1}`, `Slot ${slot}: ${c.label}`, { pair: true });
      });
    }
    return Array.from({ length: 8 }, (_, i) => {
      const p = at(i);
      return sock(`${group}.${i + 1}`, c.kind, c.digital ? 'pad' : c.kind === 'in' ? 'xlr-f' : 'xlr-m', p.x, p.y, size, i + 1, `${c.kind === 'in' ? 'Input' : 'Output'} ${first + i}`, `Slot ${slot}: ${c.label}`);
    });
  }
  // Which card each slot holds, and the rack channel each card starts at
  // (inputs and outputs are counted along the slots, 8 per card)
  function slotCards(model, box) {
    const next = { in: 1, out: 1 };
    return model.slots.map((allowed, i) => {
      const slot = i + 1;
      const id = box.cards && Object.hasOwn(box.cards, slot) ? box.cards[slot] : (model.defaultCards || {})[slot] || '';
      const cardId = allowed.includes(id) ? id : '';
      const first = cardId ? next[CARDS[cardId].kind] : 0;
      if (cardId) next[CARDS[cardId].kind] += 8;
      return { slot, cardId, first };
    });
  }

  // ── The boxes ──
  const BOXES = [];
  const add = (b) => BOXES.push(b);

  // DiGiCo D-Rack: floor or 7U rack box. Top: 32 mic/line in, 4 rows of 8,
  // with carry handles. Below: line out 1-8, and the output card (8 more line
  // outs, or AES out 1-4).
  add({
    id: 'digico-d-rack', family: 'digico', maker: 'DiGiCo', name: 'D-Rack',
    about: '32 mic/line inputs and 8 line outputs, plus an optional output card (8 line outputs, or 4 AES pairs). Cat5e or MADI.',
    options: [{ key: 'exp', label: 'Output card', choices: [{ value: '', label: 'None' }, { value: 'line', label: '8 line outputs (9–16)' }, { value: 'aes', label: '4 AES/EBU outputs (pairs 1–8)' }] }],
    build(box) {
      const exp = (box.options || {}).exp || '';
      const H = units(7);
      const parts = [
        T(48, 26, 'DiGiCo', { size: 13, weight: 800 }), T(434, 25, 'D-Rack', { size: 8, weight: 700, anchor: 'end', italic: true }),
        part('handle', 38, 44, { h: 150 }), part('handle', 444, 44, { h: 150 }),
        part('panelline', 0, 208),
        ...[0, 1, 2, 3].flatMap((r) => rowLabel(80, 404, 74 + r * 40, `MIC LINE IN ${r * 8 + 1}-${r * 8 + 8}`)),
        ...rowLabel(80, 404, 249, 'LINE OUT 1-8'),
        part('led', 44, 262, { color: '#3ddc84', label: 'LINK OK' }), part('led', 44, 272, { color: '#3ddc84', label: 'PSU 1' }), part('led', 44, 282, { color: '#3a3d43', label: 'PSU 2' }),
        part('plate', 80, 264, { w: 326, h: 40 }),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 32, cols: 8, x0: 96, dx: 41.6, y0: 58, dy: 40, size: 22, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 96, dx: 41.6, y0: 233, dy: 0, size: 22, where: 'Line outputs' }),
      ];
      if (exp === 'line') { sockets.push(...grid({ group: 'exp', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 96, dx: 41.6, y0: 282, dy: 0, size: 20, start: 9, where: 'Output card: line out 9-16' })); parts.push(T(243, 302, 'LINE OUT 9-16', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' })); }
      if (exp === 'aes') { sockets.push(...grid({ group: 'exp', kind: 'out', connector: 'xlr-m', count: 4, cols: 4, x0: 118, dx: 83, y0: 282, dy: 0, size: 20, printed: (n) => n, label: (n) => `AES out ${n} (ch ${n * 2 - 1}-${n * 2})`, where: 'Output card: AES out 1-4', extra: { pair: true } })); parts.push(T(243, 302, 'AES OUT 1-4', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' })); }
      if (!exp) parts.push(T(243, 287, 'Output card slot (empty)', { size: 3, anchor: 'middle', fill: '#6d7179' }));
      return { faces: [{ id: 'front', label: 'Front', rack: 7, w: RACK_W, h: H, parts, sockets }] };
    },
  });

  // DiGiCo D2-Rack (9U): everything is on the back. Left: display, MADI,
  // USB, power. Then 6 columns of 8 inputs (1-48, or 24 mic + 24 AES), 2
  // columns of 8 line outputs, and 2 output expansion slots.
  add({
    id: 'digico-d2-rack', family: 'digico', maker: 'DiGiCo', name: 'D2-Rack',
    about: '48 mic inputs (or 24 mic and 24 AES/EBU), 16 line outputs, and two output slots for 16 more. On the back of a 9U rack.',
    options: [
      { key: 'inputs', label: 'Inputs', choices: [{ value: '', label: '48 mic inputs' }, { value: 'aes', label: '24 mic and 24 AES/EBU inputs' }] },
      { key: 'exp1', label: 'Output slot 1', choices: [{ value: '', label: 'Empty' }, { value: 'line', label: '8 line outputs (17–24)' }, { value: 'aes', label: '4 AES/EBU outputs' }] },
      { key: 'exp2', label: 'Output slot 2', choices: [{ value: '', label: 'Empty' }, { value: 'line', label: '8 line outputs (25–32)' }, { value: 'aes', label: '4 AES/EBU outputs' }] },
    ],
    build(box) {
      const o = box.options || {};
      const H = units(9);
      const cols = [146, 181, 216, 251, 286, 321], rowY = (r) => 56 + r * 40;
      const parts = [
        T(28, 22, 'DiGiCo', { size: 7, weight: 800 }), T(28, 31, 'D2-Rack', { size: 6.5, weight: 800 }),
        part('display', 30, 42, { w: 30, h: 14 }), part('button', 66, 45), part('button', 74, 45), part('button', 66, 54), part('button', 74, 54),
        T(52, 64, 'SYSTEM SETTINGS', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }),
        part('bnc', 40, 92, { label: 'IN' }), part('bnc', 60, 92, { label: 'OUT' }), T(50, 106, 'MADI MAIN', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
        part('bnc', 40, 132, { label: 'IN' }), part('bnc', 60, 132, { label: 'OUT' }), T(50, 146, 'MADI AUX', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
        part('usb', 36, 168), part('sticker', 26, 216, { w: 60, h: 10 }),
        part('iec', 36, 330, { label: 'PSU 1' }), part('iec', 80, 330, { label: 'PSU 2' }),
        part('vent', 120, 6, { w: 340, h: 10 }), part('vent', 120, 386, { w: 340, h: 8 }),
        ...rowLabel(132, 232, 374, 'MIC/LINE 1-24'), ...rowLabel(238, 336, 374, o.inputs === 'aes' ? 'AES IN 25-48' : 'IP 25-48'), ...rowLabel(342, 398, 374, 'LINE OUT 1-16'),
        T(290, 384, 'DO NOT RESTRICT AIRFLOW', { size: 2.4, anchor: 'middle', fill: '#8e939c' }),
      ];
      const sockets = [];
      // Inputs 1-24 (or 1-48): numbered down each column
      const micCount = o.inputs === 'aes' ? 24 : 48;
      for (let i = 0; i < micCount; i++) sockets.push(sock(`in.${i + 1}`, 'in', 'xlr-f', cols[Math.floor(i / 8)], rowY(i % 8), 22, i + 1, `Input ${i + 1}`, i < 24 ? 'Mic/line inputs 1-24' : 'Inputs 25-48'));
      if (o.inputs === 'aes') {
        for (let k = 0; k < 12; k++) {
          const c = 3 + Math.floor(k / 4), r = (k % 4) * 2;
          const a = 25 + k * 2;
          sockets.push(sock(`aesin.${k + 1}`, 'in', 'xlr-f', cols[c], rowY(r) + 20, 22, `${a}-${a + 1}`, `AES in ${a}-${a + 1}`, 'AES/EBU inputs 25-48', { pair: true }));
          parts.push(part('frame', cols[c] - 15, rowY(r) - 16, { w: 30, h: 72 }));
        }
      }
      for (let i = 0; i < 16; i++) sockets.push(sock(`out.${i + 1}`, 'out', 'xlr-m', [356, 388][Math.floor(i / 8)], rowY(i % 8), 22, i + 1, `Output ${i + 1}`, 'Line outputs 1-16'));
      // The two expansion slots, upright at the right
      [['exp1', 420, 17], ['exp2', 447, 25]].forEach(([key, x, first]) => {
        parts.push(part('plate', x - 12, 44, { w: 24, h: 330, slot: true }));
        if (o[key] === 'line') for (let i = 0; i < 8; i++) sockets.push(sock(`${key}.${i + 1}`, 'out', 'xlr-m', x, rowY(i), 19, first + i, `Output ${first + i}`, `${key === 'exp1' ? 'Output slot 1' : 'Output slot 2'}: line outputs`));
        if (o[key] === 'aes') for (let k = 0; k < 4; k++) sockets.push(sock(`${key}.${k + 1}`, 'out', 'xlr-m', x, rowY(k * 2) + 20, 19, `${k * 2 + 1}-${k * 2 + 2}`, `${key === 'exp1' ? 'Slot 1' : 'Slot 2'} AES out ${k * 2 + 1}-${k * 2 + 2}`, `${key === 'exp1' ? 'Output slot 1' : 'Output slot 2'}: AES outputs`, { pair: true }));
      });
      return { faces: [{ id: 'back', label: 'Back', rack: 9, w: RACK_W, h: H, parts, sockets }] };
    },
  });

  // DiGiCo DQ-Rack (Dante) and MQ-Rack (MADI), 6U: everything on the back.
  // A top band (system settings, network, two power inlets), then 4 rows of
  // 12 mic inputs and 6 outputs; each row's last output can be an AES pair.
  for (const [id, name, net] of [['digico-dq-rack', 'DQ-Rack', 'dante'], ['digico-mq-rack', 'MQ-Rack', 'madi']]) {
    add({
      id, family: 'digico', maker: 'DiGiCo', name,
      about: `48 mic inputs and 24 line outputs; the last output of each row can be an AES pair. ${net === 'dante' ? 'Dante' : 'MADI'}, on the back of a 6U rack.`,
      options: [{ key: 'outs', label: 'Outputs 6, 12, 18 and 24', choices: [{ value: '', label: 'Line outputs' }, { value: 'aes', label: 'AES/EBU pairs 1–8' }] }],
      build(box) {
        const aes = (box.options || {}).outs === 'aes';
        const H = units(6);
        const rowY = (r) => 112 + r * 39;
        const parts = [
          part('box', 26, 14, { w: 112, h: 66 }), T(82, 22, 'SYSTEM SETTINGS', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
          part('display', 66, 40, { w: 26, h: 18, color: '#0d0e10', text: true }), part('button', 102, 34), part('button', 112, 34), part('button', 112, 50), part('button', 112, 62), part('usb', 48, 52),
          part('box', 170, 14, { w: 130, h: 66 }),
          ...(net === 'dante'
            ? [part('ethercon', 212, 46, { label: 'Primary' }), part('ethercon', 256, 46, { label: 'Secondary' }), T(235, 74, 'Dante', { size: 4, anchor: 'middle', italic: true, weight: 700 })]
            : [part('bnc', 192, 46, { label: 'IN' }), part('bnc', 212, 46, { label: 'OUT' }), part('bnc', 254, 46, { label: 'IN' }), part('bnc', 274, 46, { label: 'OUT' }), T(202, 30, 'MADI MAIN', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }), T(264, 30, 'MADI AUX', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }), T(235, 70, '1-28  ◂ 96kHz ▸  29-56', { size: 2.4, anchor: 'middle', fill: '#8e939c' })]),
          part('sticker', 318, 14, { w: 140, h: 12 }), part('iec', 340, 52, { label: 'PSU A' }), part('switch', 362, 52), part('iec', 404, 52, { label: 'PSU B' }), part('switch', 426, 52),
          part('vent', 26, 88, { w: 432, h: 6 }),
          ...[0, 1, 2, 3].flatMap((r) => [...rowLabel(24, 266, rowY(r) + 16, 'MIC'), ...rowLabel(278, 408, rowY(r) + 16, 'OUTPUT')]),
          T(452, 258, `DiGiCo ${name.toUpperCase()}`, { size: 6, weight: 800, anchor: 'end' }),
        ];
        const sockets = [];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 12; c++) { const n = r * 12 + c + 1; sockets.push(sock(`in.${n}`, 'in', 'xlr-f', 35 + c * 21.2, rowY(r), 19.5, n, `Input ${n}`, 'Mic inputs')); }
          for (let c = 0; c < 6; c++) {
            const n = r * 6 + c + 1;
            if (c === 5) parts.push(part('frame', 413, rowY(r) - 15, { w: 30, h: 37 }), T(428, rowY(r) + 19, aes ? `AES ${r * 2 + 1}-${r * 2 + 2}` : 'AES', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }));
            if (c === 5 && aes) sockets.push(sock(`aesout.${r + 1}`, 'out', 'xlr-m', 428, rowY(r), 21, `${r * 2 + 1}-${r * 2 + 2}`, `AES out ${r * 2 + 1}-${r * 2 + 2}`, 'AES/EBU outputs', { pair: true }));
            else sockets.push(sock(`out.${n}`, 'out', 'xlr-m', c === 5 ? 428 : 290 + c * 25, rowY(r), 21, n, `Output ${n}`, 'Line outputs'));
          }
        }
        return { faces: [{ id: 'back', label: 'Back', rack: 6, w: RACK_W, h: H, parts, sockets }] };
      },
    });
  }

  // DiGiCo SD-Rack (10U): on the back, two power supplies with the MADI POD
  // between them, then 14 upright card slots (7 input, 7 output).
  add({
    id: 'digico-sd-rack', family: 'digico', maker: 'DiGiCo', name: 'SD-Rack',
    about: '14 card slots on the back: 7 for input cards and 7 for output cards, 8 channels each (up to 56 in and 56 out). 10U.',
    slots: [...Array(7).fill(IN_CARDS), ...Array(7).fill(OUT_CARDS)], defaultCards: { 1: 'mic', 2: 'mic', 3: 'mic', 4: 'mic', 8: 'line', 9: 'line' },
    build(box) {
      const H = units(10);
      const parts = [];
      for (const [x, label] of [[22, 'SD-Rack PSU'], [330, 'SD-Rack PSU']]) parts.push(part('box', x, 10, { w: 130, h: 150 }), part('grille', x + 8, 20, { w: 64, h: 96 }), part('iec', x + 100, 70), part('switch', x + 100, 40), T(x + 65, 148, label, { size: 6, weight: 800, anchor: 'middle' }));
      parts.push(part('box', 158, 10, { w: 166, h: 150 }), part('display', 170, 28, { w: 32, h: 20 }), part('button', 210, 30), part('button', 220, 30), part('button', 210, 42), part('button', 220, 42),
        part('optocon', 258, 38, { label: 'A' }), part('optocon', 296, 38, { label: 'B' }),
        part('bnc', 182, 96), part('bnc', 200, 96), part('bnc', 222, 96), part('bnc', 240, 96), part('bnc', 262, 96), part('bnc', 280, 96), part('bnc', 300, 96), part('usb', 300, 72),
        T(241, 148, 'SD-Rack Madi POD', { size: 6, weight: 800, anchor: 'middle' }));
      const sockets = [];
      const w = (RACK_W - 2 * EAR - 6) / 14;
      for (const { slot, cardId, first } of slotCards(this, box)) {
        const cx = EAR + 3 + w * (slot - 0.5);
        parts.push(part('plate', cx - w / 2 + 0.6, 168, { w: w - 1.2, h: 268, slot: true, label: cardId ? CARDS[cardId].short : '', number: slot }));
        if (cardId) sockets.push(...card(slot, cardId, cx, 214, 27.5, true, 20.5, first));
      }
      return { faces: [{ id: 'back', label: 'Back', rack: 10, w: RACK_W, h: H, parts, sockets }] };
    },
  });

  // DiGiCo SD-MiNi (4U) and SD-Nano (2U): the cards are on the front, each a
  // row of 8, slot 1 at the bottom; the MADI or optical POD on the left.
  add({
    id: 'digico-sd-mini-rack', family: 'digico', maker: 'DiGiCo', name: 'SD-MiNi Rack',
    about: '4 card slots on the front, 8 channels each, for any mix of input and output cards (up to 32). 4U.',
    slots: Array(4).fill(ANY_CARDS), defaultCards: { 1: 'mic', 2: 'mic', 3: 'mic', 4: 'line' },
    build(box) {
      const H = units(4);
      const parts = [
        part('box', 22, 14, { w: 128, h: 152 }),
        part('optocon', 46, 50, { label: 'B' }), part('optocon', 46, 104, { label: 'A' }), T(46, 140, 'OPTOCORE', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
        part('bnc', 92, 30), part('bnc', 112, 30), part('bnc', 92, 62), part('bnc', 112, 62), part('bnc', 92, 94), part('bnc', 112, 94), part('bnc', 92, 126), part('bnc', 112, 126),
        part('usb', 134, 40), part('display', 76, 140, { w: 18, h: 14 }), part('button', 100, 142), part('button', 108, 142), part('button', 100, 152), part('button', 108, 152),
        T(136, 160, 'SD-Rack Madi POD', { size: 3.4, weight: 800, anchor: 'end' }),
        T(458, 16, 'SD-MINI Rack', { size: 7, weight: 800, anchor: 'end' }), part('vent', 160, 22, { w: 296, h: 14 }),
        part('led', 432, 170, { color: '#ff4b4b', label: 'PSU 1' }), part('led', 446, 170, { color: '#ff4b4b', label: 'PSU 2' }),
      ];
      const sockets = [];
      for (const { slot, cardId, first } of slotCards(this, box)) {
        const y = 150 - (slot - 1) * 28.5;
        parts.push(part('plate', 158, y - 13.5, { w: 304, h: 27, label: cardId ? CARDS[cardId].short : '', number: slot, horizontal: true }));
        if (cardId) sockets.push(...card(slot, cardId, 200, y, 32.6, false, 20, first));
      }
      return { faces: [{ id: 'front', label: 'Front', rack: 4, w: RACK_W, h: H, parts, sockets }] };
    },
  });
  add({
    id: 'digico-sd-nano-rack', family: 'digico', maker: 'DiGiCo', name: 'SD-Nano Rack',
    about: '2 card slots on the front, 8 channels each, for input or output cards (up to 16). Optical connection. 2U.',
    slots: Array(2).fill(ANY_CARDS), defaultCards: { 1: 'mic', 2: 'line' },
    build(box) {
      const H = units(2);
      const parts = [
        part('optocon', 38, 34, { label: 'A' }), part('display', 60, 30, { w: 18, h: 13 }), part('button', 86, 28), part('button', 94, 28), part('button', 86, 40),
        part('optocon', 116, 28, { label: 'B' }), part('bnc', 138, 52, { label: 'OUT' }), part('bnc', 138, 72, { label: 'IN' }), part('usb', 116, 62),
        T(70, 60, 'OpTiC', { size: 4.4, weight: 800, anchor: 'middle' }), T(70, 66, 'OPTOCORE', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }), part('sticker', 50, 74, { w: 36, h: 7 }),
        T(458, 12, 'DiGiCo SD-NANO Rack', { size: 6.4, weight: 800, anchor: 'end' }),
        part('led', 436, 84, { color: '#ff4b4b', label: 'PSU 1' }), part('led', 448, 84, { color: '#ff4b4b', label: 'PSU 2' }),
      ];
      const sockets = [];
      for (const { slot, cardId, first } of slotCards(this, box)) {
        const y = 64 - (slot - 1) * 31;
        parts.push(part('plate', 152, y - 14, { w: 310, h: 28, label: cardId ? CARDS[cardId].short : '', number: slot, horizontal: true }));
        if (cardId) sockets.push(...card(slot, cardId, 196, y, 33.4, false, 20, first));
      }
      return { faces: [{ id: 'front', label: 'Front', rack: 2, w: RACK_W, h: H, parts, sockets }] };
    },
  });

  // DiGiCo 4REA4 boxes. A168 STAGE: a floor box (approximate size), 16 in
  // and 8 out, corner bumpers and a handle. A164 WALL: an upright wall box,
  // 4 rows of 4 mic inputs and 1 output, with a name screen over each socket.
  for (const [id, name, dante] of [['digico-a168-stage', 'A168 STAGE', false], ['digico-a168d-stage', 'A168D STAGE', true]]) {
    add({
      id, family: 'digico', maker: 'DiGiCo', name: dante ? 'A168D STAGE (Dante)' : name,
      about: `16 inputs and 8 outputs, ${dante ? 'over Dante' : 'on the 4REA4’s A3232 network'}. A floor box; its size here is approximate.`,
      build() {
        const parts = [
          part('bumper', 0, 0), part('bumper', 404, 0, { flip: true }), part('bumper', 0, 180, { up: true }), part('bumper', 404, 180, { flip: true, up: true }),
          part('handle', 424, 58, { h: 96, side: true }),
          T(28, 32, 'DiGiCo', { size: 11, weight: 800 }),
          ...rowLabel(30, 240, 84, 'MIC LINE IN 1-8'), ...rowLabel(30, 240, 140, 'MIC LINE IN 9-16'), ...rowLabel(258, 362, 84, 'LINE OUT 1-4'), ...rowLabel(258, 362, 140, 'LINE OUT 5-8'),
          part('led', 100, 28, { color: '#3ddc84', label: 'Power' }), part('led', 124, 28, { color: '#3ddc84', label: 'Ready' }),
          T(392, 180, name, { size: 9, weight: 800, anchor: 'end' }),
        ];
        const sockets = [
          ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 16, cols: 8, x0: 42, dx: 27.2, y0: 66, dy: 56, size: 20, where: 'Mic/line inputs' }),
          ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 4, x0: 272, dx: 27.2, y0: 66, dy: 56, size: 20, where: 'Line outputs' }),
        ];
        return { faces: [{ id: 'front', label: 'Front', floor: true, w: 440, h: 210, parts, sockets, note: 'Size approximate' }] };
      },
    });
  }
  add({
    id: 'digico-a164-wall', family: 'digico', maker: 'DiGiCo', name: 'A164 WALL',
    about: '16 mic inputs and 4 outputs in a wall box, with a name screen over each socket. Its size here is approximate.',
    build() {
      const parts = [T(16, 18, 'DiGiCo', { size: 7, weight: 800 }), part('vent', 214, 18, { w: 26, h: 48, holes: true }), part('vent', 214, 236, { w: 26, h: 48, holes: true }), T(240, 296, 'A164 WALL', { size: 6, weight: 800, anchor: 'end' })];
      const sockets = [];
      for (let r = 0; r < 4; r++) {
        const y = 48 + r * 66;
        for (let c = 0; c < 4; c++) { const n = r * 4 + c + 1; sockets.push(sock(`in.${n}`, 'in', 'xlr-f', 36 + c * 38, y, 22, n, `Input ${n}`, 'Mic/line inputs', { screen: true })); }
        sockets.push(sock(`out.${r + 1}`, 'out', 'xlr-m', 196, y, 22, r + 1, `Output ${r + 1}`, 'Line outputs', { screen: true }));
        parts.push(...rowLabel(20, 170, y + 20, 'MIC/LINE IN'), ...rowLabel(180, 212, y + 20, 'LINE OUT'));
      }
      return { faces: [{ id: 'front', label: 'Front', wall: true, w: 250, h: 300, parts, sockets, note: 'Size approximate' }] };
    },
  });

  // Waves IONIC 16 (2U) and IONIC 24 (3U): combo inputs and outputs on the
  // front with two headphone outputs; more outputs, AES, the SoundGrid port
  // and power on the back.
  const ionicFront = (rows, outRows) => [
    part('handle', 8, 10, { h: units(rows === 2 ? 2 : 3) - 20, thin: true }), part('handle', RACK_W - 8, 10, { h: units(rows === 2 ? 2 : 3) - 20, thin: true }),
    T(150, rows === 2 ? 46 : 46, 'INPUT', { size: 4, anchor: 'middle', weight: 700, bg: true }), T(332, rows === 2 ? 46 : 46, 'OUTPUT', { size: 4, anchor: 'middle', weight: 700, bg: true }),
    part('chevrons', 40, rows === 2 ? 42.5 : 42.5, { w: 230 }), part('chevrons', 280, 42.5, { w: 110 }),
    ...(rows === 3 ? [part('chevrons', 40, 85, { w: 230 }), part('chevrons', 280, 85, { w: 110 })] : []),
    part('wavesmark', 402, 12), T(406, rows === 2 ? 48 : 50, `IONIC ${rows === 2 ? 16 : 24}`, { size: 5, weight: 800, anchor: 'middle', italic: true }),
    part('led', 438, 12, { color: '#2a2c30', label: 'Status' }), part('knob', 424, 28), part('knob', 424, rows === 2 ? 66 : 72),
    T(446, rows === 2 ? 48 : 52, '🎧', { size: 4, anchor: 'middle' }),
  ];
  add({
    id: 'waves-ionic-16', family: 'waves', maker: 'Waves', name: 'IONIC 16',
    about: '16 mic/line inputs and outputs 1–8 on the front with 2 headphone outputs; outputs 9–12, AES in and out and the SoundGrid port on the back. 2U.',
    build() {
      const front = {
        id: 'front', label: 'Front', rack: 2, w: RACK_W, h: units(2), parts: ionicFront(2),
        sockets: [
          ...grid({ group: 'in', kind: 'in', connector: 'combo', count: 16, cols: 8, x0: 47, dx: 30.2, y0: 22, dy: 41, size: 22, where: 'Mic/line inputs' }),
          ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 4, x0: 286, dx: 30.6, y0: 22, dy: 41, size: 22, where: 'Line outputs' }),
          sock('hp.1', 'out', 'phones', 446, 28, 14, 1, 'Headphones 1', 'Headphone outputs'), sock('hp.2', 'out', 'phones', 446, 66, 14, 2, 'Headphones 2', 'Headphone outputs'),
        ],
      };
      const back = {
        id: 'back', label: 'Back', rack: 2, w: RACK_W, h: units(2),
        parts: [
          part('switch', 30, 20), part('iec', 30, 58), T(30, 10, '100-240 VAC', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
          part('xlr4', 66, 56, { label: 'PSU 24VDC' }), ...rowLabel(90, 142, 44, 'OUTPUT'),
          part('fan', 202, 44, { d: 74 }), part('led', 290, 74, { color: '#2a2c30', label: 'P' }),
          part('ethercon', 362, 58, { label: 'SoundGrid' }), ...rowLabel(404, 462, 42, 'AES'),
        ],
        sockets: [
          sock('out.9', 'out', 'xlr-m', 102, 22, 22, 9, 'Output 9', 'Line outputs (back)'), sock('out.10', 'out', 'xlr-m', 132, 22, 22, 10, 'Output 10', 'Line outputs (back)'),
          sock('out.11', 'out', 'xlr-m', 102, 64, 22, 11, 'Output 11', 'Line outputs (back)'), sock('out.12', 'out', 'xlr-m', 132, 64, 22, 12, 'Output 12', 'Line outputs (back)'),
          sock('aesin.1', 'in', 'xlr-f', 418, 60, 22, 'IN', 'AES in 1-2', 'AES/EBU', { pair: true }), sock('aesout.1', 'out', 'xlr-m', 447, 60, 22, 'OUT', 'AES out 1-2', 'AES/EBU', { pair: true }),
        ],
      };
      return { faces: [front, back] };
    },
  });
  add({
    id: 'waves-ionic-24', family: 'waves', maker: 'Waves', name: 'IONIC 24',
    about: '24 mic/line inputs and outputs 1–14 on the front with 2 headphone outputs; outputs 15–18, AES and the SoundGrid port on the back. 3U.',
    build() {
      const outs = [...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 4, x0: 286, dx: 30.6, y0: 22, dy: 42, size: 22, where: 'Line outputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 6, cols: 6, x0: 286, dx: 30.6, y0: 106, dy: 0, size: 22, start: 9, keyStart: 9, where: 'Line outputs' })];
      const front = {
        id: 'front', label: 'Front', rack: 3, w: RACK_W, h: units(3), parts: ionicFront(3),
        sockets: [
          ...grid({ group: 'in', kind: 'in', connector: 'combo', count: 24, cols: 8, x0: 47, dx: 30.2, y0: 22, dy: 42, size: 22, where: 'Mic/line inputs' }),
          ...outs,
          sock('hp.1', 'out', 'phones', 446, 28, 14, 1, 'Headphones 1', 'Headphone outputs'), sock('hp.2', 'out', 'phones', 446, 72, 14, 2, 'Headphones 2', 'Headphone outputs'),
        ],
      };
      const back = {
        id: 'back', label: 'Back', rack: 3, w: RACK_W, h: units(3), note: 'Back laid out like the IONIC 16’s (no photo of it)',
        parts: [part('switch', 30, 30), part('iec', 30, 70), part('xlr4', 66, 100, { label: 'PSU 24VDC' }), ...rowLabel(90, 142, 52, 'OUTPUT'), part('fan', 210, 66, { d: 90 }), part('ethercon', 362, 84, { label: 'SoundGrid' }), ...rowLabel(396, 462, 46, 'AES')],
        sockets: [
          ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 4, cols: 2, x0: 102, dx: 30, y0: 30, dy: 44, size: 22, start: 15, keyStart: 15, where: 'Line outputs (back)' }),
          sock('aesin.1', 'in', 'xlr-f', 410, 84, 22, 'IN', 'AES in 1-2', 'AES/EBU', { pair: true }),
          sock('aesout.1', 'out', 'xlr-m', 446, 64, 22, '1', 'AES out 1-2', 'AES/EBU', { pair: true }), sock('aesout.2', 'out', 'xlr-m', 446, 104, 22, '2', 'AES out 3-4', 'AES/EBU', { pair: true }),
        ],
      };
      return { faces: [front, back] };
    },
  });

  // ── DiGiCo consoles: their own I/O, on the back ──
  // Each console's sockets use the same keys, so a session's local I/O goes
  // on any of them: in.N mic/line inputs, out.N line outputs, aesin.K and
  // aesout.K AES pairs (channels 2K-1 and 2K).
  const dgLabel = (x, y, text, o = {}) => T(x, y, text, { size: 2.6, anchor: 'middle', fill: '#aeb2b9', ...o });

  // Quantum 225: traced from DiGiCo's photo of the back (the 225DS's, laid
  // out as the Quantum 225's line drawing), 1124 mm wide. Along the bottom,
  // mic/line in 1-8 and line out 1-8; above them the MADI, word clock, DMI
  // slots, AES, MIDI, GPI/GPO, network and power; Optocore above that.
  add({
    id: 'digico-q225', family: 'digico-console', maker: 'DiGiCo', name: 'Quantum 225 (console)',
    about: 'The back of the Quantum 225: 8 mic/line inputs, 8 line outputs, 2 AES in and 2 AES out (4 channels each way), MADI, 2 DMI slots and Optocore.',
    build() {
      const parts = [
        part('box', 0, 0, { w: 1124, h: 48 }), part('box', 0, 14, { w: 32, h: 395 }), part('box', 1092, 14, { w: 32, h: 395 }),
        T(562, 150, 'DiGiCo', { size: 44, weight: 800, anchor: 'middle' }),
        T(1010, 150, 'Quantum', { size: 20, weight: 300, anchor: 'middle' }), T(1030, 170, '225', { size: 14, weight: 700, anchor: 'middle' }),
        part('box', 845, 165, { w: 73, h: 83 }),
        // Optocore: loop 1 (A, B) fitted, loop 2 a blank plate
        dgLabel(244, 184, 'OPTOCORE', { size: 3.4, fill: '#e3e5e9' }), dgLabel(191, 194, 'OPTICAL LOOP 1'), dgLabel(294.5, 194, 'OPTICAL LOOP 2'),
        part('optocon', 168, 212), part('optocon', 215, 212), dgLabel(168, 199, 'A'), dgLabel(215, 199, 'B'), part('box', 255, 199, { w: 79, h: 34 }),
        part('sticker', 433, 187, { w: 63, h: 51 }), dgLabel(541, 209, 'ACIP'), part('rj45', 541, 220),
        // The I/O panel: UB MADI, network, word clock, MADI
        part('box', 104, 260, { w: 271, h: 36 }), dgLabel(124, 268, 'Quantum 2'),
        part('usb', 111, 289), part('rj45', 131, 288), part('rj45', 150, 288),
        dgLabel(212, 262, 'W.CLOCK'), part('bnc', 212, 270), part('bnc', 212, 287),
        ...[300, 319, 338, 357].flatMap((x) => [part('bnc', x, 270), part('bnc', x, 287)]), dgLabel(290, 266, 'OUT'), dgLabel(290, 291, 'IN'), dgLabel(328.5, 300, 'MADI'),
        // The DMI slots
        part('box', 110, 300, { w: 128, h: 57 }), dgLabel(174, 364, 'DMI 1', { size: 3.4 }), part('box', 241, 300, { w: 127, h: 57 }), dgLabel(304.5, 364, 'DMI 2', { size: 3.4 }),
        // Network, USB and displays
        part('box', 387, 260, { w: 172, h: 36 }), T(398, 271, 'DiGiCo', { size: 4, weight: 800 }),
        part('rj45', 396, 288), part('rj45', 421, 288), part('button', 470, 266), dgLabel(482, 268, 'RESET', { anchor: 'start' }),
        part('box', 450, 288, { w: 12, h: 5 }), part('box', 475, 288, { w: 12, h: 5 }), part('usb', 508, 291), part('usb', 527, 291), part('usb', 549, 291),
        dgLabel(412, 314, 'AES 1'), dgLabel(463, 314, 'AES 2'),
        dgLabel(524, 320, 'MIDI PORT A'), part('din', 501, 335), part('din', 524, 335), part('din', 547, 335), dgLabel(501, 345, 'IN'), dgLabel(524, 345, 'THRU'), dgLabel(547, 345, 'OUT'),
        part('jack', 569, 320, { r: 4 }), part('jack', 590.5, 320, { r: 4 }), part('jack', 569, 339.6, { r: 4 }), part('jack', 590.5, 339.6, { r: 4 }),
        dgLabel(569, 314, 'GPO 1'), dgLabel(590.5, 314, 'GPO 2'), dgLabel(580, 350, 'GPI 1 · 2'),
        // Power
        dgLabel(506, 358, 'INPUT A'), dgLabel(545.5, 358, 'INPUT B'), part('iec', 506, 374), part('iec', 545.5, 374), part('switch', 506, 396), part('switch', 545.5, 396),
        ...rowLabel(62, 262, 379, 'MIC LINE IN 1-8'), ...rowLabel(268, 466, 379, 'LINE OUT 1-8'),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 8, cols: 8, x0: 72.4, dx: 25.73, y0: 396, dy: 0, size: 21, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 277.8, dx: 25.56, y0: 396, dy: 0, size: 21, where: 'Line outputs' }),
        sock('aesin.1', 'in', 'xlr-f', 400, 331, 20, 'IN', 'AES 1 in (1-2)', 'AES/EBU', { pair: true }), sock('aesout.1', 'out', 'xlr-m', 424, 331, 20, 'OUT', 'AES 1 out (1-2)', 'AES/EBU', { pair: true }),
        sock('aesin.2', 'in', 'xlr-f', 451, 331, 20, 'IN', 'AES 2 in (3-4)', 'AES/EBU', { pair: true }), sock('aesout.2', 'out', 'xlr-m', 475, 331, 20, 'OUT', 'AES 2 out (3-4)', 'AES/EBU', { pair: true }),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 1124, h: 422, parts, sockets, note: 'Drawn from DiGiCo’s photo' }] };
    },
  });

  // Quantum 338: traced from DiGiCo's straight-on render of the back, 1595 mm
  // wide; the connectors are on a 1014 mm panel low in the middle. Along its
  // bottom, mic/line in 1-8 and line out 1-8; above them RS422, MIDI and AES
  // 1-4 (in, out); then Optocore, MADI, the DMI slots, network and power.
  add({
    id: 'digico-q338', family: 'digico-console', maker: 'DiGiCo', name: 'Quantum 338 (console)',
    about: 'The back of the Quantum 338: 8 mic/line inputs, 8 line outputs, 4 AES in and 4 AES out (8 channels each way), MADI, 2 DMI slots and Optocore.',
    build() {
      const parts = [
        part('box', 0, 0, { w: 1595, h: 63 }), part('box', 0, 63, { w: 293, h: 333 }), part('box', 1302, 63, { w: 293, h: 333 }), part('box', 296, 128, { w: 1015, h: 342 }),
        T(803, 170, 'DiGiCo', { size: 40, weight: 800, anchor: 'middle' }), T(1136, 181, 'Quantum', { size: 18, weight: 300, anchor: 'middle' }), T(1156, 199, '338', { size: 12, weight: 700, anchor: 'middle' }),
        part('db25', 361, 299, { label: 'GPI 1-16' }), part('db25', 460.5, 299, { label: 'GPO 1-16' }), part('box', 513, 292, { w: 112, h: 46 }), part('sticker', 642, 288, { w: 66, h: 51 }),
        part('box', 365, 406, { w: 16, h: 8 }), dgLabel(373, 401, 'RS422'),
        dgLabel(426, 395, 'MIDI PORT A'), part('din', 403.2, 406), part('din', 426.2, 406), part('din', 449.9, 406),
        ...[['AES 1', 487], ['AES 2', 539], ['AES 3', 591.5], ['AES 4', 640]].map(([t, x]) => dgLabel(x, 392, t)),
        ...rowLabel(316, 509, 425, 'MIC LINE IN 1-8'), ...rowLabel(517, 709, 425, 'LINE OUT 1-8'),
        // Optocore, then UB MADI, network, word clock and MADI, then the DMI slots
        dgLabel(803, 257, 'OPTICAL LOOP 1'), part('optocon', 782, 285), part('optocon', 824, 285), dgLabel(902.5, 257, 'OPTICAL LOOP 2'), part('box', 866, 260, { w: 73, h: 41 }),
        part('sticker', 954, 271, { w: 58, h: 27 }),
        part('usb', 753, 354), part('rj45', 776, 353), part('rj45', 793.5, 353), dgLabel(837, 330, 'W.CLOCK · SYNC'),
        ...[820, 855].flatMap((x) => [part('bnc', x, 338), part('bnc', x, 355)]),
        ...[908, 928, 945.6, 963, 981.5, 999.8].flatMap((x) => [part('bnc', x, 338), part('bnc', x, 355)]), dgLabel(954, 330, 'MADI'),
        part('box', 755, 367, { w: 122, h: 57 }), dgLabel(816, 431, 'DMI 1', { size: 3.4 }), part('box', 881, 367, { w: 130, h: 57 }), dgLabel(946, 431, 'DMI 2', { size: 3.4 }),
        // Waves port, network, video, reset, USB; the power supply module
        part('rj45', 1206, 275), dgLabel(1206, 266, 'WAVES'), part('rj45', 1038.4, 353), part('rj45', 1061.4, 353), part('box', 1092, 351, { w: 12, h: 6 }),
        part('button', 1138, 336), dgLabel(1138, 327, 'PC RESET'), part('usb', 1149, 357), part('usb', 1170, 357), part('usb', 1191, 357),
        part('box', 1015, 374, { w: 276, h: 88 }), T(1022, 386, 'DiGiCo', { size: 5, weight: 800 }), dgLabel(1046, 393, 'POWER SUPPLY MODULE'),
        part('iec', 1153.6, 401), part('switch', 1188, 401), dgLabel(1153.6, 420, 'INPUT A'), part('iec', 1245.4, 401), part('switch', 1280, 401), dgLabel(1245.4, 420, 'INPUT B'),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 8, cols: 8, x0: 324.4, dx: 25.1, y0: 437, dy: 0, size: 21, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 525.6, dx: 25.2, y0: 437, dy: 0, size: 21, where: 'Line outputs' }),
        ...[[473.5, 501], [526.3, 552.3], [578.3, 605.1], [627.3, 653.3]].flatMap(([xi, xo], k) => [
          sock(`aesin.${k + 1}`, 'in', 'xlr-f', xi, 406, 20, 'IN', `AES ${k + 1} in (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
          sock(`aesout.${k + 1}`, 'out', 'xlr-m', xo, 406, 20, 'OUT', `AES ${k + 1} out (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
        ]),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 1595, h: 475, parts, sockets, note: 'Drawn from DiGiCo’s render' }] };
    },
  });

  // The engine module of a Quantum 7 or 852, `dx` mm across from engine A:
  // its MADI, Optocore, network and DMI slots (none of them a socket here)
  const q8Engine = (dx) => [
    part('box', 213 + dx, 377, { w: 500, h: 186 }), T(226 + dx, 393, 'Quantum engine', { size: 6, weight: 300 }), T(700 + dx, 393, 'DiGiCo', { size: 5, weight: 800, anchor: 'end' }),
    part('handle', 222 + dx, 413, { h: 120, thin: true }), part('handle', 704 + dx, 413, { h: 120, thin: true }),
    part('button', 274 + dx, 411), dgLabel(274 + dx, 404, 'RESET'), dgLabel(272 + dx, 430, 'AES SYNC'), part('xlr4', 259 + dx, 444), part('xlr4', 286 + dx, 444),
    part('bnc', 304 + dx, 431), ...[322, 343, 364, 385, 406, 426.8, 447.7, 468.6, 489.5].flatMap((x) => [part('bnc', x + dx, 431), part('bnc', x + dx, 454)]),
    dgLabel(322 + dx, 422, 'W.CLOCK'), dgLabel(427 + dx, 422, 'MADI'),
    part('usb', 525 + dx, 409), part('usb', 525 + dx, 422), part('usb', 545 + dx, 414), part('box', 564 + dx, 411, { w: 12, h: 6 }), dgLabel(570 + dx, 405, 'DISPLAY PORT'),
    ...[595, 616, 637, 658, 679].map((x) => part('rj45', x + dx, 413)), dgLabel(637 + dx, 404, 'ETHERNET 1-5'),
    dgLabel(590 + dx, 441, 'OPTOCORE', { size: 3.4, fill: '#e3e5e9' }), ...[531, 567.5, 608, 649].map((x) => part('optocon', x + dx, 459)),
    part('rj45', 658 + dx, 508), dgLabel(658 + dx, 499, 'WAVES'),
    part('box', 241 + dx, 469, { w: 127, h: 53 }), dgLabel(304 + dx, 530, 'DMI 1', { size: 3.4 }), part('box', 372 + dx, 469, { w: 123, h: 53 }), dgLabel(433 + dx, 530, 'DMI 2', { size: 3.4 }),
  ];
  // Three I/O modules, each row: mic/line in 1-4, line out 1-4, then two AES
  // pairs (in and out; `order` says which way round on the panel); so 12 in,
  // 12 out and 6 AES pairs each way
  const q8IoModules = (x0, y0, step, dy, { order = ['in', 'out', 'in', 'out'], fill = '#1f2f7a' } = {}) => {
    const parts = [], sockets = [];
    for (let k = 0; k < 3; k++) {
      const y = y0 + k * dy;
      parts.push(part('box', x0 - 20, y - 15, { w: 12 * step + 25, h: 30, fill }));
      for (let i = 0; i < 4; i++) {
        sockets.push(sock(`in.${k * 4 + i + 1}`, 'in', 'xlr-f', x0 + i * step, y, 20, k * 4 + i + 1, `Input ${k * 4 + i + 1}`, `I/O module ${k + 1}: mic/line inputs`));
        sockets.push(sock(`out.${k * 4 + i + 1}`, 'out', 'xlr-m', x0 + (i + 4) * step, y, 20, k * 4 + i + 1, `Output ${k * 4 + i + 1}`, `I/O module ${k + 1}: line outputs`));
      }
      order.forEach((dir, j) => {
        const n = k * 2 + (j < 2 ? 1 : 2);
        sockets.push(sock(`aes${dir}.${n}`, dir, dir === 'in' ? 'xlr-f' : 'xlr-m', x0 + (8 + j) * step, y, 20, dir.toUpperCase(), `AES ${n} ${dir} (${n * 2 - 1}-${n * 2})`, 'AES/EBU', { pair: true }));
      });
    }
    return { parts, sockets };
  };

  // Quantum 852: traced from DiGiCo's straight-on render of the back, 1767 mm
  // wide. Two power supply modules up top; in the middle the video, GPI/O,
  // SMPTE and MIDI panel over the three I/O modules; engines A and B below.
  add({
    id: 'digico-q852', family: 'digico-console', maker: 'DiGiCo', name: 'Quantum 852 (console)',
    about: 'The back of the Quantum 852: 12 mic/line inputs, 12 line outputs and 6 AES in and out (12 channels each way) on three I/O modules, with two engines (MADI, Optocore, DMI slots) and two power supplies.',
    build() {
      const io = q8IoModules(742.7, 438.6, 25.06, 33.6);
      const psu = (x) => [
        part('box', x, 218, { w: 368, h: 148 }), T(x + 18, 230, 'DiGiCo QUANTUM POWER SUPPLY MODULE', { size: 4, weight: 700 }), part('vent', x + 61, 241, { w: 227, h: 100 }),
        part('handle', x + 7, 241, { h: 118, thin: true }), part('handle', x + 356, 241, { h: 118, thin: true }), part('switch', x + 320, 268), part('iec', x + 320, 327),
      ];
      const parts = [
        part('box', 36, 0, { w: 1707, h: 186 }), part('vent', 118, 100, { w: 1544, h: 18, holes: true }), part('box', 0, 14, { w: 191, h: 526 }), part('box', 1589, 14, { w: 178, h: 526 }),
        part('box', 191, 186, { w: 1398, h: 381 }),
        ...psu(320), dgLabel(712, 222, 'PSU 1'), ...psu(1094), dgLabel(1080, 222, 'PSU 2'),
        T(890, 262, 'DiGiCo', { size: 38, weight: 800, anchor: 'middle' }),
        part('box', 717, 295, { w: 345, h: 118 }), part('sticker', 717, 302, { w: 114, h: 25 }),
        dgLabel(862.5, 312, 'VIDEO 1'), part('bnc', 849, 322), part('bnc', 876, 322), dgLabel(922, 312, 'VIDEO 2'), part('bnc', 910, 322), part('box', 928, 319, { w: 12, h: 6 }), part('box', 948, 316, { w: 20, h: 12 }),
        part('db25', 772, 361, { label: 'GPI 1' }), part('db25', 772, 400, { label: 'GPI 2' }), part('db25', 999, 361, { label: 'GPO 1' }), part('db25', 999, 400, { label: 'GPO 2' }),
        dgLabel(852, 349, 'SMPTE'), part('xlr4', 840, 362), part('xlr4', 864, 362),
        dgLabel(931, 351, 'MIDI 1'), ...[906, 931, 955].map((x) => part('din', x, 361)), dgLabel(931, 390, 'MIDI 2'), ...[906, 931, 955].map((x) => part('din', x, 400)),
        dgLabel(729, 384, 'A', { size: 4 }), dgLabel(1050, 384, 'B', { size: 4 }),
        ...io.parts, ...q8Engine(0), ...q8Engine(867),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 1767, h: 570, parts, sockets: io.sockets, note: 'Drawn from DiGiCo’s render' }] };
    },
  });

  // Quantum 7 (SD7 Quantum): traced from DiGiCo's straight-on render of the
  // back, 1496 mm wide. Engines A and B on the left (control module over
  // audio module); in the middle GPI/O, MIDI, video and talkback over three
  // rows of I/O (unlabelled in the render: the AES sockets go in, out, out,
  // in, read as pairs 1 then 2); SMPTE, more MIDI and GPI/O and the two power
  // supplies on the right.
  const q7Engine = (dx) => [
    part('box', 74 + dx, 263, { w: 292, h: 112, fill: '#1f2f7a' }), part('box', 74 + dx, 378, { w: 292, h: 112 }),
    T(352 + dx, 276, 'Quantum 7', { size: 5, weight: 300, anchor: 'end' }), dgLabel(180 + dx, 274, 'OPTICAL LOOP 1 · 2'),
    ...[107.7, 158.6, 209.5, 252].map((x) => part('optocon', x + dx, 309.5)), part('rj45', 286 + dx, 309), dgLabel(286 + dx, 300, 'WAVES'),
    part('box', 112 + dx, 345, { w: 22, h: 8 }), part('box', 157 + dx, 345, { w: 22, h: 8 }), part('rj45', 244 + dx, 348), part('rj45', 263 + dx, 348), part('usb', 282 + dx, 349), part('box', 326 + dx, 345, { w: 22, h: 8 }),
    dgLabel(123 + dx, 342, 'DVI-1'), dgLabel(168 + dx, 342, 'DVI-2'), dgLabel(337 + dx, 342, 'TEST'),
    part('usb', 86.5 + dx, 395), part('rj45', 118.7 + dx, 394), part('rj45', 139 + dx, 394), dgLabel(129 + dx, 385, 'ENG'),
    ...Array.from({ length: 12 }, (_, i) => 155 + i * 17.5).flatMap((x) => [part('bnc', x + dx, 377 + 10), part('bnc', x + dx, 403)]), dgLabel(290 + dx, 414, 'MADI'),
    part('box', 82 + dx, 420, { w: 140, h: 55 }), dgLabel(152 + dx, 482, 'DMI 1', { size: 3.4 }), part('box', 226 + dx, 420, { w: 136, h: 55 }), dgLabel(294 + dx, 482, 'DMI 2', { size: 3.4 }),
  ];
  add({
    id: 'digico-q7', family: 'digico-console', maker: 'DiGiCo', name: 'Quantum 7 / SD7 (console)',
    about: 'The back of the Quantum 7 and SD7 (the same chassis and local I/O): 12 mic/line inputs, 12 line outputs and 6 AES in and out (12 channels each way) in three rows, a talkback input, two engines (MADI, Optocore, DMI slots) and two power supplies.',
    build() {
      const io = q8IoModules(714.8, 373.6, 23.05, 33.8, { order: ['in', 'out', 'out', 'in'], fill: '#1a1c20' });
      const psu = (x) => [
        part('box', x, 311, { w: 197, h: 175 }), T(x + 16, 325, 'DiGiCo', { size: 6, weight: 800 }), part('vent', x + 40, 332, { w: 58, h: 62, holes: true }), part('vent', x + 110, 332, { w: 58, h: 62, holes: true }),
        part('handle', x + 16, 330, { h: 140, thin: true }), part('handle', x + 185, 330, { h: 140, thin: true }), dgLabel(x + 98, 413, 'DO NOT RESTRICT AIRFLOW'),
        part('iec', x + 64, 443), part('switch', x + 129, 443), dgLabel(x + 129, 458, 'POWER'),
      ];
      const parts = [
        part('box', 36, 17, { w: 1424, h: 229 }), part('box', 0, 4, { w: 36, h: 326 }), part('box', 1460, 4, { w: 36, h: 326 }),
        ...Array.from({ length: 10 }, (_, i) => part('vent', 60 + i * 132, 66, { w: 92, h: 16 })),
        T(332, 186, 'SD7  DiGiCo', { size: 26, weight: 800, anchor: 'middle', fill: '#3a3e45' }), T(1257, 186, 'SD7  DiGiCo', { size: 26, weight: 800, anchor: 'middle', fill: '#3a3e45' }),
        part('box', 59, 259, { w: 1376, h: 233 }),
        ...q7Engine(0), ...q7Engine(297),
        part('db25', 745, 297.5, { label: 'GPI' }), ...[792.4, 814.2, 836.1].map((x) => part('din', x, 294)), dgLabel(814, 284, 'MIDI'), part('db25', 886, 297.5, { label: 'GPO' }),
        part('bnc', 943.4, 286), part('bnc', 965.3, 286), part('bnc', 943.4, 304), part('bnc', 965.3, 304), dgLabel(954, 276, 'VIDEO'),
        part('box', 692, 357, { w: 301, h: 100 }), ...io.parts,
        dgLabel(1053, 274, 'SMPTE'), part('xlr4', 1033, 286), part('xlr4', 1072.6, 286), ...[1114.3, 1137.5, 1160].map((x) => part('din', x, 286)),
        part('box', 1178, 282, { w: 15, h: 8 }), part('db25', 1238, 286), part('db25', 1304.4, 286),
        ...psu(1016), ...psu(1218),
      ];
      const sockets = [sock('tb.1', 'in', 'xlr-f', 725, 324, 20, 'TB', 'Talkback input', 'Talkback'), ...io.sockets];
      return { faces: [{ id: 'back', label: 'Back', w: 1496, h: 492, parts, sockets, note: 'Drawn from DiGiCo’s render; the AES sockets’ order is assumed' }] };
    },
  });

  // SD12 (and SD12-96, the same back): traced from DiGiCo's straight-on render,
  // 1124 mm wide. On the right, AES 1-4 (in, out) over mic/line in 1-8 and
  // line out 1-8; MADI, word clock, DMI slots and Optocore (blanked) in the
  // middle; network, USB, DVI and power on the left.
  add({
    id: 'digico-sd12', family: 'digico-console', maker: 'DiGiCo', name: 'SD12 (console)',
    about: 'The back of the SD12 and SD12-96: 8 mic/line inputs, 8 line outputs, 4 AES in and 4 AES out (8 channels each way), 2 MADI, 2 DMI slots and Optocore (an option).',
    build() {
      const parts = [
        part('box', 30, 0, { w: 1061, h: 31 }), part('box', 37, 31, { w: 1051, h: 64, fill: '#141518' }), part('box', 0, 0, { w: 37, h: 357 }), part('box', 1088, 0, { w: 36, h: 357 }),
        T(531.6, 166, 'DiGiCo SD12', { size: 38, weight: 800, anchor: 'middle' }),
        dgLabel(111.5, 195, 'DO NOT RESTRICT AIRFLOW'), part('fan', 111.5, 240, { d: 70 }), dgLabel(962, 202, 'DO NOT RESTRICT AIRFLOW'), part('vent', 865, 217, { w: 195, h: 49 }),
        part('box', 172, 197, { w: 85, h: 159 }), part('sticker', 182, 236, { w: 65, h: 13 }), dgLabel(194.3, 316, 'INPUT A'), dgLabel(234, 316, 'INPUT B'), part('iec', 194.3, 332), part('iec', 234, 332),
        part('box', 270, 311, { w: 22, h: 8 }), part('usb', 314, 306), part('usb', 314, 316), part('usb', 333, 306), part('usb', 333, 316), part('rj45', 353.8, 312),
        part('led', 392, 315, { color: '#3a1d1d' }), part('led', 399, 315, { color: '#3a1d1d' }), dgLabel(395, 305, 'FAULT'), part('button', 412.4, 315),
        dgLabel(476.5, 228, 'OPTICAL LOOP 1'), part('box', 437, 232, { w: 79, h: 37 }), dgLabel(576, 228, 'OPTICAL LOOP 2'), part('box', 536.5, 232, { w: 79, h: 37 }),
        part('box', 373, 323, { w: 126, h: 58 }), dgLabel(436, 320, 'DMI 1'), part('box', 501, 323, { w: 126, h: 58 }), dgLabel(564, 320, 'DMI 2'),
        part('usb', 525.5, 313), dgLabel(522, 304, 'UB MADI'), part('bnc', 553, 291.4), part('bnc', 553, 311.6), dgLabel(597.5, 281, 'MADI 2 · 1'),
        part('bnc', 588.4, 291.4), part('bnc', 606.7, 291.4), part('bnc', 588.4, 311.6), part('bnc', 606.7, 311.6),
        part('db25', 704, 300.6, { label: 'GPI 1-16' }), part('db25', 794.3, 300.6, { label: 'GPO 1-16' }), part('box', 762, 332, { w: 15, h: 8 }), dgLabel(770, 327, 'RS422'),
        dgLabel(822, 322, 'MIDI PORT A'), ...[799.2, 821.8, 844.4].map((x) => part('din', x, 334.2)),
        ...[['AES 1', 883], ['AES 2', 933.6], ['AES 3', 984.4], ['AES 4', 1034.8]].map(([t, x]) => dgLabel(x, 318, t)),
        ...rowLabel(655, 850, 350, 'MIC LINE IN'), ...rowLabel(860, 1058, 350, 'LINE OUT 1-8'),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 8, cols: 8, x0: 667.2, dx: 25.4, y0: 363.5, dy: 0, size: 20, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 870.7, dx: 25.3, y0: 363.5, dy: 0, size: 20, where: 'Line outputs' }),
        ...[[870.7, 895.1], [921.4, 945.8], [971.5, 997.2], [1021.6, 1047.9]].flatMap(([xi, xo], k) => [
          sock(`aesin.${k + 1}`, 'in', 'xlr-f', xi, 331.8, 20, 'IN', `AES ${k + 1} in (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
          sock(`aesout.${k + 1}`, 'out', 'xlr-m', xo, 331.8, 20, 'OUT', `AES ${k + 1} out (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
        ]),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 1124, h: 388, parts, sockets, note: 'Drawn from DiGiCo’s render' }] };
    },
  });

  // SD5 and Quantum 5: the same chassis, 1465 mm wide (traced from DiGiCo's
  // photos of the back); only the engine in the middle differs. Up top, RS422,
  // MIDI and AES 1-4 (in, out); below, mic/line in 1-8 and line out 1-8 over
  // power supply A, GPI/GPO over power supply B.
  function sd5Chassis(engine, name, about) {
    return {
      family: 'digico-console', maker: 'DiGiCo', name, about,
      build() {
        const psu = (x, flip) => [
          part('box', x, 340, { w: 351, h: 108 }), dgLabel(x + 12, 338, flip ? 'PSU-B' : 'PSU-A', { anchor: 'start' }), dgLabel(x + 160, 349, 'DO NOT COVER HEATSINK'),
          part('vent', x + (flip ? 41 : 21), 354, { w: 224, h: 90 }), T(x + (flip ? 300 : 300), 352, 'DiGiCo', { size: 4.5, weight: 800, anchor: 'middle' }),
          part('switch', x + (flip ? 279 : 264), 389), part('iec', x + (flip ? 303 : 288), 389),
        ];
        const parts = [
          part('box', 31, 0, { w: 1399, h: 24 }), part('box', 0, 4, { w: 50, h: 380 }), part('box', 1415, 4, { w: 50, h: 380 }),
          part('box', 55, 28, { w: 1351, h: 110 }), part('vent', 98, 52, { w: 1290, h: 14 }), part('vent', 98, 91, { w: 1290, h: 14 }),
          part('box', 47, 140, { w: 1371, h: 80 }), part('box', 676, 148, { w: 111, h: 59 }),
          part('box', 59, 224, { w: 1343, h: 59 }), part('box', 167, 228, { w: 340, h: 32 }), part('box', 1035, 226, { w: 336, h: 33 }),
          part('box', 189, 244, { w: 15, h: 8 }), dgLabel(196, 239, 'RS422'), dgLabel(247, 234, 'MIDI PORT A'), ...[224.7, 247.4, 270.2].map((x) => part('din', x, 243.5)),
          ...[['AES 1', 308], ['AES 2', 357], ['AES 3', 407], ['AES 4', 457]].map(([t, x]) => dgLabel(x, 259, t)),
          part('box', 55, 287, { w: 1347, h: 167 }),
          ...rowLabel(90, 285, 330, 'MIC LINE IN 1-8'), ...rowLabel(288, 483, 330, 'LINE OUT 1-8'),
          ...psu(85, false), ...psu(1015, true), part('vent', 448, 346, { w: 35, h: 86, holes: true }), part('vent', 976, 346, { w: 35, h: 86, holes: true }),
          part('db25', 1021, 318, { label: 'GPI 1-16' }), part('db25', 1108, 318, { label: 'GPO 1-16' }), part('box', 1155, 299, { w: 216, h: 33 }), dgLabel(1210, 296, 'OPTION 1'), dgLabel(1316, 296, 'OPTION 2'),
          dgLabel(730, 292, 'DO NOT RESTRICT AIR FLOW'), part('sticker', 790, 289, { w: 150, h: 18 }),
          ...engine,
        ];
        const sockets = [
          ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 8, cols: 8, x0: 100.5, dx: 24.7, y0: 316.6, dy: 0, size: 19, where: 'Mic/line inputs' }),
          ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 298.5, dx: 24.6, y0: 316.6, dy: 0, size: 19, where: 'Line outputs' }),
          ...[[295.3, 320.5], [344, 370], [394.3, 419.5], [444.6, 469.7]].flatMap(([xi, xo], k) => [
            sock(`aesin.${k + 1}`, 'in', 'xlr-f', xi, 241, 19, 'IN', `AES ${k + 1} in (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
            sock(`aesout.${k + 1}`, 'out', 'xlr-m', xo, 241, 19, 'OUT', `AES ${k + 1} out (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
          ]),
        ];
        return { faces: [{ id: 'back', label: 'Back', w: 1465, h: 454, parts, sockets, note: 'Drawn from DiGiCo’s photo' }] };
      },
    };
  }
  add({
    id: 'digico-sd5', ...sd5Chassis([
      part('box', 495, 309, { w: 471, h: 145 }), T(515, 326, 'DiGiCo Digital Engine Module SD5', { size: 5, weight: 800 }),
      part('handle', 530, 345, { h: 35, thin: true }), part('handle', 927, 345, { h: 35, thin: true }), part('box', 550, 336, { w: 161, h: 40 }), dgLabel(630, 333, 'OPTOCORE'),
      part('box', 765, 360, { w: 14, h: 8 }), dgLabel(772, 356, 'NETWORK 2'), part('box', 793, 365, { w: 16, h: 8 }), dgLabel(801, 361, 'OVER VIEW'), part('vent', 820, 334, { w: 72, h: 43 }),
      part('box', 511, 381, { w: 436, h: 59 }), part('xlr4', 532.6, 404.5), part('xlr4', 564, 404.5), dgLabel(548, 430, 'AES SYNC IN · OUT'),
      part('bnc', 601.7, 404.5), part('bnc', 620.5, 404.5), dgLabel(611, 425, 'VIDEO · WCLK'),
      ...Array.from({ length: 8 }, (_, i) => 637.8 + i * 17.3).flatMap((x) => [part('bnc', x, 392.8), part('bnc', x, 414.7)]), dgLabel(698, 430, 'MADI 4B … 1A'),
      part('button', 784, 404.5), dgLabel(784, 414, 'RESET'), part('vent', 795, 386, { w: 92, h: 35 }), part('rj45', 921.4, 392.8), part('usb', 921.4, 408.5), part('usb', 921.4, 421),
    ], 'SD5 (console)', 'The back of the SD5: 8 mic/line inputs, 8 line outputs, 4 AES in and 4 AES out (8 channels each way), MADI and Optocore on its engine module, and two power supplies.'),
  });
  add({
    id: 'digico-q5', ...sd5Chassis([
      part('box', 492, 313.6, { w: 468, h: 60, fill: '#1f2f7a' }), part('box', 492, 373, { w: 468, h: 60 }), T(500, 325, 'DiGiCo', { size: 5, weight: 800 }), T(746, 326, 'Quantum 5', { size: 7, weight: 300, anchor: 'middle' }),
      part('usb', 532, 361), part('rj45', 549.4, 361), part('rj45', 567.7, 361), dgLabel(540, 352, 'UB MADI · 3 4'),
      part('bnc', 599.5, 343.8), part('bnc', 599.5, 361.3), part('bnc', 617, 361.3), part('bnc', 635, 343.8), part('bnc', 635, 361.3),
      ...Array.from({ length: 8 }, (_, i) => 652.7 + i * 17.5).flatMap((x) => [part('bnc', x, 343.8), part('bnc', x, 361.3)]), dgLabel(617, 372, 'AES · V SYNC · WCLK'), dgLabel(714, 372, 'MADI 8 … 1'),
      dgLabel(860, 330, 'OPTOCORE', { size: 3.4, fill: '#e3e5e9' }), part('optocon', 802, 345.4), part('optocon', 837.7, 345.4), part('box', 861.5, 333.5, { w: 71.5, h: 31.5 }),
      part('box', 524, 375, { w: 131, h: 55 }), dgLabel(590, 438, 'DMI 1'), part('box', 657.4, 375, { w: 122, h: 55 }), dgLabel(718, 438, 'DMI 2'),
      part('box', 796, 384.5, { w: 12, h: 6 }), part('ethercon', 824, 403), dgLabel(824, 388, 'WAVES'), part('button', 797, 420), dgLabel(797, 429, 'RESET'),
      part('rj45', 873.4, 411), part('rj45', 891.7, 411), part('usb', 911.5, 405), part('usb', 911.5, 417),
    ], 'Quantum 5 (console)', 'The back of the Quantum 5: 8 mic/line inputs, 8 line outputs, 4 AES in and 4 AES out (8 channels each way), with MADI, Optocore, the Waves port and 2 DMI slots on its engine, and two power supplies.'),
  });

  // S21 (763 mm wide) and S31 (1023 mm): the same panel, traced from DiGiCo's
  // photos of the back. Power on the left; UB MADI, DVI, network, USB, GPIO,
  // word clock and AES in/out over the two DMI slots; then a block of XLRs:
  // line out 1-12 on top, inputs 1-12 and 13-24 below.
  function sSeries(w, name) {
    return {
      family: 'digico-console', maker: 'DiGiCo', name,
      about: `The back of the ${name.replace(/ \(console\)$/, '')}: 24 mic/line inputs, 12 line outputs, 1 AES in and 1 AES out (2 channels each way) and 2 DMI slots.`,
      build() {
        const parts = [
          part('box', 33, 5, { w: w - 66, h: 21 }), part('box', 0, 8, { w: 46, h: 213 }), part('box', w - 46, 8, { w: 46, h: 213 }),
          part('box', 46, 26, { w: w - 92, h: 85 }), part('vent', 69, 46, { w: w - 138, h: 36, holes: true }),
          part('box', 46, 111, { w: w - 92, h: 184 }), part('vent', 69, 116, { w: w - 138, h: 28, holes: true }),
          T(w === 763 ? 377 : 511, 176, 'DiGiCo', { size: w === 763 ? 26 : 34, weight: 800, anchor: 'middle' }),
          part('box', 69, 154, { w: 108, h: 90 }), T(76, 166, 'DiGiCo', { size: 4, weight: 800 }), T(76, 175, name.split(' ')[0], { size: 6, weight: 800 }), part('sticker', 112, 156, { w: 60, h: 10 }),
          dgLabel(87, 245, 'INPUT'), part('iec', 87.4, 256), part('switch', 87.4, 278),
          part('usb', 120, 219), dgLabel(120, 209, 'UB MADI'), part('box', 141, 215, { w: 22, h: 8 }), part('ethercon', 188, 211), part('ethercon', 216, 211),
          part('usb', 236.4, 207), part('usb', 236.4, 218), part('jack', 259.6, 198, { r: 4 }), part('jack', 259.6, 217, { r: 4 }), dgLabel(259.6, 190, 'GPIO'),
          part('bnc', 280, 197), part('bnc', 280, 216), dgLabel(318.6, 196, 'AES'), part('button', 347, 218.5),
          part('box', 115, 226, { w: 121, h: 59 }), dgLabel(175, 292, 'DMI 1'), part('box', 239, 226, { w: 126, h: 59 }), dgLabel(302, 292, 'DMI 2'),
          part('box', 381, 192, { w: 294, h: 88 }),
        ];
        const sockets = [
          ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 12, cols: 12, x0: 393.2, dx: 24.3, y0: 205.6, dy: 0, size: 20, where: 'Line outputs' }),
          ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 24, cols: 12, x0: 393.2, dx: 24.3, y0: 236.4, dy: 29.9, size: 20, where: 'Mic/line inputs' }),
          sock('aesin.1', 'in', 'xlr-f', 305.8, 210.7, 20, 'IN', 'AES in (1-2)', 'AES/EBU', { pair: true }), sock('aesout.1', 'out', 'xlr-m', 331.5, 210.7, 20, 'OUT', 'AES out (1-2)', 'AES/EBU', { pair: true }),
        ];
        return { faces: [{ id: 'back', label: 'Back', w, h: 295, parts, sockets, note: 'Drawn from DiGiCo’s photo' }] };
      },
    };
  }
  add({ id: 'digico-s21', ...sSeries(763, 'S21 (console)') });
  add({ id: 'digico-s31', ...sSeries(1023, 'S31 (console)') });

  // SD9: traced from DiGiCo's photo of the back, 878 mm wide. Lamps on the top
  // edge; GP in, MIDI and GP out over two power supplies on the left; on the
  // right, AES in 1-2 and mic/line in 1-8 on top, AES out 1-2 and line out
  // 1-8 below, with word clock, MADI, D-Rack and the computer ports under them.
  add({
    id: 'digico-sd9', family: 'digico-console', maker: 'DiGiCo', name: 'SD9 (console)',
    about: 'The back of the SD9: 8 mic/line inputs, 8 line outputs, 2 AES in and 2 AES out (4 channels each way), MADI and 2 D-Rack ports.',
    build() {
      const psu = (x) => [part('box', x, 141, { w: 151, h: 96 }), part('vent', x + 18, 152, { w: 95, h: 66 }), part('iec', x + 129, 177), part('switch', x + 132, 203)];
      const parts = [
        part('box', 0, 1, { w: 42, h: 218, fill: '#7a1a1e' }), part('box', 834, 1, { w: 44, h: 218, fill: '#7a1a1e' }), part('box', 42, 6, { w: 792, h: 249 }),
        T(442, 40, 'SD9', { size: 32, weight: 800, anchor: 'middle', italic: true }),
        part('xlr4', 191, 24), dgLabel(210, 30, 'LAMP 1', { anchor: 'start' }), part('xlr4', 687, 24), dgLabel(706, 30, 'LAMP 2', { anchor: 'start' }),
        part('box', 173, 57, { w: 167, h: 33 }), dgLabel(200.7, 64, 'GP IN'), dgLabel(254.8, 64, 'MIDI PORT'), dgLabel(310, 64, 'GP OUT'),
        part('jack', 190.3, 77, { r: 4 }), part('jack', 211.2, 77, { r: 4 }), ...[232, 254.8, 277].map((x) => part('din', x, 77)), part('jack', 299.2, 77, { r: 4 }), part('jack', 321, 77, { r: 4 }),
        part('box', 173, 99, { w: 167, h: 29 }), part('sticker', 369, 95, { w: 53, h: 35 }),
        ...psu(69), ...psu(227), part('box', 378, 144, { w: 31, h: 86 }), part('led', 397, 167, { color: '#6b5a1a' }), part('led', 397, 188, { color: '#5a1a1a' }), part('led', 397, 207, { color: '#5a1a1a' }),
        part('vent', 456, 88, { w: 342, h: 22 }), part('vent', 456, 141, { w: 342, h: 23 }), T(625, 133, 'DiGiCo RED SNAPPER', { size: 12, weight: 800, anchor: 'middle' }),
        dgLabel(518, 87, 'AES INPUTS'), ...rowLabel(560, 815, 84, 'MIC LINE IN 1-8'), dgLabel(518, 166, 'AES OUTPUTS'), ...rowLabel(560, 815, 166, 'LINE OUT 1-8'),
        part('box', 467, 197, { w: 322, h: 40 }), part('bnc', 478, 211.6), part('bnc', 478, 223.6), dgLabel(478, 243, 'WORD CLOCK'), part('bnc', 538, 211.6), part('bnc', 538, 223.6), dgLabel(538, 243, 'MADI'),
        part('ethercon', 565, 219), part('ethercon', 593.5, 219), dgLabel(579, 243, 'D-RACK'), part('button', 644.7, 226), dgLabel(644.7, 243, 'RESET'),
        part('din', 698, 226), part('din', 718, 226), part('box', 738, 222, { w: 14, h: 8 }), dgLabel(718, 243, 'KEYBOARD · MOUSE · VGA'),
        part('rj45', 773.6, 207), part('usb', 773.6, 219), part('usb', 773.6, 230),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 8, cols: 8, x0: 568.2, dx: 33.2, y0: 68, dy: 0, size: 22, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 568.2, dx: 33.2, y0: 181.4, dy: 0, size: 22, where: 'Line outputs' }),
        sock('aesin.1', 'in', 'xlr-f', 501.5, 68, 22, 1, 'AES in 1 (1-2)', 'AES/EBU', { pair: true }), sock('aesin.2', 'in', 'xlr-f', 534.8, 68, 22, 2, 'AES in 2 (3-4)', 'AES/EBU', { pair: true }),
        sock('aesout.1', 'out', 'xlr-m', 501.5, 181.4, 22, 1, 'AES out 1 (1-2)', 'AES/EBU', { pair: true }), sock('aesout.2', 'out', 'xlr-m', 534.8, 181.4, 22, 2, 'AES out 2 (3-4)', 'AES/EBU', { pair: true }),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 878, h: 258, parts, sockets, note: 'Drawn from DiGiCo’s photo' }] };
    },
  });

  // SD10: traced from DiGiCo's outline drawing of the back (the full 1398 mm
  // frame; the SD10-24's is narrower, the same I/O). Waves port, GPI/GPO and
  // Optocore over two power supplies on the left; lamps, RS422, MIDI and AES
  // 1-4 (in, out) over mic/line in 1-8 and line out 1-8 in the middle, with
  // sync, word clock, MADI and the computer ports below; a blank plate and
  // vents on the right.
  add({
    id: 'digico-sd10', family: 'digico-console', maker: 'DiGiCo', name: 'SD10 (console)',
    about: 'The back of the SD10: 8 mic/line inputs, 8 line outputs, 4 AES in and 4 AES out (8 channels each way), 2 MADI and Optocore.',
    build() {
      const psu = (x) => [part('box', x, 169, { w: 151, h: 87 }), part('vent', x + 22, 182, { w: 80, h: 58 }), part('iec', x + 126, 204), part('sticker', x + 117, 225, { w: 20, h: 12 })];
      const parts = [
        part('box', 0, 0, { w: 43, h: 245 }), part('box', 1345, 0, { w: 61, h: 245 }), part('box', 40, 5, { w: 1308, h: 272 }),
        part('led', 249, 74, { color: '#2a2c30' }), part('led', 255, 74, { color: '#2a2c30' }), part('rj45', 272.5, 74), dgLabel(262, 63, 'WAVES'),
        part('db25', 169.4, 112, { label: 'GPI 1-16' }), part('db25', 259.6, 112, { label: 'GPO 1-16' }),
        dgLabel(384, 84, 'OPTICAL LOOP'), part('optocon', 364, 101), part('optocon', 404, 101),
        part('xlr4', 470.8, 74), dgLabel(470.8, 60, 'LAMP 1'), part('vent', 494, 63, { w: 386, h: 24 }), part('xlr4', 890.4, 74), dgLabel(890.4, 60, 'LAMP 2'),
        part('box', 593, 103, { w: 15, h: 8 }), dgLabel(600, 97, 'RS422'), dgLabel(650, 94, 'MIDI PORT A'), ...[627.3, 650.3, 672.7].map((x) => part('din', x, 104.5)),
        ...[['AES 1', 709.8], ['AES 2', 760.3], ['AES 3', 810.8], ['AES 4', 861.6]].map(([t, x]) => dgLabel(x, 89, t)),
        ...rowLabel(486, 683, 157, 'MIC LINE IN 1-8'), ...rowLabel(687, 884, 157, 'LINE OUT 1-8'), T(690, 200, 'DiGiCo SD10', { size: 16, weight: 800, anchor: 'middle' }),
        part('box', 970, 53, { w: 288, h: 82 }), part('vent', 977, 177, { w: 335, h: 75 }),
        ...psu(65), ...psu(220), part('box', 371, 169, { w: 34, h: 87 }),
        part('box', 462, 228, { w: 60, h: 33 }), part('xlr4', 476, 245), part('xlr4', 508, 245), dgLabel(492, 225, 'SYNC AES IN · OUT'),
        part('box', 551, 222, { w: 184, h: 37 }), part('bnc', 561, 231), part('bnc', 561, 249), dgLabel(561, 219, 'WORD CLOCK'),
        ...[650.3, 666.9, 685, 703].flatMap((x) => [part('bnc', x, 231), part('bnc', x, 249)]), dgLabel(676.6, 219, 'MADI 2B 2A 1B 1A'),
        part('button', 742.6, 251), dgLabel(742.6, 241, 'RESET'), part('din', 814.7, 251), part('din', 834.2, 251), part('box', 849, 247, { w: 14, h: 8 }), dgLabel(834, 241, 'KEYBOARD · MOUSE · VGA'),
        part('rj45', 890.4, 231), part('usb', 890.4, 245), part('usb', 890.4, 255),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 8, cols: 8, x0: 496, dx: 25.2, y0: 140.6, dy: 0, size: 20, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 8, x0: 697.2, dx: 25.2, y0: 140.6, dy: 0, size: 20, where: 'Line outputs' }),
        ...[[697.2, 722.4], [747.7, 772.9], [798.1, 823.4], [848.6, 874.6]].flatMap(([xi, xo], k) => [
          sock(`aesin.${k + 1}`, 'in', 'xlr-f', xi, 102.4, 20, 'IN', `AES ${k + 1} in (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
          sock(`aesout.${k + 1}`, 'out', 'xlr-m', xo, 102.4, 20, 'OUT', `AES ${k + 1} out (${k * 2 + 1}-${k * 2 + 2})`, 'AES/EBU', { pair: true }),
        ]),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 1406, h: 280, parts, sockets, note: 'Drawn from DiGiCo’s outline drawing' }] };
    },
  });

  // SD11 and SD11i (the same hardware): traced from DiGiCo's photo of the
  // back of the rack-mount SD11, 483 mm wide. Power on the left; mic/line in
  // 1-8 and line out 1-4 over in 9-16 and out 5-8; AES 1 in/out, GP in, MIDI
  // and GP out below; word clock, MADI, D-Rack and the computer ports along
  // the bottom.
  add({
    id: 'digico-sd11', family: 'digico-console', maker: 'DiGiCo', name: 'SD11 / SD11i (console)',
    about: 'The back of the SD11 and SD11i: 16 mic/line inputs, 8 line outputs, 1 AES in and 1 AES out (2 channels each way), MADI and a D-Rack port.',
    build() {
      const parts = [
        part('box', 0, 0, { w: 20, h: 6 }), part('box', 463, 0, { w: 20, h: 6 }), part('box', 20, 2, { w: 443, h: 52 }), part('button', 122.5, 24.5), part('button', 363.8, 24.5),
        part('box', 28, 60, { w: 423, h: 173 }), part('xlr4', 241, 64), dgLabel(255, 66, 'LAMP', { anchor: 'start' }),
        part('box', 31, 76, { w: 83, h: 143 }), part('vent', 40, 99, { w: 38, h: 59 }), part('handle', 36, 100, { h: 90, thin: true }), part('iec', 84.5, 197), part('switch', 57.6, 200), part('led', 94, 85, { color: '#3ddc84' }),
        ...rowLabel(126, 300, 104.5, 'MIC LINE IN 1-8'), ...rowLabel(318, 400, 104.5, 'LINE OUT 1-4'), ...rowLabel(126, 300, 135, 'MIC LINE IN 9-16'), ...rowLabel(318, 400, 135, 'LINE OUT 5-8'),
        part('sticker', 131, 143, { w: 64, h: 36 }), part('box', 199, 149, { w: 65, h: 25 }), dgLabel(215, 162, 'WAVES'), part('rj45', 252.4, 160.5),
        dgLabel(308, 177, 'AES 1'), part('jack', 343.7, 153, { r: 4 }), part('jack', 343.7, 171, { r: 4 }), dgLabel(343.7, 145, 'GP IN'),
        ...[362.6, 383.4, 403.5].map((x) => part('din', x, 155.6)), dgLabel(383.4, 168, 'MIDI PORT'), part('jack', 423.9, 153, { r: 4 }), part('jack', 423.9, 171, { r: 4 }), dgLabel(423.9, 145, 'GP OUT'),
        part('bnc', 136.5, 189), part('bnc', 136.5, 203), dgLabel(136.5, 214, 'WORD CLOCK'), part('bnc', 193.6, 189), part('bnc', 193.6, 203), dgLabel(193.6, 214, 'MADI'),
        part('box', 206.5, 181, { w: 57, h: 31 }), part('ethercon', 247.5, 197), dgLabel(235, 217, 'D-RACK'), part('led', 268, 207, { color: '#5a1a1a' }), part('led', 274, 207, { color: '#5a1a1a' }),
        part('button', 294, 207), dgLabel(294, 217, 'RESET'), T(352, 199, 'SD11', { size: 12, weight: 800, anchor: 'middle', italic: true }),
        part('din', 347, 214), part('din', 366.3, 214), part('box', 384, 210, { w: 14, h: 8 }), dgLabel(366, 225, 'KEYBOARD · MOUSE · OVERVIEW'),
        part('rj45', 417.7, 189), part('usb', 417.7, 201), part('usb', 417.7, 211),
      ];
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: 16, cols: 8, x0: 129.9, dx: 24.3, y0: 91.9, dy: 30.6, size: 19, where: 'Mic/line inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 8, cols: 4, x0: 324.6, dx: 23.8, y0: 91.9, dy: 30.6, size: 19, where: 'Line outputs' }),
        sock('aesin.1', 'in', 'xlr-f', 295.7, 159.3, 19, 'IN', 'AES 1 in (1-2)', 'AES/EBU', { pair: true }), sock('aesout.1', 'out', 'xlr-m', 320.2, 159.3, 19, 'OUT', 'AES 1 out (1-2)', 'AES/EBU', { pair: true }),
      ];
      return { faces: [{ id: 'back', label: 'Back', w: 483, h: 233, parts, sockets, note: 'Drawn from DiGiCo’s photo (rack-mount; the desk version adds end cheeks)' }] };
    },
  });

  // Waves eMotion LV1 Classic: the console's own I/O, on its back (traced
  // from a photo of the back, the console 559 mm wide): 16 combo inputs and
  // 12 line outputs in two rows, AES in and two AES outs, the network,
  // SoundGrid and power; under the screen's back, vents. The headphone
  // output is under the front edge.
  add({
    id: 'waves-lv1-classic', family: 'waves', maker: 'Waves', name: 'LV1 Classic (console)',
    about: 'The back of the LV1 Classic console: 16 mic/line inputs, 12 line outputs, AES in and two AES outs. Its headphone output is on the front edge.',
    build() {
      const back = {
        id: 'back', label: 'Back', w: 559, h: 380, note: 'Drawn from a photo',
        parts: [
          // The screen's back, with its vents
          part('box', 10, 1, { w: 539, h: 77 }), part('vent', 34, 22, { w: 266, h: 48 }), part('vent', 308, 22, { w: 219, h: 48 }),
          part('vent', 85, 93, { w: 386, h: 26, holes: true }), part('vent', 85, 238, { w: 386, h: 14, holes: true }),
          T(46, 96, 'USB', { size: 2.6, fill: '#aeb2b9' }), part('xlr4', 70.5, 104), T(70.5, 121, '12V MAX 2W', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }),
          ...[483, 505, 526].map((x) => part('button', x, 96.5)), T(505, 107.5, 'SYSTEM', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
          T(77, 186, 'LV1', { size: 30, weight: 300 }), T(78, 199, 'CLASSIC', { size: 8, weight: 600, fill: '#cfd2d7' }),
          part('grille', 212, 126, { w: 141, h: 104 }), T(282.5, 217, 'WAVES', { size: 14, weight: 800, anchor: 'middle', bg: true }),
          part('sticker', 394, 167, { w: 70, h: 37 }), part('sticker', 475, 226, { w: 70, h: 15 }),
          T(508.5, 133.5, 'AC INPUT', { size: 2.6, anchor: 'middle', fill: '#aeb2b9' }),
          part('iec', 493.7, 163, { label: '1' }), part('iec', 523.4, 163, { label: '2' }), part('switch', 493.7, 196.7), part('switch', 523.4, 196.7),
          ...[[31, 266], [31, 340], [524, 266], [524, 340]].map(([x, y]) => part('box', x, y, { w: 5, h: 10 })),
          T(77, 258, 'INPUT', { size: 4, weight: 700, bg: true }), T(488.5, 258, 'OUTPUT', { size: 4, weight: 700, anchor: 'middle', bg: true }),
          // The bottom row: USB, network, HDMI, SoundGrid, status
          part('usb', 104, 350), part('usb', 121, 350), T(139, 334, 'NETWORK', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }), part('rj45', 139, 346),
          part('box', 151, 345, { w: 14, h: 6 }), T(158, 341, 'HDMI', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }),
          part('rj45', 176, 344), part('rj45', 176, 357), T(176, 336, '3/4', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }),
          part('ethercon', 202.7, 350), part('ethercon', 230.9, 350), T(216.8, 333, 'SoundGrid  1 · 2', { size: 2.6, anchor: 'middle', fill: '#e3e5e9' }),
          T(367.5, 344, 'STATUS', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }), part('led', 367.5, 350, { color: '#2a2c30' }),
          T(425.4, 337, 'AES INPUT', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }), T(470.7, 337, 'AES OUTPUT', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }),
        ],
        sockets: [
          ...grid({ group: 'in', kind: 'in', connector: 'combo', count: 16, cols: 8, x0: 81.7, dx: 31.1, y0: 278.4, dy: 33.4, size: 24, where: 'Mic/line inputs' }),
          ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: 12, cols: 6, x0: 331.9, dx: 30.8, y0: 278.4, dy: 33.4, size: 23, where: 'Line outputs' }),
          sock('aesin.1', 'in', 'xlr-f', 425.4, 352, 21, 'IN', 'AES in 1-2', 'AES/EBU', { pair: true }),
          sock('aesout.1', 'out', 'xlr-m', 455.1, 352, 21, '1', 'AES out 1-2', 'AES/EBU', { pair: true }), sock('aesout.2', 'out', 'xlr-m', 486.3, 352, 21, '2', 'AES out 3-4', 'AES/EBU', { pair: true }),
        ],
      };
      // Under the front edge: the level, a 3.5 mm and a quarter-inch jack (one output)
      const front = {
        id: 'front', label: 'Front edge', w: 559, h: 34, note: 'Headphones; where they are is approximate',
        parts: [part('knob', 382, 17), T(382, 31, 'LEVEL', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' }), part('jack', 404, 17, { r: 3 }), T(404, 31, '3.5 mm', { size: 2.4, anchor: 'middle', fill: '#aeb2b9' })],
        sockets: [sock('hp.1', 'out', 'phones', 428, 16, 14, '🎧', 'Headphones', 'Headphone output (front edge)')],
      };
      return { faces: [back, front] };
    },
  });

  // DiGiGrid IOX (1U) and IOS (2U): headphones and meters on the front; the
  // inputs, line outputs (quarter-inch jacks) and everything else on the back.
  add({
    id: 'digigrid-iox', family: 'waves', maker: 'DiGiGrid', name: 'IOX',
    about: '12 mic/line inputs and 6 line outputs (quarter-inch jacks) on the back; 4 headphone outputs on the front. 1U.',
    build() {
      const meters = [];
      for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) meters.push(part('led', 296 + c * 12.4, 12 + r * 10, { color: r === 1 ? '#3ddc84' : '#2a2c30' }));
      const front = {
        id: 'front', label: 'Front', rack: 1, w: RACK_W, h: units(1),
        parts: [...[59, 97, 134, 172].map((x) => part('knob', x, 15, { dots: true })), part('display', 226, 4, { w: 30, h: 36, color: '#0d0e10', mark: 'IOX' }), part('led', 266, 22, { color: '#2f7bff', label: 'Net' }), ...meters, T(468, 27, 'DiGiGrid', { size: 7, weight: 700, anchor: 'end' })],
        sockets: [70, 108, 145, 183].map((x, i) => sock(`hp.${i + 1}`, 'out', 'phones', x, 33, 11, i + 1, `Headphones ${i + 1}`, 'Headphone outputs')),
      };
      const back = {
        id: 'back', label: 'Back', rack: 1, w: RACK_W, h: units(1),
        parts: [part('iec', 36, 26), part('bnc', 70, 12), part('bnc', 88, 12), part('rj45', 70, 32), part('rj45', 88, 32), T(80, 42.5, 'SOUNDGRID NETWORK', { size: 2, anchor: 'middle', fill: '#aeb2b9' }), ...rowLabel(108, 168, 1.8, 'LINE OUT'), ...rowLabel(176, 460, 1.8, 'MIC/LINE INPUT')],
        sockets: [
          ...grid({ group: 'out', kind: 'out', connector: 'trs', count: 6, rows: 2, byColumn: true, x0: 118, dx: 20, y0: 15, dy: 18, size: 12, where: 'Line outputs (quarter-inch jacks)' }),
          ...grid({ group: 'in', kind: 'in', connector: 'combo', count: 12, cols: 12, x0: 191, dx: 23.4, y0: 25, dy: 0, size: 21, where: 'Mic/line inputs' }),
        ],
      };
      return { faces: [front, back] };
    },
  });
  add({
    id: 'digigrid-ios', family: 'waves', maker: 'DiGiGrid', name: 'IOS',
    about: '8 mic/line inputs, 8 line outputs (quarter-inch jacks) and AES in and out on the back; 2 headphone outputs on the front. 2U.',
    build() {
      const meters = [];
      for (let c = 0; c < 8; c++) for (let r = 0; r < 3; r++) meters.push(part('led', 290 + c * 12, 30 + r * 13, { color: r === 1 ? '#3ddc84' : r === 2 ? '#f5a623' : '#2a2c30' }));
      const front = {
        id: 'front', label: 'Front', rack: 2, w: RACK_W, h: units(2),
        parts: [part('knob', 56, 34, { dots: true }), part('knob', 97, 34, { dots: true }), part('display', 226, 4, { w: 30, h: 80, color: '#0d0e10', mark: 'IOS' }), part('led', 278, 44, { color: '#2f7bff', label: 'Net' }), ...meters, T(468, 50, 'DiGiGrid', { size: 7, weight: 700, anchor: 'end' })],
        sockets: [sock('hp.1', 'out', 'phones', 74, 54, 11, 1, 'Headphones 1', 'Headphone outputs'), sock('hp.2', 'out', 'phones', 115, 54, 11, 2, 'Headphones 2', 'Headphone outputs')],
      };
      const back = {
        id: 'back', label: 'Back', rack: 2, w: RACK_W, h: units(2),
        parts: [
          part('iec', 34, 64), ...[78, 96, 114, 132].map((x) => part('rj45', x, 66)), T(105, 78, 'SOUNDGRID NETWORK', { size: 2.2, anchor: 'middle', fill: '#aeb2b9' }),
          part('usb', 200, 58), part('db25', 222, 26, { label: 'ALT LINE OUT 1-8' }), part('din', 240, 66), part('din', 258, 66), T(249, 56, 'MIDI', { size: 2.2, anchor: 'middle', fill: '#aeb2b9' }),
          part('bnc', 292, 72), part('bnc', 310, 72), part('rca', 332, 56), part('rca', 332, 72), T(332, 46, 'S/PDIF', { size: 2.2, anchor: 'middle', fill: '#aeb2b9' }),
          ...rowLabel(346, 392, 50, 'AES'), ...rowLabel(400, 464, 46, 'LINE OUT'), ...rowLabel(262, 464, 1.8, 'MIC/LINE INPUT'),
        ],
        sockets: [
          ...grid({ group: 'in', kind: 'in', connector: 'combo', count: 8, cols: 8, x0: 276, dx: 25, y0: 24, dy: 0, size: 21, where: 'Mic/line inputs' }),
          sock('aesin.1', 'in', 'xlr-f', 356, 66, 19, 'IN', 'AES in 1-2', 'AES/EBU', { pair: true }), sock('aesout.1', 'out', 'xlr-m', 380, 66, 19, 'OUT', 'AES out 1-2', 'AES/EBU', { pair: true }),
          ...grid({ group: 'out', kind: 'out', connector: 'trs', count: 8, rows: 2, byColumn: true, x0: 405, dx: 17, y0: 58, dy: 18, size: 12, where: 'Line outputs (quarter-inch jacks)' }),
        ],
      };
      return { faces: [front, back] };
    },
  });

  // Anything else: a 19-inch rack, as many units tall as its sockets need
  add({
    id: 'generic', family: 'any', maker: '', name: 'Generic stage box',
    about: 'Any stage box: choose how many inputs and outputs it has. Drawn as a 19-inch rack, as tall as it needs.',
    generic: true,
    build(box) {
      const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
      const ins = clampInt(box.generic && box.generic.inputs, 0, 128, 16), outs = clampInt(box.generic && box.generic.outputs, 0, 128, 8);
      const perRow = 14, dx = 30, x0 = (RACK_W - (perRow - 1) * dx) / 2, pitch = 38;
      const inRows = Math.ceil(ins / perRow), outRows = Math.ceil(outs / perRow);
      const rack = Math.max(1, Math.ceil((22 + (inRows + outRows) * pitch + (ins && outs ? 8 : 0)) / U));
      const H = units(rack);
      const top = (H - ((inRows + outRows) * pitch + (ins && outs ? 8 : 0))) / 2 + pitch / 2 - 2;
      const sockets = [
        ...grid({ group: 'in', kind: 'in', connector: 'xlr-f', count: ins, cols: perRow, x0, dx, y0: top, dy: pitch, size: 22, where: 'Inputs' }),
        ...grid({ group: 'out', kind: 'out', connector: 'xlr-m', count: outs, cols: perRow, x0, dx, y0: top + inRows * pitch + (ins ? 8 : 0), dy: pitch, size: 22, where: 'Outputs' }),
      ];
      return { faces: [{ id: 'front', label: 'Front', rack, w: RACK_W, h: H, parts: [], sockets }] };
    },
  });

  const FAMILIES = {
    digico: 'DiGiCo racks',
    'digico-console': 'DiGiCo consoles (their own I/O)',
    waves: 'Waves SoundGrid (eMotion LV1)',
    any: 'Any console',
  };
  // Which families come first for each console: LV1 can also use DiGiCo
  // racks through a MADI interface
  const FOR_CONSOLE = { digico: ['digico', 'digico-console', 'any'], lv1: ['waves', 'digico', 'any'] };

  // A box drawn: its faces (with sockets placed) and every socket in order,
  // inputs then outputs, each with its face
  function layoutFor(box) {
    const model = BOXES.find((b) => b.id === box.model) || BOXES.find((b) => b.id === 'generic');
    const { faces } = model.build.call(model, box);
    const ports = faces.flatMap((f) => f.sockets.map((s) => ({ ...s, face: f.id, faceLabel: f.label })));
    const ordered = [...ports.filter((p) => p.kind === 'in'), ...ports.filter((p) => p.kind === 'out')];
    return { model, faces, ports: ordered };
  }

  window.PATCH_LIBRARY = { BOXES, CARDS, FAMILIES, FOR_CONSOLE, layoutFor, RACK_W, U, EAR };
})();
