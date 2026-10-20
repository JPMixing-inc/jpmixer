'use strict';

// Stage preferences are local display state. This module has no socket or
// console commands; the existing device cards keep their live subscriptions.
(() => {
  const byId = id => document.getElementById(id);
  // View/height are just canvas prefs — not console-specific, kept under one
  // key regardless of what's connected. Positions and hidden-aux state ARE
  // console-specific (keyed by aux *channel number* — see auxKey below), so
  // they live under a separate, aux-count-scoped key instead: switching
  // console types (a different aux count almost always comes with it) must
  // not silently reapply stale positions/hidden-state onto an unrelated
  // console's same-numbered-but-different aux channels. Deferred until the
  // first real aux list arrives (setAuxes) rather than loaded at module
  // init, since the aux count isn't known yet at that point.
  const prefsKey = 'jpm_device_stage_v1';
  let layoutKey = null, layoutSignature = null;
  const surface = byId('stageSurface');
  const layer = byId('stageDevices');
  const workspace = byId('stageWorkspace');
  const grid = byId('devGrid');
  const cards = new Map();
  const liveCards = new Map(), phantomCards = new Map();
  const parked = document.createDocumentFragment();
  const visibilityItems = new Map();
  const hiddenAuxes = new Set();
  let auxes = [], phantom = false;
  let positions = new Map(), view = 'stage', arranging = false, drag = null;
  let canSave = true;
  let stageHeight = 720;
  const history = [];
  const clamp = (value, max = 1) => Math.max(0, Math.min(max, value));
  try {
    const savedPrefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
    if (savedPrefs.view === 'grid') view = 'grid';
    if (Number.isFinite(savedPrefs.height)) stageHeight = Math.max(720, Math.min(20000, savedPrefs.height));
  } catch (_) {}
  surface.style.height = `${stageHeight}px`;
  const auxKey = channel => `stage-aux:${channel}`;
  const positionKey = key => cards.get(key)?.positionKey || key;

  function loadLayout() {
    positions = new Map();
    hiddenAuxes.clear();
    try {
      const saved = JSON.parse(localStorage.getItem(layoutKey) || '{}');
      if (Array.isArray(saved.hiddenAuxes)) for (const channel of saved.hiddenAuxes) if (Number.isInteger(channel)) hiddenAuxes.add(channel);
      for (const [key, point] of Object.entries(saved.positions || {})) {
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) positions.set(key, { x: clamp(point.x), y: clamp(point.y) });
      }
    } catch (_) {}
  }

  function reconcile() {
    const next = new Map();
    const owners = new Set();
    for (const [key, entry] of liveCards) {
      if (phantom) {
        if (entry.card.parentNode !== parked) parked.appendChild(entry.card);
      } else {
        const anchor = auxKey(entry.aux);
        entry.positionKey = entry.aux != null && positions.has(anchor) && !owners.has(entry.aux) ? anchor : key;
        owners.add(entry.aux);
        next.set(key, entry);
        const parent = view === 'stage' ? layer : grid;
        if (entry.card.parentNode !== parent) parent.appendChild(entry.card);
      }
    }
    const validAuxes = new Set();
    if (phantom) {
      for (const aux of auxes) {
        if (hiddenAuxes.has(aux.channel)) continue;
        const key = auxKey(aux.channel);
        validAuxes.add(key);
        if (!positions.has(key)) {
          const live = [...liveCards].find(([, entry]) => entry.aux === aux.channel);
          const point = live && positions.get(live[1].positionKey || live[0]);
          if (point) positions.set(key, { ...point });
        }
        let entry = phantomCards.get(key);
        if (!entry) {
          const card = document.createElement('div');
          card.className = 'dev-card phantom-card';
          card.dataset.aux = aux.channel;
          card.innerHTML = '<div class="dev-card-aux"></div><div class="dev-card-body"><div><div class="dev-card-tag"></div><div class="dev-card-sub"></div></div></div><div class="dev-card-action phantom-note">Layout placeholder · no audio control</div>';
          entry = { card, handle: attachHandle(key, card), positionKey: key };
          const hide = document.createElement('button');
          hide.type = 'button';
          hide.className = 'stage-hide-aux';
          hide.textContent = 'Hide aux';
          hide.setAttribute('aria-label', `Hide aux ${aux.channel} from Phantom editor`);
          hide.addEventListener('click', () => setAuxHidden(aux.channel, true));
          card.appendChild(hide);
          phantomCards.set(key, entry);
        }
        const label = aux.label || `AUX ${aux.channel}`;
        const count = [...liveCards.values()].filter(live => live.aux === aux.channel).length;
        entry.card.style.setProperty('--aux-color', aux.colour || '#8794b1');
        entry.card.querySelector('.dev-card-aux').textContent = label;
        entry.card.querySelector('.dev-card-aux').title = label;
        entry.card.querySelector('.dev-card-tag').textContent = `Phantom · Aux ${aux.channel}`;
        entry.card.querySelector('.dev-card-sub').textContent = count ? `${count} real ${count === 1 ? 'device' : 'devices'} connected` : aux.enabled === false ? 'Hidden aux · no device connected' : 'No device connected';
        next.set(key, entry);
        if (entry.card.parentNode !== layer) layer.appendChild(entry.card);
      }
    }
    if (drag && (!next.has(drag.key) || next.get(drag.key).positionKey !== drag.positionKey)) finishDrag(false);
    for (const [key, entry] of phantomCards) {
      if (!validAuxes.has(key)) { entry.card.remove(); phantomCards.delete(key); }
    }
    cards.clear();
    for (const [key, entry] of next) cards.set(key, entry);
  }
  function setPhantom(enabled) {
    finishDrag(false);
    phantom = !!enabled && arranging && view === 'stage';
    history.length = 0;
    reconcile(); layout(); save(); updateUI();
  }

  function updateUI() {
    workspace.hidden = view !== 'stage';
    grid.hidden = view !== 'grid';
    document.body.classList.toggle('stage-arranging', arranging && view === 'stage');
    for (const button of document.querySelectorAll('[data-device-view]')) button.setAttribute('aria-pressed', String(button.dataset.deviceView === view));
    byId('arrangeStageBtn').hidden = view !== 'stage';
    byId('arrangeStageBtn').textContent = arranging ? 'Done arranging' : 'Arrange stage';
    byId('arrangeStageBtn').setAttribute('aria-pressed', String(arranging));
    byId('phantomModeControl').hidden = view !== 'stage' || !arranging;
    byId('phantomModeCheckbox').checked = phantom;
    byId('autoArrangeBtn').hidden = view !== 'stage' || !arranging;
    byId('undoStageBtn').hidden = view !== 'stage' || !arranging;
    byId('undoStageBtn').disabled = history.length === 0;
    byId('auxVisibilityControl').hidden = view !== 'stage' || !arranging || !phantom;
    if (byId('auxVisibilityControl').hidden) byId('auxVisibilityControl').open = false;
    const hiddenCount = auxes.filter(aux => hiddenAuxes.has(aux.channel)).length;
    byId('auxVisibilityLabel').textContent = hiddenCount ? `Aux visibility · ${hiddenCount} hidden` : 'Aux visibility';
    byId('phantomModeControl').querySelector('span').textContent = hiddenCount ? `${auxes.length - hiddenCount}/${auxes.length} auxes` : 'All auxes';
    byId('stageEmpty').hidden = cards.size !== 0;
    byId('stageHint').textContent = view === 'grid' ? 'Live mix selection, connection status, and performer activity.'
      : phantom ? 'Drag cards to position auxes. Hide unused cards here; Aux visibility brings them back. This only changes the editor.'
      : arranging ? 'Drag anywhere on a card to move it. Arrow keys move a focused handle; Shift moves in smaller steps.'
      : canSave ? 'Arrange devices to match your stage. Positions save in this browser.' : 'Stage layout is available, but this browser could not save its positions.';
    byId('stageEmptyTitle').textContent = phantom ? 'No phantom auxes are visible.' : 'Devices appear here as performers connect.';
    byId('stageEmptyDescription').textContent = phantom ? 'Open Aux visibility and choose Show all to restore them.' : 'Choose Arrange stage to move their cards into position.';
  }
  function save() {
    try {
      localStorage.setItem(prefsKey, JSON.stringify({ view, height: stageHeight }));
      if (layoutKey) localStorage.setItem(layoutKey, JSON.stringify({ hiddenAuxes: [...hiddenAuxes], positions: Object.fromEntries(positions) }));
      canSave = true;
    } catch (_) { canSave = false; }
  }
  function remember(snapshot = new Map(positions)) {
    history.push(snapshot);
    if (history.length > 30) history.shift();
  }
  function renderVisibility() {
    const list = byId('stageAuxVisibilityList');
    const valid = new Set();
    for (const aux of auxes) {
      valid.add(aux.channel);
      let item = visibilityItems.get(aux.channel);
      if (!item) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => setAuxHidden(aux.channel, !checkbox.checked));
        const name = document.createElement('span');
        label.append(checkbox, name); list.appendChild(label);
        item = { label, checkbox, name }; visibilityItems.set(aux.channel, item);
      }
      item.checkbox.checked = !hiddenAuxes.has(aux.channel);
      item.checkbox.dataset.aux = aux.channel;
      item.name.textContent = `${aux.channel} · ${aux.label || 'AUX ' + aux.channel}`;
    }
    for (const [channel, item] of visibilityItems) if (!valid.has(channel)) { item.label.remove(); visibilityItems.delete(channel); }
  }
  function setAuxHidden(channel, hidden) {
    finishDrag();
    if (hidden) hiddenAuxes.add(channel); else hiddenAuxes.delete(channel);
    reconcile(); layout(); renderVisibility(); save(); updateUI();
  }
  function bounds(card) {
    return { x: Math.max(0, layer.clientWidth - card.offsetWidth), y: Math.max(0, layer.clientHeight - card.offsetHeight) };
  }
  function place(key, card) {
    if (drag?.key === key && drag.moved) return;
    const point = positions.get(positionKey(key));
    if (!point) return;
    const max = bounds(card);
    card.style.left = `${point.x * max.x}px`;
    card.style.top = `${point.y * max.y}px`;
  }
  function layout() {
    if (view !== 'stage' || !layer.clientWidth) return;
    const cardWidth = 216, cardHeight = 184, gap = 24;
    const maxColumns = Math.max(1, Math.floor((layer.clientWidth + gap) / (cardWidth + gap)));
    const rows = Math.max(1, Math.ceil(cards.size / maxColumns));
    const columns = maxColumns;
    const previousHeight = stageHeight;
    const previousMaxY = Math.max(0, layer.clientHeight - cardHeight);
    stageHeight = Math.max(stageHeight, rows * (cardHeight + gap) + 120);
    surface.style.height = `${stageHeight}px`;
    const maxX = Math.max(0, layer.clientWidth - cardWidth);
    const maxY = Math.max(0, layer.clientHeight - cardHeight);
    // Growing the floor for new arrivals must leave existing performers in
    // their physical positions, including saved devices currently offline.
    if (stageHeight !== previousHeight && maxY > 0) {
      for (const [key, point] of positions) positions.set(key, { x: point.x, y: clamp(point.y * previousMaxY / maxY) });
      for (const snapshot of history) {
        for (const [key, point] of snapshot) snapshot.set(key, { x: point.x, y: clamp(point.y * previousMaxY / maxY) });
      }
    }
    const candidates = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = (layer.clientWidth / columns - cardWidth) / 2 + col * layer.clientWidth / columns;
        candidates.push({ x: maxX ? clamp(x / maxX) : 0, y: maxY ? clamp((row * (cardHeight + gap) + 12) / maxY) : 0 });
      }
    }
    const occupied = [...cards.keys()].map(positionKey).filter(key => positions.has(key)).map(key => positions.get(key));
    let changed = false;
    for (const [key, { card, handle }] of cards) {
      const anchor = positionKey(key);
      if (!positions.has(anchor)) {
        const point = candidates.find(p => occupied.every(q => Math.abs((p.x - q.x) * maxX) >= cardWidth + 8 || Math.abs((p.y - q.y) * maxY) >= cardHeight + 8)) || candidates[occupied.length % candidates.length];
        positions.set(anchor, { ...point });
        occupied.push(point);
        changed = true;
      }
      place(key, card);
      handle.setAttribute('aria-label', `Move ${card.querySelector('.dev-card-tag').textContent}`);
    }
    if (changed) save();
    updateUI();
  }
  function renderDrag() {
    if (!drag?.moved) return;
    drag.frame = null;
    // Use current stage coordinates so scrolling or live UI updates cannot
    // change the pointer's grab point or make the card jump under the mouse.
    const rect = layer.getBoundingClientRect(), max = bounds(drag.card);
    const left = clamp(drag.clientX - rect.left - drag.grabX, max.x);
    const top = clamp(drag.clientY - rect.top - drag.grabY, max.y);
    positions.set(drag.positionKey, { x: max.x ? left / max.x : 0, y: max.y ? top / max.y : 0 });
    drag.card.style.transform = `translate3d(${left - drag.left}px, ${top - drag.top}px, 0)`;
  }
  function finishDrag(commit = true) {
    if (!drag) return;
    if (drag.frame != null) cancelAnimationFrame(drag.frame);
    if (commit) renderDrag();
    const current = drag;
    drag = null;
    current.card.classList.remove('stage-dragging');
    current.card.style.transform = '';
    document.body.classList.remove('stage-drag-active');
    if (!commit && current.moved) { positions = current.before; history.pop(); }
    if (current.card.hasPointerCapture(current.pointerId)) current.card.releasePointerCapture(current.pointerId);
    save();
    layout();
  }
  function announce(card) { byId('stageAnnouncement').textContent = `${card.querySelector('.dev-card-tag').textContent} position saved.`; }
  function attachHandle(key, card) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'stage-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to move. Use arrow keys when focused.';
    card.appendChild(handle);
    card.addEventListener('dragstart', event => event.preventDefault());
    card.addEventListener('pointerdown', event => {
      if (!arranging || view !== 'stage' || event.button !== 0 || drag) return;
      if (event.target.closest('button, input, select, a, summary') && !handle.contains(event.target)) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      const rect = card.getBoundingClientRect();
      drag = { key, positionKey: positionKey(key), card, pointerId: event.pointerId, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top, left: card.offsetLeft, top: card.offsetTop, before: new Map(positions), moved: false, frame: null };
      card.setPointerCapture(event.pointerId);
    });
    card.addEventListener('pointermove', event => {
      if (!drag || drag.key !== key || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved) { remember(drag.before); drag.moved = true; card.classList.add('stage-dragging'); document.body.classList.add('stage-drag-active'); }
      drag.clientX = event.clientX; drag.clientY = event.clientY;
      if (drag.frame == null) drag.frame = requestAnimationFrame(renderDrag);
    });
    card.addEventListener('pointerup', event => {
      if (drag?.key === key && drag.pointerId === event.pointerId) { drag.clientX = event.clientX; drag.clientY = event.clientY; finishDrag(); announce(card); }
    });
    card.addEventListener('pointercancel', () => { if (drag?.key === key) finishDrag(); });
    card.addEventListener('lostpointercapture', () => { if (drag?.key === key) finishDrag(); });
    handle.addEventListener('keydown', event => {
      if (!arranging || view !== 'stage') return;
      if (event.key === 'Escape') { finishDrag(false); return; }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      const max = bounds(card), current = positions.get(positionKey(key)), step = event.shiftKey ? 2 : 12;
      const next = { x: clamp(current.x + (max.x ? direction[0] * step / max.x : 0)), y: clamp(current.y + (max.y ? direction[1] * step / max.y : 0)) };
      if (next.x === current.x && next.y === current.y) return;
      remember(); positions.set(positionKey(key), next); place(key, card); save(); updateUI(); announce(card);
    });
    return handle;
  }
  function setView(next) {
    finishDrag(false);
    view = next === 'grid' ? 'grid' : 'stage';
    arranging = false;
    phantom = false;
    reconcile();
    updateUI();
    layout(); save(); updateUI();
  }
  for (const button of document.querySelectorAll('[data-device-view]')) button.addEventListener('click', () => setView(button.dataset.deviceView));
  byId('arrangeStageBtn').addEventListener('click', () => { finishDrag(); arranging = !arranging; if (!arranging && phantom) setPhantom(false); updateUI(); });
  byId('phantomModeCheckbox').addEventListener('change', event => setPhantom(event.target.checked));
  byId('showAllStageAuxes').addEventListener('click', () => { finishDrag(); hiddenAuxes.clear(); reconcile(); layout(); renderVisibility(); save(); updateUI(); });
  byId('hideDisconnectedStageAuxes').addEventListener('click', () => {
    finishDrag();
    const connected = new Set([...liveCards.values()].map(entry => entry.aux));
    for (const aux of auxes) if (!connected.has(aux.channel)) hiddenAuxes.add(aux.channel);
    reconcile(); layout(); renderVisibility(); save(); updateUI();
  });
  function positionVisibilityMenu() {
    const control = byId('auxVisibilityControl');
    if (!control.open) return;
    const panel = control.querySelector('.stage-aux-panel');
    const rect = control.querySelector('summary').getBoundingClientRect();
    panel.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - panel.offsetWidth - 16))}px`;
    panel.style.top = `${Math.max(16, Math.min(rect.bottom + 8, innerHeight - panel.offsetHeight - 16))}px`;
  }
  byId('auxVisibilityControl').addEventListener('toggle', positionVisibilityMenu);
  document.addEventListener('click', event => { if (!byId('auxVisibilityControl').contains(event.target)) byId('auxVisibilityControl').open = false; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') byId('auxVisibilityControl').open = false; });
  byId('autoArrangeBtn').addEventListener('click', () => { remember(); for (const key of cards.keys()) positions.delete(positionKey(key)); layout(); save(); updateUI(); });
  byId('undoStageBtn').addEventListener('click', () => { finishDrag(false); if (!history.length) return; positions = history.pop(); layout(); save(); updateUI(); });
  window.addEventListener('resize', layout);
  window.addEventListener('resize', positionVisibilityMenu);
  window.addEventListener('blur', () => finishDrag());
  new ResizeObserver(layout).observe(workspace);
  globalThis.deviceStage = {
    mount(key, card) {
      liveCards.set(key, { card, handle: attachHandle(key, card), positionKey: key, aux: null });
      (phantom ? parked : view === 'stage' ? layer : grid).appendChild(card);
    },
    update(key, device) { const entry = liveCards.get(key); if (entry) entry.aux = device.aux == null ? null : Number(device.aux); },
    remove(key) { if (drag?.key === key) finishDrag(false); liveCards.delete(key); cards.delete(key); },
    setAuxes(next) {
      auxes = next.map(aux => ({ ...aux, channel: Number(aux.channel) }));
      const signature = String(auxes.length);
      if (signature !== layoutSignature) {
        layoutSignature = signature;
        layoutKey = `jpm_device_stage_layout_v1:${signature}`;
        loadLayout();
      }
      reconcile(); layout(); renderVisibility();
    },
    relabelAux(channel, label) { const aux = auxes.find(item => item.channel === Number(channel)); if (aux) aux.label = label; reconcile(); layout(); renderVisibility(); },
    sync() { reconcile(); layout(); }
  };
  updateUI();
})();
