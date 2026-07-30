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
  congas:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="7.5" cy="5" rx="3.5" ry="1.5"/><line x1="4.5" y1="5" x2="5.5" y2="20"/><line x1="10.5" y1="5" x2="9.5" y2="20"/><line x1="5.5" y1="20" x2="9.5" y2="20"/><ellipse cx="16.5" cy="4" rx="3.5" ry="1.5"/><line x1="13.5" y1="4" x2="14.5" y2="20"/><line x1="19.5" y1="4" x2="18.5" y2="20"/><line x1="14.5" y1="20" x2="18.5" y2="20"/></svg>`,
  shaker:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="5" ry="7"/><line x1="12" y1="16" x2="12" y2="22"/></svg>`,
  tambourine:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><circle cx="3.5" cy="10" r="1.2"/><circle cx="3.5" cy="14" r="1.2"/><circle cx="20.5" cy="10" r="1.2"/><circle cx="20.5" cy="14" r="1.2"/><circle cx="10" cy="3" r="1.2"/><circle cx="14" cy="3" r="1.2"/></svg>`,
  trombone:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="9" x2="13" y2="9"/><line x1="2" y1="13" x2="13" y2="13"/><path d="M13 9 Q15 9 15 11 Q15 13 13 13"/><path d="M13 9 Q13 6 16 6 Q19 6 19 9"/><path d="M13 13 Q13 16 16 16 Q19 16 19 13"/><path d="M19 9 Q22 9 23 11 Q22 16 19 16"/></svg>`,
  harmonica:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="10" rx="2"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="7" y1="7" x2="7" y2="17"/><line x1="12" y1="7" x2="12" y2="17"/><line x1="17" y1="7" x2="17" y2="17"/></svg>`,
  banjo:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="15" r="7"/><circle cx="9" cy="15" r="2.5" stroke-width="1.2"/><rect x="7.5" y="2" width="3" height="9" rx="1.5"/><line x1="6.5" y1="4" x2="11.5" y2="4" stroke-width="1.2"/><line x1="6.5" y1="7" x2="11.5" y2="7" stroke-width="1.2"/><line x1="16" y1="9" x2="22" y2="7" stroke-width="1.2"/></svg>`,
  choir:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="5" height="9" rx="2.5"/><path d="M1 8 Q1 13 4.5 13 Q8 13 8 8"/><rect x="17" y="2" width="5" height="9" rx="2.5"/><path d="M16 8 Q16 13 19.5 13 Q23 13 23 8"/><line x1="4.5" y1="13" x2="4.5" y2="19"/><line x1="19.5" y1="13" x2="19.5" y2="19"/><line x1="4.5" y1="19" x2="19.5" y2="19"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  mic:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M6 10 Q6 16 12 16 Q18 16 18 10"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`,
  click:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M7 22 L10 6 L14 6 L17 22 Z"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="9" y1="2" x2="15" y2="2"/><line x1="12" y1="11" x2="16" y2="16"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  playback:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8.5" cy="12" r="3"/><circle cx="15.5" cy="12" r="3"/><line x1="8.5" y1="5" x2="8.5" y2="3"/><line x1="15.5" y1="5" x2="15.5" y2="3"/><line x1="8.5" y1="3" x2="15.5" y2="3"/><path d="M10.5 10.5 L10.5 13.5 L13.5 12 Z" fill="currentColor" stroke="none"/></svg>`,
  fx:            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><polyline points="13,2 7,13 12,13 11,22 17,11 12,11 13,2"/></svg>`,
};

// ── dB conversion (matches DiGiCo OSC: -90 to +10 dB) ────────────────────

function sliderToDb(value) {
  const val = ((Math.log(value * 100) / Math.log(100)) * 100) - 90;
  return val === -Infinity ? -150 : val;
}

function dbToSlider(db) {
  if (db <= -90) return 0;
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
let localPresets       = {};   // { name: { levels: { ch: sliderVal }, pans: { ch: panVal } } } — stored in localStorage
let sceneDirty         = false; // true once faders move after a scene exists for this snapshot/aux
let sceneLocked        = false; // true when a saved scene exists and volume faders are protected from touch
let sceneRecallEnabled = false;
let currentSnapshot    = '—';
let allMutes           = {}; // allMutes[aux][ch]
let allSolos           = {}; // allSolos[aux][ch]
const channelRowCache  = new Map(); // ch number → { row, muteBtn, soloBtn }

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
  // Let the server (and any Devices view) know which device this is
  ws.send(JSON.stringify({ type: 'identify', deviceId }));
  // Request all cached levels so faders fill in immediately after reconnect,
  // and re-announce our active aux (the server's per-connection state is fresh)
  if (selectedAux !== null) {
    ws.send(JSON.stringify({ type: 'request-aux-levels', aux: selectedAux }));
    ws.send(JSON.stringify({ type: 'set-active-aux', aux: selectedAux }));
    // If EQ panel is open, clear stale band data and re-fetch from server
    if (document.body.classList.contains('eqOpen')) {
      eqBands = {};
      eqActive = null;
      renderEQCurve();
      updateEQBandInfo();
      ws.send(JSON.stringify({ type: 'request-aux-eq', aux: selectedAux }));
    }
  }
  // If localStorage has no presets (e.g. first visit or cache cleared), ask server for backup
  if (Object.keys(localPresets).length === 0) {
    ws.send(JSON.stringify({ type: 'request-device-presets', deviceId }));
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

// Generic confirm/value-prompt overlay — replaces window.confirm()/prompt(), which
// iOS silently no-ops in standalone (home-screen) web apps, same reason the
// save-mix flow below builds its own dialog instead of using confirm().
// Returns a Promise: confirm mode resolves true/false, input mode resolves the
// trimmed string or null (cancelled).
function showActionDialog({ title, showInput = false, inputValue = '', confirmLabel = 'OK' }) {
  return new Promise((resolve) => {
    const input      = document.getElementById('actionDialogInput');
    const confirmBtn = document.getElementById('actionDialogConfirm');
    const cancelBtn  = document.getElementById('actionDialogCancel');

    document.getElementById('actionDialogTitle').textContent = title;
    input.style.display = showInput ? '' : 'none';
    input.value = inputValue;
    confirmBtn.textContent = confirmLabel;

    document.body.classList.add('actionDialogOpen');
    if (showInput) setTimeout(() => { input.focus(); input.select(); }, 80);

    function commit() { cleanup(); resolve(showInput ? input.value.trim() : true); }
    function cancel()  { cleanup(); resolve(showInput ? null : false); }
    function onKey(e) {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cancel();
    }
    function cleanup() {
      document.body.classList.remove('actionDialogOpen');
      confirmBtn.removeEventListener('click', commit);
      cancelBtn.removeEventListener('click', cancel);
      document.removeEventListener('keydown', onKey);
    }

    confirmBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', cancel);
    document.addEventListener('keydown', onKey);
  });
}

function hasSavedScene() {
  return !!(currentSnapshot && selectedAux !== null &&
    allScenes[currentSnapshot] && allScenes[currentSnapshot][String(selectedAux)]);
}

function updateSceneUI() {
  const menuItem  = document.getElementById('menuSceneItem');
  const menuIcon  = document.getElementById('menuSceneIcon');
  const menuLabel = document.getElementById('menuSceneLabel');
  const status    = document.getElementById('sceneStatus');
  const hasScene  = hasSavedScene();

  if (menuItem) {
    menuItem.style.display = selectedAux !== null ? '' : 'none';
    if (menuIcon)  menuIcon.textContent  = hasScene ? '🗑' : '💾';
    if (menuLabel) menuLabel.textContent = hasScene ? 'Delete Ear Scene' : 'Save Ear Scene';
  }

  if (status) {
    if (selectedAux === null) {
      status.style.display = 'none';
    } else {
      status.style.display = '';
      if (!hasScene) {
        status.className = 'scene-status status-none';
        status.textContent = 'Not Saved';
        status.title = '';
      } else if (sceneDirty) {
        status.className = 'scene-status status-dirty';
        status.textContent = '↺ Changed Since Save — Tap to Revert';
        status.title = 'Tap to revert to your last saved mix';
      } else if (sceneLocked) {
        status.className = 'scene-status status-locked';
        status.textContent = `🔒 Mix Locked for ${currentSnapshot}`;
        status.title = 'Tap to unlock and edit';
      } else {
        status.className = 'scene-status status-unlocked';
        status.textContent = '🔓 Unlocked — Editing';
        status.title = 'Tap to re-lock';
      }
    }
  }
}

// Marks the current mix as having drifted from its saved scene — called on
// any fader move once a scene already exists for this snapshot/aux.
function markSceneDirty() {
  if (sceneDirty || !hasSavedScene()) return;
  sceneDirty = true;
  updateSceneUI();
}

// ── Ear Scenes — view/edit/delete saved mixes across every snapshot for the
// current aux, including ones the console isn't currently on. Editing a
// non-live snapshot never sends OSC to the desk — see openSnapshotEditor().
// ─────────────────────────────────────────────────────────────────────────

function earScenesForCurrentAux() {
  if (selectedAux === null) return [];
  const names = [];
  for (const [snapshot, byAux] of Object.entries(allScenes)) {
    if (byAux && byAux[String(selectedAux)]) names.push(snapshot);
  }
  names.sort((a, b) => {
    if (a === currentSnapshot) return -1;
    if (b === currentSnapshot) return 1;
    return a.localeCompare(b);
  });
  return names;
}

function renderEarScenesList() {
  const list = document.getElementById('earScenesList');
  if (!list) return;
  list.innerHTML = '';

  const names = earScenesForCurrentAux();

  if (names.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mixes-empty';
    empty.textContent = 'No saved Ear Scenes yet for this mix.\nUse the menu to save one for the current snapshot.';
    list.appendChild(empty);
    return;
  }

  for (const name of names) {
    const isLive = name === currentSnapshot;
    const row = document.createElement('div');
    row.className = 'mixes-row';

    const nameBtn = document.createElement('button');
    nameBtn.className = 'mixes-row-name';
    nameBtn.textContent = name;
    if (isLive) {
      const badge = document.createElement('span');
      badge.className = 'earscene-live-badge';
      badge.textContent = 'LIVE';
      nameBtn.appendChild(badge);
    }
    nameBtn.title = isLive
      ? 'Console is on this snapshot right now'
      : "Tap to edit this saved mix — won't affect the live sound";
    nameBtn.addEventListener('click', () => {
      closeEarScenesPicker();
      if (isLive) return; // already live — the normal faders are that mix
      openSnapshotEditor(name);
    });
    row.appendChild(nameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'mixes-row-del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete this saved mix';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showActionDialog({ title: `Delete the saved mix for "${name}"?`, confirmLabel: 'Delete' });
      if (!ok) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'delete-scene', aux: selectedAux, snapshot: name }));
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  }
}

function openEarScenesPicker() {
  if (selectedAux === null) return;
  renderEarScenesList();
  document.body.classList.add('earScenesOpen');
}

function closeEarScenesPicker() {
  document.body.classList.remove('earScenesOpen');
}

// ── Offline Ear Scene editor ────────────────────────────────────────────

let snapshotEditName   = null; // snapshot currently being edited, or null when closed
let snapshotEditValues = {};   // ch (number) -> slider value, local only until Save

function buildSnapshotEditRow(ch, initialVal) {
  const row = document.createElement('div');
  row.className = 'snapshot-edit-row';

  const info = document.createElement('div');
  info.className = 'ch-info';
  const num = document.createElement('div');
  num.className = 'ch-num';
  num.textContent = ch.channel;
  const name = document.createElement('div');
  name.className = 'ch-name';
  name.textContent = ch.label || '';
  info.append(num, name);

  const wrap = document.createElement('div');
  wrap.className = 'fader-wrap';
  wrap.style.flex = '1';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'fader-h';
  slider.min = 0; slider.max = 1; slider.step = 0.001;
  slider.value = initialVal;
  setFaderVar(slider, initialVal);

  const dbEl = document.createElement('span');
  dbEl.className = 'fader-db';
  dbEl.textContent = formatDb(initialVal);

  // Deliberately no sendOSC() anywhere in here — this only ever updates the
  // local snapshotEditValues map. Nothing reaches the desk until Save, and
  // even Save only ever persists to the scenes store, never to the console.
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    setFaderVar(slider, v);
    dbEl.textContent = formatDb(v);
    snapshotEditValues[ch.channel] = v;
  });

  wrap.append(slider, dbEl);

  addFaderOverlay(slider, () => {
    slider.value = 0;
    setFaderVar(slider, 0);
    dbEl.textContent = '-∞';
    snapshotEditValues[ch.channel] = 0;
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, false, '.snapshot-edit-list');

  row.append(info, wrap);
  return row;
}

function renderSnapshotEditRows(values) {
  const list = document.getElementById('snapshotEditList');
  if (!list) return;
  list.innerHTML = '';
  snapshotEditValues = {};
  for (const ch of channelConfig) {
    if (!ch.enabled) continue;
    const v = values[String(ch.channel)] !== undefined ? values[String(ch.channel)] : 0;
    snapshotEditValues[ch.channel] = v;
    list.appendChild(buildSnapshotEditRow(ch, v));
  }
}

function openSnapshotEditor(snapshotName) {
  if (selectedAux === null) return;
  snapshotEditName = snapshotName;
  document.getElementById('snapshotEditName').textContent = snapshotName;

  const list = document.getElementById('snapshotEditList');
  document.body.classList.add('snapshotEditOpen');

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    list.innerHTML = '<div class="mixes-empty">Not connected — try again once reconnected.</div>';
    return;
  }
  list.innerHTML = '<div class="mixes-empty">Loading…</div>';
  ws.send(JSON.stringify({ type: 'request-scene', aux: selectedAux, snapshot: snapshotName }));
}

function closeSnapshotEditor() {
  document.body.classList.remove('snapshotEditOpen');
  snapshotEditName   = null;
  snapshotEditValues = {};
}

// ── My Mixes — personal named presets, stored per-device, aux-agnostic ───
// Primary storage: localStorage on the device.
// Backup: server stores a copy keyed by deviceId so it survives cache clears.

let deviceId = localStorage.getItem('jpm_device_id');
if (!deviceId) {
  // crypto.randomUUID() only exists in a secure context (HTTPS, or localhost).
  // Musicians load this page over plain HTTP from a LAN IP, which isn't secure,
  // so it's undefined there — fall back to a manually-built id. Not used for
  // anything security-sensitive, just a stable key for the preset backup.
  deviceId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  localStorage.setItem('jpm_device_id', deviceId);
}

function loadLocalPresets() {
  try { localPresets = JSON.parse(localStorage.getItem('jpm_presets') || '{}'); }
  catch (_) { localPresets = {}; }
}
loadLocalPresets();

function saveLocalPresets() {
  localStorage.setItem('jpm_presets', JSON.stringify(localPresets));
}

function renderPresetsList() {
  const list = document.getElementById('mixesList');
  if (!list) return;
  list.innerHTML = '';

  const names = Object.keys(localPresets).sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mixes-empty';
    empty.textContent = 'No saved mixes yet.\nDial in your levels, then tap "Save Mix As…"';
    list.appendChild(empty);
    return;
  }

  for (const name of names) {
    const row = document.createElement('div');
    row.className = 'mixes-row';

    const nameBtn = document.createElement('button');
    nameBtn.className = 'mixes-row-name';
    nameBtn.textContent = name;
    nameBtn.title = 'Load this mix onto your current aux';
    nameBtn.addEventListener('click', () => loadPreset(name));
    row.appendChild(nameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'mixes-row-del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete this mix';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePresetPrompt(name); });
    row.appendChild(delBtn);

    list.appendChild(row);
  }
}

function openMixesPicker() {
  if (selectedAux === null) return;
  renderPresetsList();
  document.getElementById('mixesSaveBtn').style.display = '';
  document.body.classList.add('mixesOpen');
}

function closeMixesPicker() {
  document.body.classList.remove('mixesOpen');
}

function savePresetPrompt() {
  if (selectedAux === null || !ws || ws.readyState !== WebSocket.OPEN) return;
  const input   = document.getElementById('nameMixInput');
  const confirmBtn = document.getElementById('nameMixConfirm');
  const cancelBtn  = document.getElementById('nameMixCancel');
  input.value = '';
  document.body.classList.add('nameMixOpen');
  setTimeout(() => input.focus(), 80);

  function commit() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    // Overwrite silently — the user typed the name and hit Save, that's sufficient intent.
    // window.confirm() is suppressed on iOS WKWebView and would cause silent save failures.
    cleanup();
    const levels = {}, pans = {};
    volumeInputs.forEach((s, idx) => { if (s) levels[String(idx + 1)] = parseFloat(s.value); });
    panInputs.forEach((s, idx) => { if (s) pans[String(idx + 1)] = parseFloat(s.value); });
    localPresets[name] = { levels, pans };
    saveLocalPresets();
    renderPresetsList();
    showToast('Mix saved: ' + name);
    // Back up to server so it survives a localStorage clear
    ws.send(JSON.stringify({ type: 'save-preset', deviceId, name, levels, pans }));
  }

  function cleanup() {
    document.body.classList.remove('nameMixOpen');
    confirmBtn.removeEventListener('click', commit);
    cancelBtn.removeEventListener('click', cleanup);
    input.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cleanup();
  }

  confirmBtn.addEventListener('click', commit);
  cancelBtn.addEventListener('click', cleanup);
  input.addEventListener('keydown', onKey);
}

function loadPreset(name) {
  if (selectedAux === null || !ws || ws.readyState !== WebSocket.OPEN) return;
  const preset = localPresets[name];
  if (!preset) return;
  ws.send(JSON.stringify({ type: 'apply-preset', aux: selectedAux, name, levels: preset.levels || {}, pans: preset.pans || {} }));
  closeMixesPicker();
}

async function deletePresetPrompt(name) {
  const ok = await showActionDialog({ title: `Delete the mix "${name}"?`, confirmLabel: 'Delete' });
  if (!ok) return;
  delete localPresets[name];
  saveLocalPresets();
  renderPresetsList();
  showToast('Mix deleted: ' + name);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'delete-preset', deviceId, name }));
  }
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
    // Keep the full snapshot->aux map current regardless of which snapshot this
    // was for (the Ear Scenes list needs to see saves for non-live snapshots
    // too) — but only touch the live locked/dirty banner when it's actually
    // for the snapshot the desk is currently on.
    if (!allScenes[json.snapshot]) allScenes[json.snapshot] = {};
    allScenes[json.snapshot][String(json.aux)] = true;
    if (json.snapshot === currentSnapshot && String(json.aux) === String(selectedAux)) {
      sceneDirty = false;
      sceneLocked = true;
      updateSceneUI();
    }
    if (String(json.aux) === String(selectedAux)) {
      showToast('Scene saved: ' + json.snapshot);
    }
    renderEarScenesList();
    return;
  }
  if (json.type === 'scene-deleted') {
    if (allScenes[json.snapshot]) delete allScenes[json.snapshot][String(json.aux)];
    if (json.snapshot === currentSnapshot && String(json.aux) === String(selectedAux)) {
      sceneDirty = false;
      sceneLocked = false;
      updateSceneUI();
    }
    if (String(json.aux) === String(selectedAux)) {
      showToast('Scene deleted' + (json.snapshot !== currentSnapshot ? ': ' + json.snapshot : ''));
    }
    renderEarScenesList();
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
        if (slider) animateFaderTo(slider, sliderVal);
      }
      sceneDirty  = false;
      sceneLocked = true;
      updateSceneUI();
      showToast('Scene recalled: ' + json.snapshot);
    }
    return;
  }

  // Response to request-scene, feeding the offline Ear Scene editor
  if (json.type === 'scene-values') {
    if (json.snapshot === snapshotEditName && String(json.aux) === String(selectedAux)) {
      renderSnapshotEditRows(json.values || {});
    }
    return;
  }

  // Server confirmed preset was applied to desk — snap faders + pans
  if (json.type === 'preset-loaded') {
    if (String(json.aux) === String(selectedAux)) {
      if (json.levels) {
        for (const [chStr, sliderVal] of Object.entries(json.levels)) {
          const ch = parseInt(chStr);
          const slider = volumeInputs[ch - 1];
          if (slider) animateFaderTo(slider, sliderVal);
        }
      }
      if (json.pans) {
        for (const [chStr, panVal] of Object.entries(json.pans)) {
          const ch = parseInt(chStr);
          const slider = panInputs[ch - 1];
          if (slider) {
            slider.value = panVal;
            setPanVar(slider, panVal);
            const dbEl = slider.parentNode.querySelector('.fader-db');
            if (dbEl) dbEl.textContent = formatPan(panVal);
          }
        }
      }
      markSceneDirty();
      showToast('Mix loaded: ' + json.name);
    }
    return;
  }
  // Server returned preset backup for this device (localStorage was empty)
  if (json.type === 'device-presets') {
    if (json.presets && Object.keys(json.presets).length > 0 && Object.keys(localPresets).length === 0) {
      localPresets = json.presets;
      saveLocalPresets();
      if (document.body.classList.contains('mixesOpen')) renderPresetsList();
    }
    return;
  }

  if (json.type === 'aux-eq') {
    if (String(json.aux) === String(selectedAux)) {
      applyEQData(json.eq || {});
      if (document.body.classList.contains('eqOpen')) { renderEQCurve(); updateEQBandInfo(); }
    }
    return;
  }

  const { address, args } = json;
  if (!address) return;

  // Live EQ updates from desk (engineer adjusting at console)
  const eqMatch = address.match(/^\/Aux_Outputs\/(\d+)\/EQ\/(.+)$/);
  if (eqMatch) {
    if (parseInt(eqMatch[1]) === selectedAux) {
      applyEQParam(eqMatch[2], args[0]);
      if (document.body.classList.contains('eqOpen')) { renderEQCurve(); updateEQBandInfo(); }
    }
    return;
  }

  // Snapshot name
  if (address === '/SnapshotName') {
    currentSnapshot = args[0] || '—';
    document.getElementById('snapshotName').textContent = currentSnapshot;
    sceneDirty = false;
    updateSceneUI();
    renderEarScenesList(); // keep the LIVE badge/sort current if the list is already open
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
      if (label) label.textContent = args[0] || '';
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

// One-time listener — attached at startup so buildAux rebuilds don't stack handlers.
document.getElementById('auxButtons').addEventListener('click', (e) => {
  const btn = e.target.closest('.aux-btn');
  if (!btn) return;
  selectAux(parseInt(btn.dataset.aux), true);
  document.body.classList.remove('auxPicker');
});

function buildAux(options) {
  const container = document.getElementById('auxButtons');
  container.innerHTML = '';

  for (const opt of options) {
    if (!opt.enabled) continue;

    const btn = document.createElement('button');
    btn.className = 'aux-btn';
    btn.dataset.aux = opt.channel;
    btn.style.background = opt.colour || '#444';

    if (opt.icon) {
      const icon = document.createElement('img');
      icon.src = opt.icon;
      icon.width = 28; icon.height = 28;
      btn.appendChild(icon);
    }

    btn.appendChild(document.createTextNode(opt.label || `AUX ${opt.channel}`));
    container.appendChild(btn);
  }
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

  // Show/hide menu items that depend on an aux being selected
  const menuMixesItem = document.getElementById('menuMixesItem');
  if (menuMixesItem) menuMixesItem.style.display = auxChannel !== null ? '' : 'none';
  const menuEarScenesParentItem = document.getElementById('menuEarScenesParentItem');
  if (menuEarScenesParentItem) menuEarScenesParentItem.style.display = auxChannel !== null ? '' : 'none';
  const menuEqItem = document.getElementById('menuEqItem');
  if (menuEqItem) menuEqItem.style.display = (auxChannel !== null && opt.eqEnabled) ? '' : 'none';

  // Show pan toggle only for stereo auxes
  const panLabel = document.getElementById('panLabel');
  panLabel.style.display = selectedStereo ? 'flex' : 'none';
  if (!selectedStereo) {
    document.getElementById('panCheckbox').checked = false;
    document.body.classList.remove('panning');
  }

  // Tell the server which aux this client is mixing — drives the Monitor
  // view's "who's mixing what" presence indicator
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set-active-aux', aux: auxChannel }));
  }

  // Persist selection
  localStorage.setItem('aux', String(auxChannel));
  if (switching) {
    sceneDirty  = false;
    sceneLocked = hasSavedScene(); // default to locked whenever this aux/snapshot has a saved mix
  }
  updateSceneUI();
  applyMuteSoloUI(allMutes[auxChannel] || {}, allSolos[auxChannel] || {});

  // When switching to a different aux, clear EQ state so stale data from the
  // previous aux can't be applied to the new one, and close the panel if open.
  // Also close the Ear Scenes list/editor — both show data scoped to whatever
  // aux was selected when they were opened.
  if (switching) {
    closeEQPanel();
    eqBands = {};
    eqActive = null;
    closeEarScenesPicker();
    closeSnapshotEditor();
  }

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
  for (const [chNum, els] of channelRowCache) {
    const ch      = String(chNum);
    const muted   = !!(mutes?.[ch]);
    const soloed  = !!(solos?.[ch]);
    const soloOff = anySolo && !soloed;
    els.row.classList.toggle('ch-muted',    muted);
    els.row.classList.toggle('ch-solo-off', !muted && soloOff);
    els.row.classList.toggle('ch-soloed',   soloed);
    els.muteBtn.classList.toggle('active', muted);
    els.soloBtn.classList.toggle('active', soloed);
  }
}

function buildChannels(channels) {
  const list = document.getElementById('channelsList');
  list.innerHTML = '';
  volumeInputs = [];
  panInputs    = [];
  channelRowCache.clear();

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
      markSceneDirty();
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
    dbEl.className = 'fader-db tappable';
    dbEl.textContent = '-∞';
    dbEl.title = 'Tap to type an exact level';
    dbEl.addEventListener('click', (e) => {
      e.stopPropagation();
      promptSetVolume(volSlider, dbEl);
    });
    volWrap.appendChild(dbEl);

    addFaderOverlay(volSlider, () => resetVolSlider(volSlider, dbEl), true);

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
      markSceneDirty();
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
      markSceneDirty();
      panSlider.dispatchEvent(new Event('change', { bubbles: true }));
    });

    panLabel.append(panWrap);

    faderCol.append(volLabel, panLabel);
    row.append(info, msBtns, faderCol);
    list.appendChild(row);
    channelRowCache.set(ch.channel, { row, muteBtn, soloBtn });

    // Track by 1-based channel index
    volumeInputs[ch.channel - 1] = volSlider;
    panInputs[ch.channel - 1]    = panSlider;
  }
}

// ── Fader overlay — intercepts touch before iOS native range handler ──────
// Vertical gesture → scrolls .channels-wrap. Horizontal → moves fader.
// Also handles mouse drag and double-tap/dblclick reset.

function addFaderOverlay(slider, onReset, isLockable, scrollSelector) {
  const THUMB = 44;
  const wrap  = slider.parentNode; // .fader-wrap
  wrap.style.position = 'relative';
  scrollSelector = scrollSelector || '.channels-wrap';

  const overlay = document.createElement('div');
  // Cover the full wrap (height varies by layout)
  overlay.style.cssText = 'position:absolute;inset:0;z-index:2;touch-action:none;cursor:pointer;';
  wrap.appendChild(overlay);

  slider.style.pointerEvents = 'none';

  function locked() { return isLockable && sceneLocked; }

  function valueFromPos(clientX, clientY) {
    const rect = slider.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1,
      (clientX - rect.left - THUMB / 2) / (rect.width - THUMB)));
    return parseFloat(slider.min || 0) + frac * (parseFloat(slider.max || 1) - parseFloat(slider.min || 0));
  }

  function thumbScreenPos() {
    const rect = slider.getBoundingClientRect();
    const min  = parseFloat(slider.min  || 0);
    const max  = parseFloat(slider.max  || 1);
    const frac = (parseFloat(slider.value) - min) / (max - min);
    return { x: rect.left + THUMB / 2 + frac * (rect.width - THUMB), y: rect.top + rect.height / 2 };
  }

  function nearThumb(clientX, clientY) {
    return Math.abs(clientX - thumbScreenPos().x) <= THUMB / 2 + 8;
  }

  function apply(v) {
    slider.value = v;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Touch ──────────────────────────────────────────────────────────────
  let tStartX, tStartY, tLastX, tLastY, tDecided, tScrolling, tLastTap = 0;

  overlay.addEventListener('touchstart', e => {
    const t      = e.touches[0];
    tStartX = tLastX = t.clientX;
    tStartY = tLastY = t.clientY;

    if (locked() || !nearThumb(t.clientX, t.clientY)) {
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
      tScrolling = dy > dx; // horizontal = fader, vertical = scroll
    }

    if (tScrolling) {
      const scrollEl = document.querySelector(scrollSelector);
      if (scrollEl) scrollEl.scrollTop += tLastY - t.clientY;
      tLastX = t.clientX;
      tLastY = t.clientY;
    } else {
      apply(valueFromPos(t.clientX, t.clientY));
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
    if (locked() || !nearThumb(e.clientX, e.clientY)) return;
    const onMove = ev => apply(valueFromPos(ev.clientX, ev.clientY));
    const onUp   = ev => {
      apply(valueFromPos(ev.clientX, ev.clientY));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  overlay.addEventListener('dblclick', () => { if (!locked()) onReset(); });
}

function resetVolSlider(slider, dbEl) {
  slider.value = 0;
  setFaderVar(slider, 0);
  if (dbEl) dbEl.textContent = '-∞';
  markSceneDirty();
  slider.dispatchEvent(new Event('change', { bubbles: true }));
}

// Tap the dB readout to type an exact level instead of dragging the fader
async function promptSetVolume(slider, dbEl) {
  if (selectedAux === null) return;
  if (sceneLocked) { showToast('Mix locked — tap the banner above to unlock'); return; }
  const currentDb = sliderToDb(parseFloat(slider.value));
  const placeholder = currentDb <= -90 ? '-inf' : currentDb.toFixed(1);
  const raw = await showActionDialog({
    title: 'Set level in dB (-90 to +10, or "-inf")',
    showInput: true,
    inputValue: placeholder,
    confirmLabel: 'Set'
  });
  if (raw === null) return;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return;

  let v;
  if (trimmed === '-inf' || trimmed === '-∞' || trimmed === 'off') {
    v = 0;
  } else {
    const db = parseFloat(trimmed);
    if (!Number.isFinite(db)) { showToast('Enter a number between -90 and +10, or "-inf".'); return; }
    v = Math.max(0, Math.min(1, dbToSlider(Math.max(-90, Math.min(10, db)))));
  }

  slider.value = v;
  setFaderVar(slider, v);
  dbEl.textContent = formatDb(v);
  markSceneDirty();
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

// Glide a fader to a target value instead of jumping — used when a saved
// Ear Scene or My Mix loads, so the whole bank eases into place together.
const _faderAnimations = new WeakMap();

function animateFaderTo(slider, targetValue, duration = 550) {
  const dbEl = slider.parentNode.querySelector('.fader-db');
  const running = _faderAnimations.get(slider);
  if (running) cancelAnimationFrame(running);

  const startValue = parseFloat(slider.value);
  const startTime  = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — quick start, gentle settle
    const v = startValue + (targetValue - startValue) * eased;
    slider.value = v;
    setFaderVar(slider, v);
    if (dbEl) dbEl.textContent = formatDb(v);
    if (t < 1) {
      _faderAnimations.set(slider, requestAnimationFrame(step));
    } else {
      _faderAnimations.delete(slider);
    }
  }
  _faderAnimations.set(slider, requestAnimationFrame(step));
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

// ── EQ ────────────────────────────────────────────────────────────────────

const EQ_DB_MIN = -18, EQ_DB_MAX = 18;
const EQ_FREQ_MIN = 20, EQ_FREQ_MAX = 20000;
const VB_W = 380, VB_H = 160;
const VB_PAD_L = 24, VB_PAD_R = 8, VB_PAD_T = 10, VB_PAD_B = 18;
const PLOT_W = VB_W - VB_PAD_L - VB_PAD_R;
const PLOT_H = VB_H - VB_PAD_T - VB_PAD_B;
const EQ_BAND_COLORS = ['#ff6b6b','#ffa94d','#ffd43b','#69db7c','#4dabf7','#748ffc','#da77f2','#f783ac'];

let eqIn    = true;
let eqBands = {};        // { bandNum: { gain, freq, q } }
let eqActive = null;     // currently selected band number
let eqDragging = null;

function freqToX(f)  { return VB_PAD_L + (Math.log10(f / EQ_FREQ_MIN) / Math.log10(EQ_FREQ_MAX / EQ_FREQ_MIN)) * PLOT_W; }
function gainToY(db) { return VB_PAD_T + ((EQ_DB_MAX - db) / (EQ_DB_MAX - EQ_DB_MIN)) * PLOT_H; }
function xToFreq(x)  { return Math.max(EQ_FREQ_MIN, Math.min(EQ_FREQ_MAX, EQ_FREQ_MIN * Math.pow(EQ_FREQ_MAX / EQ_FREQ_MIN, (x - VB_PAD_L) / PLOT_W))); }
function yToGain(y)  { return Math.max(EQ_DB_MIN, Math.min(EQ_DB_MAX, EQ_DB_MAX - ((y - VB_PAD_T) / PLOT_H) * (EQ_DB_MAX - EQ_DB_MIN))); }

function clientToSVG(clientX, clientY) {
  const r = document.getElementById('eqCanvas').getBoundingClientRect();
  return { x: (clientX - r.left) / r.width * VB_W, y: (clientY - r.top) / r.height * VB_H };
}

function bandGainAtFreq(f, fc, gainDb, Q) {
  const sigma = 1 / (2 * (Q || 1.0));
  const octaves = Math.log2(f / fc);
  return gainDb * Math.exp(-(octaves * octaves) / (2 * sigma * sigma));
}

function totalGainAtFreq(f) {
  let total = 0;
  for (const band of Object.values(eqBands)) {
    if (band.gain !== undefined && band.freq) total += bandGainAtFreq(f, band.freq, band.gain, band.q);
  }
  return total;
}

function getTint(opacity) {
  const t = getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() || '232,0,60';
  return `rgba(${t},${opacity})`;
}

function renderEQGrid() {
  const svg = document.getElementById('eqCanvas');
  if (!svg) return;
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';

  const g = document.createElementNS(ns, 'g');
  g.setAttribute('id', 'eq-grid');

  [[100,'100Hz'],[1000,'1k'],[10000,'10k']].forEach(([f, label]) => {
    const x = freqToX(f);
    const vl = document.createElementNS(ns, 'line');
    Object.entries({ x1:x, y1:VB_PAD_T, x2:x, y2:VB_PAD_T+PLOT_H, stroke:'rgba(255,255,255,0.08)', 'stroke-width':'0.5' }).forEach(([k,v]) => vl.setAttribute(k,v));
    g.appendChild(vl);
    const tl = document.createElementNS(ns, 'text');
    Object.entries({ x, y:VB_H-3, 'text-anchor':'middle', 'font-size':'7', fill:'rgba(255,255,255,0.3)' }).forEach(([k,v]) => tl.setAttribute(k,v));
    tl.textContent = label; g.appendChild(tl);
  });
  [-12,-6,0,6,12].forEach(db => {
    const y = gainToY(db);
    const hl = document.createElementNS(ns, 'line');
    Object.entries({ x1:VB_PAD_L, y1:y, x2:VB_PAD_L+PLOT_W, y2:y, stroke: db===0?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.07)', 'stroke-width': db===0?'1':'0.5' }).forEach(([k,v]) => hl.setAttribute(k,v));
    g.appendChild(hl);
    const tl = document.createElementNS(ns, 'text');
    Object.entries({ x:VB_PAD_L-3, y:y+2.5, 'text-anchor':'end', 'font-size':'6', fill:'rgba(255,255,255,0.3)' }).forEach(([k,v]) => tl.setAttribute(k,v));
    tl.textContent = db===0?'0':(db>0?'+'+db:db); g.appendChild(tl);
  });

  svg.appendChild(g);
}

function renderEQCurve() {
  const svg = document.getElementById('eqCanvas');
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';

  // Ensure grid exists (first render or after panel reopen)
  if (!svg.querySelector('#eq-grid')) renderEQGrid();

  // Remove and rebuild only the dynamic layer (curve + handles)
  const old = svg.querySelector('#eq-dyn');
  if (old) svg.removeChild(old);
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('id', 'eq-dyn');

  // EQ curve + fill — build path as array then join (faster than string concat)
  const N = 180;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const f = EQ_FREQ_MIN * Math.pow(EQ_FREQ_MAX / EQ_FREQ_MIN, i / N);
    const gain = eqIn ? totalGainAtFreq(f) : 0;
    pts.push((i === 0 ? 'M' : 'L') + freqToX(f).toFixed(1) + ' ' + gainToY(gain).toFixed(1));
  }
  const pathData = pts.join('');
  const zeroY = gainToY(0);
  const fill = document.createElementNS(ns, 'path');
  fill.setAttribute('d', pathData + ` L${freqToX(EQ_FREQ_MAX).toFixed(1)},${zeroY} L${freqToX(EQ_FREQ_MIN).toFixed(1)},${zeroY} Z`);
  fill.setAttribute('fill', eqIn ? getTint(0.12) : 'rgba(255,255,255,0.04)');
  fill.setAttribute('stroke', 'none');
  g.appendChild(fill);
  const curve = document.createElementNS(ns, 'path');
  curve.setAttribute('d', pathData);
  curve.setAttribute('fill', 'none');
  curve.setAttribute('stroke', eqIn ? getTint(0.9) : 'rgba(255,255,255,0.2)');
  curve.setAttribute('stroke-width', '1.5');
  g.appendChild(curve);

  // Band handles
  for (const [bStr, band] of Object.entries(eqBands)) {
    if (band.gain === undefined || !band.freq) continue;
    const b = parseInt(bStr);
    const x = freqToX(band.freq), y = gainToY(band.gain);
    const color = EQ_BAND_COLORS[(b-1) % EQ_BAND_COLORS.length];
    const isActive = eqActive === b;
    const circ = document.createElementNS(ns, 'circle');
    Object.entries({ cx:x, cy:y, r:isActive?9:7, fill:color, stroke: isActive?'#fff':color, 'stroke-width': isActive?2:1, opacity: eqIn?1:0.4 }).forEach(([k,v]) => circ.setAttribute(k,v));
    g.appendChild(circ);
    const lbl = document.createElementNS(ns, 'text');
    Object.entries({ x, y:y+3, 'text-anchor':'middle', 'font-size':'7', 'font-weight':'bold', fill:'#000' }).forEach(([k,v]) => lbl.setAttribute(k,v));
    lbl.textContent = b; g.appendChild(lbl);
  }

  svg.appendChild(g);
}

// Log-scale helpers for freq and Q sliders (0-1000 range maps to log domain)
function freqToSlider(f)   { return Math.round(Math.log10(f / EQ_FREQ_MIN) / Math.log10(EQ_FREQ_MAX / EQ_FREQ_MIN) * 1000); }
function sliderToFreq(v)   { return EQ_FREQ_MIN * Math.pow(EQ_FREQ_MAX / EQ_FREQ_MIN, v / 1000); }
function qToSlider(q)      { return Math.round(Math.log10(Math.max(0.1, q) / 0.1) / Math.log10(100) * 1000); }
function sliderToQ(v)      { return Math.max(0.1, 0.1 * Math.pow(100, v / 1000)); }
function fmtFreq(f)        { return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + ''; }
function fmtGain(db)       { return (db >= 0 ? '+' : '') + db.toFixed(1); }
function fmtQ(q)           { return q.toFixed(2); }

function updateEQBandInfo() {
  const hint     = document.getElementById('eqBandInfo');
  const controls = document.getElementById('eqControls');
  if (!hint || !controls) return;

  if (eqActive === null || !eqBands[eqActive]) {
    hint.style.display     = '';
    controls.style.display = 'none';
    return;
  }

  hint.style.display     = 'none';
  controls.style.display = '';

  const band  = eqBands[eqActive];
  const color = EQ_BAND_COLORS[(eqActive - 1) % EQ_BAND_COLORS.length];

  document.getElementById('eqCtrlBadge').style.background = color;
  document.getElementById('eqCtrlBadge').textContent = `B${eqActive}`;
  document.getElementById('eqCtrlTitle').textContent  = `Band ${eqActive}`;

  // Set slider positions without triggering input handlers
  document.getElementById('eqCtrlFreq').value = freqToSlider(band.freq ?? 1000);
  document.getElementById('eqCtrlGain').value = band.gain ?? 0;
  document.getElementById('eqCtrlQ').value    = qToSlider(band.q ?? 1.0);

  // Update value labels
  document.getElementById('eqCtrlFreqVal').textContent = fmtFreq(band.freq ?? 1000) + ' Hz';
  document.getElementById('eqCtrlGainVal').textContent = fmtGain(band.gain ?? 0) + ' dB';
  document.getElementById('eqCtrlQVal').textContent    = fmtQ(band.q ?? 1.0);
}

// Slider event handlers — wired once, act on eqActive band
(function initEQSliders() {
  let freqTimer = null, gainTimer = null, qTimer = null;

  function throttledSend(timerRef, address, value) {
    clearTimeout(timerRef);
    return setTimeout(() => sendOSC(address, [value]), 60);
  }

  document.getElementById('eqCtrlFreq').addEventListener('input', e => {
    if (eqActive === null || !eqBands[eqActive]) return;
    const aux = selectedAux; const band = eqActive;
    const freq = sliderToFreq(parseFloat(e.target.value));
    eqBands[band].freq = freq;
    document.getElementById('eqCtrlFreqVal').textContent = fmtFreq(freq) + ' Hz';
    renderEQCurve();
    freqTimer = throttledSend(freqTimer, `/Aux_Outputs/${aux}/EQ/eq_freq_${band}`, freq);
  });

  document.getElementById('eqCtrlGain').addEventListener('input', e => {
    if (eqActive === null || !eqBands[eqActive]) return;
    const aux = selectedAux; const band = eqActive;
    const gain = parseFloat(e.target.value);
    eqBands[band].gain = gain;
    document.getElementById('eqCtrlGainVal').textContent = fmtGain(gain) + ' dB';
    renderEQCurve();
    gainTimer = throttledSend(gainTimer, `/Aux_Outputs/${aux}/EQ/eq_gain_${band}`, gain);
  });

  document.getElementById('eqCtrlQ').addEventListener('input', e => {
    if (eqActive === null || !eqBands[eqActive]) return;
    const aux = selectedAux; const band = eqActive;
    const q = sliderToQ(parseFloat(e.target.value));
    eqBands[band].q = q;
    document.getElementById('eqCtrlQVal').textContent = fmtQ(q);
    renderEQCurve();
    qTimer = throttledSend(qTimer, `/Aux_Outputs/${aux}/EQ/eq_Q_${band}`, q);
  });

  document.getElementById('eqResetBtn').addEventListener('click', () => {
    if (eqActive === null || !eqBands[eqActive]) return;
    const aux = selectedAux; const band = eqActive;
    eqBands[band].gain = 0;
    sendOSC(`/Aux_Outputs/${aux}/EQ/eq_gain_${band}`, [0]);
    renderEQCurve();
    updateEQBandInfo();
  });
})();

function findNearestBand(x, y) {
  let nearest = null, minDist = 20;
  for (const [bStr, band] of Object.entries(eqBands)) {
    if (band.gain === undefined || !band.freq) continue;
    const d = Math.hypot(x - freqToX(band.freq), y - gainToY(band.gain));
    if (d < minDist) { minDist = d; nearest = parseInt(bStr); }
  }
  return nearest;
}

function applyEQData(data) {
  eqIn = (data.eq_in !== undefined) ? !!data.eq_in : true;
  eqBands = {};
  for (let b = 1; b <= 8; b++) {
    const gain = data[`eq_gain_${b}`];
    const freq = data[`eq_freq_${b}`];
    const q    = data[`eq_Q_${b}`];
    if (gain !== undefined || freq !== undefined) {
      eqBands[b] = { gain: gain ?? 0, freq: freq ?? 1000, q: q ?? 1.0 };
    }
  }
}

function applyEQParam(param, value) {
  const mGain = param.match(/^eq_gain_(\d+)$/);
  const mFreq = param.match(/^eq_freq_(\d+)$/);
  const mQ    = param.match(/^eq_Q_(\d+)$/);
  if (mGain) { const b = parseInt(mGain[1]); if (!eqBands[b]) eqBands[b] = { gain:0, freq:1000, q:1 }; eqBands[b].gain = value; }
  if (mFreq) { const b = parseInt(mFreq[1]); if (!eqBands[b]) eqBands[b] = { gain:0, freq:1000, q:1 }; eqBands[b].freq = value; }
  if (mQ)    { const b = parseInt(mQ[1]);    if (!eqBands[b]) eqBands[b] = { gain:0, freq:1000, q:1 }; eqBands[b].q    = value; }
  if (param === 'eq_in') { eqIn = !!value; }
}

function openEQPanel() {
  if (selectedAux === null) return;
  eqActive = null;
  document.body.classList.add('eqOpen');
  renderEQGrid();   // static grid — built once per panel open
  renderEQCurve();  // dynamic curve + handles
  updateEQBandInfo();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'request-aux-eq', aux: selectedAux }));
  }
}

function closeEQPanel() {
  document.body.classList.remove('eqOpen');
}

// SVG pointer interaction
(function initEQInteraction() {
  const svg = document.getElementById('eqCanvas');
  let throttleTimer = null;
  let rafPending    = false;

  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    const { x, y } = clientToSVG(e.clientX, e.clientY);
    const b = findNearestBand(x, y);
    if (b === null) return;
    eqDragging = b;
    eqActive   = b;
    svg.setPointerCapture(e.pointerId);
    renderEQCurve();
    updateEQBandInfo();
  });

  svg.addEventListener('pointermove', e => {
    if (eqDragging === null) return;
    e.preventDefault();
    const { x, y } = clientToSVG(e.clientX, e.clientY);
    eqBands[eqDragging].gain = yToGain(y);
    eqBands[eqDragging].freq = xToFreq(x);
    updateEQBandInfo();
    // Gate SVG rebuild to one render per animation frame — avoids redundant
    // DOM work on 120 Hz displays where pointermove fires faster than rAF.
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; renderEQCurve(); });
    }
    // Throttle OSC sends to 60ms during drag — capture aux+band now so the
    // timer can't fire against a different aux if the panel closes mid-drag.
    const aux = selectedAux; const band = eqDragging;
    if (!throttleTimer) {
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        if (band !== null && aux !== null && eqBands[band]) {
          sendOSC(`/Aux_Outputs/${aux}/EQ/eq_gain_${band}`, [eqBands[band].gain]);
          sendOSC(`/Aux_Outputs/${aux}/EQ/eq_freq_${band}`, [eqBands[band].freq]);
        }
      }, 60);
    }
  });

  svg.addEventListener('pointerup', e => {
    if (eqDragging === null) return;
    const aux = selectedAux; const b = eqDragging;
    eqDragging = null;
    if (aux !== null && eqBands[b]) {
      sendOSC(`/Aux_Outputs/${aux}/EQ/eq_gain_${b}`, [eqBands[b].gain]);
      sendOSC(`/Aux_Outputs/${aux}/EQ/eq_freq_${b}`, [eqBands[b].freq]);
    }
  });
})();

document.getElementById('eqCloseBtn').addEventListener('click', closeEQPanel);

// ── My Mixes — open/close picker, save current mix ────────────────────────

document.getElementById('mixesCloseBtn').addEventListener('click', closeMixesPicker);
document.getElementById('mixesSaveBtn').addEventListener('click', savePresetPrompt);

// ── Ear Scenes — open/close list, open/close/save the offline editor ──────

document.getElementById('earScenesCloseBtn').addEventListener('click', closeEarScenesPicker);
document.getElementById('snapshotEditCloseBtn').addEventListener('click', closeSnapshotEditor);
document.getElementById('snapshotEditCancelBtn').addEventListener('click', closeSnapshotEditor);
document.getElementById('snapshotEditSaveBtn').addEventListener('click', () => {
  if (!snapshotEditName) { closeSnapshotEditor(); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const values = {};
  for (const [ch, v] of Object.entries(snapshotEditValues)) values[ch] = v;
  ws.send(JSON.stringify({ type: 'save-scene', aux: selectedAux, snapshot: snapshotEditName, values }));
  closeSnapshotEditor();
});

// ── Tap the scene status banner — revert if dirty, otherwise toggle the lock ──

document.getElementById('sceneStatus').addEventListener('click', () => {
  if (selectedAux === null || !hasSavedScene()) return;
  if (sceneDirty) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'recall-scene', aux: selectedAux }));
    return;
  }
  sceneLocked = !sceneLocked;
  updateSceneUI();
});

// ── Menu drawer ───────────────────────────────────────────────────────────

function showMenuPage(page) {
  document.getElementById('menuPageMain').style.display      = page === 'main'      ? '' : 'none';
  document.getElementById('menuPageEarScenes').style.display = page === 'earScenes' ? '' : 'none';
}

// Always reopen on the main page — don't leave it stuck on a submenu from last time
function openMenu()  { showMenuPage('main'); document.body.classList.add('menuOpen'); }
function closeMenu() { document.body.classList.remove('menuOpen'); }

document.getElementById('menuBtn').addEventListener('click', openMenu);
document.getElementById('menuBackdrop').addEventListener('click', closeMenu);

document.getElementById('menuEqItem').addEventListener('click', () => {
  closeMenu();
  openEQPanel();
});

document.getElementById('menuMixesItem').addEventListener('click', () => {
  closeMenu();
  openMixesPicker();
});

document.getElementById('menuEarScenesParentItem').addEventListener('click', () => {
  showMenuPage('earScenes');
});

document.getElementById('menuEarScenesBackBtn').addEventListener('click', () => {
  showMenuPage('main');
});

document.getElementById('menuEarScenesItem').addEventListener('click', () => {
  closeMenu();
  openEarScenesPicker();
});

document.getElementById('menuSceneItem').addEventListener('click', () => {
  if (selectedAux === null || !ws || ws.readyState !== WebSocket.OPEN) return;
  closeMenu();
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

// ── Fader layout size ─────────────────────────────────────────────────────

const LAYOUT_CLASSES = ['layout-compact', 'layout-normal', 'layout-large'];

function applyLayout(layout) {
  LAYOUT_CLASSES.forEach(c => document.body.classList.remove(c));
  document.body.classList.add('layout-' + layout);
document.querySelectorAll('.menu-layout-btn').forEach(btn => {
    btn.classList.toggle('menu-layout-active', btn.dataset.layout === layout);
  });
  localStorage.setItem('jpm_layout', layout);
}

applyLayout(localStorage.getItem('jpm_layout') || 'normal');

document.querySelectorAll('.menu-layout-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    closeMenu();
    applyLayout(btn.dataset.layout);
  });
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
