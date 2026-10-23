'use strict';

// FOH Home's Wireless card: each Shure wireless channel JPMixer reads (Settings
// → Wireless), with its name, battery and whether its transmitter is on.
// Battery is Good (4–5 bars), Replace (3) or Critical (0–2); a transmitter
// that's just been switched off shows what its battery was.
// Read-only, from /wireless-data (shure-wireless.js). The card is hidden
// while wireless monitoring is off or no receiver is ticked.
(() => {
  const card = document.querySelector('[data-fh-card="wireless"]');
  const body = document.getElementById('fhWireless');
  if (!card || !body) return;
  const REFRESH_MS = 5000;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const STATE = { good: 'Good', replace: 'Replace', critical: 'Critical' };
  function battery(bars, state) {
    const wrap = el('span', 'fh-wl-batt');
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 5; i++) wrap.appendChild(el('i', i <= (bars || 0) ? 'on' : ''));
    if (state && state !== 'good') wrap.classList.add('is-' + state);
    return wrap;
  }
  const hours = (min) => min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;

  function render(data) {
    const channels = data && data.ok && data.enabled ? data.channels || [] : [];
    card.classList.toggle('fh-card-off', !channels.length);
    body.removeAttribute('aria-busy');
    body.textContent = '';
    for (const ch of channels) {
      const row = el('div', 'fh-wl-row');
      const left = el('div', 'fh-wl-main');
      left.appendChild(el('div', 'fh-wl-name', ch.name || 'Wireless'));
      const detail = [ch.aux ? `Aux ${ch.aux}` : null, ch.txType, ch.frequency ? `${ch.frequency} MHz` : null].filter(Boolean).join(' · ');
      left.appendChild(el('div', 'fh-wl-detail', detail || ch.model || ''));
      const right = el('div', 'fh-wl-state');
      let text, cls = '';
      if (ch.status !== 'connected') { text = ch.status === 'connecting' ? 'Connecting…' : 'Receiver offline'; cls = 'is-warn'; }
      else if (ch.transmitter === 'off') {
        cls = 'is-off';
        text = 'Transmitter off';
        if (ch.lastBatt) text += ` · was ${STATE[ch.lastBatt.state]} (${ch.lastBatt.bars}/5)${ch.lastBatt.minutesAgo ? `, ${ch.lastBatt.minutesAgo} min ago` : ''}`;
      }
      else if (ch.battBars === null) text = 'On';
      else {
        right.appendChild(battery(ch.battBars, ch.battState));
        text = `${STATE[ch.battState]} · ${ch.runTimeMin !== null ? hours(ch.runTimeMin) : `${ch.battBars}/5${ch.battType ? ' ' + ch.battType : ''}`}`;
        if (ch.battState === 'replace') cls = 'is-warn';
        if (ch.battState === 'critical') cls = 'is-critical';
      }
      if (ch.txMuted) text += ' · Muted';
      const label = el('span', 'fh-wl-text ' + cls, text);
      right.appendChild(label);
      row.setAttribute('aria-label', `${ch.name || 'Wireless'}: ${text}${ch.battBars !== null && ch.status === 'connected' ? `, battery ${ch.battBars} of 5` : ''}`);
      row.append(left, right);
      body.appendChild(row);
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/wireless-data', { cache: 'no-store' });
      if (res.status === 401) return; // FOH Home is locked; the page asks for the code
      render(await res.json());
    } catch (_) { /* JPMixer restarting; try again next time */ }
  }
  refresh();
  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
