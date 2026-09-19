// 真 Electron 输出窗口回归；独立 userData，不连接直播、不启动用户游戏。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'capture-output')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
for (const entry of ['green-screen', 'video-widget', 'effects-widget']) {
  await build({ entryPoints: [path.join(root, 'src/main', entry + '.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, entry + '.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
}
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname); app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required'); app.whenReady().then(async()=>{global.qa={green:require('./green-screen.cjs'),video:require('./video-widget.cjs'),effects:require('./effects-widget.cjs')}; const control=new BrowserWindow({show:false});await control.loadURL('about:blank')});`)
const fixture = path.join(isolated, '素材 # & 中文.svg')
await fs.writeFile(fixture, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect x="2" y="2" width="636" height="356" rx="30" fill="#00ff00"/><circle cx="320" cy="160" r="90" fill="#ff8a28"/><text x="320" y="310" text-anchor="middle" font-size="32" fill="#ffffff">知了猴 · 采集测试</text></svg>')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const errors = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS ' + name) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const call = (kind, fn, args = []) => app.evaluate((_, { kind, fn, args }) => global.qa[kind][fn](...args), {kind,fn,args})
const state = title => app.evaluate(({BrowserWindow}, title) => { const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()===title); return w ? {id:w.id,title:w.getTitle(),bounds:w.getBounds(),handle:w.getNativeWindowHandle().toString('hex'),throttled:w.webContents.getBackgroundThrottling()} : null }, title)
const pageFor = async part => { for(let i=0;i<60;i++){ const p=app.windows().find(p=>p.url().includes(part));if(p){await p.waitForLoadState();return p}await sleep(50)}throw new Error('Missing window '+part) }
try {
  const control = await app.firstWindow()
  // 浏览器原生编码一段 1.2 秒视频，文件名覆盖中文、空格、#、&。
  const encoded = await control.evaluate(async () => {
    const c=document.createElement('canvas'); c.width=320;c.height=180;const ctx=c.getContext('2d');
    const stream=c.captureStream(20), chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const done=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();
    let n=0;const t=setInterval(()=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,320,180);ctx.fillStyle='#ff8a28';ctx.beginPath();ctx.arc(50+(n++%30)*7,90,32,0,Math.PI*2);ctx.fill()},50);
    await new Promise(r=>setTimeout(r,1200));recorder.stop();clearInterval(t);await done;stream.getTracks().forEach(t=>t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  })
  const videoFile=path.join(isolated,'视频 # & 中文.webm');await fs.writeFile(videoFile,Buffer.from(encoded))
  check('green opens', (await call('green','openGreenScreen',[fixture,'image','测试 <标签>',1])).ok)
  const green=await pageFor('green-1.html');await green.waitForFunction(()=>document.querySelector('img')?.naturalWidth===640)
  check('image path with # / & / Chinese and escaped text loads',await green.locator('.label').innerText()==='测试 <标签>')
  const first=await state('绿幕1')
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(410,210),first.id)
  check('replace green accepted',(await call('green','openGreenScreen',[fixture,'image','替换素材',1])).ok)
  await green.waitForFunction(()=>document.querySelector('.label')?.textContent==='替换素材')
  const second=await state('绿幕1')
  check('same-slot green preserves native handle and position',first.handle===second.handle&&second.bounds.x===410&&second.bounds.y===210)
  check('output renderer stays active while backgrounded',second.throttled===false)
  await green.locator('#drag').hover()
  check('green drag hover remains fully transparent',await green.locator('#drag').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgba(0, 0, 0, 0)')
  // Electron 输入事件走页面实际拖动处理，不以 setPosition 代替拖动验证。
  await green.mouse.move(100,100);await green.mouse.down();await green.mouse.move(180,150,{steps:8});await green.mouse.up();await sleep(150)
  const dragged=await state('绿幕1')
  check('mouse drag changes native green window position',dragged.bounds.x!==second.bounds.x||dragged.bounds.y!==second.bounds.y)
  await green.screenshot({path:path.join(output,'green-output.png')})
  check('invalid green path rejected',(await call('green','openGreenScreen',[fixture+'.missing','image','',1])).ok===false)
  check('invalid replacement preserves active source',(await call('green','greenScreenState')).slots[0].src===fixture)
  await call('green','openGreenScreen',[fixture,'image','旧定时器',2,{maxSeconds:0.2}]);await sleep(80)
  await call('green','openGreenScreen',[fixture,'image','新素材',2]);await sleep(220)
  check('old green timer cannot close replacement',(await call('green','greenScreenState')).slots[1].open)
  await call('green','openGreenScreen',[fixture,'image','小数时长',3,{maxSeconds:0.25}]);await sleep(450)
  // 到秒数把素材撤掉、窗口留着换回绿底（它是主播开的采集来源）
  check('fractional green duration removes the media (window stays as a source)',(await call('green','greenScreenState')).slots[2].open===true&&!(await call('green','greenScreenState')).slots[2].src)
  await call('green','openGreenScreen',[videoFile,'video','自然结束',4,{loop:false}]);await sleep(2100)
  check('one-shot green video removes its media on natural end (window stays as a source)',(await call('green','greenScreenState')).slots[3].open===true&&!(await call('green','greenScreenState')).slots[3].src)

  check('video opens',(await call('video','openVideoWidget',[{path:videoFile,loop:true,muted:true,slot:'main',x:500,y:300,width:480,height:270}])).ok)
  const video=await pageFor('video-widget-main.html');await video.waitForFunction(()=>document.querySelector('video')?.videoWidth===320)
  const main=await state('视频')
  await call('video','openVideoWidget',[{path:videoFile,loop:true,muted:true,slot:'main',autoClose:true}]);await video.waitForLoadState();await sleep(100)
  check('video replacement preserves handle and bounds',JSON.stringify((await state('视频')).bounds)===JSON.stringify(main.bounds)&&(await state('视频')).handle===main.handle)
  check('invalid video path rejected',(await call('video','openVideoWidget',[{path:videoFile+'.missing'}])).ok===false)
  await call('video','openVideoWidget',[{path:videoFile,loop:false,muted:true,slot:'vip',autoClose:false}]);const vip=await pageFor('video-widget-vip.html');await sleep(2000)
  check('VIP native title remains stable after ended signal',!!await state('视频VIP'))
  await vip.screenshot({path:path.join(output,'video-output.png')})
  await call('video','openVideoWidget',[{path:videoFile,loop:true,muted:true,slot:'vip',maxSeconds:0.2}]);await sleep(80)
  await call('video','openVideoWidget',[{path:videoFile,loop:true,muted:true,slot:'vip'}]);await sleep(250)
  check('old video timer cannot close replacement',(await call('video','videoWidgetState')).vip)
  await call('video','openVideoWidget',[{path:videoFile,loop:false,muted:true,slot:'vip',autoClose:true}]);await sleep(2100)
  check('VIP closes on natural end without closing main',!(await call('video','videoWidgetState')).vip&&(await call('video','videoWidgetState')).main)

  await call('effects','openEffectsWindow',[{background:'green',width:400,height:360,speed:0.25}])
  check('effect queued immediately after opening',(await call('effects','effectsFire',['rain','首次动画',1,fixture,'测试观众'])).ok)
  const effects=await pageFor('effects-widget.html');await effects.waitForFunction(()=>document.querySelectorAll('.gift,.frag,.star,.car').length>0)
  const effectsBefore=await state('礼物动画')
  await call('effects','openEffectsWindow')
  await call('effects','configureEffects',[{background:'transparent',width:440,height:360}])
  await effects.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(0, 255, 0)')
  check('effects reopen/configure preserve capture handle',(await state('礼物动画')).handle===effectsBefore.handle)
  await effects.screenshot({path:path.join(output,'effects-output.png'),omitBackground:true})
  await call('effects','closeEffectsWindow');await call('effects','openEffectsWindow');await pageFor('effects-widget.html')
  check('effects close/reopen state survives stale close event',(await call('effects','effectsState')).open)
  for(const [kind,fn] of [['green','closeGreenScreen'],['video','closeVideoWidget'],['effects','closeEffectsWindow']])await call(kind,fn)
  check('all output state clears on close',!(await call('green','greenScreenState')).open&&!(await call('video','videoWidgetState')).open&&!(await call('effects','effectsState')).open)
  check('no renderer JavaScript errors',errors.length===0)
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({results,errors,userData:isolated},null,2))
  console.log(`capture output regression passed: ${results.length} checks`)
  if(process.argv.includes('--preview')){
    const stopFile=path.join(isolated,'stop-preview');
    await call('green','openGreenScreen',[fixture,'image','采集验证',1]);await call('effects','openEffectsWindow',[{background:'green',width:480,height:360}]);
    await call('effects','effectsFire',['rain','采集测试',6,fixture,'']);
    console.log('PREVIEW_STOP_FILE='+stopFile)
    for(let i=0;i<1200;i++){if(await fs.stat(stopFile).then(()=>true,()=>false))break;await sleep(500)}
  }
} finally { await app.close() }
