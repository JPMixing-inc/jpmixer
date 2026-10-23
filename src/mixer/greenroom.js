'use strict';

let refreshing = false;
let lastRoster = '';
let lastSuccess = null;
let hasRoster = false;
const REFRESH_MS = 120000; // 2 min — this page is meant to sit unattended on a green-room iPad/TV
const LIVE_MS = 15000;      // the Now / Up next strip follows Planning Center Live more closely
const tvLayout = matchMedia('(orientation: landscape) and (min-width: 900px)');

// ── Fitting the team on one screen ──────────────────────────────────────
// On a TV the grid has a fixed box. Try every column count, keep the one
// that gives each card the most room (cards a little taller than wide), and
// size the photo and text from the card. The cards stay a bit smaller than
// that room, with wide gaps, centred, so the screen doesn't feel crowded; a
// small team doesn't get giant cards either. Phones scroll instead.
const CARD_SCALE = 0.88;    // of the room each card could have
const CARD_MAX_W = 0.2;     // of the screen's width
const GR_VARS = ['--gr-cols', '--gr-rows', '--gr-card-w', '--gr-card-h', '--gr-photo', '--gr-name', '--gr-pos'];
function fitGrid() {
  const grid = document.getElementById('grGrid');
  const count = grid.children.length;
  if (!tvLayout.matches || !count || grid.hidden) { for (const v of GR_VARS) grid.style.removeProperty(v); return; }
  const W = grid.clientWidth, H = grid.clientHeight;
  if (!W || !H) return;
  const gap = Math.round(innerHeight * 0.026);
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const w = (W - gap * (cols - 1)) / cols, h = (H - gap * (rows - 1)) / rows;
    // Room for a card about 0.85 as wide as it is tall; fewer empty cells win ties
    const size = Math.min(w, h * 0.85), empty = cols * rows - count;
    if (!best || size > best.size + 0.5 || (Math.abs(size - best.size) <= 0.5 && empty < best.empty)) best = { cols, rows, w, h, size, empty };
  }
  const cardW = Math.floor(Math.min(best.size * CARD_SCALE, innerWidth * CARD_MAX_W));
  const cardH = Math.floor(Math.min(best.h, cardW / 0.85));
  // Cards with more than one role, or a mic battery showing, need room for another line
  const manyRoles = [...grid.children].some(card => card.querySelectorAll('.gr-position').length > 1 || !card.querySelector('.gr-mics')?.hidden);
  const photo = Math.max(36, Math.min(cardW * 0.56, cardH * (manyRoles ? 0.38 : 0.46), innerHeight * 0.17));
  const name = Math.max(12, Math.min(photo * 0.2, cardW * 0.1, innerHeight * 0.03));
  grid.style.setProperty('--gr-gap', `${gap}px`);
  grid.style.setProperty('--gr-cols', best.cols);
  grid.style.setProperty('--gr-rows', best.rows);
  grid.style.setProperty('--gr-card-w', `${cardW}px`);
  grid.style.setProperty('--gr-card-h', `${cardH}px`);
  grid.style.setProperty('--gr-photo', `${Math.round(photo)}px`);
  grid.style.setProperty('--gr-name', `${name.toFixed(1)}px`);
  grid.style.setProperty('--gr-pos', `${Math.max(10, name * 0.62).toFixed(1)}px`);
}
new ResizeObserver(() => fitGrid()).observe(document.getElementById('grGrid'));
tvLayout.addEventListener('change', fitGrid);

// ── Clock ───────────────────────────────────────────────────────────────
function tick() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
  const ampm = parts.find(p => p.type === 'dayPeriod');
  document.getElementById('grTime').textContent = parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim();
  document.getElementById('grAmPm').textContent = ampm ? ampm.value : '';
  document.getElementById('grToday').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
tick();
setInterval(tick, 1000);

// ── Countdowns ──────────────────────────────────────────────────────────
// "Service starts in 12:34" before the next service time, and "2:14 left"
// on the live item (its length in Planning Center from when it went live).
// Both count on JPMixer's clock (serverTime), so a TV set to the wrong time
// still counts right. They tick here every second between checks.
const COUNTDOWN_WINDOW_MS = 12 * 60 * 60 * 1000;
let clockOffset = 0, liveState = null, nextServiceAt = null;
const serverNow = () => Date.now() + clockOffset;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function untilLabel(ms) {
  const sec = Math.ceil(ms / 1000);
  if (sec < 3600) return mmss(sec);
  const min = Math.floor(sec / 60);
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
function tickCountdowns() {
  const now = serverNow();
  const until = nextServiceAt ? nextServiceAt - now : NaN;
  const box = document.getElementById('grCountdown');
  const show = !liveState && until > 0 && until <= COUNTDOWN_WINDOW_MS;
  box.hidden = !show;
  if (show) document.getElementById('grCountdownTime').textContent = untilLabel(until);
  const left = document.getElementById('grNowLeft'), bar = document.getElementById('grNowProgress');
  const it = liveState && liveState.now, started = liveState && Date.parse(liveState.startedAt);
  left.hidden = bar.hidden = !(it && it.length > 0 && Number.isFinite(started));
  if (left.hidden) return;
  const remaining = Math.round((started + it.length * 1000 - now) / 1000);
  left.textContent = remaining >= 0 ? `${mmss(remaining)} left` : `${mmss(-remaining)} over`;
  left.classList.toggle('is-over', remaining < 0);
  // A bar along the bottom of the Now box fills as the item goes
  bar.classList.toggle('is-over', remaining < 0);
  bar.firstChild.style.width = `${(Math.max(0, Math.min(1, (now - started) / (it.length * 1000))) * 100).toFixed(2)}%`;
}
setInterval(tickCountdowns, 1000);

// ── Now / Up next, while Planning Center Live is running ────────────────
const clockLength = (sec) => (Number.isFinite(sec) && sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
const itemMeta = (it) => [it.keyName ? `Key ${it.keyName}` : '', clockLength(it.length)].filter(Boolean).join(' · ');
async function refreshLive() {
  try {
    const res = await fetch('/greenroom-live', { cache: 'no-store' });
    const data = await res.json();
    const live = data.ok ? data.live : null;
    const serverTime = Date.parse(data.serverTime);
    if (Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
    liveState = live;
    nextServiceAt = data.ok && data.nextServiceAt ? Date.parse(data.nextServiceAt) : null;
    tickCountdowns();
    const box = document.getElementById('grLive');
    const wasHidden = box.hidden;
    box.hidden = !live;
    if (live) {
      document.getElementById('grNowTitle').textContent = live.now.title || 'Untitled item';
      document.getElementById('grNowMeta').textContent = itemMeta(live.now);
      document.getElementById('grNextBox').hidden = !live.next;
      if (live.next) {
        document.getElementById('grNextTitle').textContent = live.next.title || 'Untitled item';
        document.getElementById('grNextMeta').textContent = itemMeta(live.next);
      }
    }
    if (wasHidden !== box.hidden) fitGrid(); // the strip takes room from the team
  } catch (_) { /* keep what's showing; try again shortly */ }
}
refreshLive();
setInterval(refreshLive, LIVE_MS);

function initials(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function buildCard(member) {
  const card = document.createElement('article');
  card.className = 'gr-card';

  if (member.photoUrl) {
    const img = document.createElement('img');
    img.className = 'gr-photo';
    img.src = member.photoUrl;
    img.alt = member.name;
    img.onerror = () => {
      // A broken/expired photo URL degrades to the initials fallback rather
      // than showing a broken-image icon on a screen nobody's actively
      // watching to notice.
      const fallback = document.createElement('div');
      fallback.className = 'gr-photo-fallback';
      fallback.textContent = initials(member.name);
      img.replaceWith(fallback);
    };
    card.appendChild(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'gr-photo-fallback';
    fallback.textContent = initials(member.name);
    card.appendChild(fallback);
  }

  const details = document.createElement('div');
  details.className = 'gr-member-details';
  const name = document.createElement('h3');
  name.className = 'gr-name';
  name.textContent = member.name;
  details.appendChild(name);

  // Everything they're serving as (one card per person; see greenroom.js on the server)
  const roles = document.createElement('div');
  roles.className = 'gr-positions';
  for (const role of member.positions || [member.position]) {
    const position = document.createElement('span');
    position.className = 'gr-position';
    position.textContent = role;
    roles.appendChild(position);
  }
  details.appendChild(roles);
  // Their mic's battery while it's on (fillMics); which mixes are theirs
  const mics = document.createElement('div');
  mics.className = 'gr-mics';
  mics.hidden = true;
  mics.dataset.auxes = (member.auxes || []).join(',');
  details.appendChild(mics);
  card.appendChild(details);

  return card;
}

// ── Mic batteries ───────────────────────────────────────────────────────
// Each person's wireless mic, by the mix their position is mapped to (Shure
// wireless gives each mic a mix), from /wireless-aux every 15 seconds. Only
// while the mic is on; nothing while it's off, and nothing at all when
// Settings → Pages → Green Room turns it off.
const MIC_STATE = { good: 'Good', replace: 'Replace', critical: 'Critical' };
let showMics = true, micMixes = {};
function micChip(mic, many) {
  const chip = document.createElement('span');
  chip.className = `gr-mic is-${mic.battState || 'on'}`;
  const bars = document.createElement('i');
  bars.className = 'gr-mic-bars';
  bars.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 5; i++) { const b = document.createElement('b'); if (mic.battBars !== null && i <= mic.battBars) b.className = 'on'; bars.appendChild(b); }
  const text = mic.battBars === null ? 'Mic on' : MIC_STATE[mic.battState] + (mic.runTimeMin !== null ? ` · ${mic.runTimeMin >= 60 ? `${Math.floor(mic.runTimeMin / 60)} h ${mic.runTimeMin % 60} m` : `${mic.runTimeMin} min`}` : '');
  const label = document.createElement('span');
  label.textContent = many ? `${mic.name} · ${text}` : text;
  chip.append(bars, label);
  chip.title = `${mic.name}: ${text}`;
  return chip;
}
function fillMics() {
  let changed = false;
  for (const box of document.querySelectorAll('#grGrid .gr-mics')) {
    const auxes = box.dataset.auxes ? box.dataset.auxes.split(',') : [];
    const on = showMics ? auxes.flatMap((aux) => micMixes[aux] || []).filter((m) => m.status === 'connected' && m.transmitter === 'on') : [];
    const key = JSON.stringify(on);
    if (box.dataset.micKey === key) continue;
    box.dataset.micKey = key;
    box.replaceChildren(...on.map((m) => micChip(m, on.length > 1)));
    if (box.hidden !== !on.length) { box.hidden = !on.length; changed = true; }
  }
  if (changed) fitGrid(); // a chip line takes room from the photo
}
async function loadMics() {
  try {
    const data = await (await fetch('/wireless-aux', { cache: 'no-store' })).json();
    micMixes = data.ok && data.enabled && data.mixes ? data.mixes : {};
  } catch (_) { /* keep what's showing */ }
  fillMics();
}
loadMics();
setInterval(loadMics, 15000);

function showEmpty(title, message) {
  document.getElementById('grGrid').hidden = true;
  document.getElementById('grEmptyTitle').textContent = title;
  document.getElementById('grEmptyMessage').textContent = message;
  document.getElementById('grEmpty').hidden = false;
  document.getElementById('grCount').hidden = true;
  hasRoster = false;
  lastRoster = '';
}

function showGrid(members) {
  const grid = document.getElementById('grGrid');
  document.getElementById('grEmpty').hidden = true;
  grid.hidden = false;
  // Avoid reloading portraits or interrupting a reader's scroll every refresh.
  const signature = JSON.stringify(members);
  if (signature !== lastRoster) {
    grid.replaceChildren(...members.map(buildCard));
    lastRoster = signature;
    fillMics();
  }
  fitGrid();
  document.getElementById('grMemberCount').textContent = members.length;
  document.getElementById('grCountLabel').textContent = members.length === 1 ? 'person scheduled' : 'people scheduled';
  document.getElementById('grCount').hidden = false;
  hasRoster = true;
}

function setStatus(state, text) {
  const status = document.getElementById('grStatus');
  status.dataset.state = state;
  status.textContent = text;
}

function showFailure(message) {
  setStatus('error', hasRoster ? 'Showing last update' : 'Schedule unavailable');
  if (hasRoster) {
    const notice = document.getElementById('grNotice');
    const time = lastSuccess.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    notice.textContent = `Showing the schedule from ${time}. ${message} Retrying automatically.`;
    notice.hidden = false;
  } else {
    showEmpty('Schedule unavailable', message + '\nThe screen will retry automatically.');
  }
}

function planDateLabel(value) {
  if (!value) return '';
  // A date-only service date belongs to its calendar day in every time zone.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const button = document.getElementById('grRefresh');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  document.getElementById('grGrid').setAttribute('aria-busy', 'true');
  setStatus('loading', lastSuccess ? 'Refreshing schedule…' : 'Loading schedule…');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/greenroom-data', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Can’t reach JPMixer right now. Check the connection.');
    const data = await response.json();
    if (!data.ok) { showFailure(data.error || 'The schedule could not be loaded.'); return; }
    document.getElementById('grNotice').hidden = true;
    document.getElementById('grPlanTitle').textContent = data.plan?.title || 'Green Room';
    document.getElementById('grPlanDate').textContent = planDateLabel(data.plan?.date);
    if (!data.plan) {
      showEmpty('No upcoming service', 'The next service and its team will appear here when available in Planning Center.');
    } else if (!data.members?.length) {
      showEmpty('The team is still coming together', 'No one is scheduled for this service yet. Check back soon.');
    } else {
      showMics = data.mics !== false;
      showGrid(data.members);
      fillMics();
    }
    lastSuccess = new Date();
    setStatus('ready', 'Updated ' + lastSuccess.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  } catch (_) {
    showFailure('Can’t reach JPMixer right now. Check the connection.');
  } finally {
    clearTimeout(timeout);
    refreshing = false;
    button.disabled = false;
    button.textContent = 'Refresh';
    document.getElementById('grGrid').setAttribute('aria-busy', 'false');
    globalThis.jpmSplash?.done();
  }
}

// ── Full screen ──
// A browser only goes full screen from a click or key press, never by
// itself, so on a TV the first press of the remote's OK button (or a click
// anywhere) does it, and again after the TV or Esc leaves full screen. A
// hint says so while the page isn't full screen. Clicking Exit fullscreen
// turns this off until the page is reloaded. In full screen
// the mouse pointer hides itself when it hasn't moved for a few seconds.
const fullscreenButton = document.getElementById('grFullscreen');
const fullscreenHint = document.getElementById('grFullscreenHint');
const root = document.documentElement;
const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
let autoFullscreen = canFullscreen;
async function enterFullscreen() {
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch (_) {
    autoFullscreen = false;
    fullscreenHint.hidden = true;
    setStatus('error', 'Fullscreen unavailable in this browser');
  }
}
async function exitFullscreen() {
  try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (_) {}
}
if (canFullscreen) fullscreenButton.hidden = false;
fullscreenButton.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isFullscreen()) { autoFullscreen = false; fullscreenHint.hidden = true; exitFullscreen(); } else enterFullscreen();
});
document.addEventListener('click', (e) => {
  if (autoFullscreen && !isFullscreen() && !e.target.closest('button, a')) enterFullscreen();
});
document.addEventListener('keydown', (e) => {
  if (!autoFullscreen || isFullscreen() || e.repeat || !['Enter', ' ', 'f', 'F'].includes(e.key)) return;
  if (e.target.closest && e.target.closest('button, a')) return; // OK on a focused button does that button
  e.preventDefault();
  enterFullscreen();
});
let idleTimer = null;
function wake() {
  document.body.classList.remove('gr-idle');
  clearTimeout(idleTimer);
  if (isFullscreen()) idleTimer = setTimeout(() => document.body.classList.add('gr-idle'), 3000);
}
for (const type of ['mousemove', 'pointerdown', 'keydown']) document.addEventListener(type, wake, { passive: true });
function onFullscreenChange() {
  const on = isFullscreen();
  fullscreenButton.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
  fullscreenHint.hidden = on || !autoFullscreen;
  wake();
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
fullscreenHint.hidden = !autoFullscreen;
// ── SPL from Smaart ──
// One reading beside the clock (Settings → Pages → Green Room), coloured by
// Smaart's own levels and marked when it's over Smaart's alarm. Asked for
// every second while it's on, every 15 seconds while it's off.
let splTimer = null;
async function loadSpl() {
  clearTimeout(splTimer);
  let on = false;
  try {
    const data = await (await fetch('/greenroom-spl', { cache: 'no-store' })).json();
    on = !!(data.ok && data.enabled);
    const box = document.getElementById('grSpl');
    const r = on ? data.reading : null;
    const wasHidden = box.hidden;
    box.hidden = !on;
    document.getElementById('grSplValue').textContent = r && Number.isFinite(r.value) ? r.value.toFixed(1) : '—';
    document.getElementById('grSplName').textContent = r ? r.name : '';
    document.getElementById('grSplInput').textContent = !r ? 'Waiting for Smaart' : r.stale ? 'No reading right now' : r.over ? 'Over the limit' : r.input;
    box.dataset.color = r && !r.stale ? r.color : '';
    box.classList.toggle('is-over', !!(r && r.over && !r.stale));
    box.classList.toggle('is-stale', !r || !!r.stale);
    if (wasHidden !== box.hidden) fitGrid();
  } catch (_) { /* keep what's showing */ }
  splTimer = setTimeout(loadSpl, on ? 1000 : 15000);
}
loadSpl();

// ── "Your mix" QR code ──
// Opens the aux picker on a phone that scans it (src/server/greenroom.js
// works out the address). Settings → Pages → Green Room turns it off.
let lastQr = '';
async function loadQr() {
  try {
    const res = await fetch('/greenroom-qr', { cache: 'no-store' });
    const data = await res.json();
    const show = !!(data.ok && data.enabled && data.url && data.svg);
    const box = document.getElementById('grQr');
    if (show && data.url !== lastQr) {
      document.getElementById('grQrCode').innerHTML = data.svg; // JPMixer's own SVG, built from the address
      document.getElementById('grQrUrl').textContent = data.url.replace(/^http:\/\//, '').replace(/\/$/, '');
      lastQr = data.url;
    }
    if (box.hidden === show) { box.hidden = !show; fitGrid(); }
  } catch (_) { /* keep what's showing */ }
}
loadQr();
setInterval(loadQr, REFRESH_MS);

document.getElementById('grRefresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, REFRESH_MS);

