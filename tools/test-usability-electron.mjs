// 独立 Electron 资料、隔离游戏路径；不连接直播间、不运行项目脚本。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {_electron as electron} from 'playwright-core'
import {writeHiddenElectronBootstrap} from './electron-test-bootstrap.mjs'

const root=path.resolve(import.meta.dirname,'..')
const quick=process.argv.includes('--quick')
const out=path.join(root,'output/playwright',quick?'usability-quick':'usability')
await fs.mkdir(out,{recursive:true})
const profile=await fs.mkdtemp(path.join(out,'session-'))
const entry=await writeHiddenElectronBootstrap(root,profile,{offscreen:true})
const env={...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[entry],cwd:root,env})
const page=await app.firstWindow();page.setDefaultTimeout(12000)
const errors=[],checks=[],pages=[]
let completed=false
page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
const goto=async(route)=>{await page.evaluate(route=>{location.hash=route},route);await page.waitForTimeout(600)}
const mode=async(name)=>{await page.getByRole('group',{name:'配置模式',exact:true}).getByRole('button',{name,exact:true}).click();await page.waitForTimeout(200)}
const saved=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>/^(ent_|ent-|zl_widget)/.test(key))))
const count=()=>page.locator('main').evaluate(main=>[...main.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(el=>el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})).length)
async function shot(name){await page.locator('main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,name+'.png')})}
try{
  await page.waitForFunction(()=>!!window.api?.login)
  const login=await page.evaluate(async()=>{
    await window.api.register('usability_fixture','Fixture123!','易用性验收')
    const r=await window.api.login('usability_fixture','Fixture123!')
    await window.api.saveSettings({guideSeen:true,autoLogin:false})
    localStorage.setItem('zl-guide-seen','1')
    return r
  })
  assert.equal(login.ok,true)
  await page.reload();await page.getByRole('link',{name:'娱乐助手',exact:true}).waitFor()
  const win=await app.browserWindow(page);await win.evaluate(w=>w.setSize(1280,900))
  check('fresh profile starts in basic mode',await page.getByRole('group',{name:'配置模式'}).getByRole('button',{name:'基础',exact:true}).getAttribute('aria-pressed')==='true')
  await goto('/ent')
  check('all 20 modules remain reachable',await page.locator('[data-feature]').count()===20)
  await page.getByRole('textbox',{name:'查找互动功能'}).fill('视频')
  check('search finds video workflows',await page.locator('[data-feature=video]').isVisible()&&await page.locator('[data-feature=gift]').isVisible())
  await page.getByRole('textbox',{name:'查找互动功能'}).fill('没有这样的模块')
  check('search has actionable empty result',await page.getByText('没有找到对应功能，试试视频、礼物、抽奖或计时。').isVisible())
  await page.getByRole('textbox',{name:'查找互动功能'}).fill('')
  await shot('ent-basic')
  const modules=await page.locator('[data-feature]').evaluateAll(els=>els.map(el=>({id:el.dataset.feature,label:el.textContent.trim()})))
  for(const mod of quick?[]:modules){
    await goto('/ent?tool='+mod.id)
    await page.getByTestId('basic-feature-guide').getByRole('list').waitFor()
    await page.waitForTimeout(600)
    const basic=await count(),before=await saved()
    if(['time','challenge','overtime'].includes(mod.id))check(mod.id+': initial configuration is above the fold',await page.locator(mod.id==='time'?'input[aria-label="倒计时分钟"]':'[aria-label="基础配置"]').evaluate(el=>el.checkVisibility()&&el.getBoundingClientRect().bottom<innerHeight))
    await mode('高级');const advanced=await count()
    await mode('基础');const after=await saved()
    assert.deepEqual(after,before,mod.id+' mode switch must preserve saved configuration')
    check(mod.id+': guide, basic/advanced and saved values',advanced>=basic)
    pages.push({id:mod.id,basic,advanced})
    if(['time','wheel','challenge','gift','video'].includes(mod.id))await shot(mod.id+'-basic')
    await page.getByRole('button',{name:'怎么设置',exact:true}).click()
    check(mod.id+': instructions open',await page.getByRole('dialog').isVisible())
    await page.getByRole('button',{name:'知道了',exact:true}).click()
  }
  // 摘要里的规则编辑仍可使用；草稿在收起和重开后保留。
  await goto('/ent?tool=overtime')
  await page.getByRole('button',{name:'编辑',exact:true}).first().click()
  const overtimeGift=page.locator('input[list="ent-ot-gifts"]').first()
  await overtimeGift.fill('回归礼物')
  await page.getByRole('button',{name:'收起',exact:true}).first().click()
  check('gift editor collapses to updated summary',await page.getByText('1. 回归礼物',{exact:true}).isVisible())
  await page.getByRole('button',{name:'编辑',exact:true}).first().click()
  check('gift editor keeps edited name',await overtimeGift.inputValue()==='回归礼物')
  // 高级展开中的字段可在基础模式编辑，收起和切换仍保留草稿。
  await goto('/ent?tool=time')
  await page.getByRole('button',{name:'时间盲盒与更多设置',exact:true}).click()
  const color=page.locator('[data-advanced-section="外观微调"]').getByRole('textbox',{name:'礼物名颜色',exact:true})
  check('local advanced section exposes its fields in basic',await color.isVisible())
  await color.fill('#123456');await page.waitForTimeout(250)
  await mode('高级');await mode('基础')
  check('custom appearance survives mode switch',await color.inputValue()==='#123456')
  // 真实项目扫描与真实 rule-add；只预览合成视频，不执行附带脚本。
  const material=path.join(profile,'盲盒 # 中文'),empty=path.join(profile,'空文件夹')
  await fs.mkdir(material);await fs.mkdir(empty)
  const encoded=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
    const ctx=canvas.getContext('2d');ctx.fillStyle='#334155';ctx.fillRect(0,0,320,180)
    const stream=canvas.captureStream(10),chunks=[]
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm'})
    const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))})
    recorder.start();await new Promise(r=>setTimeout(r,350));recorder.stop();const bytes=await done;stream.getTracks().forEach(t=>t.stop());return bytes
  })
  await fs.writeFile(path.join(material,'素材 #1.webm'),Buffer.from(encoded))
  await fs.writeFile(path.join(material,'素材2.webm'),Buffer.from(encoded))
  await goto('/ent?tool=gift')
  await page.getByRole('button',{name:'创建视频盲盒',exact:true}).click()
  check('blind box cannot save without folder and gift',await page.getByRole('dialog').getByRole('button',{name:'下一步',exact:true}).isDisabled())
  await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},empty)
  await page.getByRole('button',{name:'选择文件夹',exact:true}).click()
  await page.getByText('这个文件夹里没有视频，请选择直接放着视频的文件夹。',{exact:true}).waitFor()
  check('empty folder gives a corrective message',await page.getByRole('dialog').getByRole('button',{name:'下一步',exact:true}).isDisabled())
  await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},material)
  await page.getByRole('button',{name:'选择文件夹',exact:true}).click()
  await page.getByRole('combobox',{name:'预览盲盒视频',exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1)
  check('local video with spaces, # and Chinese decodes',await page.locator('video').evaluate(v=>v.videoWidth===320))
  await page.getByRole('dialog').getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('button',{name:'跳过，不加新动作',exact:true}).click()
  await page.getByRole('combobox',{name:'触发礼物',exact:true}).fill('小心心')
  await shot('blind-box-setup')
  await page.getByRole('dialog').getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('button',{name:'完成并启用',exact:true}).dblclick()
  await page.getByTestId('setup-question').filter({hasText:'设置完成'}).waitFor()
  const rules=await page.evaluate(()=>window.api.entertainmentRulesList())
  const created=rules.filter(r=>r.commandCmd==='project-random'&&r.commandParam===material)
  check('double click creates one random-project rule',created.length===1&&created[0].commandCmd==='project-random'&&created[0].commandParam===material&&created[0].giftName==='小心心'&&created[0].enabled===true)
  await page.getByRole('button',{name:'准备播放窗口',exact:true}).click()
  await page.getByRole('status').filter({hasText:'绿幕窗口已开启'}).waitFor()
  check('wizard prepares an output window without requiring its number',(await page.evaluate(()=>window.api.greenScreenState())).slots.some(s=>s.open))
  await page.getByRole('button',{name:'返回规则列表',exact:true}).click()
  await page.getByRole('button',{name:'创建视频盲盒',exact:true}).click()
  await page.getByRole('button',{name:'取消',exact:true}).click()
  check('cancel does not create a rule',(await page.evaluate(()=>window.api.entertainmentRulesList())).length===rules.length)
  // 新规则实际经模拟礼物进入主进程队列，并播出合成视频；不连接直播间。
  let green
  for(let i=0;i<100&&!green;i++){green=app.windows().find(p=>p!==page&&p.url().includes('green'));if(!green)await page.waitForTimeout(100)}
  assert.ok(green,'isolated green window opened: '+app.windows().map(p=>p.url()).join(', '))
  await green.waitForLoadState()
  const played=[]
  await green.exposeFunction('__recordPlayed',item=>played.push(item))
  await green.addInitScript(()=>{document.addEventListener('loadedmetadata',e=>{if(e.target instanceof HTMLVideoElement&&e.target.videoWidth>0)window.__recordPlayed({src:e.target.currentSrc,width:e.target.videoWidth})},true)})
  const simulated=await page.evaluate(()=>window.api.connectorSimulate('礼物: 小心心 ×1 by 易用性测试'))
  assert.equal(simulated.ok,true)
  for(let i=0;i<120&&!played.some(v=>v.width===320);i++)await page.waitForTimeout(100)
  if(!played.length)console.log('PLAY DIAGNOSTIC',JSON.stringify({windows:app.windows().map(p=>p.url()),state:await page.evaluate(()=>window.api.greenScreenState()),rules:await page.evaluate(()=>window.api.entertainmentRulesList())}))
  check('saved blind box plays video through the gift event pipeline',played.some(v=>v.width===320))
  await page.evaluate(()=>window.api.greenScreenClose(1))
  // 同礼物旧规则继续保留，并在快捷配置中告知用户。
  await page.getByRole('button',{name:'创建视频盲盒',exact:true}).click()
  await page.getByRole('button',{name:'选择文件夹',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('button',{name:'跳过，不加新动作',exact:true}).click()
  await page.getByRole('combobox',{name:'触发礼物',exact:true}).fill('小心心')
  await page.getByText('已有 1 条启用的规则使用「小心心」',{exact:false}).waitFor()
  check('existing same-gift rule is disclosed',true)
  await page.getByRole('button',{name:'取消',exact:true}).click()
  if(process.env.ZL_USABILITY_PROJECT){
    await page.getByRole('button',{name:'创建视频盲盒',exact:true}).click()
    await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},process.env.ZL_USABILITY_PROJECT)
    await page.getByRole('button',{name:'选择文件夹',exact:true}).click()
    await page.getByRole('combobox',{name:'预览盲盒视频',exact:true}).waitFor()
    const options=await page.getByRole('combobox',{name:'预览盲盒视频',exact:true}).locator('option').count()
    await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0,null,{timeout:15000})
    check('real project folder scans and video decodes ('+options+' videos)',options>1)
    await shot('real-project-preview')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    check('previewing real project creates no rules',(await page.evaluate(()=>window.api.entertainmentRulesList())).length===rules.length)
  }
  await page.getByRole('button',{name:'新增规则',exact:true}).first().click()
  await page.getByRole('button',{name:'按一个快捷键',exact:true}).click()
  check('new rule begins with a plain-language effect choice',await page.getByRole('combobox',{name:'要按的快捷键',exact:true}).isVisible())
  await page.getByRole('combobox',{name:'要按的快捷键',exact:true}).selectOption('{F4}')
  await page.getByRole('button',{name:'高级设置',exact:true}).click()
  check('simple shortcut picker writes the correct command',await page.getByRole('textbox',{name:'按键序列',exact:true}).inputValue()==='{F4}')
  await page.getByRole('button',{name:'取消',exact:true}).click()
  await mode('基础')
  // 参数页运行真实编辑器，仅配置文件读写换成本实例内存，绝不写游戏目录。
  const schema=JSON.parse(await fs.readFile(path.join(root,'mods-catalog/schemas/config.schema.json'),'utf8'))
  await app.evaluate(({ipcMain},schema)=>{
    const values=Object.fromEntries(schema.fields.map(f=>[f.key,f.default]));values.OutlineR=0.321
    ipcMain.removeHandler('config:read');ipcMain.handle('config:read',()=>({ok:true,schema,values,configPath:'isolated-fixture.json'}))
    ipcMain.removeHandler('config:save');ipcMain.handle('config:save',(_e,next)=>{global.__usabilitySavedConfig=next;return {ok:true}})
  },schema)
  await goto('/config')
  await page.getByRole('textbox',{name:'搜索全部游戏参数'}).waitFor()
  await page.getByRole('textbox',{name:'搜索全部游戏参数'}).fill('ShinraRadius')
  await page.getByLabel('神罗天征·冲击半径',{exact:true}).waitFor()
  check('basic search reaches advanced parameter',await page.getByLabel('神罗天征·冲击半径',{exact:true}).isVisible())
  await page.getByLabel('神罗天征·冲击半径',{exact:true}).fill('0.456');await page.getByLabel('神罗天征·冲击半径',{exact:true}).blur()
  await page.getByRole('button',{name:'保存参数',exact:true}).click()
  const stored=await app.evaluate(()=>global.__usabilitySavedConfig)
  check('saving basics preserves complete game configuration',stored.ShinraRadius===0.456&&stored.OutlineR===0.321&&Object.keys(stored).length>=schema.fields.length)
  for(const [game,folder,key] of [['librarian','librarian','ShelfGlowIntensity'],['dontscream','dontscream','ScreenHintFontSize']]){
    const schema=JSON.parse(await fs.readFile(path.join(root,'mods-catalog/schemas',folder,'config.schema.json'),'utf8'))
    await goto('/')
    await page.evaluate(game=>window.api.setGameCurrent(game),game)
    await app.evaluate(({ipcMain},schema)=>{ipcMain.removeHandler('config:read');ipcMain.handle('config:read',()=>({ok:true,schema,values:Object.fromEntries(schema.fields.map(f=>[f.key,f.default])),configPath:'isolated-fixture.json'}))},schema)
    await goto('/config')
    check(game+': basic game settings render',(await count())>1)
    await page.getByRole('textbox',{name:'搜索全部游戏参数'}).fill(key)
    await page.locator('#pf-'+key).waitFor()
    check(game+': search opens detailed setting',await page.locator('#pf-'+key).isVisible())
  }
  for(const route of ['/','/config','/remote','/launch','/stats','/connector','/news','/notifications','/settings']){
    await goto(route);await page.getByRole('button',{name:'使用帮助',exact:true}).click()
    check(route+': help is reachable',await page.getByRole('dialog').isVisible())
    const dialog=page.getByRole('dialog')
    await dialog.getByRole('button',{name:'知道了',exact:true}).focus()
    await page.keyboard.press('Tab')
    check(route+': keyboard focus stays in help',await dialog.evaluate(el=>el.contains(document.activeElement)))
    await page.keyboard.press('Escape')
    check(route+': Escape returns to help button',await page.getByRole('button',{name:'使用帮助',exact:true}).evaluate(el=>el===document.activeElement))
  }
  await goto('/guide')
  await page.getByRole('button',{name:'先配置娱乐互动',exact:true}).click()
  await page.locator('[data-feature=gift]').waitFor()
  check('first-use guide supports entertainment without a game setup',true)
  // 三主题和小窗口有实际截图，检查不出现整页横向溢出。
  for(const theme of ['dark','light','cream'])for(const size of [[1280,900],[1024,720]]){
    await win.evaluate((w,size)=>w.setSize(...size),size)
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await goto('/ent');await shot(`ent-${theme}-${size[0]}`)
    check(`layout ${theme} ${size[0]}`,await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  }
  await mode('高级');await page.reload();await page.getByRole('group',{name:'配置模式'}).waitFor()
  check('chosen configuration mode persists after restart',await page.getByRole('group',{name:'配置模式'}).getByRole('button',{name:'高级',exact:true}).getAttribute('aria-pressed')==='true')
  assert.deepEqual(errors,[])
  completed=true
  console.log(`USABILITY ${checks.length}/${checks.length} PASS; ${pages.length} modules; 0 page errors`)
}finally{
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({completed,checks,pages,errors},null,2))
  await app.close()
}
