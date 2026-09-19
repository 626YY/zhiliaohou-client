// 基础模式「导入时间视频项目 → 时间盲盒」向导回归（TimeProjectSetup）。
// 用法：npx electron-vite build --outDir output/fable-time-project-build && node tools/test-time-project-setup.mjs
// 覆盖：入口在基础模式可见 / 没选项目、纯视频项目、没填礼物不能完成 / 取消不写配置 /
//       导入并绑定新礼物（React 状态 + localStorage + 主进程三处一致）/ 同项目重复导入不叠加 /
//       同名盲盒礼物追加、普通加减礼物改盲盒并保留原字段 / 既有手动事件与别的礼物奖池保留 /
//       项目条目减少后旧 id 不悬空 / 浏览素材库外的文件夹 / 全程仍是基础模式。
// 只用自己建的临时项目和独立 profile，不碰真实素材、不连直播、不开游戏。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {_electron as electron} from 'playwright-core'
import {writeHiddenElectronBootstrap} from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..')
const outDir=process.env.ZL_OUT_DIR||'output/fable-time-project-build'
const out=path.join(root,'output/playwright/time-project-setup')
await fs.mkdir(out,{recursive:true})
await fs.access(path.join(root,outDir,'main/index.js')).catch(()=>{throw new Error(`构建产物不存在：${outDir}，先 npx electron-vite build --outDir ${outDir}`)})
const profile=await fs.mkdtemp(path.join(out,'session-')),entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true,outDir})
const lib=path.join(profile,'测试素材库')
const settingsFile=path.join(profile,'data/settings.json'),settings=JSON.parse(await fs.readFile(settingsFile,'utf8'))
await fs.writeFile(settingsFile,JSON.stringify({...settings,pinyouAssetRoot:lib}))
const {default:iconv}=await import('iconv-lite')
// 项目 = 文件夹里「视频 + 同名 .脚本（GBK）」成对；纯视频项目没有脚本
const projects={
  '时间项目甲':[['加1分','加班增加:60秒'],['减1分','加班减少:60秒'],['翻倍','加班乘以:2'],['纯视频条目',null]],
  '时间项目乙':[['加半分','加班增加:30秒'],['减半分','加班减少:30秒']],
  '纯视频项目':[['随便播',null]]
}
const outside=path.join(profile,'外部时间项目')
async function writeProject(dir,items,videoBytes){
  await fs.mkdir(dir,{recursive:true})
  for(const [name,script] of items){
    await fs.writeFile(path.join(dir,name+'.webm'),videoBytes)
    if(script)await fs.writeFile(path.join(dir,name+'.脚本'),iconv.encode(script,'gbk'))
  }
}
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry],cwd:root,env})
const page=await app.firstWindow();page.setDefaultTimeout(15000)
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message))
const check=(name,value,detail='')=>{assert.ok(value,name+(detail?` | ${detail}`:''));checks.push(name);console.log('PASS '+name+(detail?` | ${detail}`:''))}
const goto=async(route)=>{await page.evaluate(route=>location.hash=route,route);await page.waitForTimeout(700)}
const basic=()=>page.getByRole('group',{name:'配置模式',exact:true}).getByRole('button',{name:'基础',exact:true}).getAttribute('aria-pressed')
const dialog=()=>page.getByRole('dialog')
const btn=name=>dialog().getByRole('button',{name,exact:true})
const readCfg=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('ent_time_cfg')||'{}'))
const rawCfg=()=>page.evaluate(()=>localStorage.getItem('ent_time_cfg'))
const shot=name=>page.screenshot({path:path.join(out,name+'.png')})
const choosePath=dir=>app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},dir)
const openWizard=async()=>{await page.getByRole('button',{name:'导入时间视频项目',exact:true}).click();await dialog().getByTestId('time-project-question').filter({hasText:'选一个时间视频项目'}).waitFor()}
const pickProject=async(name)=>{await dialog().getByRole('radio',{name:new RegExp(name)}).click();await dialog().getByTestId('time-project-preview').getByRole('status').filter({hasText:'识别到'}).waitFor()}
const previewText=()=>dialog().getByTestId('time-project-preview').innerText()
// 带 datalist 的输入框在无障碍树里是 combobox
const fillGift=async(name)=>{await dialog().getByRole('combobox',{name:'抽时间的礼物',exact:true}).fill(name)}
const finish=async()=>{await btn('导入并绑定').click();await dialog().getByTestId('time-project-question').filter({hasText:'导入完成'}).waitFor()}
const doneText=()=>dialog().getByRole('status').innerText()
const byName=(cfg,name)=>(cfg.gifts||[]).find(g=>g.name===name)
const idsOf=(cfg,prefix)=>(cfg.blindBoxEvents||[]).filter(e=>String(e.id).startsWith(prefix+'-')).map(e=>e.id)
const allBound=(cfg)=>(cfg.gifts||[]).every(g=>(g.blindBoxEventIds||[]).every(id=>(cfg.blindBoxEvents||[]).some(e=>e.id===id)))
try{
  await page.waitForFunction(()=>!!window.api?.register)
  await page.evaluate(async()=>{await window.api.register('time_project_fixture','Fixture123!','时间项目验收');await window.api.login('time_project_fixture','Fixture123!');await window.api.saveSettings({guideSeen:true,autoLogin:false});localStorage.setItem('zl-guide-seen','1')})
  // 真实可解码的短视频（隐藏页面要主动送帧，否则录出来是空文件）
  const bytes=Buffer.from(await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const stream=c.captureStream(10),chunks=[],r=new MediaRecorder(stream,{mimeType:'video/webm'});const done=new Promise(resolve=>{r.ondataavailable=e=>chunks.push(e.data);r.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))});r.start();for(let i=0;i<4;i++){const x=c.getContext('2d');x.fillStyle=i%2?'blue':'green';x.fillRect(0,0,160,90);stream.getVideoTracks()[0].requestFrame?.();await new Promise(r=>setTimeout(r,100))}r.stop();const b=await done;stream.getTracks().forEach(t=>t.stop());return b}))
  assert.ok(bytes.length,'夹具视频没录出来')
  for(const [name,items] of Object.entries(projects))await writeProject(path.join(lib,name),items,bytes)
  await writeProject(outside,[['外部加时','加班增加:20秒'],['外部减时','加班减少:20秒']],bytes)
  await page.reload();await page.getByRole('link',{name:'娱乐助手',exact:true}).waitFor()
  // 既有配置：一个手动事件、一个已绑手动事件的盲盒礼物、一个普通加减礼物；倒计时功能关着
  const seeded={initial:100,enable:false,addGift:'',subGift:'',gifts:[
    {name:'棒棒糖',mode:'blindbox',blindBoxEventIds:['manual-1'],op:'加减',seconds:0,seconds2:null,text:'',img:'',video:'',videoLoop:false,videoSeconds:0},
    {name:'鲜花',mode:'direct',op:'加减',seconds:30,seconds2:null,text:'鲜花加时',img:'',video:'',videoLoop:false,videoSeconds:0}
  ],blindBoxEvents:[{id:'manual-1',name:'手动事件',op:'add',value:5,value2:null,video:'',videoSeconds:0,sound:'',soundVolume:100,action:'none',actionParam:''}]}
  await page.evaluate(cfg=>localStorage.setItem('ent_time_cfg',JSON.stringify(cfg)),seeded)
  await goto('/ent?tool=time');await page.getByTestId('time-setup-question').waitFor()
  check('time page opens in basic mode with a visible project import entry',await basic()==='true'&&await page.getByRole('button',{name:'导入时间视频项目',exact:true}).isVisible())
  check('existing guide buttons are untouched',await page.getByRole('button',{name:'时间盲盒与更多设置',exact:true}).isVisible()&&await page.getByRole('button',{name:'开启现有倒计时',exact:true}).isVisible())

  // ① 门槛：没选项目 / 纯视频项目 / 没填礼物
  await openWizard();await shot('01-project-step')
  check('nothing selected cannot advance',await btn('下一步').isDisabled())
  await dialog().getByRole('radio',{name:/纯视频项目/}).click();await dialog().getByTestId('time-project-preview').getByRole('alert').waitFor()
  check('pure video project is explained and cannot advance',(await previewText()).includes('没有识别到时间事件')&&await btn('下一步').isDisabled())
  await pickProject('时间项目甲');const preview=await previewText();await shot('02-preview')
  check('preview shows counted events, skipped items and concrete outcomes',preview.includes('识别到 3 个时间事件')&&preview.includes('跳过 1 个')&&preview.includes('+60 秒')&&preview.includes('−60 秒')&&preview.includes('×2 倍'),preview.replace(/\s+/g,' ').slice(0,120))
  await btn('下一步').click();await dialog().getByTestId('time-project-question').filter({hasText:'哪个礼物'}).waitFor()
  check('empty gift cannot advance',await btn('下一步').isDisabled())
  check('wizard does not ask for names, scripts or window numbers',await dialog().getByText('规则名',{exact:true}).count()===0&&await dialog().getByText(/窗口编号|绿幕 \d/).count()===0)
  // ② 取消：走到礼物那步再取消，配置一字不改
  await fillGift('小心心');const before=await rawCfg();await btn('取消').click();await page.waitForTimeout(300)
  check('cancel writes nothing',await dialog().count()===0&&(await rawCfg())===before)
  // 先按用户路径开启现有倒计时（主进程此时拿到的是【没有】小心心的配置），后面用它验证导入真的同步到主进程
  await page.getByRole('button',{name:'开启现有倒计时',exact:true}).click();await page.getByRole('button',{name:'关闭倒计时窗口',exact:true}).waitFor()
  check('main process starts without the new gift',(await page.evaluate(()=>window.api.timeWidgetTestGift('小心心'))).ok===false)

  // ③ 导入并绑定一个新礼物
  await openWizard();await pickProject('时间项目甲');await btn('下一步').click();await fillGift('小心心');await btn('下一步').click()
  await dialog().getByTestId('time-project-question').filter({hasText:'确认一下'}).waitFor();await shot('03-review')
  check('review states a new gift row is added and others are kept',(await dialog().innerText()).includes('新增一个礼物格'))
  await finish();await shot('04-done')
  let cfg=await readCfg();const jia=idsOf(cfg,'时间项目甲')
  check('import adds three events next to the existing manual one',jia.length===3&&cfg.blindBoxEvents.length===4&&cfg.blindBoxEvents.some(e=>e.id==='manual-1'),jia.join(','))
  check('new gift is a blind box pointing at the merged ids',byName(cfg,'小心心')?.mode==='blindbox'&&JSON.stringify(byName(cfg,'小心心').blindBoxEventIds)===JSON.stringify(jia))
  check('existing pools and direct gift are untouched',JSON.stringify(byName(cfg,'棒棒糖').blindBoxEventIds)==='["manual-1"]'&&byName(cfg,'鲜花').mode==='direct'&&byName(cfg,'鲜花').seconds===30&&cfg.initial===100)
  check('countdown feature is switched on so the box can trigger',cfg.enable===true)
  check('done text says what was bound',(await doneText()).includes('已导入 3 个时间事件')&&(await doneText()).includes('小心心'))
  await btn('完成').click()
  check('page state follows the import (three gift rows rendered)',await page.locator('[data-testid=time-gift-row]').count()===3)
  const reply=await page.evaluate(()=>window.api.timeWidgetTestGift('小心心'))
  check('main process received the binding without reopening the widget',reply.ok===true,JSON.stringify(reply))
  // 记录在事件跑完（视频播完）才落；播不完就取消，取消也会落一条带事件名的记录，同样证明主进程按导入的奖池抽了
  const findEntry=async(ms)=>{for(let i=0;i<ms/200;i++){const log=await page.evaluate(()=>window.api.timeWidgetLog());const hit=log.find(e=>e.name==='小心心'&&e.eventName);if(hit)return hit;await page.waitForTimeout(200)}return null}
  let entry=await findEntry(10000)
  if(!entry){await page.evaluate(()=>window.api.timeWidgetCancelQueue());entry=await findEntry(2000)}
  check('a real draw runs through the imported pool',!!entry&&jia.some(id=>cfg.blindBoxEvents.find(e=>e.id===id)?.name===entry.eventName),JSON.stringify(entry))
  await page.evaluate(()=>window.api.timeWidgetCancelQueue())

  // ④ 同项目重复导入、同名盲盒礼物：不叠加、追加提示
  await openWizard();await pickProject('时间项目甲');await btn('下一步').click();await fillGift('小心心')
  check('same blind-box gift is announced as an append',(await dialog().getByRole('note').innerText()).includes('已经是抽时间盲盒'))
  await btn('下一步').click();await finish();cfg=await readCfg()
  check('re-import of the same project does not duplicate events or ids',cfg.blindBoxEvents.length===4&&idsOf(cfg,'时间项目甲').length===3&&byName(cfg,'小心心').blindBoxEventIds.length===3&&(await doneText()).includes('追加到「小心心」'))
  await btn('完成').click()

  // ⑤ 普通加减礼物改盲盒：确认前说明，原字段保留
  await openWizard();await pickProject('时间项目甲');await btn('下一步').click();await fillGift('鲜花')
  const note=await dialog().getByRole('note').innerText()
  check('direct gift conversion is explained before confirming',note.includes('直接改时间')&&note.includes('+30 秒')&&note.includes('改成抽时间盲盒'))
  await btn('下一步').click();check('review repeats the conversion',(await dialog().innerText()).includes('这个礼物改成抽时间盲盒'));await finish();cfg=await readCfg()
  check('direct gift becomes a blind box with original fields kept',byName(cfg,'鲜花').mode==='blindbox'&&byName(cfg,'鲜花').blindBoxEventIds.length===3&&byName(cfg,'鲜花').seconds===30&&byName(cfg,'鲜花').text==='鲜花加时'&&cfg.blindBoxEvents.length===4)
  await btn('完成').click()

  // ⑥ 第二个项目追加到同一礼物；别的礼物奖池不动
  await openWizard();await pickProject('时间项目乙');await btn('下一步').click();await fillGift('小心心');await btn('下一步').click();await finish();cfg=await readCfg()
  check('second project appends to the same gift pool',byName(cfg,'小心心').blindBoxEventIds.length===5&&idsOf(cfg,'时间项目乙').length===2&&cfg.blindBoxEvents.length===6&&JSON.stringify(byName(cfg,'棒棒糖').blindBoxEventIds)==='["manual-1"]'&&byName(cfg,'鲜花').blindBoxEventIds.length===3)
  await btn('完成').click()

  // ⑦ 项目条目变少后重新导入：旧批次整批替换，任何礼物都不留悬空 id
  for(const ext of ['webm','脚本'])await fs.rm(path.join(lib,'时间项目甲','翻倍.'+ext))
  await openWizard();await pickProject('时间项目甲');check('preview reflects the changed project',(await previewText()).includes('识别到 2 个时间事件'));await btn('下一步').click();await fillGift('小心心');await btn('下一步').click();await finish();cfg=await readCfg()
  check('shrunken project replaces its batch and leaves no dangling ids',idsOf(cfg,'时间项目甲').length===2&&cfg.blindBoxEvents.length===5&&byName(cfg,'小心心').blindBoxEventIds.length===4&&byName(cfg,'鲜花').blindBoxEventIds.length===2&&allBound(cfg))
  await btn('完成').click()

  // ⑧ 浏览素材库外的文件夹
  await openWizard();await choosePath(outside);await btn('浏览文件夹').click();await dialog().getByTestId('time-project-preview').getByRole('status').filter({hasText:'识别到'}).waitFor()
  check('browsing a folder outside the library previews it',(await previewText()).includes('外部时间项目')&&(await previewText()).includes('识别到 2 个时间事件'))
  await btn('下一步').click();await fillGift('大啤酒');await btn('下一步').click();await finish();cfg=await readCfg()
  check('browsed folder binds like a library project',byName(cfg,'大啤酒')?.mode==='blindbox'&&byName(cfg,'大啤酒').blindBoxEventIds.length===2&&idsOf(cfg,'外部时间项目').length===2)
  await btn('完成').click()

  // ⑨ 全程基础模式；主进程与页面一致（重载后页面读同一份）
  check('configuration level stays basic throughout',await basic()==='true'&&(await page.evaluate(()=>localStorage.getItem('zl_configuration_level')))!=='advanced')
  await page.reload();await goto('/ent?tool=time');await page.getByTestId('time-setup-question').waitFor()
  check('bindings survive a reload',await page.locator('[data-testid=time-gift-row]').count()===4&&JSON.stringify(byName(await readCfg(),'小心心').blindBoxEventIds)===JSON.stringify(byName(cfg,'小心心').blindBoxEventIds))
  await page.evaluate(()=>window.api.timeWidgetClose())
  await shot('05-final')
  assert.deepEqual(errors,[]);console.log(`TIME PROJECT SETUP ${checks.length}/${checks.length} PASS`)
}catch(error){await shot('failure').catch(()=>{});console.log((await page.locator('body').innerText().catch(()=>'')).slice(-2500));throw error}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors},null,2));await app.close()}
