'use strict';

// ── Team chat for the Home pages (every one, custom ones too: home-roles.js) ─
// A "Team chat" card on each page (src/mixer/foh-chat.js). Mounted from
// mountFoh(), so it's on every console backend.
//
//   GET  /chat/history  the last messages
//   GET  /chat/stream   Server-Sent Events: each new message as it's sent
//   POST /chat/send     { role, name, text, clientId }
//
// A stream, not the phones' WebSocket: a chat card isn't a mixing device, so
// it mustn't show up in the Devices view or FOH Home's device count.
// History lives in this module, so it survives a server restart from
// Settings (the module stays loaded) but not quitting JPMixer — it's for
// today's service, not an archive. It also clears when the service moves
// on: when Planning Center's current plan changes (Saturday night's plan to
// Sunday morning's, or to the second service), every open chat card empties.
// `generation` changes with each clear, so a page that was asleep then
// reconnects knows to empty too.

const express = require('express');

const MAX_HISTORY = 200;
const MAX_TEXT = 500;
const MAX_NAME = 60;
const SEND_LIMIT = 10, SEND_WINDOW_MS = 10000; // per device
const homeRoles = require('./home-roles');

const history = [];
const streams = new Set(); // open SSE responses
const sendTimes = new Map(); // address -> recent send times
let nextId = 1;
let generation = Date.now(); // changes on every clear (and every launch)

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const address = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

function tooFast(addr) {
  const now = Date.now();
  if (sendTimes.size > 500) for (const [k, times] of sendTimes) if (!times.length || now - times[times.length - 1] > SEND_WINDOW_MS) sendTimes.delete(k);
  const times = (sendTimes.get(addr) || []).filter(t => now - t < SEND_WINDOW_MS);
  if (times.length >= SEND_LIMIT) { sendTimes.set(addr, times); return true; }
  times.push(now);
  sendTimes.set(addr, times);
  return false;
}

// Empties the chat everywhere: history, and every open chat card
function clearChat(reason) {
  history.length = 0;
  generation = Date.now();
  const frame = `event: clear\ndata: ${JSON.stringify({ generation, reason: reason || '' })}\n\n`;
  for (const res of streams) { try { res.write(frame); } catch (_) { streams.delete(res); } }
}

// Watches which plan is current (the same one the Home pages and Green Room
// show) and clears the chat when it changes. Only a plan actually read from
// Planning Center counts: if it can't be reached, nothing is cleared.
const PLAN_CHECK_MS = 3 * 60 * 1000;
let planTimer = null, currentPlan = null;
async function checkPlan() {
  try {
    const config = require('./config');
    const appId = config.get('pcoAppId'), secret = config.get('pcoSecret');
    if (!appId || !secret || !config.get('pcoServiceTypeId')) return;
    const { service, plan } = await require('./pco-services').activeService(require('./pco-client').shared, { appId, secret });
    if (!plan) return;
    const key = `${service.serviceTypeId}:${plan.id}`;
    if (currentPlan && key !== currentPlan && history.length) clearChat(plan.title || 'next service');
    currentPlan = key;
  } catch (_) { /* Planning Center unreachable: try again next time */ }
}

function post(message) {
  history.push(message);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  const frame = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
  for (const res of streams) { try { res.write(frame); } catch (_) { streams.delete(res); } }
}

let keepAlive = null;
function mountChat(app) {
  // A newly started server takes over: streams still open on the previous
  // one are ended so their pages reconnect here (EventSource does that itself)
  for (const res of streams) { try { res.end(); } catch (_) {} }
  streams.clear();
  if (!keepAlive) {
    // A comment line every 25s keeps proxies and sleepy Wi-Fi from closing the stream
    keepAlive = setInterval(() => { for (const res of streams) { try { res.write(': keepalive\n\n'); } catch (_) { streams.delete(res); } } }, 25000);
    if (keepAlive.unref) keepAlive.unref();
  }

  if (!planTimer) {
    checkPlan();
    planTimer = setInterval(checkPlan, PLAN_CHECK_MS);
    if (planTimer.unref) planTimer.unref();
  }

  app.get('/chat/history', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, messages: history, generation });
  });

  app.get('/chat/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
  });

  app.post('/chat/send', express.json({ limit: '4kb' }), (req, res) => {
    const role = clean(req.body?.role, 20);
    const text = clean(req.body?.text, MAX_TEXT);
    const page = homeRoles.get(role);
    if (!page || !text) { res.status(400).json({ ok: false, error: 'Type a message first.' }); return; }
    if (tooFast(address(req))) { res.status(429).json({ ok: false, error: 'Slow down a little — try again in a few seconds.' }); return; }
    const message = { id: nextId++, at: new Date().toISOString(), role, roleLabel: page.short, name: clean(req.body?.name, MAX_NAME), clientId: clean(req.body?.clientId, 40), text };
    post(message);
    res.json({ ok: true, message });
  });
}

// For tests
function reset() { history.length = 0; sendTimes.clear(); nextId = 1; currentPlan = null; }

module.exports = { mountChat, reset, clearChat, checkPlan, MAX_TEXT };
