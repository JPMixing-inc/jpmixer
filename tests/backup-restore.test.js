'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const restore=require('../src/server/backup-restore');
const root=path.resolve(__dirname,'..'),plain=value=>JSON.parse(JSON.stringify(value));
const sample={ app:'JPMixer',type:'backup',version:2,appVersion:'1.8.0',config:{consoleType:'digico',serverPort:9000,channelGroups:[],channelOverrides:{},auxOverrides:{},pcoAppId:'backup-app',pcoSecret:'backup-secret',pcoServiceTypeId:'backup-service',pcoPositionMapping:{ Vocal:6 },apiEnabled:false,apiPort:9096,apiToken:'backup-token'},presets:{ imported:{ Sunday:{ levels:{ 1:0.8 },pans:{ 1:0.5 } } } },scenes:{ Sunday:{ 6:{ 1:0.8 } } } };
function harness(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jpm-selected-restore-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const stores={};
  function load(name){ const context={module:{exports:{}},console:{error(){}},require(request){if(request==='electron')return {app:{getPath:()=>dir,getVersion:()=> '1.8.0'}};if(request.startsWith('./')&&stores[request.slice(2)])return stores[request.slice(2)];return require(request.startsWith('./')?path.join(root,'src/server',request):request);}};vm.runInNewContext(fs.readFileSync(path.join(root,'src/server',name+'.js'),'utf8'),context);return context.module.exports; }
  const config=stores.config=load('config'),presets=stores.presets=load('presets'),scenes=stores.scenes=load('scenes'),homeLayouts=stores['home-layouts']=load('home-layouts'),deviceStage=stores['device-stage']=load('device-stage'),autoBackup=stores['auto-backup']=load('auto-backup');
  config.save({...config.getAll(),pcoAppId:'current-app',pcoSecret:'current-secret',pcoServiceTypeId:'current-service',apiToken:'current-token'});
  presets.savePreset('existing','Keep',{1:0.2},{1:0.3});presets.replaceAll(plain(presets.getAll()),{});scenes.saveScene('Current',1,{1:0.3});
  const files=()=>Object.fromEntries(['config.json','presets.json','preset-aliases.json','scenes.json'].map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]));
  return {dir,config,presets,scenes,homeLayouts,deviceStage,autoBackup,files};
}
function failWriteOnce(match,fn){ const original=fs.writeFileSync; let failed=false;fs.writeFileSync=function(file,...args){if(!failed&&String(file).includes(match)){failed=true;throw Error('simulated disk failure');}return original.call(this,file,...args);};return Promise.resolve().then(fn).finally(()=>{fs.writeFileSync=original;}); }

test('full backup inspection separates credentials and never exposes their values',()=>{
  const data=restore.normalize(sample,'backup.json'),description=restore.describe(data,'backup.json');
  assert(description.sections.some(s=>s.id==='pco'));assert(description.sections.some(s=>s.id==='pcoCredentials'));assert(description.sections.some(s=>s.id==='mixes'));assert(description.sections.some(s=>s.id==='scenes'));
  assert.equal(JSON.stringify(description).includes('backup-secret'),false);assert.equal(JSON.stringify(description).includes('backup-token'),false);
  const empty=restore.normalize({...sample,config:{pcoAppId:'',pcoSecret:''}},'backup.json');assert.match(restore.describe(empty,'').sections.find(s=>s.id==='pcoCredentials').description,/empty credentials/);
});

test('old backups without Planning Center keep current credentials even when restoring every available section',()=>{
  const old=restore.normalize({app:'JPMixer',type:'backup',version:1,config:{consoleType:'digico',serverPort:7000},presets:sample.presets},'old.json');
  const sections=restore.describe(old,'').sections.map(s=>s.id);assert(!sections.includes('pcoCredentials'));assert(!sections.includes('scenes'));
  const plan=restore.plan(old,sections,'merge',{pcoAppId:'keep',pcoSecret:'keep-secret',serverPort:8080});assert.equal(plan.config.pcoSecret,'keep-secret');assert.equal(plan.config.serverPort,7000);
  assert.throws(()=>restore.plan(old,['pcoCredentials'],'merge',{}),/not included/);assert.throws(()=>restore.plan(old,[],'merge',{}),/at least/);
});

test('detects raw and renamed configs, mixes and scenes; rejects malformed or unsupported content',()=>{
  assert.equal(restore.normalize(sample.presets,'phone-saves.json').mixCount,1);
  assert.equal(restore.normalize(sample.scenes,'ear-saves.json').kind,'Extracted Ear Scenes');
  assert.equal(restore.normalize(sample.config,'renamed-settings.json').kind,'Extracted configuration');
  assert.equal(restore.normalize({app:'JPMixer',type:'mix-backup',version:1,presets:sample.presets},'mixes.json').mixCount,1);
  for(const data of [[],{}, {...sample,version:99},{...sample,config:{channels:-1}},{...sample,scenes:{Bad:{1:{1:500}}}}])assert.throws(()=>restore.normalize(data,'file.json'));
});

test('mix-only restore preserves all settings, credentials and scenes and merges without removing old mixes',async t=>{
  const h=harness(t),before=h.files(),data=restore.normalize(sample,'backup.json');const result=await restore.apply(data,['mixes'],'merge',h);
  assert.equal(result.ok,true);assert.equal(result.configChanged,false);assert.equal(h.files()['config.json'],before['config.json']);assert.equal(h.files()['scenes.json'],before['scenes.json']);assert(h.presets.getPreset('existing','Keep'));assert(h.presets.getPreset('imported','Sunday'));assert.equal(h.autoBackup.listBackups().length,1);
});

test('Planning Center setup and credentials restore independently, with absent fields preserved',async t=>{
  const h=harness(t),data=restore.normalize(sample,'backup.json');
  assert.equal((await restore.apply(data,['pco'],'merge',h)).ok,true);assert.equal(h.config.get('pcoServiceTypeId'),'backup-service');assert.equal(h.config.get('pcoAppId'),'current-app');assert.equal(h.config.get('pcoSecret'),'current-secret');assert.equal(h.config.get('apiToken'),'current-token');
  assert.equal((await restore.apply(data,['pcoCredentials'],'merge',h)).ok,true);assert.equal(h.config.get('pcoSecret'),'backup-secret');assert(h.presets.getPreset('existing','Keep'));
});

test('replace mode replaces only server My Mixes; explicit empty stores can be restored',async t=>{
  const h=harness(t),before=h.files(),data=restore.normalize(sample,'backup.json');
  assert.equal((await restore.apply(data,['mixes'],'replace',h)).ok,true);assert.equal(h.presets.getPreset('existing','Keep'),null);assert(h.presets.getPreset('imported','Sunday'));assert.equal(h.files()['config.json'],before['config.json']);
  const empty=restore.normalize({app:'JPMixer',type:'mix-backup',version:1,presets:{}},'empty.json');assert.equal((await restore.apply(empty,['mixes'],'replace',h)).ok,true);assert.deepEqual(plain(h.presets.getAll()),{});
});

test('a failed selected-scene write rolls back already restored settings and saved mixes',async t=>{
  const h=harness(t),before=h.files(),data=restore.normalize(sample,'backup.json');
  const result=await failWriteOnce('scenes.json.tmp',()=>restore.apply(data,['console','mixes','scenes'],'replace',h));
  assert.equal(result.ok,false);assert.deepEqual(h.files(),before);assert.equal(h.config.get('serverPort'),8080);assert(h.presets.getPreset('existing','Keep'));assert.equal(h.scenes.getScene('Current',1)[1],0.3);assert.equal(h.autoBackup.listBackups().length,1);
});

test('failed settings writes or safety backups prevent all later changes',async t=>{
  const h=harness(t),before=h.files(),data=restore.normalize(sample,'backup.json');
  const result=await failWriteOnce('config.json.tmp',()=>restore.apply(data,['console','mixes'],'merge',h));assert.equal(result.ok,false);assert.deepEqual(h.files(),before);
  await assert.rejects(restore.apply(data,['mixes'],'merge',{...h,autoBackup:{writeBackup:async()=>{throw Error('no backup');}}}),/no backup/);assert.deepEqual(h.files(),before);
});

test('replacement mix-store write failure reports failure and preserves existing mixes and aliases',async t=>{
  const h=harness(t),before=h.files();
  const result=await failWriteOnce('preset-aliases.json.tmp',()=>h.presets.replaceAll(sample.presets,{}));assert.equal(result,false);assert.deepEqual(h.files(),before);assert(h.presets.getPreset('existing','Keep'));
});

const crc32 = require('buffer-crc32');
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename), data = Buffer.from(text), crc = crc32.unsigned(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, name, data); central.push(c, name); offset += h.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('ZIP loader detects extracted files together and a renamed wrapped backup by contents', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'jpm-restore-zip-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'archive.zip');
  fs.writeFileSync(file,zip([['saves/presets.json',JSON.stringify(sample.presets)],['saves/scenes.json',JSON.stringify(sample.scenes)],['__MACOSX/._presets.json','resource fork']]));
  const data = await restore.read(file);assert.equal(data.mixCount,1);assert(data.scenes);assert.equal(data.config,undefined);
  fs.writeFileSync(file,zip([['renamed-export.json',JSON.stringify(sample)],['notes.json','{"note":"ignored"}']]));
  const full = await restore.read(file);assert.equal(full.config.pcoSecret,'backup-secret');assert.equal(full.mixCount,1);
  fs.writeFileSync(file,zip([['first.json',JSON.stringify(sample)],['second.json',JSON.stringify(sample)]]));await assert.rejects(restore.read(file),/multiple backups/);
});

test('an export without passwords and keys leaves them out, and restoring it keeps this Mac’s',async t=>{
  const h=harness(t);
  h.config.save({...h.config.getAll(),dlivePassword:'current-dlive'});
  const shared=h.autoBackup.buildBackupData({includeCredentials:false});
  const text=JSON.stringify(shared);
  for(const secret of ['current-app','current-secret','current-token','current-dlive'])assert.equal(text.includes(secret),false,secret+' must not be in a shared export');
  assert.equal(shared.credentialsIncluded,false);
  assert.equal(shared.config.pcoServiceTypeId,'current-service','the rest of the settings are still there');
  const full=h.autoBackup.buildBackupData();
  assert.equal(full.config.pcoSecret,'current-secret','auto-backups still carry them for config recovery');
  const data=restore.normalize(plain(shared),'shared.json'),sections=restore.describe(data,'').sections;
  assert(!sections.some(s=>s.id==='pcoCredentials'));
  assert.match(sections.find(s=>s.id==='api').description,/doesn’t include the access token/);
  h.config.save({...h.config.getAll(),pcoSecret:'other-secret',apiToken:'other-token',dlivePassword:'other-dlive'});
  const result=await restore.apply(data,sections.map(s=>s.id),'merge',h);
  assert.equal(result.ok,true);
  for(const [key,value] of [['pcoSecret','other-secret'],['apiToken','other-token'],['dlivePassword','other-dlive']])assert.equal(h.config.get(key),value);
});

test('settings and backup files are written readable by this account only',t=>{
  const h=harness(t);
  if(process.platform==='win32')return;
  assert.equal(fs.statSync(path.join(h.dir,'config.json')).mode&0o777,0o600);
});

test('keep-awake restores with startup behavior; open-at-login stays as this Mac has it',()=>{
  const data=restore.normalize({...sample,config:{...sample.config,autoStart:false,keepAwake:false,openAtLogin:true}},'backup.json');
  const plan=restore.plan(data,['behavior'],'merge',{autoStart:true,keepAwake:true,openAtLogin:false});
  assert.equal(plan.config.keepAwake,false);assert.equal(plan.config.autoStart,false);
  assert.equal(plan.config.openAtLogin,false,'a login item belongs to this Mac, not the backup');
  assert.throws(()=>restore.normalize({...sample,config:{keepAwake:'yes'}},'backup.json'),/keepAwake/);
});

test('a backup with one bad saved mix restores the rest instead of being refused',async t=>{
  const h=harness(t);
  const data=restore.normalize({...sample,presets:{phone:{Good:{levels:{1:0.5},pans:{}},Bad:{levels:{1:999},pans:{}}}}},'backup.json');
  const section=restore.describe(data,'').sections.find(s=>s.id==='mixes');
  assert.match(section.description,/1 saved mix/);assert.match(section.description,/1 with invalid levels will be skipped/);
  const result=await restore.apply(data,['mixes'],'merge',h);
  assert.equal(result.ok,true);
  assert.deepEqual(Object.keys(h.presets.getByDevice('phone')),['Good']);
});

test('saved Home page layouts are in backups and restore without dropping anyone else’s',async t=>{
  const h=harness(t);
  const layout={order:['chat','live'],cards:{chat:{size:'wide'}}};
  assert.equal(h.homeLayouts.set('lighting','777','Lee Lights',layout),true);
  const backup=h.autoBackup.buildBackupData();
  assert.deepEqual(plain(backup.homeLayouts).lighting['777'].layout.order,['chat','live']);
  // This Mac has since saved another person's layout and changed Lee's
  h.homeLayouts.set('foh','555','Sam Sound',{order:['team']});
  h.homeLayouts.set('lighting','777','Lee Lights',{order:['team']});
  const bad=plain(backup);bad.homeLayouts.switcher={'../evil':{layout},'__proto__':{layout},'888':{layout:'nope'}};
  const data=restore.normalize(bad,'backup.json'),section=restore.describe(data,'').sections.find(s=>s.id==='homeLayouts');
  assert.match(section.description,/1 saved layout\(s\) for 1 team member/,'invalid entries are skipped');
  const result=await restore.apply(data,['homeLayouts'],'merge',h);
  assert.equal(result.ok,true);
  assert.deepEqual(plain(h.homeLayouts.get('lighting','777').layout.order),['chat','live'],'Lee’s layout comes back from the backup');
  assert.deepEqual(plain(h.homeLayouts.get('foh','555').layout.order),['team'],'Sam’s is kept');
  assert.equal(h.homeLayouts.get('switcher','888'),null);
  assert.equal(h.config.get('pcoSecret'),'current-secret','only the chosen section is restored');
});

test('a backup made before layouts were saved offers no layout section and leaves them alone',async t=>{
  const h=harness(t);
  h.homeLayouts.set('foh','555','Sam Sound',{order:['team']});
  const data=restore.normalize(sample,'backup.json');
  assert(!restore.describe(data,'').sections.some(s=>s.id==='homeLayouts'));
  const result=await restore.apply(data,restore.describe(data,'').sections.map(s=>s.id),'merge',h);
  assert.equal(result.ok,true);
  assert.deepEqual(plain(h.homeLayouts.get('foh','555').layout.order),['team']);
});

test('the Devices stage arrangement is in backups and restores for the same number of mixes only',async t=>{
  const h=harness(t);
  assert(h.deviceStage.set('8',{positions:{'phone-a':{x:0.2,y:0.3},'stage-aux:2':{x:0.5,y:0.5}},hiddenAuxes:[4],height:900}));
  const backup=h.autoBackup.buildBackupData();
  assert.deepEqual(plain(backup.deviceStage)['8'].positions['phone-a'],{x:0.2,y:0.3});
  // Since then: this Mac moved the phone and has an arrangement for a 12-mix console
  h.deviceStage.set('8',{positions:{'phone-a':{x:0.9,y:0.9}}});
  h.deviceStage.set('12',{positions:{'phone-b':{x:0.1,y:0.1}}});
  const revBefore=h.deviceStage.get('8').rev;
  const bad=plain(backup);bad.deviceStage['../x']={positions:{}};bad.deviceStage['__proto__']={positions:{}};bad.deviceStage['16']='nope';
  const data=restore.normalize(bad,'backup.json'),section=restore.describe(data,'').sections.find(s=>s.id==='deviceStage');
  assert.match(section.description,/2 card\(s\)/);
  const result=await restore.apply(data,['deviceStage'],'merge',h);
  assert.equal(result.ok,true);
  assert.deepEqual(plain(h.deviceStage.get('8').positions['phone-a']),{x:0.2,y:0.3},'the backup’s arrangement comes back');
  assert.deepEqual(plain(h.deviceStage.get('8').hiddenAuxes),[4]);
  assert(h.deviceStage.get('8').rev>revBefore,'rev keeps counting up');
  assert.deepEqual(plain(h.deviceStage.get('12').positions),{'phone-b':{x:0.1,y:0.1}},'the 12-mix arrangement is kept');
  assert.equal(h.deviceStage.get('16'),null);
  assert.equal(h.config.get('pcoSecret'),'current-secret','only the chosen section is restored');
});

test('a backup from before 2.0.10 offers no Devices stage section and leaves it alone',async t=>{
  const h=harness(t);
  h.deviceStage.set('8',{positions:{'phone-a':{x:0.9,y:0.9}}});
  const data=restore.normalize(sample,'backup.json');
  assert(!restore.describe(data,'').sections.some(s=>s.id==='deviceStage'));
  const result=await restore.apply(data,restore.describe(data,'').sections.map(s=>s.id),'merge',h);
  assert.equal(result.ok,true);
  assert.deepEqual(plain(h.deviceStage.get('8').positions['phone-a']),{x:0.9,y:0.9});
});

test('a failed Devices stage write keeps the stage as it was and undoes what was restored before it',async t=>{
  const h=harness(t);
  h.deviceStage.set('8',{positions:{'phone-a':{x:0.2,y:0.3}}});
  h.homeLayouts.set('foh','555','Sam Sound',{order:['live']});
  const backup=plain(h.autoBackup.buildBackupData());
  // Since the backup: the stage moved and Sam's layout changed
  h.deviceStage.set('8',{positions:{'phone-a':{x:0.9,y:0.9}}});
  h.homeLayouts.set('foh','555','Sam Sound',{order:['team']});
  const data=restore.normalize(backup,'backup.json');
  // Home layouts are written first, then the stage, whose write fails
  const result=await failWriteOnce('device-stage',()=>restore.apply(data,['homeLayouts','deviceStage'],'merge',h));
  assert.equal(result.ok,false);
  assert.deepEqual(plain(h.deviceStage.get('8').positions['phone-a']),{x:0.9,y:0.9},'the stage is as it was');
  assert.deepEqual(plain(h.homeLayouts.get('foh','555').layout.order),['team'],'and the layouts restored before it are undone');
});

test('a device-stage.json copied out of the app folder restores as the Devices stage',()=>{
  const data=restore.normalize({8:{positions:{'phone-a':{x:0.5,y:0.5}},hiddenAuxes:[],height:720,rev:3,savedAt:'2026-10-01T00:00:00Z'}},'device-stage.json');
  assert.equal(data.kind,'Extracted Devices stage');
  assert.deepEqual(restore.describe(data,'').sections.map(s=>s.id),['deviceStage']);
});

test('a home-layouts.json copied out of the app folder restores as layouts, not as My Mixes',()=>{
  const data=restore.normalize({lighting:{777:{name:'Lee',savedAt:'2026-10-01T00:00:00Z',layout:{order:['chat']}}}},'home-layouts.json');
  assert.equal(data.kind,'Extracted Home page layouts');
  assert.deepEqual(restore.describe(data,'').sections.map(s=>s.id),['homeLayouts']);
});
