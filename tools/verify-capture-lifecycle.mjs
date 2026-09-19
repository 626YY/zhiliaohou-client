// 显式启用「留着采集来源」：绿幕模式留绿底，透明模式留透明空帧，同模式重开复用采集源。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'output/playwright/capture-lifecycle')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile)
await fs.writeFile(entry,(await fs.readFile(entry,'utf8')).replace('const NativeWindow = electron.BrowserWindow;','const NativeWindow = electron.BrowserWindow; global.__captureShow=NativeWindow.prototype.showInactive;'))
const settingsFile=path.join(profile,'data/settings.json')
// 这支验的是「关闭挂件留待机画面、同模式再开复用采集源」：0.3.43 起默认关掉就真关掉，这里显式打开「留着采集来源」
await fs.writeFile(settingsFile,JSON.stringify({...JSON.parse(await fs.readFile(settingsFile,'utf8')),outputCaptureMode:'black',keepClosedSources:true}))
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry,'--user-data-dir='+profile],env})
const child=app.process()
const run=promisify(execFile),results=[],transparentResults=[],layouts=[],errors=[]
app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)))
const page=await app.firstWindow()
page.setDefaultTimeout(8000)
let quitWindowCount,quitLog=''
child.stderr.on('data',chunk=>{quitLog+=chunk.toString();const match=quitLog.match(/ZL_QUIT_WINDOWS:(\d+)/);if(match)quitWindowCount=Number(match[1])})
await app.evaluate(({app,BrowserWindow})=>app.once('will-quit',()=>process.stderr.write('ZL_QUIT_WINDOWS:'+BrowserWindow.getAllWindows().length+'\n')))
const api=(name,...args)=>page.evaluate(([name,args])=>window.api[name](...args),[name,args])
const targetFor=async part=>{
 for(let i=0;i<100;i++){
  const p=app.windows().find(p=>p!==page&&p.url().includes(part))
  if(p){await p.waitForLoadState('domcontentloaded');return p}
  await page.waitForTimeout(50)
 }
 throw Error('Missing '+part)
}
const info=win=>win.evaluate(w=>({id:w.id,hwnd:w.getNativeWindowHandle().readBigUInt64LE().toString(),title:w.getTitle(),background:w.getBackgroundColor().toLowerCase(),listeners:[w.listenerCount('move'),w.listenerCount('page-title-updated'),w.webContents.listenerCount('did-finish-load'),w.webContents.listenerCount('console-message')]}))
const capture=async(win,name)=>{
 const meta=await info(win),file=path.join(out,name+'.png')
 await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/capture-native-window.ps1'),'-WindowHandle',meta.hwnd,'-ExpectedProcessId',String(await app.evaluate(()=>process.pid)),'-Path',file,'-Method','bitblt'],{windowsHide:true,timeout:30000})
 return app.evaluate(({nativeImage},file)=>{const b=nativeImage.createFromPath(file).toBitmap();let black=0,green=0;for(let i=0;i<b.length;i+=4){if(b[i]===0&&b[i+1]===0&&b[i+2]===0)black++;if(b[i]===0&&b[i+1]===255&&b[i+2]===0)green++}return {black:black/(b.length/4),green:green/(b.length/4)}},file)
}
let failure
try{
 await page.waitForFunction(()=>!!window.api?.getSettings)
 assert.equal((await api('getSettings')).settings.outputCaptureMode,'transparent','迁移旧测试版关闭开关时保存的 black')
 await api('saveSettings',{outputCaptureMode:'green'})
 await api('register','capture_lifecycle','Fixture123!','采集流程验收')
 assert.equal((await api('login','capture_lifecycle','Fixture123!')).ok,true)
 await api('saveSettings',{guideSeen:true})
 await page.evaluate(()=>localStorage.setItem('zl-guide-seen','1'))
 await page.reload({waitUntil:'domcontentloaded'})
 await page.evaluate(()=>{location.hash='/ent'})
 const toggle=page.getByRole('switch',{name:'绿幕底总开关',exact:true})
 await toggle.waitFor()
 assert.equal(await toggle.getAttribute('aria-checked'),'true')
 const mainWin=await app.browserWindow(page)
 for(const width of [1024,1280,1400]){
  await mainWin.evaluate((w,width)=>w.setSize(width,820),width)
  await page.waitForFunction(width=>innerWidth===width,width,{polling:50})
  const grid=page.getByRole('button').filter({hasText:'礼物触发'}).locator('..')
  const layout=await grid.evaluate(el=>{
   const cards=[...el.children],rects=cards.map(card=>card.getBoundingClientRect())
   return {columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,firstRow:rects.filter(r=>r.top===rects[0].top).length,count:cards.length,height:el.getBoundingClientRect().height,overflow:cards.some(c=>c.scrollWidth>c.clientWidth),pageOverflow:document.documentElement.scrollWidth>innerWidth}
  })
  assert.equal(layout.columns,3);assert.equal(layout.firstRow,3);assert.equal(layout.count,20)
  assert.equal(layout.overflow,false);assert.equal(layout.pageOverflow,false)
  await grid.evaluate(el=>el.scrollIntoView({block:'start'}))
  await mainWin.evaluate(w=>w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true}).then(()=>null))
  await page.waitForTimeout(150)
  const png=await mainWin.evaluate(async w=>[...(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()])
  await fs.writeFile(path.join(out,'entertainment-three-columns-'+width+'.png'),Buffer.from(png))
  layouts.push({width,...layout})
 }
 console.log('PASS 娱乐助手 1024 / 1280 / 1400 宽度均三个一排，无横向溢出')
 const icon=path.join(root,'build/icon.png'),items=[{name:'奖品一',weight:1},{name:'奖品二',weight:1}]
 const counter={mode:'counter',initial:42,clockOn:false,gifts:[],giftShow:false,showLock:true,title:'采集验收',bgTransparent:true}
 const timeCfg={initial:60,enable:true,showGift:false,autoHide:false,startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''}}
 const bytes=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.fillStyle='#1b64fa';x.fillRect(0,0,160,90)
  const stream=c.captureStream(12),chunks=[],r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),done=new Promise(resolve=>r.onstop=resolve)
  r.ondataavailable=e=>chunks.push(e.data);r.start();await new Promise(resolve=>setTimeout(resolve,400));r.stop();await done;stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
 })
 const video=path.join(profile,'fixture.webm');await fs.writeFile(video,Buffer.from(bytes))
 const cases=[
  ['timeWidgetOpen',[timeCfg],'time-widget','timeWidgetClose',[]],
  ['entranceOpen',[],'entrance-widget','entranceClose',[]],
  ['challengeOpen',[{...counter,slot:'challenge'}],'challenge-widget-challenge','challengeClose',['challenge']],
  ['challengeOpen',[{...counter,slot:'overtime'}],'challenge-widget-overtime','challengeClose',['overtime']],
  ['effectsOpen',[{background:'transparent',width:320,height:240}],'effects-widget','effectsClose',[]],
  ['queueOpen',[{background:'transparent'}],'queue-widget','queueClose',[]],
  ['keyboardOpen',[{background:'transparent'}],'keyboard-widget','keyboardClose',[]],
  ['marqueeOpen',[{}],'marquee-widget','marqueeClose',[]],
  ['protectWidgetOpen',[Date.now()],'protect-widget','protectWidgetClose',[]],
  ...[1,2,3,4].map(slot=>['greenScreenOpen',[icon,'image','',slot],'green-player-'+slot+'.html','greenScreenClose',[slot]]),
  ['progressOpen',[],'progress-widget','progressClose',[]],
  ['wishOpen',[],'wish-widget','wishClose',[]],
  ['lotteryOpen',['wheel',items],'lottery-lucky','lotteryClose',['wheel']],
  ['lotteryOpen',['nine',items],'lottery-nine','lotteryClose',['nine']],
  ...[1,2].map(source=>['advancedWheelOpen',[{source,sectorCount:10,hotkey:'',options:[{text:'验收',weight:1}]}],'advanced-wheel-'+source,'advancedWheelClose',[source]]),
  ...['main','vip'].map(slot=>['videoWidgetOpen',[{path:video,slot,loop:true,muted:true,bgColor:'#00ff00',width:320,height:200}],'video-widget-'+slot,'videoWidgetClose',[slot]])
 ]
 for(const [open,args,part,close,closeArgs]of (process.argv.includes('--transparent-only')?[]:cases)){
  assert.equal((await api(open,...args)).ok,true,part)
  const target=await targetFor(part),win=await app.browserWindow(target)
  await win.evaluate(w=>{w.setPosition(60,60);global.__captureShow.call(w)})
  await target.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(0, 255, 0)')
  const before=await info(win)
  if(part==='time-widget'){
   const remaining=(await api('timeWidgetState')).remaining
   await toggle.dispatchEvent('click')
   await page.waitForFunction(async()=> (await window.api.getSettings()).settings.outputCaptureMode==='transparent')
   await page.getByText('底色已保存，重新打开已开启的挂件后生效',{exact:true}).waitFor()
   assert.equal((await info(win)).background,'#00ff00','待重开时保持当前底色，不能变黑')
   await page.waitForTimeout(1150)
   assert.ok((await api('timeWidgetState')).remaining<remaining,'换底色不能停止走秒')
   await toggle.dispatchEvent('click')
   await page.waitForFunction(async()=> (await window.api.getSettings()).settings.outputCaptureMode==='green')
  }
  await api(close,...closeArgs)
  await target.waitForURL('data:text/html*')
  await target.waitForFunction(()=>document.body.children.length===0)
  const stopped=await info(win),blank=await capture(win,part+'-closed')
  assert.equal(stopped.hwnd,before.hwnd,part+' 关闭不销毁采集源')
  assert.equal(stopped.title,before.title)
  assert.equal(blank.green,1,part+' 关闭后必须清掉内容、保留纯绿底 '+JSON.stringify(blank))
  assert.equal((await api(open,...args)).ok,true)
  await target.waitForURL('**/*'+part+'*')
  await target.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(0, 255, 0)')
  const resumed=await info(win)
  assert.equal(resumed.hwnd,before.hwnd,part+' 重新开启应自动恢复原采集源')
  assert.deepEqual(resumed.listeners,before.listeners,part+' 不能叠加监听器')
  // 直接关闭原生窗口与页面总控关闭行为一致。
  await win.evaluate(w=>w.close())
  await target.waitForURL('data:text/html*')
  assert.equal((await capture(win,part+'-native-close')).green,1)
  results.push({part,hwnd:before.hwnd,blank})
  console.log('PASS '+part+'：关闭纯绿 / 原 HWND 恢复 / 原生关闭一致 / 无监听器累积')
 }
 // 先让页面就绪，再测试旧定时器；首次隐藏窗口启动可能超过 0.2 秒。
 await api('greenScreenOpen',icon,'image','旧素材',1)
 const green=await targetFor('green-1.html'),greenWin=await app.browserWindow(green),id=(await info(greenWin)).hwnd
 await api('greenScreenOpen',icon,'image','旧素材',1,{maxSeconds:0.2})
 await api('greenScreenClose',1)
 await api('greenScreenOpen',icon,'image','新素材',1)
 await page.waitForTimeout(350)
 assert.equal((await api('greenScreenState')).slots[0].open,true)
 assert.equal((await info(greenWin)).hwnd,id)
 assert.equal(await green.locator('.label').textContent(),'新素材')
 await api('greenScreenClose',1)
 await toggle.dispatchEvent('click')
 await page.waitForFunction(async()=> (await window.api.getSettings()).settings.outputCaptureMode==='transparent')
 await page.reload({waitUntil:'domcontentloaded'})
 await page.evaluate(()=>{location.hash='/ent'})
 await page.waitForFunction(()=>document.querySelector('[aria-label="绿幕底总开关"]')?.getAttribute('aria-checked')==='false')
 await fs.writeFile(path.join(out,'dashboard-transparent.png'),Buffer.from(await mainWin.evaluate(async w=>[...(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()])))
 console.log('CHECK 总开关关闭已保存并重载，开始验证透明输出')
 for(const [open,args,part,close,closeArgs]of cases){
  assert.equal((await api(open,...args)).ok,true)
  const target=await targetFor(part),win=await app.browserWindow(target)
  const dedicatedGreen=part.startsWith('green-')
  const expectedBackground=dedicatedGreen?'rgb(0, 255, 0)':'rgba(0, 0, 0, 0)'
  await target.waitForFunction(color=>getComputedStyle(document.documentElement).backgroundColor===color,expectedBackground)
  const before=await info(win)
  const pixels=await win.evaluate(async w=>{
   let image,alphaZero=0
   for(let i=0;i<20;i++){
    image=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})
    const b=image.toBitmap();let transparent=0
    for(let p=3;p<b.length;p+=4)if(b[p]===0)transparent++
    alphaZero=b.length?transparent/(b.length/4):0
    if(alphaZero>0)break
    await new Promise(resolve=>setTimeout(resolve,50))
   }
   if(image.isEmpty())throw Error('透明窗口尚未产出首帧')
   return {alphaZero,bytes:[...image.toPNG()]}
  })
  if(dedicatedGreen)assert.equal(pixels.alphaZero,0,part+' 专用绿幕保持不透明绿底')
  else if(part.startsWith('video-widget-')){
   // 自动收边后不透明的视频可铺满整窗；媒体本身没有 alpha 不代表原生窗口不透明。
   await target.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
   // getBackgroundColor 只返回 RGB；关闭后的逐像素 alpha 检查验证窗口真实透明性。
  }else assert.ok(pixels.alphaZero>0,part+' 必须存在真实透明像素')
  if(part==='time-widget'||part==='entrance-widget'){
   await fs.writeFile(path.join(out,part+'-transparent.png'),Buffer.from(pixels.bytes))
  }
  await api(close,...closeArgs)
  await target.waitForURL('data:text/html*')
  await target.waitForFunction(()=>document.readyState==='complete'&&document.body.children.length===0)
  const emptyFrame=await win.evaluate(async (w,dedicatedGreen)=>{
   for(let i=0;i<20;i++){
    const b=(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toBitmap()
    if(b.length>0&&b.every((v,p)=>dedicatedGreen?v===([0,255,0,255][p%4]):p%4!==3||v===0))return true
    await new Promise(resolve=>setTimeout(resolve,50))
   }
   return false
  },dedicatedGreen)
  assert.equal(emptyFrame,true,part+' 关闭后应清空内容（专用绿幕留绿底、透明挂件留透明帧）')
  assert.equal((await api(open,...args)).ok,true)
  await target.waitForURL('**/*'+part+'*')
  await target.waitForFunction(color=>getComputedStyle(document.documentElement).backgroundColor===color,expectedBackground)
  assert.equal((await info(win)).hwnd,before.hwnd,part+' 透明模式重开保持原 HWND')
  assert.deepEqual((await info(win)).listeners,before.listeners)
  await api(close,...closeArgs)
  transparentResults.push({part,hwnd:before.hwnd,alphaZero:pixels.alphaZero})
  console.log('PASS '+part+'：'+(dedicatedGreen?'专用绿幕保持绿底':'透明输出与空帧')+' / 原 HWND 重开 / 无监听器累积')
 }
 const mainInfo=await info(await app.browserWindow(page))
 const affinity=JSON.parse((await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/read-window-capture-affinity.ps1'),'-WindowHandle',mainInfo.hwnd,'-ExpectedProcessId',String(await app.evaluate(()=>process.pid))],{windowsHide:true})).stdout)
 assert.ok([1,17].includes(affinity.affinity),'主窗口必须在 Windows 层禁止采集')
 assert.deepEqual(errors,[])
 // 没有活动挂件时关闭主窗口，所有待机窗口应一并释放。
 await page.evaluate(()=>window.api.windowClose())
 for(let attempt=0;attempt<100&&quitWindowCount===undefined;attempt++)await new Promise(resolve=>setTimeout(resolve,100))
 assert.equal(quitWindowCount,0,'所有待机窗口应释放并进入正常退出')
 // Playwright 的 Node inspector 会令 Electron 打印 Waiting for the debugger
 // to disconnect；退出信号到达后断开调试器，再确认进程自然退出。
 await app.close()
 assert.equal(child.exitCode,0,'退出客户端不能残留后台进程')
 console.log('PASS 旧定时器不影响重开 / 总开关保存重载 / 主窗口禁止捕获 / 退出无空窗口残留')
}catch(e){
 failure=e;console.error(e)
 console.log('Exit state',await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),url:w.webContents.getURL()}))})).catch(()=>({})))
}finally{
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results,transparentResults,layouts,error:failure?.message,errors},null,2))
 await app.close().catch(()=>{})
}
console.log(`采集开关与重新打开 ${results.length}/21 ${process.argv.includes('--transparent-only')?'SKIP':failure?'FAIL':'PASS'}`)
console.log(`透明底与透明空帧 ${transparentResults.length}/21 ${failure?'FAIL':'PASS'}`)
if(failure)process.exitCode=1
