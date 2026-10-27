'use strict';

const $ = id => document.getElementById(id);

// ── Icon set ──────────────────────────────────────────────────────────────

const CUSTOM_ICONS = {
  // Drum Kit
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
  // Guitar
  acousticguitar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><ellipse cx="11" cy="16.5" rx="6.5" ry="5.5"/><circle cx="11" cy="16.5" r="2" stroke-width="1.2"/><rect x="9.5" y="5" width="3" height="11" rx="1.5"/><line x1="8.5" y1="7" x2="13.5" y2="7" stroke-width="1.2"/><line x1="8.5" y1="9.5" x2="13.5" y2="9.5" stroke-width="1.2"/></svg>`,
  electricguitar:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M8 20 Q4 20 4 16 Q4 13 7 12 Q5 9 6 7 Q8 5 10 7 Q12 5 14 7 Q14 9 12 11 Q15 12 15 15 Q15 21 10 21 Z"/><line x1="14" y1="7" x2="22" y2="2"/><line x1="20" y1="3.5" x2="21.5" y2="5.5" stroke-width="1.3"/></svg>`,
  bass:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M9 21 Q4 21 4 16 Q4 12 8 12 Q6 9 7 6 Q9 4 11 6 Q14 4 15 6 Q15 9 13 11 Q17 12 16 17 Q15 22 9 22 Z"/><line x1="15" y1="6" x2="23" y2="3"/><line x1="21" y1="4" x2="22.5" y2="6" stroke-width="1.3"/></svg>`,
  // Keys
  piano:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="14" rx="2"/><line x1="6.5" y1="7" x2="6.5" y2="21"/><line x1="11" y1="7" x2="11" y2="21"/><line x1="15.5" y1="7" x2="15.5" y2="21"/><line x1="20" y1="7" x2="20" y2="21"/><rect x="4" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="17.5" y="7" width="3.5" height="8" rx="1" fill="currentColor" stroke="none"/></svg>`,
  synth:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="5" width="22" height="17" rx="2"/><line x1="5.5" y1="14" x2="5.5" y2="22"/><line x1="10" y1="14" x2="10" y2="22"/><line x1="14.5" y1="14" x2="14.5" y2="22"/><line x1="19" y1="14" x2="19" y2="22"/><rect x="3.5" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="8" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="12.5" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="17" y="14" width="3.5" height="5" rx="1" fill="currentColor" stroke="none"/><circle cx="5" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  organ:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="9" rx="1.5"/><rect x="2" y="13" width="20" height="9" rx="1.5"/><line x1="6.5" y1="2" x2="6.5" y2="11"/><line x1="11" y1="2" x2="11" y2="11"/><line x1="15.5" y1="2" x2="15.5" y2="11"/><line x1="20" y1="2" x2="20" y2="11"/><rect x="4" y="2" width="3.5" height="5.5" rx="1" fill="currentColor" stroke="none"/><rect x="8.5" y="2" width="3.5" height="5.5" rx="1" fill="currentColor" stroke="none"/><line x1="6.5" y1="13" x2="6.5" y2="22"/><line x1="11" y1="13" x2="11" y2="22"/><line x1="15.5" y1="13" x2="15.5" y2="22"/><line x1="20" y1="13" x2="20" y2="22"/></svg>`,
  // Brass & Wind
  trumpet:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="7" y2="12"/><rect x="7" y="9" width="2.5" height="6" rx="1"/><path d="M9.5 9 Q9.5 6 13 6 Q16.5 6 16.5 9"/><path d="M9.5 15 Q9.5 18 13 18 Q16.5 18 16.5 15"/><path d="M16.5 12 Q19 12 21 14 Q23 17 20 20 Q17 22 15 20"/></svg>`,
  saxophone:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M16 2 Q20 3 21 8 Q22 13 19 18 Q16 22 12 22 Q8 22 6 19 Q4 16 6 14"/><circle cx="6" cy="14" r="3"/><circle cx="11" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/></svg>`,
  flute:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="22" y2="12"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none"/><rect x="20" y="9" width="2" height="6" rx="1"/></svg>`,
  // Vocals
  vocal:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11 Q5 18 12 18 Q19 18 19 11"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>`,
  backvocal:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="2" width="5" height="9" rx="2.5"/><path d="M2 10 Q2 16 7.5 16 Q13 16 13 10"/><rect x="15" y="3" width="4" height="7" rx="2"/><path d="M13 9 Q13 14 17 14 Q21 14 21 9"/><line x1="7.5" y1="16" x2="7.5" y2="22"/><line x1="17" y1="14" x2="17" y2="22"/></svg>`,
  // Strings
  violin:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L12 5"/><path d="M12 5 Q9 6 7 9 Q5 12 7 15 Q9 17 9 19 Q9 22 12 22 Q15 22 15 19 Q15 17 17 15 Q19 12 17 9 Q15 6 12 5 Z"/><path d="M9 12 Q12 13.5 15 12" stroke-width="1.2"/></svg>`,
  cello:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 1 L12 4"/><path d="M12 4 Q8 5.5 6 9 Q4 13 6 17 Q8.5 19.5 8.5 21 Q8.5 23 12 23 Q15.5 23 15.5 21 Q15.5 19.5 18 17 Q20 13 18 9 Q16 5.5 12 4 Z"/><path d="M8.5 12 Q12 14 15.5 12" stroke-width="1.2"/></svg>`,
  // Audio
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

const ICON_GROUPS = [
  { label: 'Drum Kit',    keys: ['kick','snare','hihat','crash','ride','tom','floortom','overheads','cajon','djembe','congas','shaker','tambourine'] },
  { label: 'Guitar',      keys: ['acousticguitar','electricguitar','bass','banjo'] },
  { label: 'Keys',        keys: ['piano','synth','organ'] },
  { label: 'Brass & Wind', keys: ['trumpet','trombone','saxophone','flute','harmonica'] },
  { label: 'Vocals',      keys: ['vocal','backvocal','choir','mic'] },
  { label: 'Strings',     keys: ['violin','cello'] },
  { label: 'Audio',       keys: ['amp','di','percussion','click','playback','fx'] },
];

const ICON_LABELS = {
  kick:'Kick Drum', snare:'Snare Drum', hihat:'Hi-Hat', crash:'Crash Cymbal',
  ride:'Ride Cymbal', tom:'Rack Tom', floortom:'Floor Tom', overheads:'Overheads',
  cajon:'Cajon', djembe:'Djembe', congas:'Congas', shaker:'Shaker', tambourine:'Tambourine',
  acousticguitar:'Acoustic Guitar', electricguitar:'Electric Guitar', bass:'Bass Guitar', banjo:'Banjo',
  piano:'Piano', synth:'Synth / Keys', organ:'Organ',
  trumpet:'Trumpet', trombone:'Trombone', saxophone:'Saxophone', flute:'Flute', harmonica:'Harmonica',
  vocal:'Lead Vocal', backvocal:'Background Vocal', choir:'Choir', mic:'Microphone',
  violin:'Violin', cello:'Cello',
  amp:'Amp', di:'DI Box', percussion:'Percussion', click:'Click Track', playback:'Playback / Backing', fx:'FX Return',
};


function instrumentIconURL(n) {
  const folder = n <= 70 ? '1-To-70-SVG-Files-MusicalInstrumentsBundle' : '71-To-120-SVG-Files-MusicalInstrumentsBundle';
  return new URL(`../../../assets/Icons For instruments/${folder}/${n}.svg`, document.baseURI).href;
}

function renderIconHTML(icon) {
  if (!icon) return '+';
  if (icon.startsWith('img:')) {
    const key = icon.slice(4);
    const svg = CUSTOM_ICONS[key];
    return svg ? `<span class="custom-icon">${svg}</span>` : '+';
  }
  if (icon.startsWith('file:')) {
    const n = parseInt(icon.slice(5));
    if (!Number.isInteger(n) || n < 1 || n > 120) return '+';
    return `<img class="instrument-icon" src="${instrumentIconURL(n)}" width="18" height="18" />`;
  }
  return icon; // emoji
}

// ── Existing config fields ────────────────────────────────────────────────

const fields = {
  serverPort:     { el: $('serverPort'),     key: 'serverPort',     parse: Number },
  deskIp:         { el: $('deskIp'),         key: 'deskIp',         parse: String },
  deskSendPort:   { el: $('deskSendPort'),   key: 'deskSendPort',   parse: Number },
  deskListenPort: { el: $('deskListenPort'), key: 'deskListenPort', parse: Number },
  consoleType:    { el: $('consoleType'),    key: 'consoleType',    parse: String },
  channels:       { el: $('channels'),       key: 'channels',       parse: Number },
  auxes:          { el: $('auxes'),          key: 'auxes',          parse: Number },
  groups:         { el: $('groups'),         key: 'groups',         parse: Number },
  autoBackupIntervalDays: { el: $('autoBackupInterval'), key: 'autoBackupIntervalDays', parse: Number },
  dliveBaseChannel: { el: $('dliveBaseChannel'), key: 'dliveBaseChannel', parse: Number },
  dliveMidiPort:    { el: $('dliveMidiPort'),    key: 'dliveMidiPort',    parse: Number },
  dliveUsername:    { el: $('dliveUsername'),    key: 'dliveUsername',    parse: String },
  dlivePassword:    { el: $('dlivePassword'),    key: 'dlivePassword',    parse: String },
  klangIp:          { el: $('klangIp'),          key: 'klangIp',          parse: String },
  klangPort:        { el: $('klangPort'),        key: 'klangPort',        parse: Number },
  wingPort:         { el: $('wingPort'),         key: 'wingPort',         parse: Number },
  lv1Port:          { el: $('lv1Port'),          key: 'lv1Port',          parse: Number },
  apiPort:          { el: $('apiPort'),          key: 'apiPort',          parse: Number },
  apiToken:         { el: $('apiToken'),          key: 'apiToken',        parse: String },
  pcoAppId:         { el: $('pcoAppId'),          key: 'pcoAppId',        parse: v => String(v).trim() },
  pcoSecret:        { el: $('pcoSecret'),         key: 'pcoSecret',       parse: v => String(v).trim() },
  pcoDay:           { el: $('pcoDay'),            key: 'pcoDay',          parse: String },
  companionHost:    { el: $('companionHost'),     key: 'companionHost',   parse: v => String(v).trim() },
  companionPort:    { el: $('companionPort'),     key: 'companionPort',   parse: Number },
  companionColumns: { el: $('companionColumns'),  key: 'companionColumns', parse: Number },
  companionRows:    { el: $('companionRows'),     key: 'companionRows',   parse: Number },
  smaartHost:       { el: $('smaartHost'),        key: 'smaartHost',      parse: v => String(v).trim() },
  smaartPort:       { el: $('smaartPort'),        key: 'smaartPort',      parse: Number },
  smaartPassword:   { el: $('smaartPassword'),    key: 'smaartPassword',  parse: String },
};

// Only one console's connection fields are relevant at a time — DiGiCo's
// send/listen OSC ports vs dLive's base MIDI channel/TLS/auth vs KLANG's
// processor IP/port (which also reuses the dLive fields for its own
// optional, paired-console connection — see klang-server.js).
function updateConsoleTypeFields() {
  const consoleType = $('consoleType').value;
  const isDlive = consoleType === 'dlive';
  const isKlang = consoleType === 'klang';
  const isWing  = consoleType === 'wing';
  const isLv1   = consoleType === 'lv1';
  isDliveType = isDlive;
  isConsoleControllerUnsupported = isKlang || isWing; // DiGiCo, dLive and LV1 have one

  $('digicoPortsRow').style.display = (isDlive || isKlang || isWing || isLv1) ? 'none' : '';
  // Control Groups: DiGiCo's, or dLive's DCAs (up to 24). LV1 reports its own.
  $('groupsField').style.display = (isKlang || isWing || isLv1) ? 'none' : '';
  $('groups').max = isDlive ? '24' : '64';
  if (isDlive && Number($('groups').value) > 24) $('groups').value = '24';
  $('klangIpRow').style.display     = isKlang ? '' : 'none';
  $('klangFieldsRow').style.display = isKlang ? '' : 'none';
  $('wingFieldsRow').style.display  = isWing ? '' : 'none';
  $('lv1FieldsRow').style.display   = isLv1 ? '' : 'none';
  // WING is self-contained (reuses Console IP Address directly, like plain
  // dLive) — it never touches the dLive-specific fields block at all.
  $('dliveFieldsRow').style.display = (isDlive || isKlang) ? '' : 'none';
  $('dliveAuthRow').style.display   = ((isDlive || isKlang) && $('dliveTlsEnabled').checked) ? '' : 'none';
  $('dliveWarningText').textContent = isKlang
    ? 'When set, this must point at the same console — under Utility → Control → MIDI — that KLANG is paired with.'
    : '⚠️ dLive support has been tested against dLive Director running offline, not yet a real MixRack. Aux send levels, mute, solo, scene recall, Ear Scenes, live names and the Console Controller (channel, aux and DCA faders, mutes and solos) work; per-send pan and EQ are not available over dLive’s MIDI control. To try it without a console, run dLive Director offline with System → Offline → “Enable Director Connections to MixRack IP Controllers” ticked, and use this computer’s address with Director’s MIDI channel.';
  $('deskIpLabel').textContent = isKlang ? 'dLive Console IP Address (optional)' : isLv1 ? 'LV1 Computer IP Address' : 'Console IP Address';
  $('deskIp').placeholder = isLv1 ? 'Blank = find LV1 on the network' : '192.168.1.100';

  // dLive's protocol has a hard ceiling — 128 input channels, 62 mono aux
  // sends (this integration doesn't use the separate stereo-aux pool). The
  // server now degrades gracefully past that rather than crashing, but
  // catching it here means nobody has to find that out by hitting it. KLANG
  // and WING have no documented equivalent ceiling, so their channel/aux
  // counts stay at the generic defaults.
  $('channels').max = isDlive ? '128' : '256';
  $('auxes').max     = isDlive ? '62'  : '64';
  if (isDlive && Number($('channels').value) > 128) $('channels').value = '128';
  if (isDlive && Number($('auxes').value) > 62)      $('auxes').value = '62';
  renderAuxes();
  setStatus(isRunning);
}
$('consoleType').addEventListener('change', updateConsoleTypeFields);
$('dliveTlsEnabled').addEventListener('change', updateConsoleTypeFields);

for (const id of ['wingPort', 'lv1Port']) {
  $(id).addEventListener('change', () => {
    const raw = Number($(id).value) || 0;
    $(id).value = (raw === 0) ? 0 : Math.max(1, Math.min(65535, raw));
  });
}

// ── External Control API ────────────────────────────────────────────────

function updateApiFieldsVisibility() {
  const enabled = $('apiEnabled').checked;
  $('apiFieldsRow').style.display = enabled ? '' : 'none';
  $('apiTokenStatus').textContent = enabled && !$('apiToken').value
    ? 'No token yet — click Regenerate to create one before enabling any external tool.'
    : '';
}
$('apiEnabled').addEventListener('change', updateApiFieldsVisibility);

$('apiPort').addEventListener('change', () => {
  const raw = Number($('apiPort').value) || 9096;
  $('apiPort').value = Math.max(1, Math.min(65535, raw));
});

$('apiCopyTokenBtn').addEventListener('click', async () => {
  if (!$('apiToken').value) return;
  try {
    await navigator.clipboard.writeText($('apiToken').value);
    $('apiTokenStatus').textContent = 'Copied.';
    setTimeout(updateApiFieldsVisibility, 1500);
  } catch (_) {}
});

$('apiRegenTokenBtn').addEventListener('click', async () => {
  const result = await window.jpm.generateApiToken();
  if (!result.ok) { alert(result.error || 'Could not generate a new token.'); return; }
  $('apiToken').value = result.token;
  updateApiFieldsVisibility();
});

// ── Planning Center ────────────────────────────────────────────────────

let pcoPositionMapping = {};   // { "PCO position name": auxNumber } — saved to config on Save & Apply
let pcoGreenRoomHidden = [];   // PCO position names excluded from the Green Room display
let pcoSavedServiceTypeId = ''; // restored into the dropdown once a live fetch populates it
let pcoSavedTeamId = '';        // ditto, for the Team dropdown
// The Home pages (FOH, ProPresenter, Lighting, Switcher) each welcome whoever
// is scheduled in their own Team + Position. `key` names the element ids
// (pco<key>Team, pco<key>Position, on the Pages tab under that page).
const PCO_ROLE_PAGES = [
  { key: 'Foh',          route: '/foh.html',          teamKey: 'pcoFohTeamId',          positionKey: 'pcoFohPositionName' },
  { key: 'ProPresenter', route: '/propresenter.html', teamKey: 'pcoProPresenterTeamId', positionKey: 'pcoProPresenterPositionName' },
  { key: 'Lighting',     route: '/lighting.html',     teamKey: 'pcoLightingTeamId',     positionKey: 'pcoLightingPositionName' },
  { key: 'Switcher',     route: '/switcher.html',     teamKey: 'pcoSwitcherTeamId',     positionKey: 'pcoSwitcherPositionName' },
];
// Each Home page's saved { team, position }, restored into its dropdowns
// once a live fetch populates them
let pcoSavedRolePicks = {};
const blankRolePicks = () => Object.fromEntries(PCO_ROLE_PAGES.map(r => [r.key, { team: '', position: '' }]));
// The team picks as saved for the saved Service Type — restored if the
// engineer switches Service Type away and back before saving.
let pcoPicksForSavedType = { team: '', roles: blankRolePicks() };
function rolePicksFrom(cfg) {
  return Object.fromEntries(PCO_ROLE_PAGES.map(r => [r.key, { team: cfg[r.teamKey] || '', position: cfg[r.positionKey] || '' }]));
}
// Whether each dropdown holds a real list from Planning Center. Until it does
// (offline, bad credentials, never refreshed), Save & Apply keeps the saved
// value — reading the empty dropdown used to wipe the Service Type and Team.
let pcoServiceTypesLoaded = false;
let pcoTeamsLoaded = false;
let pcoAllPositions = [];      // full result of the last Refresh Positions fetch (every team) — the Team
                                // dropdown re-filters this in place, no new network call per team switch

// Each Home page's Team + Role dropdowns sit under that page on the Pages tab
for (const r of PCO_ROLE_PAGES) {
  $(`pco${r.key}Team`).addEventListener('change', () => {
    if (pcoAllPositions.length) renderPcoRolePositionOptions(r);
  });
}

// Same two-step pattern as renderPcoPositionsForSelectedTeam(): a Team
// dropdown narrows which Positions this one offers, independent of the
// main pcoTeam/pcoPositionMapping pairing above it.
function renderPcoRolePositionOptions(r) {
  const sel = $(`pco${r.key}Position`);
  const teamId = $(`pco${r.key}Team`).value;
  const saved = pcoSavedRolePicks[r.key] || { team: '', position: '' };
  const filtered = teamId ? pcoAllPositions.filter((p) => p.teamId === teamId) : pcoAllPositions;
  sel.innerHTML = '<option value="">— None —</option>'
    + filtered.map((p) => `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`).join('');
  if (saved.position && teamId === saved.team && filtered.some((p) => p.name === saved.position)) {
    sel.value = saved.position;
  }
}
function renderAllRolePositionOptions() { for (const r of PCO_ROLE_PAGES) renderPcoRolePositionOptions(r); }

function pcoAuxOptionsHtml(selectedAux) {
  const auxCount = parseInt($('auxes').value) || 16;
  let html = '<option value="">— unmapped —</option>';
  for (let i = 1; i <= auxCount; i++) {
    const name = (auxOverrides[String(i)] && auxOverrides[String(i)].label) || auxNames[String(i)] || `AUX ${i}`;
    const sel = String(selectedAux) === String(i) ? ' selected' : '';
    html += `<option value="${i}"${sel}>${i} — ${escHtml(name)}</option>`;
  }
  return html;
}

// Shown before any live "Refresh Positions" fetch this session — the saved
// mapping as plain text, since we don't yet know the live PCO position list
// to build editable rows against.
function renderPcoPositionsFallback() {
  const container = $('pcoPositionsList');
  const entries = Object.entries(pcoPositionMapping);
  if (entries.length === 0) {
    container.textContent = 'Pick a Service Type above, then click Refresh Positions.';
    return;
  }
  container.innerHTML = entries.map(([pos, aux]) => `<div>${escHtml(pos)} → Aux ${escHtml(aux)}</div>`).join('')
    + '<div style="margin-top:6px">Click Refresh Positions to edit this mapping.</div>';
}

// Always uses whatever's currently typed in the App ID/Secret fields, not
// whatever was last saved — otherwise Refresh/Sync would silently 401 using
// stale (or blank) credentials until the user thought to click Save & Apply
// first, which isn't an obvious step before testing a connection.
// With Use Planning Center as it is here (unsaved too): off, JPMixer doesn't contact it
function pcoCredsFromFields() {
  return { appId: $('pcoAppId').value.trim(), secret: $('pcoSecret').value.trim(), enabled: $('pcoEnabled').checked };
}

function renderPcoPositionsEditable(positions) {
  const container = $('pcoPositionsList');
  if (positions.length === 0) {
    container.textContent = 'No Team Positions found for this Service Type.';
    return;
  }
  container.innerHTML = '';
  for (const pos of positions) {
    const row = document.createElement('div');
    row.className = 'pco-position-row';
    const hidden = pcoGreenRoomHidden.some((p) => p.toLowerCase() === pos.name.toLowerCase());
    row.innerHTML = `
      <span class="pco-position-name">${escHtml(pos.name)}</span>
      <select aria-label="Aux mix for ${escHtml(pos.name)}" data-pco-position="${escHtml(pos.name)}">${pcoAuxOptionsHtml(pcoPositionMapping[pos.name])}</select>
      <label class="pco-hide-toggle"><input type="checkbox" data-pco-hide="${escHtml(pos.name)}"${hidden ? ' checked' : ''} /> Hide from Green Room</label>
    `;
    container.appendChild(row);
  }
  container.querySelectorAll('select[data-pco-position]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const pos = sel.dataset.pcoPosition;
      if (sel.value) pcoPositionMapping[pos] = Number(sel.value);
      else delete pcoPositionMapping[pos];
      renderPcoAltPositions();
    });
  });
  container.querySelectorAll('input[data-pco-hide]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const pos = cb.dataset.pcoHide;
      pcoGreenRoomHidden = pcoGreenRoomHidden.filter((p) => p.toLowerCase() !== pos.toLowerCase());
      if (cb.checked) pcoGreenRoomHidden.push(pos);
      renderPcoAltPositions(); // the second service's list shows the same choice
    });
  });
}

function renderPcoPositionsForSelectedTeam() {
  const teamId = $('pcoTeam').value;
  const filtered = teamId ? pcoAllPositions.filter((p) => p.teamId === teamId) : pcoAllPositions;
  renderPcoPositionsEditable(filtered);
}

$('pcoTeam').addEventListener('change', () => {
  if (pcoAllPositions.length) renderPcoPositionsForSelectedTeam();
});

// Factored out of the button click handlers so the init flow can call the
// exact same logic automatically on window open (see initPcoAutoSelect
// below) — App opens, saved Service Type/Team are already selected, no
// manual Refresh clicks needed.
async function refreshPcoTeams() {
  const serviceTypeId = $('pcoServiceType').value;
  if (!serviceTypeId) { $('pcoTeamStatus').textContent = 'Pick a Service Type first.'; return; }
  pcoTeamsLoaded = false; // the list on screen may belong to another Service Type until this returns
  $('pcoTeamStatus').textContent = 'Loading…';
  const res = await window.jpm.pcoListTeams(serviceTypeId, pcoCredsFromFields());
  if (!res.ok) {
    $('pcoTeamStatus').textContent = `Error: ${res.error}${res.status ? ' (' + res.status + ')' : ''}`;
    return;
  }
  const sel = $('pcoTeam');
  sel.innerHTML = '<option value="">— All Teams —</option>'
    + res.teams.map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
  if (pcoSavedTeamId && res.teams.some((t) => t.id === pcoSavedTeamId)) {
    sel.value = pcoSavedTeamId;
  }
  // Each Home page's Team dropdown shares this same fetch — same team list,
  // independent current selection — rather than more network round trips.
  for (const r of PCO_ROLE_PAGES) {
    const roleSel = $(`pco${r.key}Team`);
    const savedTeam = (pcoSavedRolePicks[r.key] || {}).team;
    roleSel.innerHTML = '<option value="">— Select Team —</option>'
      + res.teams.map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
    if (savedTeam && res.teams.some((t) => t.id === savedTeam)) roleSel.value = savedTeam;
  }
  pcoTeamsLoaded = true;
  $('pcoTeamStatus').textContent = `${res.teams.length} team(s) loaded.`;
  // The FOH role list is filtered by the FOH team set just above; without
  // this it kept its old filter and a save could blank the FOH role.
  if (pcoAllPositions.length) renderAllRolePositionOptions();
}

// Team and position lists (and team picks — team ids belong to one Service
// Type) are dropped on a Service Type change and fetched again. Saving
// without clicking Refresh Teams used to pair the new Service Type with the
// old one's team, and the Green Room then showed nobody.
$('pcoServiceType').addEventListener('change', () => {
  const picks = $('pcoServiceType').value === pcoSavedServiceTypeId
    ? pcoPicksForSavedType : { team: '', roles: blankRolePicks() };
  pcoSavedTeamId = picks.team;
  pcoSavedRolePicks = JSON.parse(JSON.stringify(picks.roles));
  pcoTeamsLoaded = false;
  pcoAllPositions = [];
  $('pcoTeam').innerHTML = '<option value="">— All Teams —</option>';
  for (const r of PCO_ROLE_PAGES) $(`pco${r.key}Team`).innerHTML = '<option value="">— Select Team —</option>';
  renderAllRolePositionOptions();
  renderPcoPositionsFallback();
  refreshPcoTeams();
});

async function refreshPcoServiceTypes() {
  $('pcoServiceTypeStatus').textContent = 'Loading…';
  const res = await window.jpm.pcoListServiceTypes(pcoCredsFromFields());
  if (!res.ok) {
    $('pcoServiceTypeStatus').textContent = `Error: ${res.error}${res.status ? ' (' + res.status + ')' : ''}`;
    return;
  }
  const sel = $('pcoServiceType');
  // A "pick one" placeholder first, so a saved Service Type that no longer
  // exists isn't silently replaced by whichever type happens to be listed first
  sel.innerHTML = res.types.length
    ? '<option value="">— pick a Service Type —</option>'
      + res.types.map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('')
    : '<option value="">— none found —</option>';
  pcoServiceTypesLoaded = true;
  fillPcoAltServiceTypes(res.types);
  if (pcoSavedServiceTypeId && res.types.some((t) => t.id === pcoSavedServiceTypeId)) {
    sel.value = pcoSavedServiceTypeId;
    await refreshPcoTeams(); // saved Service Type is already selected — chain into Teams too
  } else if (pcoSavedServiceTypeId) {
    $('pcoServiceTypeStatus').textContent = `${res.types.length} service type(s) loaded — your saved one wasn't found, pick one.`;
    return;
  }
  $('pcoServiceTypeStatus').textContent = `${res.types.length} service type(s) loaded.`;
}

$('pcoRefreshTeamsBtn').addEventListener('click', refreshPcoTeams);
$('pcoRefreshTypesBtn').addEventListener('click', refreshPcoServiceTypes);

// On window open, if credentials + a saved Service Type already exist,
// auto-populate and re-select everything without waiting for a manual
// Refresh click — matches autoSyncPlanningCenter() in main.js, which
// already applies the saved mapping automatically whenever the console
// backend starts, independent of whether Settings is even open.
async function initPcoAutoSelect() {
  const creds = pcoCredsFromFields();
  if (!creds.appId || !creds.secret || !pcoSavedServiceTypeId) return;
  await refreshPcoServiceTypes();
}

// Factored out so Sync Now can populate the Position mapping table and the
// FOH Engineer Role dropdown too — "Refresh Positions" and "Sync Now" both
// pull from Planning Center, and a user clicking Sync Now reasonably
// expects it to also be the thing that makes these lists show up, not a
// separate button they have to know to click first.
async function refreshPcoPositions() {
  const serviceTypeId = $('pcoServiceType').value;
  if (!serviceTypeId) { $('pcoServiceTypeStatus').textContent = 'Pick a Service Type first.'; return; }
  $('pcoPositionsList').textContent = 'Loading…';
  const res = await window.jpm.pcoListPositions(serviceTypeId, pcoCredsFromFields());
  if (!res.ok) {
    $('pcoPositionsList').textContent = `Error: ${res.error}${res.status ? ' (' + res.status + ')' : ''}${res.body ? ' — ' + res.body.slice(0, 200) : ''}`;
    return;
  }
  pcoAllPositions = res.positions;
  renderPcoPositionsForSelectedTeam();
  renderAllRolePositionOptions();
}

$('pcoRefreshPositionsBtn').addEventListener('click', refreshPcoPositions);

// ── Planning Center: the optional second service ───────────────────────────
// Its own Service Type, Team, mapping and Home page roles, saved as pcoAlt.
// On a day it has a plan and the main service doesn't, it runs instead (see
// src/server/pco-services.js). Same rule as the main dropdowns: until a list
// is loaded from Planning Center, Save & Apply keeps what was saved.
const blankPcoAlt = () => ({ enabled: false, serviceTypeId: '', teamId: '', positionMapping: {}, roles: {} });
let pcoAlt = blankPcoAlt();         // as saved; positionMapping is edited in place
let pcoAltTypesLoaded = false, pcoAltTeamsLoaded = false;
let pcoAltPositions = null;         // the second service's positions, once fetched
const altRoleId = (r) => r.key.toLowerCase(); // 'Foh' → 'foh', as pco-services.js keys them
const altRolePick = (r) => (pcoAlt.roles && pcoAlt.roles[altRoleId(r)]) || { team: '', position: '' };

function updatePcoAltFields() {
  const on = $('pcoAltEnabled').checked;
  $('pcoAltFields').hidden = !on;
  // Opening it the first time loads its lists
  if (on && !pcoAltTypesLoaded && $('pcoEnabled').checked && pcoCredsFromFields().appId && pcoCredsFromFields().secret) refreshPcoAltServiceTypes();
}
$('pcoAltEnabled').addEventListener('change', updatePcoAltFields);

function fillPcoAltServiceTypes(types) {
  const sel = $('pcoAltServiceType');
  sel.innerHTML = '<option value="">— pick a Service Type —</option>'
    + types.map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
  pcoAltTypesLoaded = true;
  if (pcoAlt.serviceTypeId && types.some((t) => t.id === pcoAlt.serviceTypeId)) {
    sel.value = pcoAlt.serviceTypeId;
    if ($('pcoAltEnabled').checked) refreshPcoAltLists();
  } else if (pcoAlt.serviceTypeId) {
    $('pcoAltStatus').textContent = 'The saved second service wasn’t found. Pick one.';
  }
}
async function refreshPcoAltServiceTypes() {
  $('pcoAltStatus').textContent = 'Loading…';
  const res = await window.jpm.pcoListServiceTypes(pcoCredsFromFields());
  if (!res.ok) { $('pcoAltStatus').textContent = `Error: ${res.error}${res.status ? ' (' + res.status + ')' : ''}`; return; }
  $('pcoAltStatus').textContent = '';
  fillPcoAltServiceTypes(res.types);
}

// Teams and positions for the second service, fetched together
async function refreshPcoAltLists() {
  const serviceTypeId = $('pcoAltServiceType').value;
  if (!serviceTypeId) { $('pcoAltStatus').textContent = 'Pick the second service’s Service Type first.'; return; }
  pcoAltTeamsLoaded = false; pcoAltPositions = null;
  $('pcoAltStatus').textContent = 'Loading…';
  const creds = pcoCredsFromFields();
  const [teams, positions] = await Promise.all([window.jpm.pcoListTeams(serviceTypeId, creds), window.jpm.pcoListPositions(serviceTypeId, creds)]);
  if ($('pcoAltServiceType').value !== serviceTypeId) return; // changed while loading
  if (!teams.ok || !positions.ok) {
    const bad = teams.ok ? positions : teams;
    $('pcoAltStatus').textContent = `Error: ${bad.error}${bad.status ? ' (' + bad.status + ')' : ''}`;
    return;
  }
  const teamOptions = (first) => `<option value="">${first}</option>` + teams.teams.map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
  const has = (id) => teams.teams.some((t) => t.id === id);
  $('pcoAltTeam').innerHTML = teamOptions('— All Teams —');
  if (pcoAlt.teamId && has(pcoAlt.teamId)) $('pcoAltTeam').value = pcoAlt.teamId;
  for (const r of PCO_ROLE_PAGES) {
    const sel = $(`pcoAlt${r.key}Team`);
    sel.innerHTML = teamOptions('— Select Team —');
    if (altRolePick(r).team && has(altRolePick(r).team)) sel.value = altRolePick(r).team;
  }
  pcoAltTeamsLoaded = true;
  pcoAltPositions = positions.positions;
  $('pcoAltStatus').textContent = `${teams.teams.length} team(s) and ${positions.positions.length} position(s) loaded.`;
  renderPcoAltPositions();
  for (const r of PCO_ROLE_PAGES) renderPcoAltRoleOptions(r);
}

// The main service's mix for a position of this name, if it has one
function mainAuxFor(position) {
  const key = Object.keys(pcoPositionMapping).find((k) => k.toLowerCase() === position.toLowerCase());
  return key === undefined ? null : pcoPositionMapping[key];
}
function renderPcoAltPositions() {
  const container = $('pcoAltPositionsList');
  if (!pcoAltPositions) return;
  const teamId = $('pcoAltTeam').value;
  const positions = teamId ? pcoAltPositions.filter((p) => p.teamId === teamId) : pcoAltPositions;
  if (!positions.length) { container.textContent = 'No Team Positions found for this Service Type.'; return; }
  container.innerHTML = '';
  for (const pos of positions) {
    const mainAux = mainAuxFor(pos.name);
    const picked = pcoAlt.positionMapping[pos.name];
    // Blank = same as the main service; 0 = not on a mix (only needed when the main one maps it)
    const first = mainAux ? `Same as main service (Aux ${escHtml(mainAux)})` : '— unmapped —';
    const options = pcoAuxOptionsHtml(picked).replace('<option value="">— unmapped —</option>', () =>
      `<option value="">${first}</option>` + (mainAux ? `<option value="0"${picked !== undefined && Number(picked) === 0 ? ' selected' : ''}>Not on a mix</option>` : ''));
    const hidden = pcoGreenRoomHidden.some((p) => p.toLowerCase() === pos.name.toLowerCase());
    const row = document.createElement('div');
    row.className = 'pco-position-row';
    row.innerHTML = `
      <span class="pco-position-name">${escHtml(pos.name)}</span>
      <select aria-label="Aux mix for ${escHtml(pos.name)} on the second service" data-pco-alt-position="${escHtml(pos.name)}">${options}</select>
      <label class="pco-hide-toggle"><input type="checkbox" data-pco-alt-hide="${escHtml(pos.name)}"${hidden ? ' checked' : ''} /> Hide from Green Room</label>`;
    container.appendChild(row);
  }
}
$('pcoAltPositionsList').addEventListener('change', (e) => {
  const pos = e.target.dataset.pcoAltPosition, hide = e.target.dataset.pcoAltHide;
  if (pos !== undefined) {
    if (e.target.value === '') delete pcoAlt.positionMapping[pos];
    else pcoAlt.positionMapping[pos] = Number(e.target.value);
  } else if (hide !== undefined) {
    pcoGreenRoomHidden = pcoGreenRoomHidden.filter((p) => p.toLowerCase() !== hide.toLowerCase());
    if (e.target.checked) pcoGreenRoomHidden.push(hide);
    if (pcoAllPositions.length) renderPcoPositionsForSelectedTeam(); // the main list shows the same choice
  }
});
$('pcoAltTeam').addEventListener('change', renderPcoAltPositions);

function renderPcoAltRoleOptions(r) {
  if (!pcoAltPositions) return;
  const sel = $(`pcoAlt${r.key}Position`);
  const teamId = $(`pcoAlt${r.key}Team`).value;
  const pick = altRolePick(r);
  const filtered = teamId ? pcoAltPositions.filter((p) => p.teamId === teamId) : pcoAltPositions;
  sel.innerHTML = '<option value="">Same as main service</option>'
    + filtered.map((p) => `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`).join('');
  if (pick.position && teamId === pick.team && filtered.some((p) => p.name === pick.position)) sel.value = pick.position;
}
for (const r of PCO_ROLE_PAGES) $(`pcoAlt${r.key}Team`).addEventListener('change', () => renderPcoAltRoleOptions(r));

// Team ids belong to one Service Type: a different one starts its picks over
$('pcoAltServiceType').addEventListener('change', () => {
  pcoAltTeamsLoaded = false; pcoAltPositions = null;
  $('pcoAltTeam').innerHTML = '<option value="">— All Teams —</option>';
  for (const r of PCO_ROLE_PAGES) {
    $(`pcoAlt${r.key}Team`).innerHTML = '<option value="">— Select Team —</option>';
    $(`pcoAlt${r.key}Position`).innerHTML = '<option value="">Same as main service</option>';
  }
  $('pcoAltPositionsList').textContent = 'Loading…';
  refreshPcoAltLists();
});
$('pcoAltRefreshBtn').addEventListener('click', () => (pcoAltTypesLoaded ? refreshPcoAltLists() : refreshPcoAltServiceTypes()));

// What Save & Apply (and Sync Now) use for the second service
function collectPcoAlt() {
  const typeChanged = pcoAltTypesLoaded && ($('pcoAltServiceType').value || '') !== pcoAlt.serviceTypeId;
  const roles = {};
  for (const r of PCO_ROLE_PAGES) {
    const pick = typeChanged ? { team: '', position: '' } : altRolePick(r);
    const team = pcoAltTeamsLoaded ? ($(`pcoAlt${r.key}Team`).value || '') : pick.team;
    const position = pcoAltPositions ? ($(`pcoAlt${r.key}Position`).value || '') : pick.position;
    if (team || position) roles[altRoleId(r)] = { team, position };
  }
  return {
    enabled: $('pcoAltEnabled').checked,
    serviceTypeId: pcoAltTypesLoaded ? ($('pcoAltServiceType').value || '') : pcoAlt.serviceTypeId,
    teamId: pcoAltTeamsLoaded ? ($('pcoAltTeam').value || '') : (typeChanged ? '' : pcoAlt.teamId),
    positionMapping: { ...pcoAlt.positionMapping },
    roles,
  };
}
function loadPcoAlt(saved) {
  const a = saved && typeof saved === 'object' ? saved : {};
  pcoAlt = { ...blankPcoAlt(), ...a,
    positionMapping: a.positionMapping && typeof a.positionMapping === 'object' ? { ...a.positionMapping } : {},
    roles: a.roles && typeof a.roles === 'object' ? JSON.parse(JSON.stringify(a.roles)) : {} };
}

// ── Wireless (Shure receivers, read-only) ──────────────────────────────────
// wirelessReceivers: [{ ip, id }] — the receivers to read; saved with Save & Apply.
// The list shows those plus every receiver JPMixer has seen (remembered by
// shure-wireless.js, so it's there after a restart) or sees now. Each ticked
// receiver's channels can be given a mix (wirelessAux { "id/channel": aux }).
let wirelessReceivers = [];
let wirelessAuxMap = {};
const wirelessForget = new Set(); // remembered receivers to forget on the next save
let wirelessLive = { enabled: false, discovered: [], receivers: [] };
const WIRELESS_IP = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const wirelessWatched = (ip) => wirelessReceivers.some(r => r.ip === ip);
function wirelessMixOptions(selected) {
  const auxCount = parseInt($('auxes').value) || 16;
  let html = '<option value="">No mix</option>';
  for (let i = 1; i <= auxCount; i++) {
    const name = (auxOverrides[String(i)] && auxOverrides[String(i)].label) || auxNames[String(i)] || `AUX ${i}`;
    html += `<option value="${i}"${String(selected) === String(i) ? ' selected' : ''}>${i} — ${escHtml(name)}</option>`;
  }
  return html;
}
function renderWireless() {
  const list = $('wirelessList');
  const on = $('wirelessEnabled').checked;
  const live = new Map((wirelessLive.receivers || []).map(r => [r.ip, r]));
  const found = new Map((wirelessLive.discovered || []).filter(d => !wirelessForget.has(d.id)).map(d => [d.ip, d]));
  const ips = [...new Set([...wirelessReceivers.map(r => r.ip), ...found.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // Its plugin installing or starting (a message only while it isn't running)
  if (on && wirelessLive.enabled && wirelessLive.message && !ips.length) {
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'sub';
    p.textContent = wirelessLive.message;
    list.append(p);
    return;
  }
  if (!ips.length) {
    list.innerHTML = `<p class="sub">${on ? (wirelessLive.enabled ? 'No receivers found yet. They appear while Wireless Workbench is open on this network, or add one by address below.' : 'Save &amp; Apply to start looking for receivers.') : 'Turn on Watch Shure wireless receivers to look for receivers.'}</p>`;
    return;
  }
  // A ticked receiver's hardware id, once JPMixer knows it, so it's followed to a new address
  for (const t of wirelessReceivers) { const d = found.get(t.ip) || live.get(t.ip); if (d && d.id) t.id = d.id; }
  list.innerHTML = '';
  for (const ip of ips) {
    const r = live.get(ip), d = found.get(ip), watch = wirelessWatched(ip);
    const id = (r && r.id) || (d && d.id) || null;
    const model = (r && r.model) || (d && d.model) || 'Shure receiver';
    const names = r ? r.channels.map(c => c.name).filter(Boolean).join(', ') : '';
    let state = d && !d.seenNow ? 'Remembered' : 'Found on the network', cls = '';
    if (watch && !on) state = 'Watching is off';
    else if (watch && !r) state = 'Save & Apply to start reading';
    else if (r && r.status === 'connected') {
      const c = r.channels[0] || {};
      state = c.battBars === null || c.battBars === undefined ? (c.txType ? 'Connected · transmitter on' : 'Connected · transmitter off') : `Connected · battery ${c.battBars}/5${c.runTimeMin != null ? ` · ${c.runTimeMin} min` : ''}`;
      cls = 'ok';
    } else if (r) { state = r.status === 'connecting' ? 'Connecting…' : `Offline${r.error ? ' · ' + r.error : ''}`; cls = 'warn'; }
    const item = document.createElement('div');
    item.className = 'wireless-item';
    const row = document.createElement('label');
    row.className = 'wireless-row';
    row.innerHTML = `<input type="checkbox" data-wireless-ip="${escHtml(ip)}" ${watch ? 'checked' : ''} aria-label="Watch ${escHtml(model)} at ${escHtml(ip)}" />
      <span><span class="wl-title">${escHtml(names || model)}</span><span class="wl-sub">${escHtml(model)} · ${escHtml(ip)}${r && r.firmware ? ' · firmware ' + escHtml(r.firmware) : ''}</span></span>
      <span class="wl-state ${cls}">${escHtml(state)}</span>`;
    item.appendChild(row);
    if (watch) {
      // Which mix each channel belongs to
      const channels = r && r.channels.length ? r.channels : [{ n: 1, name: '', key: `${id || ip}/1` }];
      for (const c of channels) {
        const key = c.key || `${id || ip}/${c.n}`;
        // A mix chosen while only the address was known moves to the hardware id
        const byIp = `${ip}/${c.n}`;
        if (key !== byIp && wirelessAuxMap[byIp] && !wirelessAuxMap[key]) { wirelessAuxMap[key] = wirelessAuxMap[byIp]; delete wirelessAuxMap[byIp]; }
        const mix = document.createElement('div');
        mix.className = 'wireless-mix';
        mix.innerHTML = `<label for="wlMix-${escHtml(key)}">${channels.length > 1 ? `Channel ${c.n}` : 'Mix'}${c.name ? ` · ${escHtml(c.name)}` : ''}</label><select id="wlMix-${escHtml(key)}" data-wireless-key="${escHtml(key)}">${wirelessMixOptions(wirelessAuxMap[key])}</select>`;
        item.appendChild(mix);
      }
    } else if (d && !d.seenNow && id) {
      const forget = document.createElement('button');
      forget.type = 'button'; forget.className = 'settings-text-link wireless-forget'; forget.dataset.wirelessForget = id;
      forget.textContent = 'Forget this receiver';
      item.appendChild(forget);
    }
    list.appendChild(item);
  }
}
$('wirelessList').addEventListener('change', (e) => {
  if (e.target.dataset.wirelessKey) {
    const key = e.target.dataset.wirelessKey;
    if (e.target.value) wirelessAuxMap[key] = Number(e.target.value); else delete wirelessAuxMap[key];
    return;
  }
  const ip = e.target.dataset.wirelessIp;
  if (!ip) return;
  const id = (wirelessLive.discovered || []).find(d => d.ip === ip)?.id || null;
  wirelessReceivers = wirelessReceivers.filter(r => r.ip !== ip);
  if (e.target.checked) wirelessReceivers.push(id ? { ip, id } : { ip });
  renderWireless();
});
$('wirelessList').addEventListener('click', (e) => {
  const id = e.target.dataset && e.target.dataset.wirelessForget;
  if (!id) return;
  wirelessForget.add(id);
  $('wirelessAddStatus').textContent = 'Forgotten. Save & Apply to make it stick; it comes back if it announces itself again.';
  renderWireless();
});
$('wirelessEnabled').addEventListener('change', renderWireless);
$('wirelessAddBtn').addEventListener('click', () => {
  const ip = $('wirelessAddIp').value.trim();
  const status = $('wirelessAddStatus');
  if (!WIRELESS_IP.test(ip)) { status.textContent = 'Enter the receiver’s IP address, like 192.168.1.40. It’s on the receiver’s network menu.'; return; }
  if (!wirelessWatched(ip)) wirelessReceivers.push({ ip });
  $('wirelessAddIp').value = '';
  status.textContent = `Added ${ip}. Save & Apply to start reading it.`;
  renderWireless();
});
async function refreshWirelessStatus() {
  if (!$('tab-wireless').classList.contains('active')) return;
  // Don't redraw under an open mix menu
  if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.wirelessKey) return;
  try { wirelessLive = await window.jpm.getWirelessStatus() || wirelessLive; } catch (_) {}
  renderWireless();
}
setInterval(refreshWirelessStatus, 2000);
document.querySelector('.tab[data-tab="wireless"]').addEventListener('click', () => setTimeout(refreshWirelessStatus)); // once the tab is showing

// ── Companion buttons (Pages tab) ──────────────────────────────────────────
function updateCompanionFields() {
  const on = $('companionEnabled').checked;
  for (const el of $('companionFields').querySelectorAll('input')) el.disabled = !on;
  $('companionFields').classList.toggle('is-off', !on);
}
$('companionEnabled').addEventListener('change', updateCompanionFields);
// Planning Center off: the rest of its tab greyed out (kept, not cleared)
function updatePcoEnabled() {
  const on = $('pcoEnabled').checked;
  for (const el of document.querySelectorAll('#tab-pco .pco-card, #tab-pco .pco-section-nav')) el.classList.toggle('is-off', !on);
  showPcoPluginStatus(); // its row in the Plugins list
}
$('pcoEnabled').addEventListener('change', updatePcoEnabled);
// The live connection, while the Pages tab is showing
async function refreshCompanionStatus() {
  if (!$('tab-companion').classList.contains('active')) return;
  let s;
  try { s = await window.jpm.getCompanionStatus(); } catch (_) { return; }
  if (!s) return;
  const dot = $('companionDot');
  dot.className = 'dot' + (s.state === 'connected' ? ' on' : s.state === 'error' ? ' warn' : '');
  const pending = $('companionEnabled').checked !== !!s.enabled;
  $('companionStatusText').textContent = pending ? 'Save & Apply to ' + ($('companionEnabled').checked ? 'connect.' : 'turn them off.') : s.message;
}
setInterval(refreshCompanionStatus, 3000);
document.querySelector('.tab[data-tab="companion"]').addEventListener('click', () => setTimeout(refreshCompanionStatus)); // once the tab is showing
$('companionEnabled').addEventListener('change', refreshCompanionStatus);

// ── Smaart SPL (Pages tab) ─────────────────────────────────────────────────
// The two readings list Smaart's own metric names once it's connected; until
// then, the common ones. A saved name Smaart doesn't list stays selectable.
const SMAART_COMMON = ['LAeq 10', 'LAeq 1', 'SPL A Slow', 'SPL A Fast', 'SPL C Slow', 'LCeq 10', 'Peak C'];
let smaartMetrics = [];
function fillSmaartSelect(select, saved, automatic) {
  const allowNone = select.id === 'smaartLiveMetric'; // the small reading can be turned off
  const names = [...new Set([...(smaartMetrics.length ? smaartMetrics : SMAART_COMMON), ...(saved && saved !== 'none' ? [saved] : [])])];
  const want = select.dataset.loaded ? select.value : (saved || '');
  select.textContent = '';
  const auto = new Option(`Automatic (${automatic})`, '');
  select.add(auto);
  if (allowNone) select.add(new Option('None', 'none'));
  for (const name of names) select.add(new Option(name, name));
  select.value = names.includes(want) || (allowNone && want === 'none') ? want : '';
  select.dataset.loaded = '1';
}
// The Green Room's own reading and input (Pages → Green Room)
let smaartInputs = [];
function fillGreenRoomInput(saved) {
  const select = $('greenRoomSplInput');
  const want = select.dataset.loaded ? select.value : (saved || '');
  const list = [...smaartInputs];
  if (want && !list.some((i) => i.key === want)) list.push({ key: want, name: want.split('/').slice(1).join('/') || want });
  select.textContent = '';
  select.add(new Option('Automatic (first input on FOH Home)', ''));
  for (const i of list) select.add(new Option(i.name, i.key));
  select.value = want;
  select.dataset.loaded = '1';
}
function updateGreenRoomSplFields() {
  const on = $('greenRoomSpl').checked;
  for (const el of $('greenRoomSplFields').querySelectorAll('select')) el.disabled = !on;
  $('greenRoomSplFields').classList.toggle('is-off', !on);
  $('greenRoomSplFields').hidden = !on;
}
$('greenRoomSpl').addEventListener('change', updateGreenRoomSplFields);

function loadSmaart(cfg) {
  $('smaartEnabled').checked = cfg.smaartEnabled === true;
  $('greenRoomSpl').checked = cfg.greenRoomSpl === true;
  for (const id of ['greenRoomSplMetric', 'greenRoomSplInput']) delete $(id).dataset.loaded;
  fillSmaartSelect($('greenRoomSplMetric'), cfg.greenRoomSplMetric || '', 'LAeq 10');
  fillGreenRoomInput(cfg.greenRoomSplInput || '');
  updateGreenRoomSplFields();
  for (const id of ['smaartMetric', 'smaartLiveMetric']) { delete $(id).dataset.loaded; delete $(id).dataset.touched; }
  fillSmaartSelect($('smaartMetric'), cfg.smaartMetric || '', 'LAeq 10');
  fillSmaartSelect($('smaartLiveMetric'), cfg.smaartLiveMetric || '', 'SPL A Slow');
  updateSmaartFields();
}
function updateSmaartFields() {
  const on = $('smaartEnabled').checked;
  for (const el of $('smaartFields').querySelectorAll('input, select')) el.disabled = !on;
  $('smaartFields').classList.toggle('is-off', !on);
}
$('smaartEnabled').addEventListener('change', updateSmaartFields);
// FOH Home's SPL card can change the readings too (its options button); a
// save here only replaces them if they were changed here
for (const id of ['smaartMetric', 'smaartLiveMetric']) $(id).addEventListener('change', () => { $(id).dataset.touched = '1'; });
async function refreshSmaartStatus() {
  // The Smaart tab, and Pages for the Green Room's reading
  if (!$('tab-smaart').classList.contains('active') && !$('tab-views').classList.contains('active')) return;
  let s;
  try { s = await window.jpm.getSmaartStatus(); } catch (_) { return; }
  if (!s) return;
  $('smaartDot').className = 'dot' + (s.state === 'connected' && s.inputs ? ' on' : s.state === 'error' || (s.state === 'connected' && !s.inputs) ? ' warn' : '');
  const pending = $('smaartEnabled').checked !== !!s.enabled;
  $('smaartStatusText').textContent = pending ? 'Save & Apply to ' + ($('smaartEnabled').checked ? 'connect.' : 'turn it off.') : s.message;
  if (Array.isArray(s.metrics) && s.metrics.length && s.metrics.join('|') !== smaartMetrics.join('|')) {
    smaartMetrics = s.metrics;
    fillSmaartSelect($('smaartMetric'), $('smaartMetric').value, 'LAeq 10');
    fillSmaartSelect($('smaartLiveMetric'), $('smaartLiveMetric').value, 'SPL A Slow');
    fillSmaartSelect($('greenRoomSplMetric'), $('greenRoomSplMetric').value, 'LAeq 10');
  }
  const list = Array.isArray(s.inputList) ? s.inputList : [];
  if (list.map((i) => i.key).join('|') !== smaartInputs.map((i) => i.key).join('|')) { smaartInputs = list; fillGreenRoomInput($('greenRoomSplInput').value); }
  $('greenRoomSplHint').textContent = 'A live sound level beside the clock, in Smaart’s colors, marked when it’s over Smaart’s alarm level. '
    + (s.enabled ? (s.state === 'connected' ? 'Smaart is connected.' : 'Smaart SPL is on but not connected yet; see Plugins → Smaart SPL.') : 'Needs the Smaart SPL plugin, set up under Plugins.');
}
setInterval(refreshSmaartStatus, 3000);
document.querySelector('.tab[data-tab="views"]').addEventListener('click', () => setTimeout(refreshSmaartStatus));
document.querySelector('.tab[data-tab="smaart"]').addEventListener('click', () => setTimeout(refreshSmaartStatus)); // once the tab is showing
$('smaartEnabled').addEventListener('change', refreshSmaartStatus);

// ── Plugins ────────────────────────────────────────────────────────────────
// Each plugin in JPMixer's plugins folder (src/server/plugins.js) gets its
// own tab under Plugins, like Smaart and Shure: on/off, what it can do,
// the settings its plugin.json asks for (every plugin has at least one), its
// status and log. The Plugins tab lists them, and adds, updates and finds
// them. Turning one on asks first, since it's someone else's code; like the
// rest of Settings, on/off and settings take effect with Save & Apply. Add,
// Remove and Reload act straight away.
let pluginList = [];
let pluginsAllowed = false;
// Plugins has a section of its own: Allow plugins, and adding
// and removing them. Each plugin's own tab, listed under it, shows once
// plugins are allowed and saved.
function showPluginsTab(on) {
  pluginsAllowed = !!on;
  const tabs = [...document.querySelectorAll('.tab[data-plugin-tab]')].filter((tab) => !tab.dataset.official);
  for (const tab of tabs) tab.hidden = !on;
  if (!on && tabs.some((tab) => tab.classList.contains('active'))) document.querySelector('.tab[data-tab="plugins"]').click();
  showPluginsAllowed();
}
// The switch's note, and the rest of the menu greyed out while plugins aren't allowed
function showPluginsAllowed() {
  const want = $('pluginsEnabled').checked;
  const note = want === pluginsAllowed ? (pluginsAllowed ? '' : 'Turn this on, then Save & Apply, to add plugins.')
    : `Save & Apply to ${want ? 'allow plugins' : 'turn every plugin off'}.`;
  $('pluginsAllowNote').textContent = note;
  // JPMixer's own plugins work either way: Find plugins stays usable for
  // them, and their rows aren't greyed out; adding anyone else's needs it
  $('pluginsIntro').classList.toggle('is-off', !pluginsAllowed);
  for (const row of document.querySelectorAll('#pluginList .plugin-row')) row.classList.toggle('is-off', !pluginsAllowed && row.dataset.official !== '1');
  if (pluginsAllowed !== lastCatalogAllowed && catalogLoaded) loadCatalog(true); // its Install buttons follow
}
let lastCatalogAllowed = null;
$('pluginsEnabled').addEventListener('change', showPluginsAllowed);
const pluginTabId = (id) => `plugin-${id}`;
function openPluginTab(id) { document.querySelector(`.tab[data-plugin-tab="${CSS.escape(id)}"]`)?.click(); }
function pluginMessage(text, isError = false) {
  $('pluginsMessage').textContent = text || '';
  $('pluginsMessage').classList.toggle('is-error', !!isError);
}
function pluginField(plugin, f) {
  const value = plugin.settings[f.key];
  const id = `plugin-${plugin.id}-${f.key}`;
  const row = document.createElement('div');
  row.className = 'field-row';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = f.label;
  let input;
  if (f.type === 'select') {
    input = document.createElement('select');
    for (const o of f.options) input.add(new Option(o.label, o.value));
    input.value = value;
  } else {
    input = document.createElement('input');
    input.type = f.type === 'checkbox' ? 'checkbox' : f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text';
    if (f.type === 'checkbox') { input.className = 'toggle'; input.checked = value === true; }
    else {
      input.value = value === null || value === undefined ? '' : String(value);
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.type === 'number') { if (f.min !== null) input.min = f.min; if (f.max !== null) input.max = f.max; }
    }
  }
  input.id = id;
  input.dataset.key = f.key;
  input.dataset.type = f.type;
  if (f.type === 'checkbox') {
    const line = document.createElement('div');
    line.className = 'plugin-field-check';
    line.append(label, input);
    row.append(line);
  } else row.append(label, input);
  if (f.help) {
    const help = document.createElement('p');
    help.className = 'plugin-field-help';
    help.textContent = f.help;
    row.append(help);
  }
  return row;
}
function stateLine(p) {
  const level = p.status ? p.status.level : 'ok';
  const text = {
    off: 'Off',
    starting: 'Starting…',
    running: (p.status && p.status.text) || 'Running',
    restarting: (p.status && p.status.text) || 'Starting again…',
    crashed: (p.status && p.status.text) || 'Stopped',
  }[p.state] || '';
  const dot = 'dot' + (p.state === 'running' ? (level === 'ok' ? ' on' : level === 'warn' ? ' warn' : ' error') : p.state === 'crashed' || p.state === 'restarting' ? ' error' : '');
  return { dot, text };
}
function statusBox() {
  const status = document.createElement('div');
  status.className = 'companion-status';
  status.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'dot';
  status.append(dot, document.createElement('span'));
  return status;
}
// Where it came from: the approved list, or imported (not reviewed)
const PLUGIN_SOURCE = { catalog: ['Approved', 'is-approved', 'Installed from JPMixer’s list of approved plugins'], file: ['Not reviewed', 'is-unreviewed', 'Imported from a file or folder: not on JPMixer’s list of approved plugins'],
  official: ['JPMixer Original', 'is-original', 'One of JPMixer’s own plugins: it runs without Allow plugins'] };
// Shure, Smaart and Companion are set up in their own tabs, as before (their
// settings are JPMixer's): each tab is under Plugins once its plugin is
// installed, and its row here opens it
const INTEGRATION_TABS = { shure: 'wireless', smaart: 'smaart', companion: 'companion' };
// Removing one also turns it off (main.js): its switch here follows
const INTEGRATION_SWITCHES = { smaartEnabled: 1, wirelessEnabled: 1, companionEnabled: 1 };
function pluginTitle(p) {
  const h2 = document.createElement('h2');
  h2.className = 'plugin-title';
  h2.textContent = p.manifest ? p.manifest.name : p.id;
  if (p.manifest && p.manifest.version) {
    const v = document.createElement('span');
    v.className = 'plugin-version';
    v.textContent = p.manifest.version;
    h2.append(v);
  }
  const [label, cls, title] = p.official ? PLUGIN_SOURCE.official : PLUGIN_SOURCE[p.source] || PLUGIN_SOURCE.file;
  if (p.manifest) {
    const badge = document.createElement('span');
    badge.className = 'plugin-badge ' + cls;
    badge.textContent = label;
    badge.title = title;
    h2.append(badge);
  }
  return h2;
}
// The Plugins tab: one row per plugin, with the way to its own tab
// Planning Center is built into JPMixer, not installed: its row has no
// Remove, and its switch is in its own tab
function pcoPluginRow() {
  const row = document.createElement('section');
  row.className = 'card companion-card plugin-row';
  const head = document.createElement('div');
  head.className = 'card-row space-between';
  const heading = document.createElement('div');
  heading.className = 'settings-heading';
  const h2 = document.createElement('h2');
  h2.className = 'plugin-title';
  h2.textContent = 'Planning Center';
  const [label, cls] = PLUGIN_SOURCE.official;
  const badge = document.createElement('span');
  badge.className = 'plugin-badge ' + cls;
  badge.textContent = label;
  badge.title = 'Built into JPMixer: turn it on or off in its tab';
  h2.append(badge);
  const d = document.createElement('p');
  d.className = 'sub';
  d.textContent = 'Built into JPMixer. The team, positions, schedule and order of service from Planning Center Services.';
  heading.append(h2, d);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-sm';
  open.textContent = 'Settings';
  open.addEventListener('click', () => document.querySelector('.tab[data-tab="pco"]').click());
  const actions = document.createElement('div');
  actions.className = 'plugin-row-actions';
  actions.append(open);
  head.append(heading, actions);
  const status = statusBox();
  status.id = 'pcoPluginStatus';
  row.append(head, status);
  return row;
}
function showPcoPluginStatus() {
  const box = $('pcoPluginStatus');
  if (!box) return;
  const on = $('pcoEnabled').checked;
  box.querySelector('.dot').className = on ? 'dot on' : 'dot';
  box.querySelector('span:last-child').textContent = on ? 'On' : 'Off';
}
function renderPluginList() {
  const list = $('pluginList');
  list.textContent = '';
  list.append(pcoPluginRow());
  showPcoPluginStatus();
  if (!pluginList.length) {
    pluginMessage('No plugins yet. Add one, or put its folder in the plugins folder and select Reload plugins.');
    return;
  }
  for (const p of pluginList) {
    const row = document.createElement('section');
    row.className = 'card companion-card plugin-row';
    row.dataset.pluginRow = p.folder; // by folder: a broken copy can share a working plugin's id
    row.dataset.official = p.official ? '1' : '';
    row.classList.toggle('is-off', !pluginsAllowed && !p.official);
    const head = document.createElement('div');
    head.className = 'card-row space-between';
    const heading = document.createElement('div');
    heading.className = 'settings-heading';
    heading.append(pluginTitle(p));
    head.append(heading);
    if (!p.manifest) {
      row.classList.add('plugin-invalid');
      const err = document.createElement('p');
      err.className = 'plugin-error';
      err.textContent = `This plugin can’t load: ${p.error}`;
      heading.append(err);
      head.append(pluginRemoveButton(p));
      row.append(head);
      list.append(row);
      continue;
    }
    if (p.manifest.description) { const d = document.createElement('p'); d.className = 'sub'; d.textContent = p.manifest.description; heading.append(d); }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm';
    open.textContent = 'Settings';
    const ownTab = p.integration && INTEGRATION_TABS[p.id];
    open.addEventListener('click', () => (ownTab ? document.querySelector(`.tab[data-tab="${ownTab}"]`)?.click() : openPluginTab(p.id)));
    const actions = document.createElement('div');
    actions.className = 'plugin-row-actions';
    const update = pluginUpdateButton(p);
    if (update) actions.append(update);
    actions.append(open, pluginRemoveButton(p));
    head.append(actions);
    row.append(head, statusBox());
    list.append(row);
    showPluginRowStatus(row, p);
  }
}
function showPluginRowStatus(row, p) {
  const { dot, text } = stateLine(p);
  row.querySelector('.companion-status .dot').className = dot;
  row.querySelector('.companion-status span:last-child').textContent = text;
}
// Each plugin's own tab, under Plugins
function renderPluginTabs() {
  const activeTab = document.querySelector('.tab.active');
  const wasPlugin = activeTab && activeTab.dataset.pluginTab;
  // Changes not saved yet (switched on or off, settings typed) are kept
  // through the redraw: installing or removing another plugin redraws them all
  const unsaved = collectPluginChanges({ unsavedOnly: true });
  for (const el of document.querySelectorAll('.tab[data-plugin-tab], .tab-panel[data-plugin-panel]')) el.remove();
  // JPMixer's own (their tabs are in the page, after Planning Center's): shown while installed
  let tabAfter = document.querySelector('.tab[data-tab="pco"]');
  let integrationGone = false;
  for (const tab of document.querySelectorAll('.tab[data-integration-tab]')) {
    const installed = pluginList.find((p) => p.manifest && p.id === tab.dataset.integrationTab);
    tab.hidden = !installed;
    if (tab.hidden && tab.classList.contains('active')) integrationGone = true;
    if (!tab.hidden) tabAfter = tab;
    // At the bottom of its tab: the plugin it is, and Remove
    const panel = $('tab-' + tab.dataset.tab);
    panel.querySelector('.integration-plugin-card')?.remove();
    if (installed) panel.append(integrationPluginCard(installed));
  }
  let after = $('tab-plugins');
  for (const p of pluginList) {
    if (!p.manifest || p.integration) continue; // set up in its own tab (INTEGRATION_TABS)
    const m = p.manifest;
    const tab = document.createElement('button');
    tab.className = 'tab plugin-subtab';
    tab.dataset.tab = pluginTabId(p.id);
    tab.dataset.pluginTab = p.id;
    tab.dataset.title = m.name;
    tab.dataset.description = m.description || 'A plugin’s settings.';
    tab.dataset.official = p.official ? '1' : '';
    tab.hidden = !pluginsAllowed && !p.official; // official ones run without Allow plugins
    const symbol = document.createElement('span');
    symbol.className = 'nav-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = '◇';
    tab.append(symbol, document.createTextNode(m.name));
    tabAfter.after(tab);
    tabAfter = tab;
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = 'tab-' + pluginTabId(p.id);
    panel.dataset.pluginPanel = p.id;
    panel.append(pluginCard(p, unsaved[p.id]));
    after.after(panel);
    after = panel;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
      tab.classList.add('active');
      panel.classList.add('active');
      window.jpmShowTabTitle?.(tab);
      updateRestoreSelection();
      refreshPluginStatus();
    });
  }
  // Back where it was, or to the list if that plugin has gone
  if (integrationGone) document.querySelector('.tab[data-tab="plugins"]').click();
  else if (wasPlugin) {
    if (document.querySelector(`.tab[data-plugin-tab="${CSS.escape(wasPlugin)}"]`)) openPluginTab(wasPlugin);
    else document.querySelector('.tab[data-tab="plugins"]').click();
  }
}
function integrationPluginCard(p) {
  const card = document.createElement('section');
  card.className = 'card companion-card integration-plugin-card';
  const head = document.createElement('div');
  head.className = 'card-row space-between';
  const heading = document.createElement('div');
  heading.className = 'settings-heading';
  const d = document.createElement('p');
  d.className = 'sub';
  d.textContent = 'This is a plugin. Removing it turns it off; its settings here are kept, for if you install it again from Find plugins.';
  heading.append(pluginTitle(p), d);
  const status = document.createElement('p');
  status.className = 'sub plugin-message';
  status.setAttribute('role', 'status');
  head.append(heading, pluginRemoveButton(p, status));
  card.append(head, status);
  return card;
}
function renderPlugins() {
  renderPluginList();
  renderPluginTabs();
}
// One plugin's settings: what its tab shows. `unsaved`: changes made here
// before a redraw, put back.
function pluginCard(p, unsaved) {
  const card = document.createElement('section');
  card.className = 'card companion-card plugin-card';
  card.dataset.plugin = p.id;
  const head = document.createElement('div');
  head.className = 'card-row space-between';
  const heading = document.createElement('div');
  heading.className = 'settings-heading';
  heading.append(pluginTitle(p));
  const m = p.manifest;
  if (m.description) { const d = document.createElement('p'); d.className = 'sub'; d.textContent = m.description; heading.append(d); }
  if (m.author || m.homepage) {
    const meta = document.createElement('p');
    meta.className = 'sub plugin-meta';
    if (m.author) meta.append(document.createTextNode(`By ${m.author}`));
    if (m.homepage) {
      const link = document.createElement('button');
      link.type = 'button'; link.className = 'btn btn-sm'; link.textContent = 'Website';
      link.addEventListener('click', () => window.jpm.pluginsOpenHomepage(p.id));
      meta.append(link);
    }
    heading.append(meta);
  }
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'toggle';
  toggle.checked = unsaved ? unsaved.enabled : p.enabled;
  toggle.dataset.saved = String(p.enabled);
  toggle.setAttribute('aria-label', `Turn on ${m.name}`);
  head.append(heading, toggle);
  card.append(head);

  const permsLabel = document.createElement('p');
  permsLabel.className = 'plugin-perms-label';
  permsLabel.textContent = p.permissions.length ? 'IT CAN' : 'IT DOESN’T ASK FOR ANYTHING FROM JPMIXER';
  card.append(permsLabel);
  if (p.permissions.length) {
    const perms = document.createElement('ul');
    perms.className = 'plugin-perms';
    for (const perm of p.permissions) { const li = document.createElement('li'); li.textContent = perm.text; perms.append(li); }
    card.append(perms);
  }

  const fields = document.createElement('div');
  fields.className = 'plugin-fields';
  const shownSettings = unsaved ? { ...p.settings, ...unsaved.settings } : p.settings;
  for (const f of m.settings) fields.append(pluginField({ ...p, settings: shownSettings }, f));
  // For whoever is writing it: saving its files starts it again
  const watchRow = document.createElement('label');
  watchRow.className = 'plugin-watch';
  const watchText = document.createElement('span');
  watchText.textContent = 'Restart when its files change (for people making plugins)';
  const watch = document.createElement('input');
  watch.type = 'checkbox';
  watch.className = 'toggle plugin-watch-toggle';
  watch.checked = unsaved ? unsaved.watch : p.watch === true;
  if (unsaved && unsaved.edited) card.dataset.edited = '1';
  watchRow.append(watchText, watch);
  watch.addEventListener('change', () => { card.dataset.edited = '1'; showPluginStatus(card, p); });
  card.append(fields, watchRow, statusBox());

  const actions = document.createElement('div');
  actions.className = 'card-row plugin-actions';
  const log = document.createElement('details');
  log.className = 'settings-help';
  const summary = document.createElement('summary');
  summary.textContent = 'Log';
  const lines = document.createElement('div');
  lines.className = 'plugin-log-lines';
  log.append(summary, lines);
  log.addEventListener('toggle', () => { if (log.open) refreshPluginLog(p.id, lines); });
  actions.append(log);
  // A plugin with a page of its own: open it (it's also on the Home pages list)
  if (m.page) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm';
    open.textContent = `Open ${m.page.title}`;
    open.title = 'Opens its page in the browser. It’s also listed with the Home pages.';
    open.addEventListener('click', async () => {
      const result = await window.jpm.pluginsOpenPage(p.id).catch((e) => ({ ok: false, error: e.message }));
      if (!result.ok) { const t = card.querySelector('.companion-status span:last-child'); if (t) t.textContent = result.error; }
    });
    actions.append(open);
  }
  actions.append(pluginRemoveButton(p));
  card.append(actions);

  const updateFields = () => {
    fields.classList.toggle('is-off', !toggle.checked);
    for (const el of fields.querySelectorAll('input, select')) el.disabled = !toggle.checked;
  };
  toggle.addEventListener('change', async () => {
    if (toggle.checked && toggle.dataset.saved !== 'true') {
      toggle.disabled = true;
      const { ok } = await window.jpm.pluginsConfirmEnable(p.id).catch(() => ({ ok: false }));
      toggle.disabled = false;
      if (!ok) toggle.checked = false;
    }
    updateFields();
    showPluginStatus(card, p);
  });
  fields.addEventListener('input', () => { card.dataset.edited = '1'; showPluginStatus(card, p); });
  updateFields();
  showPluginStatus(card, p);
  return card;
}
// Remove…, wherever a plugin is shown (its row, its tab, Find plugins).
// `statusEl`: where to say what happened (the Your plugins message if not given)
function pluginRemoveButton(p, statusEl = null) {
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-sm';
  remove.textContent = 'Remove…';
  remove.addEventListener('click', async () => {
    const result = await window.jpm.pluginsRemove(p.folder).catch((e) => ({ ok: false, error: e.message }));
    if (result.canceled) return;
    if (result.turnedOff && Object.hasOwn(INTEGRATION_SWITCHES, result.turnedOff) && $(result.turnedOff).checked) {
      $(result.turnedOff).checked = false;
      $(result.turnedOff).dispatchEvent(new Event('change'));
    }
    await loadPlugins();
    loadCatalog(false); // Find plugins offers it again
    const text = result.ok ? `Removed ${p.manifest ? p.manifest.name : p.id}.` : result.error;
    if (statusEl) { statusEl.textContent = text; statusEl.classList.toggle('is-error', !result.ok); } else pluginMessage(text, !result.ok);
  });
  return remove;
}
function showPluginStatus(card, p) {
  const toggle = card.querySelector('.card-row > .toggle');
  const dot = card.querySelector('.companion-status .dot');
  const text = card.querySelector('.companion-status span:last-child');
  if (!toggle || !dot || !text) return;
  if (toggle.checked !== p.enabled) { dot.className = 'dot'; text.textContent = `Save & Apply to turn it ${toggle.checked ? 'on' : 'off'}.`; return; }
  if (card.dataset.edited && p.enabled) { dot.className = 'dot'; text.textContent = 'Save & Apply to use the new settings (it starts again).'; return; }
  const line = stateLine(p);
  dot.className = line.dot;
  text.textContent = line.text;
}
async function refreshPluginLog(id, box) {
  const lines = await window.jpm.pluginsLog(id).catch(() => []);
  const key = lines.length ? `${lines.length}:${lines[lines.length - 1].at}:${lines[0].at}` : '0';
  if (box.dataset.key === key) return; // nothing new: leave it where it's scrolled to
  box.dataset.key = key;
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  box.textContent = '';
  if (!lines.length) { box.textContent = 'Nothing logged yet. A plugin’s console.log() lines show here while it runs.'; return; }
  for (const l of lines) {
    const line = document.createElement('div');
    if (l.level === 'error') line.className = 'is-error';
    line.textContent = `${new Date(l.at).toLocaleTimeString()}  ${l.text}`;
    box.append(line);
  }
  if (atBottom) box.scrollTop = box.scrollHeight; // following along; not if scrolled up to read
}
async function loadPlugins() {
  let result;
  try { result = await window.jpm.pluginsList(); } catch (_) { return; }
  pluginList = result.plugins || [];
  pluginMessage('');
  renderPlugins();
  loadPluginUpdates();
}
// Installed plugins with an update on the approved list (main.js looks now
// and then): a dot next to Plugins in the sidebar, and Update on each one's row
let pluginUpdates = new Map(); // id -> { version, installedVersion }
async function loadPluginUpdates() {
  let list;
  try { list = await window.jpm.pluginsUpdates(); } catch (_) { return; }
  const next = new Map((list || []).map((u) => [u.id, u]));
  const same = next.size === pluginUpdates.size && [...next].every(([id, u]) => pluginUpdates.get(id)?.version === u.version);
  pluginUpdates = next;
  const tab = document.querySelector('.tab[data-tab="plugins"]');
  tab.classList.toggle('has-update', next.size > 0);
  tab.title = next.size ? `${next.size === 1 ? 'A plugin has an update' : `${next.size} plugins have updates`}: ${[...next.values()].map((u) => u.name).join(', ')}` : '';
  if (!same) renderPluginList();
}
window.jpm.onPluginsUpdates(() => loadPluginUpdates());
function pluginUpdateButton(p) {
  const u = pluginUpdates.get(p.id);
  if (!u) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm plugin-update-btn';
  button.textContent = `Update to ${u.version}`;
  button.title = `You have ${u.installedVersion}`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Downloading…';
    const result = await window.jpm.pluginsInstallCatalog(p.id).catch((e) => ({ ok: false, error: e.message }));
    button.disabled = false;
    button.textContent = `Update to ${u.version}`;
    afterInstall(result);
  });
  return button;
}
// While the Plugins tab or a plugin's tab is showing: each plugin's state,
// without redrawing what's being edited
async function refreshPluginStatus() {
  const showing = $('tab-plugins').classList.contains('active') || !!document.querySelector('.tab-panel.active[data-plugin-panel]');
  if (!pluginsAllowed || !showing) return;
  let result;
  try { result = await window.jpm.pluginsList(); } catch (_) { return; }
  const fresh = result.plugins || [];
  const shape = (list) => list.map((p) => p.id + (p.manifest ? p.manifest.version : '!')).join('|');
  if (shape(fresh) !== shape(pluginList)) {
    if (!document.querySelector('[data-plugin-panel] [data-edited]')) { pluginList = fresh; renderPlugins(); }
    return;
  }
  pluginList = fresh;
  for (const p of fresh) {
    const row = document.querySelector(`#pluginList [data-plugin-row="${CSS.escape(p.folder)}"]`);
    if (row && p.manifest) showPluginRowStatus(row, p);
    const card = document.querySelector(`[data-plugin-panel] [data-plugin="${CSS.escape(p.id)}"]`);
    if (card) showPluginStatus(card, p);
    const log = card && card.querySelector('details.settings-help[open] .plugin-log-lines');
    if (log) refreshPluginLog(p.id, log);
  }
}
// { id: { enabled, settings, watch } } for Save & Apply; with unsavedOnly,
// only the plugins changed here since they were drawn
function collectPluginChanges({ unsavedOnly = false } = {}) {
  const out = {};
  for (const card of document.querySelectorAll('[data-plugin-panel] [data-plugin]')) {
    const toggle = card.querySelector('.card-row > .toggle');
    if (!toggle) continue;
    const edited = !!card.dataset.edited;
    if (unsavedOnly && !edited && String(toggle.checked) === toggle.dataset.saved) continue;
    const settings = {};
    for (const el of card.querySelectorAll('.plugin-fields [data-key]')) {
      settings[el.dataset.key] = el.dataset.type === 'checkbox' ? el.checked : el.value;
    }
    const watch = card.querySelector('.plugin-watch-toggle');
    out[card.dataset.plugin] = { enabled: toggle.checked, settings, watch: !!(watch && watch.checked), edited };
  }
  return out;
}
setInterval(refreshPluginStatus, 3000);
document.querySelector('.tab[data-tab="plugins"]').addEventListener('click', () => setTimeout(refreshPluginStatus)); // once the panel is showing
$('pluginFolderBtn').addEventListener('click', () => window.jpm.pluginsOpenFolder());
$('pluginGuideBtn').addEventListener('click', () => window.jpm.pluginsOpenGuide());
$('pluginReloadBtn').addEventListener('click', async () => {
  $('pluginReloadBtn').disabled = true;
  await window.jpm.pluginsReload().catch(() => {});
  $('pluginReloadBtn').disabled = false;
  await loadPlugins();
  pluginMessage('Reloaded. Plugins that are on started again.');
});
// After any install: what to say. main.js shows the plugin and asks first.
async function afterInstall(result, statusEl = $('pluginsMessage')) {
  if (result.canceled) return;
  await loadPlugins();
  loadCatalog(false);
  const say = (text, isError) => { statusEl.textContent = text; statusEl.classList.toggle('is-error', !!isError); };
  if (!result.ok) { if (result.error) say(`Couldn’t install that plugin. ${result.error}`, true); return; }
  say(result.replaced ? `Updated ${result.manifest.name}.` : `Installed ${result.manifest.name}. Open it under Plugins in the sidebar, turn it on there, then Save & Apply.`);
}
$('pluginImportBtn').addEventListener('click', async () => afterInstall(await window.jpm.pluginsImport('file').catch((e) => ({ ok: false, error: e.message }))));
$('pluginImportFolderBtn').addEventListener('click', async () => afterInstall(await window.jpm.pluginsImport('folder').catch((e) => ({ ok: false, error: e.message }))));
// A .jpmplugin, .zip or plugin folder dropped anywhere on the Plugins page
{
  const page = $('tab-plugins');
  const files = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  // The panel is display: contents, so the drop is caught on main while it's showing
  const main = document.querySelector('main');
  const showing = () => page.classList.contains('active') && pluginsAllowed;
  main.addEventListener('dragover', (e) => { if (!showing() || !files(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; page.classList.add('is-dropping'); });
  main.addEventListener('dragleave', (e) => { if (!main.contains(e.relatedTarget)) page.classList.remove('is-dropping'); });
  main.addEventListener('drop', async (e) => {
    page.classList.remove('is-dropping');
    if (!showing() || !files(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const where = file && window.jpm.pathForFile(file);
    if (!where) { pluginMessage('Couldn’t read that file. Use Import plugin… instead.', true); return; }
    afterInstall(await window.jpm.pluginsImportPath(where).catch((err) => ({ ok: false, error: err.message })));
  });
  // Dropped anywhere else in Settings: don't let the window open the file
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
$('pluginSubmitBtn').addEventListener('click', () => window.jpm.pluginsOpenSubmit());
window.jpm.onPluginsChanged(() => { loadPlugins(); loadCatalog(false); });
// A .jpmplugin opened from Finder or Explorer: what happened
window.jpm.onPluginsResult?.((result) => afterInstall(result));
window.jpm.onPluginsShow(() => document.querySelector('.tab[data-tab="plugins"]').click());

// ── Find plugins: the approved list on GitHub (plugin-store.js) ──
// Shown when the Plugins page is opened (once per window) or Refresh is
// pressed. (main.js also looks now and then, for the update dot.)
let catalogLoaded = false;
async function loadCatalog(force) {
  if (!force && !catalogLoaded) return;
  catalogLoaded = true;
  lastCatalogAllowed = pluginsAllowed;
  const status = $('pluginCatalogStatus');
  if (force) status.textContent = 'Getting the list…';
  status.classList.remove('is-error');
  let result;
  try { result = await window.jpm.pluginsCatalog(); } catch (e) { result = { ok: false, error: e.message }; }
  const box = $('pluginCatalog');
  if (!result.ok) { box.textContent = ''; status.textContent = result.error; status.classList.add('is-error'); return; }
  status.textContent = result.notice || (result.plugins.length ? '' : 'No approved plugins yet.');
  box.replaceChildren(...result.plugins.map((p) => {
    const item = document.createElement('div');
    item.className = 'plugin-catalog-item';
    const info = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.textContent = p.name;
    const v = document.createElement('span'); v.className = 'plugin-version'; v.textContent = p.version; h3.append(v);
    if (p.official) { const [label, cls, title] = PLUGIN_SOURCE.official; const b = document.createElement('span'); b.className = 'plugin-badge ' + cls; b.textContent = label; b.title = title; h3.append(b); }
    info.append(h3);
    if (p.description) { const d = document.createElement('p'); d.className = 'sub'; d.textContent = p.description; info.append(d); }
    if (p.author) { const a = document.createElement('p'); a.className = 'sub'; a.textContent = `By ${p.author}`; info.append(a); }
    if (p.bundled) { const a = document.createElement('p'); a.className = 'sub'; a.textContent = 'Comes with JPMixer, so it installs without the internet.'; info.append(a); }
    const perms = document.createElement('p');
    perms.className = 'plugin-catalog-perms';
    perms.textContent = p.permissions.length ? `It can: ${p.permissions.map((x) => x.text.charAt(0).toLowerCase() + x.text.slice(1)).join('; ')}.` : 'It doesn’t ask for anything from JPMixer.';
    info.append(perms);
    const actions = document.createElement('div');
    actions.className = 'plugin-catalog-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm';
    if (p.tooNew) { button.textContent = 'Install'; button.disabled = true; const n = document.createElement('span'); n.className = 'sub'; n.textContent = `Needs JPMixer ${p.minJPMixer}`; actions.append(button, n); }
    else if (!pluginsAllowed && !p.official && !(p.installedVersion && !p.update)) { button.textContent = 'Install'; button.disabled = true; const n = document.createElement('span'); n.className = 'sub'; n.textContent = 'Allow plugins first'; actions.append(button, n); }
    else if (p.installedVersion && !p.update) {
      const done = document.createElement('span'); done.className = 'plugin-catalog-installed'; done.textContent = `Installed (${p.installedVersion})`; actions.append(done);
      const have = pluginList.find((x) => x.manifest && x.id === p.id);
      if (have) actions.append(pluginRemoveButton(have, $('pluginCatalogStatus')));
    }
    else {
      button.textContent = p.update ? `Update to ${p.version}` : 'Install';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const prev = button.textContent;
        button.textContent = p.bundled ? 'Installing…' : 'Downloading…';
        const result = await window.jpm.pluginsInstallCatalog(p.id).catch((e) => ({ ok: false, error: e.message }));
        button.disabled = false;
        button.textContent = prev;
        afterInstall(result, $('pluginCatalogStatus'));
      });
      actions.append(button);
      if (p.update) { const n = document.createElement('span'); n.className = 'sub'; n.textContent = `You have ${p.installedVersion}`; actions.append(n); }
    }
    item.append(info, actions);
    return item;
  }));
}
$('pluginCatalogRefresh').addEventListener('click', () => loadCatalog(true));
document.querySelector('.tab[data-tab="plugins"]').addEventListener('click', () => { if (!catalogLoaded) loadCatalog(true); });

// ── Performance (System) ────────────────────────────────────────────────────
// How hard JPMixer and this computer are working (src/server/system-stats.js
// and main.js performanceReport), every 2 seconds while the tab is showing.
// Read-only. Copy report puts the same numbers on the clipboard as text.
let perfLast = null;
const perfBytes = (b) => {
  if (!Number.isFinite(b)) return '—';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
};
const perfMB = (mb) => (Number.isFinite(mb) ? perfBytes(mb * 1024 ** 2) : '—');
const perfDuration = (sec) => {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} day${d === 1 ? '' : 's'} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return m ? `${m} min` : `${sec} s`;
};
const PERF_THERMAL = { nominal: 'Normal', fair: 'Warm', serious: 'Hot', critical: 'Very hot', unknown: 'Not reported' };
const PERF_CONSOLE = { digico: 'DiGiCo', dlive: 'Allen & Heath dLive', klang: 'KLANG', wing: 'Behringer WING', lv1: 'Waves LV1' };
function perfEl(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function perfTile(label, value, sub, level) {
  const t = perfEl('div', 'perf-tile' + (level ? ' is-' + level : ''));
  t.append(perfEl('div', 'perf-tile-label', label), perfEl('div', 'perf-tile-value', value));
  if (sub) t.append(perfEl('div', 'perf-tile-sub', sub));
  return t;
}
function perfRow(name, text, dot) {
  const r = perfEl('div', 'perf-row');
  r.append(perfEl('span', 'dot' + (dot ? ' ' + dot : '')), perfEl('span', 'perf-row-name', name), perfEl('span', 'perf-row-text', text));
  return r;
}
function perfFacts(box, pairs) {
  box.replaceChildren(...pairs.flatMap(([k, v]) => [perfEl('div', 'perf-fact-label', k), perfEl('div', 'perf-fact-value', v)]));
}
function renderPerformance(s) {
  perfLast = s;
  const j = s.jpmixer, c = s.computer, x = s.extra;
  $('perfUpdated').textContent = `Updated ${new Date(s.at).toLocaleTimeString()}. Refreshes every 2 seconds while this tab is open.`;
  // Right now
  const health = s.health.length ? s.health : [{ level: 'ok', text: 'Everything looks normal.' }];
  $('perfHealth').replaceChildren(...health.map((h) => { const li = perfEl('li', 'is-' + h.level); li.append(perfEl('span', 'dot'), perfEl('span', '', h.text)); return li; }));
  // JPMixer
  const r = j.responsiveness;
  $('perfApp').replaceChildren(
    perfTile('Processor', `${j.cpuOfComputer.toFixed(1)}%`, `of this computer · peak ${j.cpuPeakOfComputer.toFixed(1)}%`, j.cpuOfComputer >= 60 ? 'warn' : ''),
    perfTile('Memory', perfMB(j.memoryMB), `peak ${perfMB(j.memoryPeakMB)}`, j.memoryMB >= 2048 ? 'warn' : ''),
    perfTile('Responsiveness', r.maxMs < 100 ? 'Good' : r.maxMs < 500 ? 'Some delay' : 'Slow', `longest hold-up ${r.maxMs} ms in the last 10 s · peak ${r.peakMaxMs} ms`, r.maxMs < 100 ? 'ok' : r.maxMs < 500 ? 'warn' : 'error'),
    perfTile('Running for', perfDuration(j.uptimeSec), `version ${j.version}`),
  );
  $('perfProcSummary').textContent = `Processes (${j.processes.length})`;
  const table = perfEl('table', 'perf-table');
  const head = perfEl('tr');
  head.append(perfEl('th', '', 'Process'), perfEl('th', '', 'Processor'), perfEl('th', '', 'Memory'));
  table.append(head);
  for (const p of j.processes) {
    const tr = perfEl('tr');
    tr.append(perfEl('td', '', p.name), perfEl('td', '', p.cpu === null ? '—' : `${p.cpu.toFixed(1)}%`), perfEl('td', '', perfMB(p.memoryMB)));
    table.append(tr);
  }
  $('perfProcs').replaceChildren(table);
  // Connections
  const t = s.traffic;
  $('perfConn').replaceChildren(
    perfTile('Server', x.server.running ? 'Running' : 'Stopped', x.server.running ? `http://${x.server.address}:${x.server.port}` : 'Start it on Get started', x.server.running ? 'ok' : 'warn'),
    perfTile('Phones & pages', String(x.connections), 'connected right now'),
    perfTile('Console', x.console.demo ? 'Demo mode' : x.console.connected ? 'Connected' : 'Not connected', PERF_CONSOLE[x.console.type] || x.console.type, x.console.demo ? '' : x.console.connected ? 'ok' : 'warn'),
    perfTile('Console messages', t.seen ? `${t.inPerSec} in · ${t.outPerSec} out` : '—', t.seen ? 'a second, over the last 10 s' : 'Shown for DiGiCo consoles'),
  );
  // Connections: Planning Center, plugins, the Control API
  const rows = [];
  const p = x.pco;
  if (!p.configured) rows.push(perfRow('Planning Center', 'Not set up', ''));
  else {
    const fail = p.lastFailure ? ` Last problem: ${p.lastFailure.message}, ${new Date(p.lastFailure.at).toLocaleTimeString()}.` : '';
    rows.push(perfRow('Planning Center', `${p.last20s} requests in the last 20 s (the limit is ${p.limitPer20s}) · ${p.lastMinute} in the last minute.${fail}`, p.last20s >= 80 ? 'warn' : p.lastFailure && Date.now() - Date.parse(p.lastFailure.at) < 120000 ? 'warn' : 'on'));
  }
  const live = (it, name) => rows.push(perfRow(name, it.enabled ? it.message || it.state : 'Off', !it.enabled ? '' : it.state === 'connected' ? 'on' : it.state === 'error' ? 'error' : 'warn'));
  live(x.companion, 'Companion');
  live(x.smaart, 'Smaart SPL');
  rows.push(perfRow('Shure wireless', x.shure.enabled ? `${x.shure.connected} of ${x.shure.receivers} receiver${x.shure.receivers === 1 ? '' : 's'} connected` : 'Off', !x.shure.enabled ? '' : x.shure.receivers && x.shure.connected === x.shure.receivers ? 'on' : 'warn'));
  rows.push(perfRow('Control API', x.controlApi ? 'On' : 'Off', x.controlApi ? 'on' : ''));
  if (x.pluginsAllowed) {
    const running = x.plugins.filter((pl) => pl.state === 'running').length;
    const bad = x.plugins.filter((pl) => pl.state === 'crashed' || pl.state === 'restarting');
    rows.push(perfRow('Plugins', x.plugins.length ? `${running} of ${x.plugins.length} running${bad.length ? `. Stopped: ${bad.map((pl) => pl.name).join(', ')}` : ''}` : 'None turned on', bad.length ? 'warn' : x.plugins.length ? 'on' : ''));
  }
  $('perfIntegrations').replaceChildren(...rows);
  // This computer
  const availPct = c.memoryTotalBytes ? Math.round((c.memoryAvailableBytes / c.memoryTotalBytes) * 100) : null;
  const diskPct = c.disk.totalBytes ? Math.round((c.disk.freeBytes / c.disk.totalBytes) * 100) : null;
  $('perfComputer').replaceChildren(
    perfTile('Processor load', c.load === null ? '—' : `${c.load}%`, c.load === null ? 'Not reported on Windows' : 'everything on it, last minute', c.load !== null && c.load >= 90 ? 'warn' : ''),
    perfTile('Memory available', perfBytes(c.memoryAvailableBytes), `of ${perfBytes(c.memoryTotalBytes)}${availPct !== null ? ` (${availPct}%)` : ''}`, availPct !== null && availPct < 5 ? 'error' : availPct !== null && availPct < 12 ? 'warn' : ''),
    perfTile('Disk free', perfBytes(c.disk.freeBytes), c.disk.totalBytes ? `of ${perfBytes(c.disk.totalBytes)} (${diskPct}%)` : '', c.disk.freeBytes !== null && c.disk.freeBytes < 1024 ** 3 ? 'error' : c.disk.freeBytes !== null && c.disk.freeBytes < 5 * 1024 ** 3 ? 'warn' : ''),
    perfTile('Temperature', PERF_THERMAL[c.thermal] || c.thermal, c.thermal === 'unknown' ? '' : 'as this computer reports it', c.thermal === 'critical' ? 'error' : c.thermal === 'serious' ? 'warn' : c.thermal === 'nominal' ? 'ok' : ''),
  );
  perfFacts($('perfComputerFacts'), [
    ['Name', c.name],
    ['System', `${c.os} (${c.arch})`],
    ['Processor', `${c.cpuModel}, ${c.cores} cores`],
    ['On for', perfDuration(c.uptimeSec)],
    ['Power', c.onBattery ? 'Battery' : 'Plugged in'],
    ['Keep awake', x.server.keepAwake ? 'On while the server runs' : 'Off'],
  ]);
  perfFacts($('perfData'), [
    ['All of it', perfBytes(s.folder.bytes)],
    ['Backups', perfBytes(s.folder.backupsBytes)],
    ['Folder', s.folder.path],
    ['Versions', `JPMixer ${j.version} · Electron ${j.versions.electron} · Node ${j.versions.node} · Chrome ${j.versions.chrome}`],
  ]);
}
// The same numbers as plain text, for whoever is helping (no passwords or names)
function performanceText(s) {
  const j = s.jpmixer, c = s.computer, x = s.extra, t = s.traffic;
  const lines = [
    `JPMixer performance report, ${new Date(s.at).toLocaleString()}`,
    '',
    'Right now:',
    ...(s.health.length ? s.health.map((h) => `  [${h.level}] ${h.text}`) : ['  Everything looks normal.']),
    '',
    `JPMixer ${j.version}, running for ${perfDuration(j.uptimeSec)}`,
    `  Processor ${j.cpuOfComputer.toFixed(1)}% of the computer (peak ${j.cpuPeakOfComputer.toFixed(1)}%), memory ${perfMB(j.memoryMB)} (peak ${perfMB(j.memoryPeakMB)})`,
    `  Longest hold-up ${j.responsiveness.maxMs} ms in the last 10 s (peak ${j.responsiveness.peakMaxMs} ms)`,
    ...j.processes.map((p) => `  - ${p.name}: ${p.cpu === null ? '—' : p.cpu.toFixed(1) + '%'}, ${perfMB(p.memoryMB)}`),
    '',
    `Server ${x.server.running ? 'running on port ' + x.server.port : 'stopped'}, ${x.connections} connected`,
    `Console: ${PERF_CONSOLE[x.console.type] || x.console.type}, ${x.console.demo ? 'demo mode' : x.console.connected ? 'connected' : 'not connected'}${t.seen ? `, ${t.inPerSec} in / ${t.outPerSec} out a second` : ''}`,
    `Planning Center: ${x.pco.configured ? `${x.pco.last20s} requests in 20 s, ${x.pco.lastMinute} in a minute${x.pco.lastFailure ? `, last problem ${x.pco.lastFailure.message} at ${new Date(x.pco.lastFailure.at).toLocaleTimeString()}` : ''}` : 'not set up'}`,
    `Companion: ${x.companion.enabled ? x.companion.state : 'off'} · Smaart: ${x.smaart.enabled ? x.smaart.state : 'off'} · Shure: ${x.shure.enabled ? `${x.shure.connected}/${x.shure.receivers} receivers` : 'off'} · Control API: ${x.controlApi ? 'on' : 'off'}${x.pluginsAllowed ? ` · Plugins: ${x.plugins.map((p) => `${p.name} (${p.state})`).join(', ') || 'none on'}` : ''}`,
    '',
    `Computer: ${c.os} (${c.arch}), ${c.cpuModel}, ${c.cores} cores, on for ${perfDuration(c.uptimeSec)}`,
    `  Load ${c.load === null ? '—' : c.load + '%'}, memory available ${perfBytes(c.memoryAvailableBytes)} of ${perfBytes(c.memoryTotalBytes)}, disk free ${perfBytes(c.disk.freeBytes)}, temperature ${PERF_THERMAL[c.thermal] || c.thermal}, ${c.onBattery ? 'on battery' : 'plugged in'}`,
    `  JPMixer's data ${perfBytes(s.folder.bytes)} (backups ${perfBytes(s.folder.backupsBytes)})`,
    `  Electron ${j.versions.electron}, Node ${j.versions.node}, Chrome ${j.versions.chrome}`,
  ];
  return lines.join('\n');
}
async function refreshPerformance() {
  if (!$('tab-performance').classList.contains('active')) return;
  try { renderPerformance(await window.jpm.getPerformance()); } catch (_) { /* try again shortly */ }
}
setInterval(refreshPerformance, 2000);
document.querySelector('.tab[data-tab="performance"]').addEventListener('click', () => setTimeout(refreshPerformance)); // once the panel is showing
$('perfCopyBtn').addEventListener('click', async () => {
  if (!perfLast) return;
  await window.jpm.copyText(performanceText(perfLast));
  $('perfCopyBtn').textContent = 'Copied';
  setTimeout(() => { $('perfCopyBtn').textContent = 'Copy report'; }, 1500);
});

// Pages tab → "Refresh team & role lists": the same two fetches the Planning
// Center tab's Refresh buttons make, with the outcome shown on the Pages tab.
$('pagesRefreshPcoBtn').addEventListener('click', async () => {
  const status = $('pagesPcoStatus');
  const creds = pcoCredsFromFields();
  if (!creds.appId || !creds.secret) { status.textContent = 'Add your Planning Center credentials first.'; return; }
  if (!$('pcoServiceType').value) { status.textContent = 'Pick a Service Type on the Planning Center tab first.'; return; }
  status.textContent = 'Loading…';
  const btn = $('pagesRefreshPcoBtn'); btn.disabled = true;
  try {
    await refreshPcoTeams();
    await refreshPcoPositions();
    status.textContent = pcoTeamsLoaded && pcoAllPositions.length ? 'Lists updated.' : ($('pcoTeamStatus').textContent || 'Could not load the lists.');
  } finally { btn.disabled = false; }
});

// Phone assignment is off on the server while aux renaming is off (see
// performer-assignments.js). It used to stay switchable here and simply do
// nothing. The saved choice is kept, so it comes back with renaming.
function updatePcoPhoneAssignmentsState() {
  const renaming = $('pcoUpdateAuxNames').checked;
  $('pcoPhoneAssignments').disabled = !renaming;
  $('pcoPhoneAssignmentsNote').hidden = renaming;
}
$('pcoUpdateAuxNames').addEventListener('change', updatePcoPhoneAssignmentsState);

$('pcoSyncNowBtn').addEventListener('click', async () => {
  const serviceTypeId = $('pcoServiceType').value;
  if (!serviceTypeId) { $('pcoSyncStatus').textContent = 'Pick a Service Type first.'; return; }
  // Always refresh, even when aux renaming (below) is turned off — the
  // Position mapping table and FOH Role dropdown aren't gated by that
  // toggle, and shouldn't need a separate "Refresh Positions" click.
  refreshPcoPositions();
  if (!$('pcoUpdateAuxNames').checked) {
    $('pcoSyncStatus').textContent = 'Performer names on aux mixes are turned off above, so there’s nothing to sync. The Green Room and production Home pages update on their own.';
    $('pcoSyncResults').innerHTML = '';
    return;
  }
  $('pcoSyncStatus').textContent = 'Syncing…';
  $('pcoSyncResults').innerHTML = '';
  const res = await window.jpm.pcoSyncNow({
    serviceTypeId,
    mapping: pcoPositionMapping,
    includeUnconfirmed: $('pcoIncludeUnconfirmed').checked,
    day: $('pcoDay').value,
    alt: collectPcoAlt(),
    creds: pcoCredsFromFields(),
  });
  if (!res.ok) {
    $('pcoSyncStatus').textContent = `Error: ${res.error}${res.status ? ' (' + res.status + ')' : ''}`;
    if (res.body) {
      const pre = document.createElement('pre');
      pre.className = 'sub mono';
      pre.textContent = res.body.slice(0, 500);
      $('pcoSyncResults').appendChild(pre);
    }
    return;
  }
  const dayNote = res.resolvedDay ? ` for ${res.resolvedDay}` : '';
  $('pcoSyncStatus').textContent = `Synced from "${res.plan.title || res.plan.id}"${dayNote}${res.service === 'alt' ? ', the second service (it has today’s plan)' : ''}.`;
  const parts = [];
  const updated = res.applied.filter(a => !a.unchanged), already = res.applied.filter(a => a.unchanged);
  if (updated.length) {
    parts.push(`<div class="sub"><strong>Updated:</strong> ${updated.map((a) => `Aux ${escHtml(a.aux)} → "${escHtml(a.label)}"`).join(', ')}</div>`);
  }
  if (already.length) {
    parts.push(`<div class="sub"><strong>Already up to date:</strong> ${already.map((a) => `Aux ${escHtml(a.aux)} "${escHtml(a.label)}"`).join(', ')}</div>`);
  }
  if (res.released && res.released.length) {
    parts.push(`<div class="sub"><strong>Nobody scheduled now, own name back:</strong> ${res.released.map((n) => `Aux ${escHtml(n)}`).join(', ')}</div>`);
  }
  if (res.unmapped.length) {
    parts.push(`<div class="sub">⚠️ Scheduled but unmapped: ${res.unmapped.map(escHtml).join(', ')}</div>`);
  }
  if (res.errors.length) {
    parts.push(`<div class="sub">Errors: ${res.errors.map(escHtml).join(', ')}</div>`);
  }
  if (!parts.length) parts.push('<div class="sub">No one relevant is scheduled yet, or nothing matched a mapping.</div>');
  $('pcoSyncResults').innerHTML = parts.join('');
});

$('klangPort').addEventListener('change', () => {
  const raw = Number($('klangPort').value) || 0;
  $('klangPort').value = (raw === 0) ? 0 : Math.max(1, Math.min(65535, raw));
});

// <input min/max> doesn't stop an out-of-range typed/pasted value from
// sitting in .value — collectConfig() clamps what actually gets saved, but
// without this the field itself would keep showing the invalid number even
// after Save & Apply silently used a different, corrected value instead.
// Clamp visibly, the same way channels/auxes already do above.
$('dliveBaseChannel').addEventListener('change', () => {
  const v = Math.max(0, Math.min(11, Number($('dliveBaseChannel').value) || 0));
  $('dliveBaseChannel').value = v;
});
$('dliveMidiPort').addEventListener('change', () => {
  const raw = Number($('dliveMidiPort').value) || 0;
  $('dliveMidiPort').value = (raw === 0) ? 0 : Math.max(1, Math.min(65535, raw));
});

// ── State ─────────────────────────────────────────────────────────────────

let isRunning          = false;
let isDemoMode         = false;
let isDliveType        = false;
let isConsoleControllerUnsupported = false; // dLive and KLANG both lack a Console Controller backend
let channelGroups      = [];   // [{ id, name }]
let channelOverrides   = {};   // { "1": { label, icon, groupId, order, enabled } }
let channelOrder       = [];   // ordered list of channel numbers, e.g. [1, 3, 2, ...]
let consoleNames       = {};   // { "1": "KICK", "2": "SNARE", ... } from server cache
let auxOverrides       = {};   // { "1": { enabled } }
let auxNames           = {};   // { "1": "IEM L", ... } from server cache
let activeIconBtn      = null;
let dragSrcCh          = null;
let ipadConnections    = [];   // [{ id, name, enabled, ip, sendPort }] — iPads all send to the Listen Port above

// ── Tabs ──────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'channels') {
      Promise.all([window.jpm.getChannelNames(), syncLiveCounts()]).then(([names]) => {
        consoleNames = names || {};
        renderChannels();
      });
    }
    if (btn.dataset.tab === 'auxes') {
      Promise.all([window.jpm.getAuxNames(), syncLiveCounts()]).then(([names]) => {
        auxNames = names || {};
        renderAuxes();
      });
    }
    if (btn.dataset.tab === 'performers') renderMixesTab();
    if (btn.dataset.tab === 'pco') {
      // Position → Aux dropdown falls back to the console's own live aux
      // names (see pcoAuxOptionsHtml) — refresh them here too, the same way
      // the Auxes tab does, so picking an aux doesn't show stale/generic
      // "AUX N" labels just because this tab was opened before ever
      // visiting Auxes in this session.
      window.jpm.getAuxNames().then((names) => {
        auxNames = names || {};
        if (pcoAllPositions.length) renderPcoPositionsForSelectedTeam();
      });
    }
  });
});

// If the console reports a channel/aux count that doesn't match the Setup
// tab's fields, those fields are stale — drifted from the real patch — and
// the highest-numbered channels/auxes silently have no row to configure here
// at all, even though the mixer pages still show them (they get their list
// from the live count reported by the desk, not these fields). Correct the
// fields to match reality whenever a live count is available to check against.
// While the console is reporting them the fields are locked, with a note —
// an edit there used to be reverted without a word the next time this ran.
// Demo mode is left alone: its fake console is built from these fields.
async function syncLiveCounts() {
  const [liveCh, liveAux] = isDemoMode ? [null, null] : await Promise.all([
    window.jpm.getChannelCount(),
    window.jpm.getAuxCount(),
  ]);
  if (liveCh !== null && liveCh !== parseInt($('channels').value)) {
    $('channels').value = liveCh;
  }
  if (liveAux !== null && liveAux !== parseInt($('auxes').value)) {
    $('auxes').value = liveAux;
  }
  $('channels').readOnly = liveCh !== null;
  $('auxes').readOnly = liveAux !== null;
  const hint = $('countsHint');
  hint.hidden = liveCh === null && liveAux === null;
  hint.textContent = hint.hidden ? '' : 'Channel and aux counts are read from the connected console. Change them on the desk.';
}

// ── Auxes editor ──────────────────────────────────────────────────────────

function renderAuxes() {
  const list    = $('auxesList');
  list.innerHTML = '';
  const auxCount = parseInt($('auxes').value) || 16;
  // Neither dLive nor KLANG implement per-send EQ (both backends' buildConfig
  // report eqEnabled: false for every aux regardless of this per-aux
  // setting) — disable the toggle so it doesn't look like a live control
  // that silently does nothing.
  const consoleType = $('consoleType').value;
  const eqDisabled = ['dlive', 'klang', 'wing', 'lv1'].includes(consoleType);
  // LV1 leaves the EQ column out entirely for now (its remote doesn't reach
  // the EQ plug-ins most shows use); the others show it switched off
  const eqHidden = consoleType === 'lv1';
  list.classList.toggle('no-eq', eqHidden);
  $('auxKeyEq').hidden = eqHidden;

  // Column headings once, at the top of the list
  const head = document.createElement('div');
  head.className = 'aux-row aux-row-head';
  head.setAttribute('role', 'row');
  head.innerHTML = '<span role="columnheader">#</span><span role="columnheader">Color</span><span role="columnheader">Mix</span><span role="columnheader">Show</span>' + (eqHidden ? '' : '<span role="columnheader">EQ</span>') + '<span role="columnheader">Link only</span>';
  list.appendChild(head);
  $('auxKeyGroups').hidden = !channelGroups.length;

  for (let i = 1; i <= auxCount; i++) {
    const ov      = auxOverrides[String(i)] || {};
    const enabled = ov.enabled !== false;
    const colour  = ov.colour  || '#e8a020';
    const name    = auxNames[String(i)] || `AUX ${i}`;

    const eqEnabled = ov.eqEnabled === true;
    const linkOnly  = ov.linkOnly === true;
    const eqTitle = eqDisabled ? "Per-send EQ isn't available for this console yet" : 'Performers can adjust this mix’s EQ';

    const row = document.createElement('div');
    row.className = 'aux-row' + (enabled ? '' : ' is-off') + (linkOnly ? ' is-link' : '');
    row.dataset.aux = i;
    row.setAttribute('role', 'row');
    row.style.setProperty('--aux-colour', colour);
    row.innerHTML = `
      <span class="aux-num" role="cell">${i}</span>
      <span role="cell"><input type="color" class="aux-colour colour-input" data-aux="${i}" value="${escHtml(colour)}" title="Button color" aria-label="Aux ${i} color" /></span>
      <span class="aux-main" role="cell">
        <span class="aux-name-label"><input type="text" class="aux-label-input" data-aux="${i}" value="${escHtml(ov.label || '')}" placeholder="${escHtml(name)}" maxlength="40" aria-label="Aux ${i} name" title="Leave empty to use the console’s name" /><span class="aux-badges">${linkOnly ? '<span class="aux-badge">Link only</span>' : ''}${enabled ? '' : '<span class="aux-badge muted">Hidden</span>'}</span></span>
      </span>
      <span role="cell"><input type="checkbox" class="toggle aux-enabled" data-aux="${i}" ${enabled ? 'checked' : ''} title="Listed in the performer mix picker" aria-label="Show aux ${i}" /></span>
      ${eqHidden ? '' : `<span role="cell"><input type="checkbox" class="toggle aux-eq-enabled" data-aux="${i}" ${eqEnabled ? 'checked' : ''} ${eqDisabled ? 'disabled' : ''} title="${eqTitle}" aria-label="Allow EQ for aux ${i}" /></span>`}
      <span role="cell"><input type="checkbox" class="toggle aux-link-only" data-aux="${i}" ${linkOnly ? 'checked' : ''} title="Hidden from the picker; open it with its direct link" aria-label="Direct link only for aux ${i}" /></span>
    `;
    // Which channel groups this mix's phones open to (Channels tab groups).
    // None picked = every channel, as before.
    if (channelGroups.length) {
      const picked = new Set((Array.isArray(ov.groups) ? ov.groups : []).map(String));
      const line = document.createElement('div');
      line.className = 'aux-groups';
      line.setAttribute('role', 'group');
      line.setAttribute('aria-label', `Channel groups phones open to for aux ${i}`);
      const caption = document.createElement('span');
      caption.className = 'aux-groups-caption';
      caption.textContent = 'Opens to';
      line.appendChild(caption);
      const anyPicked = channelGroups.some(g => picked.has(String(g.id)));
      for (const g of [{ id: '', name: 'All channels' }, ...channelGroups]) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'aux-group-pill';
        pill.dataset.aux = i;
        pill.dataset.group = String(g.id);
        pill.textContent = g.name || 'Untitled group';
        pill.setAttribute('aria-pressed', String(g.id === '' ? !anyPicked : picked.has(String(g.id))));
        line.appendChild(pill);
      }
      row.querySelector('.aux-main').appendChild(line);
    }
    list.appendChild(row);
  }

  renderHiddenAuxLinks();
}

$('auxesList').addEventListener('click', e => {
  const pill = e.target.closest('.aux-group-pill');
  if (!pill) return;
  const aux = pill.dataset.aux;
  if (!auxOverrides[aux]) auxOverrides[aux] = {};
  const existing = new Set(channelGroups.map(g => String(g.id)));
  // Kept as the groups' own ids (number or string), dropping any since removed
  let groups = (auxOverrides[aux].groups || []).filter(id => existing.has(String(id)));
  if (pill.dataset.group === '') groups = [];
  else if (groups.some(id => String(id) === pill.dataset.group)) groups = groups.filter(id => String(id) !== pill.dataset.group);
  else groups.push(channelGroups.find(g => String(g.id) === pill.dataset.group).id);
  if (groups.length) auxOverrides[aux].groups = groups;
  else delete auxOverrides[aux].groups;
  renderAuxes();
});

$('auxesList').addEventListener('change', e => {
  const aux = e.target.dataset.aux;
  if (!aux) return;
  if (!auxOverrides[aux]) auxOverrides[aux] = {};
  if (e.target.classList.contains('aux-label-input')) {
    // Your own name for the mix; empty = the console's name again
    const label = e.target.value.trim();
    if (label) auxOverrides[aux].label = label; else delete auxOverrides[aux].label;
  } else if (e.target.classList.contains('aux-enabled')) {
    auxOverrides[aux].enabled = e.target.checked;
  } else if (e.target.classList.contains('aux-colour')) {
    auxOverrides[aux].colour = e.target.value;
  } else if (e.target.classList.contains('aux-eq-enabled')) {
    auxOverrides[aux].eqEnabled = e.target.checked;
  } else if (e.target.classList.contains('aux-link-only')) {
    auxOverrides[aux].linkOnly = e.target.checked;
    renderHiddenAuxLinks();
  }
  updateAuxRowState(e.target.closest('.aux-row'));
});

// The row's Hidden / Link only badges and colour, without redrawing the list
function updateAuxRowState(row) {
  if (!row) return;
  const ov = auxOverrides[row.dataset.aux] || {};
  const enabled = ov.enabled !== false, linkOnly = ov.linkOnly === true;
  row.classList.toggle('is-off', !enabled);
  row.classList.toggle('is-link', linkOnly);
  row.style.setProperty('--aux-colour', ov.colour || '#e8a020');
  row.querySelector('.aux-badges').innerHTML = (linkOnly ? '<span class="aux-badge">Link only</span>' : '') + (enabled ? '' : '<span class="aux-badge muted">Hidden</span>');
}

// ── Hidden (link-only) aux direct links ────────────────────────────────────

function renderHiddenAuxLinks() {
  const container = $('hiddenAuxLinks');
  if (!container) return;
  const auxCount = parseInt($('auxes').value) || 16;
  const base = getBaseUrl();

  const hidden = [];
  for (let i = 1; i <= auxCount; i++) {
    if ((auxOverrides[String(i)] || {}).linkOnly === true) hidden.push(i);
  }

  if (hidden.length === 0) {
    container.innerHTML = '<div class="empty-hint">No link-only mixes. Turn on Link only above to add one here.</div>';
    return;
  }

  container.innerHTML = '';
  for (const i of hidden) {
    const name = auxNames[String(i)] || `AUX ${i}`;
    const colour = (auxOverrides[String(i)] || {}).colour || '#e8a020';
    const url = base ? `${base}/?aux=${i}` : null;

    const row = document.createElement('div');
    row.className = 'aux-link-row';
    row.innerHTML = `
      <span class="aux-link-name"><span class="aux-link-dot" style="background:${escHtml(colour)}"></span>${escHtml(name)}</span>
      <span class="aux-link-url mono">${url ? escHtml(url) : 'Start the server to get this link.'}</span>
      <button class="btn btn-sm hidden-aux-copy-btn" data-url="${url ? escHtml(url) : ''}" ${url ? '' : 'disabled'}>Copy link</button>
    `;
    container.appendChild(row);
  }
}

$('hiddenAuxLinks').addEventListener('click', async e => {
  const btn = e.target.closest('.hidden-aux-copy-btn');
  if (!btn || !btn.dataset.url) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.url);
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (_) {}
});

// ── iPad OSC connections ──────────────────────────────────────────────────

function renderIpadConnections() {
  const list = $('ipadList');
  if (!list) return;
  list.innerHTML = '';
  if (ipadConnections.length === 0) {
    list.innerHTML = '<div class="empty-hint">No iPads configured — click + Add iPad to add one.</div>';
    return;
  }
  for (const conn of ipadConnections) {
    const row = document.createElement('div');
    row.className = 'ipad-row';
    row.dataset.id = conn.id;
    row.innerHTML = `
      <div class="ipad-row-header">
        <input type="text" class="ipad-name ch-label-input" placeholder="iPad Name" value="${escHtml(conn.name)}" data-id="${conn.id}" />
        <label class="toggle-label" style="flex-shrink:0;font-size:11px">On</label>
        <input type="checkbox" class="toggle ipad-enabled" data-id="${conn.id}" ${conn.enabled ? 'checked' : ''} />
        <button class="btn btn-sm btn-danger ipad-remove" data-id="${conn.id}">Remove</button>
      </div>
      <div class="ipad-status" data-status-id="${conn.id}"></div>
      <div class="ipad-row-fields">
        <div>
          <label>IP Address</label>
          <input type="text" class="ipad-ip ch-label-input" placeholder="192.168.1.x" value="${escHtml(conn.ip)}" data-id="${conn.id}" />
        </div>
        <div>
          <label>Send Port <span class="sub">(port the iPad app listens on)</span></label>
          <input type="number" class="ipad-send-port ch-label-input" min="1" max="65535" value="${conn.sendPort}" data-id="${conn.id}" />
        </div>
      </div>
    `;
    list.appendChild(row);
  }
  renderIpadStatus();
}

// ── iPad relay health — refreshed every 3s while Settings is open ──
// Shows whether each iPad is actually talking to JPMixer, follows an iPad
// whose address changed, and lists devices sending OSC that aren't the
// console or a configured iPad (most often an iPad on a new DHCP address).
let ipadStatus = null;

function ago(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

function useIpForIpad(id, ip) {
  const conn = ipadConnections.find(c => c.id === id);
  if (!conn) return;
  conn.ip = ip;
  renderIpadConnections();
  renderIpadStatus();
}

function renderIpadStatus() {
  const now = Date.now();
  const byId = new Map(((ipadStatus && ipadStatus.ipads) || []).map(e => [e.id, e]));
  document.querySelectorAll('.ipad-status[data-status-id]').forEach(el => {
    const id = Number(el.dataset.statusId);
    const conn = ipadConnections.find(c => c.id === id);
    const st = byId.get(id);
    el.className = 'ipad-status';
    el.innerHTML = '';
    if (!ipadStatus || !conn || !conn.enabled) return;
    if (!st) { el.textContent = 'Not relaying yet — click Save & Apply.'; return; }
    if (st.ip !== st.configuredIp) {
      el.classList.add('warn');
      el.textContent = `⚠ Now sending from ${st.ip} (set to ${st.configuredIp}) — JPMixer is following it for now.`;
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = `Use ${st.ip}`;
      btn.addEventListener('click', () => useIpForIpad(id, st.ip));
      el.appendChild(btn);
    } else if (st.lastHeardAt && now - st.lastHeardAt < 15000) {
      el.classList.add('ok');
      el.textContent = `● Connected — last message ${ago(now - st.lastHeardAt)}`;
    } else if (st.lastHeardAt) {
      el.textContent = `○ Last heard ${ago(now - st.lastHeardAt)}`;
    } else {
      el.textContent = `○ Not heard from yet — the app should send to ${localIP || 'this computer'} on port ${$('deskListenPort').value}`;
    }
  });

  const box = $('ipadUnknown');
  box.innerHTML = '';
  for (const u of ((ipadStatus && ipadStatus.unknownSenders) || [])) {
    const row = document.createElement('div');
    row.className = 'ipad-unknown';
    const text = document.createElement('span');
    text.textContent = `${u.ip} is sending OSC (${u.messages} message${u.messages === 1 ? '' : 's'}, last ${ago(now - u.lastAt)}) but isn't the console or a configured iPad, so it's ignored.`;
    row.appendChild(text);
    for (const conn of ipadConnections) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = `Use for ${conn.name || 'iPad'}`;
      btn.addEventListener('click', () => useIpForIpad(conn.id, u.ip));
      row.appendChild(btn);
    }
    box.appendChild(row);
  }
}

async function refreshIpadStatus() {
  try { ipadStatus = await window.jpm.getIpadStatus(); } catch (_) { ipadStatus = null; }
  renderIpadStatus();
  renderConsoleHint();
}

// A DiGiCo answering console queries from an address other than the one in
// Settings (DHCP gave it a new one) used to look like "Connecting…" forever,
// with the only clue buried in the iPad section.
function renderConsoleHint() {
  const hint = $('consoleHint');
  const seen = ((ipadStatus && ipadStatus.unknownSenders) || []).find(u => u.looksLikeConsole);
  if (!seen || consoleConnectedNow) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.textContent = `⚠ A console is answering from ${seen.ip}, but Settings says ${$('deskIp').value || '(no address)'}. `;
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm';
  btn.textContent = `Use ${seen.ip}`;
  btn.addEventListener('click', () => {
    $('deskIp').value = seen.ip;
    $('deskIp').dispatchEvent(new Event('input', { bubbles: true }));
    hint.textContent = `Console address set to ${seen.ip} — click Save & Apply.`;
    $('saveBtn').focus();
  });
  hint.appendChild(btn);
}
setInterval(refreshIpadStatus, 3000);

$('addIpadBtn').addEventListener('click', () => {
  ipadConnections.push({
    id:         Date.now(),
    name:       `iPad ${ipadConnections.length + 1}`,
    enabled:    true,
    ip:         '',
    sendPort:   9000,
  });
  renderIpadConnections();
});

$('ipadList').addEventListener('input', e => {
  const id   = parseInt(e.target.dataset.id);
  const conn = ipadConnections.find(c => c.id === id);
  if (!conn) return;
  if (e.target.classList.contains('ipad-name'))       conn.name       = e.target.value;
  if (e.target.classList.contains('ipad-ip'))         conn.ip         = e.target.value;
  if (e.target.classList.contains('ipad-send-port'))  conn.sendPort   = parseInt(e.target.value) || 9000;
});

$('ipadList').addEventListener('change', e => {
  const id   = parseInt(e.target.dataset.id);
  const conn = ipadConnections.find(c => c.id === id);
  if (!conn) return;
  if (e.target.classList.contains('ipad-enabled')) conn.enabled = e.target.checked;
});

$('ipadList').addEventListener('click', e => {
  if (!e.target.classList.contains('ipad-remove')) return;
  const id = parseInt(e.target.dataset.id);
  ipadConnections = ipadConnections.filter(c => c.id !== id);
  renderIpadConnections();
});

// ── Groups ────────────────────────────────────────────────────────────────

function renderGroups() {
  const list = $('groupsList');
  list.innerHTML = '';

  if (channelGroups.length === 0) {
    list.innerHTML = '<div class="empty-hint">No groups yet. Click + Add group, or pick “+ New group…” on a channel below.</div>';
    return;
  }

  for (const g of channelGroups) {
    const used = Object.values(channelOverrides).filter(ov => ov && ov.groupId === g.id).length;
    const row = document.createElement('div');
    row.className = 'group-row group-chip';
    row.innerHTML = `
      <input type="text" class="group-name-input" value="${escHtml(g.name)}" placeholder="Group name" data-id="${g.id}" aria-label="Group name" size="${Math.max(6, Math.min(24, g.name.length + 1))}" />
      <span class="group-count" title="Channels in this group">${used}</span>
      <button class="group-remove delete-group" data-id="${g.id}" aria-label="Remove group ${escHtml(g.name)}" title="Remove group">×</button>
    `;
    list.appendChild(row);
  }
}

// A new group, ready to be named (its chip is focused with the name selected)
function addGroup() {
  const g = { id: Date.now(), name: 'New group' };
  channelGroups.push(g);
  renderGroups();
  refreshGroupDropdowns();
  const input = document.querySelector(`.group-name-input[data-id="${g.id}"]`);
  if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); input.select(); }
  return g;
}
$('addGroupBtn').addEventListener('click', () => addGroup());

$('groupsList').addEventListener('input', e => {
  const id = parseInt(e.target.dataset.id);
  const g  = channelGroups.find(g => g.id === id);
  if (!g) return;
  if (e.target.classList.contains('group-name-input')) { g.name = e.target.value; e.target.size = Math.max(6, Math.min(24, g.name.length + 1)); refreshGroupDropdowns(); }
});

$('groupsList').addEventListener('click', e => {
  if (!e.target.classList.contains('delete-group')) return;
  const id = parseInt(e.target.dataset.id);
  channelGroups = channelGroups.filter(g => g.id !== id);
  for (const key of Object.keys(channelOverrides)) {
    if (channelOverrides[key].groupId === id) channelOverrides[key].groupId = null;
  }
  renderGroups();
  refreshGroupDropdowns();
});

function refreshGroupDropdowns() {
  document.querySelectorAll('.ch-group-select').forEach(sel => {
    const ch   = sel.dataset.ch;
    const gid  = (channelOverrides[ch] || {}).groupId;
    const opts = channelGroups.map(g =>
      `<option value="${g.id}" ${gid == g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`
    ).join('');
    sel.innerHTML = `<option value="" ${!gid ? 'selected' : ''}>No group</option>${opts}<option value="__new">+ New group…</option>`;
  });
  // How many channels each group has, on its chip
  for (const chip of document.querySelectorAll('.group-chip')) {
    const id = parseInt(chip.querySelector('.group-name-input').dataset.id);
    chip.querySelector('.group-count').textContent = Object.values(channelOverrides).filter(ov => ov && ov.groupId === id).length;
  }
}

// ── Channel order helpers ─────────────────────────────────────────────────

function initChannelOrder() {
  const chCount = parseInt($('channels').value) || 48;
  // Sort all channels by their saved order, falling back to channel number
  const chs = [];
  for (let i = 1; i <= chCount; i++) {
    const ov = channelOverrides[String(i)] || {};
    chs.push({ ch: i, order: ov.order !== undefined ? ov.order : i });
  }
  chs.sort((a, b) => a.order - b.order);
  channelOrder = chs.map(x => x.ch);
}

function saveChannelOrder() {
  channelOrder.forEach((ch, idx) => {
    if (!channelOverrides[String(ch)]) channelOverrides[String(ch)] = { enabled: true };
    channelOverrides[String(ch)].order = idx;
  });
}

// ── Channels editor ───────────────────────────────────────────────────────

function renderChannels() {
  const list     = $('channelsList');
  list.innerHTML = '';

  // Ensure channelOrder matches the current channel count
  const chCount = parseInt($('channels').value) || 48;
  if (channelOrder.length !== chCount) initChannelOrder();

  for (const ch of channelOrder) {
    if (ch > chCount) continue;
    const ov          = channelOverrides[String(ch)] || {};
    const enabled     = ov.enabled !== false;
    const icon        = ov.icon || '';
    const consoleName = consoleNames[String(ch)] || '';

    const groupOpts = channelGroups.map(g =>
      `<option value="${g.id}" ${ov.groupId == g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`
    ).join('');

    const row = document.createElement('div');
    row.className  = 'ch-editor-row';
    row.dataset.ch = ch;
    row.draggable  = true;
    row.innerHTML  = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="ch-editor-num">${ch}</span>
      <button class="icon-btn${icon ? ' has-icon' : ''}" data-ch="${ch}" title="Choose icon" aria-label="Choose icon for channel ${ch}">${renderIconHTML(icon)}</button>
      <input type="text" class="ch-label-input" value="${escHtml(ov.label || '')}"
             placeholder="${escHtml(consoleName || `Ch ${ch}`)}" data-ch="${ch}" aria-label="Channel ${ch} name" />
      <select class="ch-group-select" data-ch="${ch}" aria-label="Channel ${ch} group">
        <option value="" ${!ov.groupId ? 'selected' : ''}>No group</option>
        ${groupOpts}
        <option value="__new">+ New group…</option>
      </select>
      <input type="checkbox" class="toggle ch-enabled" data-ch="${ch}" ${enabled ? 'checked' : ''} aria-label="Show channel ${ch}" />
    `;
    list.appendChild(row);
  }
}

// ── Drag-and-drop reorder ─────────────────────────────────────────────────

$('channelsList').addEventListener('dragstart', e => {
  const row = e.target.closest('.ch-editor-row');
  if (!row) return;
  dragSrcCh = parseInt(row.dataset.ch);
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => row.classList.add('dragging'), 0);
});

$('channelsList').addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.ch-editor-row');
  document.querySelectorAll('.ch-editor-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.ch) !== dragSrcCh) row.classList.add('drag-over');
});

$('channelsList').addEventListener('drop', e => {
  e.preventDefault();
  const targetRow = e.target.closest('.ch-editor-row');
  if (!targetRow || dragSrcCh === null) return;
  const targetCh = parseInt(targetRow.dataset.ch);
  if (dragSrcCh === targetCh) return;

  const srcIdx = channelOrder.indexOf(dragSrcCh);
  const dstIdx = channelOrder.indexOf(targetCh);
  channelOrder.splice(srcIdx, 1);
  channelOrder.splice(dstIdx, 0, dragSrcCh);

  renderChannels();
});

$('channelsList').addEventListener('dragend', () => {
  document.querySelectorAll('.ch-editor-row').forEach(r =>
    r.classList.remove('dragging', 'drag-over'));
  dragSrcCh = null;
});

$('channelsList').addEventListener('change', e => {
  const ch = e.target.dataset.ch;
  if (!ch) return;
  const ov = channelOverrides[ch] || (channelOverrides[ch] = { enabled: true });
  if (e.target.classList.contains('ch-label-input'))  ov.label   = e.target.value;
  if (e.target.classList.contains('ch-group-select')) {
    // "+ New group…": make one, put this channel in it, and go and name it
    if (e.target.value === '__new') { const g = addGroup(); ov.groupId = g.id; refreshGroupDropdowns(); return; }
    ov.groupId = e.target.value ? parseInt(e.target.value) : null;
    refreshGroupDropdowns();
  }
  if (e.target.classList.contains('ch-enabled'))      ov.enabled = e.target.checked;
});

$('channelsList').addEventListener('input', e => {
  const ch = e.target.dataset.ch;
  if (!ch || !e.target.classList.contains('ch-label-input')) return;
  const ov = channelOverrides[ch] || (channelOverrides[ch] = { enabled: true });
  ov.label = e.target.value;
});

// ── Icon picker ───────────────────────────────────────────────────────────

const iconPickerEl = $('iconPicker');
const iconGrid     = iconPickerEl.querySelector('.icon-grid');

// Clear button — always present
const clearCell = document.createElement('button');
clearCell.className = 'icon-cell icon-cell-clear';
clearCell.textContent = '✕';
clearCell.title = 'Clear icon';
iconGrid.appendChild(clearCell);

// Instrument icons are built lazily on first open so the server port is populated
let pickerBuilt = false;
function buildPickerItems() {
  if (pickerBuilt) return;
  pickerBuilt = true;
  for (let n = 1; n <= 120; n++) {
    const btn = document.createElement('button');
    btn.className = 'icon-cell';
    btn.dataset.fileNum = n;
    const img = document.createElement('img');
    img.src = instrumentIconURL(n);
    img.className = 'instrument-icon';
    img.width = 24;
    img.height = 24;
    btn.setAttribute('aria-label', `Instrument icon ${n}`);
    btn.appendChild(img);
    iconGrid.appendChild(btn);
  }
}

iconGrid.addEventListener('click', e => {
  const cell = e.target.closest('.icon-cell');
  if (!cell || !activeIconBtn) return;
  const ch  = activeIconBtn.dataset.ch;
  const ov  = channelOverrides[ch] || (channelOverrides[ch] = { enabled: true });

  if (cell.classList.contains('icon-cell-clear')) {
    ov.icon = '';
    activeIconBtn.innerHTML = '+';
    activeIconBtn.classList.remove('has-icon');
  } else if (cell.dataset.fileNum) {
    const num = cell.dataset.fileNum;
    ov.icon = 'file:' + num;
    activeIconBtn.innerHTML = renderIconHTML('file:' + num);
    activeIconBtn.classList.add('has-icon');
  }
  closeIconPicker();
});

$('channelsList').addEventListener('click', e => {
  const btn = e.target.closest('.icon-btn');
  if (!btn) return;
  e.stopPropagation();
  if (activeIconBtn === btn) { closeIconPicker(); return; }
  openIconPicker(btn);
});


function openIconPicker(btn) {
  buildPickerItems();
  activeIconBtn = btn;
  iconPickerEl.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  iconPickerEl.style.maxHeight = Math.min(420, window.innerHeight - 16) + 'px';
  const pw = iconPickerEl.offsetWidth;
  const ph = iconPickerEl.offsetHeight;
  const preferredTop = rect.bottom + 6 + ph <= window.innerHeight - 8
    ? rect.bottom + 6 : rect.top - ph - 6;
  const top = Math.max(8, Math.min(preferredTop, window.innerHeight - ph - 8));
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
  iconPickerEl.style.top  = top  + 'px';
  iconPickerEl.style.left = left + 'px';
}

function closeIconPicker() {
  iconPickerEl.style.display = 'none';
  activeIconBtn = null;
}

document.addEventListener('click', e => {
  if (iconPickerEl.style.display === 'none') return;
  if (!iconPickerEl.contains(e.target) && !e.target.closest('.icon-btn')) {
    closeIconPicker();
  }
});

// ── Apply / collect config ────────────────────────────────────────────────

function applyConfig(cfg) {
  for (const { el, key } of Object.values(fields)) {
    if (cfg[key] !== undefined) el.value = cfg[key];
  }
  $('autoStart').checked          = !!cfg.autoStart;
  $('openAtLogin').checked        = !!cfg.openAtLogin;
  $('keepAwake').checked          = cfg.keepAwake !== false;
  $('pluginsEnabled').checked     = cfg.pluginsEnabled === true;
  showPluginsTab(cfg.pluginsEnabled === true);
  loadPlugins(); // the Plugins list, and each plugin's tab (shown once allowed)
  $('sceneRecallEnabled').checked = !!cfg.sceneRecallEnabled;
  $('performerEarScenes').checked = cfg.performerEarScenes !== false;
  loadBranding(cfg);
  $('fohAccessCode').value = cfg.fohAccessCode || '';
  $('companionEnabled').checked = cfg.companionEnabled === true;
  updateCompanionFields();
  $('pcoEnabled').checked = cfg.pcoEnabled !== false;
  updatePcoEnabled();
  $('greenRoomQr').checked = cfg.greenRoomQr !== false;
  $('greenRoomMics').checked = cfg.greenRoomMics !== false;
  loadSmaart(cfg);
  $('autoBackupEnabled').checked  = cfg.autoBackupEnabled !== false;
  $('dliveTlsEnabled').checked    = !!cfg.dliveTlsEnabled;
  $('dliveListenSendLevels').checked = cfg.dliveListenSendLevels !== false;
  $('dlivePollSendLevels').checked   = cfg.dlivePollSendLevels !== false;
  $('apiEnabled').checked = !!cfg.apiEnabled;
  updateApiFieldsVisibility();
  $('pcoIncludeUnconfirmed').checked = !!cfg.pcoIncludeUnconfirmed;
  $('pcoPhoneAssignments').checked = !!cfg.pcoPhoneAssignments;
  $('pcoUpdateAuxNames').checked = cfg.pcoUpdateAuxNames !== false;
  updatePcoPhoneAssignmentsState();
  pcoPositionMapping = (cfg.pcoPositionMapping && typeof cfg.pcoPositionMapping === 'object') ? { ...cfg.pcoPositionMapping } : {};
  $('wirelessEnabled').checked = !!cfg.wirelessEnabled;
  wirelessReceivers = Array.isArray(cfg.wirelessReceivers) ? cfg.wirelessReceivers.filter(r => r && WIRELESS_IP.test(String(r.ip || ''))).map(r => (r.id ? { ip: r.ip, id: r.id } : { ip: r.ip })) : [];
  wirelessAuxMap = cfg.wirelessAux && typeof cfg.wirelessAux === 'object' ? { ...cfg.wirelessAux } : {};
  wirelessForget.clear();
  renderWireless();
  pcoGreenRoomHidden = Array.isArray(cfg.pcoGreenRoomHidden) ? [...cfg.pcoGreenRoomHidden] : [];
  pcoSavedServiceTypeId = cfg.pcoServiceTypeId || '';
  pcoSavedTeamId = cfg.pcoTeamId || '';
  pcoSavedRolePicks = rolePicksFrom(cfg);
  pcoPicksForSavedType = { team: pcoSavedTeamId, roles: rolePicksFrom(cfg) };
  renderPcoPositionsFallback();
  loadPcoAlt(cfg.pcoAlt);
  $('pcoAltEnabled').checked = !!pcoAlt.enabled;
  updatePcoAltFields();
  updateConsoleTypeFields();
  isDemoMode = !!cfg.demoMode;
  $('demoMode').checked = isDemoMode;
  $('demoMode').onchange = function () { isDemoMode = this.checked; syncLiveCounts(); };
  ipadConnections = Array.isArray(cfg.ipadConnections) ? cfg.ipadConnections : [];
  renderIpadConnections();

  channelGroups    = Array.isArray(cfg.channelGroups) ? cfg.channelGroups : [];
  channelOverrides = (cfg.channelOverrides && typeof cfg.channelOverrides === 'object')
    ? cfg.channelOverrides : {};
  auxOverrides     = (cfg.auxOverrides && typeof cfg.auxOverrides === 'object')
    ? cfg.auxOverrides : {};
  // What these looked like when Settings loaded them — see mergeExternalLabels()
  loadedOverrides = JSON.parse(JSON.stringify({ channel: channelOverrides, aux: auxOverrides }));

  initChannelOrder();
  renderGroups();
  renderChannels();
  renderAuxes();
}

// Names the Control API or a Planning Center sync wrote while Settings was
// open exist only in config.json — Settings' copy is from when it loaded, and
// saving it wholesale reverted them (and pushed the old names to every
// phone). Keep a fresher saved name unless it was also edited here.
let loadedOverrides = { channel: {}, aux: {} };
function mergeExternalLabels(mine, base, fresh) {
  const out = { ...mine };
  for (const [n, freshOv] of Object.entries(fresh || {})) {
    if (!freshOv || freshOv.label === undefined) continue;
    const baseLabel = (base[n] || {}).label;
    const mineLabel = (mine[n] || {}).label;
    if (freshOv.label !== baseLabel && mineLabel === baseLabel) {
      out[n] = { ...(mine[n] || {}), label: freshOv.label };
    }
  }
  return out;
}

function collectConfig() {
  const out = {};
  for (const { el, key, parse } of Object.values(fields)) {
    out[key] = parse(el.value);
  }
  // <input min/max> isn't self-enforcing — it doesn't stop a typed-in or
  // pasted out-of-range value from reaching .value, and the server trusts
  // this config directly (an out-of-range dliveMidiPort throws synchronously
  // deep in the TCP/TLS layer; an out-of-range dliveBaseChannel corrupts a
  // MIDI status byte in scene recall). Clamp here rather than rely solely on
  // the server-side fallback, so a bad value never gets silently saved.
  if (!Number.isInteger(out.dliveBaseChannel) || out.dliveBaseChannel < 0 || out.dliveBaseChannel > 11) {
    out.dliveBaseChannel = Math.max(0, Math.min(11, Number(out.dliveBaseChannel) || 0));
  }
  if (out.dliveMidiPort !== 0 && (!Number.isInteger(out.dliveMidiPort) || out.dliveMidiPort < 1 || out.dliveMidiPort > 65535)) {
    out.dliveMidiPort = 0; // 0 = use the documented default port
  }
  if (out.klangPort !== 0 && (!Number.isInteger(out.klangPort) || out.klangPort < 1 || out.klangPort > 65535)) {
    out.klangPort = 0; // 0 = use the documented default port (9110)
  }
  if (out.wingPort !== 0 && (!Number.isInteger(out.wingPort) || out.wingPort < 1 || out.wingPort > 65535)) {
    out.wingPort = 0; // 0 = use the documented default port (2223)
  }
  if (out.lv1Port !== 0 && (!Number.isInteger(out.lv1Port) || out.lv1Port < 1 || out.lv1Port > 65535)) {
    out.lv1Port = 0; // 0 = find LV1's port
  }
  if (out.apiPort !== undefined && (!Number.isInteger(out.apiPort) || out.apiPort < 1 || out.apiPort > 65535)) {
    out.apiPort = 9096; // documented default
  }
  // Companion buttons: out-of-range numbers fall back to the defaults
  const companionInt = (v, lo, hi, d) => Number.isInteger(v) && v >= lo && v <= hi ? v : d;
  out.companionEnabled = $('companionEnabled').checked;
  out.pcoEnabled = $('pcoEnabled').checked;
  out.wirelessEnabled  = $('wirelessEnabled').checked;
  out.wirelessReceivers = wirelessReceivers.map(r => (r.id ? { ip: r.ip, id: r.id } : { ip: r.ip }));
  out.wirelessAux = { ...wirelessAuxMap };
  out.greenRoomQr = $('greenRoomQr').checked;
  out.greenRoomMics = $('greenRoomMics').checked;
  out.smaartEnabled = $('smaartEnabled').checked;
  out.smaartPort = Number.isInteger(out.smaartPort) && out.smaartPort >= 1 && out.smaartPort <= 65535 ? out.smaartPort : 26000;
  out.smaartMetric = $('smaartMetric').value;
  out.smaartLiveMetric = $('smaartLiveMetric').value;
  out.greenRoomSpl = $('greenRoomSpl').checked;
  out.greenRoomSplMetric = $('greenRoomSplMetric').value;
  out.greenRoomSplInput = $('greenRoomSplInput').value;
  out.companionPort    = companionInt(out.companionPort, 1, 65535, 16622);
  out.companionColumns = companionInt(out.companionColumns, 1, 12, 8);
  out.companionRows    = companionInt(out.companionRows, 1, 8, 4);
  out.autoStart           = $('autoStart').checked;
  out.openAtLogin         = $('openAtLogin').checked;
  out.keepAwake           = $('keepAwake').checked;
  out.pluginsEnabled      = $('pluginsEnabled').checked;
  out.sceneRecallEnabled  = $('sceneRecallEnabled').checked;
  out.performerEarScenes  = $('performerEarScenes').checked;
  out.brandLogo           = brandLogoFile;
  out.brandAccent         = brandAccent;
  out.fohAccessCode       = $('fohAccessCode').value.trim();
  out.autoBackupEnabled   = $('autoBackupEnabled').checked;
  out.apiEnabled          = $('apiEnabled').checked;
  out.pcoServiceTypeId    = pcoServiceTypesLoaded ? ($('pcoServiceType').value || '') : pcoSavedServiceTypeId;
  out.pcoTeamId           = pcoTeamsLoaded ? ($('pcoTeam').value || '') : pcoSavedTeamId;
  // Until a dropdown holds a real list, keep what was saved (see pcoTeamsLoaded)
  for (const r of PCO_ROLE_PAGES) {
    const saved = pcoSavedRolePicks[r.key] || { team: '', position: '' };
    out[r.teamKey] = pcoTeamsLoaded ? ($(`pco${r.key}Team`).value || '') : saved.team;
    out[r.positionKey] = pcoAllPositions.length ? ($(`pco${r.key}Position`).value || '') : saved.position;
  }
  out.pcoIncludeUnconfirmed = $('pcoIncludeUnconfirmed').checked;
  out.pcoPhoneAssignments = $('pcoPhoneAssignments').checked;
  out.pcoUpdateAuxNames = $('pcoUpdateAuxNames').checked;
  out.pcoPositionMapping  = pcoPositionMapping;
  out.pcoAlt              = collectPcoAlt();
  out.pcoGreenRoomHidden  = pcoGreenRoomHidden;
  out.demoMode            = $('demoMode').checked;
  out.dliveTlsEnabled     = $('dliveTlsEnabled').checked;
  out.dliveListenSendLevels = $('dliveListenSendLevels').checked;
  out.dlivePollSendLevels   = $('dlivePollSendLevels').checked;
  out.ipadConnections     = ipadConnections;
  out.channelGroups    = channelGroups;
  saveChannelOrder();
  out.channelOverrides = channelOverrides;
  out.auxOverrides     = auxOverrides;
  return out;
}

// ── Status ────────────────────────────────────────────────────────────────

let localIP = null;
let port80  = { installed: false, upToDate: true, matches: false }; // from get-port80-status

// Port-80 helper state → the button's status text. The port-80 address is
// only given to performers when the helper is running and forwards to the
// current server port (port80.matches); otherwise say what's wrong.
function renderPort80Status() {
  const status = $('port80Status');
  if (!port80.installed) { status.className = 'ip-status'; status.textContent = ''; return; }
  const port = Number($('serverPort').value);
  if (!port80.running) {
    status.className   = 'ip-status err';
    status.textContent = 'Port 80 helper isn’t running — click Use Port 80 to restart it';
  } else if (port80.forwardsTo !== null && port80.forwardsTo !== port) {
    status.className   = 'ip-status err';
    status.textContent = `Port 80 forwards to ${port80.forwardsTo}, not ${port} — click Use Port 80 to update it`;
  } else if (!port80.upToDate) {
    status.className   = 'ip-status err';
    status.textContent = 'Port 80 helper is outdated — click Use Port 80 to update it (fixes fader lag)';
  } else {
    status.className   = 'ip-status ok';
    status.textContent = '✓ Port 80 active';
  }
}

async function refreshPort80Status() {
  try { port80 = await window.jpm.getPort80Status(); } catch (_) {}
  renderPort80Status();
  setStatus(isRunning);
}

// ── Get started: setup in order ───────────────────────────────────────────
// Read from what Settings already holds; redrawn whenever status or the
// saved settings change.
function renderSetupSteps() {
  const list = $('setupSteps'); if (!list) return;
  const typeName = $('consoleType').selectedOptions[0]?.textContent || 'console';
  const named = Object.values(channelOverrides).filter(ov => ov && ov.label).length;
  const auxCount = parseInt($('auxes').value) || 0;
  const hidden = Object.entries(auxOverrides).filter(([n, ov]) => Number(n) <= auxCount && ov && ov.enabled === false).length;
  const pcoReady = !!($('pcoAppId').value && $('pcoSecret').value && pcoSavedServiceTypeId);
  const roles = Object.values(pcoSavedRolePicks || {}).filter(r => r && r.position).length;
  const base = getBaseUrl();
  const steps = [
    { done: consoleConnectedNow, tab: 'console', title: 'Connect your console',
      text: consoleConnectedNow ? (isDemoMode ? 'Demo mode is on: a simulated console.' : `Connected to the ${typeName}. Its names are filled in for you.`) : 'Not connected. Choose your console and enter its address, or turn on Demo mode to try things out. Names are filled in from the console once it’s connected.' },
    { done: channelGroups.length > 0 || named > 0, optional: true, tab: 'channels', title: 'Name and group your channels',
      text: (channelGroups.length || named ? `${channelGroups.length} group${channelGroups.length === 1 ? '' : 's'}, ${named} channel${named === 1 ? '' : 's'} renamed in JPMixer. ` : '') + 'The console’s channel names are used unless you type your own. Groups let performers show one part of the band at a time.' },
    { done: auxCount > 0, tab: 'auxes', title: 'Check your aux mixes',
      text: auxCount ? `${auxCount} mix${auxCount === 1 ? '' : 'es'}${hidden ? `, ${hidden} hidden from performers` : ', all shown to performers'}. Hide the ones that aren’t monitor mixes, and rename any you like.` : 'No mixes yet.' },
    { done: !!base, tab: 'performers', title: 'Give performers the address',
      text: base ? `Performers open ${base} on their phones and pick their mix.` : 'Start the server (above) to get the address.' },
    { done: pcoReady, optional: true, tab: 'pco', title: 'Connect Planning Center',
      text: pcoReady ? 'Connected. Performer names, the Green Room and the Home pages follow the schedule.' : 'Optional: performer names on mixes, the Green Room display, and who’s on today on the Home pages.' },
    { done: roles > 0, optional: true, tab: 'pco', jump: 'pco-home-pages', title: 'Set up the production team’s Home pages',
      text: roles ? `${roles} of 4 Home pages welcome a scheduled person (FOH, ProPresenter, Lighting, Switcher).` : 'Optional, after Planning Center: who each Home page welcomes.' },
  ];
  list.replaceChildren(...steps.map((st, i) => {
    const li = document.createElement('li');
    li.className = 'setup-step' + (st.done ? ' is-done' : st.optional ? ' is-optional' : ' is-todo');
    li.innerHTML = `<span class="setup-step-mark" aria-hidden="true">${st.done ? '✓' : i + 1}</span>
      <div class="setup-step-body"><div class="setup-step-title">${escHtml(st.title)}${st.optional && !st.done ? ' <span class="setup-step-tag">Optional</span>' : ''}</div><div class="sub">${escHtml(st.text)}</div></div>`;
    const go = document.createElement('button');
    go.className = 'btn btn-sm'; go.type = 'button'; go.textContent = st.done ? 'Open' : 'Set up';
    go.setAttribute('aria-label', `${st.title}: open settings`);
    go.addEventListener('click', () => {
      document.querySelector(`.tab[data-tab="${st.tab}"]`)?.click();
      const jump = st.jump && $(st.jump);
      if (jump) requestAnimationFrame(() => jump.scrollIntoView({ block: 'start' }));
    });
    li.appendChild(go);
    return li;
  }));
}
document.querySelector('.tab[data-tab="start"]')?.addEventListener('click', renderSetupSteps);

let consoleConnectedNow = false;
function setConsoleStatus(connected) {
  consoleConnectedNow = !!connected;
  const demo = isDemoMode && connected;
  $('consoleDot').className      = 'dot' + (connected ? ' on' : '');
  $('consolePillLabel').textContent   = demo ? 'Demo' : (connected ? 'Connected' : 'Offline');
  $('consoleStatusLabel').textContent = demo ? 'Demo mode — simulated console'
    : (connected ? 'Connected to console' : 'Not connected');
  renderSetupSteps();
  renderWelcomes();
}

function setDeviceCount(count) {
  const el = $('deviceCount');
  el.style.display = count > 0 ? '' : 'none';
  $('deviceCountLabel').textContent = count === 1 ? '1 device' : `${count} devices`;
}

function getBaseUrl() {
  if (!isRunning) return null;
  const port = Number($('serverPort').value);
  if (!localIP) return `http://localhost:${port}`;
  // With the port-80 helper installed, give out one canonical address — a
  // browser keeps separate storage (and so separate My Mixes) for :80 and :8080
  return port80.matches ? `http://${localIP}` : `http://${localIP}:${port}`;
}

function setStatus(running) {
  isRunning = running;
  $('statusDot').className = 'dot' + (running ? ' on' : '');
  $('statusLabel').textContent = running ? 'Running' : 'Stopped';
  const base = getBaseUrl();
  $('serverUrl').textContent = base || 'Not running';
  renderSetupSteps();
  $('serverUrlHint').style.display = (running && port80.matches && localIP) ? '' : 'none';
  for (const [urlId, buttonId, hintId, route] of [
    ['homePickerViewUrl', 'openHomePickerViewBtn', 'homePickerViewHint', '/home.html'],
    ['fohViewUrl', 'openFohViewBtn', 'fohViewHint', '/foh.html'],
    ['propresenterViewUrl', 'openProPresenterViewBtn', 'propresenterViewHint', '/propresenter.html'],
    ['lightingViewUrl', 'openLightingViewBtn', 'lightingViewHint', '/lighting.html'],
    ['switcherViewUrl', 'openSwitcherViewBtn', 'switcherViewHint', '/switcher.html'],
    ['monitorUrl', 'openMonitorBtn', 'monitorBtnHint', '/monitor.html'],
    ['consoleUrl', 'openConsoleBtn', 'consoleBtnHint', '/console.html'],
    ['devicesUrl', 'openDevicesBtn', 'devicesBtnHint', '/devices.html'],
    ['performerUrl', 'openPerformerBtn', 'performerBtnHint', '/'],
    ['greenRoomViewUrl', 'openGreenRoomViewBtn', 'greenRoomViewHint', '/greenroom.html']
  ]) {
    $(urlId).textContent = base ? base + route : '— (server not running)';
    $(buttonId).disabled = !running;
    $(hintId).style.display = running ? 'none' : '';
  }
  // The Console Controller (main faders, mutes, solos, control groups) isn't
  // implemented on the dLive or KLANG backends yet — neither server handles
  // any of console.js's message types except fire-snapshot, and nothing
  // ever answers request-console-state. Left open, the page would render
  // fully interactive-looking strips that silently do nothing on a real
  // console — worse than just not opening it. Disable the entry point
  // instead of shipping a page that only pretends to work.
  $('openConsoleBtn').disabled = !running || isConsoleControllerUnsupported;
  if (isConsoleControllerUnsupported) {
    $('consoleBtnHint').style.display = '';
    $('consoleBtnHint').textContent = 'Not available yet — main faders, mutes, and solos aren’t implemented on this backend.';
  } else {
    $('consoleBtnHint').style.display = running ? 'none' : '';
    $('consoleBtnHint').textContent = 'Start the server first to open.';
  }
  const btn = $('toggleBtn');
  btn.textContent = running ? 'Stop' : 'Start';
  btn.className   = running ? 'btn stop' : 'btn';
  renderHiddenAuxLinks();
}


$('openMonitorBtn').addEventListener('click', async () => {
  const result = await window.jpm.openMonitor();
  if (result && result.error) alert('Start the server first, then open the monitor view.');
});

$('openConsoleBtn').addEventListener('click', async () => {
  const result = await window.jpm.openConsole();
  if (result && result.error) alert('Start the server first, then open the console view.');
});

$('openDevicesBtn').addEventListener('click', async () => {
  const result = await window.jpm.openDevices();
  if (result && result.error) alert('Start the server first, then open the devices view.');
});

for (const [buttonId, hintId, open] of [
  ['openHomePickerViewBtn', 'homePickerViewHint', base => window.jpm.openFoh(base + '/home.html')],
  ['openFohViewBtn', 'fohViewHint', base => window.jpm.openFoh(base + '/foh.html')],
  ['openProPresenterViewBtn', 'propresenterViewHint', base => window.jpm.openFoh(base + '/propresenter.html')],
  ['openLightingViewBtn', 'lightingViewHint', base => window.jpm.openFoh(base + '/lighting.html')],
  ['openSwitcherViewBtn', 'switcherViewHint', base => window.jpm.openFoh(base + '/switcher.html')],
  ['openGreenRoomViewBtn', 'greenRoomViewHint', base => window.jpm.openGreenRoom(base + '/greenroom.html')],
  ['openPerformerBtn', 'performerBtnHint', () => window.jpm.openPerformer()]
]) {
  $(buttonId).addEventListener('click', async () => {
    const base = getBaseUrl();
    if (!base) return;
    try {
      const result = await open(base);
      if (result?.error) throw new Error(result.error);
    } catch (_) {
      $(hintId).textContent = 'Could not open this page. Check that the server is running.';
      $(hintId).style.display = '';
    }
  });
}
for (const button of document.querySelectorAll('[data-settings-target]')) {
  button.addEventListener('click', () => {
    document.querySelector(`.tab[data-tab="${button.dataset.settingsTarget}"]`)?.click();
    // …and straight to one section of it
    const jump = button.dataset.settingsJump && $(button.dataset.settingsJump);
    if (jump) requestAnimationFrame(() => jump.scrollIntoView({ block: 'start' }));
  });
}

// Pages: who each Home page welcomes, chosen on the Planning Center tab
function renderWelcomes() {
  const pcoReady = !!($('pcoAppId').value && $('pcoSecret').value);
  for (const r of PCO_ROLE_PAGES) {
    const el = $(`welcomes${r.key}`); if (!el) continue;
    const pos = $(`pco${r.key}Position`).value || pcoSavedRolePicks[r.key]?.position || '';
    const teamSel = $(`pco${r.key}Team`);
    const team = teamSel.value ? (teamSel.selectedOptions[0]?.textContent || '') : '';
    el.textContent = pos ? (team ? `${pos} · ${team}` : pos) : (pcoReady ? 'Nobody yet: choose a role' : 'Connect Planning Center first');
    el.classList.toggle('is-unset', !pos);
  }
}
document.querySelector('.tab[data-tab="views"]')?.addEventListener('click', renderWelcomes);
for (const r of PCO_ROLE_PAGES) for (const which of ['Team', 'Position']) $(`pco${r.key}${which}`).addEventListener('change', renderWelcomes);

$('toggleBtn').addEventListener('click', async () => {
  if (isRunning) await window.jpm.stopServer();
  else           await window.jpm.startServer();
});

$('port80Btn').addEventListener('click', async () => {
  const btn    = $('port80Btn');
  const status = $('port80Status');
  btn.disabled    = true;
  btn.textContent = 'Setting up…';
  status.className = 'ip-status';
  status.textContent = '';

  const port   = Number($('serverPort').value) || 8080;
  const result = await window.jpm.setupPort80(port);

  btn.disabled    = false;
  btn.textContent = 'Use Port 80';

  if (result.ok) {
    status.className   = 'ip-status ok';
    status.textContent = '✓ Active — persists after reboot';
    try { port80 = await window.jpm.getPort80Status(); } catch (_) {}
    setStatus(isRunning);
  } else {
    status.className   = 'ip-status err';
    status.textContent = '✕ Failed — run as administrator';
  }
});

async function refreshAutoBackupInfo() {
  const info = $('autoBackupInfo');
  try {
    const status = await window.jpm.getAutoBackupStatus();
    if (!status.lastBackup) {
      info.textContent = status.enabled ? 'No automatic backups yet — one will be saved soon.' : 'Automatic backups are off.';
    } else {
      const when  = new Date(status.lastBackup).toLocaleString();
      const count = status.count + (status.count === 1 ? ' backup' : ' backups');
      info.textContent = `Last backup: ${when} — ${count} stored`;
    }
  } catch (e) {
    info.textContent = '—';
  }
}

// ── Performers tab (My Mixes) ─────────────────────────────────────────────────────────

let copiedMixInfo = null;
let mixTransferBusy = false;
function updateMixClipboard() {
  $('mixClipboard').hidden = !copiedMixInfo;
  $('mixClipboardLabel').textContent = copiedMixInfo ? `${copiedMixInfo.names.length === 1 ? 'Copied “' + copiedMixInfo.names[0] + '”' : 'Copied ' + copiedMixInfo.names.length + ' mixes'}. Choose Paste on a different device.` : '';
  document.querySelectorAll('.mix-paste-btn').forEach(button => {
    button.disabled = mixTransferBusy || !copiedMixInfo || button.dataset.deviceId === copiedMixInfo.sourceId;
    button.textContent = copiedMixInfo ? `Paste ${copiedMixInfo.names.length === 1 ? 'mix' : copiedMixInfo.names.length + ' mixes'}` : 'Paste';
  });
  document.querySelectorAll('.mix-copy-btn').forEach(button => { button.disabled = mixTransferBusy; });
  $('clearMixClipboardBtn').disabled = mixTransferBusy;
}
async function copySavedMixes(deviceId, names) {
  if (mixTransferBusy) return;
  const status = $('mixCopyStatus');
  mixTransferBusy = true; updateMixClipboard(); status.textContent = '';
  try {
    const result = await window.jpm.copyPresets(deviceId, names);
    if (!result.ok) throw new Error(result.error || 'Could not copy saved mixes.');
    copiedMixInfo = result;
  } catch (error) { status.className = 'backup-status err'; status.textContent = error.message; }
  finally { mixTransferBusy = false; updateMixClipboard(); }
}
$('clearMixClipboardBtn').addEventListener('click', async () => {
  if (mixTransferBusy) return;
  try { await window.jpm.clearPresetClipboard(); copiedMixInfo = null; updateMixClipboard(); }
  catch (error) { $('mixCopyStatus').className = 'backup-status err'; $('mixCopyStatus').textContent = error.message; }
});

async function renderMixesTab() {
  const container = $('mixesByAux');
  container.innerHTML = '<div class="empty-hint">Loading…</div>';

  const [allPresets, groups, connected] = await Promise.all([window.jpm.getPresets(), window.jpm.getPresetGroups(), window.jpm.getMixDevices()]);
  const liveDevices = new Map();
  for (const device of Array.isArray(connected) ? connected : []) if (device.deviceId) liveDevices.set(device.deviceId, device);

  container.innerHTML = '';

  const deviceIds = [...new Set([...Object.keys(allPresets), ...liveDevices.keys()])];
  if (deviceIds.length === 0) {
    container.innerHTML = '<div class="empty-hint">No mixes saved yet — performers save their mixes from the mixer page.</div>';
    return;
  }

  // Who / when / where for each group, from the owner, savedAt and aux that
  // newer saves record — lets you tell which orphaned device was whose
  // Who / when / where for each group — summarised once by presets.findGroups
  // (the same summary Find My Mixes shows), then just labelled here
  const info = new Map();
  for (const g of groups) {
    const parts = [g.owners.length ? g.owners.join(' / ') : `Device ${g.deviceId.slice(0, 8)}…`];
    if (g.lastAux != null) parts.push(auxNames[g.lastAux] || `Aux ${g.lastAux}`);
    parts.push(g.lastSaved ? `last saved ${new Date(g.lastSaved).toLocaleDateString()}` : 'older saves');
    info.set(g.deviceId, { label: parts.join(' · '), owner: g.owners[0] || '' });
  }
  const describe = (deviceId) => info.get(deviceId) || { label: `Device ${deviceId.slice(0, 8)}…`, owner: '' };
  const listed = deviceIds.filter(id => liveDevices.has(id) || Object.keys(allPresets[id] || {}).length > 0);

  for (const deviceId of listed) {
    const names = Object.keys(allPresets[deviceId] || {}).sort((a, b) => a.localeCompare(b));
    const info = describe(deviceId);

    const section = document.createElement('div');
    section.className = 'mixes-tab-aux';

    const header = document.createElement('div');
    header.className = 'mixes-tab-aux-header';
    const live = liveDevices.get(deviceId);
    header.textContent = info.label + (live ? ' · Connected' + (live.aux != null ? ' · ' + (auxNames[live.aux] || `Aux ${live.aux}`) : '') : '');
    header.title = deviceId;
    section.appendChild(header);
    section.dataset.deviceId = deviceId;
    const transfer = document.createElement('div');
    transfer.className = 'mix-device-transfer';
    const copyAll = document.createElement('button');
    copyAll.type = 'button'; copyAll.className = 'btn btn-sm' + (names.length ? ' mix-copy-btn' : '');
    copyAll.textContent = 'Copy all mixes'; copyAll.disabled = !names.length;
    copyAll.addEventListener('click', () => copySavedMixes(deviceId, null));
    const paste = document.createElement('button');
    paste.type = 'button'; paste.className = 'btn btn-sm mix-paste-btn'; paste.dataset.deviceId = deviceId;
    paste.addEventListener('click', async () => {
      if (mixTransferBusy || !copiedMixInfo) return;
      mixTransferBusy = true; updateMixClipboard();
      const status = $('mixCopyStatus'); status.textContent = '';
      try {
        const result = await window.jpm.pastePresets(deviceId);
        if (!result.ok) throw new Error(result.error || 'Could not paste saved mixes.');
        status.className = 'backup-status ok';
        status.textContent = `Pasted ${result.copied} mix(es) into ${info.label}; skipped ${result.skipped} identical copies; renamed ${result.renamed} to keep both versions.`;
        await renderMixesTab();
      } catch (error) { status.className = 'backup-status err'; status.textContent = error.message; }
      finally { mixTransferBusy = false; updateMixClipboard(); }
    });
    transfer.append(copyAll, paste); section.appendChild(transfer);

    // Set Name — stamps the name on every mix in the group for Find My Mixes
    const tools = document.createElement('div');
    tools.className = 'mixes-tab-tools';

    const ownerInput = document.createElement('input');
    ownerInput.type = 'text';
    ownerInput.placeholder = 'Performer name';
    ownerInput.maxLength = 64;
    ownerInput.value = info.owner;
    const ownerBtn = document.createElement('button');
    ownerBtn.className = 'btn btn-sm';
    ownerBtn.textContent = 'Set Name';
    ownerBtn.addEventListener('click', async () => {
      const result = await window.jpm.setPresetOwner(deviceId, ownerInput.value);
      if (!result.ok) { alert(result.error || 'Could not set the name.'); return; }
      renderMixesTab();
    });

    // Merge Into — moves this group's mixes into another device's group
    const mergeSelect = document.createElement('select');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Merge into…';
    mergeSelect.appendChild(placeholder);
    for (const otherId of listed) {
      if (otherId === deviceId) continue;
      const opt = document.createElement('option');
      opt.value = otherId;
      opt.textContent = describe(otherId).label;
      mergeSelect.appendChild(opt);
    }
    const mergeBtn = document.createElement('button');
    mergeBtn.className = 'btn btn-sm';
    mergeBtn.textContent = 'Merge';
    if (deviceId.startsWith('pco-person:')) {
      mergeBtn.disabled = true; mergeSelect.disabled = true;
      mergeBtn.title = mergeSelect.title = 'Performer backups stay separate. Use Copy and Paste to share mixes.';
    }
    mergeBtn.addEventListener('click', async () => {
      const toId = mergeSelect.value;
      if (!toId) return;
      const target = describe(toId).label;
      if (!confirm(`Move all ${names.length} mix(es) from "${info.label}" into "${target}"?\n\nSame-name mixes that differ are kept as "Name (2)". A phone still using the old device picks up the merged list. A backup is saved first.`)) return;
      mergeBtn.disabled = true;
      const result = await window.jpm.mergePresets(deviceId, toId);
      if (!result.ok) { alert(result.error || 'Merge failed.'); mergeBtn.disabled = false; return; }
      renderMixesTab();
    });

    tools.append(ownerInput, ownerBtn, mergeSelect, mergeBtn);
    section.appendChild(tools);

    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'mixes-tab-row';

      const label = document.createElement('span');
      label.className = 'mixes-tab-name';
      label.textContent = name;

      const del = document.createElement('button');
      del.className = 'btn btn-sm btn-danger';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!confirm(`Delete "${name}"?`)) return;
        const result = await window.jpm.deletePreset(deviceId, name);
        if (!result.ok) { alert('Could not save the deletion to disk. Please try again.'); return; }
        renderMixesTab();
      });

      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'btn btn-sm mix-copy-btn'; copy.textContent = 'Copy';
      copy.setAttribute('aria-label', `Copy ${name}`);
      copy.addEventListener('click', () => copySavedMixes(deviceId, [name]));
      row.append(label, copy, del);
      section.appendChild(row);
    }

    if (!names.length) {
      const empty = document.createElement('p'); empty.className = 'sub'; empty.textContent = 'No saved mixes yet. Paste a copied mix into this device.'; section.appendChild(empty);
    }
    container.appendChild(section);
  }
  updateMixClipboard();
}

$('exportMixBackupBtn').addEventListener('click', async () => {
  const button = $('exportMixBackupBtn'), status = $('mixBackupStatus');
  button.disabled = true; button.textContent = 'Backing up…'; status.textContent = '';
  try {
    const result = await window.jpm.exportMixBackup();
    if (result.canceled) return;
    if (!result.ok) throw new Error(result.error || 'Could not back up My Mixes.');
    status.className = 'backup-status ok'; status.textContent = 'Saved to ' + result.filePath;
  } catch (error) { status.className = 'backup-status err'; status.textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Back Up My Mixes…'; }
});

$('refreshMixesBtn').addEventListener('click', renderMixesTab);

$('showAutoBackupsBtn').addEventListener('click', () => {
  window.jpm.openAutoBackupsFolder();
});

$('exportBackupBtn').addEventListener('click', async () => {
  const btn    = $('exportBackupBtn');
  const status = $('exportStatus');
  btn.disabled    = true;
  btn.textContent = 'Exporting…';
  status.className   = 'backup-status';
  status.textContent = '';

  const includeCredentials = $('exportIncludeCredentials').checked;
  const result = await window.jpm.exportBackup({ includeCredentials });

  btn.disabled    = false;
  btn.textContent = 'Export Backup…';

  if (result.canceled) return;
  if (result.ok) {
    status.className   = 'backup-status ok';
    status.textContent = '✓ Saved to ' + result.filePath + (includeCredentials ? ' (includes passwords and keys — keep it private)' : ' (without passwords and keys)');
  } else {
    status.className   = 'backup-status err';
    status.textContent = '✕ ' + (result.error || 'Export failed.');
  }
});

let restorePreview = null;
let restoreInProgress = false;
let restoreReloadPending = false;
let restoreFooterActive = false;
function selectedRestoreSections() { return [...$('restoreOptions').querySelectorAll('input:checked')].map(input => input.value); }
function updateRestoreSelection() {
  const selected = selectedRestoreSections();
  $('applyRestoreBtn').disabled = restoreInProgress || !restorePreview || !selected.length;
  $('restoreMixModeRow').hidden = !selected.includes('mixes');
  $('restoreMixModeHelp').textContent = $('restoreMixMode').value === 'replace'
    ? 'Replaces the server’s My Mixes and device aliases. Copies already saved locally on phones remain on those phones.'
    : 'Identical copies are skipped. Different mixes with the same name receive a numbered suffix.';
  const names = (restorePreview?.sections || []).filter(section => selected.includes(section.id)).map(section => section.label);
  $('restoreSelectionSummary').textContent = names.length ? 'Will restore: ' + names.join(', ') + '.' : 'Choose at least one section. No data will change until you click Restore Selected.';
  const reviewing = !!restorePreview && $('tab-backup').classList.contains('active');
  if (reviewing || restoreFooterActive) {
    $('saveBtn').textContent = reviewing ? 'Restore Selected' : 'Save & Apply';
    $('saveBtn').disabled = restoreInProgress || (reviewing && !selected.length);
  }
  restoreFooterActive = reviewing;
}
function setRestoreBusy(busy) {
  restoreInProgress = busy || restoreReloadPending;
  for (const id of ['importBackupBtn','importMixBackupBtn','cancelRestoreBtn','saveBtn','restoreMixMode']) $(id).disabled = restoreInProgress;
  $('restoreOptions').disabled = restoreInProgress;
  updateRestoreSelection();
}
async function loadBackup() {
  if (restoreInProgress) return;
  document.querySelector('.tab[data-tab="backup"]').click();
  const status = $('importStatus'); status.textContent = ''; status.className = 'backup-status';
  setRestoreBusy(true);
  try {
    await window.jpm.cancelBackupRestore(); restorePreview = null; $('restorePreview').hidden = true;
    const result = await window.jpm.inspectBackup();
    if (result.canceled) return;
    if (!result.ok) throw new Error(result.error || 'Could not read this backup.');
    restorePreview = result;
    $('restoreFilename').textContent = result.filename;
    $('restoreFileType').textContent = result.kind + (result.appVersion ? ' · JPMixer ' + result.appVersion : '');
    $('restoreOptions').replaceChildren();
    for (const section of result.sections) {
      const label = document.createElement('label'); label.className = 'restore-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = section.id; input.checked = section.id === 'mixes' && section.count > 0;
      const text = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('span');
      title.textContent = section.label; detail.className = 'sub'; detail.textContent = section.description;
      text.append(title,detail); label.append(input,text); $('restoreOptions').appendChild(label);
    }
    $('restoreMixMode').value = 'merge'; $('restorePreview').hidden = false;
    $('backup-loader').scrollIntoView({ block:'start' });
  } catch (error) { status.className = 'backup-status err'; status.textContent = error.message; }
  finally { setRestoreBusy(false); }
}
$('importBackupBtn').addEventListener('click', loadBackup);
$('importMixBackupBtn').addEventListener('click', loadBackup);
$('restoreOptions').addEventListener('change', updateRestoreSelection);
$('restoreMixMode').addEventListener('change', updateRestoreSelection);
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', updateRestoreSelection);
$('cancelRestoreBtn').addEventListener('click', async () => {
  if (restoreInProgress) return;
  try {
    await window.jpm.cancelBackupRestore(); restorePreview = null; $('restorePreview').hidden = true; $('importStatus').textContent = ''; updateRestoreSelection();
  } catch (error) { $('importStatus').className = 'backup-status err'; $('importStatus').textContent = error.message; }
});
$('applyRestoreBtn').addEventListener('click', async () => {
  const sections = selectedRestoreSections();
  if (!restorePreview || !sections.length || restoreInProgress) return;
  const status = $('importStatus'); status.className = 'backup-status'; status.textContent = 'Saving a safety backup and restoring selected sections…';
  setRestoreBusy(true);
  try {
    const result = await window.jpm.restoreBackup({ id:restorePreview.id,sections,mixMode:$('restoreMixMode').value });
    if (!result.ok) throw new Error(result.error || 'Could not restore the selected sections.');
    const names = restorePreview.sections.filter(section => result.selected.includes(section.id)).map(section => section.label);
    restorePreview = null; $('restorePreview').hidden = true;
    status.className = 'backup-status ok';
    status.textContent = 'Restored ' + names.join(', ') + '. Safety backup saved.';
    if (result.mixes) status.textContent += ` Added ${result.mixes.imported}; skipped ${result.mixes.skipped} identical copies; renamed ${result.mixes.renamed} to keep both versions.`;
    if (result.configChanged) { restoreReloadPending = true; status.textContent += ' Reloading settings…'; setTimeout(() => location.reload(),1200); }
    else { await renderMixesTab(); await refreshAutoBackupInfo(); }
  } catch (error) { status.className = 'backup-status err'; status.textContent = error.message; }
  finally { setRestoreBusy(false); }
});

$('resetLayoutBtn').addEventListener('click', async () => {
  const btn    = $('resetLayoutBtn');
  const status = $('resetLayoutStatus');

  if (!confirm('This will clear all channel groups, icon assignments, and label overrides. Console settings and ear mixes are not affected. Continue?')) return;

  btn.disabled    = true;
  btn.textContent = 'Resetting…';
  status.className   = 'backup-status';
  status.textContent = '';

  // Change only the layout on top of what's saved. Saving the whole form
  // also saved unsaved edits on other tabs (which could restart the
  // server) and reverted aux names Planning Center synced meanwhile.
  let result;
  try {
    const saved = await window.jpm.getConfig();
    result = await window.jpm.saveConfig({ ...saved, channelGroups: [], channelOverrides: {} });
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  btn.disabled    = false;
  btn.textContent = 'Reset Layout & Icons…';
  if (!result || result.ok === false) {
    status.className   = 'backup-status err';
    status.textContent = (result && result.error) || 'Could not reset the layout — nothing was changed.';
    return;
  }
  channelGroups    = [];
  channelOverrides = {};
  loadedOverrides.channel = {};
  renderGroups();
  renderChannels();
  status.className   = 'backup-status ok';
  status.textContent = '✓ Layout and icons cleared.';
  setTimeout(() => { status.textContent = ''; }, 3000);
});

$('saveBtn').addEventListener('click', async () => {
  if (restorePreview && $('tab-backup').classList.contains('active')) {
    if (!restoreInProgress) $('applyRestoreBtn').click();
    return;
  }
  $('saveBtn').textContent = 'Saving…';
  $('saveBtn').disabled    = true;
  const out = collectConfig();
  const fresh = await window.jpm.getConfig();
  out.channelOverrides = mergeExternalLabels(out.channelOverrides, loadedOverrides.channel, fresh.channelOverrides);
  out.auxOverrides     = mergeExternalLabels(out.auxOverrides, loadedOverrides.aux, fresh.auxOverrides);
  // Receivers JPMixer has seen since this window opened are kept (shure-wireless.js saves them), minus any forgotten here
  out.wirelessKnown = (Array.isArray(fresh.wirelessKnown) ? fresh.wirelessKnown : []).filter(k => !wirelessForget.has(k.id));
  // The SPL card's own options, unless changed here (see loadSmaart)
  out.smaartHiddenInputs = Array.isArray(fresh.smaartHiddenInputs) ? fresh.smaartHiddenInputs : [];
  if (!$('smaartMetric').dataset.touched) out.smaartMetric = fresh.smaartMetric || '';
  if (!$('smaartLiveMetric').dataset.touched) out.smaartLiveMetric = fresh.smaartLiveMetric || '';
  const result = await window.jpm.saveConfig(out);
  if (!result || result.ok === false) {
    // The disk write failed — config.js rolled the in-memory config back,
    // so nothing actually changed. Don't claim success or adopt `out` as
    // the new baseline; the next save should still diff against what's
    // really on disk, not what this attempt tried to write.
    $('saveBtn').textContent = 'Save failed!';
    $('saveBtn').disabled    = false;
    alert((result && result.error) || 'Could not save settings — nothing was changed.');
    setTimeout(() => { $('saveBtn').textContent = 'Save & Apply'; }, 2000);
    return;
  }
  // Plugins keep their own on/off and settings (plugins.json)
  showPluginsTab(out.pluginsEnabled);
  if (out.pluginsEnabled) {
    let pluginsSaved = true;
    if (document.querySelector('[data-plugin-panel] [data-plugin]')) {
      const pluginResult = await window.jpm.pluginsSave(collectPluginChanges()).catch((e) => ({ ok: false, error: e.message }));
      if (!pluginResult.ok) { pluginsSaved = false; alert(pluginResult.error || 'Couldn’t save the plugin settings.'); }
    }
    // Saved: drawn again from what's saved (and the plugins' tabs added when
    // plugins were just allowed). Not saved: the changes stay to try again.
    if (pluginsSaved) {
      for (const card of document.querySelectorAll('[data-plugin-panel] [data-plugin]')) delete card.dataset.edited;
      for (const t of document.querySelectorAll('[data-plugin-panel] .card-row > .toggle')) t.dataset.saved = String(t.checked);
      await loadPlugins();
    }
    if (!catalogLoaded && $('tab-plugins').classList.contains('active')) loadCatalog(true);
  }
  // This is now the baseline for the next save. Turning performer names off
  // takes them off the mixes on save, so pick up the names they have now.
  channelOverrides = out.channelOverrides;
  auxOverrides     = result.auxNamesCleared ? ((await window.jpm.getConfig()).auxOverrides || {}) : out.auxOverrides;
  loadedOverrides  = JSON.parse(JSON.stringify({ channel: channelOverrides, aux: auxOverrides }));
  pcoSavedServiceTypeId = out.pcoServiceTypeId;
  pcoSavedTeamId        = out.pcoTeamId;
  pcoSavedRolePicks = rolePicksFrom(out);
  pcoPicksForSavedType = { team: out.pcoTeamId, roles: rolePicksFrom(out) };
  loadPcoAlt(out.pcoAlt);
  renderChannels();
  renderAuxes();
  // The login item can need approval in System Settings, or be refused
  const loginStatus = $('openAtLoginStatus');
  loginStatus.hidden = !(result.loginItem && !result.loginItem.ok);
  loginStatus.textContent = loginStatus.hidden ? '' : '⚠ ' + result.loginItem.error;
  if (result.loginItem && !result.loginItem.ok && !result.loginItem.needsApproval) $('openAtLogin').checked = !$('openAtLogin').checked;
  // Most changes now apply live; say when phones were disconnected by a restart
  $('saveBtn').textContent = result.restarted ? 'Saved — server restarted' : 'Saved!';
  if (result.auxNamesCleared) $('pcoSyncStatus').textContent = `Took performer names off ${result.auxNamesCleared} aux ${result.auxNamesCleared === 1 ? 'mix' : 'mixes'}.`;
  refreshPort80Status(); // a server-port change can stop the helper matching
  setTimeout(() => {
    $('saveBtn').textContent = 'Save & Apply';
    $('saveBtn').disabled    = false;
  }, 1500);
});

// ── Branding tab ──────────────────────────────────────────────────
// A logo and accent for the pages JPMixer serves (see src/server/branding.js).
// Saved with Save & Apply like everything else. Only the preview here uses
// the chosen color; Settings keeps JPMixer's own look.
const JPM_RED = '#e8003c';
let brandLogoFile = ''; // stored logo name, '' = JPMixer logo
let brandAccent = '';   // '#rrggbb', '' = JPMixer red
let brandImage = null;  // the logo preview, for reading colors from it

function hexToRgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function relativeLuminance(hex) {
  return hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

function setBrandAccent(hex) {
  brandAccent = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : '';
  const shown = brandAccent || JPM_RED;
  $('brandAccentPicker').value = shown;
  if (document.activeElement !== $('brandAccentHex')) $('brandAccentHex').value = brandAccent || '';
  $('brandAccentHex').placeholder = JPM_RED;
  $('brandAccentReset').disabled = !brandAccent;
  const sample = $('brandSample');
  sample.style.setProperty('--sample', shown);
  sample.style.setProperty('--sample-rgb', hexToRgb(shown).join(', '));
  // White text on a pale accent (buttons, the active chip) gets hard to read
  $('brandContrastNote').hidden = relativeLuminance(shown) < 0.5;
  for (const sw of $('brandSwatches').children) sw.setAttribute('aria-pressed', String(sw.dataset.color === brandAccent));
}

// The logo's most prominent colors, skipping near-white, near-black and
// grays unless that's all there is
function logoColors(img) {
  const size = 80, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const scale = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
  ctx.drawImage(img, 0, 0, (img.naturalWidth || size) * scale, (img.naturalHeight || size) * scale);
  let data;
  try { data = ctx.getImageData(0, 0, size, size).data; } catch (_) { return []; }
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0, val = max / 255;
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, weight: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++;
    bucket.weight += (val < 0.12 || (sat < 0.12 && val > 0.9)) ? 0.05 : sat < 0.15 ? 0.3 : 1 + sat;
    buckets.set(key, bucket);
  }
  const picked = [];
  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  // Colors that barely appear are anti-aliased edges between two colors
  const minWeight = (ranked[0]?.weight || 0) * 0.04;
  for (const bkt of ranked) {
    if (bkt.weight < minWeight) break;
    const rgb = [bkt.r / bkt.n, bkt.g / bkt.n, bkt.b / bkt.n];
    if (picked.every(p => Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]) > 60)) picked.push(rgb);
    if (picked.length === 6) break;
  }
  return picked.map(([r, g, b]) => toHex(r, g, b));
}

function showBrandLogo(dataUrl) {
  const canvas = $('brandCanvas');
  brandImage = null;
  $('brandSwatches').innerHTML = '';
  $('brandSwatchLabel').hidden = true;
  $('brandPickHint').hidden = true;
  $('brandRemoveBtn').hidden = !brandLogoFile;
  if (!dataUrl) {
    canvas.hidden = true;
    $('brandPreviewEmpty').hidden = false;
    return;
  }
  const img = new Image();
  img.onload = () => {
    brandImage = img;
    const w = img.naturalWidth || 300, h = img.naturalHeight || 150;
    const scale = Math.min(canvas.width / w, canvas.height / h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, (canvas.width - w * scale) / 2, (canvas.height - h * scale) / 2, w * scale, h * scale);
    canvas.hidden = false;
    $('brandPreviewEmpty').hidden = true;
    $('brandPickHint').hidden = false;
    const colors = logoColors(img);
    $('brandSwatchLabel').hidden = !colors.length;
    for (const color of colors) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'brand-swatch';
      sw.dataset.color = color;
      sw.style.background = color;
      sw.title = color;
      sw.setAttribute('aria-label', `Use ${color}`);
      sw.addEventListener('click', () => setBrandAccent(color));
      $('brandSwatches').appendChild(sw);
    }
    setBrandAccent(brandAccent);
  };
  img.src = dataUrl;
}

function loadBranding(cfg) {
  brandLogoFile = cfg.brandLogo || '';
  setBrandAccent(cfg.brandAccent || '');
  window.jpm.getBranding().then(b => { brandLogoFile = b.file; showBrandLogo(b.dataUrl); }).catch(() => showBrandLogo(null));
}

$('brandUploadBtn').addEventListener('click', async () => {
  const status = $('brandLogoStatus');
  const result = await window.jpm.chooseBrandLogo();
  if (result.canceled) return;
  if (!result.ok) { status.textContent = '✕ ' + result.error; return; }
  brandLogoFile = result.file;
  showBrandLogo(result.dataUrl);
  status.textContent = 'Logo ready. Click Save & Apply to use it.';
});
$('brandRemoveBtn').addEventListener('click', () => {
  brandLogoFile = '';
  showBrandLogo(null);
  $('brandLogoStatus').textContent = 'Back to the JPMixer logo once you click Save & Apply.';
});
$('brandAccentPicker').addEventListener('input', e => setBrandAccent(e.target.value));
$('brandAccentHex').addEventListener('input', e => {
  const v = e.target.value.trim();
  const hex = v.startsWith('#') ? v : '#' + v;
  if (/^#[0-9a-f]{6}$/i.test(hex)) setBrandAccent(hex);
  else if (!v) setBrandAccent('');
});
$('brandAccentHex').addEventListener('blur', () => { $('brandAccentHex').value = brandAccent; });
$('brandAccentReset').addEventListener('click', () => setBrandAccent(''));
// Eyedropper: click a spot on the logo to use its color
$('brandCanvas').addEventListener('click', e => {
  const canvas = e.currentTarget, rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((e.clientY - rect.top) * canvas.height / rect.height);
  let px;
  try { px = canvas.getContext('2d').getImageData(x, y, 1, 1).data; } catch (_) { return; }
  if (px[3] < 128) { $('brandPickHint').textContent = 'That spot is transparent. Click on the logo itself.'; return; }
  $('brandPickHint').textContent = 'Click anywhere on your logo to use that color as the accent.';
  setBrandAccent(toHex(px[0], px[1], px[2]));
});

// ── Utility ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Init ──────────────────────────────────────────────────────────────────

// ── OSC Log ───────────────────────────────────────────────────────────────
// Live view of raw OSC traffic between JPMixer and the console. Lines are
// built with textContent (never innerHTML) since address/args/source come
// straight off the wire and must be treated as untrusted text.

const OSCLOG_MAX_LINES = 500;
let oscLogPaused  = false;
let oscLogFilter  = '';
let oscLogLastSeq = 0;

function formatOscArgs(args) {
  if (!args || args.length === 0) return '';
  return args.map(a => {
    if (typeof a === 'number') return Number.isInteger(a) ? String(a) : a.toFixed(3);
    return JSON.stringify(a);
  }).join(', ');
}

function buildOscLogLine(entry) {
  const d = new Date(entry.t);
  const time = d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(entry.t % 1000).padStart(3, '0');
  const argsText = formatOscArgs(entry.args);

  const line = document.createElement('div');
  line.className = 'osclog-line';
  line.dataset.filterText = `${entry.address} ${argsText}`.toLowerCase();

  const timeEl = document.createElement('span');
  timeEl.className = 'osclog-time';
  timeEl.textContent = `[${time}] `;

  const dirEl = document.createElement('span');
  dirEl.className = entry.dir === 'in' ? 'osclog-dir-in' : 'osclog-dir-out';
  dirEl.textContent = entry.dir === 'in' ? '← ' : '→ ';

  const addrEl = document.createElement('span');
  addrEl.className = 'osclog-addr';
  addrEl.textContent = entry.address + ' ';

  const argsEl = document.createElement('span');
  argsEl.className = 'osclog-args';
  argsEl.textContent = argsText;

  line.append(timeEl, dirEl, addrEl, argsEl);

  if (entry.source && entry.source !== 'desk') {
    const srcEl = document.createElement('span');
    srcEl.className = 'osclog-source';
    srcEl.textContent = `  (${entry.source})`;
    line.appendChild(srcEl);
  }

  if (oscLogFilter && !line.dataset.filterText.includes(oscLogFilter)) {
    line.classList.add('filtered-out');
  }

  return line;
}

function appendOscLogEntries(entries) {
  const terminal = $('oscLogTerminal');
  if (!terminal || !entries || entries.length === 0) return;

  // Drop anything already rendered (the initial history fetch and the first
  // live batch can briefly overlap by a few entries around the seam).
  const fresh = entries.filter(e => e.seq === undefined || e.seq > oscLogLastSeq);
  if (fresh.length === 0) return;
  for (const e of fresh) if (e.seq > oscLogLastSeq) oscLogLastSeq = e.seq;

  const empty = terminal.querySelector('.osclog-empty');
  if (empty) empty.remove();

  const wasAtBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 30;

  const frag = document.createDocumentFragment();
  for (const entry of fresh) frag.appendChild(buildOscLogLine(entry));
  terminal.appendChild(frag);

  while (terminal.children.length > OSCLOG_MAX_LINES) {
    terminal.removeChild(terminal.firstChild);
  }

  if (wasAtBottom) terminal.scrollTop = terminal.scrollHeight;
}

function applyOscLogFilter() {
  const terminal = $('oscLogTerminal');
  if (!terminal) return;
  for (const line of terminal.querySelectorAll('.osclog-line')) {
    line.classList.toggle('filtered-out', !!oscLogFilter && !line.dataset.filterText.includes(oscLogFilter));
  }
}

// ── OSC Log recording — writes every message to a text file, independent of
// the terminal's own Pause/Clear (those are display-only) ─────────────────

let oscLogRecordActive     = false;
let oscLogRecordCountLocal = 0;
let oscLogRecordFileName   = '';

function updateOscLogRecordUI() {
  const btn = $('oscLogRecordBtn');
  if (oscLogRecordActive) {
    btn.textContent = 'Stop Logging';
    btn.className   = 'btn btn-sm stop';
    $('oscLogRecordStatus').textContent = `Recording to ${oscLogRecordFileName} — ${oscLogRecordCountLocal} lines`;
  } else {
    btn.textContent = 'Start Logging';
    btn.className   = 'btn btn-sm btn-primary';
  }
}

async function refreshOscLogRecordStatus() {
  const status = await window.jpm.getOscLogRecordingStatus();
  oscLogRecordActive     = !!status.recording;
  oscLogRecordCountLocal = status.count || 0;
  oscLogRecordFileName   = status.filePath ? status.filePath.split(/[\\/]/).pop() : '';
  updateOscLogRecordUI();
}

$('oscLogRecordBtn').addEventListener('click', async () => {
  const btn = $('oscLogRecordBtn');
  btn.disabled = true;
  if (oscLogRecordActive) {
    const result = await window.jpm.stopOscLogRecording();
    oscLogRecordActive = false;
    if (result.filePath) {
      $('oscLogRecordStatus').textContent = `Saved: ${result.filePath.split(/[\\/]/).pop()} (${result.count} lines)`;
    }
  } else {
    const result = await window.jpm.startOscLogRecording();
    if (result.ok) {
      oscLogRecordActive     = true;
      oscLogRecordCountLocal = 0;
      oscLogRecordFileName   = result.filePath.split(/[\\/]/).pop();
    } else {
      $('oscLogRecordStatus').textContent = `✕ ${result.error || 'Failed to start logging.'}`;
    }
  }
  updateOscLogRecordUI();
  btn.disabled = false;
});

$('oscLogShowFolderBtn').addEventListener('click', () => {
  window.jpm.openOscLogsFolder();
});

async function initOscLog() {
  const terminal = $('oscLogTerminal');
  if (!terminal) return;
  const history = await window.jpm.getOscLog();
  if (history && history.length) {
    appendOscLogEntries(history.slice(-OSCLOG_MAX_LINES));
  } else {
    terminal.innerHTML = '<div class="osclog-empty">No OSC traffic yet — waiting for the console…</div>';
  }
  window.jpm.onOscTraffic(batch => {
    if (!oscLogPaused) appendOscLogEntries(batch);
    if (oscLogRecordActive) {
      oscLogRecordCountLocal += batch.length;
      updateOscLogRecordUI();
    }
  });
  await refreshOscLogRecordStatus();
}

$('oscLogFilter').addEventListener('input', e => {
  oscLogFilter = e.target.value.trim().toLowerCase();
  applyOscLogFilter();
});

$('oscLogPauseBtn').addEventListener('click', () => {
  oscLogPaused = !oscLogPaused;
  $('oscLogPauseBtn').textContent = oscLogPaused ? 'Resume' : 'Pause';
  $('oscLogPauseBtn').classList.toggle('active', oscLogPaused);
});

$('oscLogClearBtn').addEventListener('click', () => {
  $('oscLogTerminal').innerHTML = '<div class="osclog-empty">Cleared.</div>';
});

async function init() {
  const [cfg, status, ip, names, anames, consoleStatus, version] = await Promise.all([
    window.jpm.getConfig(),
    window.jpm.getStatus(),
    window.jpm.getLocalIP(),
    window.jpm.getChannelNames(),
    window.jpm.getAuxNames(),
    window.jpm.getConsoleStatus(),
    window.jpm.getVersion(),
  ]);
  const vEl = document.querySelector('.version');
  if (vEl && version) vEl.textContent = `v${version}`;
  localIP      = ip;
  consoleNames = names  || {};
  auxNames     = anames || {};
  $('localIp').textContent = ip || 'Not found';
  // The Mac's address changes with the network (a VPN, another Wi-Fi). This
  // window used to read it once when it opened, and relaunching JPMixer just
  // brings the open window back, so it kept showing the old address.
  const refreshLocalIP = async () => {
    let next;
    try { next = await window.jpm.getLocalIP(); } catch (_) { return; }
    if (next === localIP) return;
    localIP = next;
    $('localIp').textContent = next || 'Not found';
    setStatus(isRunning); // rebuilds every link that shows the address
  };
  window.addEventListener('focus', refreshLocalIP);
  setInterval(refreshLocalIP, 15000);
  applyConfig(cfg);
  initPcoAutoSelect(); // fire-and-forget — a PCO round trip shouldn't block the rest of window init
  await syncLiveCounts();
  renderChannels();
  renderAuxes();
  setStatus(status.running);
  setConsoleStatus(consoleStatus.connected);
  window.jpm.onStatus(({ running }) => setStatus(running));
  window.jpm.onConsoleStatus(({ connected }) => setConsoleStatus(connected));

  const countData = await window.jpm.getConnectionCount();
  setDeviceCount(countData.count);
  window.jpm.onConnectionCount(({ count }) => setDeviceCount(count));

  refreshAutoBackupInfo();
  refreshPort80Status();
  initOscLog();
}

init();
