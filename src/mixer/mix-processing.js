'use strict';

// A dLive mix's graphic EQ and compressor, for the musicians on it: two
// items in the mix menu, beside the EQ, when the console offers them
// (dlive-server.js: config aux geqEnabled / compEnabled, the same Settings
// switch as the mix's EQ). As dLive4You offers them: the graphic EQ's 28
// bands (±12 dB) and in/out, and the compressor's threshold and in/out.
//   to the server:   request-aux-dyn { aux }, and OSC-shaped
//                    /Aux_Outputs/<aux>/GEQ/geq_in | geq_gain_<1-28>, /Comp/comp_in | comp_thresh
//   from the server: aux-dyn { aux, values }, and the same addresses as they change
// Uses mixer.js's sendOSC() and its menu (openMenu/closeMenu are its own).
(() => {
  const FREQS = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
  const GEQ_MAX = 12, THRESH_MIN = -46, THRESH_MAX = 18;
  const HOLD_MS = 400, SEND_MS = 40;
  let aux = null, flags = { geq: false, comp: false };
  const values = {};            // "GEQ/geq_gain_3" -> dB, "Comp/comp_in" -> 0/1 …
  const held = new Map();       // name -> hold-until (a control being moved here)
  const timers = new Map();
  const controls = new Map();   // name -> update(value)

  const fmtFreq = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 || f % 1000 === 0 ? 0 : 1)}k` : `${f}`);
  const fmtDb = (v) => `${v > 0 ? '+' : ''}${(v || 0).toFixed(1)} dB`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  // ── Sending (throttled while dragging, the final value always) ──
  function set(name, value, final) {
    values[name] = value;
    held.set(name, Date.now() + HOLD_MS);
    clearTimeout(timers.get(name));
    const go = () => { timers.delete(name); if (aux !== null && typeof sendOSC === 'function') sendOSC(`/Aux_Outputs/${aux}/${name}`, [values[name]]); };
    if (final) go(); else timers.set(name, setTimeout(go, SEND_MS));
  }
  function onValue(name, value) {
    if ((held.get(name) || 0) > Date.now()) return; // still being moved here
    values[name] = value;
    controls.get(name)?.(value);
  }

  // ── Menu items ──
  function menuItem(id, icon, label) {
    const b = el('button', 'menu-item');
    b.id = id; b.style.display = 'none';
    b.append(el('span', 'menu-item-icon menu-eq-icon', icon), el('span', 'menu-item-label', label), el('span', 'menu-item-arrow', '›'));
    return b;
  }
  const geqItem = menuItem('menuGeqItem', 'GEQ', 'Graphic EQ');
  const compItem = menuItem('menuCompItem', 'CMP', 'Compressor');
  const eqItem = document.getElementById('menuEqItem');
  if (eqItem) eqItem.after(geqItem, compItem);

  // ── Panels (the EQ panel's look) ──
  function panel(id, title) {
    const p = el('div', 'eq-panel dyn-panel'); p.id = id;
    const inner = el('div', 'eq-panel-inner');
    const head = el('div', 'eq-panel-header');
    const right = el('div', 'eq-header-right');
    const inBtn = el('button', 'eq-in-toggle', 'IN'); inBtn.type = 'button';
    const close = el('button', 'eq-close-btn', '✕'); close.type = 'button'; close.setAttribute('aria-label', `Close ${title}`);
    right.append(inBtn, close);
    head.append(el('span', 'eq-panel-title', title), right);
    const body = el('div', 'dyn-body');
    inner.append(head, body);
    p.append(inner);
    document.body.append(p);
    return { p, inBtn, close, body, right };
  }
  function inToggle(btn, name) {
    const update = (v) => { const on = v >= 0.5; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'IN' : 'OUT'; };
    btn.addEventListener('click', () => { const on = !(values[name] >= 0.5); set(name, on ? 1 : 0, true); update(on ? 1 : 0); });
    controls.set(name, update);
    update(values[name]);
  }

  // Graphic EQ: 28 vertical faders in a row that scrolls sideways
  const geq = panel('geqPanel', 'Graphic EQ');
  const flat = el('button', 'eq-in-toggle', 'Flat'); flat.type = 'button';
  geq.right.insertBefore(flat, geq.inBtn);
  const readout = el('div', 'dyn-readout', 'Drag a band up or down. Double-tap it for 0 dB.');
  const bands = el('div', 'geq-bands');
  geq.body.append(readout, bands);
  FREQS.forEach((f, i) => {
    const name = `GEQ/geq_gain_${i + 1}`;
    const col = el('div', 'geq-band');
    const input = el('input', 'geq-slider');
    input.type = 'range'; input.min = String(-GEQ_MAX); input.max = String(GEQ_MAX); input.step = '0.5';
    input.setAttribute('aria-label', `${fmtFreq(f)} Hz`);
    const val = el('div', 'geq-val', '0');
    const show = (v) => { readout.textContent = `${fmtFreq(f)} Hz  ${fmtDb(v)}`; };
    input.addEventListener('input', () => { const v = Number(input.value); val.textContent = v ? v.toFixed(1) : '0'; show(v); set(name, v, false); });
    input.addEventListener('change', () => set(name, Number(input.value), true));
    input.addEventListener('dblclick', () => { input.value = '0'; val.textContent = '0'; show(0); set(name, 0, true); });
    controls.set(name, (v) => { input.value = String(v); val.textContent = v ? Number(v).toFixed(1) : '0'; input.setAttribute('aria-valuetext', fmtDb(v)); });
    col.append(val, input, el('div', 'geq-freq', fmtFreq(f)));
    bands.append(col);
  });
  inToggle(geq.inBtn, 'GEQ/geq_in');
  flat.addEventListener('click', () => {
    if (!confirm('Set every band of this mix’s graphic EQ to 0 dB?')) return;
    FREQS.forEach((_, i) => { const name = `GEQ/geq_gain_${i + 1}`; set(name, 0, true); controls.get(name)?.(0); });
    readout.textContent = 'Every band is at 0 dB.';
  });

  // Compressor: its threshold (the rest is set on the console)
  const comp = panel('compPanel', 'Compressor');
  const row = el('div', 'eq-slider-row dyn-row');
  const thresh = el('input', 'eq-ctrl-slider');
  thresh.type = 'range'; thresh.min = String(THRESH_MIN); thresh.max = String(THRESH_MAX); thresh.step = '0.5';
  thresh.setAttribute('aria-label', 'Threshold');
  const tval = el('div', 'eq-slider-val', '—');
  row.append(el('div', 'eq-slider-label', 'THRESH'), thresh, tval);
  comp.body.append(row, el('p', 'dyn-note', 'Lower the threshold to compress more. Ratio, attack and release are set on the console.'));
  thresh.addEventListener('input', () => { tval.textContent = fmtDb(Number(thresh.value)); set('Comp/comp_thresh', Number(thresh.value), false); });
  thresh.addEventListener('change', () => set('Comp/comp_thresh', Number(thresh.value), true));
  controls.set('Comp/comp_thresh', (v) => { thresh.value = String(v); tval.textContent = fmtDb(Number(v)); });
  inToggle(comp.inBtn, 'Comp/comp_in');

  // ── Opening and closing ──
  function open(kind) {
    if (aux === null) return;
    document.body.classList.add(kind === 'geq' ? 'geqOpen' : 'compOpen');
    if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'request-aux-dyn', aux }));
  }
  function close() { document.body.classList.remove('geqOpen', 'compOpen'); }
  geqItem.addEventListener('click', () => { if (typeof closeMenu === 'function') closeMenu(); open('geq'); });
  compItem.addEventListener('click', () => { if (typeof closeMenu === 'function') closeMenu(); open('comp'); });
  geq.close.addEventListener('click', close);
  comp.close.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  globalThis.mixProcessing = {
    // The mix picked (mixer.js applyAux): which of the two it has
    setAux(auxChannel, opt) {
      if (auxChannel !== aux) { for (const k of Object.keys(values)) delete values[k]; for (const [name, update] of controls) update(name.endsWith('_in') ? 0 : 0); }
      aux = auxChannel;
      flags = { geq: !!(opt && opt.geqEnabled), comp: !!(opt && opt.compEnabled) };
      geqItem.style.display = aux !== null && flags.geq ? '' : 'none';
      compItem.style.display = aux !== null && flags.comp ? '' : 'none';
      if (!flags.geq) document.body.classList.remove('geqOpen');
      if (!flags.comp) document.body.classList.remove('compOpen');
    },
    // A message for these panels: true when it was one
    onMessage(json) {
      if (json.type === 'aux-dyn') {
        if (String(json.aux) === String(aux)) for (const [name, v] of Object.entries(json.values || {})) onValue(name, v);
        return true;
      }
      const m = typeof json.address === 'string' && /^\/Aux_Outputs\/(\d+)\/((?:GEQ|Comp)\/[a-z_0-9]+)$/.exec(json.address);
      if (!m) return false;
      if (Number(m[1]) === aux && Array.isArray(json.args)) onValue(m[2], json.args[0]);
      return true;
    },
  };
})();
