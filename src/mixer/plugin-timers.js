'use strict';

// Plugins' running timers (a ProPresenter countdown, say), at the top of the
// page: on the Green Room screen next to the clock, on the Home pages as a
// strip under the header. From /plugin-timers (plugins.js), checked every
// second; nothing shows while no timer is running. A timer past zero is red.
(() => {
  const greenRoom = document.querySelector('.gr-top');
  const header = document.querySelector('.fh-header');
  if (!greenRoom && !header) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  const box = el('section', greenRoom ? 'gr-timers' : 'fh-timers');
  box.hidden = true;
  box.setAttribute('aria-label', 'Running timers');
  box.setAttribute('role', 'timer');
  if (greenRoom) greenRoom.insertBefore(box, greenRoom.querySelector('.gr-clock'));
  else header.after(box);

  let shape = '';
  function render(timers) {
    box.hidden = !timers.length;
    // Rebuilt when the list changes; otherwise only the times move
    const now = JSON.stringify(timers.map((t) => [t.name, t.over]));
    if (now !== shape) {
      shape = now;
      box.textContent = '';
      for (const t of timers) {
        const item = el('div', greenRoom ? 'gr-timer' : 'fh-timer');
        item.append(el('span', 'tm-name', t.name || 'Timer'), el('span', 'tm-time', t.time));
        box.appendChild(item);
      }
    }
    timers.forEach((t, i) => {
      const item = box.children[i];
      if (!item) return;
      item.classList.toggle('is-over', t.over);
      item.lastChild.textContent = t.time;
      item.setAttribute('aria-label', `${t.name || 'Timer'}: ${t.time}${t.over ? ', over time' : ''}`);
    });
  }

  let timer = null;
  async function poll() {
    clearTimeout(timer);
    try {
      const res = await fetch('/plugin-timers', { cache: 'no-store' });
      if (res.ok) render(((await res.json()).timers) || []);
    } catch (_) { /* JPMixer restarting; keep what's showing */ }
    if (!document.hidden) timer = setTimeout(poll, 1000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  poll();
})();
