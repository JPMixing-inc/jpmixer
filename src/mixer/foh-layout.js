'use strict';

// Browser-local presentation only. Schedule refreshes keep updating the same
// card bodies; arranging never sends console controls or changes server config.
(() => {
  // FOH Home and the ProPresenter/Lighting/Switcher pages (role.html) share
  // this; each keeps its own layout, and the cards come from the page itself.
  const role = (location.pathname.match(/\/(propresenter|lighting|switcher)\.html$/) || [])[1] || 'foh';
  const STORAGE_KEY = role === 'foh' ? 'jpm_foh_layout_v1' : `jpm_${role}_layout_v1`;
  const definitions = [...document.querySelectorAll('#fhDashboard [data-fh-card]')].map(node => [node.dataset.fhCard, node.getAttribute('aria-label') || node.dataset.fhCard]);
  const defaultSizes = Object.fromEntries([...document.querySelectorAll('#fhDashboard [data-fh-default-size]')].map(node => [node.dataset.fhCard, node.dataset.fhDefaultSize]));
  const ids = definitions.map(([id]) => id);
  const labels = Object.fromEntries(definitions);
  const widths = { compact: 3, standard: 4, wide: 6, full: 12 };
  const heights = { short: '180px', tall: '480px' };
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
  let drag = null;
  let frame = null;
  let resizing = null;
  let resizeFrame = null;

  function normalize(value) {
    const order = Array.isArray(value?.order) ? [...new Set(value.order.filter(id => ids.includes(id)))] : [];
    order.push(...ids.filter(id => !order.includes(id)));
    return {
      order,
      cards: Object.fromEntries(ids.map(id => {
        const saved = value?.cards?.[id];
        return [id, {
          hidden: saved?.hidden === true,
          size: Object.hasOwn(widths, saved?.size) ? saved.size : Object.hasOwn(widths, defaultSizes[id]) ? defaultSizes[id] : 'standard',
          height: Object.hasOwn(heights, saved?.height) ? saved.height : 'auto',
          span: Number.isInteger(saved?.span) && saved.span >= 3 && saved.span <= 12 ? saved.span : null,
          pixels: Number.isInteger(saved?.pixels) && saved.pixels >= 120 && saved.pixels <= 720 ? saved.pixels : null
        }];
      }))
    };
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
  function apply() {
    for (let index = 0; index < layout.order.length; index++) {
      const node = nodes.get(layout.order[index]);
      if (dashboard.children[index] !== node) dashboard.insertBefore(node, dashboard.children[index] || null);
    }
    for (const id of ids) {
      const node = nodes.get(id), card = layout.cards[id], editor = controls.get(id);
      node.hidden = card.hidden && !editing;
      node.classList.toggle('fh-card-hidden', card.hidden);
      node.dataset.size = card.span ? 'custom' : card.size;
      const span = card.span || widths[card.size];
      node.style.setProperty('--fh-card-span', innerWidth <= 700 ? 1 : innerWidth <= 1000 ? (card.span ? Math.max(6, span) : ['wide', 'full'].includes(card.size) ? 12 : 6) : span);
      if (card.height === 'auto' && !card.pixels) {
        node.style.removeProperty('--fh-card-height');
        node.style.removeProperty('--fh-shortcut-height');
      } else {
        const height = card.pixels ? card.pixels + 'px' : heights[card.height];
        node.style.setProperty('--fh-card-height', height);
        node.style.setProperty('--fh-shortcut-height', height);
      }
      editor.width.value = card.span ? 'custom' : card.size;
      editor.height.value = card.pixels ? 'custom' : card.height;
      editor.resize.hidden = !editing || card.hidden;
      editor.resize.disabled = !editing || card.hidden;
      editor.hide.textContent = card.hidden ? 'Show' : 'Hide';
      editor.hide.setAttribute('aria-label', `${card.hidden ? 'Show' : 'Hide'} ${labels[id]} card`);
      editor.visible.checked = !card.hidden;
      editor.earlier.disabled = layout.order.indexOf(id) === 0;
      editor.later.disabled = layout.order.indexOf(id) === ids.length - 1;
      // CSS hides editing controls visually; inert keeps them out of keyboard
      // navigation while browsing, including in browsers with delayed styles.
      editor.panel.inert = !editing;
    }
    document.getElementById('fhLayoutEmpty').hidden = editing || ids.some(id => !layout.cards[id].hidden);
    undo.disabled = !history.length;
  }
  function commit(change) {
    cancelGestures();
    const before = JSON.stringify(layout);
    change();
    if (JSON.stringify(layout) === before) return;
    history.push(before);
    if (history.length > 30) history.shift();
    apply(); save();
  }
  function move(id, direction) {
    commit(() => {
      const index = layout.order.indexOf(id), target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [layout.order[index], layout.order[target]] = [layout.order[target], layout.order[index]];
    });
  }
  function button(text, label) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = text;
    element.setAttribute('aria-label', label); element.title = label;
    return element;
  }
  function select(label, options, className) {
    const wrap = document.createElement('label');
    if (className) wrap.className = className;
    wrap.append(document.createTextNode(label));
    const input = document.createElement('select');
    for (const [value, text] of options) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
    }
    wrap.append(input);
    return { wrap, input };
  }
  for (const [id, label] of definitions) {
    const card = nodes.get(id);
    const panel = document.createElement('div'); panel.className = 'fh-card-editor';
    panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', `${label} layout controls`);
    const buttons = document.createElement('div'); buttons.className = 'fh-editor-buttons';
    const handle = button('⠿', `Drag ${label} card; arrow keys move earlier or later`); handle.className = 'fh-drag-handle';
    const earlier = button('↑', `Move ${label} earlier`), later = button('↓', `Move ${label} later`), hide = button('Hide', `Hide ${label} card`);
    earlier.addEventListener('click', () => { move(id, -1); handle.focus({ preventScroll: true }); });
    later.addEventListener('click', () => { move(id, 1); handle.focus({ preventScroll: true }); });
    hide.addEventListener('click', () => commit(() => { layout.cards[id].hidden = !layout.cards[id].hidden; }));
    handle.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); move(id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1); handle.focus({ preventScroll: true });
      }
    });
    handle.addEventListener('pointerdown', event => startDrag(event, id, handle));
    handle.addEventListener('pointermove', event => updateDrag(event));
    handle.addEventListener('pointerup', event => {
      if (event.pointerId !== drag?.pointerId) return;
      drag.x = event.clientX; drag.y = event.clientY;
      if (drag.active) { cancelAnimationFrame(frame); tickDrag(); }
      finishDrag(true);
    });
    handle.addEventListener('pointercancel', () => finishDrag(false));
    handle.addEventListener('lostpointercapture', () => finishDrag(false));
    buttons.append(handle, earlier, later, hide);
    const sizes = document.createElement('div'); sizes.className = 'fh-editor-size';
    const width = select('Card width', [['compact', 'Small'], ['standard', 'Medium'], ['wide', 'Wide'], ['full', 'Full width'], ['custom', 'Custom']], 'fh-width-field');
    const height = select('Card height', [['auto', 'Auto'], ['short', 'Short'], ['tall', 'Tall'], ['custom', 'Custom']]);
    width.input.setAttribute('aria-label', `${label} card width`); height.input.setAttribute('aria-label', `${label} card height`);
    width.input.querySelector('[value=custom]').disabled = true;
    height.input.querySelector('[value=custom]').disabled = true;
    width.input.addEventListener('change', () => commit(() => { layout.cards[id].size = width.input.value; layout.cards[id].span = null; }));
    height.input.addEventListener('change', () => commit(() => { layout.cards[id].height = height.input.value; layout.cards[id].pixels = null; }));
    sizes.append(width.wrap, height.wrap); panel.append(buttons, sizes);
    const hiddenNote = document.createElement('p'); hiddenNote.className = 'fh-hidden-note'; hiddenNote.textContent = 'Hidden when you finish arranging.';
    card.prepend(panel, hiddenNote);
    const visibilityLabel = document.createElement('label');
    const visible = document.createElement('input'); visible.type = 'checkbox';
    visible.addEventListener('change', () => commit(() => { layout.cards[id].hidden = !visible.checked; }));
    visibilityLabel.append(visible, document.createTextNode(label)); document.getElementById('fhCardVisibilityList').append(visibilityLabel);
    const resize = button('↘', `Resize ${label} card; arrow keys change width and height`);
    resize.className = 'fh-resize-handle';
    resize.addEventListener('pointerdown', event => startResize(event, id, resize));
    resize.addEventListener('pointermove', event => updateResize(event));
    resize.addEventListener('pointerup', event => {
      if (event.pointerId !== resizing?.pointerId) return;
      resizing.x = event.clientX; resizing.y = event.clientY;
      if (resizing.active) { cancelAnimationFrame(resizeFrame); tickResize(false); }
      finishResize(true);
    });
    resize.addEventListener('pointercancel', () => finishResize(false));
    resize.addEventListener('lostpointercapture', () => finishResize(false));
    resize.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const body = card.querySelector('.fh-card-body, .fh-nav-card');
      commit(() => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          if (innerWidth <= 700) return;
          const current = Number(card.style.getPropertyValue('--fh-card-span'));
          layout.cards[id].span = Math.max(innerWidth <= 1000 ? 6 : 3, Math.min(12, current + (event.key === 'ArrowRight' ? 1 : -1)));
        } else {
          layout.cards[id].pixels = Math.max(card.classList.contains('fh-shortcut') ? 180 : 120, Math.min(720, Math.round(body.getBoundingClientRect().height) + (event.key === 'ArrowDown' ? 20 : -20)));
        }
      });
      resize.focus({ preventScroll: true });
    });
    card.append(resize);
    controls.set(id, { panel, resize, width: width.input, height: height.input, hide, earlier, later, visible });
    // Links are previews during arranging; buttons live outside the anchor.
    card.querySelector('a')?.addEventListener('click', event => { if (editing) event.preventDefault(); });
  }

  function setEditing(value) {
    finishDrag(false);
    finishResize(false);
    editing = value;
    document.body.classList.toggle('fh-editing', editing);
    arrange.setAttribute('aria-pressed', String(editing)); arrange.textContent = editing ? 'Done arranging' : 'Arrange page';
    undo.hidden = reset.hidden = visibility.hidden = !editing;
    document.getElementById('fhLayoutHint').hidden = !editing;
    if (!editing) visibility.open = false;
    apply();
  }
  arrange.addEventListener('click', () => setEditing(!editing));
  undo.addEventListener('click', () => { if (!history.length) return; cancelGestures(); layout = normalize(JSON.parse(history.pop())); apply(); save(); });
  reset.addEventListener('click', () => commit(() => { layout = normalize(null); }));

  function startDrag(event, id, handle) {
    if (!editing || !event.isPrimary || event.button !== 0 || drag || resizing) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    drag = { id, handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null };
    handle.setPointerCapture(event.pointerId);
  }
  function updateDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 6) {
      drag.active = true;
      drag.ghost = document.createElement('div'); drag.ghost.className = 'fh-drag-ghost'; drag.ghost.setAttribute('aria-hidden', 'true');
      document.body.append(drag.ghost); document.body.classList.add('fh-dragging'); nodes.get(drag.id).classList.add('fh-drag-source');
      tickDrag();
    }
  }
  function tickDrag() {
    if (!drag?.active) return;
    const direction = drag.y < 72 ? -1 : drag.y > innerHeight - 72 ? 1 : 0;
    if (direction) window.scrollBy(0, direction * 12);
    for (const node of nodes.values()) node.classList.remove('fh-drop-before');
    drag.target = null;
    const board = dashboard.getBoundingClientRect();
    if (drag.x >= board.left - 24 && drag.x <= board.right + 24 && drag.y >= board.top - 40 && drag.y <= board.bottom + 40) {
      let best = Infinity;
      for (const id of layout.order) {
        if (id === drag.id) continue;
        const rect = nodes.get(id).getBoundingClientRect();
        const distance = Math.hypot(Math.max(rect.left - drag.x, 0, drag.x - rect.right), Math.max(rect.top - drag.y, 0, drag.y - rect.bottom));
        if (distance < best) { best = distance; drag.target = { id, after: drag.y > rect.top + rect.height / 2 }; }
      }
    }
    if (drag.target) nodes.get(drag.target.id).classList.add('fh-drop-before');
    drag.ghost.textContent = labels[drag.id] + (drag.target ? ` → ${drag.target.after ? 'After' : 'Before'} ${labels[drag.target.id]}` : ' — drop outside to cancel');
    drag.ghost.style.left = Math.max(8, Math.min(innerWidth - 268, drag.x + 14)) + 'px';
    drag.ghost.style.top = Math.max(8, Math.min(innerHeight - drag.ghost.offsetHeight - 8, drag.y + 14)) + 'px';
    frame = requestAnimationFrame(tickDrag);
  }
  function finishDrag(commitDrop) {
    if (!drag) return;
    const finished = drag; drag = null;
    cancelAnimationFrame(frame); frame = null;
    finished.ghost?.remove(); document.body.classList.remove('fh-dragging');
    for (const node of nodes.values()) node.classList.remove('fh-drag-source', 'fh-drop-before');
    if (finished.handle.hasPointerCapture(finished.pointerId)) finished.handle.releasePointerCapture(finished.pointerId);
    if (commitDrop && finished.active && finished.target) {
      commit(() => {
        const order = layout.order.filter(id => id !== finished.id);
        const index = order.indexOf(finished.target.id) + (finished.target.after ? 1 : 0);
        order.splice(index, 0, finished.id); layout.order = order;
      });
      status.textContent = `Moved ${labels[finished.id]}. ` + status.textContent;
      finished.handle.focus({ preventScroll: true });
    }
  }
  function startResize(event, id, handle) {
    if (!editing || !event.isPrimary || event.button !== 0 || drag || resizing) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    const node = nodes.get(id), rect = node.getBoundingClientRect();
    const bodyHeight = node.querySelector('.fh-card-body, .fh-nav-card').getBoundingClientRect().height;
    resizing = { id, handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY + scrollY, startClientY: event.clientY,
      x: event.clientX, y: event.clientY, left: rect.left, top: rect.top + scrollY, width: rect.width,
      height: rect.height, bodyHeight, minHeight: node.classList.contains('fh-shortcut') ? 180 : 120,
      active: false, widthChanged: false, heightChanged: false };
    handle.setPointerCapture(event.pointerId);
  }
  function updateResize(event) {
    if (!resizing || event.pointerId !== resizing.pointerId) return;
    resizing.x = event.clientX; resizing.y = event.clientY;
    if (!resizing.active && Math.hypot(resizing.x - resizing.startX, resizing.y + scrollY - resizing.startY) > 6) {
      resizing.active = true;
      resizing.preview = document.createElement('div'); resizing.preview.className = 'fh-resize-preview';
      resizing.preview.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); resizing.preview.append(label);
      document.body.append(resizing.preview); document.body.classList.add('fh-resizing');
      nodes.get(resizing.id).classList.add('fh-resize-source');
      tickResize();
    }
  }
  function tickResize(autoScroll = true) {
    if (!resizing?.active) return;
    if (autoScroll) {
      const movement = resizing.y - resizing.startClientY;
      const direction = resizing.y < 64 && movement < -8 ? -1 : resizing.y > innerHeight - 64 && movement > 8 ? 1 : 0;
      if (direction) window.scrollBy(0, direction * 10);
    }
    const current = resizing, rect = dashboard.getBoundingClientRect();
    const dx = current.x - current.startX, dy = current.y + scrollY - current.startY;
    current.widthChanged = innerWidth > 700 && Math.abs(dx) > 8;
    current.heightChanged = Math.abs(dy) > 8;
    const gap = parseFloat(getComputedStyle(dashboard).columnGap) || 20;
    const unit = (rect.width + gap) / 12;
    current.span = Math.max(innerWidth <= 1000 ? 6 : 3, Math.min(12, Math.round((current.width + dx + gap) / unit)));
    current.pixels = Math.max(current.minHeight, Math.min(720, Math.round(current.bodyHeight + dy)));
    const width = current.widthChanged ? current.span * unit - gap : current.width;
    const height = current.heightChanged ? current.height - current.bodyHeight + current.pixels : current.height;
    current.preview.style.left = Math.max(rect.left, Math.min(current.left, rect.right - width)) + 'px';
    current.preview.style.top = current.top - scrollY + 'px';
    current.preview.style.width = width + 'px'; current.preview.style.height = height + 'px';
    current.preview.firstChild.textContent = `${labels[current.id]} · ${Math.round(width)} × ${Math.round(height)}`;
    if (autoScroll) resizeFrame = requestAnimationFrame(() => tickResize());
  }
  function finishResize(keep) {
    if (!resizing) return;
    const finished = resizing; resizing = null;
    cancelAnimationFrame(resizeFrame); resizeFrame = null;
    finished.preview?.remove(); document.body.classList.remove('fh-resizing');
    nodes.get(finished.id).classList.remove('fh-resize-source');
    if (finished.handle.hasPointerCapture(finished.pointerId)) finished.handle.releasePointerCapture(finished.pointerId);
    if (keep && finished.active) {
      commit(() => {
        if (finished.widthChanged) layout.cards[finished.id].span = finished.span;
        if (finished.heightChanged) layout.cards[finished.id].pixels = finished.pixels;
      });
      finished.handle.focus({ preventScroll: true });
    }
  }
  function cancelGestures() { finishDrag(false); finishResize(false); }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelGestures(); });
  window.addEventListener('blur', cancelGestures);
  window.addEventListener('pagehide', cancelGestures);
  let layoutViewportWidth = innerWidth;
  window.addEventListener('resize', () => {
    // Phone browser chrome changes height while scrolling; only a width
    // change requires a new grid layout and cancellation of a gesture.
    if (innerWidth === layoutViewportWidth) return;
    layoutViewportWidth = innerWidth; cancelGestures(); apply();
  });
  apply();

  // For foh.js: saving this arrangement for the scheduled team member, and
  // loading theirs when they open the page on another device
  window.fohLayout = {
    snapshot: () => JSON.parse(JSON.stringify(layout)),
    load(saved) {
      if (editing) return false; // never pull the layout out from under someone arranging it
      cancelGestures();
      layout = normalize(saved);
      apply(); save();
      return true;
    },
    setStatus(text) { status.textContent = text; },
  };
})();
