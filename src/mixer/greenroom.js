'use strict';

const REFRESH_MS = 120000; // 2 min — this page is meant to sit unattended on a green-room iPad/TV

function initials(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function buildCard(member) {
  const card = document.createElement('div');
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

  const name = document.createElement('div');
  name.className = 'gr-name';
  name.textContent = member.name;
  card.appendChild(name);

  const position = document.createElement('div');
  position.className = 'gr-position';
  position.textContent = member.position;
  card.appendChild(position);

  return card;
}

function showEmpty(message) {
  document.getElementById('grGrid').style.display = 'none';
  const empty = document.getElementById('grEmpty');
  empty.textContent = message;
  empty.style.display = 'flex';
}

function showGrid(members) {
  const grid = document.getElementById('grGrid');
  document.getElementById('grEmpty').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';
  members.forEach(m => grid.appendChild(buildCard(m)));
}

async function refresh() {
  let data;
  try {
    const res = await fetch('/greenroom-data');
    data = await res.json();
  } catch (_) {
    showEmpty('Can’t reach JPMixer right now.\nCheck the connection and this page will retry automatically.');
    return;
  }

  if (!data.ok) {
    showEmpty(data.error || 'Something went wrong loading the schedule.');
    return;
  }

  if (!data.plan) {
    showEmpty('No upcoming service found in Planning Center.');
    document.getElementById('grPlanTitle').textContent = 'Green Room';
    document.getElementById('grPlanDate').textContent = '';
    return;
  }

  document.getElementById('grPlanTitle').textContent = data.plan.title || 'Green Room';
  document.getElementById('grPlanDate').textContent = data.plan.date
    ? new Date(data.plan.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  if (!data.members || data.members.length === 0) {
    showEmpty('No one scheduled yet for this service.');
    return;
  }

  showGrid(data.members);
}

refresh();
setInterval(refresh, REFRESH_MS);
