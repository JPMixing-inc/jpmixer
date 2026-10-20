'use strict';

// Console Controller → channel panel: one input channel's gain, filters, EQ
// and dynamics (DiGiCo). The controls and their ranges come from the server
// (src/server/digico-channel.js), so the page can only send what the server
// allows. Values from the desk, the iPad app or another page update it live.
(() => {
  const SECTION_NAMES = { input: 'Input', eq: 'EQ', dynamics: 'Dynamics' };
  const BAND_NAMES = { 1: 'High', 2: 'High-mid', 3: 'Low-mid', 4: 'Low' }; // an SD's band 1 is the top band
  const BAND_COLORS = { 1: '#4dabf7', 2: '#69db7c', 3: '#ffd43b', 4: '#ff8787' };
  const ECHO_HOLD_MS = 400;
  const SEND_MS = 40;

  let params = null;           // path → definition, from the server
  let values = {};             // path → value for the open channel
  let channel = null;          // open channel number
  let section = 'eq';
  let band = 2;
  const controls = new Map();  // path → { update(value) }
  const held = new Map();      // path → hold-until time while it's being moved
  const sendTimers = new Map();

  const panel = document.createElement('aside');
  panel.className = 'chp';
  panel.id = 'channelPanel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Channel processing');
  panel.innerHTML = `
    <div class="chp-head">
      <div><span class="chp-num" id="chpNum">CH</span><h2 id="chpName">Channel</h2></div>
      <button type="button" class="chp-close" id="chpClose" aria-label="Close channel panel">✕</button>
    </div>
    <nav class="chp-tabs" id="chpTabs" role="tablist"></nav>
    <p class="chp-status" id="chpStatus" role="status"></p>
    <div class="chp-body" id="chpBody"></div>`;
  const backdrop = document.createElement('div');
  backdrop.className = 'chp-backdrop';
  backdrop.hidden = true;
  document.body.append(backdrop, panel);
  const $ = (id) => document.getElementById(id);

  for (const [id, name] of Object.entries(SECTION_NAMES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.section = id;
    b.setAttribute('role', 'tab');
    b.textContent = name;
    b.addEventListener('click', () => { section = id; render(); });
    $('chpTabs').appendChild(b);
  }
  $('chpClose').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

  // ── Value formatting and slider mapping ──
  function format(def, v) {
    if (v === undefined || v === null) return '—';
    switch (def.unit) {
      case 'dB': return `${v > 0 && def.min < 0 ? '+' : ''}${v.toFixed(1)} dB`; // a + only where it can also go below zero
      case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
      case 's': return v < 1 ? `${(v * 1000).toFixed(v < 0.01 ? 1 : 0)} ms` : `${v.toFixed(2)} s`;
      case 'Q': return v.toFixed(2);
      case ':1': return `${v.toFixed(1)}:1`;
      case 'pan': { const p = Math.round((v - 0.5) * 200); return p === 0 ? 'C' : p < 0 ? `L${-p}` : `R${p}`; }
      default: return String(v);
    }
  }
  const isLog = (def) => def.scale === 'log' && def.min > 0;
  function toPos(def, v) {
    const x = Math.min(def.max, Math.max(def.min, v));
    return isLog(def) ? Math.log(x / def.min) / Math.log(def.max / def.min) : (x - def.min) / (def.max - def.min);
  }
  function fromPos(def, p) {
    return isLog(def) ? def.min * Math.pow(def.max / def.min, p) : def.min + p * (def.max - def.min);
  }

  // ── Sending ──
  function setValue(path, value, final) {
    values[path] = value;
    held.set(path, Date.now() + ECHO_HOLD_MS);
    clearTimeout(sendTimers.get(path));
    const go = () => { sendTimers.delete(path); if (window.consoleSend) window.consoleSend({ type: 'console-param', ch: channel, path, value: values[path] }); };
    if (final) go(); else sendTimers.set(path, setTimeout(go, SEND_MS));
    if (path.startsWith('EQ/') || path.startsWith('Filters/')) drawEq();
  }

  // ── Controls ──
  function toggle(path, opts = {}) {
    const def = params[path];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chp-toggle';
    b.textContent = opts.label || def.label;
    let armed = null;
    b.addEventListener('click', () => {
      const on = !(values[path] >= 0.5);
      // Phantom power asks twice: switching 48V into the wrong input can pop a PA
      if (opts.confirm && on && !armed) {
        b.textContent = 'Tap again for 48V';
        b.classList.add('armed');
        armed = setTimeout(() => { armed = null; b.classList.remove('armed'); b.textContent = opts.label || def.label; }, 3000);
        return;
      }
      clearTimeout(armed); armed = null; b.classList.remove('armed'); b.textContent = opts.label || def.label;
      setValue(path, on ? 1 : 0, true);
      update(values[path]);
    });
    function update(v) { b.setAttribute('aria-pressed', String(v >= 0.5)); b.classList.toggle('on', v >= 0.5); }
    controls.set(path, { update });
    update(values[path]);
    return b;
  }

  function slider(path, opts = {}) {
    const def = params[path];
    const row = document.createElement('label');
    row.className = 'chp-slider';
    const head = document.createElement('span');
    head.className = 'chp-slider-head';
    const name = document.createElement('span');
    name.textContent = opts.label || def.label;
    const out = document.createElement('output');
    head.append(name, out);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = '1000'; input.step = '1';
    input.setAttribute('aria-label', `${opts.label || def.label}`);
    input.addEventListener('input', () => { const v = fromPos(def, input.value / 1000); out.textContent = format(def, v); setValue(path, v, false); });
    input.addEventListener('change', () => setValue(path, fromPos(def, input.value / 1000), true));
    // Double-click the value to put it back to the middle of its range (centre pan, 0 dB EQ)
    out.addEventListener('dblclick', () => { const v = def.unit === 'pan' ? 0.5 : def.unit === 'dB' && def.min < 0 ? 0 : null; if (v !== null) { setValue(path, v, true); update(v); } });
    function update(v) {
      if (v === undefined) { out.textContent = '…'; return; }
      input.value = String(Math.round(toPos(def, v) * 1000));
      out.textContent = format(def, v);
      input.setAttribute('aria-valuetext', format(def, v));
    }
    controls.set(path, { update });
    update(values[path]);
    row.append(head, input);
    return row;
  }

  function choice(path) {
    const def = params[path];
    const wrap = document.createElement('div');
    wrap.className = 'chp-choice';
    const label = document.createElement('span');
    label.textContent = def.label;
    wrap.appendChild(label);
    const buttons = def.values.map((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = def.names[i];
      b.addEventListener('click', () => { setValue(path, v, true); update(v); });
      wrap.appendChild(b);
      return b;
    });
    function update(value) { buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(def.values[i] === value))); }
    controls.set(path, { update });
    update(values[path]);
    return wrap;
  }

  function group(title, ...children) {
    const box = document.createElement('section');
    box.className = 'chp-group';
    if (title) { const h = document.createElement('h3'); h.textContent = title; box.appendChild(h); }
    box.append(...children.filter(Boolean));
    return box;
  }
  const row = (...children) => { const r = document.createElement('div'); r.className = 'chp-row'; r.append(...children); return r; };
  const has = (path) => params && Object.hasOwn(params, path);

  // ── EQ graph ──
  const W = 360, H = 170, PL = 26, PR = 6, PT = 8, PB = 18, DBR = 18;
  const fx = (f) => PL + Math.log10(f / 20) / 3 * (W - PL - PR);
  const gy = (g) => PT + (DBR - g) / (2 * DBR) * (H - PT - PB);
  const xf = (x) => 20 * Math.pow(1000, Math.min(1, Math.max(0, (x - PL) / (W - PL - PR))));
  const yg = (y) => Math.max(-DBR, Math.min(DBR, DBR - (y - PT) / (H - PT - PB) * 2 * DBR));
  // A bell per band, close enough to show the shape (the desk does the real filtering)
  const bandAt = (f, b) => {
    const g = values[`EQ/eq_gain_${b}`] || 0, fc = values[`EQ/eq_freq_${b}`] || 1000, q = values[`EQ/eq_Q_${b}`] || 0.7;
    const oct = Math.log2(f / fc), s = 1 / (2 * q);
    return g * Math.exp(-(oct * oct) / (2 * s * s));
  };
  // The filters' slopes for the picture: a 12 dB/octave shape at the set
  // frequency (the desk does the real filtering)
  const filterAt = (f) => {
    let g = 0;
    if (values['Filters/lo_filter_in'] >= 0.5 && values['Filters/lo_filter_freq']) g += -10 * Math.log10(1 + Math.pow(values['Filters/lo_filter_freq'] / f, 4));
    if (values['Filters/hi_filter_in'] >= 0.5 && values['Filters/hi_filter_freq']) g += -10 * Math.log10(1 + Math.pow(f / values['Filters/hi_filter_freq'], 4));
    return g;
  };
  const FILTERS = { lo: 'Filters/lo_filter_freq', hi: 'Filters/hi_filter_freq' };
  let svg = null;
  function eqGraph() {
    const ns = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'chp-eq');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'EQ curve. Drag a band’s dot to change its frequency and gain.');
    svg.style.touchAction = 'none';
    let dragging = null, draggingFilter = null;
    svg.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-filter]');
      if (handle) { draggingFilter = handle.dataset.filter; svg.setPointerCapture(e.pointerId); return; }
      const dot = e.target.closest('[data-band]');
      if (!dot) return;
      dragging = Number(dot.dataset.band);
      band = dragging;
      svg.setPointerCapture(e.pointerId);
      renderBandControls();
      drawEq();
    });
    svg.addEventListener('pointermove', (e) => {
      if (draggingFilter) {
        const r = svg.getBoundingClientRect();
        const path = FILTERS[draggingFilter], def = params[path];
        setValue(path, Math.min(def.max, Math.max(def.min, xf((e.clientX - r.left) * W / r.width))), false);
        controls.get(path)?.update(values[path]);
        return;
      }
      if (dragging === null) return;
      const r = svg.getBoundingClientRect();
      const x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
      setValue(`EQ/eq_freq_${dragging}`, Math.min(params[`EQ/eq_freq_${dragging}`].max, Math.max(params[`EQ/eq_freq_${dragging}`].min, xf(x))), false);
      setValue(`EQ/eq_gain_${dragging}`, yg(y), false);
      controls.get(`EQ/eq_freq_${dragging}`)?.update(values[`EQ/eq_freq_${dragging}`]);
      controls.get(`EQ/eq_gain_${dragging}`)?.update(values[`EQ/eq_gain_${dragging}`]);
    });
    const end = () => {
      if (draggingFilter) { setValue(FILTERS[draggingFilter], values[FILTERS[draggingFilter]], true); draggingFilter = null; return; }
      if (dragging === null) return;
      setValue(`EQ/eq_freq_${dragging}`, values[`EQ/eq_freq_${dragging}`], true);
      setValue(`EQ/eq_gain_${dragging}`, values[`EQ/eq_gain_${dragging}`], true);
      dragging = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    drawEq();
    return svg;
  }
  function drawEq() {
    if (!svg || !svg.isConnected) return;
    const ns = 'http://www.w3.org/2000/svg';
    const on = values['EQ/eq_in'] >= 0.5;
    const filtersOn = values['Filters/lo_filter_in'] >= 0.5 || values['Filters/hi_filter_in'] >= 0.5;
    let html = '';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) html += `<line class="g" x1="${fx(f)}" y1="${PT}" x2="${fx(f)}" y2="${H - PB}"/><text x="${fx(f)}" y="${H - 5}">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
    for (const g of [-12, -6, 0, 6, 12]) html += `<line class="g${g === 0 ? ' z' : ''}" x1="${PL}" y1="${gy(g)}" x2="${W - PR}" y2="${gy(g)}"/><text class="db" x="${PL - 4}" y="${gy(g) + 3}">${g > 0 ? '+' + g : g}</text>`;
    let d = '';
    for (let i = 0; i <= 160; i++) {
      const f = 20 * Math.pow(1000, i / 160);
      const g = (on ? [1, 2, 3, 4].reduce((sum, b) => sum + bandAt(f, b), 0) : 0) + filterAt(f);
      d += `${i ? 'L' : 'M'}${fx(f).toFixed(1)},${gy(Math.max(-DBR, Math.min(DBR, g))).toFixed(1)}`;
    }
    html += `<path class="curve${on || filtersOn ? '' : ' off'}" d="${d}"/>`;
    // Filter handles at their frequency on the -3 dB line; drag sideways
    for (const [key, path] of Object.entries(FILTERS)) {
      const f = values[path];
      if (f === undefined || !has(path)) continue;
      const active = values[key === 'lo' ? 'Filters/lo_filter_in' : 'Filters/hi_filter_in'] >= 0.5;
      html += `<rect data-filter="${key}" class="fhandle${active ? '' : ' off'}" x="${fx(f) - 6}" y="${gy(-3) - 6}" width="12" height="12" rx="2"><title>${key === 'lo' ? 'High-pass' : 'Low-pass'}</title></rect>`;
    }
    for (const b of [4, 3, 2, 1]) {
      const f = values[`EQ/eq_freq_${b}`], g = values[`EQ/eq_gain_${b}`];
      if (f === undefined || g === undefined) continue;
      html += `<circle data-band="${b}" class="dot${b === band ? ' sel' : ''}" cx="${fx(f)}" cy="${gy(g)}" r="${b === band ? 9 : 7}" fill="${BAND_COLORS[b]}"/>`;
    }
    svg.innerHTML = html;
    void ns;
  }

  let bandBox = null;
  function renderBandControls() {
    if (!bandBox) return;
    for (const p of [...controls.keys()]) if (/_\d$/.test(p) && p.startsWith('EQ/')) controls.delete(p);
    bandBox.textContent = '';
    const picker = document.createElement('div');
    picker.className = 'chp-bands';
    for (const b of [4, 3, 2, 1]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = BAND_NAMES[b];
      btn.style.setProperty('--band', BAND_COLORS[b]);
      btn.setAttribute('aria-pressed', String(b === band));
      btn.addEventListener('click', () => { band = b; renderBandControls(); drawEq(); });
      picker.appendChild(btn);
    }
    bandBox.appendChild(picker);
    bandBox.append(slider(`EQ/eq_gain_${band}`), slider(`EQ/eq_freq_${band}`), slider(`EQ/eq_Q_${band}`));
    if (has(`EQ/dynamic_eq_on_${band}`)) {
      const dyn = values[`EQ/dynamic_eq_on_${band}`] >= 0.5;
      const t = toggle(`EQ/dynamic_eq_on_${band}`, { label: 'Dynamic EQ' });
      t.addEventListener('click', () => setTimeout(renderBandControls, 0));
      bandBox.appendChild(row(t));
      if (dyn) bandBox.append(slider(`EQ/eq_thresh_${band}`), slider(`EQ/eq_ratio_${band}`), slider(`EQ/eq_attack_${band}`), slider(`EQ/eq_release_${band}`));
    }
  }

  // ── Sections ──
  function render() {
    if (!params) return;
    controls.clear();
    svg = null; bandBox = null;
    for (const b of $('chpTabs').children) b.setAttribute('aria-selected', String(b.dataset.section === section));
    const body = $('chpBody');
    body.textContent = '';
    const s = (p, o) => has(p) ? slider(p, o) : null;
    const t = (p, o) => has(p) ? toggle(p, o) : null;
    if (section === 'input') {
      body.append(
        group('Preamp', row(t('Channel_Input/phantom', { confirm: true }), t('Channel_Input/phase')), s('Channel_Input/analog_gain'), s('Channel_Input/trim')),
        group('Pan', s('Panner/pan')),
        group('Filters', row(t('Filters/lo_filter_in')), s('Filters/lo_filter_freq', { label: 'High-pass frequency' }), row(t('Filters/hi_filter_in')), s('Filters/hi_filter_freq', { label: 'Low-pass frequency' })),
        group('Delay & inserts', row(t('Channel_Delay/delay_on'), t('Insert/insert_A_in'), t('Insert/insert_B_in')), s('Channel_Delay/delay', { label: 'Delay time' }))
      );
    } else if (section === 'eq') {
      bandBox = document.createElement('div');
      bandBox.className = 'chp-band-controls';
      body.append(
        group(null, row(t('EQ/eq_in', { label: 'EQ in' }), t('Filters/lo_filter_in'), t('Filters/hi_filter_in')), eqGraph(), bandBox),
        group('Filters', s('Filters/lo_filter_freq', { label: 'High-pass frequency' }), s('Filters/hi_filter_freq', { label: 'Low-pass frequency' }))
      );
      renderBandControls();
      drawEq(); // now that the graph is on the page
    } else {
      body.append(
        group('Compressor', row(t('Dynamics/comp_in', { label: 'Compressor in' }), t('Dynamics/comp_auto-gain_1')), s('Dynamics/comp_thresh_1'), s('Dynamics/comp_ratio_1'), s('Dynamics/comp_attack_1'), s('Dynamics/comp_release_1'), s('Dynamics/comp_gain_1'), has('Dynamics/comp_knee_1') ? choice('Dynamics/comp_knee_1') : null),
        group('Gate', row(t('Dynamics/gate_in', { label: 'Gate in' })), s('Dynamics/gate_thresh'), s('Dynamics/gate_range'), s('Dynamics/gate_attack'), s('Dynamics/gate_hold'), s('Dynamics/gate_release'))
      );
    }
    updateStatus();
  }

  function updateStatus() {
    if (!params) return;
    const inSection = Object.keys(params).filter(p => params[p].section === section);
    const missing = inSection.filter(p => values[p] === undefined).length;
    $('chpStatus').textContent = missing ? `Reading ${missing} setting${missing === 1 ? '' : 's'} from the console…` : '';
  }

  function open(ch, label) {
    channel = ch;
    values = {};
    params = null;
    $('chpNum').textContent = `CH ${String(ch).padStart(2, '0')}`;
    $('chpName').textContent = label || `Channel ${ch}`;
    $('chpBody').textContent = '';
    $('chpStatus').textContent = 'Opening…';
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('chp-open');
    window.consoleSend?.({ type: 'request-channel-detail', ch, section });
    $('chpClose').focus();
  }
  function close() {
    panel.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove('chp-open');
    channel = null;
  }

  window.channelPanel = {
    open,
    isOpenFor: (ch) => channel === ch,
    onDetail(json) {
      if (json.ch !== channel) return;
      params = json.params;
      values = { ...json.values, ...values };
      render();
    },
    // A value from the desk / iPad / another page for any channel's control
    onParam(ch, path, value) {
      if (ch !== channel || !params || !Object.hasOwn(params, path)) return;
      if ((held.get(path) || 0) > Date.now()) return; // still being moved here
      values[path] = value;
      if (path.startsWith('EQ/dynamic_eq_on_') && section === 'eq') renderBandControls();
      else controls.get(path)?.update(value);
      if (path.startsWith('EQ/') || path.startsWith('Filters/')) drawEq();
      updateStatus();
    },
  };
})();
