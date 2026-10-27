'use strict';

// Smaart SPL, as an official JPMixer plugin. The connection to Smaart is in
// smaart.js (as it was inside JPMixer); this hands it its settings and
// shares what it reads with JPMixer, which answers FOH Home's SPL card and
// the Green Room from it:
//   share 'status'    getStatus(), when it changes
//   share 'snapshot'  what the card shows, at most four times a second
//   integration call 'reading' { metric, input }  one reading for the Green Room
// Its settings are JPMixer's own Smaart settings (Settings → Plugins →
// Smaart SPL), passed in as they are, and change without a restart.

const smaart = require('./smaart');

const SNAPSHOT_EVERY_MS = 250;

module.exports = (jp) => {
  let lastStatus = '', lastSnapshot = '';
  const shareStatus = () => {
    const status = smaart.getStatus();
    const json = JSON.stringify(status);
    if (json === lastStatus) return;
    lastStatus = json;
    jp.integration.share('status', status);
    jp.status(status.message || '', status.state === 'error' ? 'warn' : 'ok');
  };
  const shareSnapshot = () => {
    const snap = smaart.snapshot();
    const json = JSON.stringify(snap);
    if (json !== lastSnapshot) { lastSnapshot = json; jp.integration.share('snapshot', snap); }
  };
  smaart.setChangeListener(() => { shareStatus(); shareSnapshot(); });

  jp.integration.handle('reading', (body) => smaart.singleReading(String((body && body.metric) || ''), String((body && body.input) || '')));
  jp.integration.handle('status', () => smaart.getStatus());
  jp.integration.handle('snapshot', () => smaart.snapshot());

  jp.onSettings((settings) => { smaart.applyConfig(settings); shareStatus(); shareSnapshot(); });
  smaart.applyConfig(jp.settings);
  shareStatus();
  shareSnapshot();
  // The readings change many times a second: shared at most four times a second, when they've changed
  const timer = setInterval(() => { shareSnapshot(); shareStatus(); }, SNAPSHOT_EVERY_MS);
  jp.onStop(() => { clearInterval(timer); smaart.stop(); });
};
