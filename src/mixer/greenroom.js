'use strict';

let refreshing = false;
let lastRoster = '';
let lastSuccess = null;
let hasRoster = false;
const REFRESH_MS = 120000; // 2 min — this page is meant to sit unattended on a green-room iPad/TV

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

  const position = document.createElement('div');
  position.className = 'gr-position';
  position.textContent = member.position;
  details.appendChild(position);
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
