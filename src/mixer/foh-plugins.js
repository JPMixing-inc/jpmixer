'use strict';

// Plugins' cards on FOH Home (src/server/plugins.js). /plugin-cards.js,
// loaded just before this, lists the plugins that are on and show a card;
// their cards are added here, before foh-layout.js runs, so they can be
// arranged, resized and hidden like the rest. What's on each comes from
// /plugin-cards: a big value, a label, rows and a note, all plain text.
// A card stays out of the way (shown only in Arrange mode) until its plugin
// puts something on it.
(() => {
  const list = Array.isArray(window.JPM_PLUGIN_CARDS) ? window.JPM_PLUGIN_CARDS : [];
  const dashboard = document.getElementById('fhDashboard');
  if (!list.length || !dashboard) return;
  const POLL_MS = 2000;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  const cards = new Map(); // card id -> { section, heading, body, title, shape }
  const before = dashboard.querySelector('.fh-shortcut');
  for (const { id, title } of list) {
    if (!/^p-[a-z][a-z0-9-]{1,29}$/.test(String(id)) || cards.has(id)) continue;
    const section = el('section', 'fh-card fh-layout-card fh-card-off fh-plugin-card');
    section.dataset.fhCard = id;
    section.setAttribute('aria-label', title);
    const heading = el('h2', '', title);
    const body = el('div', 'fh-card-body fh-plugin');
    body.setAttribute('role', 'status');
    body.setAttribute('aria-live', 'off');
    section.append(heading, body);
    dashboard.insertBefore(section, before);
    cards.set(id, { section, heading, body, title, shape: '' });
  }

  function render(entry, data) {
    const card = data.card;
    const stopped = data.state === 'crashed' || data.state === 'restarting';
    entry.section.classList.toggle('fh-card-off', !card);
    entry.section.classList.toggle('is-stopped', stopped);
    entry.heading.textContent = (card && card.title) || entry.title;
    if (!card) return;
    // Rebuilt only when something changed, so text selection and scroll hold
    const shape = JSON.stringify([card, stopped]);
    if (shape === entry.shape) return;
    entry.shape = shape;
    const body = entry.body;
    body.textContent = '';
    if (card.value || card.label) {
      const top = el('div', 'fh-plugin-top');
      if (card.color) top.dataset.color = card.color;
      if (card.value) {
        const main = el('div', 'fh-plugin-main');
        main.appendChild(el('span', 'fh-plugin-value', card.value));
        if (card.unit) main.appendChild(el('span', 'fh-plugin-unit', card.unit));
        top.appendChild(main);
      }
      if (card.label) top.appendChild(el('div', 'fh-plugin-label', card.label));
      body.appendChild(top);
    }
    for (const row of card.rows || []) {
      const line = el('div', 'fh-plugin-row');
      if (row.color) line.dataset.color = row.color;
      line.append(el('span', 'fh-plugin-row-label', row.label), el('span', 'fh-plugin-row-value', row.value));
      body.appendChild(line);
    }
    const note = stopped ? 'This plugin stopped. See Settings → Integrations → Plugins.' : card.note;
    if (note) body.appendChild(el('p', 'fh-plugin-note', note));
  }

  let timer = null;
  async function poll() {
    clearTimeout(timer);
    try {
      const res = await fetch('/plugin-cards', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const byId = new Map((data.cards || []).map((c) => [c.id, c]));
        for (const [id, entry] of cards) render(entry, byId.get(id) || { card: null, state: 'off' });
      }
    } catch (_) { /* JPMixer restarting; keep what's showing */ }
    if (!document.hidden) timer = setTimeout(poll, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  // After foh-layout.js has taken the cards in
  window.addEventListener('DOMContentLoaded', poll);
})();
