'use strict';

// Home page card layout (FOH Home and the ProPresenter/Lighting/Switcher
// pages, which share this; each keeps its own layout). Browser-local
// presentation only: arranging never sends console controls or changes
// server config.
//
// Cards sit on a free grid: 24 columns across the page and 10 px rows. Each
// card has its own position and size { x, y, w, h } in those units, so a card
// can go anywhere, gaps included, and nothing flows left to right. A dragged
// card leaves the others alone: held against a neighbour it rests beside it,
// and only dropped squarely onto another card do the two trade places.
// Growing a card onto others slides them down; nothing ever moves up on its
// own. On phones the cards stack in one column, top to bottom.
//
// Layouts saved before this (v1: an order plus width/height presets) are
// converted to the same arrangement they produced.
(() => {
  const role = (location.pathname.match(/\/(propresenter|lighting|switcher)\.html$/) || [])[1] || 'foh';
  const STORAGE_KEY = role === 'foh' ? 'jpm_foh_layout_v1' : `jpm_${role}_layout_v1`;
  const COLS = 24, ROW = 10, GAP_ROWS = 2;   // GAP_ROWS: the vertical space kept between cards
  const MIN_W = 4, MIN_H = 12, MAX_H = 160;
  const PHONE = 700;
  const definitions = [...document.querySelectorAll('#fhDashboard [data-fh-card]')].map(node => [node.dataset.fhCard, node.getAttribute('aria-label') || node.dataset.fhCard]);
  const ids = definitions.map(([id]) => id);
  const labels = Object.fromEntries(definitions);
  const dashboard = document.getElementById('fhDashboard');
  const status = document.getElementById('fhLayoutStatus');
  const arrange = document.getElementById('fhArrange');
  const undo = document.getElementById('fhLayoutUndo');
  const reset = document.getElementById('fhLayoutReset');
  const visibility = document.getElementById('fhCardVisibility');
  const nodes = new Map(ids.map(id => [id, dashboard.querySelector(`[data-fh-card="${id}"]`)]));
  const controls = new Map();
  const history = [];
  let editing = false;
  let gesture = null; // { kind: 'move' | 'resize', … } while dragging
  let frame = null;

  // Starting sizes (w × h in grid units) and the order cards are first placed in
  const DEFAULT_SIZE = {
    live: [8, 34], team: [8, 34], order: [8, 34], plans: [8, 40], chat: [8, 40], companion: [8, 40],
    monitor: [8, 20], devices: [8, 20], console: [8, 20],
  };
  const sizeOf = (id) => DEFAULT_SIZE[id] || [8, 30];
  const isPhone = () => innerWidth <= PHONE;
  // A card the page has turned off (Companion while it's off) takes no space
  // in a new layout; it's placed when it first appears.
  const inUse = (id) => editing || !(nodes.get(id).classList.contains('fh-companion-off') || nodes.get(id).classList.contains('fh-card-off'));

  // ── Geometry ──────────────────────────────────────────────────────────
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  function fit(card) {
    card.w = clampInt(card.w, MIN_W, COLS);
    card.h = clampInt(card.h, MIN_H, MAX_H);
    card.x = clampInt(card.x, 0, COLS - card.w);
    card.y = clampInt(card.y, 0, 5000);
    return card;
  }
  // Two cards collide when their columns overlap and they're closer than the gap
  const collide = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + GAP_ROWS && b.y < a.y + a.h + GAP_ROWS;
  // The top-most, then left-most free spot for a w × h card
  function firstFit(placed, w, h) {
    for (let y = 0; y < 5000; y += 1) {
      for (let x = 0; x + w <= COLS; x += 1) {
        const c = { x, y, w, h };
        if (!placed.some(p => collide(c, p))) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }
  // Keeps `fixedId` where it is and slides every card it now touches down,
  // cascading, until nothing overlaps. Cards only ever move down.
  function settle(cards, fixedId) {
    const visible = Object.entries(cards).filter(([, c]) => !c.hidden).map(([id, c]) => ({ id, c }));
    const placed = [];
    const fixed = visible.find(v => v.id === fixedId);
    if (fixed) placed.push(fixed.c);
    const rest = visible.filter(v => v.id !== fixedId).sort((a, b) => a.c.y - b.c.y || a.c.x - b.c.x);
    for (const { c } of rest) {
      for (let guard = 0; guard < 500; guard++) {
        const hit = placed.filter(p => collide(c, p));
        if (!hit.length) break;
        c.y = Math.max(...hit.map(p => p.y + p.h + GAP_ROWS));
      }
      placed.push(c);
    }
    return cards;
  }

  // Where a dragged card goes, from where it's held (rawX/rawY: its top-left
  // corner in grid units, unrounded). Decided against the layout as it was
  // when the drag began, never against last frame's result, so the answer
  // can't feed back on itself and flicker.
  //  - Its middle over another card: it takes that card's place, and that
  //    card moves into the spot it left (or slides down if it can't fit).
  //  - Otherwise it goes in the nearest free spot to where it's held, so a
  //    card held up against its neighbours rests beside them.
  //  - Nowhere free close by: it goes where it's held and pushes cards down.
  // `stick` is the card it was swapping with last frame: the swap holds until
  // the middle is clearly off that card, so it can't flick on its edge.
  function dragTarget(base, id, rawX, rawY, col, stick) {
    const cards = JSON.parse(JSON.stringify(base));
    const me = base[id], c = cards[id];
    const others = Object.entries(base).filter(([k, o]) => k !== id && !o.hidden);
    const midX = rawX + me.w / 2, midY = rawY + me.h / 2;
    const inside = (o, mx, my) => midX >= o.x - mx && midX < o.x + o.w + mx && midY >= o.y - my && midY < o.y + o.h + my;
    const kept = stick && others.find(([k, o]) => k === stick && inside(o, 1, GAP_ROWS * 2));
    const under = kept || others.find(([, o]) => inside(o, 0, 0));
    if (under) {
      const [uid, o] = under, u = cards[uid];
      c.x = o.x; c.y = o.y; fit(c);
      const spot = fit({ ...u, x: me.x, y: me.y });
      if (!collide(spot, c) && others.every(([k, p]) => k === uid || !collide(spot, p))) { u.x = spot.x; u.y = spot.y; }
      settle(cards, id);
      return { cards, over: uid };
    }
    const want = fit({ ...me, x: Math.round(rawX), y: Math.max(0, Math.round(rawY / GAP_ROWS) * GAP_ROWS) });
    const rx = Math.ceil(me.w / 2), ry = Math.ceil(me.h / 2);
    let best = null, bestD = Infinity;
    for (let y = Math.max(0, want.y - ry); y <= want.y + ry; y++) {
      for (let x = Math.max(0, want.x - rx); x <= Math.min(COLS - me.w, want.x + rx); x++) {
        const d = Math.hypot((x - rawX) * col, (y - rawY) * ROW);
        if (d >= bestD) continue;
        const spot = { x, y, w: me.w, h: me.h };
        if (!others.some(([, o]) => collide(spot, o))) { best = spot; bestD = d; }
      }
    }
    if (best) { c.x = best.x; c.y = best.y; return { cards, over: null }; }
    c.x = want.x; c.y = want.y;
    settle(cards, id);
    return { cards, over: null };
  }

  // ── Loading a layout (this version's, an older one, or none) ──────────
  function defaults() {
    const cards = {};
    const placed = [];
    for (const id of ids) {
      const [w, h] = sizeOf(id);
      const at = inUse(id) ? firstFit(placed, w, h) : { x: 0, y: 0 };
      cards[id] = { hidden: false, x: at.x, y: at.y, w, h, fresh: !inUse(id) };
      if (inUse(id)) placed.push(cards[id]);
    }
    return { v: 2, cards };
  }
  // A v1 layout: an order, with widths of 3/4/6/12 out of 12 and height presets,
  // flowed left to right. Rebuilt here as the same rows.
  function fromV1(value) {
    const spans = { compact: 3, standard: 4, wide: 6, full: 12 };
    const order = Array.isArray(value.order) ? value.order.filter(id => ids.includes(id)) : [];
    for (const id of ids) if (!order.includes(id)) order.push(id);
    const cards = {};
    let x = 0, y = 0, rowBottom = 0;
    for (const id of order) {
      const old = (value.cards && value.cards[id]) || {};
      // Only the sizes that version could save (3..12 of 12, 120..720 px):
      // anything else in storage is ignored, as it was then
      const span = Number.isInteger(old.span) && old.span >= 3 && old.span <= 12 ? old.span : null;
      const pixels = Number.isInteger(old.pixels) && old.pixels >= 120 && old.pixels <= 720 ? old.pixels : null;
      const w = clampInt((span || spans[old.size] || spans[id === 'companion' ? 'wide' : 'standard']) * 2, MIN_W, COLS);
      const chrome = nodes.get(id).classList.contains('fh-shortcut') ? 0 : 7; // heading and padding, in rows
      const h = pixels ? Math.round(pixels / ROW) + chrome
        : old.height === 'short' ? 18 + chrome : old.height === 'tall' ? 48 + chrome : sizeOf(id)[1];
      if (old.hidden !== true && inUse(id)) {
        if (x + w > COLS) { x = 0; y = rowBottom + GAP_ROWS; }
        cards[id] = { hidden: false, x, y, w, h };
        x += w; rowBottom = Math.max(rowBottom, y + h);
      } else {
        cards[id] = { hidden: old.hidden === true, x: 0, y: 0, w, h, fresh: true };
      }
    }
    return { v: 2, cards };
  }
  function normalize(value) {
    let layout;
    if (value && value.v === 2 && value.cards && typeof value.cards === 'object') {
      layout = { v: 2, cards: {} };
      for (const id of ids) {
        const c = value.cards[id];
        if (c && [c.x, c.y, c.w, c.h].every(Number.isFinite)) layout.cards[id] = fit({ hidden: c.hidden === true, x: c.x, y: c.y, w: c.w, h: c.h });
      }
    } else if (value && (Array.isArray(value.order) || value.cards)) {
      layout = fromV1(value);
    } else {
      layout = defaults();
    }
    // Cards this page has that the layout doesn't (a new card, or a layout
    // from another Home page) go in the first free spot. One the page has
    // switched off goes below everything, so it can't leave a hole.
    const placed = Object.values(layout.cards).filter(c => !c.fresh && !c.hidden);
    const later = [];
    for (const id of ids) {
      const c = layout.cards[id];
      if (c && !c.fresh) continue;
      if (!inUse(id)) { later.push(id); continue; }
      const [w, h] = c ? [c.w, c.h] : sizeOf(id);
      const at = firstFit(placed, w, h);
      layout.cards[id] = { hidden: c ? c.hidden : false, x: at.x, y: at.y, w, h };
      if (!layout.cards[id].hidden) placed.push(layout.cards[id]);
    }
    for (const id of later) {
      const c = layout.cards[id];
      const [w, h] = c ? [c.w, c.h] : sizeOf(id);
      const bottom = placed.reduce((m, p) => Math.max(m, p.y + p.h + GAP_ROWS), 0);
      // auto: parked while off; moved into a free spot when it turns on (see placeWhenOn)
      layout.cards[id] = { hidden: c ? c.hidden : false, x: 0, y: bottom, w, h, auto: true };
      placed.push(layout.cards[id]);
    }
    for (const c of Object.values(layout.cards)) { delete c.fresh; fit(c); }
    settle(layout.cards, null);
    return layout;
  }
  let layout = normalize(null);
  try { layout = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (_) {}

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      status.textContent = 'Layout saved in this browser.';
    } catch (_) {
      status.textContent = 'Layout changed for this session. Browser storage is unavailable.';
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  // Puts every card where the layout says. Cards that moved glide there
  // (except the one being dragged, which follows the pointer).
  function place(cards, skipId) {
    const phone = isPhone();
    const before = new Map();
    if (!phone) for (const id of ids) if (id !== skipId) before.set(id, nodes.get(id).getBoundingClientRect());
    const stack = Object.entries(cards).sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([id]) => id);
    for (const id of ids) {
      const node = nodes.get(id), c = cards[id];
      if (phone) {
        node.style.gridColumn = ''; node.style.gridRow = '';
        node.style.order = String(stack.indexOf(id));
      } else {
        node.style.order = '';
        node.style.gridColumn = `${c.x + 1} / span ${c.w}`;
        node.style.gridRow = `${c.y + 1} / span ${c.h}`;
      }
    }
    if (phone || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Each moved card glides from where it is on screen right now (mid-glide
    // included) to its new place
    for (const [id, was] of before) {
      const node = nodes.get(id);
      for (const a of node.getAnimations()) a.cancel();
      const now = node.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if ((Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) && was.width) node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }
  function apply() {
    for (const id of ids) {
      const node = nodes.get(id), card = layout.cards[id], editor = controls.get(id);
      node.hidden = card.hidden; // a hidden card takes no space; show it again from Show / hide cards
      editor.width.value = presetValue(WIDTHS, card.w);
      editor.height.value = presetValue(HEIGHTS, card.h);
      editor.resize.hidden = !editing;
      editor.resize.disabled = !editing;
      editor.visible.checked = !card.hidden;
      editor.panel.inert = !editing; // out of keyboard reach while browsing
    }
    place(layout.cards);
    document.getElementById('fhLayoutEmpty').hidden = editing || ids.some(id => !layout.cards[id].hidden);
    undo.disabled = !history.length;
  }
  function commit(change, fixedId = null) {
    cancelGesture();
    const before = JSON.stringify(layout);
    change();
    for (const c of Object.values(layout.cards)) fit(c);
    settle(layout.cards, fixedId);
    if (JSON.stringify(layout) === before) { apply(); return; }
    history.push(before);
    if (history.length > 30) history.shift();
    apply(); save();
  }

  // ── Per-card controls (shown while arranging) ─────────────────────────
  const WIDTHS = [[6, 'Quarter'], [8, 'Third'], [12, 'Half'], [16, 'Two thirds'], [24, 'Full width']];
  const HEIGHTS = [[20, 'Short'], [34, 'Medium'], [50, 'Tall'], [70, 'Extra tall']];
  const presetValue = (list, n) => list.some(([v]) => v === n) ? String(n) : 'custom';
  function button(text, label) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = text;
    element.setAttribute('aria-label', label); element.title = label;
    return element;
  }
  function select(label, options) {
    const wrap = document.createElement('label');
    wrap.append(document.createTextNode(label));
    const input = document.createElement('select');
    for (const [value, text] of [...options, ['custom', 'Custom']]) {
      const option = document.createElement('option'); option.value = String(value); option.textContent = text; input.append(option);
    }
    input.querySelector('[value=custom]').disabled = true;
    wrap.append(input);
    return { wrap, input };
  }
  // Hidden cards take no space. Shown again, a card goes back where it was,
  // or to the first free spot if something has moved in.
  function setHidden(id, hidden) {
    const c = layout.cards[id];
    c.hidden = hidden;
    if (hidden) return;
    const others = Object.entries(layout.cards).filter(([k, o]) => k !== id && !o.hidden).map(([, o]) => o);
    if (others.some(o => collide(c, o))) Object.assign(c, firstFit(others, c.w, c.h));
  }
  function nudge(id, dx, dy, dw, dh) {
    commit(() => {
      const c = layout.cards[id];
      c.x += dx; c.y += dy; c.w += dw; c.h += dh;
    }, id);
  }
  for (const [id, label] of definitions) {
    const card = nodes.get(id);
    const panel = document.createElement('div'); panel.className = 'fh-card-editor';
    panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', `${label} layout controls`);
    const buttons = document.createElement('div'); buttons.className = 'fh-editor-buttons';
    const handle = button('⠿', `Move ${label} card: drag it anywhere, or use the arrow keys`); handle.className = 'fh-drag-handle';
    const hide = button('Hide', `Hide ${label} card`);
    hide.addEventListener('click', () => commit(() => setHidden(id, true)));
    handle.addEventListener('keydown', event => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -GAP_ROWS * 2], ArrowDown: [0, GAP_ROWS * 2] }[event.key];
      if (!step) return;
      event.preventDefault(); nudge(id, step[0], step[1], 0, 0); handle.focus({ preventScroll: true });
    });
    buttons.append(handle, hide);
    const sizes = document.createElement('div'); sizes.className = 'fh-editor-size';
    const width = select('Width', WIDTHS), height = select('Height', HEIGHTS);
    width.input.setAttribute('aria-label', `${label} card width`); height.input.setAttribute('aria-label', `${label} card height`);
    width.input.addEventListener('change', () => commit(() => { layout.cards[id].w = Number(width.input.value); }, id));
    height.input.addEventListener('change', () => commit(() => { layout.cards[id].h = Number(height.input.value); }, id));
    sizes.append(width.wrap, height.wrap); panel.append(buttons, sizes);
    card.prepend(panel);
    const visibilityLabel = document.createElement('label');
    const visible = document.createElement('input'); visible.type = 'checkbox';
    visible.addEventListener('change', () => commit(() => setHidden(id, !visible.checked), visible.checked ? id : null));
    visibilityLabel.append(visible, document.createTextNode(label)); document.getElementById('fhCardVisibilityList').append(visibilityLabel);
    const resize = button('↘', `Resize ${label} card: drag the corner, or use the arrow keys`);
    resize.className = 'fh-resize-handle';
    resize.addEventListener('keydown', event => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -GAP_ROWS * 2], ArrowDown: [0, GAP_ROWS * 2] }[event.key];
      if (!step) return;
      event.preventDefault(); nudge(id, 0, 0, step[0], step[1]); resize.focus({ preventScroll: true });
    });
    card.append(resize);
    // Moving: grab the card anywhere except its controls. Resizing: the corner.
    card.addEventListener('pointerdown', event => {
      if (!editing || isPhone() || gesture || !event.isPrimary || event.button !== 0) return;
      const onResize = event.target.closest('.fh-resize-handle');
      if (!onResize && event.target.closest('select, input, textarea, .fh-card-editor button:not(.fh-drag-handle), .fh-chat-form')) return;
      startGesture(event, id, onResize ? 'resize' : 'move', onResize ? resize : card);
    });
    controls.set(id, { panel, resize, width: width.input, height: height.input, hide, visible, handle });
    // Links are previews while arranging — including ones added later, such
    // as the Planning Center card's, so a press that doesn't become a drag
    // can't open a tab mid-arrange
    card.addEventListener('click', event => { if (editing && event.target.closest('a')) event.preventDefault(); });
  }

  // ── Dragging and resizing ─────────────────────────────────────────────
  dashboard.addEventListener('dragstart', event => { if (editing) event.preventDefault(); });
  const slot = document.createElement('div');
  slot.className = 'fh-drop-slot'; slot.setAttribute('aria-hidden', 'true'); slot.hidden = true;
  dashboard.append(slot);
  function grid() {
    const rect = dashboard.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(dashboard).columnGap) || 20;
    return { rect, gap, col: (rect.width + gap) / COLS };
  }
  function startGesture(event, id, kind, captureEl) {
    event.preventDefault();
    const node = nodes.get(id), rect = node.getBoundingClientRect();
    gesture = {
      kind, id, node, captureEl, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      startW: rect.width, startH: rect.height,
      base: JSON.parse(JSON.stringify(layout.cards)), cards: null, active: false,
    };
    captureEl.setPointerCapture(event.pointerId);
    captureEl.addEventListener('pointermove', onPointerMove);
    captureEl.addEventListener('pointerup', onPointerUp);
    captureEl.addEventListener('pointercancel', onPointerCancel);
    captureEl.addEventListener('lostpointercapture', onPointerCancel);
  }
  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.active && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) > 5) {
      gesture.active = true;
      document.body.classList.add(gesture.kind === 'move' ? 'fh-dragging' : 'fh-resizing');
      gesture.node.classList.add('fh-gesture-source');
      slot.hidden = false;
      tick();
    }
  }
  function tick() {
    if (!gesture?.active) return;
    // Scroll the page when the pointer reaches the top or bottom edge
    const edge = gesture.y < 70 ? -1 : gesture.y > innerHeight - 70 ? 1 : 0;
    if (edge) window.scrollBy(0, edge * 14);
    const { rect, col, gap } = grid();
    let cards;
    if (gesture.kind === 'move') {
      const target = dragTarget(gesture.base, gesture.id, (gesture.x - gesture.grabX - rect.left) / col, (gesture.y - gesture.grabY - rect.top) / ROW, col, gesture.over);
      cards = target.cards; gesture.over = target.over;
    } else {
      // A size only changes once the pointer is well past the line between
      // two, so a corner resting on the line doesn't flick back and forth
      const hold = (raw, last) => (last === undefined || Math.abs(raw - last) > 0.65 ? Math.round(raw) : last);
      cards = JSON.parse(JSON.stringify(gesture.base));
      gesture.cw = hold((gesture.startW + gap + (gesture.x - gesture.startX)) / col, gesture.cw);
      gesture.ch = hold((gesture.startH + (gesture.y - gesture.startY)) / ROW, gesture.ch);
      Object.assign(cards[gesture.id], { w: gesture.cw, h: gesture.ch });
      fit(cards[gesture.id]);
      settle(cards, gesture.id);
    }
    const c = cards[gesture.id];
    gesture.cards = cards;
    // Re-place the cards only when the arrangement actually changes
    const key = JSON.stringify(cards);
    if (key !== gesture.key) {
      gesture.key = key;
      place(cards, gesture.id);
      slot.style.gridColumn = `${c.x + 1} / span ${c.w}`;
      slot.style.gridRow = `${c.y + 1} / span ${c.h}`;
      // Only on a change: this is a live region, and a write every frame
      // read out as a continuous stream of positions
      status.textContent = `${labels[gesture.id]}: ${gesture.kind === 'move' ? `column ${c.x + 1}, row ${Math.round(c.y / GAP_ROWS) + 1}` : `${c.w} of ${COLS} columns wide, ${c.h * ROW} px tall`}`;
    }
    // The dragged card follows the pointer exactly. Its offset is worked out
    // from the grid, not from the card's on-screen box (which already includes
    // last frame's offset, and made it shudder).
    if (gesture.kind === 'move') {
      const left = rect.left + c.x * col, top = rect.top + c.y * ROW;
      gesture.node.style.transform = `translate(${gesture.x - gesture.grabX - left}px, ${gesture.y - gesture.grabY - top}px)`;
    }
    frame = requestAnimationFrame(tick);
  }
  function endGesture(keep) {
    if (!gesture) return;
    const g = gesture; gesture = null;
    cancelAnimationFrame(frame); frame = null;
    for (const [type, fn] of [['pointermove', onPointerMove], ['pointerup', onPointerUp], ['pointercancel', onPointerCancel], ['lostpointercapture', onPointerCancel]]) g.captureEl.removeEventListener(type, fn);
    if (g.captureEl.hasPointerCapture(g.pointerId)) g.captureEl.releasePointerCapture(g.pointerId);
    document.body.classList.remove('fh-dragging', 'fh-resizing');
    const was = g.node.getBoundingClientRect(); // where it is under the pointer
    g.node.classList.remove('fh-gesture-source');
    g.node.style.transform = '';
    slot.hidden = true;
    if (keep && g.active && g.cards) {
      const before = JSON.stringify(layout);
      layout.cards = g.cards;
      if (JSON.stringify(layout) !== before) { history.push(before); if (history.length > 30) history.shift(); save(); }
      apply();
      // Glide from the pointer into its spot
      const now = g.node.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (g.kind === 'move' && (Math.abs(dx) > 1 || Math.abs(dy) > 1) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        g.node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      }
      status.textContent = `${g.kind === 'move' ? 'Moved' : 'Resized'} ${labels[g.id]}. Layout saved in this browser.`;
      // Keyboard users can carry on with the arrow keys from here: the
      // pointerdown's preventDefault kept the handle from taking focus
      (g.kind === 'move' ? controls.get(g.id).handle : controls.get(g.id).resize).focus({ preventScroll: true });
    } else {
      apply();
    }
  }
  function onPointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (gesture.active) { cancelAnimationFrame(frame); tick(); cancelAnimationFrame(frame); }
    endGesture(true);
  }
  function onPointerCancel() { endGesture(false); }
  function cancelGesture() { endGesture(false); }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelGesture(); });
  window.addEventListener('blur', cancelGesture);
  window.addEventListener('pagehide', cancelGesture);

  // ── Arrange mode ──────────────────────────────────────────────────────
  // A card the page switched off (Companion) was parked below
  // everything; the first time it turns on it takes the first free spot among
  // the cards that are showing, instead of sitting under a gap. Once someone
  // arranges the page, cards stay where they put them.
  function placeWhenOn(id) {
    const card = layout.cards[id];
    if (!card || !card.auto || card.hidden || editing || !inUse(id)) return;
    const placed = Object.entries(layout.cards).filter(([other, c]) => other !== id && !c.hidden && inUse(other)).map(([, c]) => c);
    const at = firstFit(placed, card.w, card.h);
    card.x = at.x; card.y = at.y;
    delete card.auto;
    settle(layout.cards, id);
    apply(); save();
  }
  const offWatcher = new MutationObserver((changes) => { for (const change of changes) placeWhenOn(change.target.dataset.fhCard); });
  for (const node of nodes.values()) offWatcher.observe(node, { attributes: true, attributeFilter: ['class'] });

  function setEditing(value) {
    cancelGesture();
    if (!value) for (const c of Object.values(layout.cards)) delete c.auto; // arranged by hand now
    editing = value;
    document.body.classList.toggle('fh-editing', editing);
    arrange.setAttribute('aria-pressed', String(editing)); arrange.textContent = editing ? 'Done arranging' : 'Arrange page';
    undo.hidden = reset.hidden = visibility.hidden = !editing;
    document.getElementById('fhLayoutHint').hidden = !editing;
    if (!editing) visibility.open = false;
    apply();
  }
  arrange.addEventListener('click', () => setEditing(!editing));
  undo.addEventListener('click', () => { if (!history.length) return; cancelGesture(); layout = normalize(JSON.parse(history.pop())); apply(); save(); });
  reset.addEventListener('click', () => commit(() => { layout = normalize(null); }));

  let layoutViewportWidth = innerWidth;
  window.addEventListener('resize', () => {
    // Phone browser chrome changes the height while scrolling; only a width
    // change matters. Never cancels a drag: a page that grows while a card is
    // dragged down can show a scrollbar, which narrows it a little, and that
    // used to drop the card back where it started. The drag re-measures the
    // grid every frame anyway; a switch to the phone layout ends it.
    if (innerWidth === layoutViewportWidth) return;
    layoutViewportWidth = innerWidth;
    if (gesture) { if (isPhone()) cancelGesture(); return; }
    apply();
  });
  apply();

  // For foh.js: saving this arrangement for the scheduled team member, and
  // loading theirs when they open the page on another device
  window.fohLayout = {
    snapshot: () => JSON.parse(JSON.stringify(layout)),
    load(saved) {
      if (editing) return false; // never pull the layout out from under someone arranging it
      cancelGesture();
      layout = normalize(saved);
      apply(); save();
      return true;
    },
    setStatus(text) { status.textContent = text; },
  };
})();
