'use strict';
const path = require('path');
const { readJson, readArchive } = require('./backup-files');
const mixBackup = require('./mix-backup');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const copy = value => JSON.parse(JSON.stringify(value));
const homeLayoutsModule = () => require('./home-layouts'); // loaded when used
const deviceStageModule = () => require('./device-stage');
const consoleNamesModule = () => require('./console-names');
const definitions = [
  ['console', 'Console & network', 'Console type, addresses, ports, and channel/bus counts. Connection changes may restart the server.', ['consoleType','serverPort','deskIp','deskSendPort','deskListenPort','channels','auxes','groups','dliveBaseChannel','dliveTlsEnabled','dliveUsername','dlivePassword','dliveMidiPort','dliveListenSendLevels','dlivePollSendLevels','klangIp','klangPort','wingPort','lv1Port']],
  ['channels', 'Channel layout', 'Channel names, icons, order, visibility, and groups.', ['channelGroups','channelOverrides']],
  ['auxes', 'Aux layout & access', 'Mix names, colors, visibility, private links, and EQ access.', ['auxOverrides']],
  ['ipads', 'iPad relay connections', 'Configured OSC relay devices and ports.', ['ipadConnections']],
  ['behavior', 'Startup & backup behavior', 'Automatic startup, demo mode, snapshot recall, and backup schedule.', ['autoStart','keepAwake','demoMode','sceneRecallEnabled','performerEarScenes','autoBackupEnabled','autoBackupIntervalDays']],
  ['pco', 'Planning Center setup', 'Service, team, day, aux mappings, second service, room displays, and phone assignment.', ['pcoEnabled','pcoServiceTypeId','pcoTeamId','pcoDay','pcoPositionMapping','pcoAlt','pcoIncludeUnconfirmed','pcoGreenRoomHidden','greenRoomQr','greenRoomMics','pcoUpdateAuxNames','pcoFohPositionName','pcoFohTeamId','pcoProPresenterPositionName','pcoProPresenterTeamId','pcoLightingPositionName','pcoLightingTeamId','pcoSwitcherPositionName','pcoSwitcherTeamId','pcoPhoneAssignments']],
  ['pcoCredentials', 'Planning Center credentials', 'Application ID and Secret. Kept unless you explicitly select this option.', ['pcoAppId','pcoSecret']],
  ['branding', 'Branding', 'Accent color for the pages JPMixer serves. The logo image isn’t in backups; upload it again in Settings → Branding.', ['brandAccent']],
  ['access', 'FOH Home access code', 'The code other devices enter to open FOH Home.', ['fohAccessCode']],
  ['companion', 'Companion buttons', 'The Companion computer’s address, port and button grid for the Home pages.', ['companionEnabled','companionHost','companionPort','companionColumns','companionRows']],
  ['wireless', 'Shure wireless', 'Whether JPMixer reads Shure wireless receivers, the ones it has seen, which to read, and which mix each mic belongs to.', ['wirelessEnabled','wirelessReceivers','wirelessKnown','wirelessAux']],
  ['smaart', 'Smaart SPL', 'The Smaart computer’s address, port, API password, and the readings on FOH Home’s SPL card and the Green Room.', ['smaartEnabled','smaartHost','smaartPort','smaartPassword','smaartMetric','smaartLiveMetric','smaartHiddenInputs','greenRoomSpl','greenRoomSplMetric','greenRoomSplInput']],
  ['api', 'Control API', 'API enablement, port, and access token.', ['apiEnabled','apiPort','apiToken']]
];
const types = {
  channelGroups:'array', ipadConnections:'array', pcoGreenRoomHidden:'array', smaartHiddenInputs:'array', wirelessReceivers:'array', wirelessKnown:'array', wirelessAux:'object', channelOverrides:'object', auxOverrides:'object', pcoPositionMapping:'object', pcoAlt:'object'
};
const booleans = new Set(['pcoEnabled','greenRoomMics','wirelessEnabled','greenRoomSpl','smaartEnabled','greenRoomQr','autoStart','keepAwake','demoMode','sceneRecallEnabled','performerEarScenes','autoBackupEnabled','dliveTlsEnabled','dliveListenSendLevels','dlivePollSendLevels','pcoIncludeUnconfirmed','pcoUpdateAuxNames','pcoPhoneAssignments','apiEnabled','companionEnabled']);
const numbers = { serverPort:[1,65535],deskSendPort:[1,65535],deskListenPort:[1,65535],channels:[1,256],auxes:[0,256],groups:[0,256],dliveBaseChannel:[0,11],dliveMidiPort:[0,65535],klangPort:[0,65535],wingPort:[0,65535],lv1Port:[0,65535],apiPort:[1,65535],companionPort:[1,65535],companionColumns:[1,12],companionRows:[1,8],smaartPort:[1,65535],autoBackupIntervalDays:[1,365] };
function validateConfig(config) {
  if (!object(config)) throw new Error('Invalid configuration in this backup.');
  for (const key of definitions.flatMap(d => d[3])) {
    if (!own(config, key)) continue;
    const value = config[key];
    const valid = types[key] === 'array' ? Array.isArray(value) : types[key] === 'object' ? object(value) : booleans.has(key) ? typeof value === 'boolean' : numbers[key] ? Number.isInteger(value) && value >= numbers[key][0] && value <= numbers[key][1] : typeof value === 'string';
    if (!valid) throw new Error('Invalid ' + key + ' in this backup.');
  }
  for (const key of ['channelOverrides','auxOverrides']) if (config[key] && Object.entries(config[key]).some(([n,v]) => !/^[1-9]\d*$/.test(n) || !object(v))) throw new Error('Invalid ' + key + ' in this backup.');
  if (config.channelGroups?.some(group => !object(group) || !['string','number'].includes(typeof group.id) || typeof group.name !== 'string')) throw new Error('Invalid channel groups.');
  if (config.ipadConnections?.some(device => !object(device) || typeof device.ip !== 'string' || !Number.isInteger(device.sendPort) || device.sendPort < 1 || device.sendPort > 65535)) throw new Error('Invalid iPad connections.');
  if (config.pcoGreenRoomHidden?.some(name => typeof name !== 'string')) throw new Error('Invalid hidden Planning Center positions.');
  if (config.pcoPositionMapping && Object.values(config.pcoPositionMapping).some(aux => !Number.isInteger(Number(aux)) || Number(aux) < 1 || Number(aux) > 64)) throw new Error('Invalid Planning Center aux mapping.');
  if (config.wirelessReceivers?.some(r => !object(r) || typeof r.ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(r.ip))) throw new Error('Invalid Shure wireless receivers.');
  // The second service: 0 in its mapping takes a position off the mixes
  const alt = config.pcoAlt;
  if (alt && ((alt.positionMapping !== undefined && !object(alt.positionMapping)) || (alt.roles !== undefined && !object(alt.roles))
    || Object.values(alt.positionMapping || {}).some(aux => !Number.isInteger(Number(aux)) || Number(aux) < 0 || Number(aux) > 64)
    || ['serviceTypeId', 'teamId'].some(k => alt[k] !== undefined && typeof alt[k] !== 'string'))) throw new Error('Invalid second Planning Center service.');
}
function validateScenes(scenes) {
  if (!object(scenes)) throw new Error('Invalid Ear Scenes.');
  for (const auxes of Object.values(scenes)) {
    if (!object(auxes)) throw new Error('Invalid Ear Scenes.');
    for (const [aux, levels] of Object.entries(auxes)) {
      if (!/^[1-9]\d*$/.test(aux) || !object(levels) || Object.entries(levels).some(([ch,v]) => !/^[1-9]\d*$/.test(ch) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid Ear Scene levels.');
    }
  }
}
function normalize(data, filename) {
  let result;
  if (data?.app === 'JPMixer') {
    if (!['backup','mix-backup'].includes(data.type) || !Number.isInteger(data.version) || data.version < 1 || data.version > (data.type === 'backup' ? 2 : 1)) throw new Error('This backup format is not supported. Update JPMixer if it came from a newer version.');
    result = { kind: data.type === 'backup' ? 'JPMixer backup' : 'My Mixes backup', appVersion: data.appVersion, config: data.config, presets: data.presets, presetAliases: data.presetAliases, scenes: data.scenes, homeLayouts: data.type === 'backup' ? data.homeLayouts : undefined, deviceStage: data.type === 'backup' ? data.deviceStage : undefined, consoleNames: data.type === 'backup' ? data.consoleNames : undefined };
  } else if (filename.toLowerCase() === 'config.json' || (object(data) && ['consoleType','serverPort','pcoAppId','channelOverrides'].some(key => own(data,key)))) result = { kind:'Extracted configuration', config:data };
  else if (filename.toLowerCase() === 'scenes.json') result = { kind:'Extracted Ear Scenes', scenes:data };
  else if (filename.toLowerCase() === 'home-layouts.json') result = { kind:'Extracted Home page layouts', homeLayouts:data };
  else if (filename.toLowerCase() === 'device-stage.json') result = { kind:'Extracted Devices stage', deviceStage:data };
  else if (filename.toLowerCase() === 'console-names.json') result = { kind:'Extracted console names', consoleNames:data };
  else {
    let isScenes = false;
    if (object(data) && Object.keys(data).length) { try { validateScenes(data); isScenes = true; } catch {} }
    result = isScenes ? { kind:'Extracted Ear Scenes', scenes:data } : { kind:'Extracted My Mixes', presets:data };
  }
  // Settings that don't check out (a count the desk reported past what this
  // allows used to be one) mustn't take the saved mixes in the file with
  // them: the rest of the file can still be restored, with a note
  if (result.config !== undefined) {
    try { validateConfig(result.config); } catch (e) {
      const others = ['presets','scenes','homeLayouts','deviceStage','consoleNames'].some(key => result[key] !== undefined);
      if (!others) throw e;
      result.config = undefined; result.configProblem = e.message;
    }
  }
  if (result.presets !== undefined) {
    const validated = mixBackup.validate({ app:'JPMixer',type:'mix-backup',version:1,presets:result.presets,presetAliases:result.presetAliases ?? {} }, { allowEmpty: true });
    result.presets = validated.presets; result.mixCount = validated.mixes; result.deviceCount = validated.devices; result.droppedMixes = validated.dropped;
    if (!result.mixCount && !['presets.json'].includes(filename.toLowerCase()) && !data?.app) throw new Error('No recognizable backup content was found.');
  }
  if (result.scenes !== undefined) validateScenes(result.scenes);
  // Home page layouts: an invalid one is skipped rather than refusing the file
  if (result.homeLayouts !== undefined) result.homeLayouts = homeLayoutsModule().cleanAll(result.homeLayouts);
  if (result.deviceStage !== undefined) result.deviceStage = deviceStageModule().cleanAll(result.deviceStage);
  if (result.consoleNames !== undefined) result.consoleNames = consoleNamesModule().cleanAll(result.consoleNames);
  if (result.config === undefined && result.presets === undefined && result.scenes === undefined && result.homeLayouts === undefined && result.deviceStage === undefined && result.consoleNames === undefined) throw new Error('No recognizable backup content was found.');
  return result;
}
async function read(file) {
  if (path.extname(file).toLowerCase() !== '.zip') return normalize(readJson(file), path.basename(file));
  const files = await readArchive(file, name => /\.json$/i.test(name));
  const parsed = Object.create(null), exported = [];
  for (const [name,text] of Object.entries(files)) {
    try {
      parsed[name] = JSON.parse(text);
      if (parsed[name]?.app === 'JPMixer') exported.push(name);
    } catch { if (['config.json','presets.json','preset-aliases.json','scenes.json','home-layouts.json','device-stage.json','console-names.json'].includes(name)) throw new Error('Invalid JSON in ' + name); }
  }
  const raw = ['config.json','presets.json','scenes.json','home-layouts.json','device-stage.json','console-names.json'].filter(name => own(parsed,name));
  if (exported.length) {
    if (exported.length !== 1 || raw.length) throw new Error('This ZIP contains multiple backups. Choose a single backup file.');
    return normalize(parsed[exported[0]], exported[0]);
  }
  if (!raw.length) throw new Error('No JPMixer settings, saved mixes, or Ear Scenes were found in this ZIP.');
  const data = { app:'JPMixer',type:'backup',version:2 };
  for (const [name,key] of [['config.json','config'],['presets.json','presets'],['preset-aliases.json','presetAliases'],['scenes.json','scenes'],['home-layouts.json','homeLayouts'],['device-stage.json','deviceStage'],['console-names.json','consoleNames']]) if (own(parsed,name)) data[key] = parsed[name];
  const result = normalize(data, 'archive'); result.kind = 'Extracted JPMixer files (ZIP)'; return result;
}
function describe(data, filename) {
  const sections = [];
  for (const [id,label,description,fields] of definitions) {
    const present = fields.filter(key => data.config && own(data.config,key));
    if (!present.length) continue;
    if (id === 'pcoCredentials' && present.length !== 2) continue;
    const empty = id === 'pcoCredentials' && (!data.config.pcoAppId || !data.config.pcoSecret);
    // An export made without passwords and keys (see auto-backup.js) — say so,
    // rather than leave the missing credentials option unexplained
    const keptNote = { console: ['dlivePassword', 'the dLive password'], api: ['apiToken', 'the access token'], access: ['fohAccessCode', 'the FOH Home code'], pco: ['pcoSecret', 'Planning Center credentials'], smaart: ['smaartPassword', 'the Smaart API password'] }[id];
    const kept = keptNote && !own(data.config, keptNote[0]) ? ` This backup doesn’t include ${keptNote[1]}, so what’s set on this Mac is kept.` : '';
    sections.push({ id,label,description: empty ? 'This file has empty credentials. Selecting this will clear the corresponding current credentials.' : description + kept });
  }
  if (data.presets !== undefined) sections.push({ id:'mixes',label:'My Mixes',description:`${data.mixCount} saved mix(es) across ${data.deviceCount} device/person group(s).${data.droppedMixes ? ` ${data.droppedMixes} with invalid levels will be skipped.` : ''}`, count:data.mixCount });
  if (data.homeLayouts !== undefined) { const n = homeLayoutsModule().count(data.homeLayouts); if (n.layouts) sections.push({ id:'homeLayouts',label:'Home page layouts',description:`${n.layouts} saved layout(s) for ${n.people} team member(s). Replaces the same person’s layout on the same page; everyone else’s are kept.` }); }
  if (data.deviceStage !== undefined) { const n = deviceStageModule().count(data.deviceStage); if (n.arrangements) sections.push({ id:'deviceStage',label:'Devices stage arrangement',description:`Where each phone’s card sits on the Devices page (${n.cards} card(s)). Replaces the arrangement for the same number of mixes; any other is kept.` }); }
  if (data.consoleNames !== undefined) { const n = consoleNamesModule().count(data.consoleNames); if (n.channels || n.auxes) sections.push({ id:'consoleNames',label:'Console names',description:`The channel and mix names the console last reported (${n.channels} channel(s), ${n.auxes} mix(es)), shown while it’s off. Replaces them for the same console type; names typed in JPMixer are part of Channel and Aux layout.` }); }
  if (data.scenes !== undefined) sections.push({ id:'scenes',label:'Ear Scenes',description:`${Object.keys(data.scenes).length} snapshot(s). Session data; cleared on app restart. Snapshot recall may use these when snapshots change.` });
  if (data.configProblem && sections.length) sections[0] = { ...sections[0], description: `${sections[0].description} This backup’s settings can’t be restored (${data.configProblem.replace(/\.$/, '')}); the rest of it can.` };
  if (!sections.length) throw new Error('No supported restore sections were found.');
  return { filename,kind:data.kind,appVersion:typeof data.appVersion === 'string' ? data.appVersion : null,sections };
}
function plan(data, selected, mode, current) {
  if (!Array.isArray(selected) || !selected.length) throw new Error('Choose at least one section to restore.');
  const available = new Set(describe(data,'').sections.map(s => s.id));
  if (selected.some(id => !available.has(id))) throw new Error('A selected section is not included in this backup.');
  if (!['merge','replace'].includes(mode)) throw new Error('Choose how to restore My Mixes.');
  const config = copy(current); let configSelected = false;
  for (const [id,,,fields] of definitions) if (selected.includes(id)) for (const key of fields) if (own(data.config,key)) { config[key] = copy(data.config[key]); configSelected = true; }
  return { config,configSelected,mixes:selected.includes('mixes'),scenes:selected.includes('scenes'),homeLayouts:selected.includes('homeLayouts'),deviceStage:selected.includes('deviceStage'),consoleNames:selected.includes('consoleNames'),mode,selected:[...new Set(selected)] };
}
async function apply(data, selected, mode, deps) {
  const { config,presets,scenes,autoBackup } = deps;
  const homeLayouts = deps.homeLayouts || homeLayoutsModule();
  const deviceStage = deps.deviceStage || deviceStageModule();
  const consoleNames = deps.consoleNames || consoleNamesModule();
  const previous = { config:copy(config.getAll()),presets:copy(presets.getAll()),aliases:copy(presets.getAliases()),scenes:copy(scenes.getAll()),homeLayouts:homeLayouts.getAll(),deviceStage:deviceStage.getAll(),consoleNames:consoleNames.getAll() };
  const work = plan(data,selected,mode,previous.config);
  const safetyBackup = await autoBackup.writeBackup('before-selected-restore');
  let wroteConfig = false, wroteMixes = false, wroteScenes = false, wroteLayouts = false, wroteStage = false, wroteNames = false, mixes;
  try {
    if (work.configSelected) { if (!config.save(work.config)) throw new Error('Could not save the selected settings.'); wroteConfig = true; }
    if (work.mixes) {
      if (mode === 'merge') { mixes = presets.importMixes(data.presets,data.presetAliases || {}); if (!mixes.ok) throw new Error(mixes.error || 'Could not save My Mixes.'); }
      else { if (!presets.replaceAll(data.presets,data.presetAliases || {})) throw new Error('Could not replace My Mixes.'); mixes = { imported:data.mixCount,skipped:0,renamed:0,deviceIds:[...new Set([...Object.keys(previous.presets),...Object.keys(data.presets)])] }; }
      wroteMixes = true;
    }
    if (work.scenes) { if (!scenes.replaceAll(data.scenes)) throw new Error('Could not restore Ear Scenes.'); wroteScenes = true; }
    if (work.homeLayouts) { if (!homeLayouts.importAll(data.homeLayouts)) throw new Error('Could not restore Home page layouts.'); wroteLayouts = true; }
    if (work.deviceStage) { if (!deviceStage.importAll(data.deviceStage)) throw new Error('Could not restore the Devices stage arrangement.'); wroteStage = true; }
    if (work.consoleNames) { if (!consoleNames.importAll(data.consoleNames)) throw new Error('Could not restore the console names.'); wroteNames = true; }
    return { ok:true,selected:work.selected,configChanged:wroteConfig,scenesChanged:wroteScenes,mixes,previousConfig:previous.config,safetyBackup };
  } catch (error) {
    const rollback = [];
    if (wroteNames) rollback.push(consoleNames.replaceAll(previous.consoleNames));
    if (wroteStage) rollback.push(deviceStage.replaceAll(previous.deviceStage));
    if (wroteLayouts) rollback.push(homeLayouts.replaceAll(previous.homeLayouts));
    if (wroteScenes) rollback.push(scenes.replaceAll(previous.scenes));
    if (wroteMixes) rollback.push(presets.replaceAll(previous.presets,previous.aliases));
    if (wroteConfig) rollback.push(config.save(previous.config));
    return { ok:false,error:error.message + (rollback.some(ok => !ok) ? ' Recovery could not finish; restore the safety backup at ' + safetyBackup : ' Previous data was kept or restored.'),safetyBackup };
  }
}
module.exports = { read,normalize,describe,plan,apply };
