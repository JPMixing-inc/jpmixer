'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

const config  = require('./config');
const presets = require('./presets');
const scenes  = require('./scenes');

// Backup file format, shared by auto-backups and Settings → Export Backup.
// v2 added scenes and presetAliases; v1 files (config + presets only) are
// still accepted on import, and leave Ear Scenes and aliases untouched.
const BACKUP_VERSION = 2;

function buildBackupData() {
  return {
    app: 'JPMixer',
    type: 'backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    config: config.getAll(),
    presets: presets.getAll(),
    presetAliases: presets.getAliases(),
    scenes: scenes.getAll()
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

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_MS;
  for (const b of listBackups()) {
    if (b.mtime < cutoff) {
      try { fs.unlinkSync(b.path); } catch (e) {}
    }
  }
}

// `label` tags safety backups taken right before a destructive action
// (import, mix merge) so they're easy to spot in the folder
async function writeBackup(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(backupsDir(), `auto-backup-${stamp}${label ? '-' + label : ''}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(buildBackupData(), null, 2));
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

module.exports = { start, maybeRunBackup, getStatus, listBackups, backupsDir, writeBackup, buildBackupData, BACKUP_VERSION };
