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
let consoleFaders  = {};  // ch → dB
let consoleMutes   = {};  // ch → bool
let consoleSolos   = {};  // ch → bool
let auxFaders      = {};  // aux → dB
let auxMutes       = {};  // aux → bool
let heartbeatTimer = null;
let hasConnected   = false;
let disconnectTimer = null;

// ── WebSocket ─────────────────────────────────────────────────────────────

function resetHeartbeat() {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => { if (ws) ws.close(); }, 35000);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', () => {
    hasConnected = true;
    clearTimeout(disconnectTimer);
    document.body.classList.remove('disconnected');
    document.getElementById('connDot').classList.add('connected');
    resetHeartbeat();
    ws.send(JSON.stringify({ type: 'request-console-state' }));
  });

  ws.addEventListener('close', () => {
    clearTimeout(heartbeatTimer);
    document.getElementById('connDot').classList.remove('connected');
    clearTimeout(disconnectTimer);
    disconnectTimer = setTimeout(() => {
      document.body.classList.add('disconnected');
      if (hasConnected) document.getElementById('overlayMsg').textContent = 'Reconnecting…';
    }, 2500);
    setTimeout(connect, 1000);
  });

  ws.addEventListener('message', e => {
    try {
      const json = JSON.parse(e.data);
      resetHeartbeat();
      if (json.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      onMessage(json);
    } catch (_) {}
  });
}

// ── Message handler ───────────────────────────────────────────────────────

function onMessage(json) {
  if (json.config) {
    chConfig  = json.config.channels || [];
    auxConfig = (json.config.aux || []);
    document.getElementById('conSnapshot').textContent = json.config.snapshot || '—';
    buildInputStrips();
    buildAuxStrips();
    return;
  }

  if (json.type === 'connection-count') {
    const el = document.getElementById('conDeviceCount');
    el.style.display = json.count > 0 ? '' : 'none';
    el.textContent = json.count === 1 ? '1 device' : `${json.count} devices`;
    return;
  }

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
}

// ── Grid builders ─────────────────────────────────────────────────────────

function buildInputStrips() {
  const grid = document.getElementById('inputStrips');
  grid.innerHTML = '';
  for (const ch of chConfig) {
    if (!ch.enabled) continue;
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
  num.textContent = ch.channel;

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
  fader.addEventListener('input', () => {
    const newDb = sliderToDb(parseFloat(fader.value));
    fill.style.height = `calc((100% - 12px) * ${fader.value})`;
    dbEl.textContent = formatDb(newDb);
    consoleFaders[ch.channel] = newDb;
    send({ type: 'console-fader', ch: ch.channel, db: newDb });
  });

  faderWrap.append(track, fill, fader);

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
  muteBtn.addEventListener('click', () => {
    const nowMuted = !muteBtn.classList.contains('active');
    send({ type: 'console-mute', ch: ch.channel, muted: nowMuted });
  });

  const soloBtn = document.createElement('button');
  soloBtn.className = 'ch-btn solo-btn' + (soloed ? ' active' : '');
  soloBtn.dataset.ch = ch.channel;
  soloBtn.textContent = 'S';
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

  strip.append(num, faderWrap, dbEl, btns, name);
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
  fader.addEventListener('input', () => {
    const newDb = sliderToDb(parseFloat(fader.value));
    dbEl.textContent = formatDb(newDb);
    auxFaders[aux.channel] = newDb;
    send({ type: 'aux-fader', aux: aux.channel, db: newDb });
  });
  faderWrap.appendChild(fader);

  const dbEl = document.createElement('div');
  dbEl.className = 'aux-db';
  dbEl.dataset.aux = aux.channel;
  dbEl.textContent = formatDb(db);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'aux-btn' + (muted ? ' active' : '');
  muteBtn.dataset.aux = aux.channel;
  muteBtn.textContent = 'M';
  muteBtn.addEventListener('click', () => {
    const nowMuted = !muteBtn.classList.contains('active');
    send({ type: 'aux-mute', aux: aux.channel, muted: nowMuted });
  });

  strip.append(dot, name, faderWrap, dbEl, muteBtn);
  return strip;
}

// ── UI updaters ───────────────────────────────────────────────────────────

function updateChFader(ch, db) {
  const sliderVal = dbToSlider(db);
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"] .ch-fader`).forEach(f => {
    f.value = sliderVal;
    const fill = f.closest('.ch-fader-wrap').querySelector('.ch-fader-fill');
    if (fill) fill.style.height = `calc((100% - 12px) * ${sliderVal})`;
  });
  document.querySelectorAll(`.ch-db[data-ch="${ch}"]`).forEach(el => { el.textContent = formatDb(db); });
}

function updateChMute(ch, muted) {
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"]`).forEach(s => {
    s.classList.toggle('muted', muted);
  });
  document.querySelectorAll(`.ch-strip[data-ch="${ch}"] .mute-btn`).forEach(b => {
    b.classList.toggle('active', muted);
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
  });
}

function updateAuxFader(aux, db) {
  const sliderVal = dbToSlider(db);
  document.querySelectorAll(`.aux-strip[data-aux="${aux}"] .aux-fader`).forEach(f => { f.value = sliderVal; });
  document.querySelectorAll(`.aux-db[data-aux="${aux}"]`).forEach(el => { el.textContent = formatDb(db); });
}

function updateAuxMute(aux, muted) {
  document.querySelectorAll(`.aux-strip[data-aux="${aux}"]`).forEach(s => s.classList.toggle('muted', muted));
  document.querySelectorAll(`.aux-strip[data-aux="${aux}"] .aux-btn`).forEach(b => b.classList.toggle('active', muted));
}

// ── Helpers ───────────────────────────────────────────────────────────────

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Boot ──────────────────────────────────────────────────────────────────

connect();

document.getElementById('snapPrevBtn').addEventListener('click', () => send({ type: 'fire-snapshot', action: 'prev' }));
document.getElementById('snapNextBtn').addEventListener('click', () => send({ type: 'fire-snapshot', action: 'next' }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) connect();
  }
});
