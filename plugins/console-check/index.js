'use strict';

// An example JPMixer plugin (see docs/PLUGINS.md). It shows on FOH Home
// whether the console is connected, and lists its mixes by name.

module.exports = async (jp) => {
  function show(desk) {
    const rows = [];
    if (jp.settings.showMixes) {
      for (const mix of desk.mixes.slice(0, jp.settings.maxMixes)) {
        rows.push({ label: `Mix ${mix.number}`, value: mix.name || '—' });
      }
    }
    jp.card.show({
      value: desk.connected ? 'Connected' : desk.running ? 'Not connected' : 'Server off',
      color: desk.connected ? 'green' : 'red',
      label: `${desk.type.toUpperCase()}${desk.demo ? ' · demo mode' : ''} · ${desk.channels.length} channels`,
      rows,
    });
    jp.status(desk.connected ? 'Console connected' : 'Waiting for the console', desk.connected ? 'ok' : 'warn');
  }

  show(await jp.console.get());          // straight away
  jp.console.onChange(show);             // and whenever something changes
  console.log('Console check started');  // shows in its Log in Settings
};
