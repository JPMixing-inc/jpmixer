'use strict';

// Browser-facing WebSocket handlers that are the same on every console
// backend (DiGiCo, dLive, KLANG, WING): My Mixes storage and sync, Find My
// Mixes, and the Devices view's activity feed. None of these touch a console,
// so each backend calls into one copy instead of keeping its own — the
// backends only differ in how a mix is *applied* to the desk (apply-preset).

const WebSocket = require('ws');
const presets   = require('./presets');
const config    = require('./config');

// Saved mixes and Ear Scenes use the browser's 0..1 fader position on every
// backend. Only values sent to the console (and cached OSC levels) use dB.
function sliderToDb(value) {
  if (value === 0) return -150;
  return 50 * Math.log10(value * 100) - 90;
}

function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch (_) {}
}

// Handles one parsed client message. Returns true when it was one of these
// shared types (the caller then stops), false to let the backend handle it.
// ctx.logEvent(type, detail) — the backend's event log.
// ctx.onActivity(msg, ws)     — publish a device-activity notice (see broadcastActivity).
function handleSharedMessage(ws, msg, ctx) {
  switch (msg.type) {
    // Personal named mixes — stored per-device, aux-agnostic. Levels and pans
    // are stored without an aux so they work whichever aux the performer is
    // on; the aux (and owner) are recorded only so Find My Mixes and Settings
    // can tell groups apart.
    case 'save-preset': {
      const name = (msg.name || '').trim();
      if (!name || !msg.deviceId) return true;
      ctx.logEvent('preset-save', `device:${String(msg.deviceId).slice(0, 8)} name:"${name}"`);
      const owner = typeof msg.owner === 'string' ? msg.owner.trim().slice(0, 64) : '';
      const presetAux = parseInt(msg.aux, 10);
      const saved = presets.savePreset(msg.deviceId, name, msg.levels, msg.pans, {
        owner,
        aux: isNaN(presetAux) ? (ws._activeAux ?? null) : presetAux
      });
      if (!saved) { send(ws, { type: 'preset-sync-error', name, seq: msg.seq }); return true; }
      // Confirm to the phone so it can drop this from its unsynced queue
      send(ws, { type: 'preset-synced', name, seq: msg.seq });
      ws._lastActivityAt = Date.now();
      ctx.onActivity({ type: 'device-activity', deviceId: ws._deviceId || null, aux: ws._activeAux ?? null, kind: 'save-mix', name }, ws);
      return true;
    }
    case 'delete-preset': {
      if (!msg.deviceId) return true;
      ctx.logEvent('preset-delete', `device:${String(msg.deviceId).slice(0, 8)} name:"${msg.name}"`);
      if (!presets.deletePreset(msg.deviceId, msg.name)) {
        send(ws, { type: 'preset-sync-error', name: msg.name, seq: msg.seq });
        return true;
      }
      send(ws, { type: 'preset-synced', name: msg.name, seq: msg.seq });
      return true;
    }
    // The phone's server backup, merged into its list on every connect
    case 'request-device-presets':
      if (msg.deviceId) send(ws, { type: 'device-presets', presets: presets.getByDevice(msg.deviceId) });
      return true;
    // Find My Mixes — search every device's backed-up mixes by owner or mix
    // name, then fetch one picked result's mixes to copy onto this phone.
    // Read-only: the original device's backup is never changed.
    case 'find-presets':
      send(ws, { type: 'found-presets', query: msg.query || '', groups: presets.findGroups(msg.query, msg.deviceId) });
      return true;
    case 'request-found-presets':
      if (msg.fromDeviceId) send(ws, { type: 'found-device-presets', fromDeviceId: msg.fromDeviceId, presets: presets.getByDevice(msg.fromDeviceId) });
      return true;
    // Devices view asking for the activity feed (see broadcastActivity)
    case 'subscribe-activity':
      ws._wantsActivity = true;
      return true;
    default:
      return false;
  }
}

// device-activity only drives the Devices view's activity dots, so it goes
// just to sockets that sent subscribe-activity — relaying every fader move as
// a second message to every phone grew with performers². Fader/pan notices
// are also capped at one per sender per 250ms; save notices always go out.
const ACTIVITY_MIN_INTERVAL_MS = 250;
function broadcastActivity(connections, msg, fromWs) {
  if (fromWs && (msg.kind === 'level' || msg.kind === 'pan')) {
    const now = Date.now();
    if (now - (fromWs._lastActivityBroadcastAt || 0) < ACTIVITY_MIN_INTERVAL_MS) return;
    fromWs._lastActivityBroadcastAt = now;
  }
  const payload = JSON.stringify(msg);
  for (const conn of connections) {
    if (conn._wantsActivity && conn.readyState === WebSocket.OPEN) {
      try { conn.send(payload); } catch (_) {}
    }
  }
}

// After Settings merges device groups, hand the merged mixes to any phone that
// is connected under one of the merged ids — mixer.js merges them into its list
function pushDevicePresets(connections, deviceId) {
  const target = presets.resolve(deviceId);
  for (const conn of connections) {
    if (conn._deviceId && presets.resolve(conn._deviceId) === target && conn.readyState === WebSocket.OPEN) {
      send(conn, { type: 'device-presets', presets: presets.getByDevice(target) });
    }
  }
}

// Live relabeling — the External Control API's main use case (e.g. a Planning
// Center connector naming aux mixes after who's playing them). Updates the
// backend's in-memory config, persists via config.updateOverride() (not the
// full save-config path, which would restart the backend), and tells
// connected pages so labels change with no reconnect. Same on every backend
// apart from the default channel count.
function relabel(serverCfg, kind, n, label, maxDefault, broadcastToClients) {
  const num = parseInt(n, 10);
  const max = (kind === 'aux' ? serverCfg.auxes : serverCfg.channels) || maxDefault;
  if (!Number.isInteger(num) || num < 1 || num > max || typeof label !== 'string') return false;
  const key = kind === 'aux' ? 'auxOverrides' : 'channelOverrides';
  if (!serverCfg[key]) serverCfg[key] = {};
  serverCfg[key][String(num)] = { ...(serverCfg[key][String(num)] || {}), label };
  config.updateOverride(kind, num, { label });
  broadcastToClients(kind === 'aux'
    ? { type: 'aux-relabeled', aux: num, label }
    : { type: 'channel-relabeled', channel: num, label });
  return true;
}

module.exports = { handleSharedMessage, broadcastActivity, pushDevicePresets, relabel, sliderToDb };
