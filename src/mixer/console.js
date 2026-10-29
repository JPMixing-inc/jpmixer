'use strict';

// ── dB helpers (same curve as mixer) ─────────────────────────────────────

function sliderToDb(v) {
  const db = ((Math.log(v * 100) / Math.log(100)) * 100) - 90;
  return db === -Infinity ? -150 : db;
}

function dbToSlider(db) {
  if (db <= -90) return 0;
  return Math.pow(100, (db + 90) / 100) / 100;
}

function formatDb(db) {
  if (db <= -90) return '-∞';
  return (db >= 0 ? '+' : '') + db.toFixed(1);
}

// ── State ─────────────────────────────────────────────────────────────────

let ws             = null;
let chConfig       = [];  // [{channel, label, enabled, ...}]
let auxConfig      = [];  // [{channel, label, colour, enabled, ...}]
let cgConfig       = [];  // [{channel, label}]
let channelProcessing = true; // false: no gain/EQ/dynamics panel on this console; 'preamp': its preamp only (LV1)
let consoleFaders  = {};  // ch → dB
let consoleMutes   = {};  // ch → bool
let consoleSolos   = {};  // ch → bool
let auxFaders      = {};  // aux → dB
let auxMutes       = {};  // aux → bool
let cgFaders       = {};  // cg → dB
let cgMutes        = {};  // cg → bool
let cgSolos        = {};  // cg → bool
let extraConfig    = [];  // dLive's other strips: [{ kind, title, fader, strips: [{ n, label }] }]
let extraFaders    = {};  // "kind:n" → dB
let extraMutes     = {};  // "kind:n" → bool
let heartbeatTimer = null;
let hasConnected   = false;
let disconnectTimer = null;
let reconnectTimer = null;

// ── WebSocket ─────────────────────────────────────────────────────────────

function resetHeartbeat() {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => { if (ws) ws.close(); }, 35000);
}

function connect() {
  // Only ever one live socket — the close handler's retry and the
  // visibilitychange handler can both land here, and an orphaned second
  // socket would keep receiving updates and send its own request-console-state.
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  // (a CLOSING socket is replaced; its own late close event is ignored below)

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sock = new WebSocket(`${proto}//${location.host}`);
  ws = sock;

  // Every handler checks it still belongs to the current socket: a stale one
  // (e.g. left CLOSING by the heartbeat while a new one opened) firing late
  // would otherwise clear the live socket's heartbeat and put the
  // "Reconnecting…" overlay over a page that is actually connected.
  sock.addEventListener('open', () => {
    if (sock !== ws) return;
    hasConnected = true;
    clearTimeout(disconnectTimer);
    document.body.classList.remove('disconnected');
    document.getElementById('connDot').classList.add('connected');
    document.getElementById('conConnectionLabel').textContent = 'Server connected';
    resetHeartbeat();
    sock.send(JSON.stringify({ type: 'request-console-state' }));
  });

  sock.addEventListener('close', () => {
    if (sock !== ws) return;
    clearTimeout(heartbeatTimer);
    document.getElementById('connDot').classList.remove('connected');
    document.getElementById('conConnectionLabel').textContent = 'Reconnecting';
    clearTimeout(disconnectTimer);
    disconnectTimer = setTimeout(() => {
      document.body.classList.add('disconnected');
      if (hasConnected) document.getElementById('overlayMsg').textContent = 'Reconnecting…';
    }, 2500);
    reconnectTimer = setTimeout(connect, 1000);
  });

  sock.addEventListener('message', e => {
    if (sock !== ws) return;
    try {
      const json = JSON.parse(e.data);
      resetHeartbeat();
      if (json.type === 'ping') { sock.send(JSON.stringify({ type: 'pong' })); return; }
      onMessage(json);
    } catch (_) {}
  });
}

// ── Message handler ───────────────────────────────────────────────────────

function onMessage(json) {
  // This device hasn't entered the Console Controller's code (or it changed)
  if (json.type === 'console-locked') { showConsoleLock(true); return; }
  if (json.config) {
    globalThis.jpmSplash?.done();
    // Desk loaded a different session — everything cached here belongs to the
    // old one, so drop it and ask the server for the new session's state
    if (json.config.sessionReload) {
      consoleFaders = {}; consoleMutes = {}; consoleSolos = {};
      auxFaders     = {}; auxMutes     = {};
      cgFaders      = {}; cgMutes      = {}; cgSolos      = {};
      extraFaders   = {}; extraMutes   = {};
      send({ type: 'request-console-state' });
    }
    // Consoles whose gain/EQ/dynamics this page can't open leave the panel out; LV1 shows its preamps
    channelProcessing = json.config.channelProcessing === undefined ? true : json.config.channelProcessing;
    chConfig  = json.config.channels || [];
    auxConfig = json.config.aux || [];
    cgConfig  = json.config.controlGroups || [];
    extraConfig = Array.isArray(json.config.consoleExtras) ? json.config.consoleExtras : [];
    document.getElementById('conSnapshot').textContent = json.config.snapshot || '—';
    buildInputStrips();
    buildCGStrips();
    buildAuxStrips();
    buildExtraStrips();
    document.getElementById('conInputCount').textContent = document.querySelectorAll('.ch-strip').length;
    document.getElementById('conGroupCount').textContent = cgConfig.length;
    document.getElementById('conAuxCount').textContent = document.querySelectorAll('#auxStrips .aux-strip').length;
    // dLive's other strips: their tab only when there are some
    const extrasTab = document.querySelector('.con-tab[data-tab="extras"]');
    extrasTab.hidden = !extraConfig.length;
    document.getElementById('conExtraCount').textContent = extraConfig.reduce((n, x) => n + x.strips.length, 0);
    if (!extraConfig.length && extrasTab.classList.contains('tab-active')) switchTab('inputs');
    return;
  }

  if (json.type === 'connection-count') {
    const el = document.getElementById('conDeviceCount');
    el.style.display = json.count > 0 ? '' : 'none';
    el.textContent = json.count === 1 ? '1 device' : `${json.count} devices`;
    return;
  }

  if (json.type === 'channel-detail') { window.channelPanel?.onDetail(json); return; }

  if (json.address === '/SnapshotName') {
    document.getElementById('conSnapshot').textContent = json.args?.[0] || '—';
    return;
  }

  const { address, args } = json;
  if (!address || !args) return;

  // Main channel fader
  const chFaderM = address.match(/^\/Input_Channels\/(\d+)\/fader$/);
  if (chFaderM) {
    const ch = parseInt(chFaderM[1]);
    consoleFaders[ch] = args[0];
    updateChFader(ch, args[0]);
    return;
  }

  // Main channel mute
  const chMuteM = address.match(/^\/Input_Channels\/(\d+)\/mute$/);
  if (chMuteM) {
    const ch = parseInt(chMuteM[1]);
    consoleMutes[ch] = !!args[0];
    updateChMute(ch, !!args[0]);
    return;
  }

  // Main channel solo
  const chSoloM = address.match(/^\/Input_Channels\/(\d+)\/solo$/);
  if (chSoloM) {
    const ch = parseInt(chSoloM[1]);
    consoleSolos[ch] = !!args[0];
    updateChSolo(ch, !!args[0]);
    return;
  }

  // Aux fader
  const auxFaderM = address.match(/^\/Aux_Outputs\/(\d+)\/fader$/);
  if (auxFaderM) {
    const aux = parseInt(auxFaderM[1]);
    auxFaders[aux] = args[0];
    updateAuxFader(aux, args[0]);
    return;
  }

  // Aux mute
  const auxMuteM = address.match(/^\/Aux_Outputs\/(\d+)\/mute$/);
  if (auxMuteM) {
    const aux = parseInt(auxMuteM[1]);
    auxMutes[aux] = !!args[0];
    updateAuxMute(aux, !!args[0]);
    return;
  }

  // Control group fader
  const cgFaderM = address.match(/^\/Control_Groups\/(\d+)\/fader$/);
  if (cgFaderM) {
    const cg = parseInt(cgFaderM[1]);
    cgFaders[cg] = args[0];
    updateCGFader(cg, args[0]);
    return;
  }

  // Control group mute
  const cgMuteM = address.match(/^\/Control_Groups\/(\d+)\/mute$/);
  if (cgMuteM) {
    const cg = parseInt(cgMuteM[1]);
    cgMutes[cg] = !!args[0];
    updateCGMute(cg, !!args[0]);
    return;
  }

  // Control group solo
  const cgSoloM = address.match(/^\/Control_Groups\/(\d+)\/solo$/);
  if (cgSoloM) {
    const cg = parseInt(cgSoloM[1]);
    cgSolos[cg] = !!args[0];
    updateCGSolo(cg, !!args[0]);
    return;
  }

  // dLive's other strips (FX returns, groups, mains, mute groups…)
  const extraM = address.match(/^\/Extra\/(\w+)\/(\d+)\/(fader|mute|name)$/);
  if (extraM) {
    const key = `${extraM[1]}:${extraM[2]}`;
    if (extraM[3] === 'fader') { extraFaders[key] = args[0]; updateExtraFader(key, args[0]); }
    else if (extraM[3] === 'mute') { extraMutes[key] = !!args[0]; updateExtraMute(key, !!args[0]); }
    else {
      const label = String(args[0] || '');
      for (const x of extraConfig) if (x.kind === extraM[1]) for (const st of x.strips) if (String(st.n) === extraM[2]) st.label = label;
      document.querySelectorAll(`.extra-strip[data-key="${key}"] .aux-name`).forEach(el => { el.textContent = label; el.title = label; });
    }
    return;
  }

  // Channel processing (gain, filters, EQ, dynamics…) for the channel panel
  const chParamM = address.match(/^\/Input_Channels\/(\d+)\/((?:Channel_Input|Panner|Filters|EQ|Dynamics|Insert|Channel_Delay)\/[\w-]+)$/);
  if (chParamM) { window.channelPanel?.onParam(parseInt(chParamM[1]), chParamM[2], args[0]); return; }

  // Control group name — desk may use /name or /Channel_Input/name; handle both
  const cgNameM = address.match(/^\/Control_Groups\/(\d+)\/(?:Channel_Input\/)?name$/);
  if (cgNameM) {
    const cg = parseInt(cgNameM[1]);
    const label = args[0] || `CG ${cg}`;
    const cfg = cgConfig.find(c => c.channel === cg);
    if (cfg) cfg.label = label;
    document.querySelectorAll(`.cg-strip[data-cg="${cg}"] .ch-name`).forEach(el => {
      el.textContent = label;
      el.title = label;
    });
    return;
  }
}

// ── Fader helpers ─────────────────────────────────────────────────────────

// Same 30ms send throttle as the mixer's faders — an unthrottled drag sends
// a desk message on every touchmove, and each one comes back as an echo.
function throttle(fn, ms) {
  let last = 0, timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    clearTimeout(timer);
    if (remaining <= 0) { last = now; fn(...args); }
    else timer = setTimeout(() => { last = Date.now(); fn(...args); }, remaining);
  };
}

// While a fader is held (and briefly after release), incoming values for it
// are ignored — desk echoes of older positions arrive mid-drag and would
// otherwise yank the thumb and dB readout back.
// Values that arrive during the hold still update the stored state, so when
// the hold ends the fader is redrawn from it (`_resync`, set per strip) —
// otherwise a real desk move landing just after release was lost on screen.
// The last value in by then is the desk's echo of the final position, or a
// genuine later move.
const ECHO_HOLD_MS = 400;
function holdFader(fader)    { fader._held = true; clearTimeout(fader._resyncTimer); }
function releaseFader(fader) {
  fader._held = false;
  fader._holdUntil = Date.now() + ECHO_HOLD_MS;
  clearTimeout(fader._resyncTimer);
  fader._resyncTimer = setTimeout(() => { if (!isFaderHeld(fader) && fader._resync) fader._resync(); }, ECHO_HOLD_MS + 20);
}
function isFaderHeld(fader)  { return fader._held || Date.now() < (fader._holdUntil || 0); }

// Mouse and touch drags must start on the thumb. Native horizontal panning
// stays available while adjusting; browse mode lets all swipes scroll normally.
function lockToThumb(fader, wrap) {
  const THUMB_TOL = 28; // px tolerance around the visual thumb to start a grab
  fader.style.pointerEvents = 'none';

  const overlay = document.createElement('div');
  overlay.className = 'con-fader-touch';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:2;touch-action:pan-x;cursor:default;';
  wrap.appendChild(overlay);


  function thumbCenterY(rect, val) {
    return rect.top + 5 + (1 - val) * (rect.height - 10);
  }

  function valueFromY(clientY) {
    const rect   = fader.getBoundingClientRect();
    const travel = rect.height - 10;
    return Math.max(0, Math.min(1, 1 - (clientY - rect.top - 5) / travel));
  }

  function nearThumb(clientY) {
    const rect = fader.getBoundingClientRect();
    return Math.abs(clientY - thumbCenterY(rect, parseFloat(fader.value))) <= THUMB_TOL;
  }

  function apply(v) {
    fader.value = String(v);
    fader.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Pointer cancellation belongs to the browser when a horizontal swipe pans.
  let touchDrag = null;
  let lastTouch = 0;
  overlay.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    lastTouch = Date.now();
    if (!consoleLevelsAdjustable() || !nearThumb(e.clientY)) return;
    touchDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, value: Number(fader.value), moved: false };
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener('pointermove', e => {
    const drag = touchDrag;
    if (!drag || drag.id !== e.pointerId) return;
    if (!consoleLevelsAdjustable()) { finishTouch(false); return; }
    const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
    if (!drag.moved) {
      if (dy < 10 || dy <= dx) return;
      drag.moved = true;
      holdFader(fader);
    }
    // Keep the original grab offset; touching the thumb edge must not jump.
    apply(Math.max(0, Math.min(1, drag.value - (e.clientY - drag.y) / (fader.getBoundingClientRect().height - 10))));
  });
  function finishTouch(commit) {
    if (!touchDrag) return;
    const drag = touchDrag;
    touchDrag = null;
    if (drag.moved) {
      if (commit) fader.dispatchEvent(new Event('change', { bubbles: true }));
      releaseFader(fader);
    }
  }
  overlay.addEventListener('pointerup', () => finishTouch(true));
  overlay.addEventListener('pointercancel', () => finishTouch(false));
  overlay.addEventListener('lostpointercapture', () => finishTouch(false));

  // ── Mouse (desktop) ────────────────────────────────────────────────────
  overlay.addEventListener('mousedown', e => {
    if (!consoleLevelsAdjustable() || Date.now() - lastTouch < 700 || e.sourceCapabilities?.firesTouchEvents || !nearThumb(e.clientY)) return;
    holdFader(fader);
    const onMove = ev => apply(valueFromY(ev.clientY));
    const onUp   = ev => {
      apply(valueFromY(ev.clientY));
      fader.dispatchEvent(new Event('change', { bubbles: true }));
      releaseFader(fader);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Grid builders ─────────────────────────────────────────────────────────

function addFaderScale(wrap) {
  const scale = document.createElement('div');
  scale.className = 'con-fader-scale';
  scale.setAttribute('aria-hidden', 'true');
  for (const db of [0, -10, -20, -40, -60]) {
    const mark = document.createElement('span');
    mark.textContent = db;
    mark.style.top = `calc(5px + (100% - 10px) * ${1 - dbToSlider(db)})`;
    scale.appendChild(mark);
  }
  wrap.appendChild(scale);
}

function buildInputStrips() {
  const grid = document.getElementById('inputStrips');
  grid.innerHTML = '';
  // Unlike the musician mixer, the Console Controller isn't a curated view —
  // it drives the desk directly, so it shows every channel regardless of the
  // "On" (mixer-visibility) toggle in Settings → Channels. Matches buildAuxStrips(),
  // which already renders every aux unfiltered.
  for (const ch of chConfig) {
    grid.appendChild(buildChStrip(ch));
  }
}

function buildChStrip(ch) {
  const db = consoleFaders[ch.channel] ?? -90;
  const muted  = !!consoleMutes[ch.channel];
  const soloed = !!consoleSolos[ch.channel];
  const anySolo = Object.values(consoleSolos).some(v => v);

  const strip = document.createElement('div');
  strip.className = 'ch-strip' + (muted ? ' muted' : '') + (soloed ? ' soloed' : '') + (anySolo && !soloed ? ' solo-off' : '');
  strip.dataset.ch = ch.channel;

  // Channel number
  const num = document.createElement('div');
  num.className = 'ch-num';
  num.textContent = `CH ${String(ch.channel).padStart(2, '0')}`;

  // Fader wrapper
  const faderWrap = document.createElement('div');
  faderWrap.className = 'ch-fader-wrap';

  const track = document.createElement('div');
  track.className = 'ch-fader-track';

  const fill = document.createElement('div');
  fill.className = 'ch-fader-fill';
  const sliderVal = dbToSlider(db);
  fill.style.height = `calc((100% - 12px) * ${sliderVal})`;

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'ch-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.001';
  fader.value = String(sliderVal);
  fader.setAttribute('aria-label', `Channel ${ch.channel} level`);
  fader.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
  const sendFader = () => send({ type: 'console-fader', ch: ch.channel, db: sliderToDb(parseFloat(fader.value)) });
  const sendFaderThrottled = throttle(sendFader, 30);
  fader.addEventListener('input', () => {
    const newDb = sliderToDb(parseFloat(fader.value));
    fill.style.height = `calc((100% - 12px) * ${fader.value})`;
    dbEl.textContent = formatDb(newDb);
    fader.setAttribute('aria-valuetext', `${formatDb(newDb)} dB`);
    consoleFaders[ch.channel] = newDb;
    sendFaderThrottled();
  });
  fader.addEventListener('change', sendFader); // final position on release
  lockToThumb(fader, faderWrap);
  fader._resync = () => { if (consoleFaders[ch.channel] !== undefined) updateChFader(ch.channel, consoleFaders[ch.channel]); };

  faderWrap.append(track, fill, fader);
  addFaderScale(faderWrap);

  // dB readout
  const dbEl = document.createElement('div');
  dbEl.className = 'ch-db';
  dbEl.dataset.ch = ch.channel;
  dbEl.textContent = formatDb(db);

  // M / S buttons
  const btns = document.createElement('div');
  btns.className = 'ch-btns';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'ch-btn mute-btn' + (muted ? ' active' : '');
  muteBtn.dataset.ch = ch.channel;
  muteBtn.textContent = 'M';
  muteBtn.setAttribute('aria-label', `Mute channel ${ch.channel}`);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.addEventListener('click', () => {
    const nowMuted = !muteBtn.classList.contains('active');
    send({ type: 'console-mute', ch: ch.channel, muted: nowMuted });
  });

  const soloBtn = document.createElement('button');
  soloBtn.className = 'ch-btn solo-btn' + (soloed ? ' active' : '');
  soloBtn.dataset.ch = ch.channel;
  soloBtn.textContent = 'S';
  soloBtn.setAttribute('aria-label', `Solo channel ${ch.channel}`);
  soloBtn.setAttribute('aria-pressed', String(soloed));
  soloBtn.addEventListener('click', () => {
    const nowSoloed = !soloBtn.classList.contains('active');
    send({ type: 'console-solo', ch: ch.channel, soloed: nowSoloed });
  });

  btns.append(muteBtn, soloBtn);

  // Name
  const name = document.createElement('div');
  name.className = 'ch-name';
  name.textContent = ch.label || `Ch ${ch.channel}`;
  name.title = ch.label || `Ch ${ch.channel}`;

  // Gain, filters, EQ and dynamics for this channel (console-channel.js)
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'ch-open-btn';
  openBtn.textContent = channelProcessing === 'preamp' ? 'GAIN' : 'EQ';
  openBtn.setAttribute('aria-label', channelProcessing === 'preamp' ? `Show ${ch.label || 'channel ' + ch.channel}’s preamp: gain, 48V, phase and trim`
    : channelProcessing === 'preamp-eq' ? `Open ${ch.label || 'channel ' + ch.channel}’s preamp and EQ` : `Open ${ch.label || 'channel ' + ch.channel} processing: gain, EQ and dynamics`);
  const openPanel = () => window.channelPanel?.open(ch.channel, ch.label || `Ch ${ch.channel}`);
  if (channelProcessing) {
    openBtn.addEventListener('click', openPanel);
    name.addEventListener('click', openPanel);
  }

  strip.append(num, faderWrap, dbEl, btns, name);
  if (channelProcessing) strip.append(openBtn);
  return strip;
}

function buildAuxStrips() {
  const grid = document.getElementById('auxStrips');
  grid.innerHTML = '';
  for (const aux of auxConfig) {
    grid.appendChild(buildAuxStrip(aux));
  }
}

function buildAuxStrip(aux) {
  const db    = auxFaders[aux.channel] ?? -90;
  const muted = !!auxMutes[aux.channel];
  const sliderVal = dbToSlider(db);

  const strip = document.createElement('div');
  strip.className = 'aux-strip' + (muted ? ' muted' : '');
  strip.dataset.aux = aux.channel;
  strip.style.setProperty('--aux-color', aux.colour || '#849fc5');
  const number = document.createElement('span');
  number.className = 'aux-number';
  number.textContent = String(aux.channel).padStart(2, '0');

  const dot = document.createElement('div');
  dot.className = 'aux-color-dot';
  dot.style.background = aux.colour || '#555';

  const name = document.createElement('div');
  name.className = 'aux-name';
  name.textContent = aux.label || `AUX ${aux.channel}`;
  name.title = aux.label || `AUX ${aux.channel}`;

  const faderWrap = document.createElement('div');
  faderWrap.className = 'aux-fader-wrap';

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'aux-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.001';
  fader.value = String(sliderVal);
  fader.style.setProperty('--val', sliderVal);
  fader.setAttribute('aria-label', `Aux ${aux.channel} level`);
  fader.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
  const sendFader = () => send({ type: 'aux-fader', aux: aux.channel, db: sliderToDb(parseFloat(fader.value)) });
  const sendFaderThrottled = throttle(sendFader, 30);
  fader.addEventListener('input', () => {
    const newDb = sliderToDb(parseFloat(fader.value));
    fader.style.setProperty('--val', fader.value);
    dbEl.textContent = formatDb(newDb);
    fader.setAttribute('aria-valuetext', `${formatDb(newDb)} dB`);
    auxFaders[aux.channel] = newDb;
    sendFaderThrottled();
  });
  fader.addEventListener('change', sendFader); // final position on release
  // Native range input (no lockToThumb overlay) — hold it via pointer events
  // Capturing the pointer means the release reaches this fader even when the
  // mouse is let go off it — otherwise the hold never ended and the strip
  // ignored every later desk update.
  fader.addEventListener('pointerdown', (e) => {
    holdFader(fader);
    try { fader.setPointerCapture(e.pointerId); } catch (_) {}
  });
  fader.addEventListener('pointerup',          () => releaseFader(fader));
  fader.addEventListener('pointercancel',      () => releaseFader(fader));
  fader.addEventListener('lostpointercapture', () => { if (fader._held) releaseFader(fader); });
  fader._resync = () => { if (auxFaders[aux.channel] !== undefined) updateAuxFader(aux.channel, auxFaders[aux.channel]); };
  faderWrap.appendChild(fader);

  const dbEl = document.createElement('div');
  dbEl.className = 'aux-db';
  dbEl.dataset.aux = aux.channel;
  dbEl.textContent = formatDb(db);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'aux-btn' + (muted ? ' active' : '');
  muteBtn.dataset.aux = aux.channel;
  muteBtn.textContent = 'M';
  muteBtn.setAttribute('aria-label', `Mute aux ${aux.channel}`);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.addEventListener('click', () => {
    const nowMuted = !muteBtn.classList.contains('active');
    send({ type: 'aux-mute', aux: aux.channel, muted: nowMuted });
  });

  strip.append(number, dot, name, faderWrap, dbEl, muteBtn);
  return strip;
}

// dLive's other strips, a heading for each kind: the aux strips' look, with
// a fader (FX returns and sends, groups, matrices, mains) or a mute alone
// (mute groups)
function buildExtraStrips() {
  const grid = document.getElementById('extraStrips');
  grid.innerHTML = '';
  for (const section of extraConfig) {
    const head = document.createElement('h2');
    head.className = 'extra-heading';
    head.textContent = section.title;
    grid.appendChild(head);
    for (const st of section.strips) grid.appendChild(buildExtraStrip(section, st));
  }
}

function buildExtraStrip(section, st) {
  const key = `${section.kind}:${st.n}`;
  const db    = extraFaders[key] ?? -90;
  const muted = !!extraMutes[key];
  const label = st.label || `${section.title} ${st.n}`;

  const strip = document.createElement('div');
  strip.className = 'aux-strip extra-strip' + (muted ? ' muted' : '') + (section.fader ? '' : ' no-fader');
  strip.dataset.key = key;
  const number = document.createElement('span');
  number.className = 'aux-number';
  number.textContent = String(st.n).padStart(2, '0');

  const name = document.createElement('div');
  name.className = 'aux-name';
  name.textContent = label;
  name.title = label;
  strip.append(number, name);

  if (section.fader) {
    const sliderVal = dbToSlider(db);
    const faderWrap = document.createElement('div');
    faderWrap.className = 'aux-fader-wrap';
    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'aux-fader';
    fader.min = '0'; fader.max = '1'; fader.step = '0.001';
    fader.value = String(sliderVal);
    fader.style.setProperty('--val', sliderVal);
    fader.setAttribute('aria-label', `${label} level`);
    fader.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
    const dbEl = document.createElement('div');
    dbEl.className = 'aux-db';
    dbEl.textContent = formatDb(db);
    const sendFader = () => send({ type: 'extra-fader', kind: section.kind, n: st.n, db: sliderToDb(parseFloat(fader.value)) });
    const sendFaderThrottled = throttle(sendFader, 30);
    fader.addEventListener('input', () => {
      const newDb = sliderToDb(parseFloat(fader.value));
      fader.style.setProperty('--val', fader.value);
      dbEl.textContent = formatDb(newDb);
      fader.setAttribute('aria-valuetext', `${formatDb(newDb)} dB`);
      extraFaders[key] = newDb;
      sendFaderThrottled();
    });
    fader.addEventListener('change', sendFader); // final position on release
    fader.addEventListener('pointerdown', (e) => {
      holdFader(fader);
      try { fader.setPointerCapture(e.pointerId); } catch (_) {}
    });
    fader.addEventListener('pointerup',          () => releaseFader(fader));
    fader.addEventListener('pointercancel',      () => releaseFader(fader));
    fader.addEventListener('lostpointercapture', () => { if (fader._held) releaseFader(fader); });
    fader._resync = () => { if (extraFaders[key] !== undefined) updateExtraFader(key, extraFaders[key]); };
    faderWrap.appendChild(fader);
    strip.append(faderWrap, dbEl);
  }

  const muteBtn = document.createElement('button');
  muteBtn.className = 'aux-btn' + (muted ? ' active' : '');
  muteBtn.textContent = 'M';
  muteBtn.setAttribute('aria-label', `Mute ${label}`);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.addEventListener('click', () => {
    send({ type: 'extra-mute', kind: section.kind, n: st.n, muted: !muteBtn.classList.contains('active') });
  });
  strip.append(muteBtn);
  return strip;
}

function updateExtraFader(key, db) {
  const sliderVal = dbToSlider(db);
  document.querySelectorAll(`.extra-strip[data-key="${key}"]`).forEach(strip => {
    const f = strip.querySelector('.aux-fader');
    if (!f || isFaderHeld(f)) return;
    f.value = sliderVal;
    f.style.setProperty('--val', sliderVal);
    f.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
    const dbEl = strip.querySelector('.aux-db');
    if (dbEl) dbEl.textContent = formatDb(db);
  });
}

function updateExtraMute(key, muted) {
  document.querySelectorAll(`.extra-strip[data-key="${key}"]`).forEach(s => s.classList.toggle('muted', muted));
  document.querySelectorAll(`.extra-strip[data-key="${key}"] .aux-btn`).forEach(b => { b.classList.toggle('active', muted); b.setAttribute('aria-pressed', String(muted)); });
}

function buildCGStrips() {
  const grid = document.getElementById('cgStrips');
  grid.innerHTML = '';
  for (const cg of cgConfig) {
    grid.appendChild(buildCGStrip(cg));
  }
}

function buildCGStrip(cg) {
  const db     = cgFaders[cg.channel] ?? -90;
  const muted  = !!cgMutes[cg.channel];
  const soloed = !!cgSolos[cg.channel];
  const sliderVal = dbToSlider(db);

  const strip = document.createElement('div');
  strip.className = 'cg-strip' + (muted ? ' muted' : '') + (soloed ? ' soloed' : '');
  strip.dataset.cg = cg.channel;

  const num = document.createElement('div');
  num.className = 'cg-num';
  num.textContent = `G${cg.channel}`;

  const faderWrap = document.createElement('div');
  faderWrap.className = 'ch-fader-wrap';

  const track = document.createElement('div');
  track.className = 'ch-fader-track';

  const fill = document.createElement('div');
  fill.className = 'cg-fader-fill';
  fill.style.height = `calc((100% - 12px) * ${sliderVal})`;

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'ch-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.001';
  fader.value = String(sliderVal);
  fader.setAttribute('aria-label', `Control group ${cg.channel} level`);
  fader.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
  const sendFader = () => send({ type: 'cg-fader', cg: cg.channel, db: sliderToDb(parseFloat(fader.value)) });
  const sendFaderThrottled = throttle(sendFader, 30);
  fader.addEventListener('input', () => {
    const newDb = sliderToDb(parseFloat(fader.value));
    fill.style.height = `calc((100% - 12px) * ${fader.value})`;
    dbEl.textContent = formatDb(newDb);
    fader.setAttribute('aria-valuetext', `${formatDb(newDb)} dB`);
    cgFaders[cg.channel] = newDb;
    sendFaderThrottled();
  });
  fader.addEventListener('change', sendFader); // final position on release
  lockToThumb(fader, faderWrap);
  fader._resync = () => { if (cgFaders[cg.channel] !== undefined) updateCGFader(cg.channel, cgFaders[cg.channel]); };

  faderWrap.append(track, fill, fader);
  addFaderScale(faderWrap);

  const dbEl = document.createElement('div');
  dbEl.className = 'ch-db';
  dbEl.textContent = formatDb(db);

  const btns = document.createElement('div');
  btns.className = 'ch-btns';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'ch-btn mute-btn' + (muted ? ' active' : '');
  muteBtn.textContent = 'M';
  muteBtn.setAttribute('aria-label', `Mute control group ${cg.channel}`);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.addEventListener('click', () => {
    send({ type: 'cg-mute', cg: cg.channel, muted: !muteBtn.classList.contains('active') });
  });

  const soloBtn = document.createElement('button');
  soloBtn.className = 'ch-btn solo-btn' + (soloed ? ' active' : '');
  soloBtn.textContent = 'S';
  soloBtn.setAttribute('aria-label', `Solo control group ${cg.channel}`);
  soloBtn.setAttribute('aria-pressed', String(soloed));
  soloBtn.addEventListener('click', () => {
    send({ type: 'cg-solo', cg: cg.channel, soloed: !soloBtn.classList.contains('active') });
  });

  btns.append(muteBtn, soloBtn);

  const name = document.createElement('div');
  name.className = 'ch-name';
  name.textContent = cg.label || `CG ${cg.channel}`;
  name.title = cg.label || `CG ${cg.channel}`;

  strip.append(num, faderWrap, dbEl, btns, name);
  return strip;
}

// ── UI updaters ───────────────────────────────────────────────────────────

function updateChFader(ch, db) {
  const sliderVal = dbToSlider(db);
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"]`).forEach(strip => {
    const f = strip.querySelector('.ch-fader');
    if (!f || isFaderHeld(f)) return;
    f.value = sliderVal;
    f.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
    const fill = strip.querySelector('.ch-fader-fill');
    if (fill) fill.style.height = `calc((100% - 12px) * ${sliderVal})`;
    const dbEl = strip.querySelector('.ch-db');
    if (dbEl) dbEl.textContent = formatDb(db);
  });
}

function updateChMute(ch, muted) {
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"]`).forEach(s => {
    s.classList.toggle('muted', muted);
  });
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"] .mute-btn`).forEach(b => {
    b.classList.toggle('active', muted);
    b.setAttribute('aria-pressed', String(muted));
  });
}

function updateChSolo(ch, soloed) {
  consoleSolos[ch] = soloed;
  const anySolo = Object.values(consoleSolos).some(v => v);
  document.querySelectorAll('.ch-strip').forEach(s => {
    const c = parseInt(s.dataset.ch);
    s.classList.toggle('soloed',   !!consoleSolos[c]);
    s.classList.toggle('solo-off', anySolo && !consoleSolos[c]);
  });
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"] .solo-btn`).forEach(b => {
    b.classList.toggle('active', soloed);
    b.setAttribute('aria-pressed', String(soloed));
  });
}

function updateAuxFader(aux, db) {
  const sliderVal = dbToSlider(db);
  document.querySelectorAll(`.aux-strip[data-aux="${aux}"]`).forEach(strip => {
    const f = strip.querySelector('.aux-fader');
    if (!f || isFaderHeld(f)) return;
    f.value = sliderVal;
    f.style.setProperty('--val', sliderVal);
    f.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
    const dbEl = strip.querySelector('.aux-db');
    if (dbEl) dbEl.textContent = formatDb(db);
  });
}

function updateAuxMute(aux, muted) {
  document.querySelectorAll(`.aux-strip[data-aux="${aux}"]`).forEach(s => s.classList.toggle('muted', muted));
  document.querySelectorAll(`.aux-strip[data-aux="${aux}"] .aux-btn`).forEach(b => { b.classList.toggle('active', muted); b.setAttribute('aria-pressed', String(muted)); });
}

function updateCGFader(cg, db) {
  const sliderVal = dbToSlider(db);
  document.querySelectorAll(`.cg-strip[data-cg="${cg}"]`).forEach(strip => {
    const f = strip.querySelector('.ch-fader');
    if (!f || isFaderHeld(f)) return;
    f.value = sliderVal;
    f.setAttribute('aria-valuetext', `${formatDb(db)} dB`);
    const fill = strip.querySelector('.cg-fader-fill');
    if (fill) fill.style.height = `calc((100% - 12px) * ${sliderVal})`;
    const dbEl = strip.querySelector('.ch-db');
    if (dbEl) dbEl.textContent = formatDb(db);
  });
}

function updateCGMute(cg, muted) {
  document.querySelectorAll(`.cg-strip[data-cg="${cg}"]`).forEach(s => s.classList.toggle('muted', muted));
  document.querySelectorAll(`.cg-strip[data-cg="${cg}"] .mute-btn`).forEach(b => { b.classList.toggle('active', muted); b.setAttribute('aria-pressed', String(muted)); });
}

function updateCGSolo(cg, soloed) {
  document.querySelectorAll(`.cg-strip[data-cg="${cg}"]`).forEach(s => s.classList.toggle('soloed', soloed));
  document.querySelectorAll(`.cg-strip[data-cg="${cg}"] .solo-btn`).forEach(b => { b.classList.toggle('active', soloed); b.setAttribute('aria-pressed', String(soloed)); });
}

// ── Helpers ───────────────────────────────────────────────────────────────

window.consoleSend = (msg) => send(msg); // for the channel panel (console-channel.js)
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Touch screens start in browse mode on every load, never a saved unlock.
const consoleTouchLayout = matchMedia('(pointer: coarse), (max-width: 700px)');
function consoleLevelsAdjustable() {
  return !consoleTouchLayout.matches || document.body.classList.contains('con-adjusting');
}
function setConsoleAdjusting(adjusting) {
  document.body.classList.toggle('con-adjusting', adjusting);
  document.getElementById('conAdjustLevels').setAttribute('aria-pressed', String(adjusting));
  document.getElementById('conAdjustLevels').textContent = adjusting ? 'Done adjusting' : 'Adjust levels';
  document.getElementById('conTouchHint').textContent = adjusting
    ? 'Drag a fader thumb to adjust. Tap Done when finished.'
    : 'Swipe to browse. Tap Adjust levels to move faders.';
}
document.getElementById('conAdjustLevels').addEventListener('click', () => setConsoleAdjusting(!document.body.classList.contains('con-adjusting')));
consoleTouchLayout.addEventListener('change', () => setConsoleAdjusting(false));
window.addEventListener('pagehide', () => setConsoleAdjusting(false));

// ── Boot ──────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.con-tab').forEach(t => { t.classList.toggle('tab-active', t.dataset.tab === name); t.setAttribute('aria-pressed', String(t.dataset.tab === name)); });
  document.getElementById('tabInputs').classList.toggle('tab-active', name === 'inputs');
  document.getElementById('tabCG').classList.toggle('tab-active', name === 'cg');
  document.getElementById('tabAux').classList.toggle('tab-active', name === 'aux');
  document.getElementById('tabExtras').classList.toggle('tab-active', name === 'extras');
  document.getElementById('conSectionDescription').textContent = {
    inputs: 'Main channel faders, mutes, and solos.',
    cg: 'Control group faders, mutes, and solos.',
    aux: 'Aux master output levels and mutes.',
    extras: 'FX returns and sends, groups, matrices, mains and mute groups.'
  }[name];
}

function setConsoleDisplaySize(size) {
  const roomy = size === 'roomy';
  document.body.classList.toggle('con-roomy', roomy);
  for (const button of document.querySelectorAll('[data-console-density]')) button.setAttribute('aria-pressed', String(button.dataset.consoleDensity === (roomy ? 'roomy' : 'overview')));
  try { localStorage.setItem('jpm_console_density', roomy ? 'roomy' : 'overview'); } catch (_) {}
}
let savedConsoleDisplaySize = 'overview';
try { savedConsoleDisplaySize = localStorage.getItem('jpm_console_density') || 'overview'; } catch (_) {}
setConsoleDisplaySize(savedConsoleDisplaySize);
for (const button of document.querySelectorAll('[data-console-density]')) button.addEventListener('click', () => setConsoleDisplaySize(button.dataset.consoleDensity));

document.querySelectorAll('.con-tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ── The Console Controller's code ─────────────────────────────────────────
function showConsoleLock(on) {
  document.body.classList.toggle('con-locked', on);
  document.getElementById('conLock').hidden = !on;
  if (on) {
    globalThis.jpmSplash?.done();
    document.body.classList.remove('disconnected');
    setTimeout(() => document.getElementById('conLockCode').focus(), 0);
  }
}
document.getElementById('conLockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('conLockCode');
  const error = document.getElementById('conLockError');
  const button = document.getElementById('conLockSubmit');
  button.disabled = true;
  error.textContent = '';
  try {
    const res = await fetch('/console-unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: input.value }), cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) { error.textContent = data.error || 'That code isn’t right.'; input.select(); return; }
    input.value = '';
    showConsoleLock(false);
    // The socket's cookies are read when it opens: a new one carries the code
    const old = ws;
    ws = null;
    if (old) { try { old.close(); } catch (_) {} }
    connect();
  } catch (_) {
    error.textContent = 'Can’t reach JPMixer right now. Check the connection.';
  } finally {
    button.disabled = false;
  }
});

connect();

document.getElementById('snapPrevBtn').addEventListener('click', () => send({ type: 'fire-snapshot', action: 'prev' }));
document.getElementById('snapNextBtn').addEventListener('click', () => send({ type: 'fire-snapshot', action: 'next' }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) connect();
  }
});
