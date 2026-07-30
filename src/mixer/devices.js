'use strict';

// ── State ─────────────────────────────────────────────────────────────────

let ws                  = null;
let auxByChannel        = new Map(); // channel → { label, colour }
let channelByNumber     = new Map(); // channel → { label }
let heartbeatTimer       = null;
let hasConnected         = false;
let disconnectShowTimer  = null;

// deviceId → ordinal ("Device 1", "Device 2", ...), stable for this page's
// lifetime so cards don't get relabeled as other devices connect/disconnect
const deviceOrdinals = new Map();
let nextOrdinal = 1;

// deviceId → { card, auxEl, dotEl, fadeTimer }
const deviceCards = new Map();

// ── WebSocket ─────────────────────────────────────────────────────────────

function resetHeartbeat() {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    if (ws) { ws.close(); }
  }, 35000);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', () => {
    hasConnected = true;
    clearTimeout(disconnectShowTimer);
    document.body.classList.remove('disconnected');
    document.getElementById('connDot').classList.add('connected');
    resetHeartbeat();
  });

  ws.addEventListener('close', () => {
    clearTimeout(heartbeatTimer);
    document.getElementById('connDot').classList.remove('connected');
    clearTimeout(disconnectShowTimer);
    disconnectShowTimer = setTimeout(() => {
      document.body.classList.add('disconnected');
      if (hasConnected) {
        document.getElementById('overlayMsg').textContent = 'Reconnecting…';
      }
    }, 2500);
    setTimeout(connect, 1000);
  });

  ws.addEventListener('message', e => {
    try {
      const json = JSON.parse(e.data);
      resetHeartbeat();
      if (json.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      onMessage(json);
    } catch (_) {}
  });
}

function onMessage(json) {
  if (json.config) {
    auxByChannel = new Map();
    for (const aux of json.config.aux || []) {
      if (!aux.enabled) continue;
      auxByChannel.set(aux.channel, { label: aux.label || `AUX ${aux.channel}`, colour: aux.colour || '#444' });
    }
    channelByNumber = new Map();
    for (const ch of json.config.channels || []) {
      channelByNumber.set(ch.channel, { label: ch.label || `Ch ${ch.channel}` });
    }
    renderDevices(lastDevices);
    return;
  }

  if (json.type === 'devices-update') {
    lastDevices = json.devices || [];
    renderDevices(lastDevices);
    return;
  }

  if (json.type === 'device-activity') {
    handleActivity(json);
    return;
  }
}

let lastDevices = [];

// ── Rendering ─────────────────────────────────────────────────────────────

function renderDevices(devices) {
  const grid  = document.getElementById('devGrid');
  const empty = document.getElementById('devEmpty');
  document.getElementById('devDeviceCount').textContent =
    devices.length === 1 ? '1 device connected' : `${devices.length} devices connected`;

  empty.style.display = devices.length === 0 ? '' : 'none';

  const seen = new Set();
  for (const dev of devices) {
    const key = dev.deviceId || `anon-${devices.indexOf(dev)}`;
    seen.add(key);
    if (!deviceOrdinals.has(key)) deviceOrdinals.set(key, nextOrdinal++);

    let entry = deviceCards.get(key);
    if (!entry) {
      entry = buildCard(key);
      deviceCards.set(key, entry);
      grid.appendChild(entry.card);
    }
    updateCard(entry, dev, deviceOrdinals.get(key));
  }

  // Remove cards for devices no longer connected
  for (const [key, entry] of deviceCards) {
    if (!seen.has(key)) {
      entry.card.remove();
      clearTimeout(entry.fadeTimer);
      clearTimeout(entry.descTimer);
      clearTimeout(entry.descSettleTimer);
      clearTimeout(entry.descSwapTimer);
      deviceCards.delete(key);
    }
  }
}

function buildCard(key) {
  const card = document.createElement('div');
  card.className = 'dev-card';

  const auxEl = document.createElement('div');
  auxEl.className = 'dev-card-aux';

  const body = document.createElement('div');
  body.className = 'dev-card-body';

  const tagWrap = document.createElement('div');
  const tagEl = document.createElement('div');
  tagEl.className = 'dev-card-tag';
  const subEl = document.createElement('div');
  subEl.className = 'dev-card-sub';
  tagWrap.append(tagEl, subEl);

  const dotEl = document.createElement('div');
  dotEl.className = 'dev-activity';

  body.append(tagWrap, dotEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'dev-card-meta';

  const lastActiveEl = document.createElement('span');
  lastActiveEl.className = 'dev-last-active';

  const qualityEl = document.createElement('span');
  qualityEl.className = 'dev-quality';

  metaEl.append(lastActiveEl, qualityEl);

  const descEl = document.createElement('div');
  descEl.className = 'dev-card-action';

  card.append(auxEl, body, metaEl, descEl);

  return {
    card, auxEl, tagEl, subEl, dotEl, descEl, metaEl, lastActiveEl, qualityEl,
    fadeTimer: null, descTimer: null, descSettleTimer: null, descSwapTimer: null, pendingDesc: null,
    lastActivity: null, lastPong: null
  };
}

function updateCard(entry, dev, ordinal) {
  entry.tagEl.textContent = `Device ${ordinal}`;
  const aux = auxByChannel.get(dev.aux);
  if (dev.aux != null && aux) {
    entry.auxEl.textContent = aux.label;
    entry.auxEl.style.background = aux.colour;
    entry.auxEl.classList.remove('dev-no-aux');
    entry.subEl.textContent = `Mixing Aux ${dev.aux}`;
  } else {
    entry.auxEl.textContent = 'No mix selected';
    entry.auxEl.style.background = '';
    entry.auxEl.classList.add('dev-no-aux');
    entry.subEl.textContent = '';
  }

  entry.lastActivity = dev.lastActivity || null;
  entry.lastPong = dev.lastPong || null;
  renderTiming(entry);
}

// Relative-time + connection-quality text for one card, based on the last
// snapshot the server sent us (lastActivity/lastPong). Re-run on a tick so
// "12s ago" keeps counting up without needing fresh messages from the server.
function renderTiming(entry) {
  const now = Date.now();

  if (entry.lastActivity == null) {
    entry.lastActiveEl.textContent = 'No activity yet';
  } else {
    entry.lastActiveEl.textContent = 'Active ' + formatElapsed(now - entry.lastActivity);
  }

  const pongAge = entry.lastPong == null ? null : now - entry.lastPong;
  let quality;
  if (pongAge == null || pongAge < 30000)      quality = { label: 'Connected',    cls: 'good' };
  else if (pongAge < 60000)                    quality = { label: 'Weak signal',  cls: 'fair' };
  else                                          quality = { label: 'Reconnecting…', cls: 'poor' };

  entry.qualityEl.textContent = quality.label;
  entry.qualityEl.className = `dev-quality dev-quality-${quality.cls}`;
}

function formatElapsed(ms) {
  if (ms < 5000)    return 'just now';
  if (ms < 60000)   return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

// Ticks every card's relative-time text once a second so it counts up
// smoothly between the periodic server snapshots.
setInterval(() => {
  for (const entry of deviceCards.values()) renderTiming(entry);
}, 1000);

// Builds a short human description of a device-activity event, e.g.
// "Turned up Kick", "Panned Vocal left", "Saved mix \"Soundcheck\"".
function describeActivity(json) {
  if (json.kind === 'level' || json.kind === 'pan') {
    const ch = channelByNumber.get(json.channel);
    const label = ch ? ch.label : `Ch ${json.channel}`;
    if (json.kind === 'level') {
      if (json.direction === 'down') return `Turned down ${label}`;
      if (json.direction === 'up')   return `Turned up ${label}`;
      return `Adjusted ${label}`;
    }
    if (json.direction === 'down') return `Panned ${label} left`;
    if (json.direction === 'up')   return `Panned ${label} right`;
    return `Adjusted ${label} pan`;
  }
  if (json.kind === 'save-mix')   return `Saved mix "${json.name}"`;
  if (json.kind === 'save-scene') return 'Saved Ear Scene';
  return null;
}

function handleActivity(json) {
  if (json.deviceId == null) return;
  const entry = deviceCards.get(json.deviceId);
  if (!entry) return;

  // Dot flashes instantly — it's the "something's happening right now" signal.
  entry.dotEl.classList.add('lit');
  clearTimeout(entry.fadeTimer);
  entry.fadeTimer = setTimeout(() => entry.dotEl.classList.remove('lit'), 700);

  // Update "last active" immediately rather than waiting for the next
  // periodic devices-update snapshot from the server.
  entry.lastActivity = Date.now();
  renderTiming(entry);

  const desc = describeActivity(json);
  if (!desc) return;

  // Fader/pan moves fire continuously while dragging (every ~30ms), so their
  // description waits for the drag to actually stop — a long-enough settle
  // window that it only lands once the fader is released, not mid-drag.
  // Discrete one-shot actions (save mix / save scene) have nothing to wait
  // out, so they show up almost immediately.
  const settleMs = (json.kind === 'level' || json.kind === 'pan') ? 450 : 40;
  entry.pendingDesc = desc;
  clearTimeout(entry.descSettleTimer);
  entry.descSettleTimer = setTimeout(() => applyDescription(entry, entry.pendingDesc), settleMs);
}

function applyDescription(entry, text) {
  clearTimeout(entry.descTimer);
  entry.descTimer = setTimeout(() => entry.descEl.classList.remove('visible'), 4000);

  if (entry.descEl.textContent === text && entry.descEl.classList.contains('visible')) return;

  clearTimeout(entry.descSwapTimer);
  if (entry.descEl.classList.contains('visible')) {
    // Crossfade: fade the old text out, then swap and fade the new text in.
    entry.descEl.classList.remove('visible');
    entry.descSwapTimer = setTimeout(() => {
      entry.descEl.textContent = text;
      requestAnimationFrame(() => entry.descEl.classList.add('visible'));
    }, 140);
  } else {
    entry.descEl.textContent = text;
    requestAnimationFrame(() => entry.descEl.classList.add('visible'));
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────

connect();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connect();
    }
  }
});
