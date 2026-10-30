'use strict';

// Companion buttons, as an official JPMixer plugin. The Satellite connection
// to Companion is in companion.js (as it was inside JPMixer); this hands it
// its settings, shares the surfaces with JPMixer (which streams them to the
// Home pages) and passes taps back:
//   share 'surface'  { role, event: 'snapshot' | 'key' | 'clear', data }
//   share 'status'   getStatus(), when it changes
//   integration call 'press'    { role, key, pressed } → true if sent
//   integration call 'snapshot' { role } → the surface now
//   integration call 'extras'   { surfaces: [{ role: 'ev-<id>' | 'hp-<id>', label, columns, rows }] }
//                               the Custom Pages plugin's surfaces (JPMixer passes them on),
//                               and the Home pages a church added (from 1.3.0)
// Its settings are JPMixer's own (Settings → Plugins → Companion: the
// address, whether the Home pages get surfaces, their grid), passed in as
// they are, and change without a restart.

const companion = require('./companion');

module.exports = (jp) => {
  let lastStatus = '';
  const shareStatus = () => {
    const status = companion.getStatus();
    const json = JSON.stringify(status);
    if (json === lastStatus) return;
    lastStatus = json;
    jp.integration.share('status', status);
    jp.status(status.message || '', status.state === 'error' ? 'warn' : 'ok');
  };
  companion.setEventListener((role, event, data) => {
    jp.integration.share('surface', { role, event, data });
    if (event === 'snapshot') shareStatus();
  });
  const everySurface = () => { for (const role of Object.keys(companion.ROLES)) jp.integration.share('surface', { role, event: 'snapshot', data: companion.snapshot(role) }); };

  jp.integration.handle('press', (body) => companion.press(String((body && body.role) || ''), Number(body && body.key), (body && body.pressed) === true));
  jp.integration.handle('snapshot', (body) => {
    const role = String((body && body.role) || '');
    return companion.isRole(role) ? companion.snapshot(role) : null;
  });
  jp.integration.handle('extras', (body) => { companion.setExtras(body && body.surfaces); return true; });
  jp.integration.handle('status', () => companion.getStatus());

  jp.onSettings((settings) => { companion.applyConfig(settings); shareStatus(); everySurface(); });
  companion.applyConfig(jp.settings);
  shareStatus();
  everySurface(); // JPMixer starts with every surface as it is now
  jp.onStop(() => companion.stop()); // tells Companion to drop the surfaces
};
