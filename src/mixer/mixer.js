'use strict';

// ── Custom instrument icons ───────────────────────────────────────────────

const CUSTOM_ICONS = {
  kick:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  snare:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="9" ry="3.5"/><line x1="3" y1="9" x2="3" y2="15"/><line x1="21" y1="9" x2="21" y2="15"/><ellipse cx="12" cy="15" rx="9" ry="3.5"/><polyline points="5,18.5 8,17 11,18.5 14,17 17,18.5 20,17" stroke-width="1.2"/></svg>`,
  hihat:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="7" rx="9" ry="2.5"/><ellipse cx="12" cy="11" rx="9" ry="2.5"/><line x1="12" y1="13.5" x2="12" y2="23"/></svg>`,
  crash:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 9 Q12 4 21 9"/><circle cx="12" cy="9" r="2" fill="currentColor" stroke="none"/><line x1="12" y1="11" x2="12" y2="23"/></svg>`,
  ride:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M2 10 Q12 5 22 10"/><circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/><line x1="12" y1="13" x2="12" y2="23"/></svg>`,
  tom:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="8" ry="3"/><line x1="4" y1="9" x2="4" y2="17"/><line x1="20" y1="9" x2="20" y2="17"/><ellipse cx="12" cy="17" rx="8" ry="3"/></svg>`,
  floortom:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="8" rx="9" ry="3.5"/><line x1="3" y1="8" x2="3" y2="18"/><line x1="21" y1="8" x2="21" y2="18"/><ellipse cx="12" cy="18" rx="9" ry="3.5"/><line x1="6" y1="18" x2="6" y2="23"/><line x1="18" y1="18" x2="18" y2="23"/></svg>`,
  overheads:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="1" width="3" height="7" rx="1.5"/><rect x="16" y="1" width="3" height="7" rx="1.5"/><path d="M5 8 Q5 11 8 11"/><path d="M19 8 Q19 11 16 11"/><line x1="8" y1="11" x2="8" y2="23"/><line x1="16" y1="11" x2="16" y2="23"/></svg>`,
  cajon:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="3" width="12" height="18" rx="2"/><ellipse cx="12" cy="10" rx="4" ry="3" stroke-width="1.2"/></svg>`,
  djembe:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5 Q5 14 8 18"/><path d="M20 5 Q19 14 16 18"/><path d="M8 18 Q10 20 12 20 Q14 20 16 18"/><line x1="10" y1="20" x2="10" y2="23"/><line x1="14" y1="20" x2="14" y2="23"/></svg>`,
  acousticguitar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="11" cy="16.5" rx="6.5" ry="5.5"/><circle cx="11" cy="16.5" r="2" stroke-width="1.2"/><rect x="9.5" y="5" width="3" height="11" rx="1.5"/><line x1="8.5" y1="7" x2="13.5" y2="7" stroke-width="1.2"/><line x1="8.5" y1="9.5" x2="13.5" y2="9.5" stroke-width="1.2"/></svg>`,
  electricguitar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M8 20 Q4 20 4 16 Q4 13 7 12 Q5 9 6 7 Q8 5 10 7 Q12 5 14 7 Q14 9 12 11 Q15 12 15 15 Q15 21 10 21 Z"/><line x1="14" y1="7" x2="22" y2="2"/><line x1="20" y1="3.5" x2="21.5" y2="5.5" stroke-width="1.3"/></svg>`,
  bass:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M9 21 Q4 21 4 16 Q4 12 8 12 Q6 9 7 6 Q9 4 11 6 Q14 4 15 6 Q15 9 13 11 Q17 12 16 17 Q15 22 9 22 Z"/><line x1="15" y1="6" x2="23" y2="3"/><line x1="21" y1="4" x2="22.5" y2="6" stroke-width="1.3"/></svg>`,
  piano:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="14" rx="2"/><line x1="6.5" y1="7" x2="6.5" y2="21"/><line x1="11" y1="7" x2="11" y2="21"/><line x1="15.5" y1="7" x2="15.5" y2="21"/><line x1="20" y1="7" x2="20" y2="21"/><rect x="4" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="17.5" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/></svg>`,
  synth:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="5" width="22" height="17" rx="2"/><line x1="5.5" y1="14" x2="5.5" y2="22"/><line x1="10" y1="14" x2="10" y2="22"/><line x1="14.5" y1="14" x2="14.5" y2="22"/><line x1="19" y1="14" x2="19" y2="22"/><rect x="3.5" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="8" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="12.5" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="17" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><circle cx="5" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  organ:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="9" rx="1.5"/><rect x="2" y="13" width="20" height="9" rx="1.5"/><line x1="6.5" y1="2" x2="6.5" y2="11"/><line x1="11" y1="2" x2="11" y2="11"/><line x1="15.5" y1="2" x2="15.5" y2="11"/><line x1="20" y1="2" x2="20" y2="11"/><rect x="4" y="2" width="3.5" height="5.5" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="2" width="3.5" height="5.5" rx="1" fill="currentColor" stroke="none"/><line x1="6.5" y1="13" x2="6.5" y2="22"/><line x1="11" y1="13" x2="11" y2="22"/><line x1="15.5" y1="13" x2="15.5" y2="22"/><line x1="20" y1="13" x2="20" y2="22"/></svg>`,
  trumpet:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="7" y2="12"/><rect x="7" y="9" width="2.5" height="6" rx="1"/><path d="M9.5 9 Q9.5 6 13 6 Q16.5 6 16.5 9"/><path d="M9.5 15 Q9.5 18 13 18 Q16.5 18 16.5 15"/><path d="M16.5 12 Q19 12 21 14 Q23 17 20 20 Q17 22 15 20"/></svg>`,
  saxophone:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M16 2 Q20 3 21 8 Q22 13 19 18 Q16 22 12 22 Q8 22 6 19 Q4 16 6 14"/><circle cx="6" cy="14" r="3"/><circle cx="11" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/></svg>`,
  flute:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="22" y2="12"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none"/><rect x="20" y="9" width="2" height="6" rx="1"/></svg>`,
  vocal:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11 Q5 18 12 18 Q19 18 19 11"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>`,
  backvocal:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="2" width="5" height="9" rx="2.5"/><path d="M2 10 Q2 16 7.5 16 Q13 16 13 10"/><rect x="15" y="3" width="4" height="7" rx="2"/><path d="M13 9 Q13 14 17 14 Q21 14 21 9"/><line x1="7.5" y1="16" x2="7.5" y2="22"/><line x1="17" y1="14" x2="17" y2="22"/></svg>`,
  violin:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L12 5"/><path d="M12 5 Q9 6 7 9 Q5 12 7 15 Q9 17 9 19 Q9 22 12 22 Q15 22 15 19 Q15 17 17 15 Q19 12 17 9 Q15 6 12 5 Z"/><path d="M9 12 Q12 13.5 15 12" stroke-width="1.2"/></svg>`,
  cello:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 1 L12 4"/><path d="M12 4 Q8 5.5 6 9 Q4 13 6 17 Q8.5 19.5 8.5 21 Q8.5 23 12 23 Q15.5 23 15.5 21 Q15.5 19.5 18 17 Q20 13 18 9 Q16 5.5 12 4 Z"/><path d="M8.5 12 Q12 14 15.5 12" stroke-width="1.2"/></svg>`,
  amp:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2.5"/><circle cx="5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="7" r="1" fill="currentColor" stroke="none"/></svg>`,
  di:            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`,
  percussion:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="15" r="5"/><circle cx="17" cy="10" r="5"/><line x1="11.5" y1="12" x2="13.5" y2="13" stroke-width="2.5"/></svg>`,
};

// ── dB conversion (matches DiGiCo OSC: -90 to +10 dB) ────────────────────

function sliderToDb(value) {
  const val = ((Math.log(value * 100) / Math.log(100)) * 100) - 90;
  return val === -Infinity ? -150 : val;
}

function dbToSlider(db) {
  return Math.pow(100, (db + 90) / 100) / 100;
}

function formatDb(sliderValue) {
  const db = sliderToDb(sliderValue);
  if (db <= -90) return '-∞';
  return (db >= 0 ? '+' : '') + db.toFixed(1);
}

// dB tick positions — precomputed fracs via dbToSlider(db)
const VOLUME_TICKS = [
  { label: '-∞',  frac: 0.0   },
  { label: '-40', frac: 0.100 },
  { label: '-30', frac: 0.158 },
  { label: '-20', frac: 0.251 },
  { label: '-15', frac: 0.316 },
  { label: '-10', frac: 0.398 },
  { label: '-6',  frac: 0.479 },
  { label: '-3',  frac: 0.550 },
  { label: '0',   frac: 0.631 },
  { label: '+5',  frac: 0.794 },
  { label: '+10', frac: 1.0   },
];

// ── State ─────────────────────────────────────────────────────────────────

let selectedAux        = null;
let selectedStereo     = false;
let auxConfig          = [];   // { enabled, label, channel, stereo, colour, icon }
let channelConfig      = [];   // { enabled, label, channel, order, title }
let volumeInputs       = [];
let panInputs          = [];
let allScenes          = {};   // { snapshotName: { auxCh: { ch: sliderVal } } }
let sceneRecallEnabled = false;
let currentSnapshot    = '—';
let allMutes           = {}; // allMutes[aux][ch]
let allSolos           = {}; // allSolos[aux][ch]

// ── WebSocket ─────────────────────────────────────────────────────────────

let ws                   = null;
let timeout              = null;
let heartbeatTimer       = null;
let hasConnected         = false;
let disconnectShowTimer  = null;

function resetHeartbeat() {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => noConnection(), 35000);
}

function startWebsocket() {
  ws = new WebSocket('ws://' + document.location.host);
  ws.onopen    = onOpen;
  ws.onmessage = onMessage;
  ws.onclose   = noConnection;
  ws.onerror   = noConnection;

  // Safari iOS sometimes needs a reconnect nudge
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) startWebsocket();
  }, 2000);
}

function onOpen() {
  hasConnected = true;
  clearTimeout(disconnectShowTimer);
  document.body.classList.remove('disconnected');
  document.getElementById('connDot').classList.add('connected');
  resetHeartbeat();
  // Request all cached levels so faders fill in immediately after reconnect
  if (selectedAux !== null) {
    ws.send(JSON.stringify({ type: 'request-aux-levels', aux: selectedAux }));
  }
}

function noConnection() {
  clearTimeout(heartbeatTimer);
  // Log disconnect to sessionStorage for debugging
  const log = JSON.parse(sessionStorage.getItem('jpm_disconnects') || '[]');
  log.push({ t: new Date().toISOString(), aux: selectedAux });
  if (log.length > 20) log.shift();
  sessionStorage.setItem('jpm_disconnects', JSON.stringify(log));
  if (ws) ws.close();
  clearTimeout(timeout);
  timeout = setTimeout(startWebsocket, 1000); // retry faster
  document.getElementById('connDot').classList.remove('connected');
  // Delay showing the overlay — most iOS background wakes reconnect within 2s
  clearTimeout(disconnectShowTimer);
  disconnectShowTimer = setTimeout(() => {
    document.body.classList.add('disconnected');
    if (hasConnected) {
      document.getElementById('overlayMsg').textContent = 'Reconnecting…';
    }
  }, 2500);
}

function sendOSC(address, args) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ address, args: args || [] }));
}

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

// ── Message handler ───────────────────────────────────────────────────────

function showToast(msg) {
  const el = document.getElementById('sceneToast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2800);
}

function updateSceneBtn() {
  const btn = document.getElementById('sceneBtn');
  if (!btn) return;
  const hasScene = !!(currentSnapshot && selectedAux !== null &&
    allScenes[currentSnapshot] && allScenes[currentSnapshot][String(selectedAux)]);
  btn.style.display = selectedAux !== null ? '' : 'none';
  btn.textContent   = hasScene ? '🗑' : '💾';
  btn.title         = hasScene ? 'Delete scene for this snapshot' : 'Save ear scene for this snapshot';
  btn.dataset.saved = hasScene ? '1' : '';
}

function onMessage(e) {
  const json = JSON.parse(e.data);

  resetHeartbeat();

  if (json.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
    return;
  }

  // Initial config packet from server
  if (json.config) {
    applyConfig(json.config);
    return;
  }

  // Scene events
  if (json.type === 'scene-saved') {
    if (json.snapshot === currentSnapshot) {
      if (!allScenes[json.snapshot]) allScenes[json.snapshot] = {};
      allScenes[json.snapshot][String(json.aux)] = true;
      updateSceneBtn();
    }
    if (String(json.aux) === String(selectedAux)) {
      showToast('Scene saved: ' + json.snapshot);
    }
    return;
  }
  if (json.type === 'scene-deleted') {
    if (allScenes[json.snapshot]) delete allScenes[json.snapshot][String(json.aux)];
    updateSceneBtn();
    if (String(json.aux) === String(selectedAux)) {
      showToast('Scene deleted');
    }
    return;
  }
  if (json.type === 'mute-solo-state') {
    allMutes[json.aux] = json.mutes;
    allSolos[json.aux] = json.solos;
    if (String(json.aux) === String(selectedAux)) {
      applyMuteSoloUI(json.mutes, json.solos);
      if (json.levels) {
        for (const [chStr, dBVal] of Object.entries(json.levels)) {
          const slider = volumeInputs[parseInt(chStr) - 1];
          if (slider) {
            const v = dbToSlider(dBVal);
            slider.value = v;
            setFaderVar(slider, v);
            updateDb(slider);
          }
        }
      }
    }
    return;
  }

  if (json.type === 'scene-recalled') {
    if (selectedAux !== null && json.levels && json.levels[String(selectedAux)]) {
      const auxLevels = json.levels[String(selectedAux)];
      for (const [chStr, sliderVal] of Object.entries(auxLevels)) {
        const ch = parseInt(chStr);
        const slider = volumeInputs[ch - 1];
        if (slider) {
          slider.value = sliderVal;
          setFaderVar(slider, sliderVal);
          updateDb(slider);
        }
      }
      showToast('Scene recalled: ' + json.snapshot);
    }
    return;
  }

  const { address, args } = json;
  if (!address) return;

  // Snapshot name
  if (address === '/SnapshotName') {
    currentSnapshot = args[0] || '—';
    document.getElementById('snapshotName').textContent = currentSnapshot;
    updateSceneBtn();
    return;
  }

  // Aux send level: /Input_Channels/{ch}/Aux_Send/{aux}/send_level
  const levelMatch = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_level$/);
  if (levelMatch) {
    const ch  = parseInt(levelMatch[1]);
    const aux = parseInt(levelMatch[2]);
    if (selectedAux !== null && aux === selectedAux) {
      const slider = volumeInputs[ch - 1];
      if (slider) {
        const v = dbToSlider(parseFloat(args[0]));
        slider.value = v;
        setFaderVar(slider, v);
        updateDb(slider);
      }
    }
    return;
  }

  // Aux send pan: /Input_Channels/{ch}/Aux_Send/{aux}/send_pan
  const panMatch = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_pan$/);
  if (panMatch) {
    const ch  = parseInt(panMatch[1]);
    const aux = parseInt(panMatch[2]);
    if (selectedAux !== null && aux === selectedAux) {
      const slider = panInputs[ch - 1];
      if (slider) {
        const v = parseFloat(args[0]);
        slider.value = v;
        setPanVar(slider, v);
        const dbEl = slider.closest('label')?.querySelector('.fader-db');
        if (dbEl) dbEl.textContent = formatPan(v);
      }
    }
    return;
  }

  // Channel name update
  const chNameMatch = address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/);
  if (chNameMatch) {
    const ch = parseInt(chNameMatch[1]);
    for (const el of document.querySelectorAll(`[data-channel="${ch}"]`)) {
      const label = el.previousElementSibling;
      if (label) label.innerHTML = args[0] || '';
    }
    return;
  }

  // Aux name update
  const auxNameMatch = address.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/);
  if (auxNameMatch) {
    const aux = parseInt(auxNameMatch[1]);
    // Update aux button in picker
    const btn = document.querySelector(`.aux-btn[data-aux="${aux}"]`);
    if (btn) btn.lastChild.nodeValue = args[0] || `AUX ${aux}`;
    // Update topbar if this is selected aux
    if (selectedAux === aux) {
      document.getElementById('auxBarName').textContent = args[0] || `AUX ${aux}`;
    }
  }
}

// ── Apply config ──────────────────────────────────────────────────────────

function applyConfig(config) {
  auxConfig          = config.aux      || [];
  channelConfig      = config.channels || [];
  allScenes          = config.scenes   || {};
  sceneRecallEnabled = !!config.sceneRecallEnabled;
  currentSnapshot    = config.snapshot || '—';
  allMutes           = config.mutes    || {};
  allSolos           = config.solos    || {};

  document.getElementById('snapshotName').textContent = currentSnapshot;

  buildAux(auxConfig);
  buildChannels(channelConfig);

  // Try to restore the previously selected aux (handles reconnects + iOS page reloads)
  const savedAux = parseInt(localStorage.getItem('aux'));
  const targetAux = (selectedAux !== null && auxConfig.some(a => a.channel === selectedAux && a.enabled))
    ? selectedAux
    : (savedAux && auxConfig.some(a => a.channel === savedAux && a.enabled) ? savedAux : null);

  if (targetAux !== null) {
    document.body.classList.remove('auxPicker');
    selectAux(targetAux, true, true); // skipReset=true — don't zero faders on refresh
  } else {
    const saved = localStorage.getItem('aux');
    document.querySelectorAll('.aux-btn').forEach(btn => {
      btn.classList.toggle('aux-btn-last', btn.dataset.aux === saved);
    });
    document.body.classList.add('auxPicker');
  }
}

// ── Aux picker ────────────────────────────────────────────────────────────

function buildAux(options) {
  const container = document.getElementById('auxButtons');
  container.innerHTML = '';

  for (const opt of options) {
    if (!opt.enabled) continue;

    const btn = document.createElement('button');
    btn.className = 'aux-btn';
    btn.dataset.aux = opt.channel;
    btn.style.background = opt.colour || '#444';

    const icon = document.createElement('img');
    icon.src = opt.icon || '';
    icon.width = 28; icon.height = 28;
    btn.appendChild(icon);

    btn.appendChild(document.createTextNode(opt.label || `AUX ${opt.channel}`));
    container.appendChild(btn);
  }

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.aux-btn');
    if (!btn) return;
    selectAux(parseInt(btn.dataset.aux), true);
    document.body.classList.remove('auxPicker');
  });
}

function selectAux(auxChannel, requestValues, skipReset) {
  const switching = selectedAux !== auxChannel;
  selectedAux = auxChannel;

  const opt = auxConfig.find(a => a.channel === auxChannel) || {};
  selectedStereo = !!opt.stereo;

  // Update topbar
  document.getElementById('auxBarName').textContent = opt.label || `AUX ${auxChannel}`;

  // Apply tint colour
  const hex = opt.colour || '#e8a020';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty('--tint', `${r},${g},${b}`);

  // Show/hide pan toggle
  const panLabel = document.getElementById('panLabel');
  panLabel.style.display = selectedStereo ? 'flex' : 'none';
  if (!selectedStereo) {
    document.getElementById('panCheckbox').checked = false;
    document.body.classList.remove('panning');
  }

  // Persist selection
  localStorage.setItem('aux', String(auxChannel));
  updateSceneBtn();
  applyMuteSoloUI(allMutes[auxChannel] || {}, allSolos[auxChannel] || {});

  // Only reset faders when manually switching aux — not on reconnect/config refresh
  if (switching && !skipReset) {
    for (const s of volumeInputs) { if (s) { s.value = 0; setFaderVar(s, 0); updateDb(s); } }
    for (const s of panInputs) {
      if (s) {
        s.value = 0.5;
        setPanVar(s, 0.5);
        const dbEl = s.closest('label')?.querySelector('.fader-db');
        if (dbEl) dbEl.textContent = 'C';
      }
    }
  }

  if (requestValues) {
    requestAuxValues(auxChannel);
  }
}

function requestAuxValues(auxChannel) {
  for (let i = 1; i <= channelConfig.length; i++) {
    sendOSC(`/Input_Channels/${i}/Aux_Send/${auxChannel}/send_level/?`);
    if (selectedStereo) {
      sendOSC(`/Input_Channels/${i}/Aux_Send/${auxChannel}/send_pan/?`);
    }
  }
}

// ── Channel list ──────────────────────────────────────────────────────────

function applyMuteSoloUI(mutes, solos) {
  const anySolo = Object.values(solos || {}).some(v => v);
  document.querySelectorAll('.channel-row').forEach(row => {
    const slider = row.querySelector('.volumeInput');
    if (!slider) return;
    const ch = slider.dataset.channel;
    const muted   = !!(mutes?.[ch]);
    const soloed  = !!(solos?.[ch]);
    const soloOff = anySolo && !soloed;
    row.classList.toggle('ch-muted',    muted);
    row.classList.toggle('ch-solo-off', !muted && soloOff);
    row.classList.toggle('ch-soloed',   soloed);
    const muteBtn = row.querySelector('.mute-btn');
    const soloBtn = row.querySelector('.solo-btn');
    if (muteBtn) muteBtn.classList.toggle('active', muted);
    if (soloBtn) soloBtn.classList.toggle('active', soloed);
  });
}

function buildChannels(channels) {
  const list = document.getElementById('channelsList');
  list.innerHTML = '';
  volumeInputs = [];
  panInputs    = [];

  // Sort by order field
  const sorted = [...channels].sort((a, b) => a.order - b.order);

  for (const ch of sorted) {
    if (ch.title) {
      const heading = document.createElement('div');
      heading.className = 'section-title';
      heading.textContent = ch.title;
      list.appendChild(heading);
    }

    if (!ch.enabled) continue;

    const row = document.createElement('div');
    row.className = 'channel-row';

    // Channel info
    const info = document.createElement('div');
    info.className = 'ch-info';

    if (ch.icon) {
      const iconEl = document.createElement('div');
      iconEl.className = 'ch-icon';
      if (ch.icon.startsWith('img:')) {
        const key = ch.icon.slice(4);
        iconEl.innerHTML = CUSTOM_ICONS[key] || '';
        iconEl.classList.add('ch-icon-svg');
      } else if (ch.icon.startsWith('file:')) {
        const n = parseInt(ch.icon.slice(5));
        const imgEl = document.createElement('img');
        imgEl.src = `/instrument-icons/${n}.svg`;
        imgEl.className = 'instrument-icon';
        imgEl.width = 22;
        imgEl.height = 22;
        iconEl.appendChild(imgEl);
      } else {
        iconEl.textContent = ch.icon;
      }
      info.appendChild(iconEl);
    }

    const num = document.createElement('div');
    num.className = 'ch-num';
    num.textContent = ch.channel;

    const name = document.createElement('div');
    name.className = 'ch-name';
    name.textContent = ch.label || '';

    info.append(num, name);

    // Mute / Solo buttons
    const msBtns = document.createElement('div');
    msBtns.className = 'ms-btns';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'ms-btn mute-btn';
    muteBtn.textContent = 'M';
    muteBtn.addEventListener('click', () => {
      if (selectedAux === null || !ws || ws.readyState !== WebSocket.OPEN) return;
      const muted = !muteBtn.classList.contains('active');
      ws.send(JSON.stringify({ type: 'set-mute', aux: selectedAux, ch: ch.channel, muted }));
    });

    const soloBtn = document.createElement('button');
    soloBtn.className = 'ms-btn solo-btn';
    soloBtn.textContent = 'S';
    soloBtn.addEventListener('click', () => {
      if (selectedAux === null || !ws || ws.readyState !== WebSocket.OPEN) return;
      const soloed = !soloBtn.classList.contains('active');
      ws.send(JSON.stringify({ type: 'set-solo', aux: selectedAux, ch: ch.channel, soloed }));
    });

    msBtns.append(muteBtn, soloBtn);

    // Fader column
    const faderCol = document.createElement('div');
    faderCol.className = 'fader-col';

    // Volume fader
    const volLabel = document.createElement('label');
    volLabel.className = 'volume';

    const volWrap = document.createElement('div');
    volWrap.className = 'fader-wrap';

    const volSlider = document.createElement('input');
    volSlider.type      = 'range';
    volSlider.className = 'fader-h volumeInput';
    volSlider.dataset.channel = ch.channel;
    volSlider.min   = 0;
    volSlider.max   = 1;
    volSlider.step  = 0.001;
    volSlider.value = 0;
    setFaderVar(volSlider, 0);

    const sendVol = throttle(() => {
      if (selectedAux === null) return;
      sendOSC(
        `/Input_Channels/${ch.channel}/Aux_Send/${selectedAux}/send_level`,
        [sliderToDb(parseFloat(volSlider.value))]
      );
    }, 30);

    volSlider.addEventListener('input', () => {
      setFaderVar(volSlider, parseFloat(volSlider.value));
      dbEl.textContent = formatDb(parseFloat(volSlider.value));
      sendVol();
    });

    volSlider.addEventListener('change', () => {
      if (selectedAux === null) return;
      sendOSC(
        `/Input_Channels/${ch.channel}/Aux_Send/${selectedAux}/send_level`,
        [sliderToDb(parseFloat(volSlider.value))]
      );
    });

    volWrap.appendChild(volSlider);

    const ticksEl = document.createElement('div');
    ticksEl.className = 'fader-ticks';
    for (const { frac, label: tlabel } of VOLUME_TICKS) {
      const tick = document.createElement('span');
      tick.className = 'fader-tick';
      tick.style.left = `calc(15px + ${frac} * (100% - 30px))`;
      const tl = document.createElement('span');
      tl.className = 'fader-tick-label';
      tl.textContent = tlabel;
      tick.appendChild(tl);
      ticksEl.appendChild(tick);
    }
    volWrap.appendChild(ticksEl);

    const dbEl = document.createElement('span');
    dbEl.className = 'fader-db';
    dbEl.textContent = '-∞';
    volWrap.appendChild(dbEl);

    addFaderOverlay(volSlider, () => resetVolSlider(volSlider, dbEl));

    volLabel.append(volWrap);

    // Pan fader
    const panLabel = document.createElement('label');
    panLabel.className = 'pan';

    const panWrap = document.createElement('div');
    panWrap.className = 'fader-wrap';

    const panSlider = document.createElement('input');
    panSlider.type      = 'range';
    panSlider.className = 'fader-h panInput';
    panSlider.dataset.channel = ch.channel;
    panSlider.min   = 0;
    panSlider.max   = 1;
    panSlider.step  = 0.001;
    panSlider.value = 0.5;
    setPanVar(panSlider, 0.5);

    const sendPan = throttle(() => {
      if (selectedAux === null) return;
      sendOSC(
        `/Input_Channels/${ch.channel}/Aux_Send/${selectedAux}/send_pan`,
        [parseFloat(panSlider.value)]
      );
    }, 30);

    panSlider.addEventListener('input', () => {
      const v = parseFloat(panSlider.value);
      setPanVar(panSlider, v);
      panDbEl.textContent = formatPan(v);
      sendPan();
    });

    panSlider.addEventListener('change', () => {
      if (selectedAux === null) return;
      sendOSC(
        `/Input_Channels/${ch.channel}/Aux_Send/${selectedAux}/send_pan`,
        [parseFloat(panSlider.value)]
      );
    });

    panWrap.appendChild(panSlider);

    const panDbEl = document.createElement('span');
    panDbEl.className = 'fader-db';
    panDbEl.textContent = 'C';
    panWrap.appendChild(panDbEl);

    addFaderOverlay(panSlider, () => {
      panSlider.value = 0.5;
      setPanVar(panSlider, 0.5);
      panDbEl.textContent = formatPan(0.5);
      panSlider.dispatchEvent(new Event('change', { bubbles: true }));
    });

    panLabel.append(panWrap);

    faderCol.append(volLabel, panLabel);
    row.append(info, msBtns, faderCol);
    list.appendChild(row);

    // Track by 1-based channel index
    volumeInputs[ch.channel - 1] = volSlider;
    panInputs[ch.channel - 1]    = panSlider;
  }
}

// ── Fader overlay — intercepts touch before iOS native range handler ──────
// Vertical gesture → scrolls .channels-wrap. Horizontal → moves fader.
// Also handles mouse drag and double-tap/dblclick reset.

function addFaderOverlay(slider, onReset) {
  const THUMB = 44;
  const wrap  = slider.parentNode; // .fader-wrap
  wrap.style.position = 'relative';

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;top:0;left:0;right:0;height:48px;z-index:2;touch-action:none;cursor:pointer;';
  wrap.appendChild(overlay);

  // Prevent the native range input from receiving any pointer events;
  // all interaction now goes through the overlay.
  slider.style.pointerEvents = 'none';

  function valueFromX(clientX) {
    const rect = slider.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1,
      (clientX - rect.left - THUMB / 2) / (rect.width - THUMB)));
    return parseFloat(slider.min || 0) + frac * (parseFloat(slider.max || 1) - parseFloat(slider.min || 0));
  }

  function thumbCenterX() {
    const rect = slider.getBoundingClientRect();
    const min  = parseFloat(slider.min || 0);
    const max  = parseFloat(slider.max || 1);
    const frac = (parseFloat(slider.value) - min) / (max - min);
    return rect.left + THUMB / 2 + frac * (rect.width - THUMB);
  }

  // Allow grab within thumb radius + 8px slop on each side
  function nearThumb(clientX) {
    return Math.abs(clientX - thumbCenterX()) <= THUMB / 2 + 8;
  }

  function apply(v) {
    slider.value = v;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Touch ──────────────────────────────────────────────────────────────
  let tStartX, tStartY, tLastY, tDecided, tScrolling, tLastTap = 0;

  overlay.addEventListener('touchstart', e => {
    const t  = e.touches[0];
    tStartX  = t.clientX;
    tStartY  = t.clientY;
    tLastY   = t.clientY;

    if (!nearThumb(t.clientX)) {
      // Not on thumb — treat as scroll immediately
      tDecided   = true;
      tScrolling = true;
      return;
    }
    tDecided   = false;
    tScrolling = false;
    e.preventDefault();
  }, { passive: false });

  overlay.addEventListener('touchmove', e => {
    const t  = e.touches[0];
    const dx = Math.abs(t.clientX - tStartX);
    const dy = Math.abs(t.clientY - tStartY);

    if (!tDecided && (dx > 4 || dy > 4)) {
      tDecided   = true;
      tScrolling = dy > dx;
    }

    if (tScrolling) {
      const scrollEl = document.querySelector('.channels-wrap');
      if (scrollEl) scrollEl.scrollTop += tLastY - t.clientY;
      tLastY = t.clientY;
    } else {
      apply(valueFromX(t.clientX));
    }
    e.preventDefault();
  }, { passive: false });

  overlay.addEventListener('touchend', () => {
    if (!tScrolling) {
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      const now = Date.now();
      if (now - tLastTap < 300) onReset();
      tLastTap = now;
    }
  });

  // ── Mouse (desktop) ────────────────────────────────────────────────────
  overlay.addEventListener('mousedown', e => {
    if (!nearThumb(e.clientX)) return;
    const onMove = ev => apply(valueFromX(ev.clientX));
    const onUp   = ev => {
      apply(valueFromX(ev.clientX));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  overlay.addEventListener('dblclick', onReset);
}

function resetVolSlider(slider, dbEl) {
  slider.value = 0;
  setFaderVar(slider, 0);
  if (dbEl) dbEl.textContent = '-∞';
  slider.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Helpers ───────────────────────────────────────────────────────────────

function setFaderVar(el, v) {
  el.style.setProperty('--val', v);
}

function setPanVar(el, v) {
  el.style.setProperty('--pan-start', Math.min(v, 0.5));
  el.style.setProperty('--pan-end',   Math.max(v, 0.5));
}

function formatPan(v) {
  const pct = Math.round(Math.abs(v - 0.5) * 200);
  if (pct <= 2) return 'C';
  return (v < 0.5 ? 'L' : 'R') + pct;
}

function updateDb(volSlider) {
  const dbEl = volSlider.parentNode.querySelector('.fader-db');
  if (dbEl) dbEl.textContent = formatDb(parseFloat(volSlider.value));
}

// ── Wire up pan checkbox ──────────────────────────────────────────────────

document.getElementById('panCheckbox').addEventListener('change', function () {
  document.body.classList.toggle('panning', this.checked);
});

// ── Tap topbar aux name to reopen picker ─────────────────────────────────

document.getElementById('auxBar').addEventListener('click', () => {
  document.body.classList.add('auxPicker');
});

// ── Scene save / delete button ────────────────────────────────────────────

document.getElementById('sceneBtn').addEventListener('click', () => {
  if (selectedAux === null || !ws || ws.readyState !== WebSocket.OPEN) return;
  const alreadySaved = !!(currentSnapshot &&
    allScenes[currentSnapshot] && allScenes[currentSnapshot][String(selectedAux)]);

  if (alreadySaved) {
    ws.send(JSON.stringify({ type: 'delete-scene', aux: selectedAux }));
  } else {
    const values = {};
    volumeInputs.forEach((s, idx) => { if (s) values[String(idx + 1)] = parseFloat(s.value); });
    ws.send(JSON.stringify({ type: 'save-scene', aux: selectedAux, values }));
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', startWebsocket);

// Reconnect immediately when page becomes visible again (iOS background wake)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      clearTimeout(timeout);
      startWebsocket();
    }
  }
});
