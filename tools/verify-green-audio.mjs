// 本机低音量音轨 + Chromium 实际可听状态 + Windows 输出会话峰值，禁止只检查 muted 字段。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const root=path.resolve(import.meta.dirname,'..'),run=promisify(execFile)
const packaged=process.argv.includes('--packaged')
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version
const resources=path.join(root,`release/v${version}/win-unpacked/resources`),archive=path.join(resources,'app.asar')
const out=path.join(root,'output/playwright/green-audio'+(packaged?'-packaged':''))
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true,outDir:packaged?path.join(archive,'out'):'out'})
if(packaged){let b=await fs.readFile(entry,'utf8');b=b.replace(`electron.app.setAppPath(${JSON.stringify(root)});`,`electron.app.setAppPath(${JSON.stringify(archive)});Object.defineProperty(electron.app,'isPackaged',{get:()=>true});Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});`);await fs.writeFile(entry,b)}
const fixture=path.join(profile,'有声绿幕.mp4'),silent=path.join(profile,'无音轨绿幕.mp4')
await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x00ff00:s=320x180:r=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-vf','drawbox=x=100:y=50:w=90:h=70:color=white:t=fill','-af','volume=0.2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',fixture],{windowsHide:true})
await run('ffmpeg',['-hide_banner','-loglevel','error','-i',fixture,'-c:v','copy','-an','-y',silent],{windowsHide:true})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry,'--user-data-dir='+profile],env,cwd:root})
const page=await app.firstWindow(),checks=[],errors=[]
app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)))
page.setDefaultTimeout(10000)
const api=(name,...args)=>page.evaluate(([name,args])=>window.api[name](...args),[name,args])
const pass=(name,details)=>{checks.push({name,details});console.log('PASS '+name+(details?' | '+JSON.stringify(details):''))}
async function output(slot){
 for(let i=0;i<100;i++){
  let p=app.windows().find(p=>p.url().includes('green-player-'+slot+'.html'))
  // 先开的空绿幕窗口（data: 页）再 loadFile 换成视频页时，Playwright 缓存的 url() 不更新，得进页面里看 location.href
  if(!p)for(const w of app.windows()){try{if((await w.evaluate(()=>location.href)).includes('green-player-'+slot+'.html')){p=w;break}}catch{}}
  if(p){await p.waitForLoadState('domcontentloaded');await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0,null,{polling:50,timeout:8000});return p}
  await page.waitForTimeout(50)
 }
 throw Error('没有绿幕 '+slot)
}
async function measure(){
 const pids=await app.evaluate(({app})=>[process.pid,...app.getAppMetrics().map(m=>m.pid)].filter(Boolean))
 const {stdout}=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/measure-test-audio.ps1'),'-ProcessIds',[...new Set(pids)].join(','),'-Milliseconds','1000'],{windowsHide:true,timeout:15000})
 return JSON.parse(stdout)
}
async function audible(target,name){
 const win=await app.browserWindow(target)
 for(let i=0;i<80&&!await win.evaluate(w=>w.webContents.isCurrentlyAudible());i++)await target.waitForTimeout(50)
 assert.equal(await win.evaluate(w=>w.webContents.isCurrentlyAudible()),true,name+' Chromium 没有声音')
 // 用 page.evaluate 而不是 locator：空绿幕窗口（data: 页）换成视频页后，Playwright 认为那次导航一直没结束，locator 会等到超时
 const state=await target.evaluate(()=>{const v=document.querySelector('video');return {muted:v.muted,paused:v.paused,volume:v.volume,time:v.currentTime,decoded:v.webkitAudioDecodedByteCount}})
 assert.equal(state.muted,false);assert.equal(state.paused,false);assert.ok(state.decoded>0)
 const measured=await measure();assert.ok(measured.Sessions>0&&measured.Peak>0.0001,name+' Windows 输出无声音 '+JSON.stringify(measured))
 pass(name,{...state,...measured})
}
let failure
try{
 await page.waitForFunction(()=>!!window.api?.getSettings)
 await api('saveSettings',{guideSeen:true,autoLogin:false,outputCaptureMode:'green'})
 await page.evaluate(()=>localStorage.setItem('zl-guide-seen','1'))
 await api('register','audio_regression','Fixture123!','绿幕音轨验收')
 await api('login','audio_regression','Fixture123!')
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('link',{name:'娱乐助手',exact:true}).click()
 await page.getByRole('button',{name:/^绿幕窗口/}).click()
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},fixture)
 await page.getByRole('button',{name:'选择',exact:true}).click()
 await page.getByRole('button',{name:'打开 1 号窗口',exact:true}).click()
 const first=await output(1)
 await audible(first,'设置页选择本地视频并打开 1 号绿幕，自动播放原声音轨')
 await first.screenshot({path:path.join(out,'green-playing-with-audio.png')})
 await page.getByRole('button',{name:'关闭 1 号窗口',exact:true}).click()
 await page.waitForTimeout(500)
 const stopped=await measure();assert.equal(stopped.Peak,0)
 pass('点击关闭绿幕窗口后，Windows 输出峰值归零',stopped)
 for(const slot of [2,3,4]){
  await api('greenScreenOpen',fixture,'video','声音回归',slot)
  await audible(await output(slot),slot+' 号绿幕实际有声')
  await api('greenScreenClose',slot)
 }
 await api('greenScreenOpen',fixture,'video','更换素材',1)
 await audible(await output(1),'复用关闭过的绿幕窗口后恢复声音')
 await api('greenScreenOpen',silent,'video','无音轨素材',1)
 const silentPage=await output(1)
 await silentPage.waitForTimeout(650)
 const silentState=await silentPage.locator('video').evaluate(v=>({decoded:v.webkitAudioDecodedByteCount,paused:v.paused,time:v.currentTime}))
 assert.equal(silentState.decoded,0);assert.equal(silentState.paused,false)
 assert.equal((await measure()).Peak,0)
 pass('替换为无音轨视频后画面继续播放，没有上一段的残留声音',silentState)
 await api('greenScreenClose',1)
 await api('saveSettings',{outputCaptureMode:'transparent'})
 await api('greenScreenOpen',fixture,'video','透明模式声音',1)
 await audible(await output(1),'关闭绿幕底后，透明模式仍保留视频声音')
 await api('greenScreenClose',1)
 // 0.3.43：进场视频只去开着的绿幕 4（没开不播），先开一个空窗口当采集来源
 assert.equal((await api('greenScreenOpen','','video','',4)).ok,true)
 await api('entranceConfigure',{bannerSeconds:1,videoSeconds:10,rules:[{id:'audio',enabled:true,match:'any',name:'',text:'欢迎{name}',video:fixture,videoWindow:'green',sound:'',dedupeSeconds:0}]})
 // 0.3.53 起测试进场要先开横幅窗口
 assert.equal((await api('entranceOpen')).ok,true)
 assert.equal((await api('entranceTest','音轨验收')).ok,true)
 await audible(await output(4),'大哥进场调用绿幕视频也有原声')
 // 播完只撤素材、换回绿底，窗口留着（它是主播加进直播伴侣的来源）
 for(let i=0;i<140&&(await api('greenScreenState')).slots.find(s=>s.slot===4)?.src;i++)await page.waitForTimeout(100)
 const slot4=(await api('greenScreenState')).slots.find(s=>s.slot===4)
 assert.equal(slot4.open,true);assert.equal(slot4.src,'')
 await page.waitForTimeout(350);assert.equal((await measure()).Peak,0)
 pass('单次进场视频播放结束自动撤掉素材、窗口留着当采集来源，音频停止')
 assert.deepEqual(errors,[])
}catch(error){failure=error;console.error(error.stack||error)}
finally{await app.close().catch(()=>{});await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,errors,failure:String(failure||'')},null,2))}
if(failure)throw failure
console.log(`SUMMARY ${checks.length}/${checks.length} PASS`)
