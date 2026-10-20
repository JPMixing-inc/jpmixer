'use strict';

// ── In-app updates from GitHub Releases ─────────────────────────────────────
// Downloads the release file for this computer, checks it against the
// SHA-256 digest GitHub publishes for every release asset, and installs it:
//   - macOS: the DMG is mounted read-only, the app inside is checked (bundle
//     id and version, and — once JPMixer itself is signed — that it's
//     signed by the same developer and its signature is intact) and copied out, and a small helper script swaps it in
//     once JPMixer has quit, then reopens it. If the swap fails the old app
//     is put back.
//   - Windows: the NSIS installer runs silently and relaunches the app.
// Nothing is installed from a file whose digest is missing or doesn't match.
// No Electron dependency here, so it's testable on its own (updater.test.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');

const BUNDLE_ID = 'com.jpmixing.oscmixer';
const GITHUB_HOSTS = ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'];

// A test feed (JPMIXER_UPDATE_FEED) is only honored on this computer's own
// loopback address, so it can't be pointed anywhere else.
function isLoopbackUrl(url) {
  try { const u = new URL(url); return u.protocol === 'http:' && u.hostname === '127.0.0.1'; } catch { return false; }
}

function hostAllowed(url, allowLoopback) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (allowLoopback && isLoopbackUrl(url)) return true;
  return u.protocol === 'https:' && (GITHUB_HOSTS.includes(u.hostname) || u.hostname.endsWith('.githubusercontent.com'));
}

function get(url, { allowLoopback = false, headers = {} } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!hostAllowed(url, allowLoopback)) return reject(new Error('Refused to download from ' + new URL(url).hostname));
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'JPMixer-Updater', ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new Error('Too many redirects'));
        return resolve(get(new URL(res.headers.location, url).toString(), { allowLoopback, headers }, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download failed (HTTP ${res.statusCode})`)); }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error('GitHub stopped responding')));
    req.on('error', reject);
  });
}

async function getJson(url, opts) {
  const res = await get(url, { ...opts, headers: { Accept: 'application/vnd.github+json' } });
  let body = '';
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

// The file for this computer. Releases up to 1.7.x had separate -arm64 and
// Intel DMGs; from 2.0 one universal DMG (no arch suffix) covers both.
function pickAsset(release, platform = process.platform, arch = process.arch) {
  const assets = (release && release.assets) || [];
  if (platform === 'darwin') {
    const dmgs = assets.filter(a => /\.dmg$/i.test(a.name));
    const plain = dmgs.filter(a => !/-(arm64|x64|universal)\.dmg$/i.test(a.name));
    const order = arch === 'arm64'
      ? [dmgs.filter(a => /-arm64\.dmg$/i.test(a.name)), dmgs.filter(a => /-universal\.dmg$/i.test(a.name)), plain]
      : [dmgs.filter(a => /-x64\.dmg$/i.test(a.name)), dmgs.filter(a => /-universal\.dmg$/i.test(a.name)), plain];
    for (const list of order) if (list.length) return list[0];
    return null;
  }
  if (platform === 'win32') return assets.find(a => /setup.*\.exe$/i.test(a.name)) || null;
  return null;
}

function expectedSha256(asset) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(asset && asset.digest || ''));
  return m ? m[1].toLowerCase() : null;
}

// Streams the asset to `dest`, hashing as it goes. Deletes the file and
// rejects unless the size and SHA-256 both match what GitHub lists.
async function download(asset, dest, { onProgress, allowLoopback = false } = {}) {
  const want = expectedSha256(asset);
  if (!want) throw new Error('This release file has no checksum to verify it against.');
  const res = await get(asset.browser_download_url, { allowLoopback });
  const total = Number(res.headers['content-length']) || asset.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest, { mode: 0o600 });
  let received = 0;
  try {
    await new Promise((resolve, reject) => {
      res.on('data', (chunk) => { hash.update(chunk); received += chunk.length; if (onProgress && total) onProgress(received / total); });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
    if (asset.size && received !== asset.size) throw new Error('The download was incomplete.');
    if (hash.digest('hex') !== want) throw new Error('The download didn’t match its published checksum, so it wasn’t installed.');
  } catch (err) {
    try { fs.unlinkSync(dest); } catch (_) {}
    throw err;
  }
  return dest;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()));
  });
}

async function readBundleInfo(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const [id, version] = await Promise.all([
    run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]),
    run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]),
  ]);
  return { id, version };
}

// The .app bundle this process runs from, or null when it isn't one that
// can be replaced in place (a dev run, the mounted DMG, App Translocation,
// or a folder this account can't write to).
function currentMacBundle(exePath) {
  const bundle = path.resolve(exePath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return null;
  if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null;
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); } catch { return null; }
  return bundle;
}

// The Developer ID team in `codesign -dv` output, or null for an unsigned or
// ad-hoc signed app
function parseSigningTeam(output) {
  const out = String(output || '');
  if (/Signature=adhoc/.test(out)) return null;
  const team = ((/^TeamIdentifier=(.+)$/m.exec(out) || [])[1] || '').trim();
  return team && team !== 'not set' ? team : null;
}
function macSigningTeam(appPath) {
  return new Promise((resolve) => {
    // codesign writes these details to stderr
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], (err, stdout, stderr) => resolve(err ? null : parseSigningTeam(stderr)));
  });
}

// Mounts the DMG read-only, checks the app inside and copies it out. Always
// detaches, whatever happens. With `requireTeam` (this JPMixer is signed), the
// new app must be signed by that same developer, with an intact signature.
async function stageMacApp(dmgPath, workDir, expectedVersion, { requireTeam = null } = {}) {
  const mount = path.join(workDir, 'mnt');
  fs.mkdirSync(mount, { recursive: true });
  await run('/usr/bin/hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount]);
  try {
    const name = fs.readdirSync(mount).find(f => f.endsWith('.app'));
    if (!name) throw new Error('The download didn’t contain the JPMixer app.');
    const info = await readBundleInfo(path.join(mount, name));
    if (info.id !== BUNDLE_ID) throw new Error('The download contained a different app, so it wasn’t installed.');
    if (info.version !== expectedVersion) throw new Error(`The download is version ${info.version}, not ${expectedVersion}.`);
    const staged = path.join(workDir, 'staged', 'JPMixer.app');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    await run('/usr/bin/ditto', [path.join(mount, name), staged]);
    if (requireTeam) {
      const team = await macSigningTeam(staged);
      if (team !== requireTeam) throw new Error('The download isn’t signed by the same developer as this JPMixer, so it wasn’t installed.');
      try { await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]); }
      catch (_) { throw new Error('The download’s signature didn’t check out, so it wasn’t installed.'); }
    }
    return staged;
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {});
  }
}

// Runs after JPMixer quits: swap the bundle, put the old one back if that
// fails, reopen. Paths arrive as arguments, never pasted into the script.
const MAC_SWAP_SCRIPT = `#!/bin/bash
PID="$1"; TARGET="$2"; STAGED="$3"; WORK="$4"
for i in $(seq 1 300); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
OLD="$TARGET.jpmixer-update-old"
rm -rf "$OLD"
if mv "$TARGET" "$OLD"; then
  if /usr/bin/ditto "$STAGED" "$TARGET"; then
    rm -rf "$OLD"
  else
    rm -rf "$TARGET"; mv "$OLD" "$TARGET"
  fi
fi
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
/usr/bin/open "$TARGET"
rm -rf "$WORK"
`;

function launchMacSwap({ pid, target, staged, workDir }) {
  const script = path.join(workDir, 'install.sh');
  fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o700 });
  const child = spawn('/bin/bash', [script, String(pid), target, staged, workDir], { detached: true, stdio: 'ignore' });
  child.unref();
}

// NSIS: /S installs silently; --force-run reopens the app afterwards
function launchWindowsInstaller(installerPath) {
  const child = spawn(installerPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' });
  child.unref();
}

function makeWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-update-'));
}

module.exports = {
  BUNDLE_ID, isLoopbackUrl, hostAllowed, getJson, pickAsset, expectedSha256, download,
  readBundleInfo, parseSigningTeam, macSigningTeam, currentMacBundle, stageMacApp, launchMacSwap, launchWindowsInstaller, makeWorkDir, MAC_SWAP_SCRIPT,
};
