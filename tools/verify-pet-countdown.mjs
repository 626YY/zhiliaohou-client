// 实际 Electron/IPC/截图回归：独立配置，隐藏离屏窗口，不接直播、不启动游戏。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { build } from 'esbuild'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..')
const output=path.join(root,'output/playwright/pet-countdown')
await fs.mkdir(output,{recursive:true})
const bundled=path.join(output,'pet-themes.mjs')
await build({entryPoints:[path.join(root,'src/shared/countdownFrame.ts')],outfile:bundled,bundle:true,format:'esm',platform:'node'})
const {COUNTDOWN_THEMES}=await import(pathToFileURL(bundled).href+'?t='+Date.now())
const themes=COUNTDOWN_THEMES.filter(t=>t.id.startsWith('pet_'))
assert.equal(themes.length,8)
const profile=await fs.mkdtemp(path.join(output,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true})
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry,'--user-data-dir='+profile],cwd:root,env})
const errors=[],checks=[],shots=[]
const attach=p=>p.on('pageerror',e=>errors.push(e.message))
app.on('window',attach)
const page=await app.firstWindow();attach(page)
page.setDefaultTimeout(12000)
const api=(name,...args)=>page.evaluate(([name,args])=>window.api[name](...args),[name,args])
const pass=(name,detail)=>{checks.push({name,detail});console.log('PASS '+name+(detail?' | '+JSON.stringify(detail):''))}
let timer
async function capture(name){
  const win=await app.browserWindow(timer)
  let png
  for(let attempt=0;attempt<5;attempt++){
    await win.evaluate(w=>{w.webContents.invalidate()})
    await timer.waitForTimeout(180)
    const bytes=await win.evaluate(async w=>{const image=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});return image.isEmpty()?[]:[...image.toPNG()]})
    if(bytes.length>100){png=Buffer.from(bytes);break}
  }
  assert.ok(png?.length>100,'empty screenshot '+name)
  assert.equal(png.subarray(1,4).toString(),'PNG','invalid screenshot '+name)
  await fs.writeFile(path.join(output,name+'.png'),png)
  const md5=createHash('md5').update(png).digest('hex');shots.push({name,md5});return md5
}
async function checkBounds(){
  const boxes=await timer.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}:null}
    return {width:innerWidth,height:innerHeight,panel:rect('#panel'),head:rect('#head'),gifts:rect('#gift-panel'),surface:rect('#pet-surface'),art:rect('.pet-mascot')||rect('.pet-paint-head'),charm:rect('.pet-charm'),cells:document.querySelectorAll('.gift-cell').length,
      iconOverlap:[...document.querySelectorAll('.gift-icon')].some(e=>{const a=e.getBoundingClientRect(),b=document.querySelector('.pet-charm').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top}),
      overflow:[...document.querySelectorAll('#time,.gift-name,.gift-effect')].filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>e.textContent)}
  })
  assert.ok(boxes.panel.right<=boxes.width+1&&boxes.panel.bottom<=boxes.height+1,'window crop '+JSON.stringify(boxes))
  assert.ok(boxes.art.y>=-1&&boxes.art.right<=boxes.width+1,'mascot crop '+JSON.stringify(boxes))
  assert.ok(boxes.charm.x>=-1&&boxes.charm.right<=boxes.width+1&&boxes.charm.bottom<=boxes.height+1,'charm crop '+JSON.stringify(boxes))
  if(boxes.gifts){assert.ok(Math.abs(boxes.gifts.w-boxes.head.w)<1,'menu width mismatch');assert.ok(Math.abs(boxes.gifts.y-boxes.head.bottom)<1,'menu gap')}
  assert.deepEqual(boxes.overflow,[],'text clipped')
  assert.equal(boxes.iconOverlap,false,'charm covers a real gift icon')
  return boxes
}
function themed(id){const t=COUNTDOWN_THEMES.find(t=>t.id===id);return {theme:id,titleColor:t.titleColor,timeColor:t.timeColor,giftNameColor:t.giftNameColor,addColor:t.addColor,subColor:t.subColor,boxColor:t.boxColor,cellBg:t.cellBg,cellBorder:t.cellBorder}}
try{
  await page.waitForFunction(()=>!!window.api?.timeWidgetOpen)
  await api('register','pet_skin_accept','Fixture123!','萌宠皮肤验收')
  assert.equal((await api('login','pet_skin_accept','Fixture123!')).ok,true)
  await api('saveSettings',{guideSeen:true,autoLogin:false})
  const icons=await api('entertainmentListGiftImages')
  const iconFor=name=>icons.find(i=>i.name===name)?.path||icons[0]?.path||''
  const gifts=[{name:'玫瑰',op:'加减',seconds:30,img:iconFor('玫瑰')},{name:'棒棒糖',op:'加减',seconds:-10,img:iconFor('棒棒糖')},{name:'小心心',op:'加减',seconds:10,img:iconFor('小心心')},{name:'惊喜盲盒',mode:'blindbox',op:'加减',seconds:1,img:iconFor('小心心'),text:'随机加减'}]
  const cfg={...themed('pet_cream'),on:true,enable:false,title:'距离下播',initial:1536,clockSpeed:1000,zeroText:'时间到',autoHide:false,showGift:false,showNegative:false,showSeconds:false,giftPanel:true,giftColumns:2,giftPanelWidth:1,giftIconSize:42,giftNameSize:16,giftTextSize:16,cellAlpha:1,scale:2,petMotion:true,gifts,startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''}}
  await page.evaluate(cfg=>{localStorage.setItem('zl-guide-seen','1');localStorage.setItem('zl_configuration_level','advanced');localStorage.setItem('ent_time_cfg',JSON.stringify(cfg))},cfg)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>!!document.querySelector('main'))
  await page.evaluate(()=>{location.hash='/ent'})
  await page.getByRole('button',{name:/^时间插件/}).first().dispatchEvent('click')
  await page.getByRole('combobox',{name:'时间皮肤',exact:true}).waitFor({state:'attached'})
  assert.equal((await api('timeWidgetOpen',cfg)).ok,true)
  for(let i=0;i<100&&!timer;i++){timer=app.windows().find(p=>p.url().includes('time-widget'));if(!timer)await page.waitForTimeout(100)}
  assert.ok(timer,'timer window missing');attach(timer)
  await timer.waitForFunction(()=>document.querySelector('#time')?.textContent==='00:25:36')
  const select=page.getByRole('combobox',{name:'时间皮肤',exact:true})
  const options=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))
  assert.ok(themes.every(t=>options.includes(t.id)))
  pass('8 萌宠皮肤出现在真实设置页下拉菜单')
  for(const theme of themes){
    // selectOption 在隐藏的独立测试窗口仍执行真实 React change/IPC，不伪造页面状态。
    await select.selectOption(theme.id,{force:true})
    await timer.waitForFunction(id=>document.querySelector('#stage')?.dataset.petSkin===id,theme.id)
    await page.waitForFunction(id=>document.querySelector('[data-testid="time-preview"] [data-pet-skin]')?.dataset.petSkin===id,theme.id)
    await timer.waitForTimeout(350)
    await timer.evaluate(()=>document.fonts.ready)
    const b=await checkBounds();assert.equal(b.cells,4)
    assert.equal(await timer.locator('#time').textContent(),'00:25:36')
    const src=await timer.locator('.pet-charm image').getAttribute('href')
    assert.ok(src.includes('/pet-skins/charms.png'))
    const nameColors=await timer.locator('.gift-name').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).color))])
    assert.equal(nameColors.length,1)
    await capture(theme.id)
    if(theme.id==='pet_cream')console.log('TIME METRICS',await timer.locator('#time').evaluate(el=>({font:getComputedStyle(el).fontFamily,size:el.dataset.petFontSize,w:el.clientWidth,h:el.clientHeight,scrollW:el.scrollWidth,scrollH:el.scrollHeight})))
    pass(theme.name+'：角色、实时菜单、预览与真实窗口同主题；宽度/文字无裁切',{width:b.width,height:b.height,side:await timer.locator('.pet-mascot,.pet-paint').getAttribute('data-pet-side')})
  }
  await api('timeWidgetUpdate',{...cfg,...themed('pet_peach'),enable:false})
  for(const columns of [1,2,3])for(const count of [0,1,3,7]){
    const rows=Array.from({length:count},(_,i)=>({...gifts[i%gifts.length],name:'礼物'+(i+1),mode:'direct'}))
    await api('timeWidgetUpdate',{giftColumns:columns,gifts:rows,scale:columns===3?.65:1})
    await timer.waitForTimeout(90)
    const b=await checkBounds();assert.equal(b.cells,count)
    assert.equal(Boolean(b.gifts),count>0)
  }
  pass('1/2/3列 × 0/1/3/7项礼物，菜单增减、缩放、窗口尺寸正确')
  await api('timeWidgetUpdate',{...cfg,...themed('pet_night'),gifts:gifts.slice(0,3),giftColumns:3,giftIconSize:96,giftNameSize:28,giftTextSize:28,scale:.8,giftTicker:true})
  await timer.waitForTimeout(200);await checkBounds();await capture('large-icons-three-columns')
  assert.equal(await timer.locator('#ticker').count(),1)
  pass('96px礼物图与大字号自动扩宽整套皮肤，滚动条无裁切')
  await api('timeWidgetUpdate',{...cfg,...themed('pet_cream'),enable:false,petMotion:false})
  await timer.waitForTimeout(150)
  assert.equal(await timer.locator('.pet-charm').evaluate(e=>getComputedStyle(e).animationName),'none')
  const off1=await capture('motion-off-1');await timer.waitForTimeout(350);const off2=await capture('motion-off-2');assert.equal(off1,off2,'disabled motion changes frame')
  await api('timeWidgetUpdate',{petMotion:true})
  const on1=await capture('motion-on-1');await timer.waitForTimeout(850);const on2=await capture('motion-on-2');assert.notEqual(on1,on2,'animation frames identical')
  pass('小动作关闭两帧相同，开启两帧不同（MD5去重）')
  await timer.emulateMedia({reducedMotion:'reduce'})
  assert.equal(await timer.locator('.pet-charm').evaluate(e=>getComputedStyle(e).animationName),'none')
  await timer.emulateMedia({reducedMotion:'no-preference'})
  pass('系统减少动态效果设置生效')
  await api('timeWidgetUpdate',{enable:true})
  const before=(await api('timeWidgetState')).remaining
  await timer.waitForTimeout(1200)
  await api('timeWidgetUpdate',{...themed('pet_duo')})
  const after=(await api('timeWidgetState')).remaining
  assert.ok(after<before&&after>=before-3,'theme reset countdown')
  await api('timeWidgetPause',5000)
  const giftBefore=(await api('timeWidgetState')).remaining
  const giftReply=await api('timeWidgetTestGift','玫瑰')
  assert.equal(giftReply.ok,true,JSON.stringify(giftReply))
  assert.equal((await api('timeWidgetState')).remaining,giftBefore+30)
  pass('真实走秒不因换肤重置，测试玫瑰经主进程规则增加30秒')
  await api('timeWidgetClear');await timer.waitForFunction(()=>document.querySelector('#time')?.textContent==='时间到')
  await checkBounds();await capture('zero-label')
  await api('timeWidgetUpdate',{showNegative:true,showSeconds:false,zeroText:'很长的结束提示也能完整显示'})
  await api('timeWidgetAdjust',-1234567);await timer.waitForTimeout(120);await checkBounds()
  pass('归零中文与负数/长时间格式不压边框')
  for(const id of ['theatre','legacy_cyan','pet_onsen']){
    await api('timeWidgetUpdate',{...(id.startsWith('legacy')?{theme:id}:themed(id)),scale:1,gifts:[],giftTicker:false,showNegative:false})
    await timer.waitForTimeout(100)
    assert.equal(await timer.evaluate(()=>document.body.dataset.theme),id)
    if(id.startsWith('pet_'))await checkBounds()
    else assert.equal(await timer.locator('.pet-mascot').count(),0)
  }
  pass('旧主题/经典位图与萌宠主题来回切换无装饰残留')
  assert.deepEqual(errors,[],'page errors')
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused())),true)
  pass('真实Electron页面无异常，所有测试窗口保持隐藏且独立')
}catch(error){console.error(error);console.error('Page errors:',errors);if(timer)await capture('failure').catch(()=>{});process.exitCode=1}
finally{
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,shots},null,2))
  await api('timeWidgetClose').catch(()=>{});await app.close()
  console.log('PET COUNTDOWN '+(process.exitCode?'FAILED':'PASS')+': '+checks.length+' checks')
}
