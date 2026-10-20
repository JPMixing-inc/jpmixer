'use strict';

// ── Custom branding ─────────────────────────────────────────────────────────
// An uploaded logo and accent color (Settings → Branding) replace the
// JPMixer logo and red on every page JPMixer serves — performer mixer,
// monitor, devices, console, FOH/role Home pages, Green Room. Settings
// itself, the launch splash, the favicon, and the app/tray icons always stay
// JPMixer. With nothing set, pages are exactly as before.
//
// Pages link /branding.css last (so it wins over each page's own --accent)
// and load brand.js, which swaps the logo images; see src/mixer/brand.js.
// The logo file lives in userData/branding, named by its hash so a new upload
// is a new URL (cached forever, never stale).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOGO_NAME = /^logo-[0-9a-f]{16}\.(png|jpg|jpeg|webp|gif|svg)$/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

// Electron and config are looked up when used, so the console backends'
// tests can load this module without either
const userData = () => require('electron').app.getPath('userData');
const config = () => require('./config');

function brandingDir() { return path.join(userData(), 'branding'); }

function logoPath(name = config().get('brandLogo')) {
  if (!name || !LOGO_NAME.test(name)) return null;
  const p = path.join(brandingDir(), name);
  return fs.existsSync(p) ? p : null;
}

function accent(value = config().get('brandAccent')) {
  const a = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(a) ? a.toLowerCase() : null;
}

function state() {
  const p = logoPath();
  return { logo: p ? `/brand-logo/${path.basename(p)}` : null, accent: accent() };
}

function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function mix(hex, target, amount) {
  return '#' + rgb(hex).map((c, i) => Math.round(c + (target[i] - c) * amount).toString(16).padStart(2, '0')).join('');
}

// The page overrides. Variable names match original-theme.css and each
// page's own :root (--accent, --jp-accent-rgb, --tint …).
function css(st = state()) {
  const out = ['/* JPMixer custom branding — generated from Settings */'];
  if (st.accent) {
    const [r, g, b] = rgb(st.accent);
    out.push(`:root { --accent: ${st.accent}; --accent-dim: ${mix(st.accent, [0, 0, 0], 0.24)}; --jp-accent-rgb: ${r}, ${g}, ${b}; --jp-accent-soft: ${mix(st.accent, [255, 255, 255], 0.42)}; --tint: ${r},${g},${b}; }`);
  }
  if (st.logo) {
    out.push(
      `:root { --jpm-brand-logo: "${st.logo}"; }`, // read by brand.js
      // Hidden until brand.js has put the custom logo in, so the JPMixer
      // logo never flashes first
      'img.jp-wordmark:not(.jp-custom-logo), img.jp-emblem:not(.jp-custom-logo), img.jp-fallback-logo:not(.jp-custom-logo), img.jp-empty-logo:not(.jp-custom-logo) { visibility: hidden; }',
      // One logo at every size: the small JP emblem swap on phones isn't needed
      '.jp-brand .jp-emblem { display: none !important; }',
      '.jp-brand .jp-wordmark.jp-custom-logo { display: block !important; width: auto; height: 30px; max-width: 180px; object-fit: contain; object-position: left center; }',
      '.picker-brand.jp-brand .jp-wordmark.jp-custom-logo { height: 52px; max-width: 280px; }',
      'img.jp-fallback-logo.jp-custom-logo, img.jp-empty-logo.jp-custom-logo { height: auto; max-height: 64px; object-fit: contain; }',
      // The phone top bar keeps only 28px for the JP emblem; give a logo its own width
      '@media (max-width: 600px) { .topbar { grid-template-columns: auto minmax(0, 1fr) auto; } .topbar .jp-brand .jp-wordmark.jp-custom-logo { height: 24px; max-width: 76px; } }'
    );
  }
  return out.join('\n') + '\n';
}

// Copies a chosen image into the branding folder; returns its stored name.
// The engineer picks the file in Settings; nothing here is reachable from a
// phone.
function importLogo(sourcePath) {
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  if (!TYPES[ext]) throw new Error('Choose a PNG, JPG, WebP, GIF or SVG image.');
  const stat = fs.statSync(sourcePath);
  if (stat.size > MAX_LOGO_BYTES) throw new Error('That image is larger than 5 MB. Choose a smaller file.');
  const data = fs.readFileSync(sourcePath);
  const name = `logo-${crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)}.${ext}`;
  fs.mkdirSync(brandingDir(), { recursive: true });
  fs.writeFileSync(path.join(brandingDir(), name), data, { mode: 0o600 });
  return name;
}

function dataUrl(name) {
  const p = logoPath(name);
  if (!p) return null;
  return `data:${TYPES[path.extname(p).slice(1)]};base64,${fs.readFileSync(p).toString('base64')}`;
}

// Removes stored logos other than the one in use (after a save)
function pruneLogos(keep = config().get('brandLogo')) {
  try {
    for (const f of fs.readdirSync(brandingDir())) if (LOGO_NAME.test(f) && f !== keep) fs.unlinkSync(path.join(brandingDir(), f));
  } catch (_) {}
}

function mountBranding(app) {
  app.get('/branding.json', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(state()); });
  app.get('/branding.css', (req, res) => { res.set('Cache-Control', 'no-store'); res.type('text/css').send(css()); });
  app.get('/brand-logo/:name', (req, res) => {
    const p = logoPath();
    if (!p || req.params.name !== path.basename(p)) { res.status(404).end(); return; }
    // An SVG opened directly must not run anything on this origin
    res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'X-Content-Type-Options': 'nosniff' });
    res.type(TYPES[path.extname(p).slice(1)]).sendFile(p);
  });
}

module.exports = { mountBranding, state, css, accent, logoPath, importLogo, dataUrl, pruneLogos, LOGO_NAME };
