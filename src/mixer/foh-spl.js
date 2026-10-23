'use strict';

// SPL card on FOH Home: live sound levels from Smaart (src/server/smaart.js).
// One row per mic input that Smaart is logging: a big reading (LAeq 10 by
// default) and a small live one (SPL A Slow), coloured green / yellow / red
// by Smaart's own thresholds, and marked when one of Smaart's alarms trips.
// While Smaart SPL is off in Settings the card stays out of the way (shown
// only in Arrange mode). Its Options button picks the two readings and which
// inputs show; they're saved on the JPMixer computer, so every screen that
// opens FOH Home shows the same (the same choices as Settings → Integrations → Smaart SPL).
(() => {
  const card = document.querySelector('[data-fh-card="spl"]');
  const body = document.getElementById('fhSpl');
  if (!card || !body) return;
  const POLL_MS = 1000;
  let rows = new Map(); // input id -> { row, main, mainName, live, note }
  let lastShape = '';

  const dB = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
  let latest = null; // the last /smaart-spl answer

  function buildRows(inputs) {
    body.textContent = '';
    rows = new Map();
    for (const input of inputs) {
      const row = document.createElement('div');
      row.className = 'fh-spl-row';
      const head = document.createElement('div');
      head.className = 'fh-spl-input';
      head.textContent = input.channel || input.device;
      const main = document.createElement('div');
      main.className = 'fh-spl-main';
      const value = document.createElement('span');
      value.className = 'fh-spl-value';
      const unit = document.createElement('span');
      unit.className = 'fh-spl-unit';
      unit.textContent = 'dB';
      const mainName = document.createElement('span');
      mainName.className = 'fh-spl-name';
      main.append(value, unit, mainName);
      const live = document.createElement('div');
      live.className = 'fh-spl-live';
      const note = document.createElement('div');
      note.className = 'fh-spl-note';
      row.append(head, main, live, note);
      body.appendChild(row);
      rows.set(input.id, { row, value, mainName, live, note });
    }
  }

  function show(data) {
    latest = data;
    card.classList.toggle('fh-card-off', !data.enabled);
    if (!data.enabled) return;
    const all = data.state === 'connected' ? data.inputs || [] : [];
    const inputs = all.filter((i) => !i.hidden);
    if (!inputs.length) {
      lastShape = '';
      rows = new Map();
      body.textContent = '';
      body.dataset.empty = all.length ? 'Every input is turned off. Turn one on under Options.' : data.message || 'Waiting for Smaart…';
      return;
    }
    delete body.dataset.empty;
    const shape = inputs.map((i) => i.id).join('|');
    if (shape !== lastShape) { buildRows(inputs); lastShape = shape; }
    for (const input of inputs) {
      const r = rows.get(input.id);
      if (!r) continue;
      const main = input.main, live = input.live;
      r.value.textContent = main ? dB(main.value) : '—';
      r.mainName.textContent = main ? main.name : '';
      r.live.textContent = live ? `${live.name}  ${dB(live.value)} dB` : '';
      r.row.dataset.color = main ? main.color : '';
      const over = !!((main && main.over) || (live && live.over));
      r.row.classList.toggle('is-over', over);
      r.row.classList.toggle('is-stale', !!input.stale);
      r.note.textContent = input.stale ? 'No reading from Smaart right now' : over ? 'Over Smaart’s alarm level' : '';
    }
  }

  // ── Options ──
  const options = document.getElementById('fhSplOptions');
  const mainSel = document.getElementById('fhSplMain'), liveSel = document.getElementById('fhSplLive');
  const note = document.getElementById('fhSplPanelNote');
  const NOTE = 'Shown on every screen that opens FOH Home.';
  function fillSelect(select, value, autoName, allowNone) {
    const names = [...new Set([...(latest?.metrics || []), ...(value && value !== 'none' ? [value] : [])])];
    select.textContent = '';
    select.add(new Option(autoName ? `Automatic (${autoName})` : 'Automatic', ''));
    if (allowNone) select.add(new Option('None', 'none'));
    for (const n of names) select.add(new Option(n, n));
    select.value = value || '';
  }
  function fillOptions() {
    if (!latest) return;
    const choice = latest.choice || { main: '', live: '', hidden: [] };
    const first = (latest.inputs || [])[0];
    fillSelect(mainSel, choice.main, !choice.main && first?.main?.name, false);
    fillSelect(liveSel, choice.live, !choice.live && first?.live?.name, true);
    const list = document.getElementById('fhSplInputList');
    list.textContent = '';
    const inputs = latest.inputs || [];
    document.getElementById('fhSplInputs').hidden = inputs.length < 2;
    for (const input of inputs) {
      const label = document.createElement('label');
      label.className = 'fh-spl-input-choice';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !input.hidden;
      box.dataset.key = input.key;
      label.append(box, document.createTextNode(` ${input.channel || input.device}`));
      list.appendChild(label);
    }
    note.textContent = NOTE;
  }
  async function saveOptions() {
    const hidden = [...document.querySelectorAll('#fhSplInputList input')].filter((b) => !b.checked).map((b) => b.dataset.key);
    // Inputs Smaart isn't sending right now stay as they were
    const showing = new Set((latest?.inputs || []).map((i) => i.key));
    for (const key of latest?.choice?.hidden || []) if (!showing.has(key)) hidden.push(key);
    note.textContent = 'Saving…';
    try {
      const res = await fetch('/smaart-spl/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ main: mainSel.value, live: liveSel.value, hidden }) });
      const data = await res.json().catch(() => ({}));
      note.textContent = data.ok ? 'Saved. ' + NOTE : res.status === 401 ? 'Enter FOH Home’s access code to change this.' : data.error || 'Couldn’t save. Try again.';
      if (data.ok) { latest = { ...latest, choice: data.choice }; lastShape = ''; poll(); }
    } catch (_) { note.textContent = 'Can’t reach JPMixer right now.'; }
  }
  options.addEventListener('toggle', () => { if (options.open) fillOptions(); });
  mainSel.addEventListener('change', saveOptions);
  liveSel.addEventListener('change', saveOptions);
  document.getElementById('fhSplInputList').addEventListener('change', saveOptions);
  document.addEventListener('click', (e) => { if (options.open && !options.contains(e.target)) options.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') options.open = false; });

  let timer = null;
  async function poll() {
    clearTimeout(timer);
    try {
      const res = await fetch('/smaart-spl', { cache: 'no-store' });
      if (res.ok) show(await res.json());
    } catch (_) { /* keep what's showing; try again shortly */ }
    // Only while the page is showing: a phone in a pocket doesn't keep asking
    if (!document.hidden) timer = setTimeout(poll, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  poll();
})();
