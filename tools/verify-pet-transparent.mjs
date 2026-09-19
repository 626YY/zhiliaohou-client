// 实际发行 EXE 的透明输出与素材加载验收；只使用独立测试配置，不登录或连接直播间。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile } from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..')
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version
const exe=path.join(root,`release/v${version}/win-unpacked/知了猴整蛊台.exe`)
const output=path.join(root,'output/playwright/pet-transparent')
await fs.mkdir(output,{recursive:true})
const themeModule=path.join(output,'themes.mjs')
await build({entryPoints:[path.join(root,'src/shared/countdownFrame.ts')],outfile:themeModule,bundle:true,platform:'node',format:'esm'})
const {COUNTDOWN_THEMES}=await import(pathToFileURL(themeModule).href)
const profile=await fs.mkdtemp(path.join(output,'session-'))
await prepareIsolatedGameProfile(root,profile)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
const app=await electron.launch({executablePath:exe,args:['--user-data-dir='+profile],cwd:root,env,timeout:45000})
const errors=[],checks=[]
app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)))
const page=await app.firstWindow()
const api=(name,...args)=>page.evaluate(([name,args])=>window.api[name](...args),[name,args])
try{
  await page.waitForFunction(()=>!!window.api?.timeWidgetOpen)
  await (await app.browserWindow(page)).evaluate(w=>w.hide())
  await api('saveSettings',{outputCaptureMode:'transparent'})
  const icons=await api('entertainmentListGiftImages')
  const find=name=>icons.find(i=>i.name===name)?.path||icons[0]?.path||''
  const gifts=[{name:'玫瑰',op:'加减',seconds:30,img:find('玫瑰')},{name:'棒棒糖',op:'加减',seconds:-10,img:find('棒棒糖')},{name:'小心心',op:'加减',seconds:10,img:find('小心心')},{name:'惊喜盲盒',op:'加减',seconds:1,text:'随机加减',img:find('小心心')}]
  for(const skin of COUNTDOWN_THEMES.filter(s=>s.id.startsWith('pet_'))){
    const {id,timeColor:text,titleColor:accent,cellBg:menu,cellBorder:line}=skin
    await api('timeWidgetClose')
    await api('timeWidgetOpen',{theme:id,title:'距离下播',titleColor:accent,timeColor:text,giftNameColor:text,addColor:skin.addColor,subColor:skin.subColor,boxColor:skin.boxColor,cellBg:menu,cellBorder:line,cellAlpha:1,initial:1536,enable:false,showGift:false,showSeconds:false,giftPanel:true,giftColumns:2,giftPanelWidth:1,giftIconSize:42,giftNameSize:16,giftTextSize:16,scale:2,petMotion:true,gifts})
    let timer
    for(let i=0;i<80&&!timer;i++){timer=app.windows().find(p=>p.url().includes('time-widget'));if(!timer)await page.waitForTimeout(100)}
    assert.ok(timer)
    await timer.waitForFunction(()=>document.querySelector('#time')?.textContent==='00:25:36')
    await timer.evaluate(()=>document.fonts.ready)
    const win=await app.browserWindow(timer)
    await win.evaluate(w=>{w.setPosition(80,80);w.showInactive()})
    await timer.waitForTimeout(500)
    let capture
    for(let i=0;i<5;i++){
      capture=await win.evaluate(async w=>{const image=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});if(image.isEmpty())return null;const bitmap=image.toBitmap(),size=image.getSize();const alphaAt=(x,y)=>bitmap[(Math.floor(y)*size.width+Math.floor(x))*4+3];return {png:[...image.toPNG()],alpha:bitmap[3],size,footerAlpha:[alphaAt(size.width*.25,size.height-50),alphaAt(size.width*.75,size.height-50)]}})
      if(capture?.png.length>100)break
      await timer.waitForTimeout(200)
    }
    assert.ok(capture?.png.length>100)
    assert.equal(capture.alpha,0,'outside artwork must be genuinely transparent')
    assert.ok(capture.footerAlpha.every(alpha=>alpha>200),'painted footer is incorrectly clipped: '+capture.footerAlpha)
    await fs.writeFile(path.join(output,id+'.png'),Buffer.from(capture.png))
    const state=await timer.evaluate(()=>({paint:getComputedStyle(document.querySelector('.pet-paint-head')).backgroundImage,clip:getComputedStyle(document.querySelector('.pet-paint-head')).maskImage,charm:document.querySelector('.pet-charm image').getAttribute('href'),digits:document.querySelector('#time').textContent,fontSize:document.querySelector('#time').dataset.petFontSize}))
    assert.ok(state.paint.includes('app.asar')&&state.clip.includes('.mask.svg')&&state.charm.includes('charms.png'))
    checks.push({id,alpha:capture.alpha,size:capture.size,digits:state.digits,fontSize:state.fontSize})
    console.log('PASS '+id+' packaged alpha=0, ASAR artwork/fonts/accessories loaded')
  }
  assert.deepEqual(errors,[])
}catch(error){errors.push(String(error.stack||error));console.error(error);process.exitCode=1}
finally{await api('timeWidgetClose').catch(()=>{});await app.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2));console.log('PET TRANSPARENT '+(process.exitCode?'FAILED':'PASS')+': '+checks.length+' skins')}
