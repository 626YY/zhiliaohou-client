// 从发行目录的 app.asar 加载真实构建，使用相同 Electron 版本、独立配置和打包资源路径。
// 不运行安装器、不触碰正式安装目录；检查动态分包和附带资源在发行结构中可用。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const root=path.resolve(import.meta.dirname,'..')
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version
const resources=path.join(root,`release/v${version}/win-unpacked/resources`)
const archive=path.join(resources,'app.asar')
await fs.access(archive)
const { extractFile } = createRequire(import.meta.url)('@electron/asar')
assert.equal(JSON.parse(extractFile(archive,'package.json').toString()).version,version)
for(const file of ['说明.txt','build/icon.ico','sql.js/sql-wasm.wasm','pyembed/python.exe','connector-assets/douyin_room.py','mods-catalog/manifests/wheellive.json'])await fs.access(path.join(resources,file))
const out=path.join(root,'output/playwright/packaged-visual')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true,outDir:path.join(archive,'out')})
let bootstrap=await fs.readFile(entry,'utf8')
// 旧转盘使用产品自己的后台绘制设置；测试主页面仍保持唤醒供隐藏 UI 操作。
assert.ok(bootstrap.includes('backgroundThrottling: false, paintWhenInitiallyHidden: true'))
bootstrap=bootstrap.replace('backgroundThrottling: false, paintWhenInitiallyHidden: true',"backgroundThrottling: args[0]?.title?.startsWith('高级转盘') ? args[0]?.webPreferences?.backgroundThrottling : false, paintWhenInitiallyHidden: true")
bootstrap=bootstrap.replace(`electron.app.setAppPath(${JSON.stringify(root)});`,`electron.app.setAppPath(${JSON.stringify(archive)});\nObject.defineProperty(electron.app,'isPackaged',{get:()=>true});\nObject.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});`)
await fs.writeFile(entry,bootstrap)
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry,`--user-data-dir=${profile}`],cwd:root,env})
const errors=[]
app.on('window',page=>page.on('pageerror',e=>errors.push(e.message)))
let checks=0
const pass=name=>{checks++;console.log('PASS '+name)}
try{
  const page=await app.firstWindow()
  await page.waitForFunction(()=>!!window.api?.login,null,{polling:50})
  assert.ok(decodeURIComponent(page.url()).includes('app.asar/out/renderer'))
  assert.equal(await app.evaluate(({app})=>app.getAppPath()),archive)
  pass(`发行 app.asar 启动成功，版本 ${version}，资源齐全`)
  await page.evaluate(async()=>{
    // 注册本地账号也会建立会话，先设好向导状态，防止启动恢复会话时抢先跳到 /guide。
    await window.api.saveSettings({guideSeen:true,autoLogin:false})
    localStorage.setItem('zl-guide-seen','1');localStorage.setItem('zl-theme','amethyst')
    await window.api.register('package_visual','Fixture123!','安装包验收')
    const r=await window.api.login('package_visual','Fixture123!');if(!r.ok)throw Error(r.error)
    location.hash='/settings'
  })
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>document.querySelector('main'),null,{polling:50})
  await page.evaluate(()=>{location.hash='/settings'})
  await page.waitForFunction(()=>document.querySelector('[aria-label="界面主题：紫晶"]'),null,{polling:50})
  assert.equal(await page.locator('[aria-label^="界面主题："]').count(),10)
  pass('设置分包加载，九套主题和自动模式都可选')
  assert.equal(await page.getByLabel('挂件采集模式',{exact:true}).inputValue(),'green')
  assert.equal(await page.getByLabel('挂件采集模式',{exact:true}).locator('option').count(),2)
  assert.equal(await app.evaluate(({app})=>app.commandLine.getSwitchValue('force-color-profile')),'srgb')
  assert.equal(await page.getByLabel('画面渲染方式',{exact:true}).inputValue(),'compatible')
  assert.equal((await app.evaluate(({app})=>app.getGPUFeatureStatus())).gpu_compositing,'disabled_software')
  pass('发行包默认绿幕采集，保留原生透明选项，绿幕颜色固定为 sRGB')
  const outputFor=async part=>{
    for(let attempt=0;attempt<100;attempt++){
      const target=app.windows().find(w=>w!==page&&w.url().includes(part))
      if(target){await target.waitForLoadState('domcontentloaded');return target}
      await page.waitForTimeout(50)
    }
    throw Error('找不到发行输出：'+part)
  }
  const snapshot=async(target,name)=>{
    const handle=await app.browserWindow(target)
    const pixels=await handle.evaluate(async w=>{
      // 同一窗口切到待机页时，离屏渲染的首帧可能尚未到达；只接受非空截图。
      let image
      for(let attempt=0;attempt<20;attempt++){
        image=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})
        if(!image.isEmpty())break
        await new Promise(resolve=>setTimeout(resolve,50))
      }
      if(image.isEmpty())throw Error('发行窗口未产出首帧：'+w.webContents.getURL())
      const bitmap=image.toBitmap();let green=0,black=0,transparent=0
      for(let i=0;i<bitmap.length;i+=4){
        if(bitmap[i]===0&&bitmap[i+1]===255&&bitmap[i+2]===0&&bitmap[i+3]===255)green++
        if(bitmap[i]===0&&bitmap[i+1]===0&&bitmap[i+2]===0&&bitmap[i+3]===255)black++
        if(bitmap[i+3]===0)transparent++
      }
      return {bytes:Array.from(image.toPNG()),green:green/(bitmap.length/4),black:black/(bitmap.length/4),transparent:transparent/(bitmap.length/4)}
    })
    const bytes=Buffer.from(pixels.bytes)
    await fs.writeFile(path.join(out,name+'.png'),bytes)
    return {green:pixels.green,black:pixels.black,transparent:pixels.transparent,md5:createHash('md5').update(bytes).digest('hex')}
  }
  assert.equal((await page.evaluate(()=>window.api.timeWidgetOpen({initial:30,enable:false,showSeconds:true,showGift:false,autoHide:true,theme:'paper',startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''}}))).ok,true)
  const timer=await outputFor('time-widget')
  await timer.waitForFunction(()=>document.getElementById('time')?.textContent==='30',null,{polling:50})
  const timerHandle=await app.browserWindow(timer)
  const timerId=await timerHandle.evaluate(w=>w.id)
  assert.equal((await timerHandle.evaluate(w=>w.getBackgroundColor())).toLowerCase(),'#00ff00')
  const shown=await snapshot(timer,'packaged-countdown-active')
  await page.evaluate(()=>window.api.timeWidgetAdjust(-30))
  await timer.waitForFunction(()=>document.body.style.visibility==='hidden',null,{polling:50})
  const blank=await snapshot(timer,'packaged-countdown-zero')
  assert.equal(blank.green,1)
  assert.notEqual(shown.md5,blank.md5)
  await page.evaluate(()=>window.api.timeWidgetAdjust(12))
  await timer.waitForFunction(()=>document.body.style.visibility==='visible'&&document.getElementById('time')?.textContent==='12',null,{polling:50})
  assert.equal(await timerHandle.evaluate(w=>w.id),timerId)
  await page.evaluate(async()=>{
    await window.api.timeWidgetUpdate({autoHide:false,theme:'aurora',zeroText:'时间到'})
    await window.api.timeWidgetClear()
  })
  await timer.waitForFunction(()=>document.querySelector('#time')?.textContent==='时间到',null,{polling:50})
  const zeroLayout=await timer.locator('#time').evaluate(el=>{
    const head=el.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el)
    return {bottom:(range.getBoundingClientRect().bottom-head.top)/head.height*103,fontSize:parseFloat(getComputedStyle(el).fontSize)}
  })
  assert.ok(zeroLayout.bottom<=96&&zeroLayout.fontSize===32,'发行包归零文字仍遮挡底部横线 '+JSON.stringify(zeroLayout))
  await snapshot(timer,'packaged-countdown-timeup-layout')
  await page.evaluate(()=>window.api.timeWidgetClose())
  pass('发行倒计时归零保留同一窗口、加时恢复；时间到文字不遮挡底部横线')
  await timer.waitForURL('data:text/html*')
  await timer.waitForFunction(()=>document.readyState==='complete'&&document.body.children.length===0)
  assert.equal((await snapshot(timer,'packaged-countdown-closed-black')).black,1)
  await page.evaluate(()=>window.api.timeWidgetOpen({initial:45,enable:false,showSeconds:true,showGift:false,autoHide:false}))
  await timer.waitForFunction(()=>document.getElementById('time')?.textContent==='45')
  assert.equal(await timerHandle.evaluate(w=>w.id),timerId)
  const switched=await page.evaluate(()=>window.api.saveSettings({outputCaptureMode:'transparent'}))
  assert.equal(switched.outputWindowsNeedReopen,true)
  assert.equal(await timerHandle.evaluate(w=>w.getBackgroundColor().toLowerCase()),'#00ff00')
  assert.equal(await timerHandle.evaluate(w=>w.id),timerId)
  await page.evaluate(async()=>{await window.api.timeWidgetClose();await window.api.timeWidgetOpen({initial:45,enable:false,showSeconds:true,showGift:false,autoHide:false})})
  const transparentTimer=await outputFor('time-widget')
  await transparentTimer.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgba(0, 0, 0, 0)')
  assert.ok((await snapshot(transparentTimer,'packaged-countdown-transparent')).transparent>0)
  await page.evaluate(async()=>{await window.api.timeWidgetClose();await window.api.saveSettings({outputCaptureMode:'green'})})
  pass('发行关闭绿幕为真实透明底，切换提示重开；关闭挂件全黑，同模式重开复用采集源')
  await page.evaluate(async()=>{
    await window.api.entranceConfigure({bannerSeconds:1,bannerWidth:400,bannerHeight:120,bannerStyle:'royal',rules:[{id:'capture',enabled:true,match:'any',name:'',text:'欢迎{name}',dedupeSeconds:0}]})
    await window.api.entranceOpen()
  })
  const entrance=await outputFor('entrance-widget')
  await entrance.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(0, 255, 0)',null,{polling:50})
  assert.equal((await snapshot(entrance,'packaged-entrance-idle')).green,1)
  await page.evaluate(()=>window.api.entranceTest('本地采集验收'))
  await entrance.waitForFunction(()=>document.querySelector('.arrival-name')?.textContent==='本地采集验收',null,{polling:50})
  await entrance.waitForTimeout(450)
  const active=await snapshot(entrance,'packaged-entrance-active')
  assert.ok(active.green<0.99)
  await entrance.waitForFunction(()=>!document.querySelector('.arrival'),null,{polling:50})
  assert.equal((await snapshot(entrance,'packaged-entrance-ended')).green,1)
  await page.evaluate(()=>window.api.entranceClose())
  pass('发行进场空闲与结束均全帧纯绿，特效和昵称实际出图')
  const wheels=[]
  for(const source of [1,2]){
    assert.equal((await page.evaluate(source=>window.api.advancedWheelOpen({source,sectorCount:10,hotkey:'',options:[{text:'本地验收',weight:1}]}),source)).ok,true)
    const target=await outputFor('advanced-wheel-'+source)
    await target.waitForFunction(()=>typeof window.__spin==='function',null,{polling:50})
    const handle=await app.browserWindow(target)
    assert.equal(await handle.evaluate(w=>w.webContents.getBackgroundThrottling()),false)
    assert.equal((await handle.evaluate(w=>w.getBackgroundColor())).toLowerCase(),'#00ff00')
    await target.evaluate(()=>{document.title='测试动态标题'})
    await target.waitForTimeout(100)
    assert.equal(await handle.evaluate(w=>w.getTitle()),'高级转盘'+source)
    wheels.push({source,target})
  }
  const spinResults=await page.evaluate(()=>Promise.race([
    Promise.all([window.api.advancedWheelSpin(1),window.api.advancedWheelSpin(2)]),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('后台转盘未在 15 秒内完成')),15000))
  ]))
  assert.ok(spinResults.every(result=>result.ok&&Number.isInteger(result.result)))
  for(const {source,target} of wheels){
    assert.ok(await target.locator('#result').textContent())
    await snapshot(target,'packaged-advanced-wheel-'+source)
    await page.evaluate(source=>window.api.advancedWheelClose(source),source)
  }
  pass('两个旧高级转盘保留采集标题和纯绿底，隐藏时完整转动并产出结果')
  await page.evaluate(()=>window.api.entranceConfigure({rules:[
    {id:'vip',enabled:true,match:'equals',name:'专属昵称',text:'只欢迎{name}',video:'',sound:'',dedupeSeconds:0},
    {id:'any',enabled:true,match:'any',name:'',text:'属于你的舞台',video:'',sound:'',dedupeSeconds:0}
  ]}))
  await page.evaluate(()=>{location.hash='/ent'})
  await page.getByRole('button',{name:/^大哥进场/}).dispatchEvent('click')
  await page.waitForFunction(()=>document.querySelector('[aria-label="进场特效：王者加冕"]'),null,{polling:50})
  assert.equal(await page.locator('[aria-label^="进场特效："]').count(),10)
  await page.getByRole('button',{name:'进场特效：王者加冕',exact:true}).dispatchEvent('click')
  assert.equal(await page.locator('.arrival-message').textContent(),'属于你的舞台 榜一大哥')
  await page.getByPlaceholder('观众昵称',{exact:true}).first().fill('专属昵称')
  assert.equal(await page.locator('.arrival-message').textContent(),'只欢迎专属昵称')
  await page.waitForTimeout(850)
  const win=await app.browserWindow(page)
  const bytes=await win.evaluate(async w=>Array.from((await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()))
  await fs.writeFile(path.join(out,'packaged-entrance.png'),Buffer.from(bytes))
  pass('娱乐分包与十种进场可用；预览按昵称匹配正确规则，自动补齐无占位符文案')
  await page.getByRole('button',{name:/返回功能列表/}).click()
  await page.getByRole('button',{name:/^时间插件/}).first().click()
  const timeThemes=page.getByRole('combobox',{name:'时间皮肤',exact:true})
  await timeThemes.waitFor({state:'visible'})
  assert.equal(await timeThemes.locator('option').count(),25)
  await page.evaluate(()=>window.api.timeWidgetOpen({initial:123,enable:false,autoHide:false,theme:'nebula',startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''}}))
  const newTimer=await outputFor('time-widget')
  for(const [id,name] of [['nebula','星云跃迁'],['sunset','落日海岸'],['gilded','鎏金礼赞'],['glacier','冰川档案'],['graphite','石墨仪表']]){
    await page.getByRole('button',{name:'时间皮肤：'+name,exact:true}).click()
    assert.equal(await timeThemes.inputValue(),id)
    await newTimer.waitForFunction(id=>document.body.dataset.theme===id,id,{polling:50})
    await snapshot(newTimer,'packaged-new-skin-'+id)
  }
  await page.evaluate(()=>window.api.timeWidgetClose())
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:/^时间插件/}).first().click()
  assert.equal(await page.getByRole('combobox',{name:'时间皮肤',exact:true}).inputValue(),'graphite')
  pass('五款新时间皮肤从画廊点击到发行窗口完整出图，25 个原有及新增选项、重载保存正常')
  const gifts=await page.evaluate(()=>window.api.entertainmentListGiftImages())
  assert.ok(gifts.filter(i=>i.source==='builtin').length>=1300)
  assert.ok(gifts.some(i=>i.path.includes('resources')))
  const check=await page.evaluate(()=>window.api.selfCheck())
  for(const id of ['data','gifts'])assert.equal(check.items.find(i=>i.id===id)?.level,'ok')
  const python=check.items.find(i=>i.id==='python')
  assert.equal(python?.level,'ok',JSON.stringify(python))
  pass('发行资源中的内置礼物与 Python 实际自检通过')
  assert.deepEqual(errors,[])
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused())),true)
}catch(error){
  const main=app.windows()[0]
  if(main)await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors,url:main.url(),text:await main.locator('body').innerText().catch(()=>'<不可读取>')},null,2))
  throw error
}finally{await app.close().catch(()=>{})}
console.log(`发行目录验收 ${checks}/${checks} PASS`)
