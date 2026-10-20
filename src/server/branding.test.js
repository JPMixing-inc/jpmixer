'use strict';
// Run with: node src/server/branding.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-branding-test-'));

const assert = require('node:assert/strict');
const express = require('express');
const config = require('./config');
const branding = require('./branding');

let n = 0;
function t(name) { n++; console.log('ok -', name); }
const get = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, (res) => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d })); }).on('error', reject));

async function main() {
  assert.equal(branding.css().includes(':root'), false, 'nothing is overridden on a normal install');
  assert.deepEqual(branding.state(), { logo: null, accent: null });
  t('with nothing set, pages get no overrides and keep the JPMixer logo');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-branding-src-'));
  const svg = path.join(dir, 'Church Logo.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0fb5a8"/></svg>');
  const name = branding.importLogo(svg);
  assert.match(name, branding.LOGO_NAME);
  const txt = path.join(dir, 'notes.txt'); fs.writeFileSync(txt, 'x');
  assert.throws(() => branding.importLogo(txt), /PNG, JPG/);
  const big = path.join(dir, 'huge.png'); fs.writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.throws(() => branding.importLogo(big), /5 MB/);
  assert.match(branding.dataUrl(name), /^data:image\/svg\+xml;base64,/);
  t('logos import as hashed files; other file types and anything over 5 MB are refused');

  config.save({ ...config.getAll(), brandLogo: name, brandAccent: '#0FB5A8' });
  const css = branding.css();
  assert.match(css, /--accent: #0fb5a8;/);
  assert.match(css, /--jp-accent-rgb: 15, 181, 168;/);
  assert.match(css, new RegExp(`--jpm-brand-logo: "/brand-logo/${name}"`));
  config.save({ ...config.getAll(), brandAccent: 'red; } body { display: none' });
  assert.equal(branding.accent(), null, 'only a #rrggbb color ever reaches the stylesheet');
  assert.equal(branding.css().includes('body {'), false, 'the injected rule never reaches the stylesheet');
  config.save({ ...config.getAll(), brandAccent: '#0fb5a8' });
  t('the stylesheet carries the accent and logo, and rejects anything but a hex color');

  const app = express();
  branding.mountBranding(app);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const logo = await get(port, `/brand-logo/${name}`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers['content-type'].split(';')[0], 'image/svg+xml');
  assert.match(logo.headers['content-security-policy'], /default-src 'none'/, 'an SVG opened directly can’t run scripts');
  assert.equal((await get(port, '/brand-logo/logo-0000000000000000.svg')).status, 404);
  assert.equal((await get(port, '/brand-logo/..%2Fconfig.json')).status, 404);
  assert.deepEqual(JSON.parse((await get(port, '/branding.json')).body), { logo: `/brand-logo/${name}`, accent: '#0fb5a8' });
  server.close();
  t('only the current logo is served, with a locked-down SVG policy');

  const otherFile = path.join(dir, 'other.png');
  fs.writeFileSync(otherFile, 'png-bytes');
  const other = branding.importLogo(otherFile);
  branding.pruneLogos();
  assert(!fs.existsSync(path.join(process.env.JPM_TEST_USERDATA, 'branding', other)), 'an upload that was never saved is removed');
  assert(fs.existsSync(path.join(process.env.JPM_TEST_USERDATA, 'branding', name)), 'the logo in use is kept');
  t('pruning keeps the logo in use and removes the rest');

  console.log(`\n${n} checks passed`);
}
main().catch((err) => { console.error(err); process.exit(1); });
