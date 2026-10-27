'use strict';

// Companion card on the Home pages (FOH, ProPresenter, Lighting, Switcher):
// this page's Companion Satellite surface (src/server/companion-satellite.js).
// Button images arrive live from /companion/stream; a tap presses the button
// in Companion and lifting the finger releases it, so held buttons work too.
// While Companion buttons are off in Settings the card stays out of the way
// (shown only in Arrange mode).
(() => {
  const card = document.querySelector('[data-fh-card="companion"]');
  const grid = document.getElementById('fhCompanionGrid');
  const note = document.getElementById('fhCompanionStatus');
  if (!card || !grid || !note) return;
  const ROLE = (location.pathname.match(/\/(propresenter|lighting|switcher)\.html$/) || [])[1] || 'foh';
  let columns = 8, rows = 4;
  const keys = new Map();      // index -> button element
  const imageCache = new Map(); // rgb base64 -> data URL (Companion often re-sends the same image)
  let source = null;

  // Companion's plain "rgb" bitmaps are raw 8-bit RGB; PNG/WebP come as data: URLs
  function imageFor(bitmap, size) {
    if (!bitmap) return '';
    if (bitmap.startsWith('data:image/')) return bitmap;
    if (imageCache.has(bitmap)) return imageCache.get(bitmap);
    let bytes;
    try { bytes = Uint8Array.from(atob(bitmap), c => c.charCodeAt(0)); } catch (_) { return ''; }
    const side = Math.round(Math.sqrt(bytes.length / 3)) || size;
    if (side * side * 3 !== bytes.length) return '';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(side, side);
    for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
      img.data[j] = bytes[i]; img.data[j + 1] = bytes[i + 1]; img.data[j + 2] = bytes[i + 2]; img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    if (imageCache.size > 400) imageCache.clear();
    imageCache.set(bitmap, url);
    return url;
  }

  // Buttons always fit the card, never scroll: in the Home page grid each
  // button is the largest square that lets every row and column fit the
  // space the card has, whatever size the card is dragged to. Phones stack
  // cards at their natural height, so there the buttons just fill the width.
  const stacked = matchMedia('(max-width: 700px)');
  function fitKeys() {
    if (stacked.matches) { grid.classList.remove('is-fitted'); grid.style.removeProperty('grid-template-columns'); grid.style.removeProperty('grid-auto-rows'); return; }
    const W = grid.clientWidth, H = grid.clientHeight;
    if (!W) return;
    // A card dragged too short to hold any button shows just its message
    grid.classList.toggle('is-cramped', H < rows * 6);
    if (H < rows * 6) return;
    let gap = 6, size = 0;
    for (let pass = 0; pass < 2; pass++) { // the gap shrinks with the buttons
      size = Math.floor(Math.min((W - gap * (columns - 1)) / columns, (H - gap * (rows - 1)) / rows));
      gap = Math.max(2, Math.min(6, Math.round(size * 0.08)));
    }
    size = Math.max(8, size);
    grid.classList.add('is-fitted');
    grid.style.gap = `${gap}px`;
    grid.style.gridTemplateColumns = `repeat(${columns}, ${size}px)`;
    grid.style.gridAutoRows = `${size}px`;
    grid.style.setProperty('--key-font', `${Math.max(7, Math.min(16, size * 0.16)).toFixed(1)}px`);
    grid.style.setProperty('--key-radius', `${Math.max(3, Math.min(8, size * 0.1)).toFixed(1)}px`);
  }
  new ResizeObserver(() => fitKeys()).observe(grid);
  stacked.addEventListener('change', fitKeys);

  function buildGrid() {
    grid.textContent = '';
    keys.clear();
    grid.style.setProperty('--cols', columns);
    for (let i = 0; i < columns * rows; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fh-companion-key';
      btn.dataset.key = i;
      btn.setAttribute('aria-label', `Button ${Math.floor(i / columns) + 1}.${(i % columns) + 1}`);
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.hidden = true;
      const label = document.createElement('span');
      label.className = 'fh-companion-text';
      btn.append(img, label);
      grid.appendChild(btn);
      keys.set(i, btn);
    }
    fitKeys();
  }

  function showKey(k) {
    const btn = keys.get(k.index);
    if (!btn) return;
    const img = btn.firstChild, label = btn.lastChild;
    const url = imageFor(k.bitmap, k.size);
    img.hidden = !url;
    if (url && img.getAttribute('src') !== url) img.src = url;
    // Text only shows when there's no image (the image already has Companion's text drawn in)
    label.textContent = url ? '' : k.text || '';
    btn.style.background = url ? '' : k.color || '';
    btn.style.color = k.textColor || '';
    btn.classList.toggle('is-pressed', !!k.pressed);
    btn.setAttribute('aria-label', (k.text || '').replace(/\s+/g, ' ').trim() || `Button ${Math.floor(k.index / columns) + 1}.${(k.index % columns) + 1}`);
  }
  function clearKeys() { for (const btn of keys.values()) { btn.firstChild.hidden = true; btn.lastChild.textContent = ''; btn.style.background = ''; btn.classList.remove('is-pressed'); } }

  function showSnapshot(s) {
    card.classList.toggle('fh-companion-off', !s.enabled);
    if (s.columns !== columns || s.rows !== rows || !keys.size) { columns = s.columns || 8; rows = s.rows || 4; buildGrid(); }
    clearKeys();
    for (const k of s.keys || []) showKey(k);
    const live = s.enabled && s.state === 'connected' && s.registered && !s.locked;
    grid.classList.toggle('is-offline', !live);
    note.hidden = live;
    note.textContent = !s.enabled ? 'Companion buttons are off. Turn them on in JPMixer Settings → Plugins → Companion.'
      : s.locked ? 'This surface is locked in Companion.'
      : s.state === 'connected' && s.error ? `Companion refused this page’s surface: ${s.error}`
      : s.state === 'connected' && !s.registered ? 'Setting up this page’s buttons in Companion…'
      : s.message || 'Companion isn’t connected.';
  }

  // ── Presses ──
  async function press(index, pressed) {
    try {
      await fetch('/companion/press', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ role: ROLE, key: index, pressed }) });
    } catch (_) {}
  }
  // A mouse presses at once. A finger waits a moment first: on a phone the
  // cards stack and the page scrolls, and a scroll that started on a button
  // used to press it. If the finger moves well before then, it's a scroll and
  // nothing is sent; lifted before then, it's a tap (press + release); held,
  // it stays pressed until it's lifted (Companion's long-press actions).
  // iPads and phones also cancel a touch that slides a little, and that tap
  // was lost (the button showed its focus ring and needed a second tap). The
  // browser still calls it a tap ('click'), so a tap the browser sees whose
  // touch didn't reach Companion is sent then: one tap always presses once.
  // Matched by touch, not by time or button: a held press the browser cancels
  // and then calls a tap is still one press, and a quick second tap is two.
  const TOUCH_WAIT_MS = 100, TOUCH_SLOP_PX = 16;
  let down = null; // { index, pointerId, btn, sent, timer, x, y }
  let lastPointerType = '';
  let gesture = null; // the latest touch: { index, sent } — what its 'click' checks
  grid.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    const btn = e.target.closest('.fh-companion-key');
    if (!btn || grid.classList.contains('is-offline') || document.body.classList.contains('fh-editing')) return;
    if (down) release();
    down = { index: Number(btn.dataset.key), pointerId: e.pointerId, btn, sent: false, timer: null, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    gesture = { index: down.index, sent: false };
    btn.classList.add('is-down');
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      send();
    } else {
      down.timer = setTimeout(send, TOUCH_WAIT_MS);
    }
  });
  function send() {
    if (!down || down.sent) return;
    clearTimeout(down.timer);
    down.sent = true;
    if (gesture && gesture.index === down.index) gesture.sent = true;
    press(down.index, true);
  }
  // A finger that moves before the press is a scroll: let it go, send nothing
  grid.addEventListener('pointermove', (e) => {
    if (!down || down.sent || e.pointerId !== down.pointerId) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TOUCH_SLOP_PX) cancelTouch();
  });
  function cancelTouch() {
    if (!down) return;
    clearTimeout(down.timer);
    down.btn.classList.remove('is-down');
    down = null;
  }
  function release() {
    if (!down) return;
    clearTimeout(down.timer);
    down.btn.classList.remove('is-down');
    if (down.sent) press(down.index, false);
    if (down.touch) down.btn.blur(); // no focus ring left on a tapped button
    down = null;
  }
  // The browser's own tap, for a touch that was cancelled before it pressed
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.fh-companion-key');
    // A mouse already pressed on pointerdown; detail 0 is a keyboard press (handled below)
    if (!btn || lastPointerType === 'mouse' || e.detail === 0) return;
    if (grid.classList.contains('is-offline') || document.body.classList.contains('fh-editing')) return;
    const index = Number(btn.dataset.key);
    // Only for a touch that pressed nothing: if the latest touch pressed any
    // button (even one the browser now says it tapped beside), this is done
    if (gesture && gesture.sent) return;
    gesture = { index, sent: true };
    btn.classList.add('is-down');
    press(index, true).then(() => press(index, false));
    setTimeout(() => btn.classList.remove('is-down'), 120);
    btn.blur();
  });
  // Lifted: a tap that hadn't pressed yet presses and releases now
  grid.addEventListener('pointerup', (e) => { if (!down || e.pointerId !== down.pointerId) return; send(); release(); });
  // The browser took the touch for scrolling (or capture was lost): release only what was pressed
  for (const type of ['pointercancel', 'lostpointercapture']) grid.addEventListener(type, (e) => { if (!down || e.pointerId !== down.pointerId) return; if (down.sent) release(); else cancelTouch(); });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  // Keyboard: Space/Enter press and release like a tap
  grid.addEventListener('keydown', (e) => {
    if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return;
    const btn = e.target.closest('.fh-companion-key');
    if (!btn || grid.classList.contains('is-offline')) return;
    e.preventDefault();
    press(Number(btn.dataset.key), true);
    btn.classList.add('is-down');
    btn.addEventListener('keyup', () => { btn.classList.remove('is-down'); press(Number(btn.dataset.key), false); }, { once: true });
  });
  grid.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Live updates ──
  function connect() {
    if (!window.EventSource) return;
    source?.close();
    source = new EventSource(`/companion/stream?role=${ROLE}`);
    source.addEventListener('snapshot', (e) => { try { showSnapshot(JSON.parse(e.data)); } catch (_) {} });
    source.addEventListener('key', (e) => { try { showKey(JSON.parse(e.data)); } catch (_) {} });
    source.addEventListener('clear', clearKeys);
    source.addEventListener('error', () => {
      // A locked FOH Home answers 401 and EventSource stops; try again once unlocked
      if (source.readyState === EventSource.CLOSED) setTimeout(connect, 5000);
    });
  }
  // A phone that slept or a tab that was in the background may have lost the
  // live connection without noticing: reconnect when the page is back
  document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) connect(); });

  buildGrid();
  note.textContent = 'Loading Companion buttons…';
  connect();
})();
