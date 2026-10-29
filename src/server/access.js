'use strict';

// ── Access codes, and JPMixer's own windows ────────────────────────────────
// FOH Home and the Console Controller can each need a code (Settings →
// Pages). A device that enters the right one gets a cookie derived from it,
// so changing the code signs every device out.
//
// This computer doesn't need the codes, but it's recognised by a pass, not by
// its address: the port 80 helper (and Windows' port forwarding) hands every
// phone's connection to JPMixer from this computer's own address, so trusting
// the address let every phone in. The pass is a cookie JPMixer puts in its own
// windows (main.js), and a browser opened from Settings gets it through a
// one-time link (?jpm_pass=…, good for a minute, once).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Loaded when first needed: the backends' tests load them without Electron
const config = { get: (key) => require('./config').get(key) };

const LOCAL_COOKIE = 'jpm_local';
const ONE_YEAR_S = 31536000;

// Kept across restarts (in userData), so a browser given the pass keeps it
let secret = null;
function localSecret() {
  if (secret) return secret;
  const file = path.join(require('electron').app.getPath('userData'), 'local-pass.key');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(saved)) return (secret = saved);
  } catch (_) { /* made below */ }
  secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch (e) { console.error('[JPMixer] Couldn’t save this computer’s pass:', e.message); }
  return secret;
}
const localPass = () => crypto.createHmac('sha256', localSecret()).update('jpmixer-local-v1').digest('hex').slice(0, 40);

function readCookie(req, name) {
  for (const part of String((req && req.headers && req.headers.cookie) || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch (_) { return ''; } }
  }
  return '';
}
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// A request from one of JPMixer's own windows, or a browser opened from Settings
const fromThisComputer = (req) => sameText(readCookie(req, LOCAL_COOKIE), localPass());

// ── One-time links ──
const ONE_TIME_MS = 60 * 1000;
const oneTime = new Map(); // token -> expires at
function oneTimeLink(url) {
  const now = Date.now();
  for (const [k, at] of oneTime) if (at < now) oneTime.delete(k);
  const token = crypto.randomBytes(18).toString('hex');
  oneTime.set(token, now + ONE_TIME_MS);
  const u = new URL(url);
  u.searchParams.set('jpm_pass', token);
  return u.toString();
}
function takeOneTime(token) {
  const at = typeof token === 'string' ? oneTime.get(token) : undefined;
  if (at === undefined) return false;
  oneTime.delete(token);
  return at >= Date.now();
}
// Before every page: a one-time link sets the pass and loads the page without it
function mountOneTimeLinks(appExpress) {
  appExpress.use((req, res, next) => {
    if (req.method !== 'GET' || !req.query || req.query.jpm_pass === undefined) return next();
    const ok = takeOneTime(String(req.query.jpm_pass));
    const u = new URL(req.originalUrl, 'http://x');
    u.searchParams.delete('jpm_pass');
    if (ok) res.set('Set-Cookie', `${LOCAL_COOKIE}=${localPass()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ONE_YEAR_S}`);
    res.set('Cache-Control', 'no-store');
    res.redirect(302, u.pathname + u.search);
  });
}

// ── Codes ──
// The cookie each code gives a device. FOH Home's salt is the one it has
// always used, so devices already signed in stay signed in.
const KINDS = {
  foh:     { key: 'fohAccessCode', cookie: 'jpm_foh', salt: 'jpmixer-foh-home-v1' },
  console: { key: 'consoleAccessCode', cookie: 'jpm_console', salt: 'jpmixer-console-v1' },
};
const codeOf = (kind) => String(config.get(KINDS[kind].key) || '').trim();
const cookieFor = (kind, code) => crypto.createHmac('sha256', code).update(KINDS[kind].salt).digest('hex').slice(0, 40);
function hasAccess(req, kind) {
  const code = codeOf(kind);
  return !code || fromThisComputer(req) || sameText(readCookie(req, KINDS[kind].cookie), cookieFor(kind, code));
}

// Guesses are limited per device (address and browser). Behind the port 80
// helper every device has this computer's address, so the limit is shared.
const UNLOCK_TRIES = 8, UNLOCK_WINDOW_MS = 5 * 60 * 1000;
const unlockTries = new Map(); // kind:address -> { count, resetAt }
const clientAddress = (req) => String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
function tooManyTries(key) {
  const now = Date.now();
  if (unlockTries.size > 500) for (const [k, v] of unlockTries) if (v.resetAt < now) unlockTries.delete(k);
  const entry = unlockTries.get(key);
  if (!entry || entry.resetAt < now) { unlockTries.set(key, { count: 1, resetAt: now + UNLOCK_WINDOW_MS }); return false; }
  entry.count++;
  return entry.count > UNLOCK_TRIES;
}
// POST <path> { code }: the right code sets that code's cookie
function unlock(kind) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = codeOf(kind);
    if (!code) { res.json({ ok: true }); return; }
    const key = `${kind}:${clientAddress(req)}`;
    if (tooManyTries(key)) { res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' }); return; }
    if (!sameText(String((req.body && req.body.code) || '').trim(), code)) { res.status(403).json({ ok: false, error: 'That code isn’t right.' }); return; }
    unlockTries.delete(key);
    res.set('Set-Cookie', `${KINDS[kind].cookie}=${cookieFor(kind, code)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ONE_YEAR_S}`);
    res.json({ ok: true });
  };
}

// The Console Controller's code, on every backend that has the Console
// Controller (osc-server, dlive-server, lv1-server): its messages are only
// taken from a socket that has access. Checked on each message, so a new code
// locks devices out at once.
function mountConsoleAccess(appExpress) {
  const express = require('express');
  appExpress.get('/console-access', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, needCode: !hasAccess(req, 'console') }); });
  appExpress.post('/console-unlock', express.json({ limit: '2kb' }), unlock('console'));
}
const CONSOLE_MESSAGES = new Set(['request-console-state', 'console-fader', 'console-mute', 'console-solo', 'aux-fader', 'aux-mute', 'cg-fader', 'cg-mute', 'cg-solo', 'console-param', 'request-channel-detail', 'extra-fader', 'extra-mute']);
// The WebSocket's own upgrade request carries the cookies
function noteSocket(ws, req) { ws._accessHeaders = { cookie: (req && req.headers && req.headers.cookie) || '' }; }
// true when the message may go ahead; a locked one is answered with console-locked
function consoleMessageAllowed(ws, msg) {
  if (!msg || !CONSOLE_MESSAGES.has(msg.type)) return true;
  if (hasAccess({ headers: ws._accessHeaders || {} }, 'console')) return true;
  try { ws.send(JSON.stringify({ type: 'console-locked' })); } catch (_) {}
  return false;
}

module.exports = {
  LOCAL_COOKIE, localPass, fromThisComputer, oneTimeLink, mountOneTimeLinks,
  hasAccess, unlock, codeOf, mountConsoleAccess, noteSocket, consoleMessageAllowed, CONSOLE_MESSAGES,
  readCookie, sameText, clientAddress,
};
