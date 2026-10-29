'use strict';

// Custom Pages' editor, in the plugin's own tab in Settings (settings.js puts
// it under the plugin's card). Settings is on the JPMixer computer, so it
// talks to the plugin through JPMixer (window.jpm.customPagesCall): its
// editor calls (editor, save, remove, newLink) only answer from here. Each
// page: a name, on/off, its link and QR code, its faders with their highest
// level, and whether it has mute buttons and Companion buttons.
(() => {
  const make = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('data-')) el.setAttribute(k, v);
      else el[k] = v;
    }
    el.append(...kids);
    return el;
  };

  function render() {
    const root = make('section', { class: 'card custom-pages' });
    const head = make('div', { class: 'card-row space-between' });
    const heading = make('div', { class: 'settings-heading' },
      make('h2', { text: 'Pages' }),
      make('p', { class: 'sub', text: 'Each page has its own link. Anyone with the link can move only the faders you put on it, never above their highest level. New link stops the old one working. Save page saves it straight away.' }));
    const add = make('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'New page' });
    head.append(heading, add);
    const note = make('p', { class: 'sub custom-pages-note', role: 'status' });
    const list = make('div', { class: 'custom-pages-list' });
    root.append(head, note, list);
    let ed = null;

    const showNote = (text, isError = false) => { note.textContent = text || ''; note.hidden = !text; note.classList.toggle('is-error', isError); };
    async function call(name, body) {
      const out = await window.jpm.customPagesCall(name, body);
      if (!out || !out.ok) throw Object.assign(new Error((out && out.error) || 'Custom Pages didn’t answer.'), { off: !!(out && out.off) });
      return out.result;
    }
    async function load() {
      try { ed = await call('editor'); draw(); }
      catch (e) { ed = null; list.textContent = ''; add.disabled = true; showNote(e.message, !e.off); }
    }

    const urlOf = (p) => `${(ed.base || '').replace(/\/$/, '')}/p/custom-pages/?k=${encodeURIComponent(p.key)}`;
    function stripSelect(chosen) {
      const select = make('select', { 'aria-label': 'Channel or control group' });
      let found = false;
      for (const [kind, label, items] of [['ch', 'Channels', ed.console.channels], ['cg', 'Control groups', ed.console.groups]]) {
        if (!items.length) continue;
        const group = make('optgroup', { label });
        for (const x of items) {
          const short = `${kind === 'ch' ? 'Ch' : 'CG'} ${x.number}`;
          const o = new Option(x.name && x.name.toLowerCase() !== short.toLowerCase() ? `${short} · ${x.name}` : short, `${kind}:${x.number}`);
          if (o.value === chosen) { o.selected = true; found = true; }
          group.append(o);
        }
        select.append(group);
      }
      // One the console doesn't list right now (it's off, say): kept as it is
      if (chosen && !found) {
        const [kind, n] = chosen.split(':');
        const o = new Option(`${kind === 'ch' ? 'Ch' : 'CG'} ${n}`, chosen);
        o.selected = true;
        select.prepend(o);
      }
      return select;
    }
    function faderRow(f, onChange) {
      const max = make('input', { type: 'number', step: '0.5', min: String(ed.limits.min), max: String(ed.limits.max), value: String(f ? f.max : ed.defaultMax), 'aria-label': 'Highest level, dB' });
      const remove = make('button', { type: 'button', class: 'btn btn-sm', text: 'Remove' });
      const row = make('div', { class: 'custom-pages-fader' }, stripSelect(f ? `${f.kind}:${f.n}` : ''), max, make('span', { class: 'sub', text: 'dB max' }), remove);
      remove.addEventListener('click', () => { row.remove(); onChange(); });
      return row;
    }
    function pageCard(page) {
      const card = make('div', { class: 'custom-pages-page' });
      const name = make('input', { type: 'text', maxLength: 40, placeholder: 'YTH Wednesday', value: page ? page.name : '', 'aria-label': 'Page name' });
      const on = make('input', { type: 'checkbox', class: 'toggle', checked: page ? page.enabled : true, 'aria-label': 'Page on' });
      card.append(make('div', { class: 'custom-pages-row' }, make('label', { class: 'custom-pages-name' }, make('span', { class: 'sub', text: 'Name' }), name), make('label', { class: 'custom-pages-on' }, make('span', { class: 'sub', text: 'On' }), on)));
      const state = make('span', { class: 'sub custom-pages-state', role: 'status' });
      const changed = () => { state.textContent = 'Not saved'; };
      card.addEventListener('input', changed);
      card.addEventListener('change', changed);

      // The link and QR code: once it's saved (the plugin makes the key)
      if (page) {
        const url = urlOf(page);
        const qr = make('div', { class: 'custom-pages-qr', 'aria-hidden': 'true' });
        window.jpm.qrSvg(url).then((svg) => { qr.innerHTML = svg; }).catch(() => {}); // made by JPMixer from the link
        const copy = make('button', { type: 'button', class: 'btn btn-sm', text: 'Copy link' });
        copy.addEventListener('click', () => {
          const t = make('textarea', { value: url });
          document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
          copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy link'; }, 1500);
        });
        const open = make('button', { type: 'button', class: 'btn btn-sm', text: 'Open' });
        open.addEventListener('click', () => window.jpm.openFoh(url));
        const renew = make('button', { type: 'button', class: 'btn btn-sm', text: 'New link' });
        renew.addEventListener('click', async () => {
          if (!confirm('Make a new link for this page? The old link and QR code stop working straight away.')) return;
          try { ed = await call('newLink', { id: page.id }); draw(); } catch (e) { showNote(e.message, true); }
        });
        card.append(make('div', { class: 'custom-pages-link' }, qr,
          make('div', { class: 'custom-pages-link-info' }, make('span', { class: 'sub', text: page.enabled ? 'Link' : 'Link (the page is off: it shows that it isn’t available)' }), make('code', { text: url }), make('div', { class: 'custom-pages-actions' }, copy, open, renew))));
      }

      card.append(make('p', { class: 'custom-pages-label', text: 'Faders' }), make('p', { class: 'sub', text: 'Each fader’s highest level is the most anyone on the page can set it to.' }));
      const faders = make('div', { class: 'custom-pages-faders' });
      for (const f of page ? page.faders : []) faders.append(faderRow(f, changed));
      const addFader = make('button', { type: 'button', class: 'btn btn-sm', text: 'Add fader' });
      addFader.addEventListener('click', () => { if (faders.children.length < ed.limits.faders) { faders.append(faderRow(null, changed)); changed(); } });
      card.append(faders, addFader);

      const mutes = make('input', { type: 'checkbox', class: 'toggle', checked: page ? page.mutes : false });
      const comp = make('input', { type: 'checkbox', class: 'toggle', checked: page ? page.companion : false });
      const gridSelect = (lo, hi, value, label) => { const s = make('select', { 'aria-label': label }); for (let i = lo; i <= hi; i++) s.add(new Option(String(i), String(i))); s.value = String(value); return s; };
      const cols = gridSelect(...ed.limits.grid.columns, page ? page.columns : 4, 'Columns');
      const rows = gridSelect(...ed.limits.grid.rows, page ? page.rows : 2, 'Rows');
      const grid = make('span', { class: 'custom-pages-grid' }, make('span', { class: 'sub', text: 'Columns' }), cols, make('span', { class: 'sub', text: 'Rows' }), rows);
      const showGrid = () => { grid.hidden = !comp.checked; };
      comp.addEventListener('change', showGrid);
      showGrid();
      const c = ed.companion || {};
      // Its own surface either way; what's in the way first, if anything
      const surfaceHint = `This page is its own surface in Companion, “JPMixer ${page ? page.name : 'page name'}”: give it a page of buttons in Companion → Surfaces.`;
      const compHint = ['missing', 'off', 'old'].includes(c.state) ? `${c.message} ${surfaceHint}`
        : `${surfaceHint}${c.state === 'connected' || !c.message ? '' : ` ${c.message}`}`;
      card.append(make('div', { class: 'custom-pages-options' },
        make('label', { class: 'toggle-label' }, mutes, make('span', { text: 'Mute buttons' })),
        make('label', { class: 'toggle-label' }, comp, make('span', { text: 'Companion buttons' })), grid),
        make('p', { class: 'sub', text: compHint }));

      const remove = make('button', { type: 'button', class: 'btn btn-sm btn-danger', text: page ? 'Remove page' : 'Cancel' });
      remove.addEventListener('click', async () => {
        if (!page) { card.remove(); if (!list.children.length) draw(); return; }
        if (!confirm(`Remove “${page.name}”? Its link stops working.`)) return;
        try { ed = await call('remove', { id: page.id }); draw(); } catch (e) { showNote(e.message, true); }
      });
      const save = make('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Save page' });
      save.addEventListener('click', async () => {
        state.textContent = 'Saving…';
        const picked = [...faders.children].map((row) => {
          const [kind, n] = (row.querySelector('select').value || ':').split(':');
          return { kind, n: Number(n), max: Number(row.querySelector('input').value) };
        }).filter((f) => f.kind && Number.isInteger(f.n));
        try {
          ed = await call('save', { page: { id: page ? page.id : undefined, name: name.value, enabled: on.checked, mutes: mutes.checked, companion: comp.checked, columns: Number(cols.value), rows: Number(rows.value), faders: picked } });
          draw();
          showNote('');
        } catch (e) { state.textContent = ''; showNote(e.message, true); }
      });
      card.append(make('div', { class: 'custom-pages-actions custom-pages-footer' }, state, remove, save));
      return card;
    }
    function draw() {
      showNote(!ed.console.supported ? 'This console’s faders can’t be moved from JPMixer: Custom Pages work with DiGiCo, dLive and LV1.'
        : ed.console.connected ? '' : 'The console isn’t connected: its channels show here, and on the pages, once it is.');
      list.textContent = '';
      if (!ed.pages.length) list.append(make('p', { class: 'sub custom-pages-empty', text: 'No pages yet. Click New page to make one.' }));
      for (const p of ed.pages) list.append(pageCard(p));
      add.disabled = ed.pages.length >= ed.limits.pages;
    }
    add.addEventListener('click', () => {
      if (!ed) return;
      list.querySelector('.custom-pages-empty')?.remove();
      const card = pageCard(null);
      list.prepend(card);
      card.querySelector('input[type="text"]').focus();
    });
    root.refresh = load;
    load();
    return root;
  }

  window.renderCustomPagesEditor = render;
})();
