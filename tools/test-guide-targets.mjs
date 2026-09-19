// 基础模式「带我找到」定位验收：20 个娱乐功能 × 3 步，逐个在真实隐藏 Electron 里点定位按钮，
// 断言：目标真的在功能页内容区找到并可见；定位不打开弹窗/窗口、不改本地配置、不切高级；
// 贴纸统计第一步允许跳到直播连接器，但绝不能清零统计。
// 用法：node tools/test-guide-targets.mjs   （产物目录默认 output/fable-guide-build，可用 ZL_GUIDE_OUT_DIR 覆盖）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {_electron as electron} from 'playwright-core'
import {writeHiddenElectronBootstrap} from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'output/playwright/guide-targets')
const outDir=process.env.ZL_GUIDE_OUT_DIR||'output/fable-guide-build'
await fs.mkdir(out,{recursive:true})
// 只认新鲜产物：主进程入口和渲染页都得在，且渲染包里得有本轮的定位工具（避免拿旧构建冒充）
for(const file of ['main/index.js','preload/index.js','renderer/index.html'])await fs.access(path.join(root,outDir,file))
const rendererDir=path.join(root,outDir,'renderer/assets'),bundles=(await fs.readdir(rendererDir)).filter(f=>f.endsWith('.js'))
let bundled=false
for(const f of bundles){if((await fs.readFile(path.join(rendererDir,f),'utf8')).includes('zl-guide-reveal')){bundled=true;break}}
assert.ok(bundled,'构建产物里没有引导定位代码，请先构建到 '+outDir)

const profile=await fs.mkdtemp(path.join(out,'session-')),entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true,outDir})
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry],cwd:root,env})
const page=await app.firstWindow();page.setDefaultTimeout(15000)
const checks=[],errors=[],failures=[],report=[];page.on('pageerror',e=>errors.push(e.message))
const check=(name,value,detail)=>{if(value){checks.push(name);console.log('PASS '+name)}else{failures.push(name+(detail?' :: '+detail:''));console.log('FAIL '+name+(detail?' :: '+detail:''))}}
const goto=async(route)=>{await page.evaluate(route=>location.hash=route,route);await page.waitForTimeout(500)}
const basic=()=>page.getByRole('group',{name:'配置模式',exact:true}).getByRole('button',{name:'基础',exact:true}).getAttribute('aria-pressed')
const shot=name=>page.screenshot({path:path.join(out,name+'.png')}).catch(()=>{})
const windowCount=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)
const snapshot=async()=>page.evaluate(async()=>{
  const ls={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);ls[k]=localStorage.getItem(k)}
  const {settings}=await window.api.getSettings()
  return {ls,settings,hash:location.hash}
})
const LOCATE_LABEL=['带我开始配置','带我找到设置','带我找到操作按钮']

// 20 个功能以页面源码为准；三步元数据以 featureWalkthroughs 为准，两边必须一一对应
const pageSource=await fs.readFile(path.join(root,'src/renderer/src/pages/Entertainment.tsx'),'utf8')
const ids=[...pageSource.matchAll(/\{ id: '([^']+)', label:/g)].map(m=>m[1])
const walkSource=await fs.readFile(path.join(root,'src/renderer/src/lib/featureWalkthroughs.ts'),'utf8')
const walkIds=[...walkSource.matchAll(/^\s{2}([a-z]+):\[\{instruction/gm)].map(m=>m[1])
const routeSteps=new Set([...walkSource.matchAll(/^\s{2}([a-z]+):\[\{instruction:'[^']*',target:\{route:/gm)].map(m=>m[1]+':0'))
try{
  check('page lists 20 features',ids.length===20,String(ids.length))
  check('every feature has exactly one 3-step walkthrough',ids.length===walkIds.length&&ids.every(id=>walkIds.includes(id)),ids.filter(id=>!walkIds.includes(id)).join(','))
  await page.waitForFunction(()=>!!window.api?.register)
  await page.evaluate(async()=>{await window.api.register('guide_target_fixture','Fixture123!','定位验收');await window.api.login('guide_target_fixture','Fixture123!');await window.api.saveSettings({guideSeen:true,autoLogin:false});localStorage.setItem('zl-guide-seen','1');localStorage.setItem('zl_configuration_level','basic')})
  await page.reload();await page.getByRole('link',{name:'娱乐助手',exact:true}).waitFor()
  // 贴纸统计先塞一笔真实计数：三步引导走完后必须原样保留
  await page.evaluate(()=>window.api.stickerImport({'定位验收礼物':3}))
  const baseWindows=await windowCount()
  for(const id of ids){
    await goto('/ent?tool='+id)
    const guide=page.getByTestId('basic-feature-guide');await guide.waitFor()
    // 等功能页真的渲染出控件（有的页面要等主进程状态回来），再拍快照
    await page.waitForFunction(id=>!!document.querySelector(`[data-feature-content="${id}"]`)?.querySelector('button,input,select,textarea'),id)
    await page.waitForTimeout(400)
    check(id+': guide shown in basic mode',await basic()==='true')
    const before=await snapshot()
    const steps=[]
    for(let step=0;step<3;step++){
      await guide.getByRole('list').getByRole('button').nth(step).click()
      await guide.getByRole('button',{name:LOCATE_LABEL[step],exact:true}).click()
      if(routeSteps.has(id+':'+step)){
        await page.waitForFunction(()=>location.hash!=='#/ent?tool=sticker')
        const hash=await page.evaluate(()=>location.hash)
        check(`${id} step ${step+1}: navigates to connector without touching the page`,hash==='#/connector',hash)
        steps.push({step:step+1,route:hash})
        await goto('/ent?tool='+id);await guide.waitFor()
        await page.waitForFunction(id=>!!document.querySelector(`[data-feature-content="${id}"]`)?.querySelector('button,input,select,textarea'),id)
        continue
      }
      let info=null
      try{
        await page.waitForFunction(()=>document.querySelector('[data-guide-focus="true"]'),null,{timeout:4000})
        info=await page.evaluate(id=>{
          const el=document.querySelector('[data-guide-focus="true"]')
          const scope=document.querySelector(`[data-feature-content="${id}"]`)
          const active=document.activeElement
          const name=el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')||'').split(' ').map(x=>document.getElementById(x)?.textContent||'').join(' ').trim()||el.textContent
          return {tag:el.tagName.toLowerCase(),name:(name||'').replace(/\s+/g,' ').trim().slice(0,60),inScope:!!scope&&scope.contains(el),inGuide:!!el.closest('[data-testid="basic-feature-guide"]'),visible:el.checkVisibility(),focusedInScope:!!scope&&scope.contains(active)&&active!==document.body,focusedTag:active?.tagName.toLowerCase(),focusedName:(active?.getAttribute('aria-label')||active?.textContent||'').replace(/\s+/g,' ').trim().slice(0,40),concealed:!!el.closest('[data-advanced-field],[data-advanced-fields]')&&!el.closest('[data-advanced-section]')}
        },id)
      }catch{info=null}
      const toastMissing=await page.getByText('先完成前面的选择').count()
      check(`${id} step ${step+1}: target located`,!!info&&toastMissing===0,info?'':'not found; toast='+toastMissing)
      if(info){
        check(`${id} step ${step+1}: target is a visible real control inside the feature page`,info.inScope&&!info.inGuide&&info.visible&&!info.concealed,JSON.stringify(info))
        steps.push({step:step+1,...info})
      }
      check(`${id} step ${step+1}: no dialog opened by locating`,await page.getByRole('dialog').count()===0)
      // 焦点绝不能落在清零/删除/重置这类一按回车就执行的按钮上
      if(info)check(`${id} step ${step+1}: focus never lands on a destructive button`,!(info.focusedTag==='button'&&/清零|清空|删除|重置/.test(info.focusedName||'')),JSON.stringify(info))
      await page.evaluate(()=>document.querySelector('[data-guide-focus="true"]')?.removeAttribute('data-guide-focus'))
    }
    const after=await snapshot()
    check(id+': locating changed no local configuration',JSON.stringify(before.ls)===JSON.stringify(after.ls)&&JSON.stringify(before.settings)===JSON.stringify(after.settings),Object.keys(after.ls).filter(k=>before.ls[k]!==after.ls[k]).join(','))
    check(id+': locating opened no window',await windowCount()===baseWindows)
    check(id+': still basic after locating',await basic()==='true')
    report.push({id,steps})
    await shot(id)
  }
  const sticker=await page.evaluate(()=>window.api.stickerState())
  check('sticker stats survive the guide untouched',sticker.total===3&&sticker.rows.some(r=>r.name==='定位验收礼物'&&r.count===3),JSON.stringify(sticker).slice(0,200))
  check('no renderer errors',errors.length===0,errors.join(' | '))
  assert.deepEqual(failures,[])
  console.log(`GUIDE TARGETS ${checks.length}/${checks.length} PASS`)
}catch(error){await shot('failure');console.log('FAILURES',failures);throw error}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,failures,errors,report},null,2));await app.close()}
