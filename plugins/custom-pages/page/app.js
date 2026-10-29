'use strict';

// Custom Pages. Opened from a page's link (?k=…) it's that custom page: its
// faders, each stopping at its highest level, with mute buttons and Companion
// buttons if the page has them. Pages are set up in JPMixer's Settings (the
// plugin's tab), not here: without a key it says to ask for the link. The
// plugin checks every move: this page only asks
// (POST /plugin-api/custom-pages/<name>).
(() => {
  const TOKEN = (document.querySelector('meta[name="jpmixer-token"]') || {}).content || '';
  // Only in the page when it's opened on the JPMixer computer
  const LOCAL = (document.querySelector('meta[name="jpmixer-local"]') || {}).content || '';
  const KEY = new URLSearchParams(location.search).get('k') || '';
  const $ = (id) => document.getElementById(id);

  async function call(name, body) {
    const headers = { 'Content-Type': 'application/json', 'X-JPMixer-Token': TOKEN };
    if (LOCAL) headers['X-JPMixer-Local'] = LOCAL;
    const res = await fetch(`/plugin-api/custom-pages/${name}`, { method: 'POST', headers, body: JSON.stringify(body || {}), cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'JPMixer didn’t answer. Is it running?'), { status: res.status });
    return data.result;
  }

  // The fader curve every JPMixer page uses (0..1 ↔ dB, -150 is off)
  const sliderToDb = (v) => (v <= 0 ? -150 : ((Math.log(v * 100) / Math.log(100)) * 100) - 90);
  const dbToSlider = (db) => (db <= -90 ? 0 : Math.min(1, Math.pow(100, (db + 90) / 100) / 100));
  const formatDb = (db) => (db === null || db === undefined ? '—' : db <= -90 ? '-∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`);
  const POS_MAX = dbToSlider(10);

  function setConn(kind, text) {
    $('conn').className = `conn ${kind}`;
    $('connText').textContent = text;
  }
  function showMessage(title, text) {
    $('message').hidden = false;
    $('messageTitle').textContent = title;
    $('messageText').textContent = text;
  }
  function banner(text) { $('banner').hidden = !text; $('banner').textContent = text || ''; }

  // ── The custom page ────────────────────────────────────────────────────
  const strips = new Map(); // "kind:n" -> { f, row, track, fill, thumb, cap, value, muteBtn, db, mute, holdUntil }
  // The same rule as the plugin, so the thumb stops where the console will
  function allowed(f, current, wanted) {
    if (wanted <= f.max) return wanted;
    if (typeof current === 'number' && current > f.max) return Math.min(wanted, current);
    return f.max;
  }

  // The page's faders as the Console Controller's strips, side by side in a
  // row that scrolls sideways: number and name, the fader with its dB scale
  // (the highest level a line on it, the part above hatched), the level, the
  // highest level, and M
  const STRIP_MARKS = [10, 0, -10, -20, -40, -60];
  function buildEvent(page) {
    document.title = `${page.name} · JPMixer`;
    $('title').textContent = page.name;
    $('event').hidden = false;
    const list = $('faders');
    list.textContent = '';
    if (!page.faders.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'This page has no faders yet.';
      list.append(p);
    }
    const make = (cls, text) => { const el = document.createElement('div'); el.className = cls; if (text !== undefined) el.textContent = text; return el; };
    for (const f of page.faders) {
      const row = make('strip');
      const num = make('strip-num', `${f.kind === 'cg' ? 'CG' : 'CH'} ${String(f.n).padStart(2, '0')}`);
      const name = make('strip-name', f.name);
      name.title = f.name;
      const fader = make('fader');
      fader.setAttribute('role', 'slider');
      fader.setAttribute('aria-label', f.name);
      fader.setAttribute('aria-orientation', 'vertical');
      fader.tabIndex = 0;
      const pct = (db) => `${dbToSlider(db) / POS_MAX * 100}%`;
      // Along the track, which runs 7px in from each end of the fader
      const along = (db) => `calc(7px + (100% - 14px) * ${dbToSlider(db) / POS_MAX})`;
      const scale = make('scale');
      for (const db of STRIP_MARKS) { const m = make('mark', db > 0 ? `+${db}` : String(db)); m.style.bottom = pct(db); scale.append(m); }
      const track = make('track');
      const over = make('over-cap'); over.style.bottom = pct(f.max);
      const fill = make('fill');
      const cap = make('cap'); cap.style.bottom = along(f.max);
      const thumb = make('thumb');
      track.append(over, fill);
      fader.append(scale, track, cap, thumb);
      const value = make('strip-db', '—');
      const maxText = make('strip-max', `max ${formatDb(f.max)}`);
      row.append(num, name, fader, value, maxText);
      const s = { f, row, track: fader, fill, thumb, value, db: null, mute: null, holdUntil: 0, muteBtn: null };
      if (page.mutes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mute';
        btn.textContent = 'M';
        btn.setAttribute('aria-label', `Mute ${f.name}`);
        btn.addEventListener('click', () => toggleMute(s));
        row.append(btn);
        s.muteBtn = btn;
      }
      list.append(row);
      strips.set(`${f.kind}:${f.n}`, s);
      wireFader(s);
      draw(s);
    }
    if (page.companion) $('companion').hidden = false;
  }

  function draw(s) {
    const known = typeof s.db === 'number';
    const pos = known ? dbToSlider(s.db) / POS_MAX * 100 : 0;
    s.fill.style.height = `${pos}%`;
    s.thumb.style.bottom = `calc(7px + (100% - 14px) * ${pos / 100})`;
    s.thumb.hidden = !known;
    s.value.textContent = s.db === null ? '—' : formatDb(s.db).replace(' dB', '');
    s.track.setAttribute('aria-valuetext', formatDb(s.db));
    s.row.classList.toggle('is-muted', s.mute === true);
    s.row.classList.toggle('is-above', known && s.db > s.f.max);
    if (s.muteBtn) {
      s.muteBtn.classList.toggle('on', s.mute === true);
      s.muteBtn.setAttribute('aria-pressed', s.mute ? 'true' : 'false');
    }
  }

  // A drag up or down moves the fader by how far the finger goes (a tap
  // doesn't jump it); a sideways swipe scrolls the row instead. The moves go
  // out at most every 60 ms, with the last one always sent.
  function wireFader(s) {
    let pointer = null, startY = 0, startPos = 0, height = 1, sendTimer = null, waiting = null, inFlight = false;
    const flush = async () => {
      sendTimer = null;
      if (inFlight || waiting === null) return;
      const level = waiting;
      waiting = null;
      inFlight = true;
      try {
        const out = await call('move', { key: KEY, kind: s.f.kind, n: s.f.n, level });
        if (!pointer && typeof out.db === 'number') { s.db = out.db; draw(s); }
        banner('');
      } catch (e) { banner(e.message); }
      finally {
        inFlight = false;
        if (waiting !== null) flush();
      }
    };
    const queue = (db) => {
      waiting = db;
      if (!sendTimer && !inFlight) sendTimer = setTimeout(flush, 60);
    };
    const move = (clientY) => {
      const pos = Math.max(0, Math.min(POS_MAX, startPos + (startY - clientY) / height * POS_MAX));
      const db = allowed(s.f, s.startDb, sliderToDb(pos));
      s.db = db <= -89.9 ? -150 : Math.round(db * 10) / 10;
      draw(s);
      queue(s.db);
    };
    s.track.addEventListener('pointerdown', (e) => {
      if (pointer !== null || typeof s.db !== 'number') return;
      pointer = e.pointerId;
      s.track.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startPos = dbToSlider(s.db);
      s.startDb = s.db; // what the console had when the drag began
      height = s.track.getBoundingClientRect().height || 1;
      s.row.classList.add('is-held');
    });
    s.track.addEventListener('pointermove', (e) => { if (e.pointerId === pointer) move(e.clientY); });
    const end = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      s.holdUntil = Date.now() + 700; // the console's echo of the last move, not an older one
      s.row.classList.remove('is-held');
      if (sendTimer) { clearTimeout(sendTimer); flush(); }
    };
    s.track.addEventListener('pointerup', end);
    s.track.addEventListener('pointercancel', end); // the row took the swipe to scroll
    s.track.addEventListener('lostpointercapture', end);
    // Keyboard: arrows move half a dB, never past the cap
    s.track.addEventListener('keydown', (e) => {
      if (typeof s.db !== 'number' || !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.5 : -0.5;
      const from = s.db <= -90 ? -90 : s.db;
      s.db = allowed(s.f, s.db, Math.max(-150, from + step));
      if (s.db < -89.9) s.db = -150;
      s.holdUntil = Date.now() + 700;
      draw(s);
      queue(s.db);
    });
    s.held = () => pointer !== null || Date.now() < s.holdUntil;
  }

  async function toggleMute(s) {
    const muted = !(s.mute === true);
    s.muteBtn.disabled = true;
    try {
      const out = await call('mute', { key: KEY, kind: s.f.kind, n: s.f.n, muted });
      s.mute = out.muted;
      s.muteHoldUntil = Date.now() + 700;
      draw(s);
      banner('');
    } catch (e) { banner(e.message); }
    finally { s.muteBtn.disabled = false; }
  }

  // ── Companion buttons ──
  let compRev = 0, compCols = 0, compRows = 0;
  const keys = new Map();
  const imageCache = new Map();
  // Companion's plain "rgb" bitmaps are raw 8-bit RGB; PNG/WebP come as data: URLs
  function imageFor(bitmap) {
    if (!bitmap) return '';
    if (bitmap.startsWith('data:image/')) return bitmap;
    if (imageCache.has(bitmap)) return imageCache.get(bitmap);
    let bytes;
    try { bytes = Uint8Array.from(atob(bitmap), (c) => c.charCodeAt(0)); } catch (_) { return ''; }
    const side = Math.round(Math.sqrt(bytes.length / 3));
    if (!side || side * side * 3 !== bytes.length) return '';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(side, side);
    for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) { img.data[j] = bytes[i]; img.data[j + 1] = bytes[i + 1]; img.data[j + 2] = bytes[i + 2]; img.data[j + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    if (imageCache.size > 200) imageCache.clear();
    imageCache.set(bitmap, url);
    return url;
  }
  function buildGrid(columns, rows) {
    compCols = columns; compRows = rows;
    const grid = $('companionGrid');
    grid.textContent = '';
    keys.clear();
    grid.style.setProperty('--cols', columns);
    for (let i = 0; i < columns * rows; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key';
      btn.setAttribute('aria-label', `Button ${Math.floor(i / columns) + 1}.${(i % columns) + 1}`);
      const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.hidden = true;
      const label = document.createElement('span');
      btn.append(img, label);
      // Held while the finger is down, as on a Stream Deck
      let down = null;
      btn.addEventListener('pointerdown', (e) => { if (down !== null) return; down = e.pointerId; btn.setPointerCapture(e.pointerId); btn.classList.add('is-down'); press(i, true); e.preventDefault(); });
      const up = (e) => { if (e.pointerId !== down) return; down = null; btn.classList.remove('is-down'); press(i, false); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      grid.append(btn);
      keys.set(i, btn);
    }
  }
  // One press at a time, in order: a release never overtakes its press
  let pressChain = Promise.resolve();
  function press(index, pressed) {
    pressChain = pressChain.then(() => call('press', { key: KEY, index, pressed })).catch((e) => banner(e.message));
  }
  function showCompanion(c) {
    if (!c) return;
    if (c.columns !== compCols || c.rows !== compRows) { buildGrid(c.columns, c.rows); c.full = true; }
    if (c.full) for (const btn of keys.values()) { btn.firstChild.hidden = true; btn.lastChild.textContent = ''; btn.style.background = ''; btn.classList.remove('is-pressed'); }
    for (const k of c.keys || []) {
      const btn = keys.get(k.index);
      if (!btn) continue;
      const img = btn.firstChild, label = btn.lastChild;
      const url = imageFor(k.bitmap);
      img.hidden = !url;
      if (url && img.getAttribute('src') !== url) img.src = url;
      label.textContent = url ? '' : k.text || '';
      btn.style.background = url ? '' : k.color || '';
      btn.style.color = k.textColor || '';
      btn.classList.toggle('is-pressed', !!k.pressed);
      const name = (k.text || '').replace(/\s+/g, ' ').trim();
      if (name) btn.setAttribute('aria-label', name);
    }
    compRev = c.rev;
    $('companionGrid').classList.toggle('is-offline', !c.live);
    $('companionNote').hidden = !c.note;
    $('companionNote').textContent = c.note || '';
  }

  // Levels and buttons: asked for every 400 ms while the page is showing
  let failures = 0, polling = null;
  async function poll() {
    if (document.hidden) return;
    try {
      const st = await call('state', { key: KEY, since: compRev });
      if (st.gone) { stopPolling(); $('event').hidden = true; showMessage('This link doesn’t work any more', 'Ask the engineer for the page’s new link.'); setConn('off', 'Closed'); return; }
      failures = 0;
      if (!st.console.supported) setConn('off', 'Not available on this console');
      else setConn(st.console.connected ? 'on' : 'warn', st.console.connected ? 'Console connected' : 'Console not connected');
      for (const f of st.faders) {
        const s = strips.get(`${f.kind}:${f.n}`);
        if (!s) continue;
        if (!s.held || !s.held()) s.db = f.db;
        if (!(s.muteHoldUntil > Date.now())) s.mute = f.mute;
        draw(s);
      }
      showCompanion(st.companion);
    } catch (e) {
      failures++;
      if (failures >= 3) setConn('warn', 'Can’t reach JPMixer');
    }
  }
  function startPolling() { if (!polling) { polling = setInterval(poll, 400); poll(); } }
  function stopPolling() { clearInterval(polling); polling = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ── Which page this is ──
  (async () => {
    try {
      const opened = await call('open', KEY ? { key: KEY } : {});
      if (opened.mode === 'event') {
        buildEvent(opened.page);
        startPolling();
      } else if (opened.mode === 'editor') {
        // On the JPMixer computer: pages are set up in Settings
        document.title = 'Custom Pages · JPMixer';
        $('title').textContent = 'Custom Pages';
        $('conn').hidden = true;
        showMessage('Set up custom pages in Settings', 'In JPMixer, open Settings → Plugins → Custom Pages. Each page’s link opens it.');
      } else if (opened.mode === 'gone') {
        setConn('off', 'Closed');
        showMessage('This link doesn’t work any more', 'The page may be off, or it has a new link. Ask the engineer.');
      } else {
        setConn('off', '');
        showMessage('Open this page from its link', 'Each custom page has its own link or QR code. Ask the engineer for it.');
      }
    } catch (e) {
      setConn('warn', 'Can’t reach JPMixer');
      showMessage('Can’t open this page', e.message);
    }
  })();
})();
