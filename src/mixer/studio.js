'use strict';

// Performer view preferences stay on this device. Filtering and starring
// only change visibility; they never move a fader or send a console command.
//
// The filter bar: chips for All, Favorites, each channel group and "Other"
// (channels in no group). Several chips can be on at once — a drummer can
// keep Drums + Favorites — and the choice is remembered per mix on this
// device. Until the performer picks, a mix opens to the groups the engineer
// assigned it (Settings → Aux mixes → Opens to), and a "Mix default" chip
// brings those back. Search hides behind the icon at the end of the bar and
// always looks through every channel, whatever the chips say.
(() => {
  const byId = id => document.getElementById(id);
  const FAVORITES = '__favorites', OTHER = '__other', DEFAULT = '__default';
  let channels = [], favorites = new Set(), selected = new Set(), currentAux = null, validChips = new Set();
  let auxDefaults = []; // group names the engineer assigned to this mix
  const active = () => new Set([...selected].filter(id => validChips.has(id)));
  try {
    const saved = JSON.parse(localStorage.getItem('jpm_favorite_channels') || '[]');
    if (Array.isArray(saved)) favorites = new Set(saved.filter(Number.isInteger));
  } catch (_) {}

  const starPath = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>';
  const filterBar = byId('channelFilter');
  const chipsEl = byId('filterChips');
  const searchBox = byId('filterSearch');
  const search = byId('channelSearch');
  const searchToggle = byId('channelSearchToggle');

  const filterKey = aux => `jpm_channel_filter_v1:${aux}`;
  // The performer's own pick for this mix, or null if they haven't made one
  function savedFilter() {
    if (currentAux === null) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(filterKey(currentAux)));
      return Array.isArray(saved) ? saved.filter(v => typeof v === 'string') : null;
    } catch (_) { return null; }
  }
  function loadFilter() {
    selected = new Set(savedFilter() || auxDefaults);
  }
  const sameSet = (a, b) => a.size === b.size && [...a].every(v => b.has(v));
  function saveFilter() {
    if (currentAux === null) return;
    try { localStorage.setItem(filterKey(currentAux), JSON.stringify([...selected])); } catch (_) {}
  }

  function toggleFavorite(channel) {
    if (favorites.has(channel)) favorites.delete(channel);
    else favorites.add(channel);
    try { localStorage.setItem('jpm_favorite_channels', JSON.stringify([...favorites])); } catch (_) {}
    refresh();
  }

  // Groups in the order the engineer arranged them, with how many visible
  // channels each holds
  function groupList() {
    const groups = new Map();
    let other = 0;
    for (const ch of channels) {
      if (!ch.enabled) continue;
      if (ch.group) groups.set(ch.group, (groups.get(ch.group) || 0) + 1);
      else other++;
    }
    return { groups, other };
  }

  function renderChips() {
    const { groups, other } = groupList();
    const chips = [{ id: '', label: 'All' }, { id: FAVORITES, label: 'Favorites', star: true, count: [...favorites].filter(n => channels.some(c => c.enabled && c.channel === n)).length }];
    for (const [name, count] of groups) chips.push({ id: name, label: name, count });
    if (groups.size && other) chips.push({ id: OTHER, label: 'Other', count: other });
    // A remembered chip for a group that's gone (renamed, removed, or the
    // channel list not loaded yet) is ignored, not forgotten
    validChips = new Set(chips.map(c => c.id));
    // Back to the engineer's groups for this mix, once the performer has wandered off them
    const defaults = new Set(auxDefaults.filter(name => groups.has(name)));
    if (defaults.size && !sameSet(active(), defaults)) chips.unshift({ id: DEFAULT, label: 'Mix default', reset: true });

    const signature = JSON.stringify(chips.map(c => [c.id, c.count]));
    if (chipsEl.dataset.signature !== signature) {
      chipsEl.dataset.signature = signature;
      chipsEl.textContent = '';
      for (const chip of chips) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = chip.reset ? 'filter-chip filter-chip-reset' : 'filter-chip';
        b.dataset.chip = chip.id;
        if (chip.star) b.insertAdjacentHTML('beforeend', starPath);
        const label = document.createElement('span');
        label.textContent = chip.label;
        b.appendChild(label);
        if (chip.count !== undefined && chip.id !== FAVORITES) {
          const count = document.createElement('span');
          count.className = 'chip-count';
          count.textContent = chip.count;
          b.appendChild(count);
        }
        b.addEventListener('click', () => chooseChip(chip.id));
        chipsEl.appendChild(b);
      }
    }
    for (const b of chipsEl.children) {
      const id = b.dataset.chip;
      if (id === DEFAULT) continue;
      b.setAttribute('aria-pressed', String(id === '' ? active().size === 0 : selected.has(id)));
    }
  }

  function chooseChip(id) {
    if (id === DEFAULT) {
      try { localStorage.removeItem(filterKey(currentAux)); } catch (_) {}
      loadFilter();
      refresh();
      return;
    }
    selected = active(); // a tap settles the choice to chips that exist
    if (id === '') selected.clear();
    else if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    saveFilter();
    refresh();
    // Keep the tapped chip in view on a narrow screen
    chipsEl.querySelector(`[data-chip="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function shownByChips(ch, on) {
    if (on.size === 0) return true;
    if (on.has(FAVORITES) && favorites.has(ch.channel)) return true;
    if (ch.group ? on.has(ch.group) : on.has(OTHER)) return true;
    return false;
  }

  function refresh() {
    renderChips();
    const query = searchBox.hidden ? '' : search.value.trim().toLocaleLowerCase();
    let count = 0, total = 0;
    const on = active();
    const matches = new Map();
    for (const ch of channels) {
      if (!ch.enabled) continue;
      total++;
      const text = `${ch.label || ''} ${ch.channel} ch ${ch.channel} ${ch.group || ''}`.toLocaleLowerCase();
      matches.set(ch.channel, query ? text.includes(query) : shownByChips(ch, on));
    }
    const list = byId('channelsList');
    for (const row of list.querySelectorAll('.channel-row')) {
      const channel = Number(row.dataset.channel);
      const visible = matches.get(channel) === true;
      row.hidden = !visible;
      if (visible) count++;
      let button = row.querySelector('.channel-favorite');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'channel-favorite';
        button.innerHTML = starPath;
        row.querySelector('.ch-info').appendChild(button);
        button.addEventListener('click', () => toggleFavorite(channel));
      }
      const starred = favorites.has(channel);
      button.setAttribute('aria-pressed', String(starred));
      const name = row.querySelector('.ch-name')?.textContent || `channel ${channel}`;
      button.setAttribute('aria-label', `${starred ? 'Remove' : 'Add'} ${name} ${starred ? 'from' : 'to'} favorites`);
      button.title = starred ? 'Remove from favorites' : 'Add to favorites';
    }
    // A heading belongs to the following rows, up to the next heading.
    let heading = null, sectionVisible = false;
    for (const element of list.children) {
      if (element.classList.contains('section-title')) {
        if (heading) heading.hidden = !sectionVisible;
        heading = element;
        sectionVisible = false;
      } else if (element.classList.contains('channel-row') && !element.hidden) sectionVisible = true;
    }
    if (heading) heading.hidden = !sectionVisible;

    const filtered = query || on.size > 0;
    filterBar.classList.toggle('filtered', filtered);
    byId('channelSearchCount').textContent = query ? `${count}` : '';
    byId('channelResultCount').textContent = filtered ? `Showing ${count} of ${total} channels` : `${total} ${total === 1 ? 'channel' : 'channels'}`;
    const favoritesOnlyEmpty = !query && on.size === 1 && on.has(FAVORITES);
    byId('channelEmpty').hidden = count !== 0;
    byId('channelEmptyTitle').textContent = favoritesOnlyEmpty ? 'Keep your go-to channels close.' : 'No channels found';
    byId('channelEmptyDescription').textContent = favoritesOnlyEmpty ? 'Tap the star beside a channel to add it to your favorites.' : query ? 'Try another name, channel number, or group.' : 'Nothing here matches the groups you picked.';
  }

  function openSearch() {
    if (!searchBox.hidden) { search.focus(); return; }
    searchBox.hidden = false;
    filterBar.classList.add('searching');
    searchToggle.setAttribute('aria-expanded', 'true');
    searchToggle.setAttribute('aria-label', 'Close search');
    search.focus();
    refresh();
  }
  function closeSearch() {
    if (searchBox.hidden) return;
    search.value = '';
    search.blur();
    searchBox.hidden = true;
    filterBar.classList.remove('searching');
    searchToggle.setAttribute('aria-expanded', 'false');
    searchToggle.setAttribute('aria-label', 'Search channels');
    refresh();
  }

  search.addEventListener('input', refresh);
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') search.blur(); });
  searchToggle.addEventListener('click', () => (searchBox.hidden ? openSearch() : closeSearch()));
  byId('resetChannelView').addEventListener('click', () => { selected.clear(); saveFilter(); closeSearch(); refresh(); });
  byId('resetChannelView').textContent = 'Show all channels';
  document.addEventListener('keydown', event => {
    const editing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !editing && !document.body.classList.contains('auxPicker')) {
      event.preventDefault(); openSearch();
    }
    if (event.key === 'Escape' && !searchBox.hidden) { closeSearch(); searchToggle.focus(); }
  });

  globalThis.mixerUI = {
    setChannels(next) { channels = next; refresh(); },
    refresh,
    selectAux(aux) {
      const defaults = Array.isArray(aux.groups) ? aux.groups.filter(g => typeof g === 'string') : [];
      const changedDefaults = JSON.stringify(defaults) !== JSON.stringify(auxDefaults);
      auxDefaults = defaults;
      // A new mix, or the engineer changed this one's groups and the performer
      // hasn't made their own pick: show the mix's groups
      if (aux.channel !== currentAux || (changedDefaults && !savedFilter())) { currentAux = aux.channel; loadFilter(); refresh(); }
    },
    setConnected(connected, reconnecting = false) {
      byId('connectionLabel').textContent = connected ? 'Connected' : reconnecting ? 'Reconnecting' : 'Connecting';
    }
  };
})();

// Aux picker wordmark (see .jp-wordmark-fx in studio.css): the intro plays
// whenever the picker opens, once the loading splash has gone, and the glare
// plays again on hover.
(() => {
  const fx = document.getElementById('pickerWordmarkFx');
  if (!fx) return;
  const img = fx.querySelector('img');
  let introUntil = 0;
  function syncMask() {
    // A custom logo (brand.js) needs the glare masked to that image instead
    if (img.classList.contains('jp-custom-logo') && img.getAttribute('src')) fx.style.setProperty('--logo', `url("${img.getAttribute('src')}")`);
    else fx.style.removeProperty('--logo');
  }
  function playIntro() {
    if (!document.body.classList.contains('auxPicker')) return;
    if (globalThis.jpmSplash && !globalThis.jpmSplash.gone) return; // it plays when the splash leaves
    syncMask();
    fx.classList.remove('intro', 'shine');
    void fx.offsetWidth; // restart the animation
    fx.classList.add('intro');
    introUntil = Date.now() + 6400;
    setTimeout(() => { if (Date.now() >= introUntil) fx.classList.remove('intro'); }, 6400);
  }
  window.addEventListener('jpm-splash-gone', playIntro);
  let open = document.body.classList.contains('auxPicker');
  new MutationObserver(() => {
    const now = document.body.classList.contains('auxPicker');
    if (now && !open) playIntro();
    open = now;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncMask).observe(img, { attributes: true, attributeFilter: ['src', 'class'] });
  if (open) playIntro();
  fx.addEventListener('mouseenter', () => {
    if (Date.now() < introUntil || fx.classList.contains('shine')) return;
    syncMask();
    fx.classList.add('shine');
  });
  fx.addEventListener('animationend', (event) => { if (event.animationName === 'wmGlareOnce') fx.classList.remove('shine'); });
})();
