'use strict';
const express = require('express');
const config = require('./config');
const pco = require('./pco-client');
const presets = require('./presets');
const autoBackup = require('./auto-backup');
let cached = null, pending = null, cacheKey = null, expires = 0;
const personKey = id => 'pco-person:' + id;

function buildAssignments(members, mapping, auxCount, overrides, includeUnconfirmed, day) {
  const people = new Map();
  for (const member of members) {
    if (!member.personId || member.declined || !(includeUnconfirmed || member.confirmed) || (day && member.days?.length && !member.days.includes(day))) continue;
    const position = Object.keys(mapping).find(key => key.toLowerCase() === (member.positionName || '').toLowerCase());
    const aux = Number(mapping[position]);
    if (!Number.isInteger(aux) || aux < 1 || aux > auxCount || overrides[aux]?.enabled === false || overrides[aux]?.linkOnly === true) continue;
    const id = String(member.personId);
    if (!people.has(id)) people.set(id, { personId: id, name: member.personName, roles: [], auxes: new Set() });
    const person = people.get(id); person.auxes.add(aux);
    if (!person.roles.includes(member.positionName)) person.roles.push(member.positionName);
  }
  // Ambiguous assignments require an engineer to fix the mapping; never guess.
  return [...people.values()].map(person => ({ personId: person.personId, name: person.name, roles: person.roles, aux: person.auxes.size === 1 ? [...person.auxes][0] : null, ambiguous: person.auxes.size !== 1 })).sort((a, b) => a.name.localeCompare(b.name));
}

async function roster() {
  if (!config.get('pcoPhoneAssignments') || config.get('pcoUpdateAuxNames') === false) return { ok: true, enabled: false, people: [] };
  const appId = config.get('pcoAppId'), secret = config.get('pcoSecret'), service = config.get('pcoServiceTypeId');
  if (!appId || !secret || !service) return { ok: false, enabled: true, error: 'Planning Center is not configured yet.' };
  const key = JSON.stringify([appId, secret, service, config.get('pcoDay'), config.get('pcoIncludeUnconfirmed'), config.get('pcoPositionMapping'), config.get('auxes'), config.get('auxOverrides')]);
  if (key === cacheKey && cached && Date.now() < expires) return cached;
  if (key === cacheKey && pending) return pending;
  cacheKey = key;
  const work = (async () => {
    try {
      const creds = { appId, secret }, plan = await pco.nextPlan(service, creds);
      if (!plan) return { ok: true, enabled: true, people: [] };
      const members = await pco.planTeamMembers(service, plan.id, creds);
      const rawDay = config.get('pcoDay');
      const day = rawDay === 'auto' ? await pco.resolveAutoDay(service, plan.id, creds) : rawDay;
      return { ok: true, enabled: true, plan: { id: plan.id, title: plan.title }, people: buildAssignments(members, config.get('pcoPositionMapping') || {}, Number(config.get('auxes')), config.get('auxOverrides') || {}, !!config.get('pcoIncludeUnconfirmed'), day) };
    } catch { return { ok: false, enabled: true, error: 'Planning Center is unavailable. You can still choose a mix manually.' }; }
  })();
  pending = work;
  const result = await work;
  if (cacheKey === key) { cached = result; expires = Date.now() + (result.ok ? 30000 : 5000); pending = null; }
  return result;
}

function mountPerformerAssignments(app) {
  app.get('/performer-assignments', async (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(await roster()); });
  app.post('/performer-identity', express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const data = await roster();
      if (!data.ok || !data.enabled) return res.json({ ok: false, error: data.error || 'Automatic performer assignment is off.' });
      const person = data.people.find(p => p.personId === req.body?.personId);
      if (!person || person.ambiguous) return res.json({ ok: false, error: 'This performer has no single active aux assignment. Choose a mix manually or ask the engineer to check the mapping.' });
      const id = personKey(person.personId);
      if (req.body.copyExisting === true) {
        const source = req.body.deviceId;
        if (typeof source !== 'string' || !source || source.startsWith('pco-person:')) return res.json({ ok: false, error: 'Choose this phone’s original saved mixes to link.' });
        const bucket = presets.getByDevice(source);
        if (Object.keys(bucket).length) {
          await autoBackup.writeBackup('before-person-link');
          const copied = Object.create(null);
          for (const [name, mix] of Object.entries(bucket)) copied[name] = { ...mix, owner: person.name };
          const result = presets.importMixes({ [id]: copied });
          if (!result.ok) return res.json(result);
        }
      }
      res.json({ ok: true, ...person, deviceId: id });
    } catch { res.json({ ok: false, error: 'Could not link saved mixes. Your existing mixes are still available.' }); }
  });
}
module.exports = { buildAssignments, roster, personKey, mountPerformerAssignments };
