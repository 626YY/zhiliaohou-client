// 原生可见窗口回归：隐藏窗口上的 affinity 不能代表显示后的状态。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { launchNativeElectron } from './native-electron-session.mjs'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..'),run=promisify(execFile)
const packaged=process.argv.includes('--packaged')
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version
const resources=path.join(root,`release/v${version}/win-unpacked/resources`),archive=path.join(resources,'app.asar')
const out=path.join(root,'output/playwright/capture-restart'+(packaged?'-packaged':''))
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile,{visible:true,outDir:packaged?path.join(archive,'out'):'out'})
let bootstrap=await fs.readFile(entry,'utf8')
bootstrap=bootstrap.replace("const NativeWindow = electron.BrowserWindow;",`const NativeWindow = electron.BrowserWindow;
global.__captureShows=[];global.__captureElectron=electron;
electron.app.on('browser-window-created',(_event,win)=>win.on('show',()=>global.__captureShows.push(win.getTitle())));`)
if(packaged)bootstrap=bootstrap.replace(`electron.app.setAppPath(${JSON.stringify(root)});`,`electron.app.setAppPath(${JSON.stringify(archive)});Object.defineProperty(electron.app,'isPackaged',{get:()=>true});Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});`)
await fs.writeFile(entry,bootstrap)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const cfg={initial:123,enable:false,showSeconds:true,showGift:false,autoHide:false,theme:'paper',startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''}}
const fixture=path.join(profile,'green-fixture.png')
const checks=[],errors=[],identities=[]
let app,page,main,pid
const pass=(name,details)=>{checks.push({name,details});console.log('PASS '+name+(details?' | '+JSON.stringify(details):''))}
const api=(name,...args)=>page.evaluate(([name,args])=>window.api[name](...args),[name,args])
async function start(){
 app=await launchNativeElectron(path.join(root,'node_modules/electron/dist/electron.exe'),entry,profile,root)
 app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)))
 for(let i=0;i<100;i++){
  page=(await app.windows()).find(p=>p.url().includes('/renderer/index.html'))
  if(page)break
  await new Promise(r=>setTimeout(r,60))
 }
 assert.ok(page,'主页面出现')
 await page.waitForFunction(()=>!!window.api?.getSettings,null,{polling:50,timeout:10000})
 main=await app.browserWindow(page);pid=await app.evaluate(()=>process.pid)
 await page.waitForFunction(()=>innerWidth>=780)
 for(let i=0;i<50&&!await main.evaluate(w=>w.isVisible());i++)await page.waitForTimeout(40)
 assert.equal(await main.evaluate(w=>w.isVisible()),true)
}
async function affinity(label){
 const hwnd=await main.evaluate(w=>w.getNativeWindowHandle().readBigUInt64LE().toString())
 const {stdout}=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/read-window-capture-affinity.ps1'),'-WindowHandle',hwnd,'-ExpectedProcessId',String(pid)],{windowsHide:true})
 const result=JSON.parse(stdout);assert.equal(result.affinity,17,label)
 pass(label+'：可见原生主窗口 affinity=17')
}
async function blackCapture(meta,label){
 const file=path.join(out,label+'.png')
 await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/capture-native-window.ps1'),'-WindowHandle',meta.hwnd,'-ExpectedProcessId',String(pid),'-Path',file,'-Method','bitblt'],{windowsHide:true,timeout:15000})
 // 待机画面 = 纯黑（原生透明模式 / 旧版）或纯绿（绿幕模式，抠得掉）：都是「没有内容」；0.3.43 起窗口不再停到屏幕外，BitBlt 抓到的就是真实的绿底
 const result=await app.evaluate(({nativeImage},file)=>{const image=nativeImage.createFromPath(file),bytes=image.toBitmap();let blank=0;for(let i=0;i<bytes.length;i+=4){const b=bytes[i],g=bytes[i+1],r=bytes[i+2];if((r===0&&g===0&&b===0)||(r===0&&g===255&&b===0))blank++}return {size:image.getSize(),black:blank/(bytes.length/4)}},file)
 assert.equal(result.black,1,label);return result
}
const windows=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.getTitle()!=='知了猴整蛊台').map(w=>({title:w.getTitle(),hwnd:w.getNativeWindowHandle().readBigUInt64LE().toString(),rendererPid:w.webContents.getOSProcessId(),url:w.webContents.getURL(),visible:w.isVisible()})))
async function openFixtures(){
 assert.equal((await api('timeWidgetOpen',cfg)).ok,true)
 assert.equal((await api('entranceOpen')).ok,true)
 assert.equal((await api('greenScreenOpen',fixture,'image','采集恢复',1)).ok,true)
}
async function targetFor(part){
 for(let i=0;i<100;i++){
  const target=(await app.windows()).find(p=>p.url().includes(part))
  if(target)return target
  await new Promise(r=>setTimeout(r,60))
 }
 throw Error('Missing loaded native output: '+part)
}
let failure
try{
 await start();await affinity('首次启动显示')
 // 这支验的是「重启后采集来源自动接回」：只在「关掉挂件后留着采集来源」开着时才有待机窗口可恢复
 await api('saveSettings',{keepClosedSources:true})
 for(const [label,action] of [
  ['登录尺寸变化',w=>{w.setMinimumSize(1024,700);w.setSize(1280,820);w.center()}],
  ['隐藏再显示',w=>{w.hide();w.show()}],['最小化再还原',w=>{w.minimize();w.restore()}],
  ['最大化',w=>w.maximize()],['取消最大化',w=>w.unmaximize()]
 ]){await main.evaluate(action);await affinity(label)}
 const protectedHandle=await main.evaluate(w=>w.getNativeWindowHandle().readBigUInt64LE().toString())
 for(const method of ['bitblt','print']){
  let blocked=false
  try{
   const file=path.join(out,'main-'+method+'.png')
   await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/capture-native-window.ps1'),'-WindowHandle',protectedHandle,'-ExpectedProcessId',String(pid),'-Path',file,'-Method',method],{windowsHide:true,timeout:15000})
   blocked=await app.evaluate(({nativeImage},file)=>{const b=nativeImage.createFromPath(file).toBitmap();if(!b.length)return false;for(let i=0;i<b.length;i+=4)if(b[i]||b[i+1]||b[i+2])return false;return true},file)
  }
  catch(error){blocked=/BitBlt failed|PrintWindow failed/.test(error.stderr||error.message)}
  assert.equal(blocked,true,method+' 必须拒绝读取操作界面')
 }
 pass('BitBlt / PrintWindow 均无法读取主操作界面')
 await fs.writeFile(fixture,Buffer.from(await app.evaluate(({nativeImage})=>[...nativeImage.createFromBitmap(Buffer.from([255,255,255,255]),{width:1,height:1}).toPNG()])))
 await openFixtures();identities.push({phase:'before-quit',pid,windows:await windows()})
 await app.close();app=undefined
 const saved=JSON.parse(await fs.readFile(path.join(profile,'data/capture-windows.json'),'utf8'))
 assert.equal(saved.length,3)
 await start();await affinity('整个进程退出后重启')
 const idle=await windows();assert.equal(idle.length,3)
 const shows=await app.evaluate(()=>global.__captureShows)
 for(const win of idle){
  assert.equal(win.visible,true);assert.ok(win.rendererPid>0);assert.ok(win.url.startsWith('data:text/html;charset=utf-8,'))
  assert.ok(shows.indexOf(win.title)<shows.indexOf('知了猴整蛊台'))
  const content=await app.evaluate(({BrowserWindow},title)=>BrowserWindow.getAllWindows().find(w=>w.getTitle()===title).webContents.executeJavaScript('({text:document.body.textContent,media:document.querySelectorAll("video,audio,iframe,script").length})'),win.title)
  assert.deepEqual(content,{text:'',media:0})
  await blackCapture(win,'restart-'+win.title)
 }
 assert.equal((await api('greenScreenState')).open,false)
 assert.equal((await api('timeWidgetState')).open,false)
 pass('重启先准备三个固定标题与渲染首帧：真实 BitBlt 全黑，无媒体或脚本')
 await openFixtures()
 const reopened=await windows()
 for(const win of idle)assert.equal(reopened.find(w=>w.title===win.title).hwnd,win.hwnd)
 const timer=await targetFor('time-widget')
 await timer.waitForFunction(()=>document.getElementById('time')?.textContent==='02:03',null,{polling:50,timeout:8000}).catch(async()=>{
  assert.match(await timer.locator('#time').textContent(),/123|2:03/)
 })
 await timer.screenshot({path:path.join(out,'restart-countdown-restored.png')})
 pass('再次打开倒计时、进场、绿幕，均复用重启后的待机 HWND，内容恢复')
 identities.push({phase:'after-restart',pid,windows:reopened})
 // 0.3.43 起关主窗口 = 所有挂件窗口一起关、程序退出（用户定版），「主界面关了挂件还在」的单实例分支不存在了。
 // 这里改成验它：关主窗口后全部窗口消失、进程退出。
 await main.evaluate(w=>w.close())
 for(let i=0;i<150&&await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length>0).catch(()=>false);i++)await new Promise(r=>setTimeout(r,40))
 const afterClose=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length).catch(()=>0)
 assert.equal(afterClose,0)
 pass('关主窗口时所有挂件窗口一起关、程序退出')
 await app.close().catch(()=>{});app=undefined
 await start()
 await api('saveSettings',{outputCaptureMode:'transparent'})
 await api('timeWidgetClose');await api('entranceClose');await api('greenScreenClose')
 await app.close();app=undefined
 await start();await affinity('透明模式进程重启')
 const transparentIdle=await windows()
 for(const win of transparentIdle){assert.ok(win.rendererPid>0);await blackCapture(win,'transparent-restart-'+win.title)}
 await api('timeWidgetOpen',cfg)
 const transparentPage=await targetFor('time-widget')
 await transparentPage.waitForLoadState('domcontentloaded')
 const alpha=await (await app.browserWindow(transparentPage)).evaluate(async w=>{
  const b=(await w.webContents.capturePage()).toBitmap();let transparent=0;for(let i=3;i<b.length;i+=4)if(b[i]===0)transparent++;return transparent/(b.length/4)
 })
 assert.ok(alpha>0,'透明模式恢复后仍有透明像素')
 pass('透明模式重启待机全黑，打开倒计时后恢复真实 alpha 透明',{alpha})
 await api('timeWidgetClose')
 await app.close();app=undefined
 await start();assert.equal((await windows()).length,3)
 pass('全部关闭后再开客户端，采集标题记录仍保留')
 await app.close();app=undefined
 // 仅删除本测试 mkdtemp 中的索引，模拟从尚未记录采集窗口的 0.3.38 升级。
 await fs.unlink(path.join(profile,'data/capture-windows.json'))
 await start()
 const migrated=await windows()
 assert.equal(migrated.length,0)
 pass('从旧版本首次升级：没有记录的窗口不凭空恢复（开哪个才有哪个）')
 assert.deepEqual(errors,[])
}catch(error){failure=error;console.error(error.stack||error)}
finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,identities,errors,failure:String(failure||'')},null,2))}
if(failure)throw failure
console.log(`SUMMARY ${checks.length}/${checks.length} PASS`)
