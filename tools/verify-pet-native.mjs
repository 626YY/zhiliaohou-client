// 仅采集本脚本创建的真实窗口：源代码构建或指定的发行EXE，独立userData及游戏路径。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { build } from 'esbuild'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const packaged=process.argv[2]
const output=path.join(root,'output/playwright',packaged?'pet-packaged':'pet-native')
await fs.mkdir(output,{recursive:true})
const themeModule=path.join(output,'themes.mjs')
await build({entryPoints:[path.join(root,'src/shared/countdownFrame.ts')],outfile:themeModule,bundle:true,platform:'node',format:'esm'})
const {COUNTDOWN_THEMES}=await import(pathToFileURL(themeModule).href)
const skins=COUNTDOWN_THEMES.filter(s=>s.id.startsWith('pet_'))
const profile=await fs.mkdtemp(path.join(output,'session-'))
let entry
if(packaged)await prepareIsolatedGameProfile(root,profile)
else entry=await writeHiddenElectronBootstrap(root,profile,{visible:true})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
const app=await electron.launch({executablePath:packaged?path.resolve(root,packaged):path.join(root,'node_modules/electron/dist/electron.exe'),args:[...(entry?[entry]:[]),'--user-data-dir='+profile],cwd:root,env,timeout:45000})
const run=promisify(execFile),checks=[],errors=[],shots=[]
app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)))
const page=await app.firstWindow()
const pid=await app.evaluate(()=>process.pid)
const api=(name,...args)=>page.evaluate(([name,args])=>window.api[name](...args),[name,args])
const pass=(name,detail)=>{checks.push({name,detail});console.log('PASS '+name+(detail?' | '+JSON.stringify(detail):''))}
let timer
async function shot(name,method='print'){
  const win=await app.browserWindow(timer)
  const handle=await win.evaluate(w=>w.getNativeWindowHandle().readBigUInt64LE().toString())
  const filename=path.join(output,name+'.png')
  await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/capture-native-window.ps1'),'-WindowHandle',handle,'-ExpectedProcessId',String(pid),'-Path',filename,'-Method',method],{windowsHide:true,timeout:15000})
  const png=await fs.readFile(filename)
  assert.ok(png.length>100)
  const stats=await app.evaluate(({nativeImage},file)=>{
    const im=nativeImage.createFromPath(file),bytes=im.toBitmap(),size=im.getSize()
    let green=0,other=0
    for(let i=0;i<bytes.length;i+=4){if(bytes[i]<8&&bytes[i+1]>247&&bytes[i+2]<8)green++;else other++}
    return {...size,green:green/(green+other),corner:[...bytes.subarray(0,4)]}
  },filename)
  assert.ok(stats.green>.02&&stats.green<.85,'empty/black native capture '+JSON.stringify(stats))
  const md5=createHash('md5').update(png).digest('hex');shots.push({name,method,md5,...stats});return md5
}
try{
  await page.waitForFunction(()=>!!window.api?.timeWidgetOpen)
  const runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,userData:app.getPath('userData')}))
  assert.equal(path.resolve(runtime.userData),profile)
  if(packaged)assert.equal(runtime.packaged,true)
  await (await app.browserWindow(page)).evaluate(w=>w.hide())
  const images=await api('entertainmentListGiftImages')
  const icon=name=>images.find(i=>i.name===name)?.path||images[0]?.path||''
  const gifts=[{name:'玫瑰',op:'加减',seconds:30,img:icon('玫瑰')},{name:'棒棒糖',op:'加减',seconds:-10,img:icon('棒棒糖')},{name:'小心心',op:'加减',seconds:10,img:icon('小心心')},{name:'惊喜盲盒',op:'加减',seconds:1,text:'随机加减',img:icon('小心心')}]
  const cfg={initial:1536,enable:false,title:'距离下播',gifts,giftColumns:2,giftPanel:true,giftPanelWidth:1,giftNameSize:16,giftTextSize:16,giftIconSize:42,cellAlpha:1,scale:1.4,petMotion:true,showGift:false,zeroText:'时间到',showSeconds:false,showNegative:false,autoHide:false,startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''}}
  for(const skin of skins){
    assert.equal((await api('timeWidgetOpen',{...cfg,theme:skin.id,titleColor:skin.titleColor,timeColor:skin.timeColor,giftNameColor:skin.giftNameColor,addColor:skin.addColor,subColor:skin.subColor,boxColor:skin.boxColor,cellBg:skin.cellBg,cellBorder:skin.cellBorder})).ok,true)
    for(let i=0;i<100&&!timer;i++){timer=app.windows().find(p=>p.url().includes('time-widget'));if(!timer)await page.waitForTimeout(100)}
    assert.ok(timer)
    await timer.waitForFunction(id=>document.querySelector('#stage')?.dataset.petSkin===id&&document.querySelector('#time')?.textContent==='00:25:36',skin.id)
    const win=await app.browserWindow(timer)
    await win.evaluate(w=>{w.setPosition(50,50);w.showInactive()})
    await timer.evaluate(()=>document.fonts.ready)
    await timer.waitForTimeout(250)
    const a=await shot(skin.id+'-print-a')
    await timer.waitForTimeout(650)
    const b=await shot(skin.id+'-print-b')
    assert.notEqual(a,b,'native animation frozen: '+skin.id)
    await shot(skin.id+'-bitblt','bitblt')
    pass(skin.name+'：真实PrintWindow两帧不同，BitBlt内容与绿底正常')
  }
  const frames=await timer.evaluate(()=>new Promise(resolve=>requestAnimationFrame(start=>{
    const times=[];let previous=start
    const tick=t=>{times.push(t-previous);previous=t;if(t-start>=1200){const sorted=[...times].sort((a,b)=>a-b);resolve({frames:times.length,elapsed:t-start,averageMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:Math.max(...times)})}else requestAnimationFrame(tick)}
    requestAnimationFrame(tick)
  })))
  assert.ok(frames.frames>20,'render callback stalled')
  pass('实际窗口持续绘制',{...runtime,frames})
  assert.deepEqual(errors,[])
  pass('页面无异常，未登录、未连直播、未操作用户游戏')
}catch(error){errors.push(String(error.stack||error));console.error(error);process.exitCode=1}
finally{await api('timeWidgetClose').catch(()=>{});await app.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,shots},null,2));console.log('PET NATIVE '+(process.exitCode?'FAILED':'PASS')+': '+checks.length+' checks')}
