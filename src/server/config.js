const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  autoStart: true,
  serverPort: 8080,
  consoleType: 'digico',
  deskIp: '192.168.1.100',
  deskSendPort: 8000,
  deskListenPort: 8001,
  channels: 48,
  auxes: 16,
  groups: 8,
  matrices: 8,
  channelGroups: [],
  channelOverrides: {},
  auxOverrides: {},
  sceneRecallEnabled: false,
  ipadConnections: [],
  autoBackupEnabled: true,
  autoBackupIntervalDays: 7,
  demoMode: false,
  // dLive (MIDI over TCP/IP) — only read when consoleType is 'dlive'. Reuses
  // deskIp above for the console's address, same as the DiGiCo path does.
  dliveBaseChannel: 0,
  dliveTlsEnabled: false,
  dliveUsername: '',
  dlivePassword: '',
  // 0 = use the spec-documented default (51325, or 51327 with TLS). Override
  // if that port doesn't respond on real hardware — see the port note in
  // dlive-client.js's file header.
  dliveMidiPort: 0,
  // How to keep aux send levels in sync — see dlive-server.js's file header.
  // Both on by default until push is confirmed reliable on real hardware.
  dliveListenSendLevels: true,
  dlivePollSendLevels: true,
  // KLANG (for dLive consoles) — only read when consoleType is 'klang'. The
  // dLive* fields above are reused for this mode's optional secondary
  // connection (channel names + Ear Scene sync) — see klang-server.js.
  klangIp: '',
  klangPort: 0, // 0 = use the documented default (9110)
  // Behringer WING — only read when consoleType is 'wing'. Reuses deskIp
  // above for the console's address, same as the DiGiCo/dLive paths do —
  // WING is self-contained, no secondary connection needed.
  wingPort: 0 // 0 = use the documented default (2223)
};

let _config = { ...DEFAULTS };
let _configPath = null;

function configPath() {
  if (!_configPath) {
    _configPath = path.join(app.getPath('userData'), 'config.json');
  }
  return _configPath;
}

function load() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      _config = { ...DEFAULTS, ...data };
    }
  } catch (e) {
    console.error('Config load error:', e);
  }
}

function save(incoming) {
  _config = { ...DEFAULTS, ...incoming };
  try {
    fs.writeFileSync(configPath(), JSON.stringify(_config, null, 2));
  } catch (e) {
    console.error('Config save error:', e);
  }
}

function get(key) {
  return _config[key] !== undefined ? _config[key] : DEFAULTS[key];
}

function getAll() {
  return { ..._config };
}

load();
module.exports = { get, getAll, save };
