'use strict';

// Plugins' cards on the Home pages (src/server/plugins.js). /plugin-cards.js,
// loaded just before this, lists the cards of the plugins that are on; they're
// added here, before foh-layout.js runs, so they can be arranged, resized and
// hidden like the rest. FOH Home shows them all; the other Home pages only
// those a plugin puts on every Home page. What's on each comes from
// /plugin-cards: a big value, a label, rows, text, pictures, buttons, a text
// box, sections with headings, and a note, all plain text (pictures from
// /plugin-cards/image/…). A button or the text box goes back to the plugin
// (/plugin-cards/press), which then updates its card.
// A card stays out of the way (shown only in Arrange mode) until its plugin
// puts something on it.
(() => {
  const list = Array.isArray(window.JPM_PLUGIN_CARDS) ? window.JPM_PLUGIN_CARDS : [];
  const dashboard = document.getElementById('fhDashboard');
  if (!list.length || !dashboard) return;
  // Which Home page this is (as foh-layout.js reads it)
  const page = (location.pathname.match(/\/(propresenter|lighting|switcher|producer|hp-[0-9a-f]{10})\.html$/) || [])[1] || 'foh';
  // Checked once a second, or four times while a card shows pictures (a
  // ProPresenter slide change then shows within about half a second)
  const POLL_MS = 1000, POLL_PICTURES_MS = 250;
  let hasPictures = false;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  const cards = new Map(); // card id -> { section, heading, body, title, shape }
  const before = dashboard.querySelector('.fh-shortcut');
  for (const { id, title, everyPage, size } of list) {
    if (!/^p-[a-z][a-z0-9-]{1,29}(_[a-z][a-z0-9-]{0,11})?$/.test(String(id)) || cards.has(id)) continue;
    if (page !== 'foh' && !everyPage) continue;
    const section = el('section', 'fh-card fh-layout-card fh-card-off fh-plugin-card');
    section.dataset.fhCard = id;
    if (size) section.dataset.fhSize = size; // its starting size (foh-layout.js)
    section.setAttribute('aria-label', title);
    const heading = el('h2', '', title);
    const body = el('div', 'fh-card-body fh-plugin');
    body.setAttribute('role', 'status');
    body.setAttribute('aria-live', 'off');
    section.append(heading, body);
    dashboard.insertBefore(section, before);
    cards.set(id, { section, heading, body, title, shape: '' });
  }
  if (!cards.size) return;

  async function press(id, button, text) {
    try {
      const res = await fetch('/plugin-cards/press', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, button, text, page }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const entry = cards.get(id);
        if (entry) showError(entry, data.error || 'That didn’t reach the plugin.');
      }
    } catch (_) {
      const entry = cards.get(id);
      if (entry) showError(entry, 'JPMixer didn’t answer. Try again.');
    }
    poll(); // its new state, now
  }
  function showError(entry, message) {
    let line = entry.body.querySelector('.fh-plugin-error');
    if (!line) { line = el('p', 'fh-plugin-error'); line.setAttribute('role', 'alert'); entry.body.prepend(line); }
    line.textContent = message;
    clearTimeout(entry.errorTimer);
    entry.errorTimer = setTimeout(() => line.remove(), 4000);
  }

  function render(id, entry, data) {
    const card = data.card;
    const stopped = data.state === 'crashed' || data.state === 'restarting';
    entry.section.classList.toggle('fh-card-off', !card);
    entry.section.classList.toggle('is-stopped', stopped);
    entry.heading.textContent = (card && card.title) || entry.title;
    if (!card) return;
    // Rebuilt only when something changed, so text selection, scroll and
    // typing in its text box hold
    const shape = JSON.stringify([card, stopped]);
    if (shape === entry.shape) return;
    entry.shape = shape;
    const body = entry.body;
    // What's being typed (and where), the scroll, and the pictures stay while
    // the card changes around them: a running timer redraws it every second
    const drafts = new Map();
    for (const input of body.querySelectorAll('.fh-plugin-input input')) {
      drafts.set(input.dataset.id, { value: input.value, focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd });
    }
    const scroll = body.scrollTop;
    const pictures = entry.pictures || new Map(); // src -> <img>, reused
    entry.pictures = new Map();
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
    const button = (b, cls = 'fh-plugin-button') => {
      const btn = el('button', cls, b.label);
      btn.type = 'button';
      if (b.color) btn.dataset.color = b.color;
      if (b.active) { btn.classList.add('is-active'); btn.setAttribute('aria-pressed', 'true'); }
      // A button that opens the plugin's own page (JPMixer fills in its address)
      if (b.page) {
        const ok = typeof b.href === 'string' && /^\/p\/[a-z][a-z0-9-]{1,29}\/$/.test(b.href);
        btn.disabled = b.disabled || !ok;
        btn.addEventListener('click', () => { if (ok) window.open(b.href, '_blank', 'noopener'); });
        return btn;
      }
      btn.disabled = b.disabled || stopped;
      btn.addEventListener('click', () => press(id, b.id));
      return btn;
    };
    // One part of a card (the card itself, or a section): text, pictures,
    // rows, a text box, buttons
    const drawPart = (part, into) => {
      if (part.text) into.appendChild(el('p', 'fh-plugin-text', part.text));
      if (part.images && part.images.length) {
        const strip = el('div', 'fh-plugin-images');
        strip.dataset.count = String(part.images.length);
        for (const image of part.images) {
          const fig = el('figure', 'fh-plugin-image');
          const frame = el('div', 'fh-plugin-frame');
          if (image.src) {
            const src = `${image.src}${image.src.includes('?') ? '&' : '?'}page=${encodeURIComponent(page)}`;
            // One <img> per frame: the same picture twice (two blank slides in a
            // row) gets two, or the second frame would take the first one's
            let img = entry.pictures.has(src) ? null : pictures.get(src);
            if (!img) { img = el('img'); img.src = src; img.decoding = 'async'; }
            img.alt = image.caption ? `${image.label}: ${image.caption}` : image.label || '';
            entry.pictures.set(src, img);
            frame.appendChild(img);
          } else {
            frame.classList.add('is-empty');
            frame.appendChild(el('span', '', image.label ? `No ${image.label.toLowerCase()} slide` : ''));
          }
          if (image.label) frame.appendChild(el('span', 'fh-plugin-image-label', image.label));
          fig.appendChild(frame);
          if (image.caption) fig.appendChild(el('figcaption', '', image.caption));
          strip.appendChild(fig);
        }
        into.appendChild(strip);
      }
      for (const row of part.rows || []) {
        const line = el('div', 'fh-plugin-row');
        if (row.color) line.dataset.color = row.color;
        line.append(el('span', 'fh-plugin-row-label', row.label), el('span', 'fh-plugin-row-value', row.value));
        if (row.buttons && row.buttons.length) {
          line.classList.add('has-buttons');
          const own = el('span', 'fh-plugin-row-buttons');
          for (const b of row.buttons) {
            const btn = button(b);
            btn.setAttribute('aria-label', `${b.label} ${row.label}`);
            own.appendChild(btn);
          }
          line.appendChild(own);
        }
        into.appendChild(line);
      }
      if (part.input) {
        const form = el('form', 'fh-plugin-input');
        const input = el('input');
        input.type = 'text';
        input.maxLength = 200;
        input.placeholder = part.input.placeholder || '';
        input.dataset.id = part.input.id;
        input.setAttribute('aria-label', part.input.placeholder || part.input.button);
        const draft = drafts.get(part.input.id);
        input.value = draft ? draft.value : part.input.value || '';
        const go = el('button', 'fh-plugin-button', part.input.button);
        go.type = 'submit';
        go.disabled = stopped;
        form.append(input, go);
        form.addEventListener('submit', (e) => { e.preventDefault(); press(id, part.input.id, input.value); input.value = ''; });
        into.appendChild(form);
        if (draft && draft.focused) { input.focus(); try { input.setSelectionRange(draft.start, draft.end); } catch (_) {} }
      }
      if (part.buttons && part.buttons.length) {
        const grid = el('div', 'fh-plugin-buttons');
        for (const b of part.buttons) grid.appendChild(button(b));
        into.appendChild(grid);
      }
    };
    drawPart(card, body);
    for (const section of card.sections || []) {
      const box = el('section', 'fh-plugin-section');
      if (section.title) box.appendChild(el('h3', 'fh-plugin-section-title', section.title));
      drawPart(section, box);
      body.appendChild(box);
    }
    const note = stopped ? 'This plugin stopped. See Settings → Plugins.' : card.note;
    if (note) body.appendChild(el('p', 'fh-plugin-note', note));
    body.scrollTop = scroll;
  }

  let timer = null;
  async function poll() {
    clearTimeout(timer);
    try {
      const res = await fetch(`/plugin-cards?page=${encodeURIComponent(page)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const byId = new Map((data.cards || []).map((c) => [c.id, c]));
        hasPictures = (data.cards || []).some((c) => c.card && cards.has(c.id) && [c.card, ...(c.card.sections || [])].some((p) => (p.images || []).length));
        for (const [id, entry] of cards) render(id, entry, byId.get(id) || { card: null, state: 'off' });
      }
    } catch (_) { /* JPMixer restarting; keep what's showing */ }
    if (!document.hidden) timer = setTimeout(poll, hasPictures ? POLL_PICTURES_MS : POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  // After foh-layout.js has taken the cards in
  window.addEventListener('DOMContentLoaded', poll);
})();
