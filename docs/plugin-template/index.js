'use strict';

// A JPMixer plugin. JPMixer runs this file in its own process and calls the
// function below with `jp`, the plugin's way to talk to JPMixer. The whole
// guide is docs/PLUGINS.md in JPMixer's GitHub repository.
//
// To try it: in JPMixer, Settings → Integrations → Plugins → Import folder…,
// choose this folder, then turn it on under Plugins in the sidebar. Tick
// "Restart when its files change" there, and every time you save this file
// the plugin starts again with your changes. console.log() lines show in the
// Log on the same tab.

module.exports = async (jp) => {
  // Its settings, from "settings" in plugin.json, as filled in on its tab
  const { message } = jp.settings;

  // The card on FOH Home ("card" in permissions). Every part is optional;
  // calling it again replaces the whole card.
  jp.card.show({
    value: message,
    label: 'Edit index.js to change this card',
    color: 'blue',
  });

  // The console's names and whether it's connected. Add "console" to
  // permissions in plugin.json first, then uncomment:
  // const desk = await jp.console.get();
  // jp.console.onChange((now) => console.log(now.connected ? 'Console connected' : 'Console not connected'));

  // Planning Center: the plan, what's live and when the next service starts.
  // Add "planningCenter" to permissions in plugin.json first, then uncomment:
  // jp.planningCenter.onChange((pc) => console.log(pc.live ? `Live: ${pc.live.now.title}` : 'Nothing is live'));

  // A line on the plugin's tab in Settings: 'ok', 'warn' or 'error'
  jp.status('Running');

  // Anything to tidy up before it's stopped (timers, connections)
  jp.onStop(() => {});
};
