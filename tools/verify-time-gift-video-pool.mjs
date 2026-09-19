// 真实时间礼物入口 → 绿幕排队；窗口和媒体仅在隔离 profile 内创建。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'output/playwright/time-gift-video-pool')
await fs.mkdir(output,{recursive:true})
const profile=await fs.mkdtemp(path.join(output,'session-')),run=promisify(execFile)
const video=path.join(profile,'gift.mp4')
await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=160x90:r=15','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-y',video],{windowsHide:true})
await build({stdin:{contents:`export * as time from './src/main/time-widget';export * as green from './src/main/green-screen';`,resolveDir:root},bundle:true,platform:'node',format:'cjs',outfile:path.join(profile,'qa.cjs'),external:['electron'],tsconfig:path.join(root,'tsconfig.node.json'),logLevel:'silent'})
await fs.writeFile(path.join(profile,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',__dirname);app.setAppPath(${JSON.stringify(root)});app.whenReady().then(async()=>{global.qa=require('./qa.cjs');const c=new BrowserWindow({show:false});await c.loadURL('about:blank');global.ready=true});`)
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(profile,'main.cjs')],env})
const checks=[],call=(ns,name,...args)=>app.evaluate((_,{ns,name,args})=>global.qa[ns][name](...args),{ns,name,args})
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),state=()=>call('green','greenScreenState')
const pass=(name,value,detail)=>{assert.ok(value,`${name}: ${JSON.stringify(detail)}`);checks.push(name);console.log('PASS '+name)}
const until=async fn=>{for(let i=0;i<100;i++){const value=await fn();if(value)return value;await sleep(50)}throw Error('condition timed out')}
const gift={name:'棒棒糖',op:'加减',seconds:30,video,videoLoop:true,videoSeconds:0}
try{
  await until(()=>app.evaluate(()=>global.ready))
  await call('time','openTimeWidget',{initial:1000,enable:true,clockSpeed:60000,showGift:false,boxVideoSlot:4,boxVideoOverflow:true,gifts:[gift],startHotkey:{enabled:false},endHotkey:{enabled:false}})
  await sleep(400)
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','未开窗口测试','test')
  await sleep(200);let s=await state(),log=await call('time','timeWidgetLog')
  pass('没有打开绿幕时礼物视频不会凭空开窗，时间仍结算',!s.open&&(await call('time','timeWidgetState')).remaining===1030,s)
  pass('未播放原因保留在该条礼物记录里',/没有打开|没打开/.test(log[0].error||''),log[0])
  await call('green','openGreenScreen','','video','',2)
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','允许分流','test')
  s=await until(async()=>{const next=await state();return next.slots[1].src?next:false})
  pass('优先窗口4没开，允许分流时只去开着的2号',s.slots[1].src===video&&!s.slots[3].open,s)
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','排队','test');s=await state()
  pass('窗口忙时后续礼物排队，保留当前媒体',s.queued===1&&s.slots[1].src===video,s)
  await call('green','blankGreenScreen',2)
  s=await until(async()=>{const next=await state();return next.queued===0&&next.slots[1].src===video?next:false})
  pass('前一条结束后排队礼物接上同一个已开窗口',s.slots[1].open&&!s.slots[3].open,s)
  await call('green','stopCommandGreenScreens')
  await call('time','timeWidgetUpdate',{boxVideoOverflow:false})
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','固定未开','test');s=await state()
  pass('固定4号但4号没开时不占用其他窗口',!s.slots[1].src&&!s.slots[3].open&&s.queued===0,s)
  await call('green','openGreenScreen','','video','',4)
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','固定4号','test')
  s=await until(async()=>{const next=await state();return next.slots[3].src?next:false})
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','固定排队','test');s=await state()
  pass('固定4号忙时排队，空闲2号保持空闲',s.queued===1&&s.slots[3].src===video&&!s.slots[1].src,s)
  const stopped=await call('green','stopCommandGreenScreens');s=await state()
  pass('停止视频清掉时间礼物的媒体和队列，保留采集窗口',stopped.stopped===1&&s.queued===0&&s.slots[3].open&&!s.slots[3].src,s)
  await call('time','timeWidgetUpdate',{boxVideoOverflow:true,gifts:[{...gift,videoLoop:false}]})
  await call('time','handleTimeWidgetGift','棒棒糖',1,'','自然结束','test')
  await until(async()=>app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='绿幕4');return w? w.webContents.executeJavaScript(`document.querySelector('video')?.currentTime>0`):false}))
  await until(async()=>!(await state()).slots[3].src);s=await state()
  pass('实际视频自然播放结束后清掉素材、窗口仍开着',s.slots[3].open&&!s.slots[3].src,s)
  const bad=path.join(profile,'missing.mp4')
  await call('time','timeWidgetUpdate',{gifts:[{...gift,video:bad}]});await call('time','handleTimeWidgetGift','棒棒糖',1,'','素材失效','test');log=await call('time','timeWidgetLog')
  pass('礼物视频文件失效有明确记录，时间正常结算',/素材不存在/.test(log[0].error||'')&&log[0].delta===30,log[0])
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,profile},null,2))
  console.log(`time gift video pool: ${checks.length}/${checks.length} PASS`)
}catch(error){await fs.writeFile(path.join(profile,'failure.json'),JSON.stringify({checks,error:String(error),state:await state()},null,2));throw error}
finally{await app.close()}
