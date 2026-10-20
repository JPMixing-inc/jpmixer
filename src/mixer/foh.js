'use strict';

// FOH Home, and the ProPresenter / Lighting / Switcher pages (role.html),
// which show the same schedule for their own scheduled operator.
const ROLE = (location.pathname.match(/\/(propresenter|lighting|switcher)\.html$/) || [])[1] || 'foh';
const ROLE_LABELS = { foh: 'FOH Engineer', propresenter: 'ProPresenter', lighting: 'Lighting', switcher: 'Switcher' };
let roleLabel = ROLE_LABELS[ROLE];
const DATA_URL = ROLE === 'foh' ? '/foh-data' : `/role-data?role=${ROLE}`;
if (ROLE !== 'foh') {
  const page = `${roleLabel} Home`;
  document.title = `${page} — JPMixer`;
  for (const el of document.querySelectorAll('[data-role-page]')) el.textContent = page.toUpperCase();
}

let refreshing = false;
let lastSuccess = null;
let lastEngineerKey = '';
const REFRESH_MS = 120000; // 2 min — same cadence as greenroom.js

function initials(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function showEngineer(engineer) {
  window.fohChatIdentity = { role: ROLE, label: roleLabel, name: engineer ? engineer.name : '' }; // for the Team chat card
  const key = JSON.stringify(engineer);
  if (key === lastEngineerKey) return; // don't reload the portrait / retrigger layout every refresh
  lastEngineerKey = key;

  const wrap = document.querySelector('.fh-photo-wrap');
  wrap.innerHTML = '';
  if (engineer && engineer.photoUrl) {
    const img = document.createElement('img');
    img.className = 'fh-photo';
    img.src = engineer.photoUrl;
    img.alt = engineer.name;
    img.onerror = () => {
      const fallback = document.createElement('div');
      fallback.className = 'fh-photo-fallback';
      fallback.textContent = initials(engineer.name);
      img.replaceWith(fallback);
    };
    wrap.appendChild(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'fh-photo-fallback';
    if (engineer) fallback.textContent = initials(engineer.name);
    else {
      const logo = document.createElement('img');
      logo.className = 'jp-fallback-logo';
      logo.src = 'brand/jp-monogram.svg';
      logo.alt = 'JPMixer';
      logo.width = 64; logo.height = 32;
      fallback.appendChild(logo);
    }
    wrap.appendChild(fallback);
  }

  document.getElementById('fhWelcomeName').textContent = engineer ? `Welcome, ${engineer.name}` : roleLabel;
}

let lastRosterKey = '';
let lastOrderKey = '';

function showRoster(roster) {
  const body = document.getElementById('fhRoster');
  body.removeAttribute('aria-busy');
  const key = JSON.stringify(roster);
  if (key === lastRosterKey) return;
  lastRosterKey = key;
  if (!roster || roster.length === 0) {
    body.innerHTML = '';
    body.dataset.empty = 'No one scheduled yet.';
    return;
  }
  delete body.dataset.empty;
  body.innerHTML = '';
  for (const m of roster) {
    const row = document.createElement('div');
    row.className = 'fh-roster-row';
    const photo = document.createElement(m.photoUrl ? 'img' : 'div');
    if (m.photoUrl) {
      photo.className = 'fh-roster-photo';
      photo.src = m.photoUrl;
      photo.alt = m.name;
      photo.onerror = () => { photo.replaceWith(rosterFallback(m.name)); };
    } else {
      photo.className = 'fh-roster-photo-fallback';
      photo.textContent = initials(m.name);
    }
    row.appendChild(photo);
    const details = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'fh-roster-name';
    name.textContent = m.name;
    const position = document.createElement('div');
    position.className = 'fh-roster-position';
    position.textContent = m.position;
    details.append(name, position);
    row.appendChild(details);
    body.appendChild(row);
  }
}

function rosterFallback(name) {
  const fallback = document.createElement('div');
  fallback.className = 'fh-roster-photo-fallback';
  fallback.textContent = initials(name);
  return fallback;
}

function formatLength(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Shared by the Order of Service rows and the Live card's Previous/Now
// Live/Next rows — title + key/length meta + description, the same shape
// for either context.
function appendItemContent(container, it) {
  const titleRow = document.createElement('div');
  titleRow.className = 'fh-order-title-row';
  const title = document.createElement('span');
  title.className = 'fh-order-title';
  title.textContent = it.title || '(untitled)';
  titleRow.appendChild(title);
  const metaParts = [it.keyName ? `Key ${it.keyName}` : '', formatLength(it.length)].filter(Boolean);
  if (metaParts.length) {
    const meta = document.createElement('span');
    meta.className = 'fh-order-meta';
    meta.textContent = metaParts.join(' · ');
    titleRow.appendChild(meta);
  }
  container.appendChild(titleRow);
  if (it.description) {
    const desc = document.createElement('div');
    desc.className = 'fh-order-desc';
    desc.textContent = it.description;
    container.appendChild(desc);
  }
}

function showOrder(order) {
  const body = document.getElementById('fhOrder');
  body.removeAttribute('aria-busy');
  const key = JSON.stringify(order);
  if (key === lastOrderKey) return;
  lastOrderKey = key;
  if (!order || order.length === 0) {
    body.innerHTML = '';
    body.dataset.empty = 'No order of service yet.';
    return;
  }
  delete body.dataset.empty;
  body.innerHTML = '';
  for (const it of order) {
    const row = document.createElement('div');
    row.className = 'fh-order-row';
    row.dataset.type = it.type;
    row.dataset.live = String(!!it.live);
    if (it.type === 'header') {
      row.textContent = it.title || '';
    } else {
      appendItemContent(row, it);
    }
    body.appendChild(row);
  }
}

let lastLiveCardKey = '';

function showLiveCard(previousItem, liveItem, nextItem) {
  const body = document.getElementById('fhLiveCard');
  body.removeAttribute('aria-busy');
  const key = JSON.stringify([previousItem, liveItem, nextItem]);
  if (key === lastLiveCardKey) return;
  lastLiveCardKey = key;
  body.innerHTML = '';
  if (!liveItem) {
    body.dataset.empty = 'Nothing live right now.';
    return;
  }
  delete body.dataset.empty;
  const rows = [
    { label: 'PREVIOUS', item: previousItem, current: false },
    { label: 'NOW LIVE', item: liveItem, current: true },
    { label: 'NEXT', item: nextItem, current: false },
  ];
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'fh-live-card-row';
    row.dataset.current = String(r.current);
    const label = document.createElement('div');
    label.className = 'fh-live-card-label';
    label.textContent = r.label;
    row.appendChild(label);
    if (r.item) {
      appendItemContent(row, r.item);
    } else {
      const none = document.createElement('div');
      none.className = 'fh-order-desc';
      none.textContent = '—';
      row.appendChild(none);
    }
    body.appendChild(row);
  }
}

function showLiveItem(liveItem) {
  const badge = document.getElementById('fhLiveBadge');
  if (!liveItem) { badge.hidden = true; return; }
  document.getElementById('fhLiveTitle').textContent = liveItem.title || '(untitled)';
  badge.hidden = false;
}

function showConnection(consoleConnected, connectionCount) {
  const consoleBadge = document.getElementById('fhConsoleBadge');
  if (!consoleBadge) return; // only FOH Home shows the console and devices
  consoleBadge.dataset.state = consoleConnected ? 'on' : 'off';
  consoleBadge.textContent = `Console: ${consoleConnected ? 'Connected' : 'Disconnected'}`;
  const deviceBadge = document.getElementById('fhDeviceBadge');
  deviceBadge.dataset.state = connectionCount > 0 ? 'on' : 'off';
  deviceBadge.textContent = `${connectionCount} device${connectionCount === 1 ? '' : 's'}`;
}

function planDateLabel(value) {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function setStatus(state, text) {
  const status = document.getElementById('fhStatus');
  status.dataset.state = state;
  status.textContent = text;
}

function showNotice(message) {
  const notice = document.getElementById('fhNotice');
  if (!message) { notice.hidden = true; return; }
  notice.textContent = message;
  notice.hidden = false;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const button = document.getElementById('fhRefresh');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  setStatus('loading', lastSuccess ? 'Refreshing…' : 'Loading…');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(DATA_URL, { signal: controller.signal, cache: 'no-store' });
    if (response.status === 401) { showLock(true); setStatus('locked', 'Locked'); return; }
    if (!response.ok) throw new Error('Can’t reach JPMixer right now. Check the connection.');
    showLock(false);
    const data = await response.json();
    if (data.role && data.role.label) roleLabel = data.role.label;
    showConnection(data.consoleConnected, data.connectionCount || 0);
    if (!data.ok) {
      showEngineer(null);
      useLayoutFor(null);
      showNotice(data.error || 'The schedule could not be loaded.');
      document.getElementById('fhPlanLine').textContent = '';
      showRoster([]);
      showOrder([]);
      showLiveItem(null);
      showLiveCard(null, null, null);
    } else {
      showEngineer(data.engineer);
      useLayoutFor(data.engineer);
      document.getElementById('fhPlanLine').textContent = data.plan
        ? [data.plan.title, planDateLabel(data.plan.date)].filter(Boolean).join(' — ')
        : '';
      showNotice(data.plan && !data.engineer ? `Nobody matched the configured ${roleLabel} position for this service yet.` : '');
      document.getElementById('fhRosterHeading').textContent = data.rosterTeamName || 'Team';
      showRoster(data.roster || []);
      showOrder(data.order || []);
      showLiveItem(data.liveItem || null);
      showLiveCard(data.previousItem || null, data.liveItem || null, data.nextItem || null);
    }
    lastSuccess = new Date();
    setStatus('ready', 'Updated ' + lastSuccess.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  } catch (_) {
    setStatus('error', lastSuccess ? 'Showing last update' : 'Schedule unavailable');
    if (!lastSuccess) showEngineer(null);
  } finally {
    clearTimeout(timeout);
    refreshing = false;
    button.disabled = false;
    button.textContent = 'Refresh';
    globalThis.jpmSplash?.done(); // also when locked or offline: the page says why
  }
}

// FOH Home's access code. The server holds the schedule back until the
// right code sets its cookie (see src/server/foh.js).
function showLock(locked) {
  const lock = document.getElementById('fhLock');
  if (!lock) return;
  const wasLocked = !lock.hidden;
  lock.hidden = !locked;
  document.body.classList.toggle('fh-locked', locked);
  if (locked && !wasLocked) setTimeout(() => document.getElementById('fhLockCode').focus(), 50);
}
document.getElementById('fhLockForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('fhLockCode');
  const error = document.getElementById('fhLockError');
  const button = document.getElementById('fhLockSubmit');
  button.disabled = true;
  error.textContent = '';
  try {
    const res = await fetch('/foh-unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: input.value }), cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) { error.textContent = data.error || 'That code isn’t right.'; input.select(); return; }
    input.value = '';
    await refresh();
  } catch (_) {
    error.textContent = 'Can’t reach JPMixer right now. Check the connection.';
  } finally {
    button.disabled = false;
  }
});

// ── Saved layout for the scheduled team member ──
// Save layout stores this arrangement on the JPMixer computer for whoever is
// scheduled on this page; when they open it on any device, theirs loads.
let layoutPerson = null; // { personId, name } scheduled on this page
let layoutLoadedFor = null;
async function useLayoutFor(engineer) {
  const btn = document.getElementById('fhLayoutSave');
  layoutPerson = engineer && engineer.personId ? { personId: engineer.personId, name: engineer.name } : null;
  if (btn) {
    btn.disabled = !layoutPerson;
    btn.textContent = layoutPerson ? `Save for ${layoutPerson.name.split(/\s+/)[0]}` : 'Save layout';
    btn.title = layoutPerson ? `Saves this arrangement for ${layoutPerson.name}. It loads on any device they open this page on.` : 'Nobody is scheduled on this page right now';
  }
  if (!layoutPerson || layoutLoadedFor === layoutPerson.personId || !window.fohLayout) return;
  layoutLoadedFor = layoutPerson.personId;
  try {
    const res = await fetch(`/home-layout?role=${ROLE}&person=${encodeURIComponent(layoutPerson.personId)}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok && data.layout && window.fohLayout.load(data.layout)) {
      window.fohLayout.setStatus(data.fromPage
        ? `Showing ${layoutPerson.name}’s layout from ${data.fromPage}. Save to keep one for this page.`
        : `Showing ${layoutPerson.name}’s saved layout.`);
    }
  } catch (_) {}
}
document.getElementById('fhLayoutSave')?.addEventListener('click', async () => {
  if (!layoutPerson || !window.fohLayout) return;
  const btn = document.getElementById('fhLayoutSave');
  btn.disabled = true;
  try {
    const res = await fetch('/home-layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ role: ROLE, personId: layoutPerson.personId, layout: window.fohLayout.snapshot() }) });
    const data = await res.json().catch(() => ({}));
    window.fohLayout.setStatus(data.ok ? `Saved for ${data.name}. It loads on any device they open this page on.` : (data.error || 'Couldn’t save the layout. Try again.'));
  } catch (_) {
    window.fohLayout.setStatus('Can’t reach JPMixer right now. The layout is still saved in this browser.');
  } finally {
    btn.disabled = !layoutPerson;
  }
});

document.getElementById('fhRefresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, REFRESH_MS);
