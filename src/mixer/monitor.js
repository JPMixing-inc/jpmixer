'use strict';

// ── Custom icons (same set as mixer.js) ──────────────────────────────────

const CUSTOM_ICONS = {
  kick:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  snare:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="9" ry="3.5"/><line x1="3" y1="9" x2="3" y2="15"/><line x1="21" y1="9" x2="21" y2="15"/><ellipse cx="12" cy="15" rx="9" ry="3.5"/><polyline points="5,18.5 8,17 11,18.5 14,17 17,18.5 20,17" stroke-width="1.2"/></svg>`,
  hihat:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="7" rx="9" ry="2.5"/><ellipse cx="12" cy="11" rx="9" ry="2.5"/><line x1="12" y1="13.5" x2="12" y2="23"/></svg>`,
  crash:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 9 Q12 4 21 9"/><circle cx="12" cy="9" r="2" fill="currentColor" stroke="none"/><line x1="12" y1="11" x2="12" y2="23"/></svg>`,
  ride:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M2 10 Q12 5 22 10"/><circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/><line x1="12" y1="13" x2="12" y2="23"/></svg>`,
  tom:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="8" ry="3"/><line x1="4" y1="9" x2="4" y2="17"/><line x1="20" y1="9" x2="20" y2="17"/><ellipse cx="12" cy="17" rx="8" ry="3"/></svg>`,
  floortom:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="8" rx="9" ry="3.5"/><line x1="3" y1="8" x2="3" y2="18"/><line x1="21" y1="8" x2="21" y2="18"/><ellipse cx="12" cy="18" rx="9" ry="3.5"/><line x1="6" y1="18" x2="6" y2="23"/><line x1="18" y1="18" x2="18" y2="23"/></svg>`,
  overheads:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="1" width="3" height="7" rx="1.5"/><rect x="16" y="1" width="3" height="7" rx="1.5"/><path d="M5 8 Q5 11 8 11"/><path d="M19 8 Q19 11 16 11"/><line x1="8" y1="11" x2="8" y2="23"/><line x1="16" y1="11" x2="16" y2="23"/></svg>`,
  cajon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="3" width="12" height="18" rx="2"/><ellipse cx="12" cy="10" rx="4" ry="3" stroke-width="1.2"/></svg>`,
  djembe:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5 Q5 14 8 18"/><path d="M20 5 Q19 14 16 18"/><path d="M8 18 Q10 20 12 20 Q14 20 16 18"/><line x1="10" y1="20" x2="10" y2="23"/><line x1="14" y1="20" x2="14" y2="23"/></svg>`,
  acousticguitar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="11" cy="16.5" rx="6.5" ry="5.5"/><circle cx="11" cy="16.5" r="2" stroke-width="1.2"/><rect x="9.5" y="5" width="3" height="11" rx="1.5"/><line x1="8.5" y1="7" x2="13.5" y2="7" stroke-width="1.2"/><line x1="8.5" y1="9.5" x2="13.5" y2="9.5" stroke-width="1.2"/></svg>`,
  electricguitar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M8 20 Q4 20 4 16 Q4 13 7 12 Q5 9 6 7 Q8 5 10 7 Q12 5 14 7 Q14 9 12 11 Q15 12 15 15 Q15 21 10 21 Z"/><line x1="14" y1="7" x2="22" y2="2"/><line x1="20" y1="3.5" x2="21.5" y2="5.5" stroke-width="1.3"/></svg>`,
  bass:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M9 21 Q4 21 4 16 Q4 12 8 12 Q6 9 7 6 Q9 4 11 6 Q14 4 15 6 Q15 9 13 11 Q17 12 16 17 Q15 22 9 22 Z"/><line x1="15" y1="6" x2="23" y2="3"/><line x1="21" y1="4" x2="22.5" y2="6" stroke-width="1.3"/></svg>`,
  piano:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="14" rx="2"/><line x1="6.5" y1="7" x2="6.5" y2="21"/><line x1="11" y1="7" x2="11" y2="21"/><line x1="15.5" y1="7" x2="15.5" y2="21"/><line x1="20" y1="7" x2="20" y2="21"/><rect x="4" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="17.5" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/></svg>`,
  synth:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="5" width="22" height="17" rx="2"/><line x1="5.5" y1="14" x2="5.5" y2="22"/><line x1="10" y1="14" x2="10" y2="22"/><line x1="14.5" y1="14" x2="14.5" y2="22"/><line x1="19" y1="14" x2="19" y2="22"/><rect x="3.5" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="8" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="12.5" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="17" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><circle cx="5" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  organ:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="9" rx="1.5"/><rect x="2" y="13" width="20" height="9" rx="1.5"/><line x1="6.5" y1="2" x2="6.5" y2="11"/><line x1="11" y1="2" x2="11" y2="11"/><line x1="15.5" y1="2" x2="15.5" y2="11"/><line x1="20" y1="2" x2="20" y2="11"/><rect x="4" y="2" width="3.5" height="5.5" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="2" width="3.5" height="5.5" rx="1" fill="currentColor" stroke="none"/><line x1="6.5" y1="13" x2="6.5" y2="22"/><line x1="11" y1="13" x2="11" y2="22"/><line x1="15.5" y1="13" x2="15.5" y2="22"/><line x1="20" y1="13" x2="20" y2="22"/></svg>`,
  trumpet:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="7" y2="12"/><rect x="7" y="9" width="2.5" height="6" rx="1"/><path d="M9.5 9 Q9.5 6 13 6 Q16.5 6 16.5 9"/><path d="M9.5 15 Q9.5 18 13 18 Q16.5 18 16.5 15"/><path d="M16.5 12 Q19 12 21 14 Q23 17 20 20 Q17 22 15 20"/></svg>`,
  saxophone:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M16 2 Q20 3 21 8 Q22 13 19 18 Q16 22 12 22 Q8 22 6 19 Q4 16 6 14"/><circle cx="6" cy="14" r="3"/><circle cx="11" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/></svg>`,
  flute:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="22" y2="12"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none"/><rect x="20" y="9" width="2" height="6" rx="1"/></svg>`,
  vocal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11 Q5 18 12 18 Q19 18 19 11"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>`,
  backvocal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="2" width="5" height="9" rx="2.5"/><path d="M2 10 Q2 16 7.5 16 Q13 16 13 10"/><rect x="15" y="3" width="4" height="7" rx="2"/><path d="M13 9 Q13 14 17 14 Q21 14 21 9"/><line x1="7.5" y1="16" x2="7.5" y2="22"/><line x1="17" y1="14" x2="17" y2="22"/></svg>`,
  violin:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L12 5"/><path d="M12 5 Q9 6 7 9 Q5 12 7 15 Q9 17 9 19 Q9 22 12 22 Q15 22 15 19 Q15 17 17 15 Q19 12 17 9 Q15 6 12 5 Z"/><path d="M9 12 Q12 13.5 15 12" stroke-width="1.2"/></svg>`,
  cello:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 1 L12 4"/><path d="M12 4 Q8 5.5 6 9 Q4 13 6 17 Q8.5 19.5 8.5 21 Q8.5 23 12 23 Q15.5 23 15.5 21 Q15.5 19.5 18 17 Q20 13 18 9 Q16 5.5 12 4 Z"/><path d="M8.5 12 Q12 14 15.5 12" stroke-width="1.2"/></svg>`,
  amp:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2.5"/><circle cx="5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="7" r="1" fill="currentColor" stroke="none"/></svg>`,
  di:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`,
  percussion:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="15" r="5"/><circle cx="17" cy="10" r="5"/><line x1="11.5" y1="12" x2="13.5" y2="13" stroke-width="2.5"/></svg>`,
};

// ── dB helpers ────────────────────────────────────────────────────────────

function sliderToDb(v) {
  const db = ((Math.log(v * 100) / Math.log(100)) * 100) - 90;
  return db === -Infinity ? -150 : db;
}

function dbToSlider(db) {
  if (db <= -90) return 0;
  return Math.pow(100, (db + 90) / 100) / 100;
}

function formatDb(v) {
  const db = sliderToDb(v);
  if (db <= -90) return '-∞';
  return (db >= 0 ? '+' : '') + db.toFixed(1);
}

// ── State ─────────────────────────────────────────────────────────────────

let ws          = null;
let auxConfig      = [];
let chConfig       = [];
const levels       = {}; // levels[aux][ch] = sliderValue
let monMutes       = {}; // monMutes[aux][ch]
let monSolos       = {}; // monSolos[aux][ch]
let heartbeatTimer      = null;
let hasConnected        = false;
let disconnectShowTimer = null;

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
    monMutes = json.config.mutes || {};
    monSolos = json.config.solos || {};
    applyConfig(json.config);
    // Request all cached fader levels
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'request-all-levels' }));
    }
    return;
  }

  if (json.type === 'mute-solo-state') {
    applyMonMuteSolo(json.aux, json.mutes, json.solos);
    if (json.levels) {
      for (const [chStr, dBVal] of Object.entries(json.levels)) {
        updateFaderEl(json.aux, parseInt(chStr), dbToSlider(dBVal));
      }
    }
    return;
  }

  if (json.type === 'scene-recalled') {
    if (json.levels) {
      for (const [auxStr, auxLevels] of Object.entries(json.levels)) {
        const aux = parseInt(auxStr);
        for (const [chStr, sliderVal] of Object.entries(auxLevels)) {
          const ch = parseInt(chStr);
          if (!levels[aux]) levels[aux] = {};
          levels[aux][ch] = sliderVal;
          updateFaderEl(aux, ch, sliderVal);
        }
      }
    }
    return;
  }

  if (json.type === 'connection-count') {
    const el = document.getElementById('monDeviceCount');
    el.style.display = json.count > 0 ? '' : 'none';
    el.textContent = json.count === 1 ? '1 device' : `${json.count} devices`;
    return;
  }

  if (json.address === '/SnapshotName') {
    document.getElementById('monSnapshot').textContent = json.args[0] || '—';
    return;
  }

  const { address, args } = json;
  if (!address || !args) return;

  const m = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_level$/);
  if (m) {
    const ch  = parseInt(m[1]);
    const aux = parseInt(m[2]);
    const val = dbToSlider(args[0]);
    if (!levels[aux]) levels[aux] = {};
    levels[aux][ch] = val;
    updateFaderEl(aux, ch, val);
  }
}

function applyMonMuteSolo(aux, mutes, solos) {
  monMutes[aux] = mutes;
  monSolos[aux] = solos;
  const anySolo = Object.values(solos || {}).some(v => v);
  document.querySelectorAll(`.mon-ch-row[data-aux="${aux}"]`).forEach(row => {
    const ch = row.dataset.ch;
    const muted   = !!(mutes?.[ch]);
    const soloed  = !!(solos?.[ch]);
    const soloOff = anySolo && !soloed;
    row.classList.toggle('mon-ch-muted',    muted);
    row.classList.toggle('mon-ch-solo-off', !muted && soloOff);
    row.classList.toggle('mon-ch-soloed',   soloed);
    const muteBtn = row.querySelector('.mon-mute-btn');
    const soloBtn = row.querySelector('.mon-solo-btn');
    if (muteBtn) muteBtn.classList.toggle('active', muted);
    if (soloBtn) soloBtn.classList.toggle('active', soloed);
  });
}

function applyConfig(cfg) {
  auxConfig = (cfg.aux      || []).filter(a => a.enabled);
  chConfig  =  cfg.channels || [];
  document.getElementById('monSnapshot').textContent = cfg.snapshot || '—';
  buildGrid();
}

// ── Grid builder ──────────────────────────────────────────────────────────

function buildGrid() {
  const grid = document.getElementById('monGrid');
  grid.innerHTML = '';

  for (const aux of auxConfig) {
    const col = document.createElement('div');
    col.className = 'aux-col';

    const hdr = document.createElement('div');
    hdr.className = 'aux-col-header';
    hdr.style.background = aux.colour || '#444';

    const hdrLabel = document.createElement('span');
    hdrLabel.textContent = aux.label || `AUX ${aux.channel}`;

    const boostBtn = document.createElement('button');
    boostBtn.className = 'boost-btn';
    boostBtn.textContent = '+0.5';
    boostBtn.title = 'Boost entire mix +0.5 dB';
    boostBtn.addEventListener('click', () => boostAux(aux.channel, 0.5));

    hdr.appendChild(hdrLabel);
    hdr.appendChild(boostBtn);
    col.appendChild(hdr);

    const chList = document.createElement('div');
    chList.className = 'aux-col-channels';

    for (const ch of chConfig) {
      if (!ch.enabled) continue;

      // Group section title
      if (ch.title) {
        const title = document.createElement('div');
        title.className = 'mon-section-title';
        title.textContent = ch.title;
        if (ch.colour) title.style.borderTopColor = ch.colour;
        chList.appendChild(title);
      }

      chList.appendChild(buildChannelRow(aux.channel, ch));
    }

    col.appendChild(chList);
    grid.appendChild(col);
  }
}

function buildChannelRow(auxCh, ch) {
  const currentVal = (levels[auxCh] || {})[ch.channel] || 0;

  const row = document.createElement('div');
  row.className = 'mon-ch-row';
  row.dataset.aux = auxCh;
  row.dataset.ch  = ch.channel;

  // Icon
  const iconEl = document.createElement('div');
  iconEl.className = 'mon-ch-icon';
  if (ch.icon) {
    if (ch.icon.startsWith('img:')) {
      iconEl.innerHTML = CUSTOM_ICONS[ch.icon.slice(4)] || '';
    } else if (ch.icon.startsWith('file:')) {
      const img = document.createElement('img');
      img.src = `/instrument-icons/${ch.icon.slice(5)}.svg`;
      img.className = 'instrument-icon';
      img.width = 14; img.height = 14;
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = ch.icon;
    }
  }

  // Name
  const nameEl = document.createElement('div');
  nameEl.className = 'mon-ch-name';
  nameEl.textContent = ch.label || `Ch ${ch.channel}`;

  // Fader
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'mon-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.001';
  fader.value = String(currentVal);
  fader.style.setProperty('--val', currentVal);
  fader.dataset.aux = auxCh;
  fader.dataset.ch  = ch.channel;

  fader.addEventListener('input', () => {
    const val = parseFloat(fader.value);
    fader.style.setProperty('--val', val);
    dbEl.textContent = formatDb(val);
    if (!levels[auxCh]) levels[auxCh] = {};
    levels[auxCh][ch.channel] = val;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        address: `/Input_Channels/${ch.channel}/Aux_Send/${auxCh}/send_level`,
        args: [sliderToDb(val)]
      }));
    }
  });

  // dB
  const dbEl = document.createElement('div');
  dbEl.className = 'mon-ch-db';
  dbEl.dataset.aux = auxCh;
  dbEl.dataset.ch  = ch.channel;
  dbEl.textContent = formatDb(currentVal);

  // Mute / Solo buttons
  const muteBtn = document.createElement('button');
  muteBtn.className = 'ms-btn mon-mute-btn';
  muteBtn.textContent = 'M';
  if (!!(monMutes[auxCh]?.[ch.channel])) muteBtn.classList.add('active');
  muteBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const muted = !muteBtn.classList.contains('active');
    ws.send(JSON.stringify({ type: 'set-mute', aux: auxCh, ch: ch.channel, muted }));
  });

  const soloBtn = document.createElement('button');
  soloBtn.className = 'ms-btn mon-solo-btn';
  soloBtn.textContent = 'S';
  if (!!(monSolos[auxCh]?.[ch.channel])) soloBtn.classList.add('active');
  soloBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const soloed = !soloBtn.classList.contains('active');
    ws.send(JSON.stringify({ type: 'set-solo', aux: auxCh, ch: ch.channel, soloed }));
  });

  row.append(iconEl, nameEl, fader, dbEl, muteBtn, soloBtn);
  return row;
}

function updateFaderEl(aux, ch, val) {
  document.querySelectorAll(`.mon-fader[data-aux="${aux}"][data-ch="${ch}"]`).forEach(f => {
    f.value = val;
    f.style.setProperty('--val', val);
  });
  document.querySelectorAll(`.mon-ch-db[data-aux="${aux}"][data-ch="${ch}"]`).forEach(d => {
    d.textContent = formatDb(val);
  });
}

// ── Boost ─────────────────────────────────────────────────────────────────

function boostAux(auxCh, db) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const ch of chConfig) {
    if (!ch.enabled) continue;
    const current  = (levels[auxCh] || {})[ch.channel] || 0;
    const newDb    = Math.min(10, Math.max(-150, sliderToDb(current) + db));
    const newSlider = dbToSlider(newDb);
    if (!levels[auxCh]) levels[auxCh] = {};
    levels[auxCh][ch.channel] = newSlider;
    updateFaderEl(auxCh, ch.channel, newSlider);
    ws.send(JSON.stringify({
      address: `/Input_Channels/${ch.channel}/Aux_Send/${auxCh}/send_level`,
      args: [newDb]
    }));
  }
}

// ── Snapshot firing ────────────────────────────────────────────────────────

function fireSnapshot(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'fire-snapshot', action }));
}

// ── Boot ──────────────────────────────────────────────────────────────────

connect();

document.getElementById('snapPrevBtn').addEventListener('click', () => fireSnapshot('prev'));
document.getElementById('snapNextBtn').addEventListener('click', () => fireSnapshot('next'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connect();
    }
  }
});
