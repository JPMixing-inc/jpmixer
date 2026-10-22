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
// size the photo and text from the card. Phones scroll instead.
function fitGrid() {
  const grid = document.getElementById('grGrid');
  const count = grid.children.length;
  if (!tvLayout.matches || !count || grid.hidden) { grid.style.removeProperty('--gr-cols'); grid.style.removeProperty('--gr-rows'); grid.style.removeProperty('--gr-photo'); grid.style.removeProperty('--gr-name'); grid.style.removeProperty('--gr-pos'); return; }
  const W = grid.clientWidth, H = grid.clientHeight;
  if (!W || !H) return;
  const gap = Math.round(innerHeight * 0.016);
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const w = (W - gap * (cols - 1)) / cols, h = (H - gap * (rows - 1)) / rows;
    // Room for a card about 0.85 as wide as it is tall; fewer empty cells win ties
    const size = Math.min(w, h * 0.85), empty = cols * rows - count;
    if (!best || size > best.size + 0.5 || (Math.abs(size - best.size) <= 0.5 && empty < best.empty)) best = { cols, rows, w, h, size, empty };
  }
  // Cards with more than one role need room for a second line of labels
  const manyRoles = [...grid.children].some(card => card.querySelectorAll('.gr-position').length > 1);
  const photo = Math.max(36, Math.min(best.w * 0.62, best.h * (manyRoles ? 0.4 : 0.5), innerHeight * 0.2));
  const name = Math.max(12, Math.min(photo * 0.2, best.w * 0.1, innerHeight * 0.032));
  grid.style.setProperty('--gr-gap', `${gap}px`);
  grid.style.setProperty('--gr-cols', best.cols);
  grid.style.setProperty('--gr-rows', best.rows);
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

// ── Now / Up next, while Planning Center Live is running ────────────────
const clockLength = (sec) => (Number.isFinite(sec) && sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
const itemMeta = (it) => [it.keyName ? `Key ${it.keyName}` : '', clockLength(it.length)].filter(Boolean).join(' · ');
async function refreshLive() {
  try {
    const res = await fetch('/greenroom-live', { cache: 'no-store' });
    const data = await res.json();
    const live = data.ok ? data.live : null;
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
  card.appendChild(details);

  return card;
}

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
      showGrid(data.members);
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

const fullscreenButton = document.getElementById('grFullscreen');
if (document.fullscreenEnabled) fullscreenButton.hidden = false;
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (_) {
    setStatus('error', 'Fullscreen unavailable in this browser');
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});
document.getElementById('grRefresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, REFRESH_MS);
