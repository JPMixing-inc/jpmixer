'use strict';

// The Patch page. Each stage box is drawn as its panel of sockets (boxes.js);
// tap or click a socket to name it and choose the console channel, control
// group or mix it's patched to. Everything is saved in the Patch plugin
// (../index.js) through JPMixer, so every screen shows the same patch, and
// shown again every few seconds in case another screen changed it.
// This page runs sandboxed: no cookies or browser storage, and it only talks
// to its own plugin (POST /plugin-api/patch/<name>).

(() => {
  const L = window.PATCH_LIBRARY;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.filter((x) => x !== null && x !== undefined));
    return n;
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  // ── Talking to the plugin ──
  // Each call carries the page's token, which JPMixer put in its <head>
  const TOKEN = (document.querySelector('meta[name="jpmixer-token"]') || {}).content || '';
  async function call(name, body) {
    const res = await fetch(`/plugin-api/patch/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JPMixer-Token': TOKEN }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'JPMixer didn’t answer. Is it running?');
    return data.result;
  }

  let state = { rev: 0, boxes: [], locked: false, console: null };
  let view = 'all';           // 'all' | a box id | 'sheet'
  let selected = null;         // { box, key }
  let sheetOrder = 'box';      // 'box' | 'console'
  let sheetAll = false;        // the sheet shows every socket, or only patched or named ones
  // Changes waiting to go to the plugin, each on its own (see flush)
  let queue = [], inFlight = false, flushTimer = null;

  // ── The console's channels, control groups and mixes ──
  const CONSOLE_NAMES = { digico: 'DiGiCo', dlive: 'dLive', klang: 'KLANG', wing: 'WING', lv1: 'Waves LV1' };
  const groupWord = () => (state.console && state.console.type === 'digico' ? 'CG' : 'DCA');
  function sourceList(kind) {
    const c = state.console || {};
    return kind === 'ch' ? c.channels || [] : kind === 'cg' ? c.groups || [] : c.mixes || [];
  }
  function sourceName(src) {
    if (!src) return '';
    const item = sourceList(src.kind).find((x) => x.number === src.n);
    const prefix = src.kind === 'ch' ? 'Ch' : src.kind === 'cg' ? groupWord() : 'Aux';
    // "CG 1 · CG 1": a console's default name adds nothing
    const named = item && item.name && !/^(cg|dca|aux|ch|channel)\s*\d+$/i.test(item.name.trim());
    return `${prefix} ${src.n}${named ? ` · ${item.name}` : ''}`;
  }
  const consoleItemName = (src) => { const item = src && sourceList(src.kind).find((x) => x.number === src.n); return item && item.name && !/^(cg|dca|aux|ch|channel)\s*\d+$/i.test(item.name.trim()) ? item.name : ''; };

  // ── 48V phantom power ──
  // A mic input can be marked as needing 48V, and a DiGiCo says whether each
  // channel has 48V on. What the desk says wins while JPMixer can hear it.
  const canPhantom = (p) => p.kind === 'in' && !p.pair && (p.connector === 'xlr-f' || p.connector === 'combo');
  function deskPhantom(src) {
    const c = state.console;
    if (!c || !(c.connected || c.demo) || !src || src.kind !== 'ch') return undefined;
    const item = (c.channels || []).find((x) => x.number === src.n);
    return item && typeof item.phantom === 'boolean' ? item.phantom : undefined;
  }
  const hearsPhantom = () => !!(state.console && (state.console.connected || state.console.demo) && (state.console.channels || []).some((x) => typeof x.phantom === 'boolean'));
  // 'on' (on at the desk), 'marked' (marked; the desk hasn't said), 'off' (marked, but off at the desk), or ''
  function phantomState(p, data) {
    if (!canPhantom(p)) return '';
    const desk = deskPhantom(data.src);
    if (desk === true) return 'on';
    if (!data.phantom) return '';
    return desk === false ? 'off' : 'marked';
  }
  const PHANTOM_TEXT = { on: 'On at the desk', marked: 'Needs 48V', off: 'Needs 48V · off at the desk' };
  // Marks every mic input as the desk has it ("48V from the desk")
  function phantomFromDesk(boxes) {
    let changed = 0;
    // The latest copy of each box (a card's own may be older than the last load)
    for (const box of boxes.map((b) => boxById(b.id)).filter(Boolean)) for (const p of layoutOf(box).ports) {
      const data = portOf(box, p.key);
      const desk = canPhantom(p) ? deskPhantom(data.src) : undefined;
      if (desk === undefined || !!data.phantom === desk) continue;
      const next = { ...data };
      if (desk) next.phantom = true; else delete next.phantom;
      box.ports = box.ports || {};
      if (next.name || next.note || next.src || next.phantom) box.ports[p.key] = next; else delete box.ports[p.key];
      queueOp({ op: 'setPort', box: box.id, key: p.key, port: box.ports[p.key] || null });
      changed++;
    }
    render();
    if (!changed) setSave('The patch already matches the desk’s 48V');
  }

  // ── The patch ──
  const boxById = (id) => state.boxes.find((b) => b.id === id);
  // A box's drawing depends on its model and setup, not its sockets: built
  // once for each setup and kept (every redraw used to build every box's,
  // once for each box)
  const layouts = new Map();
  function layoutOf(box) {
    const key = JSON.stringify([box.model, box.cards || null, box.options || null, box.generic || null]);
    if (!layouts.has(key)) {
      if (layouts.size > 200) layouts.clear();
      layouts.set(key, L.layoutFor(box));
    }
    return layouts.get(key);
  }
  const modelOf = (box) => L.BOXES.find((m) => m.id === box.model) || L.BOXES.find((m) => m.id === 'generic');
  const boxTitle = (box) => box.name || modelOf(box).name;
  const portOf = (box, key) => (box.ports && box.ports[key]) || {};
  function allPorts() {
    const out = [];
    for (const box of state.boxes) for (const p of layoutOf(box).ports) out.push({ box, port: p, data: portOf(box, p.key) });
    return out;
  }
  // Console channels fed from more than one input socket
  function doubles() {
    const seen = new Map();
    for (const x of allPorts()) {
      if (x.port.kind !== 'in' || !x.data.src || x.data.src.kind !== 'ch') continue;
      const k = x.data.src.n;
      seen.set(k, [...(seen.get(k) || []), x]);
    }
    // A stereo channel's left and right sockets aren't a mistake
    const stereoPair = (v) => v.length === 2 && new Set(v.map((x) => x.data.src.side)).size === 2 && v.every((x) => x.data.src.side);
    return new Map([...seen].filter(([, v]) => v.length > 1 && !stereoPair(v)));
  }
  // ── Saving ──
  // Every change is sent on its own (a socket, a box added, changed or
  // removed) and the plugin applies it to the latest patch, so two screens
  // editing at once never undo each other. Typing in a socket's name is
  // sent once it pauses; choosing what it's patched to goes at once.
  function setSave(text, error) { $('saveState').textContent = text; $('saveState').classList.toggle('is-error', !!error); }
  const typingInEditor = () => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.editor, dialog') && document.activeElement.matches('input, textarea'));
  function queueOp(op, wait = 0) {
    const last = queue[queue.length - 1];
    if (last && op.op === 'setPort' && last.op === 'setPort' && last.box === op.box && last.key === op.key) queue[queue.length - 1] = op;
    else queue.push(op);
    setSave('Saving…');
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, wait);
  }
  async function flush() {
    flushTimer = null; // a change made while this one is sent goes as soon as it's back (finally, below)
    if (inFlight || !queue.length) return;
    inFlight = true;
    // At most 200 at a time (the plugin's limit); the rest go next
    const ops = queue.slice(0, 200);
    queue = queue.slice(200);
    try {
      const result = await call('change', { ops });
      state.rev = result.rev;
      // Nothing changed here since: show the saved patch, with any other screen's changes
      if (!queue.length) {
        const before = JSON.stringify(state.boxes);
        state.boxes = result.boxes || [];
        if (JSON.stringify(state.boxes) !== before) { if (typingInEditor()) redrawBoxes(); else render(); }
      }
      setSave(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } catch (e) {
      if (/locked/i.test(e.message)) { queue = []; setSave(e.message, true); inFlight = false; load(true); return; }
      queue = [...ops, ...queue];
      setSave(`${e.message} Trying again…`, true);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 4000);
    } finally {
      inFlight = false;
      if (queue.length && !flushTimer) flush();
    }
  }
  function banner(text) { $('banner').textContent = text || ''; $('banner').hidden = !text; }

  // ── Loading, and keeping up with other screens ──
  let lastConsole = '';
  async function load(first) {
    if (queue.length || inFlight) return; // a change of ours is on its way: the next load shows it
    // Someone typing here: don't redraw under them
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.editor, dialog');
    let data;
    try { data = await call('load'); }
    catch (e) { if (first) { $('main').replaceChildren(el('div', { class: 'empty' }, el('h2', { text: 'Can’t open the patch' }), el('p', { text: e.message }))); } return; }
    // A change made while this was on its way: don't put the older patch back over it
    if (queue.length || inFlight) return;
    const consoleKey = JSON.stringify(data.console);
    const fresh = first || data.rev !== state.rev || data.locked !== state.locked || consoleKey !== lastConsole;
    state = { rev: data.rev, boxes: data.boxes || [], locked: !!data.locked, console: data.console };
    lastConsole = consoleKey;
    if (view !== 'all' && view !== 'sheet' && !boxById(view)) view = 'all';
    if (selected && !boxById(selected.box)) selected = null;
    showConsole();
    banner(state.locked ? 'The patch is locked, so it can’t be changed here. Unlock it in JPMixer Settings → Integrations → Plugins → Patch.' : '');
    $('addBox').hidden = state.locked;
    $('importLv1').hidden = state.locked;
    // Someone in the editor: redraw only the drawing (the desk's 48V, other
    // screens' changes), so what they're typing stays put
    if (fresh) { if (typing) redrawBoxes(); else render(); }
  }
  function showConsole() {
    const c = state.console;
    const badge = $('console');
    if (!c) { badge.textContent = 'Console names aren’t available'; badge.classList.remove('is-on'); return; }
    const name = CONSOLE_NAMES[c.type] || c.type;
    badge.textContent = c.demo ? `${name} · demo mode` : c.connected ? `${name} · connected` : !c.running ? `${name} · server stopped` : `${name} · not connected`;
    badge.classList.toggle('is-on', !!(c.connected || c.demo));
  }

  // ── Drawing a box, to scale ──
  // Each side ("face") is an SVG in millimetres, from boxes.js. Colors are
  // values: SVG attributes don't read CSS variables.
  const COLOR = { in: '#4f9dff', out: '#f2a33a', double: '#ff453a', empty: '#5a5f68' };
  const EAR = 15.88; // a 19-inch rack's mounting ears, mm
  const METAL = '#9a9fa8', DARK = '#0b0c0e', FLANGE = '#17191d';
  const fmt = (n) => Math.round(n * 100) / 100;

  // A connector at (x, y), `s` mm wide (the flange)
  function connector(g, kind, x, y, s, ring, patched) {
    const r = s * 0.42;
    const flange = (h = s * 1.16) => g.append(svg('rect', { x: fmt(x - s / 2), y: fmt(y - h / 2), width: fmt(s), height: fmt(h), rx: fmt(s * 0.12), fill: FLANGE, stroke: '#2c2f35', 'stroke-width': 0.4 }));
    const screws = (h = s * 1.16) => { for (const [dx, dy] of [[-0.38, -0.42], [0.38, 0.42]]) g.append(svg('circle', { cx: fmt(x + dx * s), cy: fmt(y + dy * h), r: fmt(s * 0.05), fill: '#3a3e45' })); };
    const ringOf = (rad) => g.append(svg('circle', { cx: fmt(x), cy: fmt(y), r: fmt(rad), fill: 'none', stroke: ring, 'stroke-width': patched ? fmt(Math.max(0.9, s * 0.07)) : 0.5 }));
    if (kind === 'pad') {
      g.append(svg('rect', { x: fmt(x - s * 0.34), y: fmt(y - s * 0.3), width: fmt(s * 0.68), height: fmt(s * 0.6), rx: fmt(s * 0.08), fill: '#101215', stroke: ring, 'stroke-width': patched ? 1 : 0.5 }));
      return;
    }
    if (kind === 'trs' || kind === 'phones') {
      g.append(svg('circle', { cx: fmt(x), cy: fmt(y), r: fmt(s * 0.5), fill: '#1c1e22', stroke: '#3c4047', 'stroke-width': 0.5 }));
      g.append(svg('circle', { cx: fmt(x), cy: fmt(y), r: fmt(s * 0.22), fill: DARK }));
      ringOf(s * 0.5);
      return;
    }
    flange(); screws();
    g.append(svg('circle', { cx: fmt(x), cy: fmt(y), r: fmt(r), fill: DARK, stroke: '#2a2d33', 'stroke-width': 0.5 }));
    if (kind === 'xlr-m') {
      // Three gold pins, and the key at the top
      for (const [dx, dy] of [[-0.42, -0.2], [0.42, -0.2], [0, 0.44]]) g.append(svg('circle', { cx: fmt(x + dx * r), cy: fmt(y + dy * r), r: fmt(r * 0.13), fill: '#c9a24e' }));
      g.append(svg('rect', { x: fmt(x - r * 0.12), y: fmt(y - r * 0.98), width: fmt(r * 0.24), height: fmt(r * 0.24), fill: '#2a2d33' }));
    } else {
      // Three holes; a combo socket's jack in the middle; the push latch above
      for (const [dx, dy] of [[-0.42, -0.24], [0.42, -0.24], [0, 0.5]]) g.append(svg('circle', { cx: fmt(x + dx * r), cy: fmt(y + dy * r), r: fmt(r * 0.12), fill: '#26292e' }));
      if (kind === 'combo') g.append(svg('circle', { cx: fmt(x), cy: fmt(y + r * 0.05), r: fmt(r * 0.3), fill: '#16181b', stroke: '#30343a', 'stroke-width': 0.4 }));
      g.append(svg('rect', { x: fmt(x - s * 0.13), y: fmt(y - s * 0.56), width: fmt(s * 0.26), height: fmt(s * 0.11), rx: fmt(s * 0.04), fill: '#b9bdc4' }));
    }
    ringOf(r);
  }

  // The panel's other parts (power, network, displays…)
  function drawPart(root, p) {
    const add = (tag, attrs) => { const n = svg(tag, attrs); root.append(n); return n; };
    const label = (x, y, text, size = 2.4, anchor = 'middle', fill = '#aeb2b9') => { const t = add('text', { x: fmt(x), y: fmt(y), 'font-size': size, 'text-anchor': anchor, fill, 'font-family': 'Helvetica, Arial, sans-serif' }); t.textContent = text; return t; };
    switch (p.type) {
      case 'text': {
        if (p.bg) { const w = String(p.text).length * (p.size || 3) * 0.62 + 2; add('rect', { x: fmt(p.anchor === 'middle' ? p.x - w / 2 : p.x - 1), y: fmt(p.y - (p.size || 3) * 0.9), width: fmt(w), height: fmt((p.size || 3) * 1.15), fill: '#23262b' }); }
        const t = add('text', { x: fmt(p.x), y: fmt(p.y), 'font-size': p.size || 3, 'font-weight': p.weight || 400, 'text-anchor': p.anchor || 'start', fill: p.fill || '#e3e5e9', 'font-style': p.italic ? 'italic' : 'normal', 'font-family': 'Helvetica, Arial, sans-serif', 'letter-spacing': p.size > 5 ? 0.2 : 0 });
        t.textContent = p.text; return;
      }
      case 'line': add('path', { d: `M${fmt(p.x1)} ${fmt(p.y - 1.4)}V${fmt(p.y)}H${fmt(p.x2)}V${fmt(p.y - 1.4)}`, fill: 'none', stroke: '#8b9098', 'stroke-width': 0.35 }); return;
      case 'panelline': add('line', { x1: EAR, x2: L.RACK_W - EAR, y1: fmt(p.y), y2: fmt(p.y), stroke: '#0c0d0f', 'stroke-width': 0.8 }); return;
      case 'box': add('rect', { x: fmt(p.x), y: fmt(p.y), width: fmt(p.w), height: fmt(p.h), rx: 1.5, fill: p.fill || '#202328', stroke: '#33373d', 'stroke-width': 0.5 }); return;
      case 'plate': {
        add('rect', { x: fmt(p.x), y: fmt(p.y), width: fmt(p.w), height: fmt(p.h), rx: 1, fill: '#1e2125', stroke: '#363a41', 'stroke-width': 0.5 });
        const screw = (x, y) => { add('circle', { cx: fmt(x), cy: fmt(y), r: 2.3, fill: '#8d939b' }); add('line', { x1: fmt(x - 1.4), x2: fmt(x + 1.4), y1: fmt(y), y2: fmt(y), stroke: '#4b5058', 'stroke-width': 0.5 }); };
        if (p.horizontal) { screw(p.x + 6, p.y + p.h / 2); screw(p.x + p.w - 6, p.y + p.h / 2); if (p.label) label(p.x + 15, p.y + p.h / 2 + 1, p.label, 2.1, 'middle'); if (p.number) label(p.x - 2.5, p.y + p.h / 2 + 1.2, String(p.number), 3.2, 'end', '#e3e5e9'); }
        else { screw(p.x + p.w / 2, p.y + 7); if (p.label) label(p.x + p.w / 2, p.y + 18, p.label.split(' ').slice(-2).join(' '), 2.1); if (p.number) label(p.x + p.w / 2, p.y + p.h - 3, String(p.number), 3, 'middle', '#e3e5e9'); }
        if (p.slot && !p.label) label(p.x + p.w / 2, p.y + p.h / 2, 'EMPTY', 2.2, 'middle', '#6b7079');
        return;
      }
      case 'frame': add('rect', { x: fmt(p.x), y: fmt(p.y), width: fmt(p.w), height: fmt(p.h), rx: 1.5, fill: 'none', stroke: '#7d828a', 'stroke-width': 0.35 }); return;
      case 'sticker': add('rect', { x: fmt(p.x), y: fmt(p.y), width: fmt(p.w), height: fmt(p.h), rx: 0.6, fill: '#c9ccd2', opacity: 0.85 }); return;
      case 'vent': {
        if (p.holes) { for (let yy = p.y + 2; yy < p.y + p.h; yy += 3.4) for (let xx = p.x + 2; xx < p.x + p.w; xx += 3.4) add('circle', { cx: fmt(xx), cy: fmt(yy), r: 1, fill: '#0d0e10' }); return; }
        for (let xx = p.x; xx < p.x + p.w - 2; xx += 4.2) add('rect', { x: fmt(xx), y: fmt(p.y), width: 2.4, height: fmt(p.h), rx: 1, fill: '#0d0e10' });
        return;
      }
      case 'grille': { for (let yy = p.y + 3; yy < p.y + p.h; yy += 5.2) for (let xx = p.x + 3 + ((Math.round((yy - p.y) / 5.2) % 2) * 2.6); xx < p.x + p.w; xx += 5.2) add('circle', { cx: fmt(xx), cy: fmt(yy), r: 2.1, fill: '#0d0e10' }); return; }
      case 'fan': {
        const d = p.d || 70, r = d / 2;
        add('rect', { x: fmt(p.x - r), y: fmt(p.y - r), width: d, height: d, rx: 3, fill: '#141518', stroke: '#33373d', 'stroke-width': 0.5 });
        add('circle', { cx: p.x, cy: p.y, r: fmt(r * 0.92), fill: '#0d0e10' });
        for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + Math.PI / 4; add('line', { x1: p.x, y1: p.y, x2: fmt(p.x + Math.cos(a) * r * 0.92), y2: fmt(p.y + Math.sin(a) * r * 0.92), stroke: '#2a2d33', 'stroke-width': 1 }); }
        add('circle', { cx: p.x, cy: p.y, r: fmt(r * 0.22), fill: '#1d1f23' });
        return;
      }
      case 'iec': {
        add('rect', { x: fmt(p.x - 13), y: fmt(p.y - 10), width: 26, height: 20, rx: 2, fill: '#0f1012', stroke: '#3a3e45', 'stroke-width': 0.6 });
        add('path', { d: `M${fmt(p.x - 9)} ${fmt(p.y - 6)}h18v8l-4 4h-10l-4-4z`, fill: '#1c1e22', stroke: '#2c2f35', 'stroke-width': 0.4 });
        for (const dx of [-4.5, 0, 4.5]) add('rect', { x: fmt(p.x + dx - 0.8), y: fmt(p.y - (dx ? 3 : 1)), width: 1.6, height: 4, fill: '#c0c4ca' });
        if (p.label) label(p.x, p.y - 12.5, p.label, 2.6, 'middle', '#e3e5e9');
        return;
      }
      case 'switch': add('rect', { x: fmt(p.x - 6), y: fmt(p.y - 7), width: 12, height: 14, rx: 1, fill: '#0f1012', stroke: '#3a3e45', 'stroke-width': 0.5 }); add('rect', { x: fmt(p.x - 4), y: fmt(p.y - 5), width: 8, height: 10, rx: 0.8, fill: '#e5e7ea' }); label(p.x, p.y - 1, '|', 3, 'middle', '#333'); return;
      case 'bnc': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 5.6, fill: '#c4c8ce', stroke: '#7b8088', 'stroke-width': 0.5 }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 3.4, fill: '#2a2d33' }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 0.8, fill: '#e2c06a' }); if (p.label) label(p.x, p.y - 7.2, p.label, 2.2); return;
      case 'ethercon': add('rect', { x: fmt(p.x - 11), y: fmt(p.y - 13), width: 22, height: 26, rx: 2.5, fill: FLANGE, stroke: '#3a3e45', 'stroke-width': 0.5 }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 9, fill: DARK }); add('rect', { x: fmt(p.x - 5.5), y: fmt(p.y - 4), width: 11, height: 8.5, rx: 0.8, fill: '#c9ccd2' }); add('rect', { x: fmt(p.x - 3.5), y: fmt(p.y - 2.2), width: 7, height: 5, fill: '#2a2d33' }); if (p.label) label(p.x, p.y - 15.5, p.label, 2.8, 'middle', '#e3e5e9'); return;
      case 'rj45': add('rect', { x: fmt(p.x - 7), y: fmt(p.y - 6), width: 14, height: 12, rx: 0.8, fill: '#c9ccd2' }); add('rect', { x: fmt(p.x - 5), y: fmt(p.y - 4), width: 10, height: 7, fill: '#2a2d33' }); return;
      case 'usb': add('rect', { x: fmt(p.x - 5), y: fmt(p.y - 5), width: 10, height: 10, rx: 1, fill: '#c9ccd2' }); add('rect', { x: fmt(p.x - 3), y: fmt(p.y - 3), width: 6, height: 5, fill: '#2a2d33' }); label(p.x, p.y - 6.5, 'USB', 2); return;
      case 'optocon': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 12.5, fill: '#111214', stroke: '#3a3e45', 'stroke-width': 0.6 }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 8, fill: '#1e2024', stroke: '#2c2f35', 'stroke-width': 0.6 }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 2.6, fill: '#0b0c0e' }); if (p.label) label(p.x + 14, p.y + 12, p.label, 3.4, 'start', '#e3e5e9'); return;
      case 'display': add('rect', { x: fmt(p.x), y: fmt(p.y), width: fmt(p.w), height: fmt(p.h), rx: 1.2, fill: p.color || '#4462c9', stroke: '#2c2f35', 'stroke-width': 0.6 }); if (p.mark) label(p.x + p.w / 2, p.y + p.h * 0.42, p.mark, 3.6, 'middle', '#e3e5e9'); else if (p.color !== '#0d0e10') { for (let k = 0; k < 2; k++) add('rect', { x: fmt(p.x + 2), y: fmt(p.y + 3 + k * 4), width: fmt(p.w - 4), height: 1.2, fill: '#a9c1ff', opacity: 0.7 }); } return;
      case 'button': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 3.2, fill: '#c6cad0', stroke: '#7b8088', 'stroke-width': 0.4 }); return;
      case 'led': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 1.5, fill: p.color || '#2a2c30' }); if (p.label) label(p.x + 3, p.y + 1, p.label, 2.2, 'start'); return;
      case 'knob': {
        add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 6.2, fill: '#141518', stroke: '#3c4047', 'stroke-width': 0.6 });
        add('line', { x1: fmt(p.x), y1: fmt(p.y - 1), x2: fmt(p.x - 2.6), y2: fmt(p.y - 5), stroke: '#d9dce1', 'stroke-width': 0.8, 'stroke-linecap': 'round' });
        if (p.dots) for (let k = 0; k < 11; k++) { const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5; add('circle', { cx: fmt(p.x + Math.cos(a) * 9), cy: fmt(p.y + Math.sin(a) * 9), r: 0.5, fill: '#e3e5e9' }); }
        return;
      }
      case 'handle': {
        if (p.thin) { add('rect', { x: fmt(p.x - 2), y: fmt(p.y), width: 4, height: fmt(p.h), rx: 2, fill: '#24262a', stroke: '#4a4e55', 'stroke-width': 0.5 }); return; }
        if (p.side) { add('path', { d: `M${fmt(p.x - 8)} ${fmt(p.y)}h6a4 4 0 0 1 4 4v${fmt(p.h - 8)}a4 4 0 0 1 -4 4h-6`, fill: 'none', stroke: '#8f949b', 'stroke-width': 3, 'stroke-linecap': 'round' }); return; }
        add('rect', { x: fmt(p.x - 3.5), y: fmt(p.y), width: 7, height: fmt(p.h), rx: 3.5, fill: '#d3d6db', stroke: '#8f949b', 'stroke-width': 0.5 });
        return;
      }
      case 'bumper': {
        const x = p.x, w = 36, h = 30;
        add('rect', { x: fmt(x), y: fmt(p.y), width: w, height: h, rx: 6, fill: '#26282c', stroke: '#3a3d43', 'stroke-width': 0.6 });
        return;
      }
      case 'chevrons': for (let xx = p.x; xx < p.x + p.w; xx += 3.2) add('path', { d: `M${fmt(xx)} ${fmt(p.y - 1)}l1.2 1l-1.2 1`, fill: 'none', stroke: '#6b7079', 'stroke-width': 0.5 }); return;
      case 'wavesmark': add('rect', { x: fmt(p.x), y: fmt(p.y), width: 16, height: 16, rx: 1.5, fill: '#141518', stroke: '#4a4e55', 'stroke-width': 0.5 }); label(p.x + 8, p.y + 9.6, 'W', 7, 'middle', '#e3e5e9').setAttribute('font-weight', 800); label(p.x + 8, p.y + 14, 'WAVES', 2, 'middle', '#c3c7cf'); return;
      case 'xlr4': connector(root, 'xlr-m', p.x, p.y, 20, '#3a3e45', false); if (p.label) label(p.x, p.y - 13, p.label, 2.4); return;
      case 'db25': add('path', { d: `M${fmt(p.x - 20)} ${fmt(p.y - 5)}h40l-3 10h-34z`, fill: '#c9ccd2', stroke: '#7b8088', 'stroke-width': 0.4 }); for (let k = 0; k < 13; k++) add('circle', { cx: fmt(p.x - 15 + k * 2.5), cy: fmt(p.y - 2), r: 0.5, fill: '#333' }); if (p.label) label(p.x, p.y - 7, p.label, 2.2); return;
      case 'din': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 6, fill: '#c4c8ce' }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 4.4, fill: '#1c1e22' }); for (let k = 0; k < 5; k++) { const a = Math.PI + (k / 4) * Math.PI; add('circle', { cx: fmt(p.x + Math.cos(a) * 2.8), cy: fmt(p.y + Math.sin(a) * 2.8), r: 0.5, fill: '#aaa' }); } return;
      case 'jack': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: fmt(p.r || 3.4), fill: '#c4c8ce', stroke: '#7b8088', 'stroke-width': 0.4 }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: fmt((p.r || 3.4) * 0.45), fill: '#0b0c0e' }); return;
      case 'rca': add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 4.4, fill: '#d8c070' }); add('circle', { cx: fmt(p.x), cy: fmt(p.y), r: 2.6, fill: '#1c1e22' }); return;
      default:
    }
  }

  function drawFace(box, face, dbl) {
    const root = svg('svg', { viewBox: `0 0 ${face.w} ${face.h}`, 'data-face': face.id, role: 'group', 'aria-label': `${boxTitle(box)}, ${face.label.toLowerCase()}`, preserveAspectRatio: 'xMidYMid meet' });
    // The panel: a 19-inch rack's ears with their mounting slots, or a box
    if (face.rack) {
      const grad = svg('linearGradient', { id: `g-${box.id}-${face.id}`, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.append(svg('stop', { offset: '0', 'stop-color': '#2b2e33' }), svg('stop', { offset: '1', 'stop-color': '#202227' }));
      const defs = svg('defs'); defs.append(grad); root.append(defs);
      root.append(svg('rect', { x: 0, y: 0, width: face.w, height: face.h, rx: 0.8, fill: '#1c1e22' }));
      root.append(svg('rect', { x: EAR, y: 0.4, width: fmt(face.w - 2 * EAR), height: fmt(face.h - 0.8), fill: `url(#g-${box.id}-${face.id})`, stroke: '#3a3d43', 'stroke-width': 0.4 }));
      for (let u = 0; u < face.rack; u++) for (const x of [EAR / 2, face.w - EAR / 2]) for (const dy of [6.35, L.U - 6.35]) {
        root.append(svg('rect', { x: fmt(x - 3.3), y: fmt(u * L.U + dy - 2.4), width: 6.6, height: 4.8, rx: 2.4, fill: '#0b0c0e' }));
      }
    } else {
      root.append(svg('rect', { x: 0.4, y: 0.4, width: fmt(face.w - 0.8), height: fmt(face.h - 0.8), rx: face.wall ? 4 : 10, fill: '#25282d', stroke: '#3a3d43', 'stroke-width': 0.6 }));
    }
    for (const p of face.parts || []) drawPart(root, p);
    // Sockets packed close together have their number above, not beside
    const tight = (a) => face.sockets.some((b) => b !== a && Math.abs(b.y - a.y) < a.size / 2 && Math.abs(b.x - a.x) < a.size * 1.3);
    for (const s of face.sockets) root.append(drawPort(box, s, dbl, tight(s)));
    return root;
  }

  function drawPort(box, p, dbl, tight) {
    const data = portOf(box, p.key);
    const isDouble = p.kind === 'in' && data.src && data.src.kind === 'ch' && dbl.has(data.src.n);
    const ring = isDouble ? COLOR.double : data.src ? COLOR[p.kind] : COLOR.empty;
    const g = svg('g', { class: `port${selected && selected.box === box.id && selected.key === p.key ? ' is-selected' : ''}`, tabindex: 0, role: 'button', 'data-box': box.id, 'data-key': p.key });
    g.setAttribute('aria-label', `${p.label}${data.name ? `: ${data.name}` : ''}${data.src ? `, patched to ${sourceName(data.src)}` : ', not patched'}${phantomState(p, data) ? `, 48V: ${PHANTOM_TEXT[phantomState(p, data)]}` : ''}`);
    const s = p.size;
    // The selection halo, and a hit area the size of the flange
    g.append(svg('rect', { class: 'halo', x: fmt(p.x - s * 0.62), y: fmt(p.y - s * 0.7), width: fmt(s * 1.24), height: fmt(s * 1.4), rx: fmt(s * 0.2), fill: 'transparent' }));
    connector(g, p.connector, p.x, p.y, s, ring, !!data.src);
    // The number printed beside it, as on the panel
    const num = svg('text', { x: fmt(p.x + s * 0.5), y: fmt(p.y - s * 0.46), 'font-size': fmt(Math.max(2.6, s * 0.15)), fill: '#e8eaee', 'font-family': 'Helvetica, Arial, sans-serif', 'font-weight': 600 });
    num.textContent = p.printed;
    if (p.connector === 'pad') { num.setAttribute('x', fmt(p.x)); num.setAttribute('y', fmt(p.y + 1.1)); num.setAttribute('text-anchor', 'middle'); }
    else if (tight) { num.setAttribute('x', fmt(p.x)); num.setAttribute('y', fmt(p.y - s * 0.62 - 0.7)); num.setAttribute('text-anchor', 'middle'); }
    g.append(num);
    // 48V: lit when the desk has it on, outlined when only marked, yellow
    // when marked but off at the desk
    const ph = phantomState(p, data);
    if (ph) {
      const w = s * 0.32, h = s * 0.16, x0 = p.x - s * 0.47, y0 = p.y - s * 0.56;
      const color = ph === 'off' ? '#ffd60a' : '#ff3b30';
      g.append(svg('rect', { class: 'ph', x: fmt(x0), y: fmt(y0), width: fmt(w), height: fmt(h), rx: fmt(h * 0.3), fill: ph === 'on' ? color : '#0d0e10', stroke: color, 'stroke-width': fmt(Math.max(0.25, s * 0.015)) }));
      const t48 = svg('text', { x: fmt(x0 + w / 2), y: fmt(y0 + h * 0.78), 'text-anchor': 'middle', 'font-size': fmt(h * 0.82), 'font-weight': 700, fill: ph === 'on' ? '#fff' : color, 'font-family': 'Helvetica, Arial, sans-serif' });
      t48.textContent = '48V';
      g.append(t48);
    }
    // What goes there: its name, or the console's name for what it's patched to
    const what = data.name || (data.src ? consoleItemName(data.src) || sourceName(data.src).split(' · ')[0] : '');
    if (what) {
      const fs = Math.max(2.4, Math.min(3.4, s * 0.16));
      const maxChars = Math.max(4, Math.floor((s * 1.3) / (fs * 0.56)));
      const text = what.length > maxChars ? what.slice(0, maxChars - 1) + '…' : what;
      const w = Math.min(s * 1.34, text.length * fs * 0.58 + 2);
      const y = p.screen ? p.y - s * 0.95 : p.y + s * 0.5;
      g.append(svg('rect', { x: fmt(p.x - w / 2), y: fmt(y - fs * 0.85), width: fmt(w), height: fmt(fs * 1.3), rx: fmt(fs * 0.3), fill: p.screen ? '#3fa46a' : '#0d0e10', opacity: p.screen ? 0.9 : 0.86, stroke: ring, 'stroke-width': 0.3 }));
      const t = svg('text', { x: fmt(p.x), y: fmt(y + fs * 0.25), 'text-anchor': 'middle', 'font-size': fmt(fs), fill: '#f3f4f6', 'font-family': 'Helvetica, Arial, sans-serif' });
      t.textContent = text;
      g.append(t);
    }
    // Mouse: details on hover. Touch and keyboard: select.
    g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(e, box, p); });
    g.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') moveTip(e); });
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('click', () => select(box.id, p.key));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(box.id, p.key); } });
    return g;
  }

  // ── Zooming and moving around a face ──
  // Pinch, ctrl/⌘-scroll or double-click to zoom; drag to move while zoomed;
  // the buttons zoom in and out, Fit shows the whole face, Expand fills the
  // window. Each face remembers where it was through redraws.
  const views = new Map(); // "box:face" -> { z, x, y }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function viewer(box, face, dbl) {
    const key = `${box.id}:${face.id}`;
    const st = views.get(key) || { z: 1, x: 0, y: 0 };
    views.set(key, st);
    const svgEl = drawFace(box, face, dbl);
    const area = el('div', { class: 'viewer' });
    area.append(svgEl);
    const apply = () => {
      const vw = face.w / st.z, vh = face.h / st.z;
      st.x = clamp(st.x, 0, face.w - vw); st.y = clamp(st.y, 0, face.h - vh);
      svgEl.setAttribute('viewBox', `${fmt(st.x)} ${fmt(st.y)} ${fmt(vw)} ${fmt(vh)}`);
      area.classList.toggle('zoomed', st.z > 1.01);
      zoomLabel.textContent = `${Math.round(st.z * 100)}%`;
    };
    const zoomAt = (factor, cx, cy) => {
      const r = svgEl.getBoundingClientRect();
      const scale = Math.min(r.width / (face.w / st.z), r.height / (face.h / st.z));
      const ox = (r.width - (face.w / st.z) * scale) / 2, oy = (r.height - (face.h / st.z) * scale) / 2;
      const fx = cx === undefined ? 0.5 : clamp((cx - r.left - ox) / ((face.w / st.z) * scale), 0, 1);
      const fy = cy === undefined ? 0.5 : clamp((cy - r.top - oy) / ((face.h / st.z) * scale), 0, 1);
      const mx = st.x + fx * (face.w / st.z), my = st.y + fy * (face.h / st.z);
      st.z = clamp(st.z * factor, 1, 10);
      st.x = mx - fx * (face.w / st.z); st.y = my - fy * (face.h / st.z);
      apply();
    };
    const mmPerPx = () => { const r = svgEl.getBoundingClientRect(); return Math.max((face.w / st.z) / r.width, (face.h / st.z) / r.height); };
    area.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoomAt(Math.exp(-clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -50, 50) * 0.01), e.clientX, e.clientY); }, { passive: false }); // a trackpad pinch in small steps, a mouse wheel's notch at most 1.65×
    area.addEventListener('dblclick', (e) => { e.preventDefault(); zoomAt(2, e.clientX, e.clientY); });
    const pointers = new Map();
    let moved = 0, pinch = null, suppress = false;
    area.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
    });
    area.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const now = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, now);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch.d = d; moved += 10;
        return;
      }
      if (st.z <= 1.01 || !(e.buttons || e.pointerType !== 'mouse')) return;
      const dx = now.x - last.x, dy = now.y - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 6) return;
      const k = mmPerPx();
      st.x -= dx * k; st.y -= dy * k;
      apply();
    });
    const end = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (moved >= 6) suppress = true; };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    // A drag isn't a tap on the socket it ended on
    area.addEventListener('click', (e) => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);
    const zoomLabel = el('span', { class: 'zoom-level' });
    const tools = el('div', { class: 'viewer-tools' },
      el('button', { type: 'button', class: 'btn small', 'aria-label': 'Zoom out', text: '−', onclick: () => zoomAt(1 / 1.6) }),
      zoomLabel,
      el('button', { type: 'button', class: 'btn small', 'aria-label': 'Zoom in', text: '+', onclick: () => zoomAt(1.6) }),
      el('button', { type: 'button', class: 'btn small', text: 'Fit', onclick: () => { st.z = 1; apply(); } }),
      el('button', { type: 'button', class: 'btn small', text: expanded && expanded.key === key ? 'Close' : 'Expand', onclick: () => { expanded = expanded && expanded.key === key ? null : { box: box.id, face: face.id, key }; render(); } }));
    const size = face.rack ? `19-inch rack, ${face.rack}U (${Math.round(face.h)} mm tall)` : `${Math.round(face.w)} × ${Math.round(face.h)} mm`;
    const wrapEl = el('div', { class: 'face' },
      el('div', { class: 'face-head' }, el('span', { class: 'face-label', text: face.label }), el('span', { class: 'face-size', text: `${size}${face.note ? ` · ${face.note}` : ''}` }), tools),
      area);
    apply();
    return wrapEl;
  }
  let expanded = null; // { box, face, key } while a face fills the window

  // ── Hover details ──
  function showTip(e, box, p) {
    const data = portOf(box, p.key);
    const tip = $('tip');
    tip.replaceChildren(...[
      el('b', { text: `${p.label}${data.name ? ` · ${data.name}` : ''}` }),
      el('span', { class: 'src', text: data.src ? sourceName(data.src) : 'Not patched' }),
      phantomState(p, data) ? el('div', { class: `ph-${phantomState(p, data)}`, text: `48V · ${PHANTOM_TEXT[phantomState(p, data)]}` }) : null,
      data.note ? el('div', { text: data.note }) : null,
    ].filter(Boolean));
    tip.hidden = false;
    moveTip(e);
  }
  function moveTip(e) {
    const tip = $('tip');
    const x = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14);
    const y = Math.min(window.innerHeight - tip.offsetHeight - 10, e.clientY + 16);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  function hideTip() { $('tip').hidden = true; }

  // ── Choosing a socket, and the editor ──
  function select(boxId, key) {
    hideTip();
    selected = { box: boxId, key };
    if (view === 'all' || view === 'sheet') view = boxId;
    if (expanded && expanded.box !== boxId) expanded = null;
    render();
    const first = document.querySelector('.editor input');
    if (first && window.innerWidth > 900) first.focus({ preventScroll: true });
    else document.querySelector('.editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function portsInOrder(box) { return layoutOf(box).ports.map((p) => ({ p })); }

  function editor() {
    const panel = el('aside', { class: 'editor', 'aria-label': 'Socket' });
    const box = selected && boxById(selected.box);
    // The box as it is now: a refresh while the editor is open replaces it
    const current = () => boxById(box.id) || box;
    const list = box ? portsInOrder(box) : [];
    const at = box ? list.findIndex((x) => x.p.key === selected.key) : -1;
    if (at < 0) {
      panel.append(el('p', { class: 'editor-empty', text: state.locked ? 'Tap a socket to see what’s patched to it.' : 'Tap a socket to name it and choose what it’s patched to. With a mouse, hover over one to see it.' }));
      return panel;
    }
    const { p } = list[at];
    const data = { ...portOf(box, p.key) };
    panel.append(el('h3', { text: p.label }), el('p', { class: 'where', text: `${boxTitle(box)} · ${p.faceLabel} · ${p.where}${p.pair ? ' · a pair of channels' : ''}` }));

    const name = el('input', { value: data.name || '', maxlength: 40, placeholder: p.kind === 'in' ? 'Kick In' : 'Wedge 1', autocomplete: 'off', disabled: state.locked });
    const source = el('select', { disabled: state.locked });
    source.add(new Option('Not patched', ''));
    const kinds = p.kind === 'in' ? ['ch', 'cg', 'mix'] : ['mix', 'cg', 'ch'];
    const titles = { ch: 'Input channels', cg: state.console && state.console.type === 'digico' ? 'Control groups' : 'Control groups (DCAs)', mix: 'Aux mixes' };
    for (const kind of kinds) {
      const items = [...sourceList(kind)];
      // A saved patch to something the console doesn't list right now stays choosable
      if (data.src && data.src.kind === kind && !items.some((x) => x.number === data.src.n)) items.push({ number: data.src.n, name: '' });
      if (!items.length) continue;
      const og = el('optgroup', { label: titles[kind] });
      for (const it of items.sort((a, b) => a.number - b.number)) og.append(new Option(sourceName({ kind, n: it.number }), `${kind}:${it.number}`));
      source.append(og);
    }
    source.value = data.src ? `${data.src.kind}:${data.src.n}` : '';
    const note = el('input', { value: data.note || '', maxlength: 120, placeholder: p.kind === 'in' ? 'SM91, phantom on' : 'Bass player’s wedge', autocomplete: 'off', disabled: state.locked });

    const update = (patch, wait) => {
      const box = current();
      box.ports = box.ports || {};
      const next = { ...portOf(box, p.key), ...patch };
      if (!next.src) delete next.src;
      if (!next.phantom) delete next.phantom;
      const keep = !!(next.name || next.note || next.src || next.phantom);
      if (keep) box.ports[p.key] = next; else delete box.ports[p.key];
      queueOp({ op: 'setPort', box: box.id, key: p.key, port: keep ? next : null }, wait);
      redrawBoxes();
    };
    name.addEventListener('input', () => update({ name: name.value }, 400));
    note.addEventListener('input', () => update({ note: note.value }, 400));
    source.addEventListener('change', () => {
      const [kind, n] = source.value ? source.value.split(':') : [];
      const src = kind ? { kind, n: Number(n) } : null;
      // The same channel or mix again keeps its side (left or right of a stereo one)
      const before = portOf(current(), p.key);
      const was = before.src;
      if (src && was && was.kind === src.kind && was.n === src.n && was.side) src.side = was.side;
      // A blank name, or one that was the console's, follows the console's name
      const wasAuto = !name.value || (before.src && name.value === consoleItemName(before.src));
      const patch = { src };
      if (src && wasAuto && consoleItemName(src)) { name.value = consoleItemName(src); patch.name = name.value; }
      // A channel with 48V on at the desk: this socket needs it
      if (canPhantom(p) && deskPhantom(src) === true) patch.phantom = true;
      update(patch);
      render();
    });
    panel.append(el('label', {}, 'Name', name), el('label', {}, 'Patched to', source));
    if (canPhantom(p)) {
      const ph = el('input', { type: 'checkbox', disabled: state.locked });
      ph.checked = !!data.phantom;
      ph.addEventListener('change', () => { update({ phantom: ph.checked }); render(); });
      panel.append(el('label', { class: 'check' }, ph, el('span', { text: 'Needs 48V phantom power' })));
      const desk = deskPhantom(data.src);
      const ch = data.src && data.src.kind === 'ch' ? sourceName(data.src).split(' · ')[0] : '';
      const c = state.console;
      if (desk === true) panel.append(el('p', { class: 'hint ph-on', text: `48V is on at the desk for ${ch}.` }));
      else if (desk === false) panel.append(el('p', { class: data.phantom ? 'warn' : 'hint', text: data.phantom ? `Marked as needing 48V, but ${ch} has 48V off at the desk.` : `48V is off at the desk for ${ch}.` }));
      else if (ch && c && c.type === 'digico' && (c.connected || c.demo)) panel.append(el('p', { class: 'hint', text: `JPMixer hasn’t heard ${ch}’s 48V from the desk yet.` }));
      else if (ch && c && c.type === 'lv1' && c.connected) panel.append(el('p', { class: 'hint', text: `LV1 hasn’t reported 48V for ${ch}. Its input may not be a preamp.` }));
      else if (ch && c && c.type !== 'digico' && c.type !== 'lv1') panel.append(el('p', { class: 'hint', text: `${CONSOLE_NAMES[c.type] || 'This console'} doesn’t tell JPMixer about 48V, so mark it here.` }));
    }
    panel.append(el('label', {}, 'Note', note));
    if (!state.console || !(state.console.channels || []).length) panel.append(el('p', { class: 'hint', text: 'The console’s channel and mix names show here once JPMixer’s server is running.' }));
    const dbl = doubles();
    if (p.kind === 'in' && data.src && data.src.kind === 'ch' && dbl.has(data.src.n)) {
      const others = dbl.get(data.src.n).filter((x) => !(x.box === box && x.port.key === p.key)).map((x) => `${boxTitle(x.box)} ${x.port.label}`);
      panel.append(el('p', { class: 'warn', text: `${sourceName(data.src)} is also patched from ${others.join(', ')}.` }));
    }
    const prev = el('button', { type: 'button', class: 'btn small', text: '‹ Previous', disabled: at === 0, onclick: () => select(box.id, list[at - 1].p.key) });
    const next = el('button', { type: 'button', class: 'btn small', text: 'Next ›', disabled: at === list.length - 1, onclick: () => select(box.id, list[at + 1].p.key) });
    panel.append(el('div', { class: 'row' }, prev, next));
    if (!state.locked) panel.append(el('button', { type: 'button', class: 'btn small danger', text: 'Clear this socket', onclick: () => { delete ((boxById(box.id) || box).ports || {})[p.key]; queueOp({ op: 'setPort', box: box.id, key: p.key, port: null }); render(); } }));
    // Enter in the name moves on to the next socket, for going down the patch quickly
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && at < list.length - 1) { e.preventDefault(); select(box.id, list[at + 1].p.key); } });
    return panel;
  }

  // ── Views ──
  function renderTabs() {
    const tabs = $('tabs');
    const tab = (id, text, count) => el('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(view === id), onclick: () => { view = id; if (id !== selected?.box) selected = null; render(); } }, text, count !== undefined ? el('span', { class: 'count', text: count }) : null);
    const kids = [];
    if (state.boxes.length) {
      kids.push(tab('all', 'All boxes'));
      const every = allPorts();
      for (const b of state.boxes) { const ps = every.filter((x) => x.box === b); kids.push(tab(b.id, boxTitle(b), `${ps.filter((x) => x.data.src).length}/${ps.length}`)); }
      kids.push(tab('sheet', 'Patch sheet'));
    }
    tabs.replaceChildren(...kids);
  }
  function boxCard(box) {
    const ps = layoutOf(box).ports.map((port) => ({ box, port, data: portOf(box, port.key) }));
    const tools = state.locked ? null : el('div', { class: 'tools' },
      hearsPhantom() && ps.some((x) => canPhantom(x.port) && x.data.src && x.data.src.kind === 'ch') ? el('button', { type: 'button', class: 'btn small', text: '48V from the desk', title: 'Mark each mic input’s 48V as the desk has it now', onclick: () => phantomFromDesk([box]) }) : null,
      el('button', { type: 'button', class: 'btn small', text: 'Edit', onclick: () => openDialog(box) }),
      el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: () => removeBox(box) }));
    const card = el('section', { class: 'box', 'data-box': box.id },
      el('div', { class: 'box-head' },
        el('div', {}, el('h2', { text: boxTitle(box) }), el('p', { class: 'meta', text: `${modelOf(box).maker ? modelOf(box).maker + ' ' : ''}${modelOf(box).name}${box.location ? ` · ${box.location}` : ''} · ${ps.filter((x) => x.data.src).length} of ${ps.length} patched` })),
        tools),
      el('div', { class: 'drawing' }), // the faces (redrawBoxes)
      el('p', { class: 'legend' },
        el('span', {}, el('i', { style: 'border-color: var(--in)' }), 'Input patched'),
        el('span', {}, el('i', { style: 'border-color: var(--out)' }), 'Output patched'),
        el('span', {}, el('i', { style: 'border-color: #4a4f58' }), 'Not patched'),
        el('span', {}, el('i', { style: 'border-color: var(--double)' }), 'Channel patched twice'),
        ...['on', 'marked', 'off'].filter((k) => ps.some((x) => phantomState(x.port, x.data) === k))
          .map((k) => el('span', {}, el('b', { class: `ph ph-${k}`, text: '48V' }), k === 'on' ? '48V on at the desk' : k === 'marked' ? 'Needs 48V' : 'Needs 48V, off at the desk'))));
    return card;
  }
  function redrawBoxes() {
    const dbl = doubles();
    for (const holder of document.querySelectorAll('.box[data-box]')) {
      const box = boxById(holder.dataset.box);
      const area = holder.querySelector('.drawing');
      if (!box || !area) continue;
      const faces = layoutOf(box).faces.filter((f) => !holder.dataset.face || f.id === holder.dataset.face);
      area.replaceChildren(...faces.map((f) => viewer(box, f, dbl)));
      // Every box at the same scale: a 2U box is half as tall as a 4U one,
      // and a floor box narrower than a 19-inch rack
      for (const v of area.querySelectorAll('.face')) {
        const face = faces.find((f) => f.id === v.querySelector('svg').dataset.face);
        if (face && !holder.dataset.face) v.style.maxWidth = `${(face.w / L.RACK_W) * 100}%`;
      }
    }
  }
  function render() {
    hideTip(); // the socket under it may be gone
    renderTabs();
    const main = $('main');
    if (!state.boxes.length) {
      main.replaceChildren(el('div', { class: 'empty' },
        el('h2', { text: 'No stage boxes yet' }),
        el('p', { text: state.locked ? 'The patch is locked.' : 'Add the stage boxes on your stage, then tap each socket to name it and choose what it’s patched to.' }),
        state.locked ? null : el('button', { type: 'button', class: 'btn primary', text: 'Add stage box', onclick: () => openDialog(null) })));
      return;
    }
    if (view === 'sheet') { main.replaceChildren(sheet()); return; }
    document.body.classList.toggle('is-expanded', !!(expanded && boxById(expanded.box)));
    if (expanded && boxById(expanded.box)) {
      // One face filling the window, with the socket editor beside it
      const card = boxCard(boxById(expanded.box));
      card.dataset.face = expanded.face;
      main.replaceChildren(el('div', { class: `layout expanded${state.locked ? ' locked' : ''}` }, el('div', { class: 'boxes' }, card), editor()));
      redrawBoxes();
      return;
    }
    const shown = view === 'all' ? state.boxes : [boxById(view)].filter(Boolean);
    const wrap = el('div', { class: `layout${view === 'all' ? ' no-editor' : ''}${state.locked ? ' locked' : ''}` }, el('div', { class: 'boxes' }, ...shown.map(boxCard)));
    if (view !== 'all') wrap.append(editor());
    main.replaceChildren(wrap);
    redrawBoxes();
  }

  // ── Patch sheet ──
  function sheet() {
    const dbl = doubles();
    const rows = allPorts();
    const tools = el('div', { class: 'sheet-tools' },
      el('label', {}, 'Order', (() => {
        const s = el('select', { onchange: (e) => { sheetOrder = e.target.value; render(); } });
        s.add(new Option('By stage box', 'box')); s.add(new Option('By console channel', 'console'));
        s.value = sheetOrder; return s;
      })()),
      el('label', {}, 'Show', (() => {
        const s = el('select', { onchange: (e) => { sheetAll = e.target.value === 'all'; render(); } });
        s.add(new Option('Patched or named sockets', 'used')); s.add(new Option('All sockets', 'all'));
        s.value = sheetAll ? 'all' : 'used'; return s;
      })()),
      hearsPhantom() && !state.locked ? el('button', { type: 'button', class: 'btn small', text: '48V from the desk', title: 'Mark each mic input’s 48V as the desk has it now', onclick: () => phantomFromDesk(state.boxes) }) : null,
      el('button', { type: 'button', class: 'btn small', text: 'Print', onclick: () => window.print() }),
      el('button', { type: 'button', class: 'btn small', text: 'Download CSV', onclick: () => downloadCsv(rows) }));
    const table = el('table', { class: 'sheet' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Socket' }), el('th', { text: 'Name' }), el('th', { text: 'Patched to' }), el('th', { text: '48V' }), el('th', { text: 'Note' }))));
    const body = el('tbody');
    const line = (x, showBox) => {
      const isDouble = x.port.kind === 'in' && x.data.src && x.data.src.kind === 'ch' && dbl.has(x.data.src.n);
      return el('tr', { class: isDouble ? 'double' : '', onclick: () => select(x.box.id, x.port.key), style: 'cursor:pointer' },
        el('td', { text: `${showBox ? boxTitle(x.box) + ' · ' : ''}${x.port.label}` }),
        el('td', { text: x.data.name || '' }),
        el('td', { class: `src ${x.port.kind}`, text: x.data.src ? sourceName(x.data.src) + (isDouble ? ' (twice)' : '') : '—' }),
        el('td', { class: phantomState(x.port, x.data) ? `ph-${phantomState(x.port, x.data)}` : '', text: phantomState(x.port, x.data) ? PHANTOM_TEXT[phantomState(x.port, x.data)] : '' }),
        el('td', { class: 'muted', text: x.data.note || '' }));
    };
    const used = (x) => sheetAll || x.data.src || x.data.name || x.data.note || x.data.phantom;
    if (sheetOrder === 'box') {
      for (const box of state.boxes) {
        const own = rows.filter((r) => r.box === box);
        const shown = own.filter(used);
        body.append(el('tr', { class: 'group' }, el('td', { colspan: 5, text: `${boxTitle(box)} · ${modelOf(box).name}${box.location ? ` · ${box.location}` : ''}${sheetAll ? '' : ` · ${shown.length} of ${own.length} sockets`}` })));
        for (const x of shown) body.append(line(x, false));
        if (!shown.length) body.append(el('tr', {}, el('td', { colspan: 5, class: 'muted', text: 'Nothing patched yet.' })));
      }
    } else {
      const order = { ch: 0, cg: 1, mix: 2 };
      const patched = rows.filter((x) => x.data.src).sort((a, b) => order[a.data.src.kind] - order[b.data.src.kind] || a.data.src.n - b.data.src.n);
      for (const x of patched) body.append(line(x, true));
      const loose = rows.filter((x) => !x.data.src && (x.data.name || x.data.note || x.data.phantom));
      if (loose.length) { body.append(el('tr', { class: 'group' }, el('td', { colspan: 5, text: 'Named, not patched' }))); for (const x of loose) body.append(line(x, true)); }
    }
    table.append(body);
    return el('div', {}, tools, table);
  }
  function downloadCsv(rows) {
    // A value starting = + - @ (or a tab or return) would run as a formula in
    // a spreadsheet: a ' in front keeps it text
    const q = (v) => { const t = String(v || ''); return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const lines = [['Stage box', 'Model', 'Location', 'Socket', 'Name', 'Patched to', '48V', 'Note'].map(q).join(',')];
    for (const x of rows) lines.push([boxTitle(x.box), modelOf(x.box).name, x.box.location, x.port.label, x.data.name, x.data.src ? sourceName(x.data.src) : '', PHANTOM_TEXT[phantomState(x.port, x.data)] || '', x.data.note].map(q).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    const a = el('a', { href: url, download: 'patch.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── Adding and editing a stage box ──
  let editing = null; // the box being edited, or null when adding
  function fillModels() {
    const select = $('boxModel');
    select.textContent = '';
    const type = state.console && state.console.type;
    const families = L.FOR_CONSOLE[type] || Object.keys(L.FAMILIES);
    const rest = Object.keys(L.FAMILIES).filter((f) => !families.includes(f));
    for (const f of [...families, ...rest]) {
      const label = families.includes(f) && f !== 'any' && type ? `${L.FAMILIES[f]} (for your ${CONSOLE_NAMES[type] || type})` : L.FAMILIES[f];
      const og = el('optgroup', { label });
      for (const m of L.BOXES.filter((b) => b.family === f)) og.append(new Option(`${m.maker ? m.maker + ' ' : ''}${m.name}`, m.id));
      select.append(og);
    }
  }
  function fillSetup(box) {
    const model = L.BOXES.find((m) => m.id === $('boxModel').value);
    const setup = $('boxSetup');
    setup.textContent = '';
    $('boxAbout').textContent = model ? model.about : '';
    if (!model) return;
    if (model.generic) {
      const g = (box && box.generic) || { inputs: 16, outputs: 8 };
      setup.append(
        el('label', {}, 'Inputs', el('input', { type: 'number', min: 0, max: 128, value: g.inputs, 'data-generic': 'inputs' })),
        el('label', {}, 'Outputs', el('input', { type: 'number', min: 0, max: 128, value: g.outputs, 'data-generic': 'outputs' })));
    } else if (model.slots) {
      model.slots.forEach((allowed, i) => {
        const slot = i + 1;
        const s = el('select', { 'data-slot': slot });
        s.add(new Option('Empty', ''));
        for (const id of allowed) s.add(new Option(L.CARDS[id].label, id));
        s.value = box && box.model === model.id && box.cards && Object.hasOwn(box.cards, slot) ? box.cards[slot] : (model.defaultCards || {})[slot] || '';
        setup.append(el('label', {}, `Slot ${slot}`, s));
      });
    } else {
      for (const o of model.options || []) {
        const s = el('select', { 'data-option': o.key });
        for (const c of o.choices) s.add(new Option(c.label, c.value));
        s.value = (box && box.model === model.id && box.options && box.options[o.key]) || '';
        setup.append(el('label', {}, o.label, s));
      }
    }
  }
  function openDialog(box) {
    editing = box ? boxById(box.id) || box : null; // the latest copy, not the one this card was drawn from
    fillModels();
    $('boxDialogTitle').textContent = box ? `Edit ${boxTitle(box)}` : 'Add a stage box';
    $('boxSave').textContent = box ? 'Save' : 'Add';
    const type = state.console && state.console.type;
    const firstFamily = (L.FOR_CONSOLE[type] || ['digico'])[0];
    $('boxModel').value = box ? box.model : (L.BOXES.find((b) => b.family === firstFamily) || L.BOXES[0]).id;
    $('boxName').value = box ? box.name : '';
    $('boxLocation').value = box ? box.location || '' : '';
    $('boxKeepNote').hidden = !box;
    fillSetup(box);
    $('boxDialog').showModal();
  }
  $('boxModel').addEventListener('change', () => fillSetup(editing));
  $('boxCancel').addEventListener('click', () => $('boxDialog').close());
  $('addBox').addEventListener('click', () => openDialog(null));
  $('boxForm').addEventListener('submit', (e) => {
    e.preventDefault();
    // The box as it is now (another screen may have changed its sockets since the dialog opened)
    const had = editing ? boxById(editing.id) : null;
    if (editing && !had) { $('boxDialog').close(); return; } // removed on another screen
    const box = { id: had ? had.id : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, model: $('boxModel').value, name: $('boxName').value.trim(), location: $('boxLocation').value.trim() };
    const setup = $('boxSetup');
    const slots = setup.querySelectorAll('[data-slot]');
    if (slots.length) { box.cards = {}; for (const s of slots) box.cards[s.dataset.slot] = s.value; }
    const options = setup.querySelectorAll('[data-option]');
    if (options.length) { box.options = {}; for (const s of options) if (s.value) box.options[s.dataset.option] = s.value; }
    const generic = setup.querySelectorAll('[data-generic]');
    if (generic.length) { box.generic = {}; for (const i of generic) box.generic[i.dataset.generic] = Math.max(0, Math.min(128, Math.round(Number(i.value) || 0))); }
    // Names and patches on sockets that no longer exist are dropped, and on
    // ones that now mean something else (a slot's card changed: socket s3.1
    // on a mic card isn't s3.1 on an output card)
    const after = new Map(layoutOf({ ...box, ports: {} }).ports.map((p) => [p.key, p]));
    const before = had ? new Map(layoutOf(had).ports.map((p) => [p.key, p])) : new Map();
    const drop = Object.keys((had && had.ports) || {}).filter((k) => {
      const a = after.get(k), b = before.get(k);
      return !a || (b && (a.kind !== b.kind || a.where !== b.where));
    });
    const ports = { ...((had && had.ports) || {}) };
    for (const k of drop) delete ports[k];
    const saved = { ...box, ports };
    if (had) state.boxes = state.boxes.map((b) => (b.id === had.id ? saved : b));
    else state.boxes.push(saved);
    $('boxDialog').close();
    view = box.id; selected = null;
    // An edit sends the details only: the sockets stay as the plugin has them
    queueOp(had ? { op: 'setBox', box: JSON.parse(JSON.stringify(box)), drop } : { op: 'putBox', box: JSON.parse(JSON.stringify(saved)) });
    render();
  });
  function removeBox(box) {
    if (!window.confirm(`Remove ${boxTitle(box)} and everything patched on it?`)) return;
    state.boxes = state.boxes.filter((b) => b.id !== box.id);
    view = 'all'; selected = null;
    queueOp({ op: 'removeBox', box: box.id });
    render();
  }

  // ── Importing a session ──
  // A session saved on LV1 (.emo) or a DiGiCo (.ses) holds its patch: what's
  // on every socket. It's read here in the page (sqlite.js + lv1-session.js,
  // digico-session.js), and only the boxes it makes are saved. LV1 names its
  // stage boxes; a DiGiCo with a rack on Dante or MADI doesn't, so the
  // preview asks which rack is there.
  let imported = null; // { boxes, inputs, outputs, … } waiting for Import
  let digico = null;   // { session, choices } for a DiGiCo session
  let importName = '';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const picker = el('input', { type: 'file', accept: '.emo,.dat,.ses', hidden: true });
  document.body.append(picker);
  $('importLv1').addEventListener('click', () => { picker.value = ''; picker.click(); });
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    imported = null; digico = null; importName = file.name;
    try {
      if (file.size > 300 * 1024 * 1024) throw new Error('That file is too big to be a session.');
      const buffer = await file.arrayBuffer();
      const start = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
      if (start.startsWith('DiGiCo')) {
        digico = { session: window.PatchDiGiCo.read(buffer), choices: {} };
        rebuildDigico();
      } else if (start.startsWith('SQLite format 3')) {
        imported = window.PatchLV1.read(window.PatchSQLite.open(buffer));
        imported.kind = 'LV1';
      } else throw new Error('This isn’t an LV1 (.emo) or DiGiCo (.ses) session.');
      if (!imported.boxes.length) throw new Error('This session has no stage boxes or patch in it.');
    } catch (e) {
      imported = null;
      showImport(file.name, e.message || 'That file couldn’t be read.');
      return;
    }
    showImport(file.name);
  });
  function rebuildDigico() {
    const mixes = state.console && state.console.type === 'digico' ? state.console.mixes : [];
    imported = window.PatchDiGiCo.build(digico.session, digico.choices, L, mixes);
    imported.kind = 'DiGiCo';
  }
  // A DiGiCo port's rack: which model, how many, and whether its outputs are
  // the port's; and whether each playback box is drawn
  function digicoChoices() {
    const wrap = $('importChoices');
    wrap.replaceChildren();
    if (!digico) return;
    // The console itself: the one the session is from, or another
    const desk = el('select', {});
    for (const m of window.PatchDiGiCo.consoleModels(L)) desk.add(new Option(`${m.maker} ${m.name.replace(/ \(console\)$/, '')}`, m.id));
    desk.add(new Option('Generic box (its size)', 'generic'));
    desk.value = digico.choices.console || window.PatchDiGiCo.consoleFor(digico.session.console) || 'generic';
    desk.addEventListener('change', () => { digico.choices.console = desk.value; rebuildDigico(); showImport(importName); });
    const guessed = window.PatchDiGiCo.consoleModels(L).find((m) => m.id === window.PatchDiGiCo.consoleFor(digico.session.console));
    wrap.append(el('label', {}, guessed ? `The console (the session is from a ${guessed.name.replace(/ \(console\)$/, '')})` : 'The console', desk));
    for (const port of imported.ports.filter((p) => p.id !== 'local' && !p.noRack)) {
      const model = el('select', {});
      model.add(new Option('Not a rack (leave it off)', 'none'));
      model.add(new Option('A computer or playback (a box for its channels)', 'playback'));
      for (const m of window.PatchDiGiCo.rackModels(L)) model.add(new Option(m.id === 'generic' ? 'Generic (its size)' : `${m.maker} ${m.name}`, m.id));
      model.value = digico.choices[port.id] || (port.id === 'dante' ? 'digico-dq-rack' : 'generic');
      const count = el('select', {});
      count.add(new Option('As many as it takes', ''));
      for (let n = 1; n <= 6; n++) count.add(new Option(String(n), String(n)));
      count.value = digico.choices[`${port.id}Racks`] || '';
      const outs = el('input', { type: 'checkbox' });
      outs.checked = digico.choices[`${port.id}Outs`] !== false;
      const redo = () => {
        digico.choices[port.id] = model.value;
        digico.choices[`${port.id}Racks`] = count.value;
        digico.choices[`${port.id}Outs`] = outs.checked;
        rebuildDigico();
        showImport(importName);
      };
      model.addEventListener('change', redo); count.addEventListener('change', redo); outs.addEventListener('change', redo);
      wrap.append(el('label', {}, `The rack on ${port.label}`, model), el('label', {}, 'How many', count),
        el('label', { class: 'check' }, outs, el('span', { text: `${port.label} outputs are its outputs` })));
    }
    for (const p of imported.playback) {
      const draw = el('input', { type: 'checkbox' });
      draw.checked = digico.choices[`${p.id}Play`] !== false;
      draw.addEventListener('change', () => { digico.choices[`${p.id}Play`] = draw.checked; rebuildDigico(); showImport(importName); });
      wrap.append(el('label', { class: 'check' }, draw, el('span', { text: `A box for ${p.name}: ${plural(p.inputs, 'input')} from ${p.what}` })));
    }
  }
  function showImport(fileName, error) {
    $('importTitle').textContent = error || !imported ? 'Import a session' : `Import a${imported.kind === 'LV1' ? 'n' : ''} ${imported.kind} session`;
    $('importAbout').textContent = error ? fileName : `${fileName}: ${imported.devices} stage box${imported.devices === 1 ? '' : 'es'}, with ${plural(imported.inputs, 'input')} and ${plural(imported.outputs, 'output')} patched.`;
    if (error) $('importChoices').replaceChildren(); else digicoChoices();
    const left = !error && imported.left && imported.left.length ? `Not on a box: ${imported.left.slice(0, 8).join(', ')}${imported.left.length > 8 ? ` and ${imported.left.length - 8} more` : ''}.` : '';
    const elsewhere = !error && imported.others ? ` ${plural(imported.others, 'playback input')} ${imported.others === 1 ? 'isn’t' : 'aren’t'} drawn.` : '';
    $('importLeft').textContent = `${left}${elsewhere}`.trim();
    $('importList').replaceChildren(...(error ? [el('li', { class: 'import-error', text: error })] : imported.boxes.map((b) => {
      const ports = layoutOf(b).ports;
      const used = (kind) => ports.filter((p) => p.kind === kind && b.ports[p.key]).length;
      return el('li', {}, el('b', { text: b.name }),
        el('span', { text: `${b.model === 'generic' ? `Generic box (${b.generic.inputs} in, ${b.generic.outputs} out)` : modelOf(b).name} · ${plural(used('in'), 'input')}, ${plural(used('out'), 'output')}${boxById(b.id) ? ' · updates the one already here' : ''}` }));
    })));
    const others = error ? [] : state.boxes.filter((b) => !imported.boxes.some((x) => x.id === b.id));
    $('importReplaceRow').hidden = !others.length;
    $('importReplace').checked = false;
    $('importReplaceRow').querySelector('span').textContent = `Remove the other ${others.length === 1 ? 'stage box' : `${others.length} stage boxes`} on this page`;
    $('importNote').textContent = error ? 'Choose a session saved on LV1 (.emo) or a DiGiCo (.ses).'
      : `Each socket gets the channel or mix ${imported.kind} has patched to it, and its name.${imported.kind === 'DiGiCo' ? ' A DiGiCo session doesn’t say which rack is on a port, so choose it above; its mic inputs go on it by channel number.' : ''}${imported.phantom ? ` ${plural(imported.phantom, 'socket')} with 48V on in the session ${imported.phantom === 1 ? 'is' : 'are'} marked 48V.` : ''} Boxes imported before are updated; your notes and 48V marks on them are kept.`;
    $('importGo').hidden = !!error;
    $('importCancel').textContent = error ? 'Close' : 'Cancel';
    if (!$('importDialog').open) $('importDialog').showModal();
  }
  $('importCancel').addEventListener('click', () => $('importDialog').close());
  $('importForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!imported || state.locked) return;
    if ($('importReplace').checked) {
      for (const b of state.boxes.filter((x) => !imported.boxes.some((y) => y.id === x.id))) queueOp({ op: 'removeBox', box: b.id });
      state.boxes = state.boxes.filter((x) => imported.boxes.some((y) => y.id === x.id));
    }
    for (const fresh of imported.boxes) {
      const had = boxById(fresh.id);
      const box = JSON.parse(JSON.stringify(fresh));
      if (had) {
        // What LV1 doesn't know stays: where the box is, notes and 48V marks
        box.location = had.location || '';
        for (const [key, p] of Object.entries(had.ports || {})) {
          const ownNote = p.note && !/^(Also patched to|Also on this pair:|On the console as) /.test(p.note); // not one an earlier import wrote
          const keep = { ...(ownNote ? { note: p.note } : {}), ...(p.phantom ? { phantom: true } : {}) };
          if (!Object.keys(keep).length) continue;
          box.ports[key] = { ...(box.ports[key] || { name: '' }), ...keep };
        }
        state.boxes = state.boxes.map((b) => (b.id === box.id ? box : b));
      } else if (state.boxes.length < 40) {
        state.boxes.push(box);
      } else continue;
      queueOp({ op: 'putBox', box });
    }
    $('importDialog').close();
    imported = null;
    view = 'all'; selected = null; expanded = null;
    render();
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded && !document.querySelector('dialog[open]')) { expanded = null; render(); } });

  // ── Start ──
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redrawBoxes, 120); });
  load(true);
  setInterval(() => { if (!document.hidden) load(false); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
})();
