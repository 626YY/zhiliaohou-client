import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {_electron as electron} from 'playwright-core'
import {writeHiddenElectronBootstrap} from './electron-test-bootstrap.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'output/playwright/basic-guides')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-')),entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true})
const settingsFile=path.join(profile,'data/settings.json'),settings=JSON.parse(await fs.readFile(settingsFile,'utf8'))
await fs.writeFile(settingsFile,JSON.stringify({...settings,assetGuideSeen:false}))
const assets=path.join(profile,'测试素材库');for(const name of ['项目一','项目二']){await fs.mkdir(path.join(assets,name),{recursive:true});await fs.writeFile(path.join(assets,name,'示例.mp4'),'')}
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry],cwd:root,env})
const page=await app.firstWindow();page.setDefaultTimeout(12000)
let completed=false
const checks=[],errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
const goto=async(route)=>{await page.evaluate(route=>location.hash=route,route);await page.waitForTimeout(650)}
const basic=()=>page.getByRole('group',{name:'配置模式',exact:true}).getByRole('button',{name:'基础',exact:true}).getAttribute('aria-pressed')
const dialog=()=>page.getByRole('dialog')
const next=()=>dialog().getByRole('button',{name:'下一步',exact:true}).click()
const choosePath=dir=>app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},dir)
const rules=()=>page.evaluate(()=>window.api.entertainmentRulesList())
const shot=name=>page.screenshot({path:path.join(out,name+'.png')})
async function start(kind){await goto('/ent?tool=gift');await page.getByRole('button',{name:'新增规则',exact:true}).first().click();await dialog().getByRole('button',{name:kind,exact:true}).click()}
async function giftThenReview(gift){await dialog().getByRole('combobox',{name:'触发礼物',exact:true}).fill(gift);await next();await dialog().getByTestId('setup-question').filter({hasText:'这样设置'}).waitFor()}
try{
  await page.waitForFunction(()=>!!window.api?.register)
  await page.evaluate(async()=>{await window.api.register('guide_fixture','Fixture123!','引导验收');await window.api.login('guide_fixture','Fixture123!');await window.api.saveSettings({guideSeen:true,autoLogin:false});localStorage.setItem('zl-guide-seen','1')})
  await page.reload()
  await page.getByRole('heading',{name:'先把素材准备好，后面配置更轻松',exact:true}).waitFor()
  check('first login asks for media before searching through settings',true)
  await choosePath(assets);await dialog().getByRole('button',{name:'选择素材总文件夹',exact:true}).click()
  await dialog().getByRole('status').filter({hasText:'找到 2 个项目'}).waitFor()
  await dialog().getByRole('button',{name:'去配置互动',exact:true}).click()
  await page.getByRole('button',{name:'更换素材库',exact:true}).waitFor()
  check('material root is saved and immediately accessible from entertainment home',(await page.evaluate(()=>window.api.getSettings())).settings.pinyouAssetRoot===assets)
  await page.reload();await page.getByRole('link',{name:'娱乐助手',exact:true}).waitFor()
  check('completed material guide does not reappear',await dialog().count()===0)
  // 编码真实的、无声音的短视频；主动送帧，避免隐藏页面产出空文件。
  const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const stream=c.captureStream(10),chunks=[],r=new MediaRecorder(stream,{mimeType:'video/webm'});const done=new Promise(resolve=>{r.ondataavailable=e=>chunks.push(e.data);r.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))});r.start();for(let i=0;i<5;i++){const x=c.getContext('2d');x.fillStyle=i%2?'blue':'green';x.fillRect(0,0,320,180);stream.getVideoTracks()[0].requestFrame?.();await new Promise(r=>setTimeout(r,100))}r.stop();const b=await done;stream.getTracks().forEach(t=>t.stop());return b})
  assert.ok(bytes.length)
  const video=path.join(profile,'示例 # 视频.webm'),box=path.join(profile,'视频盲盒'),empty=path.join(profile,'空文件夹')
  await fs.writeFile(video,Buffer.from(bytes));await fs.mkdir(box);await fs.mkdir(empty);await fs.writeFile(path.join(box,'抽取一.webm'),Buffer.from(bytes));await fs.writeFile(path.join(box,'抽取二.webm'),Buffer.from(bytes))
  const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40)
  const sound=path.join(profile,'音效.wav');await fs.writeFile(sound,wav)
  await start('播放指定视频')
  await dialog().getByRole('button',{name:'高级设置',exact:true}).click();await dialog().getByRole('button',{name:'返回基础引导',exact:true}).click()
  check('empty video stays empty after advanced round trip',await dialog().getByRole('button',{name:'下一步',exact:true}).isDisabled())
  check('basic creation shows one question and no parameter wall',await dialog().getByText('规则名',{exact:true}).count()===0&&await dialog().getByText('先等',{exact:true}).count()===0&&await dialog().getByRole('button',{name:'下一步',exact:true}).isDisabled())
  await choosePath(video);await dialog().getByRole('button',{name:'选择视频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth===320)
  await shot('01-pick-video');await next()
  check('optional action is explicitly asked',await dialog().getByRole('button',{name:'设置动作',exact:true}).isVisible()&&await dialog().getByRole('button',{name:'跳过，不加新动作',exact:true}).isVisible())
  await shot('02-action-or-skip')
  await dialog().getByRole('button',{name:'跳过，不加新动作',exact:true}).click();await giftThenReview('小心心');await shot('03-confirm-video')
  await dialog().getByRole('button',{name:'上一步',exact:true}).click()
  check('back preserves the chosen gift',await dialog().getByRole('combobox',{name:'触发礼物',exact:true}).inputValue()==='小心心')
  await next();await dialog().getByRole('button',{name:'完成并启用',exact:true}).dblclick()
  await dialog().getByTestId('setup-question').filter({hasText:'设置完成'}).waitFor()
  let added=(await rules()).filter(r=>r.giftName==='小心心')
  check('skip produces one video rule and no empty extra action',added.length===1&&added[0].commandParam===video+'|0'&&added[0].extraActions.length===0)
  await dialog().getByRole('button',{name:'准备播放窗口',exact:true}).click();await dialog().getByRole('status').waitFor()
  check('completion leads directly to an output window',(await page.evaluate(()=>window.api.greenScreenState())).slots.some(s=>s.open))
  await dialog().getByRole('button',{name:'返回规则列表',exact:true}).click()
  await start('播放指定视频');await choosePath(video);await dialog().getByRole('button',{name:'选择视频',exact:true}).click();await next()
  await dialog().getByRole('button',{name:'设置动作',exact:true}).click();await dialog().getByRole('button',{name:'倒计时加减时间',exact:true}).click();await dialog().getByRole('textbox',{name:'动作数值',exact:true}).fill('30');await next();await giftThenReview('鲜花');await dialog().getByRole('button',{name:'完成并启用',exact:true}).click();await dialog().getByTestId('setup-question').filter({hasText:'设置完成'}).waitFor()
  const withAction=(await rules()).find(r=>r.giftName==='鲜花')
  check('selected optional action is saved as exactly one extra',withAction.extraActions.length===1&&withAction.extraActions[0].commandCmd==='countdown-adjust'&&withAction.extraActions[0].commandParam==='30')
  await dialog().getByRole('button',{name:'返回规则列表',exact:true}).click()
  await page.evaluate(()=>window.api.timeWidgetOpen({initial:100,enable:false,gifts:[],addGift:'',subGift:''}))
  await page.evaluate(()=>window.api.connectorSimulate('礼物: 鲜花 ×1 by 引导验收'))
  for(let i=0;i<100;i++){if((await page.evaluate(()=>window.api.timeWidgetState())).remaining===130)break;await page.waitForTimeout(100)}
  check('video plus optional time action really runs through gift dispatch',(await page.evaluate(()=>window.api.timeWidgetState())).remaining===130)
  await page.evaluate(()=>window.api.timeWidgetClose())
  await start('随机抽一个视频');await choosePath(empty);await dialog().getByRole('button',{name:'选择文件夹',exact:true}).click();await dialog().getByRole('alert').waitFor()
  check('empty folder cannot advance',await dialog().getByRole('button',{name:'下一步',exact:true}).isDisabled())
  await choosePath(box);await dialog().getByRole('button',{name:'选择文件夹',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth===320);await next();await dialog().getByRole('button',{name:'跳过，不加新动作',exact:true}).click();await giftThenReview('棒棒糖');await dialog().getByRole('button',{name:'完成并启用',exact:true}).click();await dialog().getByTestId('setup-question').filter({hasText:'设置完成'}).waitFor()
  check('box path uses one random-project rule',(await rules()).some(r=>r.giftName==='棒棒糖'&&r.commandCmd==='project-random'&&r.commandParam===box&&r.extraActions.length===0));await dialog().getByRole('button',{name:'返回规则列表',exact:true}).click()
  await start('播放音效');await choosePath(sound);await dialog().getByRole('button',{name:'选择音效',exact:true}).click();await next();await dialog().getByRole('button',{name:'跳过，不加新动作',exact:true}).click();await giftThenReview('大啤酒');await dialog().getByRole('button',{name:'先保存，不启用',exact:true}).click();await dialog().getByTestId('setup-question').filter({hasText:'暂未启用'}).waitFor();check('sound supports saving for later',(await rules()).some(r=>r.soundPath===sound&&r.enabled===false));await dialog().getByRole('button',{name:'返回规则列表',exact:true}).click()
  await start('按一个快捷键');await dialog().getByRole('combobox',{name:'要按的快捷键',exact:true}).selectOption('{F4}');await dialog().getByRole('button',{name:'高级设置',exact:true}).click();check('advanced receives the guided shortcut draft',await dialog().getByRole('textbox',{name:'按键序列',exact:true}).inputValue()==='{F4}');await dialog().getByRole('button',{name:'返回基础引导',exact:true}).click();check('return to basic preserves the shortcut',await dialog().getByRole('combobox',{name:'要按的快捷键',exact:true}).inputValue()==='{F4}');await dialog().getByRole('button',{name:'取消',exact:true}).click()
  // 窗口管理不能再跳高级；自动项和手动开启是两个明确动作。
  await goto('/ent');await page.getByRole('button',{name:'管理播放窗口',exact:true}).click()
  check('window management stays in basic',await basic()==='true')
  const row=page.locator('[data-output-row=time]')
  await row.getByRole('switch',{name:'倒计时下次启动自动开启',exact:true}).click()
  check('auto-open selection does not immediately open a window',!(await page.evaluate(()=>window.api.timeWidgetState())).open)
  await row.getByRole('button',{name:'开启倒计时',exact:true}).click()
  check('basic manager actually opens the window',(await page.evaluate(()=>window.api.timeWidgetState())).open)
  await row.getByRole('button',{name:'关闭倒计时',exact:true}).click();check('basic manager actually closes it',!(await page.evaluate(()=>window.api.timeWidgetState())).open)
  await row.getByRole('switch',{name:'倒计时下次启动自动开启',exact:true}).click()
  for(const [id,slot] of [['video-vip','vip'],['green-4','4']]){
    await page.locator('[data-output-row='+id+']').getByRole('button',{name:/^配置/}).click()
    check(id+': manager opens the requested slot',await page.evaluate(slot=>new URLSearchParams(location.hash.split('?')[1]).get('slot')===slot,slot))
    check(id+': selected slot is visible',await page.getByRole('button',{name:id==='video-vip'?'VIP 窗口':'4 号',exact:true}).getAttribute('aria-pressed')==='true')
    await goto('/ent?manage=1')
  }
  await row.getByRole('button',{name:'配置倒计时',exact:true}).click()
  await page.getByTestId('time-setup-question').waitFor();check('go configure opens time guide without advanced',await basic()==='true')
  await page.getByRole('button',{name:'5 分钟',exact:true}).click();await page.locator('[data-time-setup]').locator('..').getByRole('button',{name:'下一步',exact:true}).click();await page.getByRole('button',{name:'设置礼物',exact:true}).click();await page.getByRole('combobox',{name:'倒计时触发礼物',exact:true}).fill('时间测试礼物');await page.locator('[data-time-setup]').locator('..').getByRole('button',{name:'下一步',exact:true}).click();await page.getByRole('textbox',{name:'礼物改变秒数',exact:true}).fill('15');await page.locator('[data-time-setup]').locator('..').getByRole('button',{name:'下一步',exact:true}).click();await page.getByRole('button',{name:'保存，去开启窗口',exact:true}).click();await page.getByRole('button',{name:'开启倒计时窗口',exact:true}).click()
  const cfg=await page.evaluate(()=>JSON.parse(localStorage.getItem('ent_time_cfg')))
  check('time guide configures minutes and one gift while preserving other config',cfg.initial===300&&cfg.gifts.some(g=>g.name==='时间测试礼物'&&g.seconds===15)&&cfg.enable===true)
  check('time guide opens a real timer',(await page.evaluate(()=>window.api.timeWidgetState())).open)
  await shot('04-time-guide-complete');await page.evaluate(()=>window.api.timeWidgetClose())
  // 每个模块的引导都有实际可定位入口。只定位，不执行按钮（避免键鼠/系统操作）。
  const text=await fs.readFile(path.join(root,'src/renderer/src/pages/Entertainment.tsx'),'utf8'),ids=[...text.matchAll(/\{ id: '([^']+)', label:/g)].map(m=>m[1])
  for(const id of ids){
    await goto('/ent?tool='+id);await page.getByTestId('basic-feature-guide').waitFor();await page.waitForTimeout(500)
    const guide=page.getByTestId('basic-feature-guide')
    check(id+': basic has an actionable guide',await guide.getByRole('button',{name:'带我开始配置',exact:true}).isVisible())
    if(id==='sticker')continue
    await guide.getByRole('button',{name:'带我开始配置',exact:true}).click();await page.waitForTimeout(200)
    const mark=await page.locator('[data-guide-focus=true]').count();if(!mark)warnings.push(id+': start target not found')
    await guide.getByRole('list').getByRole('button').nth(2).click();await guide.getByRole('button',{name:'带我找到操作按钮',exact:true}).click();await page.waitForTimeout(200)
    if(!await page.locator('[data-guide-focus=true]').count())warnings.push(id+': operate target not found')
  }
  check('all available guide targets resolve',warnings.length===0)
  await goto('/ent');await shot('05-basic-home')
  assert.deepEqual(errors,[]);completed=true;console.log(`BASIC GUIDES ${checks.length}/${checks.length} PASS`)
}catch(error){console.log('GUIDE WARNINGS',warnings);await shot('failure').catch(()=>{});console.log((await page.locator('body').innerText()).slice(-3000));throw error}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({completed,checks,errors,warnings},null,2));await app.close()}
