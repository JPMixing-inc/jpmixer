'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const updater = require('../src/server/updater');

const sha = (buf) => 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
const asset = (name) => ({ name, size: 1, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/x/' + name });

test('picks this computer’s file from both the 1.7.x (per-arch) and 2.0 (universal) release layouts', () => {
  const old = { assets: [asset('JPMixer-1.7.9-arm64.dmg'), asset('JPMixer-1.7.9.dmg'), asset('JPMixer.Setup.1.7.9.exe')] };
  assert.equal(updater.pickAsset(old, 'darwin', 'arm64').name, 'JPMixer-1.7.9-arm64.dmg');
  assert.equal(updater.pickAsset(old, 'darwin', 'x64').name, 'JPMixer-1.7.9.dmg');
  assert.equal(updater.pickAsset(old, 'win32', 'x64').name, 'JPMixer.Setup.1.7.9.exe');
  const universal = { assets: [asset('JPMixer-1.8.1.dmg')] };
  assert.equal(updater.pickAsset(universal, 'darwin', 'arm64').name, 'JPMixer-1.8.1.dmg');
  assert.equal(updater.pickAsset(universal, 'darwin', 'x64').name, 'JPMixer-1.8.1.dmg');
  assert.equal(updater.pickAsset(universal, 'win32', 'x64'), null, 'no Windows installer in this release');
  assert.equal(updater.pickAsset({ assets: [asset('JPMixer-1.8.1-arm64.dmg')] }, 'darwin', 'x64'), null, 'an Intel Mac never gets the Apple Silicon-only file');
});

test('only GitHub over HTTPS, and a local test feed only on loopback', () => {
  assert(updater.hostAllowed('https://github.com/JPMixing-inc/jpmixer/releases/download/v1/a.dmg'));
  assert(updater.hostAllowed('https://release-assets.githubusercontent.com/x'));
  assert(!updater.hostAllowed('http://github.com/a.dmg'), 'plain HTTP is refused');
  assert(!updater.hostAllowed('https://github.com.evil.example/a.dmg'));
  assert(!updater.hostAllowed('https://example.com/a.dmg'));
  assert(!updater.hostAllowed('http://127.0.0.1:9/a.dmg'), 'loopback only when testing');
  assert(updater.hostAllowed('http://127.0.0.1:9/a.dmg', true));
  assert(!updater.isLoopbackUrl('http://192.168.1.5:9/feed'));
  assert(!updater.isLoopbackUrl(undefined));
});

test('a release file without a published checksum is never downloaded', async () => {
  assert.equal(updater.expectedSha256({ digest: null }), null);
  await assert.rejects(updater.download({ name: 'a.dmg', browser_download_url: 'https://github.com/a.dmg' }, '/nonexistent'), /no checksum/);
});

test('downloads follow GitHub-style redirects and must match size and checksum, or the file is deleted', async (t) => {
  const good = crypto.randomBytes(200000);
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
    if (req.url === '/elsewhere') { res.writeHead(302, { Location: 'https://example.com/file' }); return res.end(); }
    res.writeHead(200, { 'Content-Length': good.length }); res.end(good);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpm-updater-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const progress = [];
  const dest = path.join(dir, 'ok.dmg');
  await updater.download({ name: 'ok.dmg', size: good.length, digest: sha(good), browser_download_url: base + '/redirect' }, dest, { allowLoopback: true, onProgress: f => progress.push(f) });
  assert.deepEqual(fs.readFileSync(dest), good);
  assert.equal(progress.at(-1), 1);
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);

  const bad = path.join(dir, 'bad.dmg');
  await assert.rejects(updater.download({ name: 'bad.dmg', size: good.length, digest: sha(Buffer.from('other')), browser_download_url: base + '/file' }, bad, { allowLoopback: true }), /checksum/);
  assert(!fs.existsSync(bad), 'a file that fails the check is removed');

  await assert.rejects(updater.download({ name: 'short.dmg', size: good.length + 1, digest: sha(good), browser_download_url: base + '/file' }, path.join(dir, 'short.dmg'), { allowLoopback: true }), /incomplete/);
  await assert.rejects(updater.download({ name: 'x.dmg', size: 1, digest: sha(good), browser_download_url: base + '/elsewhere' }, path.join(dir, 'x.dmg'), { allowLoopback: true }), /Refused/);
});

test('the app replaces itself only from a normal, writable .app bundle', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpm-bundle-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'JPMixer.app', 'Contents', 'MacOS', 'JPMixer');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  assert.equal(updater.currentMacBundle(exe), path.join(dir, 'JPMixer.app'));
  assert.equal(updater.currentMacBundle('/Volumes/JPMixer-1.8.0/JPMixer.app/Contents/MacOS/JPMixer'), null, 'not from the mounted DMG');
  assert.equal(updater.currentMacBundle(path.join(dir, 'node_modules', 'electron', 'dist', 'Electron')), null, 'not a dev run');
});

test('the swap script takes its paths as arguments and puts the old app back if the copy fails', () => {
  const s = updater.MAC_SWAP_SCRIPT;
  assert.match(s, /TARGET="\$2"; STAGED="\$3"/);
  assert.match(s, /rm -rf "\$TARGET"; mv "\$OLD" "\$TARGET"/);
  assert(!/\$\{?[a-z]/.test(s.replace(/\$\(seq[^)]*\)/, '')), 'no unquoted lowercase interpolation');
});

test('reads the signing developer from codesign, and treats unsigned or ad-hoc apps as unsigned', async () => {
  const signed = 'Executable=/Applications/JPMixer.app/Contents/MacOS/JPMixer\nIdentifier=com.jpmixing.oscmixer\nAuthority=Developer ID Application: Example (AB12CD34EF)\nTeamIdentifier=AB12CD34EF\nSealed Resources version=2\n';
  assert.equal(updater.parseSigningTeam(signed), 'AB12CD34EF');
  assert.equal(updater.parseSigningTeam('Identifier=x\nSignature=adhoc\nTeamIdentifier=not set\n'), null);
  assert.equal(updater.parseSigningTeam('Identifier=x\nTeamIdentifier=not set\n'), null);
  assert.equal(updater.parseSigningTeam(''), null);
  if (process.platform === 'darwin') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpm-sig-'));
    try {
      const app = path.join(dir, 'Fake.app');
      fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
      assert.equal(await updater.macSigningTeam(app), null, 'an unsigned bundle has no team, so no requirement is set');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the update dialog shows release notes as plain text, not the HTML and Markdown written for GitHub', () => {
  const body = [
    '<p align="center">',
    '  <img src="https://raw.githubusercontent.com/x/logo.svg" alt="JPMixer" width="360" />',
    '</p>',
    '',
    '<h3 align="center">Version 2.0</h3>',
    '<p align="center"><b>One app, every station.</b></p>',
    '',
    '---',
    '',
    '> [!TIP]',
    '> **Upgrading from 1.7.x?** Your mixes carry over &amp; stay put. See [the guide](https://example.com/guide).',
    '',
    '## ✨ Highlights',
    '',
    '- 🏠 **Home pages** for every station.',
    '- 💬 `Team chat`.',
    '',
    '<table><tr><td align="center"><img src="https://x/1.png" alt="Mix picker" /><br/><sub><b>Find your mix</b></sub></td></tr></table>',
    '![screenshot](https://x/2.png)',
  ].join('\n');
  const text = updater.releaseSummary(body, 2000);
  assert.doesNotMatch(text, /<|>|\[!|\*\*|`|https?:|---/, text);
  assert.equal(text.split('\n')[0], 'Version 2.0', 'starts with the notes themselves, not a logo');
  assert.match(text, /Upgrading from 1\.7\.x\? Your mixes carry over & stay put\. See the guide\./);
  assert.match(text, /^• 🏠 Home pages for every station\.$/m);
  assert.match(text, /^• 💬 Team chat\.$/m);
  assert.match(text, /Find your mix/);
  assert.equal(updater.releaseSummary('## What’s new\n\nFaster mutes.'), 'Faster mutes.', 'the dialog says "What\'s new" already');
  assert.ok(updater.releaseSummary('word '.repeat(300)).length <= 601, 'long notes are cut short');
});
