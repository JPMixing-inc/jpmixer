// Deterministic vector lettering and raster exports. Run: node scripts/build-brand.cjs
// SVG sources remain editable; no font installation or image service is required.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const glyphs = {
  J: 'M0 0H96V78L74 100H22L0 78V54H26V70L32 76H64L70 70V24H0Z',
  P: 'M0 0H76L96 20V46L76 66H26V100H0Z M26 24V42H66L70 38V28L66 24Z',
  M: 'M0 100V0H24L48 28L72 0H96V100H70V42L48 66L26 42V100Z',
  I: 'M0 0H44V24H34V76H44V100H0V76H10V24H0Z',
  X: 'M0 0H30L48 28L66 0H96L64 50L96 100H66L48 72L30 100H0L32 50Z',
  E: 'M16 0H96V24H26V38H84V62H26V76H96V100H16L0 84V16Z',
  R: 'M0 0H76L96 20V46L78 64L100 100H69L48 66H26V100H0Z M26 24V42H66L70 38V28L66 24Z'
};
function letters(text) {
  let x = 0;
  const shapes = [...text].map((letter, index) => {
    const shape = `<path transform="translate(${x} 0)" d="${glyphs[letter]}"/>`;
    x += (letter === 'I' ? 44 : letter === 'R' ? 100 : 96) + (index === 1 && text.length > 2 ? 24 : 12);
    return shape;
  }).join('');
  return { shapes, width: x - 12 };
}
const red = '<defs><linearGradient id="red" x1="0" y1="0" x2="0.2" y2="1"><stop stop-color="#ff2858"/><stop offset="1" stop-color="#e8003c"/></linearGradient></defs>';
function svg(viewBox, content, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${content}</svg>\n`;
}
const jp = letters('JP'), full = letters('JPMIXER');
const monogram = svg(`-2 -2 ${jp.width + 4} 104`, `${red}<g fill="url(#red)" fill-rule="evenodd">${jp.shapes}</g>`, 'JP');
const wordmark = svg(`-2 -2 ${full.width + 4} 104`, `${red}<g fill="url(#red)" fill-rule="evenodd">${full.shapes}</g>`, 'JPMixer');
const appIcon = svg('0 0 1024 1024', `${red}<defs><linearGradient id="tile" x2="0.4" y2="1"><stop stop-color="#282c35"/><stop offset="1" stop-color="#0e0f11"/></linearGradient></defs><rect x="64" y="64" width="896" height="896" rx="196" fill="url(#tile)"/><rect x="66" y="66" width="892" height="892" rx="194" fill="none" stroke="#3a404b" stroke-width="4"/><g transform="translate(212 364.941176) scale(2.94117647)" fill="url(#red)" fill-rule="evenodd">${jp.shapes}</g>`, 'JPMixer app icon');
const touchIcon = svg('0 0 1024 1024', `${red}<rect width="1024" height="1024" fill="#17191d"/><g transform="translate(212 364.941176) scale(2.94117647)" fill="url(#red)" fill-rule="evenodd">${jp.shapes}</g>`, 'JPMixer');
const tray = svg('-8 -16 220 132', `<g fill="#000" fill-rule="evenodd">${jp.shapes}</g>`, 'JP');
for (const dir of ['assets/brand','src/mixer/brand','assets/icon.iconset']) fs.mkdirSync(path.join(root,dir), {recursive:true});
for (const [name, source] of Object.entries({'jpmixer-wordmark':wordmark,'jp-monogram':monogram,'app-icon':appIcon})) fs.writeFileSync(path.join(root,'assets/brand',name+'.svg'),source);
for (const [name, source] of Object.entries({'jpmixer-wordmark':wordmark,'jp-monogram':monogram})) fs.writeFileSync(path.join(root,'src/mixer/brand',name+'.svg'),source);
fs.writeFileSync(path.join(root,'src/mixer/favicon.svg'),monogram);
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'jpm-brand-render-'));
const chrome = spawn(process.env.JPMIXER_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+temp,'about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
let socket;
(async()=>{
  let port;
  for(let i=0;i<100;i++){ try{ port=fs.readFileSync(path.join(temp,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{} await sleep(50); }
  if(!port) throw Error('Chrome did not start');
  const page = await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve=>socket.once('open',resolve));
  let id=0;const pending=new Map();
  socket.on('message',raw=>{const msg=JSON.parse(raw);if(!msg.id)return;const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);});
  const cdp=(method,params)=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  async function png(source,width,height,destination){
    const result=await cdp('Runtime.evaluate',{expression:`(async()=>{const image=new Image();image.src='data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}';await image.decode();const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};canvas.getContext('2d').drawImage(image,0,0,${width},${height});return canvas.toDataURL('image/png').split(',')[1]})()`,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    fs.writeFileSync(path.join(root,destination),Buffer.from(result.result.value,'base64'));
  }
  await png(wordmark, full.width*4+16,416,'assets/brand/jpmixer-wordmark.png');
  await png(monogram,832,416,'assets/brand/jp-monogram.png');
  await png(appIcon,1024,1024,'assets/brand/app-icon.png');
  for(const size of [16,32,128,256,512]){
    await png(appIcon,size,size,`assets/icon.iconset/icon_${size}x${size}.png`);
    await png(appIcon,size*2,size*2,`assets/icon.iconset/icon_${size}x${size}@2x.png`);
  }
  for(const size of [48,64])await png(appIcon,size,size,`assets/brand/icon-${size}.png`);
  await png(tray,22,16,'assets/trayTemplate.png');
  await png(tray,44,32,'assets/trayTemplate@2x.png');
  for(const size of [180,192,512])await png(touchIcon,size,size,`src/mixer/brand/icon-${size}.png`);
  await png(touchIcon,512,512,'src/mixer/logo.png');
  await png(appIcon,32,32,'src/mixer/favicon.png');
  fs.copyFileSync(path.join(root,'assets/brand/jpmixer-wordmark.png'),path.join(root,'assets/design/logo.png'));
  execFileSync('/usr/bin/iconutil',['-c','icns',path.join(root,'assets/icon.iconset'),'-o',path.join(root,'assets/icon.icns')]);
  const pngToIco=require('png-to-ico');const convert=pngToIco.default || pngToIco;
  fs.writeFileSync(path.join(root,'assets/icon.ico'),await convert([16,32,48,64,128,256].map(size=>path.join(root,[48,64].includes(size)?`assets/brand/icon-${size}.png`:`assets/icon.iconset/icon_${size}x${size}.png`))));
  console.log('Built vector wordmark, JP mark, macOS/Windows icons, tray, and web icons.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{socket?.close();if(chrome.exitCode===null){await new Promise(resolve=>{chrome.once('exit',resolve);chrome.kill();});}fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
