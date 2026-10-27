'use strict';

// Mic batteries for a mix (Settings → Plugins → Shure wireless gives
// each wireless channel a mix): on the musician's phone mixer, for the mix
// they're on, and in Monitor Engineer, for every mix. From /wireless-aux
// (shure-wireless.js) every 15 seconds. Nothing shows while wireless
// monitoring is off or a mix has no mic.
//   phone mixer:      <span id="micBatt"> follows the selected mix
//   Monitor Engineer: any element with data-mix-mic="<aux>"
(() => {
  const POLL_MS = 3000; // JPMixer's own copy of the receivers' readings: no Shure traffic
  const STATE = { good: 'Good', replace: 'Replace', critical: 'Critical' };
  let enabled = false, mixes = {};

  function chip(mic) {
    const el = document.createElement('span');
    el.className = 'mic-chip';
    let text, state = mic.battState;
    if (mic.status !== 'connected') { text = 'receiver offline'; state = 'offline'; }
    else if (mic.transmitter === 'off') {
      text = mic.lastBatt ? `off (was ${STATE[mic.lastBatt.state]})` : 'off';
      state = 'off';
    } else if (mic.battBars === null) text = 'on';
    else text = STATE[mic.battState] + (mic.runTimeMin !== null ? ` · ${mic.runTimeMin >= 60 ? `${Math.floor(mic.runTimeMin / 60)} h ${mic.runTimeMin % 60} min` : `${mic.runTimeMin} min`}` : '');
    el.classList.add('is-' + (state || 'unknown'));
    const bars = document.createElement('i');
    bars.className = 'mic-bars';
    bars.setAttribute('aria-hidden', 'true');
    const lit = mic.transmitter === 'on' && mic.battBars !== null ? mic.battBars : 0;
    for (let i = 1; i <= 5; i++) { const b = document.createElement('b'); if (i <= lit) b.className = 'on'; bars.appendChild(b); }
    const label = document.createElement('span');
    label.textContent = `${mic.name || 'Mic'} · ${text}`;
    el.append(bars, label);
    el.title = `${mic.name || 'Mic'}: ${text}${mic.battBars !== null && mic.transmitter === 'on' ? `, battery ${mic.battBars} of 5` : ''}`;
    return el;
  }
  function fill(el, aux) {
    const list = enabled && aux !== null && aux !== undefined && aux !== '' ? mixes[aux] || [] : [];
    const key = JSON.stringify(list);
    if (el.dataset.micKey === key) return;
    el.dataset.micKey = key;
    el.replaceChildren(...list.map(chip));
    el.hidden = !list.length;
  }
  function render() {
    const phone = document.getElementById('micBatt');
    // selectedAux is the phone mixer's (mixer.js)
    if (phone) fill(phone, typeof selectedAux !== 'undefined' ? selectedAux : null);
    for (const el of document.querySelectorAll('[data-mix-mic]')) fill(el, el.dataset.mixMic);
  }
  async function poll() {
    try {
      const data = await (await fetch('/wireless-aux', { cache: 'no-store' })).json();
      enabled = !!(data.ok && data.enabled);
      mixes = data.mixes && typeof data.mixes === 'object' ? data.mixes : {};
    } catch (_) { /* keep what's showing */ }
    render();
  }
  poll();
  setInterval(poll, POLL_MS);
  // A different mix chosen, or Monitor Engineer's lists rebuilt
  setInterval(render, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
