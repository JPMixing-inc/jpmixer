'use strict';
// Run with: node src/server/auto-backup.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-autobackup-test-'));

const assert = require('node:assert/strict');
const autoBackup = require('./auto-backup');

let n = 0;
function t(name) { n++; console.log('ok -', name); }

function seedOld(count) {
  const dir = autoBackup.backupsDir();
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  const old = Date.now() / 1000 - 90 * 24 * 3600;
  for (let i = 0; i < count; i++) {
    const f = path.join(dir, `auto-backup-old-${i}.json`);
    fs.writeFileSync(f, '{}');
    fs.utimesSync(f, old + i, old + i);
  }
}

async function main() {
  seedOld(8);
  await autoBackup.maybeRunBackup();
  const files = autoBackup.listBackups().map(b => b.file);
  assert.equal(files.length, 5, 'the new backup plus the 4 newest old ones');
  assert(files.some(f => !f.includes('-old-')), 'a fresh backup was written');
  t('pruning removes old backups but always keeps the newest 5');

  seedOld(8);
  require('./config').save({ ...require('./config').getAll(), autoBackupEnabled: false });
  await autoBackup.maybeRunBackup();
  assert.equal(autoBackup.listBackups().length, 5, 'with auto-backup off, the newest 5 old backups are still kept');
  t('with auto-backup turned off, old backups are pruned down to 5, never to zero');

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
