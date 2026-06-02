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

const EMOJIS = [
  '🎤','🎙','🗣','👤','🎸','🪗','🥁','🪘','🎹','🎺','🎻','🎷',
  '🪕','🎵','🎶','🎼','🪈','🎧','🔊','📢','🎚','🎛','📻',
  '⭐','🌟','✨','🔥','💎','🎯','🏆','🥇',
  '🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪',
  '🌀','🌊','⚡','❄️','🌙','☀️','🌈','💫',
  '🔔','🔕','📣','🚨','⚠️','✅','❌','🔁',
];

function getInstrumentIconSrc(iconValue) {
  if (!instrumentIconPaths || !iconValue.startsWith('file:')) return '';
  const n = parseInt(iconValue.slice(5));
  if (!n) return '';
  const dir = n <= 70 ? instrumentIconPaths.dir1 : instrumentIconPaths.dir2;
  return `file://${dir}/${n}.svg`;
}

function renderIconHTML(icon) {
  if (!icon) return '+';
  if (icon.startsWith('img:')) {
    const key = icon.slice(4);
    const svg = CUSTOM_ICONS[key];
    return svg ? `<span class="custom-icon">${svg}</span>` : '+';
  }
  if (icon.startsWith('file:')) {
    const src = getInstrumentIconSrc(icon);
    return src ? `<img class="instrument-icon" src="${escHtml(src)}" width="18" height="18" />` : '+';
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
};

// ── State ─────────────────────────────────────────────────────────────────

let isRunning          = false;
let channelGroups      = [];   // [{ id, name, colour }]
let channelOverrides   = {};   // { "1": { label, icon, groupId, order, enabled } }
let channelOrder       = [];   // ordered list of channel numbers, e.g. [1, 3, 2, ...]
let consoleNames       = {};   // { "1": "KICK", "2": "SNARE", ... } from server cache
let auxOverrides       = {};   // { "1": { enabled } }
let auxNames           = {};   // { "1": "IEM L", ... } from server cache
let activeIconBtn      = null;
let dragSrcCh          = null;
let instrumentIconPaths = null; // { dir1, dir2 } absolute paths to SVG subfolders
let ipadConnections    = [];   // [{ id, name, enabled, ip, sendPort, listenPort }]

// ── Tabs ──────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'channels') {
      window.jpm.getChannelNames().then(names => {
        consoleNames = names || {};
        renderChannels();
      });
    }
    if (btn.dataset.tab === 'auxes') {
      window.jpm.getAuxNames().then(names => {
        auxNames = names || {};
        renderAuxes();
      });
    }
  });
});

// ── Auxes editor ──────────────────────────────────────────────────────────

function renderAuxes() {
  const list    = $('auxesList');
  list.innerHTML = '';
  const auxCount = parseInt($('auxes').value) || 16;

  for (let i = 1; i <= auxCount; i++) {
    const ov      = auxOverrides[String(i)] || {};
    const enabled = ov.enabled !== false;
    const colour  = ov.colour  || '#e8a020';
    const name    = auxNames[String(i)] || `AUX ${i}`;

    const row = document.createElement('div');
    row.className = 'ch-editor-row';
    row.dataset.aux = i;
    row.style.gridTemplateColumns = '28px 1fr 32px 28px';
    row.innerHTML = `
      <span class="ch-editor-num">${i}</span>
      <span class="aux-name-label">${escHtml(name)}</span>
      <input type="color" class="aux-colour colour-input" data-aux="${i}" value="${escHtml(colour)}" title="Button color" />
      <input type="checkbox" class="toggle aux-enabled" data-aux="${i}" ${enabled ? 'checked' : ''} />
    `;
    list.appendChild(row);
  }
}

$('auxesList').addEventListener('change', e => {
  const aux = e.target.dataset.aux;
  if (!aux) return;
  if (!auxOverrides[aux]) auxOverrides[aux] = {};
  if (e.target.classList.contains('aux-enabled')) {
    auxOverrides[aux].enabled = e.target.checked;
  } else if (e.target.classList.contains('aux-colour')) {
    auxOverrides[aux].colour = e.target.value;
  }
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
      <div class="ipad-row-fields">
        <div>
          <label>IP Address</label>
          <input type="text" class="ipad-ip ch-label-input" placeholder="192.168.1.x" value="${escHtml(conn.ip)}" data-id="${conn.id}" />
        </div>
        <div>
          <label>Send Port <span class="sub">(Mac→iPad)</span></label>
          <input type="number" class="ipad-send-port ch-label-input" min="1" max="65535" value="${conn.sendPort}" data-id="${conn.id}" />
        </div>
        <div>
          <label>Listen Port <span class="sub">(iPad→Mac)</span></label>
          <input type="number" class="ipad-listen-port ch-label-input" min="1" max="65535" value="${conn.listenPort}" data-id="${conn.id}" />
        </div>
      </div>
    `;
    list.appendChild(row);
  }
}

$('addIpadBtn').addEventListener('click', () => {
  ipadConnections.push({
    id:         Date.now(),
    name:       `iPad ${ipadConnections.length + 1}`,
    enabled:    true,
    ip:         '',
    sendPort:   9000,
    listenPort: 9001 + ipadConnections.length,
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
  if (e.target.classList.contains('ipad-listen-port'))conn.listenPort = parseInt(e.target.value) || 9001;
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
    list.innerHTML = '<div class="empty-hint">No groups yet — click + Add Group to create one.</div>';
    return;
  }

  for (const g of channelGroups) {
    const row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML = `
      <input type="color" class="colour-input" value="${g.colour}" data-id="${g.id}" />
      <input type="text" class="group-name-input" value="${escHtml(g.name)}" placeholder="Group name" data-id="${g.id}" />
      <button class="btn btn-sm btn-danger delete-group" data-id="${g.id}">Remove</button>
    `;
    list.appendChild(row);
  }
}

$('addGroupBtn').addEventListener('click', () => {
  const palette = ['#e84040','#e87030','#e8c030','#40b860','#3090e8','#6040d8','#c040b0','#e84080'];
  const used    = new Set(channelGroups.map(g => g.colour));
  const colour  = palette.find(c => !used.has(c)) || palette[channelGroups.length % palette.length];
  channelGroups.push({ id: Date.now(), name: 'New Group', colour });
  renderGroups();
  refreshGroupDropdowns();
});

$('groupsList').addEventListener('input', e => {
  const id = parseInt(e.target.dataset.id);
  const g  = channelGroups.find(g => g.id === id);
  if (!g) return;
  if (e.target.classList.contains('colour-input'))     { g.colour = e.target.value; refreshGroupDropdowns(); }
  if (e.target.classList.contains('group-name-input')) { g.name   = e.target.value; refreshGroupDropdowns(); }
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
    sel.innerHTML = `<option value="" ${!gid ? 'selected' : ''}>No group</option>${opts}`;
  });
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
      <button class="icon-btn${icon ? ' has-icon' : ''}" data-ch="${ch}" title="Choose icon">${renderIconHTML(icon)}</button>
      <input type="text" class="ch-label-input" value="${escHtml(ov.label || '')}"
             placeholder="${escHtml(consoleName || `Ch ${ch}`)}" data-ch="${ch}" />
      <select class="ch-group-select" data-ch="${ch}">
        <option value="" ${!ov.groupId ? 'selected' : ''}>No group</option>
        ${groupOpts}
      </select>
      <input type="checkbox" class="toggle ch-enabled" data-ch="${ch}" ${enabled ? 'checked' : ''} />
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
  if (e.target.classList.contains('ch-group-select')) ov.groupId = e.target.value ? parseInt(e.target.value) : null;
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

// Clear button
const clearCell = document.createElement('button');
clearCell.className = 'icon-cell icon-cell-clear';
clearCell.textContent = '✕';
clearCell.title = 'Clear icon';
iconGrid.appendChild(clearCell);

// Custom icon groups
for (const group of ICON_GROUPS) {
  const label = document.createElement('div');
  label.className = 'icon-group-label';
  label.textContent = group.label;
  iconGrid.appendChild(label);
  for (const key of group.keys) {
    const btn = document.createElement('button');
    btn.className = 'icon-cell icon-cell-custom';
    btn.dataset.iconKey = key;
    btn.title = ICON_LABELS[key] || key;
    btn.innerHTML = `<span class="custom-icon">${CUSTOM_ICONS[key]}</span>`;
    iconGrid.appendChild(btn);
  }
}

// Emoji section
const emojiLabel = document.createElement('div');
emojiLabel.className = 'icon-group-label';
emojiLabel.textContent = 'Emoji';
iconGrid.appendChild(emojiLabel);

for (const ic of EMOJIS) {
  const btn = document.createElement('button');
  btn.className = 'icon-cell';
  btn.dataset.emoji = ic;
  btn.textContent = ic;
  iconGrid.appendChild(btn);
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
  } else if (cell.dataset.iconKey) {
    const key = cell.dataset.iconKey;
    ov.icon = 'img:' + key;
    activeIconBtn.innerHTML = renderIconHTML('img:' + key);
    activeIconBtn.classList.add('has-icon');
  } else if (cell.dataset.iconNum) {
    const num = cell.dataset.iconNum;
    ov.icon = 'file:' + num;
    activeIconBtn.innerHTML = renderIconHTML('file:' + num);
    activeIconBtn.classList.add('has-icon');
  } else {
    const emoji = cell.dataset.emoji || cell.textContent;
    ov.icon = emoji;
    activeIconBtn.innerHTML = emoji;
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

function buildInstrumentIconsSection() {
  if (!instrumentIconPaths) return;
  const label = document.createElement('div');
  label.className = 'icon-group-label';
  label.textContent = 'Instrument Library';
  iconGrid.appendChild(label);
  for (let n = 1; n <= 120; n++) {
    const dir = n <= 70 ? instrumentIconPaths.dir1 : instrumentIconPaths.dir2;
    const src = `file://${dir}/${n}.svg`;
    const btn = document.createElement('button');
    btn.className = 'icon-cell icon-cell-instrument';
    btn.dataset.iconNum = String(n);
    btn.title = `Instrument ${n}`;
    btn.innerHTML = `<img class="instrument-icon" src="${escHtml(src)}" width="24" height="24" />`;
    iconGrid.appendChild(btn);
  }
}

function openIconPicker(btn) {
  activeIconBtn = btn;
  iconPickerEl.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  const pw   = 7 * 35 + 16; // ~261px picker width
  let top    = rect.bottom + 6;
  let left   = rect.left;
  if (left + pw > window.innerWidth)  left = window.innerWidth  - pw - 8;
  if (top  + 420 > window.innerHeight) top = rect.top - 426;
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
  $('sceneRecallEnabled').checked = !!cfg.sceneRecallEnabled;
  ipadConnections = Array.isArray(cfg.ipadConnections) ? cfg.ipadConnections : [];
  renderIpadConnections();

  channelGroups    = Array.isArray(cfg.channelGroups) ? cfg.channelGroups : [];
  channelOverrides = (cfg.channelOverrides && typeof cfg.channelOverrides === 'object')
    ? cfg.channelOverrides : {};
  auxOverrides     = (cfg.auxOverrides && typeof cfg.auxOverrides === 'object')
    ? cfg.auxOverrides : {};

  initChannelOrder();
  renderGroups();
  renderChannels();
  renderAuxes();
}

function collectConfig() {
  const out = {};
  for (const { el, key, parse } of Object.values(fields)) {
    out[key] = parse(el.value);
  }
  out.autoStart           = $('autoStart').checked;
  out.sceneRecallEnabled  = $('sceneRecallEnabled').checked;
  out.ipadConnections     = ipadConnections;
  out.channelGroups    = channelGroups;
  saveChannelOrder();
  out.channelOverrides = channelOverrides;
  out.auxOverrides     = auxOverrides;
  return out;
}

// ── Status ────────────────────────────────────────────────────────────────

let localIP = null;

function setConsoleStatus(connected) {
  $('consoleDot').className      = 'dot' + (connected ? ' on' : '');
  $('consolePillLabel').textContent  = connected ? 'Connected' : 'Offline';
  $('consoleStatusLabel').textContent = connected
    ? 'Connected to console'
    : 'Not connected';
}

function setDeviceCount(count) {
  const el = $('deviceCount');
  el.style.display = count > 0 ? '' : 'none';
  $('deviceCountLabel').textContent = count === 1 ? '1 device' : `${count} devices`;
}

function setStatus(running) {
  isRunning = running;
  $('statusDot').className = 'dot' + (running ? ' on' : '');
  $('statusLabel').textContent = running ? 'Running' : 'Stopped';
  const port = Number($('serverPort').value);
  const base = running
    ? (localIP ? `http://${localIP}:${port}` : `http://localhost:${port}`)
    : null;
  $('serverUrl').textContent = base || 'Not running';
  $('monitorUrl').textContent  = base ? `${base}/monitor.html`  : '— (server not running)';
  $('consoleUrl').textContent  = base ? `${base}/console.html`  : '— (server not running)';
  $('monitorBtnHint').style.display = running ? 'none' : '';
  $('consoleBtnHint').style.display = running ? 'none' : '';
  const btn = $('toggleBtn');
  btn.textContent = running ? 'Stop' : 'Start';
  btn.className   = running ? 'btn stop' : 'btn';
}


$('openMonitorBtn').addEventListener('click', async () => {
  const result = await window.jpm.openMonitor();
  if (result && result.error) alert('Start the server first, then open the monitor view.');
});

$('openConsoleBtn').addEventListener('click', async () => {
  const result = await window.jpm.openConsole();
  if (result && result.error) alert('Start the server first, then open the console view.');
});

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
  } else {
    status.className   = 'ip-status err';
    status.textContent = '✕ Failed — run as administrator';
  }
});

$('saveBtn').addEventListener('click', async () => {
  $('saveBtn').textContent = 'Saving…';
  $('saveBtn').disabled    = true;
  await window.jpm.saveConfig(collectConfig());
  $('saveBtn').textContent = 'Saved!';
  setTimeout(() => {
    $('saveBtn').textContent = 'Save & Apply';
    $('saveBtn').disabled    = false;
  }, 1500);
});

// ── Utility ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const [cfg, status, ip, names, anames, consoleStatus, iconPaths, version] = await Promise.all([
    window.jpm.getConfig(),
    window.jpm.getStatus(),
    window.jpm.getLocalIP(),
    window.jpm.getChannelNames(),
    window.jpm.getAuxNames(),
    window.jpm.getConsoleStatus(),
    window.jpm.getInstrumentIconPaths(),
    window.jpm.getVersion(),
  ]);
  const vEl = document.querySelector('.version');
  if (vEl && version) vEl.textContent = `v${version}`;
  localIP      = ip;
  consoleNames = names  || {};
  auxNames     = anames || {};
  instrumentIconPaths = iconPaths;
  buildInstrumentIconsSection();
  $('localIp').textContent = ip || 'Not found';
  applyConfig(cfg);
  setStatus(status.running);
  setConsoleStatus(consoleStatus.connected);
  window.jpm.onStatus(({ running }) => setStatus(running));
  window.jpm.onConsoleStatus(({ connected }) => setConsoleStatus(connected));

  const countData = await window.jpm.getConnectionCount();
  setDeviceCount(countData.count);
  window.jpm.onConnectionCount(({ count }) => setDeviceCount(count));
}

init();
