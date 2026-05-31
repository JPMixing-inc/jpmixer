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
  ipadConnections: []
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
