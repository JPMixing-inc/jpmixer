'use strict';
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const MAX_BYTES = 32 * 1024 * 1024;
function readJson(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('Backup is too large (32 MB maximum).');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('That file is not valid JSON.'); }
}
function readArchive(file, accepts) {
  if (fs.statSync(file).size > MAX_BYTES) return Promise.reject(new Error('Backup is too large (32 MB maximum).'));
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(new Error('Could not read ZIP: ' + error.message));
      const files = Object.create(null); let total = 0, entries = 0, settled = false;
      const fail = error => { if (settled) return; settled = true; zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        if (++entries > 2000) return fail(new Error('This ZIP contains too many files.'));
        const name = path.posix.basename(entry.fileName);
        if (entry.fileName.split('/').includes('__MACOSX') || !accepts(name)) return zip.readEntry();
        if (Object.hasOwn(files, name)) return fail(new Error('This ZIP contains multiple ' + name + ' files. Choose one backup.'));
        if (total + entry.uncompressedSize > MAX_BYTES) return fail(new Error('Backup data is too large (32 MB maximum).'));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', chunk => { total += chunk.length; if (total > MAX_BYTES) { stream.destroy(); fail(new Error('Backup data is too large (32 MB maximum).')); } else chunks.push(chunk); });
          stream.on('end', () => { if (settled) return; files[name] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        });
      });
      zip.on('end', () => { if (!settled) { settled = true; resolve(files); } });
      zip.readEntry();
    });
  });
}
module.exports = { readJson, readArchive };
