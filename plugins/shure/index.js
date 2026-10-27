'use strict';

// Shure wireless, as an official JPMixer plugin. Finding and reading the
// receivers is in shure.js (as it was inside JPMixer); this hands it its
// settings and shares what it reads with JPMixer, which answers FOH Home's
// Wireless card, the musician's phone, Monitor Engineer and the Green Room
// from it:
//   share 'status'    getStatus() (for Settings: receivers found and read)
//   share 'channels'  channelsForPages() (every channel of every receiver read)
//   share 'save'      receivers it has learned, for JPMixer to keep in its config
// Shared when something changes (at most four times a second) and every few
// seconds (a switched-off transmitter's "last battery" ages).
// Its settings are JPMixer's own (Settings → Plugins → Shure wireless),
// passed in as they are, and change without a restart.

const shure = require('./shure');

const SHARE_EVERY_MS = 250, REFRESH_MS = 5000;

module.exports = (jp) => {
  let last = { status: '', channels: '' }, due = false, lastShared = 0;
  const share = (force) => {
    due = false; lastShared = Date.now();
    const status = shure.getStatus();
    const channels = shure.channelsForPages();
    const s = JSON.stringify(status), c = JSON.stringify(channels);
    if (force || s !== last.status) { last.status = s; jp.integration.share('status', status); }
    if (force || c !== last.channels) { last.channels = c; jp.integration.share('channels', channels); }
    const read = status.receivers.length, up = status.receivers.filter((r) => r.status === 'connected').length;
    const line = !status.enabled ? 'Off' : read ? `Reading ${up} of ${read} receiver${read === 1 ? '' : 's'}` : 'Listening for receivers';
    if (line !== last.line) { last.line = line; jp.status(line, read && up < read ? 'warn' : 'ok'); }
  };
  shure.setChangeListener(() => { due = true; });
  // What it has learned (receivers seen, one followed to a new address): to JPMixer's config
  shure.setSaver((patch) => jp.integration.share('save', patch));

  jp.integration.handle('status', () => shure.getStatus());
  jp.integration.handle('channels', () => shure.channelsForPages());

  // Tests only (JPMixer never sends these): a stand-in receiver's port, and no listening for announcements
  const forTests = (settings) => {
    if (Number.isInteger(settings._testCommandPort)) shure._setCommandPort(settings._testCommandPort);
    if (settings._testNoDiscovery === true) shure._noDiscovery(true);
  };
  jp.onSettings((settings) => { forTests(settings); shure.applyConfig(settings); share(); });
  forTests(jp.settings);
  shure.applyConfig(jp.settings);
  share(true);
  const timer = setInterval(() => { if (due || Date.now() - lastShared >= REFRESH_MS) share(); }, SHARE_EVERY_MS);
  jp.onStop(() => { clearInterval(timer); shure.stop(); });
};
