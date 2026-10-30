'use strict';

const fs   = require('fs');
const path = require('path');

// Write to a temp file, then rename it over the real one — a crash or power
// loss mid-write leaves either the old file or the new one, never a
// half-written one that fails to parse on the next launch.
// Owner-only (0600): config.json and the backups hold the Planning Center
// secret, dLive password and API token, so other accounts on the Mac
// shouldn't be able to read them.
function writeFileAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  try { fs.unlinkSync(tmp); } catch (_) {} // a leftover temp file would keep its old mode
  // Handed to the drive before the rename: without the flush, a power cut
  // just after could leave the renamed file empty, and the saved mixes would
  // come back from an auto-backup up to a week old. (macOS's fsync stops at
  // the drive; its own cache needs F_FULLFSYNC, which Node can't ask for.
  // This narrows the window rather than closing it.)
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  const fd = fs.openSync(tmp, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Windows can refuse the rename while something (e.g. antivirus) briefly
    // holds the target open — fall back to a direct write rather than lose the save
    fs.writeFileSync(filePath, data);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return;
  }
  // The rename itself is in the folder: flushed too (Windows can't open a folder this way)
  if (process.platform !== 'win32') {
    try { const dir = fs.openSync(path.dirname(filePath), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch (_) {}
  }
}

// Reads a JSON data file that must hold a plain object. Returns null when the
// file doesn't exist. If it exists but is unreadable, the broken file is moved
// aside (so the next save can't overwrite whatever is still recoverable in
// it) and the given section of the newest auto-backup is returned instead —
// or {} when no backup has it. `onCorrupt(message)` is told either way.
function loadJsonObject(filePath, userDataDir, backupSection, onCorrupt) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch (e) {
    const aside = filePath.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    try { fs.renameSync(filePath, aside); } catch (_) {}
    const restored = readLatestBackupSection(userDataDir, backupSection);
    const name = path.basename(filePath);
    if (onCorrupt) {
      onCorrupt(`${name} unreadable (${e.message}) — moved to ${path.basename(aside)}; ` +
        (restored ? 'restored from the latest auto-backup' : 'no auto-backup had it, starting empty'));
    }
    return restored || {};
  }
}

// Newest auto-backup that has `section` (e.g. 'presets', 'scenes', 'config').
// Reads the backups folder directly rather than through auto-backup.js, which
// requires the data modules that call this.
function readLatestBackupSection(userDataDir, section) {
  try {
    const dir = path.join(userDataDir, 'auto-backups');
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ p: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const { p } of files) {
      try {
        const backup = JSON.parse(fs.readFileSync(p, 'utf8'));
        const value = backup && backup[section];
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

module.exports = { writeFileAtomic, loadJsonObject };
