'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

const config  = require('./config');
const presets = require('./presets');
const scenes  = require('./scenes');
const { writeFileAtomic } = require('./safe-write');

// Backup file format, shared by auto-backups and Settings → Export Backup.
// v2 added scenes and presetAliases; v1 files (config + presets only) are
// still accepted on import, and leave Ear Scenes and aliases untouched.
const BACKUP_VERSION = 2;

// Left out of an exported backup unless the engineer asks for them — those
// files get copied to USB sticks and other computers. Auto-backups keep
// them: they sit next to config.json and are what recovers it if it breaks.
// A restore without these keeps the credentials already on this Mac.
const CREDENTIAL_KEYS = ['pcoAppId', 'pcoSecret', 'dlivePassword', 'apiToken', 'fohAccessCode', 'smaartPassword'];

function buildBackupData({ includeCredentials = true } = {}) {
  const cfg = config.getAll();
  if (!includeCredentials) for (const key of CREDENTIAL_KEYS) delete cfg[key];
  return {
    app: 'JPMixer',
    type: 'backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    credentialsIncluded: includeCredentials,
    config: cfg,
    presets: presets.getAll(),
    presetAliases: presets.getAliases(),
    scenes: scenes.getAll(),
    homeLayouts: require('./home-layouts').getAll(), // Home page layouts per team member
    deviceStage: require('./device-stage').getAll()  // the Devices page stage arrangement
  };
}

const RETENTION_MS    = 30 * 24 * 60 * 60 * 1000; // prune backups older than a month
const CHECK_INTERVAL_MS = 60 * 60 * 1000;          // re-check hourly — cheap, and catches missed launches

let _dir = null;
function backupsDir() {
  if (!_dir) {
    _dir = path.join(app.getPath('userData'), 'auto-backups');
    try { fs.mkdirSync(_dir, { recursive: true }); } catch (e) {}
  }
  return _dir;
}

function listBackups() {
  try {
    return fs.readdirSync(backupsDir())
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const p = path.join(backupsDir(), f);
        return { file: f, path: p, mtime: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    return [];
  }
}

// The newest few are always kept, however old. Pruning purely by age could
// delete every backup (including the safety ones before a restore or merge)
// after a long gap between launches, or while auto-backup is turned off,
// leaving nothing for corrupt-file recovery to fall back on.
const KEEP_NEWEST = 5;

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_MS;
  for (const b of listBackups().slice(KEEP_NEWEST)) {
    if (b.mtime < cutoff) {
      try { fs.unlinkSync(b.path); } catch (e) {}
    }
  }
}

// `label` tags safety backups taken right before a destructive action
// (import, mix merge) so they're easy to spot in the folder. Each backup
// goes to its own unique timestamped filename (never overwrites an earlier
// one), so writeFileAtomic's temp-then-rename isn't protecting against
// corrupting prior backups here — it's just consistency with the rest of
// the persistence layer (config.js/presets.js/scenes.js), and it means a
// crash mid-write never leaves a half-written .json in the backups folder
// for readLatestBackupSection() to trip over. Stays an async function
// (callers await it) even though the write itself is now synchronous.
async function writeBackup(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(backupsDir(), `auto-backup-${stamp}${label ? '-' + label : ''}.json`);
  writeFileAtomic(filePath, JSON.stringify(buildBackupData(), null, 2));
  return filePath;
}

async function maybeRunBackup() {
  if (!config.get('autoBackupEnabled')) { pruneOldBackups(); return; }

  const intervalMs = (Number(config.get('autoBackupIntervalDays')) || 7) * 24 * 60 * 60 * 1000;
  const last = listBackups()[0];

  if (!last || (Date.now() - last.mtime) >= intervalMs) {
    try { await writeBackup(); } catch (e) { console.error('[JPMixer] Auto-backup failed:', e); }
  }
  pruneOldBackups();
}

let _timer = null;
function start() {
  setTimeout(maybeRunBackup, 5000); // give the app a moment to settle on launch
  if (_timer) clearInterval(_timer);
  _timer = setInterval(maybeRunBackup, CHECK_INTERVAL_MS);
}

function getStatus() {
  const backups = listBackups();
  return {
    enabled: !!config.get('autoBackupEnabled'),
    intervalDays: Number(config.get('autoBackupIntervalDays')) || 7,
    lastBackup: backups[0] ? new Date(backups[0].mtime).toISOString() : null,
    count: backups.length
  };
}

module.exports = { start, maybeRunBackup, getStatus, listBackups, backupsDir, writeBackup, buildBackupData, BACKUP_VERSION, CREDENTIAL_KEYS };
