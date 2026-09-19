// 真实 Electron + preload/IPC，全部使用独立配置和临时游戏路径。
// 验证主题/最小窗口排版、10 种进场、挂件热换肤、连续编辑不吞走秒、动态关闭及截图序列。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/visual-skins')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
// 普通隐藏窗口的 rAF 会降到约 1 Hz；离屏模式保持实际绘制节奏，才能测动效和重画次数。
const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env })
const checks = [], errors = [], shots = []
const pass = (name, detail) => { checks.push({ name, detail }); console.log('PASS ' + name + (detail ? ' | ' + JSON.stringify(detail) : '')) }
const attach = (p) => p.on('pageerror', e => errors.push(p.url().split('/').pop() + ': ' + e.message))
app.on('window', attach)
const page = await app.firstWindow()
attach(page)
page.setDefaultTimeout(8000)
const api = (name, ...args) => page.evaluate(([name, args]) => window.api[name](...args), [name, args])
const ready = (target, fn, arg) => target.waitForFunction(fn, arg, { polling: 50, timeout: 8000 })
const click = (locator) => locator.click()
const mainWindow = await app.browserWindow(page)
async function capture(target, name, delay = 200) {
  const win = await app.browserWindow(target)
  await win.evaluate(w => w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(() => null))
  await target.waitForTimeout(delay)
  const bytes = await win.evaluate(async w => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  const png = Buffer.from(bytes)
  await fs.writeFile(path.join(output, name + '.png'), png)
  const sha = createHash('md5').update(png).digest('hex')
  shots.push({ name, md5: sha })
  return sha
}
async function windowFor(part) {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const p = app.windows().find(p => p !== page && p.url().includes(part))
    if (p) { await p.waitForLoadState('domcontentloaded'); p.setDefaultTimeout(8000); return p }
    await page.waitForTimeout(80)
  }
  const native=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),url:w.webContents.getURL(),loading:w.webContents.isLoading(),crashed:w.webContents.isCrashed()})))
  throw Error('输出窗口未出现 ' + part + ' '+JSON.stringify(native))
}
async function route(to) {
  await page.evaluate(to => { location.hash = to }, to)
  await ready(page, () => document.querySelector('main') && !document.querySelector('main .animate-spin'))
  await page.waitForTimeout(140)
}
async function module(name) {
  await route('/ent')
  if (await page.getByRole('button', { name: /返回功能列表/ }).count()) await click(page.getByRole('button', { name: /返回功能列表/ }))
  await click(page.getByRole('button', { name: new RegExp('^' + name) }).first())
  await ready(page, () => document.querySelector('main') && !document.querySelector('main .animate-spin'))
  await page.waitForTimeout(180)
}
async function layout(name) {
  const state = await page.evaluate(() => {
    const main = document.querySelector('main')
    return { width: innerWidth, scroll: main.scrollWidth, client: main.clientWidth, error: /页面加载出错|页面发生错误/.test(main.innerText) }
  })
  assert.ok(state.scroll <= state.client + 2, name + ' 横向溢出 ' + JSON.stringify(state))
  assert.equal(state.error, false, name + ' 错误边界')
}
const themes = [['dark','黑夜'],['light','白天'],['cream','米色'],['ocean','深海'],['amethyst','紫晶'],['forest','松林'],['sakura','樱花'],['terracotta','赤陶'],['moonlight','月光']]
const motionThemes = ['ocean','amethyst','sakura','moonlight']
const effects = [['meteor','流星降临'],['thunder','雷霆登场'],['royal','王者加冕'],['comic','漫画暴击'],['cyber','赛博入侵'],['festival','花火庆典'],['phoenix','烈焰之翼'],['spotlight','巨星亮相'],['portal','星际传送'],['frost','冰晶降临']]
const newSkins = ['nebula','sunset','gilded','glacier','graphite']
const skins = ['classic','theatre','aurora','sakura','paper','arcade',...newSkins]
let failure
try {
  await ready(page, () => Boolean(window.api?.login))
  await api('saveSettings', { guideSeen: true, autoLogin: false })
  await page.evaluate(() => localStorage.setItem('zl-guide-seen', '1'))
  await api('register', 'visual_regression', 'Fixture123!', '界面验收')
  assert.equal((await api('login', 'visual_regression', 'Fixture123!')).ok, true)
  await api('saveSettings', { guideSeen: true, autoLogin: false })
  await page.evaluate(() => localStorage.setItem('zl-guide-seen', '1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ready(page, () => document.querySelector('main'))

  await route('/settings')
  await ready(page, () => document.querySelector('[aria-label="界面主题：深海"]'))
  for (const [id, label] of themes) {
    await click(page.getByRole('button', { name: '界面主题：' + label, exact: true }))
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), id)
    assert.equal(await page.evaluate(() => localStorage.getItem('zl-theme')), id)
    await page.locator('[aria-label="界面主题"]').evaluate(el => el.scrollIntoView({ block: 'center' }))
    await layout('主题 ' + label)
    await capture(page, 'theme-' + id, 500)
    const moving = await page.evaluate(() => [...document.querySelectorAll('.theme-atmosphere i')].filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).animationPlayState === 'running').length)
    assert.equal(moving, motionThemes.includes(id) ? 3 : 0, id + ' 动静类型错误')
  }
  pass('9 套客户端主题保留，从设置页点击切换并记住选择；4 动态 / 5 静态')
  await click(page.getByRole('button', { name: '界面主题：紫晶', exact: true }))
  await route('/ent')
  const a = await capture(page, 'motion-amethyst-1', 300)
  const b = await capture(page, 'motion-amethyst-2', 950)
  assert.notEqual(a, b, '动态主题截图重复')
  await route('/settings')
  const toggle = page.locator('label').filter({ hasText: '主题动效' }).locator('button')
  await click(toggle)
  const paused = () => page.evaluate(() => [...document.querySelectorAll('.theme-atmosphere i')].map(el => getComputedStyle(el).animationPlayState))
  assert.deepEqual(await paused(), ['paused','paused','paused'])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ready(page, () => document.querySelector('[aria-label="界面主题：紫晶"]'))
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'off')
  assert.deepEqual(await paused(), ['paused','paused','paused'])
  await click(page.locator('label').filter({ hasText: '主题动效' }).locator('button'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.deepEqual(await paused(), ['running','running','running'], '主动打开主题动效后不能被全局规则压成一帧')
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.animationName?.startsWith('theme-')).every(a => a.effect.getTiming().iterations === Infinity)), true)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  pass('流光两帧不同；手动关闭后暂停、重载保持；开启后播放完整动效')

  const routes = ['/', '/config','/remote','/launch','/stats','/connector','/news','/notifications','/settings']
  const modules = ['礼物触发','透明图合成','转盘抽奖','九宫格转盘','礼物动画','积分心愿','绿幕窗口','弹幕平台','保护主播','互动工具','操作台','时间插件','视频播放器','贴纸统计','飘屏','大哥进场','键盘显示','滤镜设置','计数挑战','加班器']
  for (const [width, height] of [[1280,820],[1024,700]]) {
    await mainWindow.evaluate((w, size) => w.setSize(...size), [width, height])
    for (const to of routes) { await route(to); await layout(to) }
    for (const name of modules) {
      await module(name); await layout(name)
      if (width === 1024 || ['时间插件','大哥进场','积分心愿','透明图合成','转盘抽奖','九宫格转盘'].includes(name)) await capture(page, `page-${width}-${name}`)
    }
    pass(`${width}×${height}：9 主页面 + 20 娱乐模块无横向溢出和页面异常`)
  }
  await mainWindow.evaluate(w => w.setSize(1280,820))
  await module('透明图合成')
  await click(page.getByRole('button',{name:'透明图配色：黑金剧场',exact:true}))
  await click(page.locator('summary').filter({hasText:'更多功能'}))
  await click(page.getByRole('button',{name:'直角闪烁',exact:true}))
  // 测量真实绘图次数，覆盖旧实现的每帧整张 Canvas 重画；还原探针避免影响后续用例。
  const paints = await page.evaluate(async()=>{
    const proto=CanvasRenderingContext2D.prototype, original=proto.clearRect
    let count=0,frames=0,raf=0
    const tick=()=>{frames++;raf=requestAnimationFrame(tick)}
    raf=requestAnimationFrame(tick)
    proto.clearRect=function(...args){count++;return original.apply(this,args)}
    try { await new Promise(r=>setTimeout(r,1400));return {count,frames} }
    finally {proto.clearRect=original;cancelAnimationFrame(raf)}
  })
  assert.ok(paints.frames>30&&paints.count<4,'仅闪烁时仍反复重画或采样不足 '+JSON.stringify(paints))
  pass('透明图闪烁不再每帧重画整张图片',paints)
  await module('大哥进场')
  await api('entranceConfigure', { enabled: true, bannerSeconds: 8, bannerWidth: 640, bannerHeight: 140, rules: [{ id:'visual', enabled:true, match:'any', name:'', text:'欢迎 {name} 进入直播间', video:'', videoWindow:'video', sound:'', dedupeSeconds:0 }] })
  await api('entranceOpen')
  // 刚打开立即发送，覆盖第一条进场不能被页面加载吞掉。
  assert.equal((await api('entranceTest', '首位观众')).ok, true)
  const entrance = await windowFor('entrance-widget')
  await ready(entrance, () => document.querySelector('.banner'))
  for (const [id, label] of effects) {
    await click(page.getByRole('button', { name:'进场特效：' + label, exact:true }))
    assert.equal((await api('entranceState')).config.bannerStyle, id)
    assert.equal((await api('entranceTest', '知了猴大哥')).ok, true)
    await ready(entrance, id => document.querySelector('.arrival')?.dataset.entranceEffect === id, id)
    await ready(entrance, () => document.querySelector('.banner')?.classList.contains('show'))
    const h1 = await capture(entrance, 'entrance-' + id + '-1', 160)
    const h2 = await capture(entrance, 'entrance-' + id + '-2', 900)
    assert.notEqual(h1,h2,id + ' 动效截图重复')
    const text = await entrance.locator('.arrival-name').textContent()
    assert.equal(text, '知了猴大哥')
    assert.equal(await entrance.locator('.arrival-particle').count(), 8)
  }
  pass('10 种进场从按钮到真实输出，全量截图序列去重；刚开窗口首条不丢')
  const evil = '<img src=x onerror="alert(1)">很长的观众昵称测试请不要裁掉整个窗口'
  await api('entranceConfigure', { bannerWidth:200, bannerHeight:60, bannerSeconds:1 })
  await api('entranceTest', evil)
  await ready(entrance, value => document.querySelector('.arrival-name')?.textContent === value, evil)
  assert.equal(await entrance.locator('.arrival-name img').count(),0)
  await capture(entrance, 'entrance-min-size', 300)
  await ready(entrance, () => !document.querySelector('.arrival'))
  assert.equal(await entrance.evaluate(() => document.getAnimations().length), 0)
  await api('entranceClose')
  pass('长昵称按文字显示，200×60 可用；横幅结束移除动画节点')

  // 每一种挂件皮肤热更新，都走产品 IPC，不替换页面实现。
  await api('progressConfigure', { title:'今日能量', target:100, autoAdd:true })
  await api('progressOpen'); await api('progressAdjust', 37)
  const progress = await windowFor('progress-widget')
  await api('wishConfigure', { showB:false, groups:[{title:'今日心愿',wishes:[{gift:'玫瑰',target:10,count:3}]}] })
  await api('wishOpen'); const wish = await windowFor('wish-widget')
  await api('queueOpen', { title:'整蛊排队' }); const queue = await windowFor('queue-widget')
  await api('marqueeOpen', { chatOn:true,giftOn:true,gifts:[],chatKeywords:'',style:'plain',fontSize:24 })
  const marquee = await windowFor('marquee-widget')
  await api('keyboardOpen', {style:'pro'}); const keyboard = await windowFor('keyboard-widget')
  const items = Array.from({length:8},(_,i)=>({name:'幸运礼物 '+(i+1),color:i%2?'#87ddea':'#183d48',weight:1}))
  for (const kind of ['wheel','nine']) {
    await api('lotteryConfigure',kind,{autoSpin:false,triggerGift:''},items)
    assert.equal((await api('lotteryOpen',kind,items)).ok,true)
  }
  const wheel = await windowFor('lottery-lucky'), nine = await windowFor('lottery-nine')
  const challengeCfg = { mode:'counter',on:false,clockOn:false,initial:42,title:'今日挑战',zeroText:'挑战完成',clockSpeed:1000,gifts:[],giftShow:false,hotkeys:[],showNegative:false,showSeconds:true,zeroHide:false,showLock:true,bgAlpha:.9,bgColor:'#17231e' }
  for(const slot of ['challenge','overtime']) assert.equal((await api('challengeOpen',{...challengeCfg,slot})).ok,true)
  const challenge=await windowFor('challenge-widget-challenge'),overtime=await windowFor('challenge-widget-overtime')
  await ready(challenge,()=>document.querySelector('#text2')?.textContent==='42')
  assert.equal(await challenge.evaluate(()=>{
    const range=document.createRange();range.selectNodeContents(document.querySelector('#text2'))
    return document.querySelector('#itemTwoIcon').getBoundingClientRect().left>range.getBoundingClientRect().right
  }),true,'锁图标遮住挑战数字')
  for (const skin of skins) {
    await api('progressConfigure',{skin}); await api('wishConfigure',{skin}); await api('queueConfigure',{skin})
    // 与飘屏皮肤下拉框相同：选择整套皮肤时同步正文颜色。
    await api('marqueeConfigure',{style:skin==='classic'?'plain':skin,color:skin==='glacier'?'#203d4b':skin==='sakura'?'#52283d':skin==='paper'?'#303d41':'#ffffff'})
    await api('keyboardConfigure',{theme:skin==='classic'?'dark':skin})
    await api('connectorSimulate','弹幕: 知了猴 欢迎来到直播间')
    for(const slot of ['challenge','overtime']) await api('challengeUpdate',{...challengeCfg,slot,style:skin==='classic'?'default':skin})
    for (const kind of ['wheel','nine']) await api('lotteryConfigure',kind,{skin,autoSpin:false,triggerGift:''})
    for (const [name,target] of [['progress',progress],['wish',wish],['queue',queue],['marquee',marquee],['keyboard',keyboard],['wheel',wheel],['nine',nine],['challenge',challenge],['overtime',overtime]]) {
      if (skin !== 'classic') await ready(target, id => document.body.dataset.widgetSkin === id || document.querySelector(`[data-widget-skin="${id}"]`), skin)
      if (['theatre','aurora','sakura','arcade',...newSkins].includes(skin)) await capture(target, `widget-${name}-${skin}`)
      if (newSkins.includes(skin)) {
        const motion=await target.evaluate(()=>{
          const el=document.querySelector('.skin-panel,.skin-motion-panel')
          return el ? getComputedStyle(el,'::after').animationName : 'missing-panel'
        })
        assert.equal(motion, {nebula:'plugin-star-drift',sunset:'plugin-tide',gilded:'plugin-gold-sweep',glacier:'none',graphite:'none'}[skin],name+' '+skin+' 装饰动静不符')
      }
    }
    assert.equal((await api('progressState')).score,37,'换皮肤不应改变积分')
    assert.equal((await api('wishState')).config.groups[0].wishes[0].count,3,'换皮肤不应改变心愿')
  }
  pass('9 类输出 × 11 套皮肤热切换，五款新皮肤 3 动态 / 2 静态，积分与心愿数值不变')
  await page.evaluate(() => { window.__draws=[];window.api.onLotteryEvent(e=>window.__draws.push(e)) })
  await api('lotterySpin','wheel')
  await page.waitForTimeout(500)
  await api('lotteryConfigure','wheel',{skin:'aurora',autoSpin:false,triggerGift:''})
  await ready(page, () => window.__draws.some(e=>e.phase==='result'))
  assert.equal(await page.evaluate(()=>window.__draws.filter(e=>e.phase==='result').length),1)
  pass('抽奖进行中更换皮肤，仍只产出一次中奖结果')
  for (const name of ['progressClose','wishClose','queueClose','keyboardClose','marqueeClose','challengeClose']) await api(name)
  for (const kind of ['wheel','nine']) await api('lotteryClose',kind)

  const timeOpened=await api('timeWidgetOpen', { initial:40,enable:true,showSeconds:true,showGift:false,theme:'aurora',clockSpeed:1000,startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''} })
  assert.equal(timeOpened.ok,true,JSON.stringify(timeOpened))
  const time = await windowFor('time-widget')
  await ready(time,()=>document.querySelector('#time'))
  const start=(await api('timeWidgetState')).remaining
  for(let i=0;i<15;i++) { await api('timeWidgetUpdate',{theme:i%2?'sakura':'aurora',title:'时间测试 '+i});await page.waitForTimeout(160) }
  const remaining=(await api('timeWidgetState')).remaining
  assert.ok(start-remaining>=2 && start-remaining<=4,`连续编辑应正常走秒 ${start} → ${remaining}`)
  pass('每 160 ms 改外观连续 15 次，倒计时仍按真实时间前进',{start,remaining})
  await module('时间插件')
  // 固定剩余值比较图片帧差，不能用倒计时文字变化冒充皮肤动画。
  await click(page.locator('label').filter({hasText:'开启倒计时功能'}).locator('button'))
  assert.equal((await api('timeWidgetState')).running,false,'固定数字采样前应在设置页停表')
  for(const theme of ['theatre','arcade','paper','aurora','sakura','ticket','terminal',...newSkins]) {
    await page.getByRole('combobox',{name:'时间皮肤',exact:true}).selectOption(theme)
    await ready(time,id=>document.body.dataset.theme===id,theme)
    await capture(time,'countdown-'+theme)
    assert.equal(await time.evaluate(()=>[...document.images].every(im=>im.complete&&im.naturalWidth>0)),true,theme+' 图片未渲染')
    if (newSkins.includes(theme)) {
      const expected={nebula:'plugin-star-drift',sunset:'plugin-tide',gilded:'plugin-gold-sweep',glacier:'none',graphite:'none'}[theme]
      const actual=await time.locator('#head').evaluate(el=>getComputedStyle(el,'::after').animationName)
      const preview=await page.locator('.countdown-motion-head').evaluate(el=>getComputedStyle(el,'::after').animationName)
      assert.equal(actual,expected,theme+' 输出动效');assert.equal(preview,expected,theme+' 预览动效')
      const a=await capture(time,'countdown-'+theme+'-frame1',1800)
      const b=await capture(time,'countdown-'+theme+'-frame2',1400)
      if(expected==='none')assert.equal(a,b,theme+' 静态皮肤仍在动')
      else assert.notEqual(a,b,theme+' 固定数字的动效截图重复')
      await capture(page,'countdown-'+theme+'-editor')
      await time.emulateMedia({reducedMotion:'reduce'})
      assert.equal(await time.locator('#head').evaluate(el=>getComputedStyle(el,'::after').animationName),expected,'动态/静态由所选皮肤决定，不被全局规则覆盖')
      await time.emulateMedia({reducedMotion:'no-preference'})
    }
  }
  await api('timeWidgetClose')
  pass('五套新时间皮肤预览与输出一致；固定数字实拍 3 动态帧不同、2 静态帧相同；不再自动压掉动态皮肤')

  const perf = await page.evaluate(async () => {
    const latencies=[]
    let stop=false
    const ping=(async()=>{while(!stop){const t=performance.now();await window.api.getSettings();latencies.push(performance.now()-t);await new Promise(r=>setTimeout(r,40))}})()
    await Promise.all([window.api.selfCheck(),window.api.gameState(),window.api.liveCompanionState(true),window.api.obsState()])
    stop=true;await ping
    latencies.sort((a,b)=>a-b)
    return {samples:latencies.length,max:Math.round(latencies.at(-1)),p95:Math.round(latencies[Math.floor(latencies.length*.95)])}
  })
  assert.ok(perf.max<400, '主进程卡顿 '+JSON.stringify(perf))
  pass('同时进行环境自检和状态检测时，轻调用保持响应',perf)
  await route('/ent')
  const frames=await page.evaluate(async()=>{
    const runs={}
    for(const mode of ['on','off']){
      document.documentElement.dataset.motion=mode
      runs[mode]=await new Promise(resolve=>{
        const gaps=[];let previous=0,start=0,raf=0
        const done=()=>{cancelAnimationFrame(raf);gaps.sort((a,b)=>a-b);resolve({frames:gaps.length,p95:Number((gaps[Math.floor(gaps.length*.95)]||0).toFixed(1)),max:Number((gaps.at(-1)||0).toFixed(1))})}
        const timeout=setTimeout(done,4000)
        const tick=t=>{if(!start)start=t;if(previous)gaps.push(t-previous);previous=t;if(t-start>2500){clearTimeout(timeout);done()}else raf=requestAnimationFrame(tick)}
        raf=requestAnimationFrame(tick)
      })
    }
    document.documentElement.dataset.motion='on'
    return runs
  })
  assert.ok(frames.on.frames>30&&frames.off.frames>30,'帧回调采样不足 '+JSON.stringify(frames))
  pass('动态与静态同页实测帧间隔（Electron 离屏绘制）',frames)
  assert.deepEqual(errors,[])
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused())),true)
  pass('全部页面无 JavaScript 异常；隔离实例未显示或抢焦点')
} catch(e) { failure=e;console.error('FAIL',e.stack||e);await capture(page,'failure').catch(()=>{}) }
finally {
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,shots,profile,failure:failure?.stack},null,2))
  await app.close().catch(()=>{})
}
if(failure)process.exitCode=1
else console.log(`视觉与换肤回归 ${checks.length}/${checks.length} PASS；${shots.length} 张真实窗口截图`)
