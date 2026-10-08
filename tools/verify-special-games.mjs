// 特色整蛊玩法 · 离线渲染 + 操作契约验收。
// 不启动客户端主程序、不接触用户配置/IPC/直播间；允许正式客户端继续运行；窗口离屏不聚焦（不抢前台）。
// 麦克风/摄像头一律换成页面内的假设备（绝不碰真设备），并记录 getUserMedia 调用次数。
// 对每个玩法：
//   1) 默认操作（旧值 spawn）生成 → 手动推帧 → 墨量断言 + 截图 → clear → 回到空闲（tick 返回 false）；
//   2) 逐个跑 ops 里的每个操作（带数量 + 每个选项的每个取值），断言无页面错误，收尾回到空闲；
//   3) 玩法专属语义：累计统计（抓到 → 累计清零归零）、锁链/符咒的减乘除、捡叶子加速/直接扫/龙卷风、
//      来电排队/接听/静音、摄像头背景、音乐球暂停继续 + 自定义音乐节拍分析、自定义素材走 api.fileUrl……
//   4) 预览模式（buildSpecialPage preview:true）再加载一遍：无错误、不调 getUserMedia、媒体全部静音播放。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/special-games')
await fs.mkdir(output, { recursive: true })

// 玩法素材（assets/special-games）：页面里的 api.asset() 拼这个前缀
const assetDir = path.join(root, 'assets/special-games')
const assetBase = pathToFileURL(assetDir).href.replace(/\/?$/, '/')
const assetPath = (rel) => path.join(assetDir, rel)   // 当「用户选的本地文件」用（Windows 绝对路径）
const MISSING = 'zl-missing-test'                     // 故意不存在的文件名（它引起的加载报错不算失败）

// 打包玩法元数据 + 页面构建器 + 已实现玩法代码（都是纯模块，无 electron 依赖）
const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, SPECIAL_GAME_MAP, defaultSpecialConfig} from './src/shared/specialGames';
export {buildSpecialPage} from './src/main/special-page';
export {GAME_CODE} from './src/main/special-games';`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const { SPECIAL_GAME_MAP, defaultSpecialConfig, buildSpecialPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

const builtIds = Object.keys(GAME_CODE).filter((id) => GAME_CODE[id])
assert.ok(builtIds.length > 0, '没有已实现的玩法')

// 测试专用前缀（只拼进测试页，生产页面没有）：抓 GAME 供只读 debug()、假麦克风/摄像头、记录媒体播放
const TEST_PRE = `(function(){
  var rg=window.registerGame; window.registerGame=function(g){ window.__GAME=g; return rg(g); };
  window.__gum={ calls:0, audio:0, video:0 };
  var sharedAc=null;
  function fakeVideo(){
    var cv=document.createElement('canvas'); cv.width=640; cv.height=360;
    var g=cv.getContext('2d'), t=0;
    function paint(){ t++; g.fillStyle='#2b6cb0'; g.fillRect(0,0,640,360); g.fillStyle='#ffd34d'; g.fillRect(200+(t%40),110,240,140); }
    paint(); setInterval(paint,100);
    return cv.captureStream(15);
  }
  var fake={
    getUserMedia:function(c){
      window.__gum.calls++;
      if(c&&c.video){ window.__gum.video++; return Promise.resolve(fakeVideo()); }
      window.__gum.audio++;
      if(!sharedAc) sharedAc=new AudioContext();
      return Promise.resolve(sharedAc.createMediaStreamDestination().stream);
    },
    enumerateDevices:function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake-mic', groupId:'g' }]); }
  };
  try{ Object.defineProperty(navigator,'mediaDevices',{ value:fake, configurable:true }); }catch(e){}
  window.__plays=[];
  var play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){ window.__plays.push({ muted:this.muted, src:String(this.getAttribute('src')||this.currentSrc||'') }); return play.apply(this,arguments); };
})();
`

function pageFor(id, opts = {}) {
  const meta = SPECIAL_GAME_MAP[id]
  const cfg = defaultSpecialConfig(meta)
  cfg.countCap = 60
  Object.assign(cfg.params, opts.params || {})
  return buildSpecialPage(meta, cfg, TEST_PRE + GAME_CODE[id], assetBase, opts.preview ? { preview: true } : {})
}

// 启动离屏 Electron（不显示、不可聚焦、关后台降帧，稳定可截图）
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(
  entry,
  `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:720,height:1280,show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false}});win.setTitle('special test');win.loadURL('about:blank')});`
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const where = (m.location() && m.location().url) || ''
  if (m.text().includes(MISSING) || where.includes(MISSING)) return   // 故意测的坏文件
  errors.push('[console] ' + m.text() + (where ? ` @ ${where}` : ''))
})

let passed = 0
const fail = []
const notes = []

// —— 页面操作小工具 ——
async function load(id, opts = {}) {
  const meta = SPECIAL_GAME_MAP[id]
  const file = path.join(output, `special-${id}${opts.preview ? '-preview' : ''}.html`)
  await fs.writeFile(file, pageFor(id, opts))
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => typeof window.__apply === 'function' && typeof window.__step === 'function' && !!window.__GAME, null, { timeout: 5000 })
  const win = await app.browserWindow(page)
  await win.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: meta.width, h: meta.height })
  await page.waitForTimeout(60)
}
const apply = (cmd) => page.evaluate((c) => window.__apply(c), cmd)
const config = (next) => page.evaluate((c) => window.__config(c), next)
// 推帧：fast = 一次 evaluate 推 n 帧（纯模拟）；slow = 每帧一次 evaluate（让 fetch/媒体等异步回调插进来）
const stepFast = (n, dt = 16) => page.evaluate(({ n, dt }) => { let a = false; for (let i = 0; i < n; i++) a = window.__step(dt) || a; return a }, { n, dt })
async function stepSlow(n, dt = 16) { let a = false; for (let i = 0; i < n; i++) a = (await page.evaluate((d) => window.__step(d), dt)) || a; return a }
// debug()：去掉媒体元素 / 函数再传回 Node
const dbg = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__GAME.debug ? window.__GAME.debug() : {}, (k, v) => (typeof v === 'function' || (typeof HTMLMediaElement !== 'undefined' && v instanceof HTMLMediaElement)) ? undefined : v)))
const stats = () => page.evaluate(() => window.__stats())
const pointer = (type, x, y) => page.evaluate(({ type, x, y }) => window.__GAME.pointer(type, x, y), { type, x, y })
const mediaMuted = () => page.evaluate(() => ((window.__GAME.debug().media) || []).map((m) => m.muted))
async function waitDbg(pred, label, timeout = 8000, stepEach = true) {
  const t0 = Date.now()
  for (;;) {
    const d = await dbg()
    if (pred(d)) return d
    if (Date.now() - t0 > timeout) throw new Error(`等待超时：${label}（${JSON.stringify(d).slice(0, 300)}）`)
    if (stepEach) await page.evaluate(() => window.__step(16))
    await page.waitForTimeout(25)
  }
}
async function settleIdle(label) {
  for (let i = 0; i < 80; i++) if (!(await page.evaluate(() => window.__step(400)))) return
  throw new Error(`${label}：收尾后没回到空闲（tick 一直返回 true）`)
}
async function capture(name) {
  const win = await app.browserWindow(page)
  await win.evaluate((w) => w.webContents.invalidate())
  await page.waitForTimeout(80)
  const bytes = await win.evaluate(async (w) => {
    const img = await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return [...img.toPNG()]
  })
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(bytes))
}
// 画布墨量：画布本身透明，只有玩法画上去的东西有不透明像素 → 直接量「画了多少」
async function canvasInk() {
  return page.evaluate(() => {
    const cv = document.getElementById('cv')
    const g = cv.getContext('2d')
    const d = g.getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++
    return n
  })
}
// 清场操作：有 clear 用 clear（现在全部玩法都有）
const clearOp = (meta) => (meta.ops.some((o) => o.value === 'clear') ? 'clear' : 'stop')
const who = { username: '测试员', avatar: '' }
// 点第一颗能点的东西（debug().hits），返回是否点到
async function clickFirst() {
  const d = await dbg()
  const h = (d.hits || [])[0]
  if (!h) return false
  await pointer('down', h[0], h[1])
  await pointer('up', h[0], h[1])
  return true
}
function avg(a) { return a.reduce((s, x) => s + x, 0) / Math.max(1, a.length) }

// —— 玩法专属语义检查 ——
const SEMANTIC = {
  async tug_of_war() {
    await apply({ operation: 'reduce', count: 3, ...who })
    assert.equal((await dbg()).round, null, '拔河：没在比时「帮主播拉」应忽略')
    await apply({ operation: 'add', count: 2, ...who })
    let d = await dbg()
    assert.ok(d.round && Math.abs(d.round.p + 0.16) < 1e-6 && d.round.vp === 2 && d.team === 1, `拔河：观众拉 2 下（每下 8%）应到 −0.16（${JSON.stringify(d.round)}）`)
    await pointer('down', 640, 200); await pointer('up', 640, 200)
    d = await dbg()
    assert.ok(Math.abs(d.round.p + 0.145) < 1e-6 && d.round.sp === 1, `拔河：主播点一下往回 1.5%（${JSON.stringify(d.round)}）`)
    await page.keyboard.press('Space')
    assert.equal((await dbg()).round.sp, 2, '拔河：按空格也算拉一下')
    await config({ spacePull: false })
    await page.keyboard.press('Space')
    assert.equal((await dbg()).round.sp, 2, '拔河：关掉「空格也能拉」后空格不算')
    await apply({ operation: 'reduce', count: 2, ...who })
    assert.equal((await dbg()).round.sp, 4, '拔河：帮主播拉 2 下')
    await config({ giftPull: 50 })
    await apply({ operation: 'add', count: 1, ...who })
    d = await dbg()
    assert.ok(Math.abs(d.round.p + 0.6) < 1e-6, `拔河：礼物拉力调成 50% 生效（${d.round.p}）`)
    // 时间到：绳结在观众那边 → 观众赢 → 砸 3 个（默认）
    await config({ roundSec: 5 })
    await stepFast(300, 20)
    d = await dbg()
    assert.ok(d.round && d.round.result === 'viewers' && d.wins.viewers === 1, `拔河：时间到绳结在观众那边应判观众赢（${JSON.stringify(d.round)}）`)
    d = await waitDbg((x) => x.flying === 0 && x.splats === 3, '观众赢了砸 3 个糊在屏幕上', 8000)
    // 擦：按住拖过一块 → 这块淡掉
    const h = d.hits[0]
    await pointer('down', h[0] - h[2] * 0.45, h[1] - h[2] * 0.45)
    for (let k = 0; k <= 10; k++) await pointer('move', h[0] - h[2] * 0.46 + h[2] * 0.92 * (k % 2), h[1] - h[2] * 0.46 + h[2] * 1.3 * k / 10)
    await pointer('up', h[0], h[1])
    d = await waitDbg((x) => x.splats <= 2, '擦干净一块')
    // 新一局：主播拽到终点 → 主播赢（放彩带）
    await apply({ operation: 'clear' })
    await config({ giftPull: 8, roundSec: 30, clickPull: 20 })
    await apply({ operation: 'add', count: 1, ...who })
    for (let i = 0; i < 6; i++) { await pointer('down', 640, 200); await pointer('up', 640, 200) }
    d = await dbg()
    assert.ok(d.round.result === 'streamer' && d.wins.streamer === 1 && d.paper > 0, `拔河：主播拉到终点应赢并放彩带（${JSON.stringify(d)}）`)
    // 出结果期间又来礼物：攒着，下一局一开就拉
    await apply({ operation: 'add', count: 3, ...who })
    assert.equal((await dbg()).round.next, 3, '拔河：出结果时来的礼物攒到下一局')
    await stepFast(250, 20)
    d = await dbg()
    assert.ok(d.round && !d.round.result && d.round.vp === 3, `拔河：下一局开局就带着攒的 3 下（${JSON.stringify(d.round)}）`)
    // 砸几个 / 砸什么 / 自己消失
    await apply({ operation: 'clear' })
    await config({ penaltyCount: 5, penalty: 'egg', clickPull: 1.5 })
    await apply({ operation: 'add', count: 20, ...who })
    d = await waitDbg((x) => x.flying === 0 && x.splats === 5, '砸 5 个', 8000)
    await apply({ operation: 'clear' })
    await config({ penaltyCount: 1, autoClearSec: 1 })
    await apply({ operation: 'add', count: 20, ...who })
    d = await waitDbg((x) => x.flying === 0 && x.splats === 1, '砸 1 个', 8000)
    await page.waitForTimeout(200)
    for (let i = 0; i < 20; i++) await stepSlow(1, 100)
    d = await waitDbg((x) => x.splats === 0, '「自己消失」1 秒后糊的东西没了', 5000)
    await capture('tug_of_war-semantic')
    // 数值不设上限：砸 1000 个、一块 300% 大、一局 99999 秒也不崩（一次最多飞 200 个、同屏糊块封顶 60）
    await apply({ operation: 'clear' })
    await config({ penaltyCount: 1000, splatSize: 300, roundSec: 99999, autoClearSec: 0, giftPull: 500 })
    await apply({ operation: 'add', count: 1, ...who })
    d = await dbg()
    assert.ok(d.round && d.round.result === 'viewers' && d.round.dur === 99999000 && d.flying === 200, `拔河：拉力 500% 一下拉满、一次最多飞 200 个（${JSON.stringify({ r: d.round, f: d.flying })}）`)
    await stepFast(300, 33)
    d = await dbg()
    assert.ok(d.splats <= 60 && d.splats > 0, `拔河：同屏糊块防爆封顶 60（${d.splats}）`)
    await apply({ operation: 'clear' })
    await settleIdle('大数值拔河清场')
  },
  async bomb_defuse() {
    // 只留一种错线：剪到的错线一定是这种
    const only = (role) => config({ roleSpeed: role === 'speed' ? 100 : 0, roleBoom: role === 'boom' ? 100 : 0, roleDud: role === 'dud' ? 100 : 0, roleMinus: role === 'minus' ? 100 : 0 })
    const cutAt = async (w) => { await pointer('down', w[0], w[1]) }
    const settle = (label) => waitDbg((x) => x.phase !== 'cut', label)
    await apply({ operation: 'hasten', count: 5, ...who })
    assert.equal((await dbg()).phase, '', '炸弹：没有炸弹时减时应忽略')
    // —— 定时炸弹：加速线 ——
    await only('speed')
    await apply({ operation: 'add', count: 2, kind: 'dynamite', ...who })
    let d = await dbg()
    assert.ok(d.phase === 'in' && d.queue === 1 && d.kind === 'dynamite', `炸弹：扔 2 颗定时炸弹 → 一颗上场一颗排队（${JSON.stringify({ p: d.phase, q: d.queue, k: d.kind })}）`)
    d = await waitDbg((x) => x.phase === 'armed', '落稳开始倒计时')
    assert.equal(d.wires.length, 4, '炸弹：默认 4 根线')
    assert.equal(d.wires.filter((w) => w[4] === 'defuse').length, 1, '炸弹：只有一根拆除线')
    assert.ok(d.wires.filter((w) => w[4] !== 'defuse').every((w) => w[4] === 'speed'), `炸弹：只开加速线时错线都是加速线（${d.wires.map((w) => w[4])}）`)
    const left0 = d.left
    await apply({ operation: 'hasten', count: 5, ...who })
    d = await dbg()
    assert.ok(left0 - d.left >= 4900 && left0 - d.left <= 5200, `炸弹：减时 5 秒（${left0} → ${d.left}）`)
    const wrong = d.wires.find((w) => !w[2])
    await cutAt(wrong)
    d = await dbg()
    assert.ok(d.phase === 'cut' && d.rate === 1, `炸弹：剪下去先停一下、还没揭晓（${JSON.stringify({ rate: d.rate, phase: d.phase })}）`)
    const frozen = d.left
    await stepFast(20)
    assert.equal((await dbg()).left, frozen, '炸弹：停顿期间倒计时停住')
    await cutAt(d.wires.find((w) => w[2]))
    assert.equal((await dbg()).defused, 0, '炸弹：停顿期间不能再剪')
    d = await settle('停顿后揭晓')
    assert.ok(d.rate === 2 && d.phase === 'armed' && d.wires.find((w) => w[0] === wrong[0] && w[1] === wrong[1])[3], `炸弹：加速线揭晓，计时 ×2（${JSON.stringify({ rate: d.rate, phase: d.phase })}）`)
    await cutAt(d.wires.find((w) => w[2]))
    d = await settle('停顿后揭晓')
    assert.ok(d.phase === 'ok' && d.defused === 1 && !d.extreme, `炸弹：剪对拆弹成功（${JSON.stringify({ phase: d.phase, defused: d.defused })}）`)
    d = await waitDbg((x) => x.phase === 'armed' && x.queue === 0, '下一颗上场')
    // —— 哑线：剪了什么也没发生 ——
    await only('dud')
    await apply({ operation: 'clear' })
    await apply({ operation: 'add', count: 1, kind: 'cartoon', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '卡通炸弹落稳')
    assert.equal(d.kind, 'cartoon', '炸弹：指定卡通炸弹')
    const lDud = d.left
    await cutAt(d.wires.find((w) => !w[2]))
    d = await settle('哑线揭晓')
    assert.ok(d.phase === 'armed' && d.rate === 1 && Math.abs(lDud - d.left) < 200 && d.wires.filter((w) => w[3]).length === 1, `炸弹：哑线剪了什么也没发生（${JSON.stringify({ p: d.phase, r: d.rate, l: [lDud, d.left] })}）`)
    // —— 扣时线 ——
    await only('minus')
    await config({ wrongMinus: 3, suspenseMs: 0 })
    await apply({ operation: 'clear' })
    await apply({ operation: 'add', count: 1, kind: 'gift', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '礼物炸弹落稳')
    assert.equal(d.kind, 'gift', '炸弹：指定礼物炸弹')
    const l1 = d.left
    await cutAt(d.wires.find((w) => !w[2]))
    d = await dbg()
    assert.ok(l1 - d.left >= 2900 && l1 - d.left <= 3200 && d.rate === 1, `炸弹：扣时线扣 3 秒、停顿设 0 立刻揭晓（${l1} → ${d.left}）`)
    // 帮拆
    await apply({ operation: 'reduce', count: 1, ...who })
    d = await dbg()
    assert.ok(d.phase === 'ok' && d.defused === 2, `炸弹：帮拆 1 颗（${JSON.stringify({ phase: d.phase, defused: d.defused })}）`)
    await stepFast(200, 20)
    // —— 雷管线：一剪就炸，炸了抽惩罚、溅黑灰 ——
    await only('boom')
    await config({ sootCount: 2, suspenseMs: 800 })
    await apply({ operation: 'add', count: 1, kind: 'dynamite', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '第三颗落稳')
    await cutAt(d.wires.find((w) => !w[2]))
    d = await settle('雷管线揭晓')
    assert.ok(d.exploded === 1 && d.splats === 3, `炸弹：雷管线一剪就炸，炸弹那一块 + 2 块黑灰（${JSON.stringify({ e: d.exploded, s: d.splats, phase: d.phase })}）`)
    assert.ok(['唱一首歌', '学猫叫三声', '做十个深蹲', '给大家比个心', '用方言说一句话'].includes(d.punish), `炸弹：炸了从默认列表抽一条惩罚（${d.punish}）`)
    const h = d.hits[1]
    await pointer('down', h[0] - h[2] * 0.45, h[1] - h[2] * 0.45)
    for (let k = 0; k <= 10; k++) await pointer('move', h[0] - h[2] * 0.46 + h[2] * 0.92 * (k % 2), h[1] - h[2] * 0.46 + h[2] * 0.92 * k / 10)
    await pointer('up', h[0], h[1])
    d = await waitDbg((x) => x.splats <= 2, '擦干净一块黑灰')
    // —— 超级炸弹：多两根线、时间长一半、黑灰翻倍 ——
    await apply({ operation: 'clear' })
    await only('speed')
    await config({ timerSec: 10, sootCount: 2 })
    await apply({ operation: 'add', count: 1, kind: 'mega', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '超级炸弹落稳')
    assert.ok(d.kind === 'mega' && d.wires.length === 6 && d.total === 15000, `炸弹：超级炸弹 6 根线、10 秒 ×1.5（${JSON.stringify({ k: d.kind, w: d.wires.length, t: d.total })}）`)
    await apply({ operation: 'hasten', count: 60, ...who })
    await stepFast(3)
    d = await dbg()
    assert.ok(d.exploded === 2 && d.splats === 5, `炸弹：超级炸弹炸出 1 + 2×2 块黑灰（${JSON.stringify({ e: d.exploded, s: d.splats })}）`)
    // 随机种类
    await apply({ operation: 'clear' })
    const seen = new Set()
    for (let i = 0; i < 24; i++) { await apply({ operation: 'add', count: 1, ...who }); seen.add((await dbg()).kind); await apply({ operation: 'clear' }) }
    assert.ok(seen.size >= 3 && [...seen].every((k) => ['dynamite', 'cartoon', 'gift', 'mega'].includes(k)), `炸弹：随机种类应四种都会出（${[...seen]}）`)
    // C4 那种滴声：放炸弹有按键声；一开始约一秒一滴，越到最后越急；真实剩 0.7 秒放一次长鸣，然后炸
    await config({ timerSec: 15 })
    const plays = (name) => page.evaluate((n) => window.__plays.filter((p) => p.src.includes('bomb_defuse/' + n)).length, name)
    const plant0 = await plays('plant.wav')
    await apply({ operation: 'add', count: 1, kind: 'dynamite', ...who })
    assert.equal(await plays('plant.wav'), plant0 + 1, '炸弹：上场时有放炸弹的按键声')
    await waitDbg((x) => x.phase === 'armed', '滴声那颗落稳')
    let b0 = await plays('beep.wav')
    await stepFast(188, 16)   // 前 3 秒
    const early = (await plays('beep.wav')) - b0
    d = await dbg()
    await stepFast(Math.max(0, Math.floor((d.left - 2600) / 16)), 16)   // 推到只剩约 2.6 秒
    b0 = await plays('beep.wav')
    const fin0 = await plays('final.wav')
    await stepFast(118, 16)   // 再走 1.9 秒
    const late = (await plays('beep.wav')) - b0
    assert.ok(early >= 2 && early <= 5 && late >= early * 2, `炸弹：滴声越到最后越急（前 3 秒 ${early} 下，最后 1.9 秒 ${late} 下）`)
    await stepFast(60, 16)
    d = await dbg()
    assert.ok((await plays('final.wav')) === fin0 + 1 && d.exploded >= 1, `炸弹：炸之前放一次长鸣（${JSON.stringify({ e: d.exploded, phase: d.phase })}）`)
    notes.push(`拆炸弹滴声：前 3 秒 ${early} 下，最后 1.9 秒 ${late} 下，最后 0.7 秒长鸣`)
    await apply({ operation: 'clear' })
    // 最后 1 秒剪对 = 极限拆弹
    await config({ timerSec: 3, suspenseMs: 800 })
    await apply({ operation: 'add', count: 1, kind: 'dynamite', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '极限那颗落稳')
    await stepFast(130, 16)
    d = await dbg()
    assert.ok(d.phase === 'armed' && d.left > 0 && d.left < 1000, `炸弹：推到最后 1 秒（${d.left}）`)
    await cutAt(d.wires.find((w) => w[2]))
    d = await settle('停顿后揭晓')
    assert.ok(d.phase === 'ok' && d.extreme, `炸弹：最后 1 秒剪对是「极限拆弹」（${JSON.stringify({ phase: d.phase, extreme: d.extreme })}）`)
    // 惩罚列表清空：炸了不抽；倒计时走完自己炸 + 黑灰自己散 + 线的根数
    await apply({ operation: 'clear' })
    await config({ timerSec: 3, sootCount: 0, sootFadeSec: 1, wireCount: 6, punishList: '' })
    await apply({ operation: 'add', count: 1, kind: 'dynamite', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '第四颗落稳')
    assert.equal(d.wires.length, 6, '炸弹：线的根数调成 6')
    const ex0 = d.exploded
    await stepFast(220, 16)
    d = await dbg()
    assert.ok(d.exploded === ex0 + 1 && d.splats === 1 && !d.punish, `炸弹：3 秒倒计时走完自己炸、惩罚清空就不抽（${JSON.stringify({ e: d.exploded, s: d.splats, phase: d.phase, left: d.left, p: d.punish })}）`)
    await stepFast(100, 16)
    d = await waitDbg((x) => x.splats === 0, '「黑灰自己散」1 秒后散掉', 5000)
    await capture('bomb_defuse-semantic')
    // 数值不设上限（用户：「所有数值默认无上限」）：填很大也不崩，代码只做防爆夹紧
    await apply({ operation: 'clear' })
    await config({ wireCount: 20, sootCount: 500, timerSec: 99999, suspenseMs: 0, roleBoom: 100, roleSpeed: 0, roleDud: 0, roleMinus: 0, bombSize: 150 })
    await apply({ operation: 'add', count: 1, kind: 'mega', ...who })
    d = await waitDbg((x) => x.phase === 'armed', '大数值炸弹落稳')
    assert.ok(d.wires.length === 22 && d.total === 99999 * 1500, `炸弹：20 根线（超级 +2）、超长倒计时（${d.wires.length} 根 / ${d.total}）`)
    await pointer('down', d.wires.find((w) => !w[2])[0], d.wires.find((w) => !w[2])[1])
    await stepFast(4)
    d = await dbg()
    assert.ok(d.exploded >= 1 && d.splats <= 60, `炸弹：溅 500 块黑灰按防爆封顶 60（${d.splats}）`)
    await apply({ operation: 'clear' })
    await settleIdle('大数值炸弹清场')
  },
  async chain_challenge() {
    await apply({ operation: 'multiply', count: 3 })
    assert.equal((await dbg()).remaining, 0, '锁链：没挂锁链时乘法应忽略')
    await apply({ operation: 'add', count: 5, ...who })
    assert.equal((await dbg()).remaining, 5, '锁链：+5')
    await apply({ operation: 'reduce', count: 2, ...who })
    assert.equal((await dbg()).remaining, 3, '锁链：−2')
    await apply({ operation: 'multiply', count: 3, ...who })
    assert.equal((await dbg()).remaining, 9, '锁链：×3')
    await apply({ operation: 'divide', count: 2, ...who })
    assert.equal((await dbg()).remaining, 4, '锁链：÷2 向下取整')
    await stepFast(40)   // 进常态，点击解锁一次
    await pointer('down', 10, 10)
    assert.equal((await dbg()).remaining, 3, '锁链：点击减 1')
    await config({ opacity: 40 })
    await stepFast(5)
    await capture('chain_challenge-opacity40')
    await config({ opacity: 100 })
    await apply({ operation: 'divide', count: 9, username: '' })
    const d = await dbg()
    assert.ok(d.remaining === 0 && d.phase === 'unlocking', `锁链：÷ 到 0 应断裂（${JSON.stringify(d)}）`)
    const banner = await page.evaluate(() => document.getElementById('btx').textContent)
    assert.ok(!/undefined|null/.test(banner) && banner.length > 0, `锁链：无昵称横幅异常「${banner}」`)
    // 5 套皮肤逐个过一遍
    for (const skin of CHAIN_SKINS) await chainSkin(skin)
    // 下线的原版皮肤（老设置里还存着）按霓虹画
    for (const old of ['default', 'style_1', 'style_2']) {
      await load('chain_challenge', { params: { visualStyle: old } })
      await apply({ operation: 'add', count: 3, ...who })
      await stepFast(40)
      const o = await dbg()
      assert.ok(o.skin === 'neon' && o.phase === 'sustain', `锁链：下线的皮肤 ${old} 应按霓虹画（${JSON.stringify(o)}）`)
    }
  },
  async talisman_seal() {
    await apply({ operation: 'add', count: 6, ...who })
    assert.equal((await dbg()).remaining, 6)
    await apply({ operation: 'reduce', count: 1, ...who })
    assert.equal((await dbg()).remaining, 5, '符咒：−1')
    await apply({ operation: 'multiply', count: 4, ...who })
    assert.equal((await dbg()).remaining, 20, '符咒：×4')
    await apply({ operation: 'divide', count: 3, ...who })
    assert.equal((await dbg()).remaining, 6, '符咒：÷3 向下取整')
    const gum = await page.evaluate(() => window.__gum.audio)
    assert.ok(gum >= 1, '符咒：上封印时应开麦克风（假设备）')
    await apply({ operation: 'reduce', count: 99, username: '' })
    const d = await dbg()
    assert.ok(d.remaining === 0 && d.phase === 'breaking', `符咒：扣到 0 应碎裂（${JSON.stringify(d)}）`)
    await stepFast(80, 30)
    assert.equal(await page.evaluate(() => window.__step(16)), false, '符咒：碎裂完应停帧')
    // 常态下没有动画时应停 rAF（等喊叫回调叫醒）
    await apply({ operation: 'add', count: 2 })
    await stepFast(60)
    assert.equal(await page.evaluate(() => window.__step(16)), false, '符咒：常态无动画时 tick 应返回 false')
  },
  async catch_duck() { await statFlow('catch_duck', 'reset', 140) },
  async throw_poop() {
    await statFlow('throw_poop', 'reset', 160)
    // 自定义图 / 音效（走 api.fileUrl）
    await config({ customImage: assetPath('throw_trash/burger.png'), customSound: assetPath('throw_trash/throw.mp3') })
    await apply({ operation: 'add', count: 4, size: 'big', ...who })
    await stepSlow(30)
    await stepFast(60)
    await waitDbg((d) => d.custom, '扔粑粑自定义图', 3000)
    const plays = await page.evaluate(() => window.__plays.map((p) => p.src))
    assert.ok(plays.some((s) => s.startsWith('file:///') && s.includes('throw_trash/throw.mp3')), '扔粑粑：自定义音效应经 file:/// 播放')
    await capture('throw_poop-custom')
  },
  async throw_trash() {
    await statFlow('throw_trash', 'reset', 160, true)
    for (const kind of ['burger', 'old_shoe']) {
      await apply({ operation: 'clear' })
      await apply({ operation: 'add', count: 4, kind, size: 'small', ...who })
      await stepFast(20)
      const d = await dbg()
      assert.deepEqual(d.kinds, [kind], `扔垃圾：指定种类 ${kind} 应全是它（${d.kinds}）`)
    }
  },
  async catch_bullet() {
    await statFlow('catch_bullet', 'reset', 200)
    await apply({ operation: 'clear' })
    await apply({ operation: 'add', count: 20, ...who })
    await stepFast(12)   // 放出一部分，剩下还在排队
    const a = await dbg()
    await apply({ operation: 'reduce', count: 7, ...who })
    const b = await dbg()
    assert.equal(a.pending + a.count - (b.pending + b.count), 7, `抓子弹：reduce 7 应少 7 颗（${JSON.stringify([a.pending, a.count, b.pending, b.count])}）`)
    assert.ok(b.pending <= a.pending, '抓子弹：应先扣排队')
    await apply({ operation: 'reduce', count: 999 })
    const c = await dbg()
    assert.equal(c.pending + c.count, 0, '抓子弹：减到 0')
    // 自定义多张子弹图
    await config({ customImages: [assetPath('duck/duck_angle_1.png'), assetPath('coin_bump/coin.png')].join('\n') })
    await apply({ operation: 'add', count: 12, ...who })
    await stepFast(150)
    assert.equal((await dbg()).customs, 2, '抓子弹：应加载 2 张自定义图')
    await capture('catch_bullet-custom')
  },
  async caterpillar() {
    await statFlow('caterpillar', 'reset', 30, false, 20)
    const RED = '#e54848', BLUE = '#4389ed'
    await apply({ operation: 'clear' })
    await apply({ operation: 'add', count: 4, color: 'red', ...who })
    await stepFast(8)
    assert.deepEqual((await dbg()).colors, [RED], '毛毛虫：指定红色')
    await apply({ operation: 'clear' })
    await config({ caterpillarColor: 'blue' })
    await apply({ operation: 'add', count: 3, color: 'config', ...who })
    await stepFast(8)
    assert.deepEqual((await dbg()).colors, [BLUE], '毛毛虫：按玩法设置（蓝）')
    await apply({ operation: 'add', count: 30, color: 'random', ...who })
    await stepFast(40)
    assert.ok((await dbg()).colors.length >= 3, '毛毛虫：随机颜色应有多种')
  },
  async fan_call() {
    // 自定义铃声 / 接听语音（拿别的内置音效当「用户选的文件」，好区分）
    await config({ answerAudios: assetPath('fruit_slice/slice.mp3'), ringtonePath: assetPath('throw_trash/throw.mp3') })
    await apply({ operation: 'show', count: 3, ...who })
    let d = await dbg()
    assert.ok(d.current && d.queued === 2, `来电：3 通 = 当前 1 + 排队 2（${JSON.stringify(d)}）`)
    const srcs = () => page.evaluate(() => window.__plays.map((p) => p.src))
    assert.ok((await srcs()).some((s) => s.startsWith('file:///') && s.includes('throw_trash/throw.mp3')), '来电：自定义铃声应经 file:/// 播放')
    await pointer('down', d.answerAt[0], d.answerAt[1])
    d = await dbg()
    assert.ok(d.current.answered, '来电：点接听应接通')
    assert.ok((await srcs()).some((s) => s.includes('fruit_slice/slice.mp3')), '来电：接听播自定义语音')
    await page.evaluate(() => window.__mute(true))
    assert.ok((await mediaMuted()).every(Boolean), '来电：mute(true) 应静音正在播的语音')
    await page.evaluate(() => window.__mute(false))
    assert.ok((await mediaMuted()).every((m) => !m), '来电：mute(false) 应恢复')
    await pointer('down', d.hangupAt[0], d.hangupAt[1])
    d = await dbg()
    assert.ok(d.current && !d.current.answered && d.queued === 1, '来电：挂断后接下一通')
    await config({ durationSec: 600 })
    await stepFast(100, 400)   // 40 秒仍在响（时长上限放到 600 秒）
    assert.ok((await dbg()).current, '来电：时长 600 秒应生效（40 秒后仍在响）')
    await apply({ operation: 'clear' })
    d = await dbg()
    assert.ok(!d.current && d.queued === 0, '来电：clear 挂断全部')
    await config({ queueCalls: false })
    await apply({ operation: 'show', count: 5, username: '' })
    d = await dbg()
    assert.ok(d.current && d.current.name === '神秘粉丝' && d.queued === 0, '来电：不排队 + 无昵称')
    // 自定义语音放不了 → 回退内置
    await config({ queueCalls: true, answerAudios: assetPath(`fan_call/${MISSING}.mp3`) })
    await pointer('down', d.answerAt[0], d.answerAt[1])
    await page.waitForFunction(() => window.__plays.some((p) => p.src.includes('fan_call/default_answer.mp3')), null, { timeout: 5000 })
  },
  async fan_video_call() {
    await config({ cameraEnabled: true })
    await apply({ operation: 'show', count: 2, ...who })
    await waitDbg((d) => d.camera, '摄像头背景（假设备）')
    const gum = await page.evaluate(() => window.__gum.video)
    assert.ok(gum >= 1, '来视频：开了摄像头才调 getUserMedia(video)')
    await stepSlow(10)
    await capture('fan_video_call-camera')
    let d = await dbg()
    await pointer('down', d.answerAt[0], d.answerAt[1])
    d = await waitDbg((x) => x.videoReady, '接通视频出画面', 10000)
    assert.ok(!d.camera, '来视频：视频出画面后应关摄像头')
    await page.evaluate(() => window.__mute(true))
    assert.ok((await mediaMuted()).every(Boolean), '来视频：mute(true) 应静音视频')
    await page.evaluate(() => window.__mute(false))
    await stepSlow(6)
    await capture('fan_video_call-answered')
    await apply({ operation: 'clear' })
    d = await dbg()
    assert.ok(!d.current && !d.camera && d.queued === 0, '来视频：clear 全部收起并关摄像头')
  },
  async mosquito() {
    await page.evaluate(() => {
      const k = window.__GAME.debug().killsFor
      window.__k = [k(150), k(205), k(225), k(250)]
    })
    assert.deepEqual(await page.evaluate(() => window.__k), [1, 2, 4, 8], '拍蚊子：默认三档 1/2/4/8')
    await config({ clapLevel2: 190, clapKill2: 5, clapLevel3: 210, clapKill3: 9, maxKillLevel: 230, loudClapMaxKill: 20, killPerClap: 3 })
    await page.evaluate(() => { const k = window.__GAME.debug().killsFor; window.__k = [k(150), k(195), k(215), k(235)] })
    assert.deepEqual(await page.evaluate(() => window.__k), [3, 5, 9, 20], '拍蚊子：三档读可调参数')
    await config({ maxVisible: 4, micDevice: '假麦克风' })
    await apply({ operation: 'add', count: 6, ...who })
    let d = await dbg()
    assert.ok(d.alive === 4 && d.pending === 2, `拍蚊子：同屏上限 4，多的排队（${JSON.stringify([d.alive, d.pending])}）`)
    await apply({ operation: 'reduce', count: 3, ...who })
    d = await dbg()
    assert.ok(d.pending === 0 && d.alive === 3, `拍蚊子：reduce 先扣排队再灭场上（${JSON.stringify([d.alive, d.pending])}）`)
    await stepSlow(8)
    assert.ok((await page.evaluate(() => window.__gum.audio)) >= 1, '拍蚊子：有蚊子时开麦克风（假设备）')
  },
  async big_mosquito() { await swatFlow('big_mosquito', 'bigMosquitoSize', 'smallMosquitoSize', 'bigMosquitoHp', 'smallMosquitoHp') },
  async gesture_fly() { await swatFlow('gesture_fly', 'bigFlySize', 'smallFlySize', 'bigFlyHp', 'smallFlyHp') },
  async fruit_slice() {
    await apply({ operation: 'add', count: 6, kind: 'watermelon', ...who })
    assert.deepEqual((await dbg()).kinds, ['watermelon'], '切水果：指定西瓜')
    await apply({ operation: 'add', count: 30, kind: 'random', ...who })
    assert.ok((await dbg()).kinds.length >= 3, '切水果：随机应有多种')
    // —— 2026-10-07 用户「那个一直切不完啊」：切开的不能再抛回来、快速挥动（不按住）也能切、慢慢晃不算、漏掉的只再抛设定的次数 ——
    await apply({ operation: 'clear' })
    // 冻结页面自己的 rAF：水果在飞，测试等待时页面要是自己在画，挥的位置就扑空了（只靠 stepFast 推帧，状态确定）
    await freezeRaf()
    await config({ throwIntervalMs: 600, missRetry: 1, sliceMode: 'both', swipeSpeed: 30 })
    const [W, H] = await page.evaluate(() => [innerWidth, innerHeight])
    const inView = async () => {
      for (let i = 0; i < 120; i++) {
        await stepFast(1)
        const d = await dbg()
        const f = d.whole.find(([x, y]) => x > W * 0.15 && x < W * 0.85 && y > H * 0.1 && y < H * 0.8)
        if (f) return f
      }
      throw new Error('切水果：等不到水果飞进画面')
    }
    await apply({ operation: 'add', count: 3, kind: 'apple', ...who })
    let [fx, fy] = await inView()
    // 慢慢晃过去：200 毫秒挪 20 像素，没到挥刀速度，不算切
    await pointer('move', fx - 10, fy)
    await page.waitForTimeout(200)
    await pointer('move', fx + 10, fy)
    assert.equal((await dbg()).sliced, 0, '切水果：不按住慢慢晃过去不该切到')
    // 快速挥过去（不按住）：切开
    await page.evaluate(({ fx, fy }) => { window.__GAME.pointer('move', fx - 90, fy - 20); window.__GAME.pointer('move', fx + 90, fy + 20) }, { fx, fy })
    assert.equal((await dbg()).sliced, 1, '切水果：不按住快速挥过去应该切开')
    // 剩下两个不切：各漏两次（原抛 + 再抛 1 次）后不再抛，整轮结束；切开的那个不会回来
    let d
    for (let i = 0; i < 200; i++) { await stepFast(10); d = await dbg(); if (d.queued === 0 && d.whole.length === 0 && d.dropped >= 2) break }
    assert.ok(d.queued === 0 && d.whole.length === 0 && d.sliced === 1 && d.dropped === 2, `切水果：漏掉的只再抛 1 次、切开的不回来，整轮能结束：${JSON.stringify({ q: d.queued, w: d.whole.length, s: d.sliced, x: d.dropped })}`)
    let idle = false
    for (let i = 0; i < 100 && !idle; i++) idle = !(await stepFast(5))
    assert.ok(idle, '切水果：都抛完了应该停帧')
    // 只认按住拖动：快速挥过去不算，按住拖过去才切
    await config({ sliceMode: 'drag' })
    await apply({ operation: 'add', count: 1, kind: 'pear', ...who });
    [fx, fy] = await inView()
    const s0 = (await dbg()).sliced
    await page.evaluate(({ fx, fy }) => { window.__GAME.pointer('move', fx - 90, fy); window.__GAME.pointer('move', fx + 90, fy) }, { fx, fy })
    assert.equal((await dbg()).sliced, s0, '切水果：只认按住拖动时，不按住挥过去不该切')
    await page.evaluate(({ fx, fy }) => { const g = window.__GAME; g.pointer('down', fx - 90, fy); g.pointer('move', fx, fy); g.pointer('move', fx + 90, fy); g.pointer('up', fx + 90, fy) }, { fx, fy })
    assert.equal((await dbg()).sliced, s0 + 1, '切水果：按住拖过去应该切开')
    await config({ sliceMode: 'both' })
    await page.evaluate(() => { if (window.__origRAF) window.requestAnimationFrame = window.__origRAF })
  },
  async coin_bump() {
    await config({ customCoinImage: assetPath('fruit_slice/apple.png'), customSound: assetPath('fruit_slice/slice.mp3') })
    await apply({ operation: 'add', count: 3, ...who })
    await stepFast(20)
    let d = await dbg()
    await pointer('down', d.brickAt[0], d.brickAt[1])
    await stepSlow(20)
    d = await waitDbg((x) => x.custom && x.coins === 1 && x.remaining === 2, '顶金币自定义金币图', 3000)
    const plays = await page.evaluate(() => window.__plays.map((p) => p.src))
    assert.ok(plays.some((s) => s.includes('fruit_slice/slice.mp3')), '顶金币：自定义顶出音效')
    await stepFast(60)
    await capture('coin_bump-custom')
  },
  async leaf_pickup() {
    await apply({ operation: 'accelerate', count: 4 })
    assert.equal((await dbg()).multiplier, 1, '捡叶子：没有回合时加速不生效')
    await apply({ operation: 'add', count: 12, size: 'big', ...who })
    await stepFast(220)
    await apply({ operation: 'accelerate', count: 3, ...who })
    assert.equal((await dbg()).multiplier, 3, '捡叶子：加速 ×3')
    assert.ok(await clickFirst(), '捡叶子：应能点到叶子')
    let d = await dbg()
    assert.ok(d.cleared === 3 && d.remaining === 9, `捡叶子：点一下收 1×3（${JSON.stringify([d.cleared, d.remaining])}）`)
    assert.equal((await stats()).value, 3, '捡叶子：统计 = 本轮已清扫')
    await apply({ operation: 'reduce', count: 2, ...who })
    d = await dbg()
    assert.ok(d.cleared === 5 && d.remaining === 7, '捡叶子：直接扫掉 2')
    await apply({ operation: 'tornado', count: 4, ...who })
    d = await dbg()
    assert.ok(d.tornado === 4 && d.remaining === 3 && d.cleared === 9, `捡叶子：龙卷风卷走 4（${JSON.stringify(d).slice(0, 200)}）`)
    await stepFast(45)
    await capture('leaf_pickup-tornado')
    await apply({ operation: 'add', count: 2, size: 'small', ...who })
    d = await dbg()
    assert.ok(d.tornado === 0 && d.remaining === 5, '捡叶子：新 add 取消龙卷风并累加')
    await apply({ operation: 'reduce', count: 99 })
    await settleIdle('捡叶子扫光')
    d = await dbg()
    assert.ok(!d.roundActive && d.multiplier === 1, '捡叶子：回合结束倍数复位')
    // 剩余多于同屏上限：边清边补
    await apply({ operation: 'add', count: 60, ...who })
    await apply({ operation: 'clear' })
    assert.equal((await stats()).value, 0, '捡叶子：clear 后本轮已清扫归零')
  }
}

// 有累计统计的玩法：清零 → 生成 → 点（拖）到一个 → 统计 ≥1 → 累计清零 → 统计 = 0
async function statFlow(id, resetOp, warmSteps, drag = false, afterClick = 0) {
  await apply({ operation: resetOp })
  assert.equal((await stats()).value, 0, `${id}：清零后统计应为 0`)
  await apply({ operation: 'add', count: 3, ...who })
  await stepFast(warmSteps)
  const d = await dbg()
  const h = (d.hits || [])[0]
  assert.ok(h, `${id}：生成后应有可抓的目标（${JSON.stringify(d).slice(0, 200)}）`)
  if (drag) {
    await pointer('down', h[0], h[1])
    await pointer('move', (h[0] + d.drop[0]) / 2, (h[1] + d.drop[1]) / 2)
    await pointer('move', d.drop[0], d.drop[1])
    await pointer('up', d.drop[0], d.drop[1])
  } else {
    await pointer('down', h[0], h[1])
    await pointer('up', h[0], h[1])
  }
  if (afterClick) await stepFast(afterClick)
  const v = (await stats()).value
  assert.ok(v >= 1, `${id}：抓到后累计应 ≥1（${v}）`)
  await apply({ operation: resetOp })
  assert.equal((await stats()).value, 0, `${id}：累计清零后应为 0`)
}

// 手势拍蚊子/苍蝇：大小选项 → 尺寸/血量、reduce、自定义图、名牌字号
async function swatFlow(id, bigKey, smallKey, bigHpKey, smallHpKey) {
  await config({ [bigKey]: 50, [smallKey]: 20, [bigHpKey]: 4, [smallHpKey]: 2, textSize: 40 })
  await apply({ operation: 'add', count: 3, size: 'big', ...who })
  let d = await dbg()
  assert.ok(d.sizes.every((s) => s === 50) && d.hps.every((h) => h === 4), `${id}：大号 = 大尺寸大血量（${d.sizes}/${d.hps}）`)
  await apply({ operation: 'clear' })
  await apply({ operation: 'add', count: 3, size: 'small', ...who })
  d = await dbg()
  assert.ok(d.sizes.every((s) => s === 20) && d.hps.every((h) => h === 2), `${id}：小号 = 小尺寸小血量`)
  await apply({ operation: 'add', count: 20, size: 'random', username: '' })
  d = await dbg()
  assert.ok(d.sizes.every((s) => s >= 20 && s <= 50) && new Set(d.sizes).size >= 2, `${id}：随机在小~大之间分档（${[...new Set(d.sizes)]}）`)
  await apply({ operation: 'reduce', count: 5, ...who })
  assert.equal((await dbg()).alive, 18, `${id}：reduce 直接拍死 5 只`)
  await config({ maxVisible: 2 })
  await apply({ operation: 'clear' })
  await apply({ operation: 'add', count: 5, ...who })
  d = await dbg()
  assert.ok(d.alive === 2 && d.pending === 3, `${id}：同屏上限 2，多的排队`)
  await apply({ operation: 'reduce', count: 2 })
  d = await dbg()
  assert.ok(d.alive === 2 && d.pending === 1, `${id}：reduce 先扣排队`)
  await config({ maxVisible: 300, customImage: assetPath('duck/duck_angle_2.png') })
  await apply({ operation: 'add', count: 4, size: 'big', ...who })
  await waitDbg((x) => x.custom, `${id} 自定义目标图`, 3000)
  await stepFast(260)   // 苍蝇会落地爬（爬行帧也用自定义图）
  await capture(`${id}-custom`)
  await config({ controlMode: 'clap' })
  await stepSlow(6)
  assert.ok((await page.evaluate(() => window.__gum.audio)) >= 1, `${id}：声控模式开麦克风（假设备）`)
  await config({ controlMode: 'mouse', customImage: '' })
}

// 锁链皮肤：5 套（全部程序化绘制；原版素材皮肤 2026-10-08 下线）
const CHAIN_SKINS = ['neon', 'candy', 'rosegold', 'laser', 'ice']
const CHAIN_MODERN = ['neon', 'candy', 'rosegold', 'laser', 'ice']
// 冻结页面自己的 rAF：只靠 __step 推帧，断裂中途帧之类的截图才确定；截图前用原 rAF 等两帧让合成器把画布交上来
const freezeRaf = () => page.evaluate(() => { window.__origRAF = window.__origRAF || window.requestAnimationFrame.bind(window); window.requestAnimationFrame = () => 0 })
async function captureFrozen(name) {
  await page.evaluate(() => new Promise((r) => window.__origRAF(() => window.__origRAF(() => r()))))
  await capture(name)
}
// 画布内容指纹（判断画面有没有在动）
const canvasHash = () => page.evaluate(() => {
  const cv = document.getElementById('cv')
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
  let h = 0
  for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0
  return h
})
// 推帧直到 tick 返回 false（常态停帧），返回推了几帧；超过 limit 帧还在刷返回 -1
async function stepUntilIdle(limit, dt = 16) { for (let i = 0; i < limit; i++) if (!(await page.evaluate((d) => window.__step(d), dt))) return i; return -1 }

async function chainSkin(skin) {
  const modern = CHAIN_MODERN.includes(skin)
  const area = 1280 * 720
  await load('chain_challenge', { params: { visualStyle: skin } })
  await freezeRaf()
  if (!modern) await page.waitForTimeout(300)   // 经典款等素材图加载
  // 1) 上锁 12 环 → 入场走完 → 墨量 + 绿底截图
  await apply({ operation: 'add', count: 12, ...who })
  await stepFast(40)
  let d = await dbg()
  assert.ok(d.phase === 'sustain' && d.remaining === 12 && d.skin === skin, `锁链皮肤 ${skin}：上锁后应常态 12 环（${JSON.stringify(d)}）`)
  const ink = await canvasInk()
  assert.ok(ink > area * 0.04 && ink < area * 0.7, `锁链皮肤 ${skin}：墨量不合理 ${ink}（应占画面 4%~70%）`)
  await captureFrozen(`chain-${skin}`)
  // 2) 点几下：每下减 1（现代款带冲击粒子）
  for (let i = 0; i < 3; i++) { await pointer('down', 640, 200); await stepFast(2) }
  d = await dbg()
  assert.equal(d.remaining, 9, `锁链皮肤 ${skin}：点 3 下应剩 9 环`)
  if (modern) assert.ok(d.fx > 0, `锁链皮肤 ${skin}：点击应有冲击效果`)
  // 3) clear 断裂：中途帧截图 → 推到结束回空闲、画布清空
  await stepFast(30)
  await apply({ operation: 'clear' })
  assert.equal((await dbg()).phase, 'unlocking', `锁链皮肤 ${skin}：clear 应开始断裂`)
  if (modern) { await stepFast(16); await captureFrozen(`chain-${skin}-break`) }
  await settleIdle(`锁链皮肤 ${skin} 断裂`)
  d = await dbg()
  assert.ok(d.phase === 'idle' && d.remaining === 0 && !d.fx, `锁链皮肤 ${skin}：断裂完应回空闲（${JSON.stringify(d)}）`)
  const inkAfter = await canvasInk()
  assert.ok(inkAfter < 200, `锁链皮肤 ${skin}：断裂完画布应清空（墨量 ${inkAfter}）`)
  // 4) 常态刷帧：经典款不受动态开关影响，冲击播完就停帧；现代款开着动态一直刷、关掉停帧
  await apply({ operation: 'add', count: 5 })
  await stepFast(60)
  if (!modern) {
    assert.ok((await stepUntilIdle(40)) >= 0, `锁链皮肤 ${skin}：经典款常态应停帧`)
    notes.push(`锁链皮肤 ${skin}：墨量 ${ink} → 断裂后 ${inkAfter}`)
    return
  }
  assert.equal(await stepUntilIdle(30), -1, `锁链皮肤 ${skin}：skinMotion 开着时常态应一直刷帧`)
  const hashes = new Set()
  for (let i = 0; i < 8; i++) { await stepFast(20); hashes.add(await canvasHash()) }
  assert.ok(hashes.size >= 2, `锁链皮肤 ${skin}：skinMotion 开着时画面应有动画`)
  await config({ skinMotion: false })
  assert.ok((await stepUntilIdle(30)) >= 0, `锁链皮肤 ${skin}：skinMotion=false 常态应停帧（tick 返回 false）`)
  const h1 = await canvasHash()
  await page.evaluate(() => window.__step(400))
  assert.equal(await canvasHash(), h1, `锁链皮肤 ${skin}：skinMotion=false 画面应静止`)
  await pointer('down', 640, 200)   // 静态时点一下：冲击播完再停
  assert.equal(await page.evaluate(() => window.__step(16)), true, `锁链皮肤 ${skin}：静态时点击应有冲击动画`)
  assert.ok((await stepUntilIdle(150)) >= 0, `锁链皮肤 ${skin}：静态时冲击播完应停帧`)
  const bake = (await dbg()).bakeMs
  // 5) 透明底截图（OBS 直接叠的样子）
  await config({ skinMotion: true, background: 'transparent' })
  await stepFast(10)
  const inkT = await canvasInk()
  assert.ok(inkT > area * 0.04, `锁链皮肤 ${skin}：透明底墨量不合理 ${inkT}`)
  await captureFrozen(`chain-${skin}-transparent`)
  await apply({ operation: 'clear' })
  await settleIdle(`锁链皮肤 ${skin} 透明底清场`)
  notes.push(`锁链皮肤 ${skin}：墨量 ${ink} → 断裂后 ${inkAfter}，透明底 ${inkT}，缓存烘焙 ${bake}ms`)
}

// —— 主流程 ——
for (const id of builtIds) {
  const meta = SPECIAL_GAME_MAP[id]
  const errBefore = errors.length
  try {
    // 1) 默认操作（旧值 spawn）+ 墨量 + 截图 + clear 回空闲
    await load(id)
    await apply({ operation: 'spawn', count: 12, ...who })
    let everActive = false
    for (let i = 0; i < 75; i++) if (await page.evaluate(() => window.__step(16))) everActive = true
    const ink = await canvasInk()
    await capture(id)
    assert.ok(everActive, `${meta.name}：spawn 后应有活动帧`)
    assert.ok(ink > 60, `${meta.name}：画布应画出内容（墨量 ${ink}）`)
    await apply({ operation: 'clear' })
    await settleIdle(`${meta.name} clear`)
    const inkAfter = await canvasInk()
    assert.ok(inkAfter < ink, `${meta.name}：clear 后画布应基本清空（${inkAfter} < ${ink}）`)

    // 2) 逐个操作 × 数量 × 每个选项取值
    let opRuns = 0
    for (const op of meta.ops) {
      const variants = [{}]
      for (const f of meta.fields || []) for (const o of f.options) variants.push({ [f.key]: o.value })
      for (const v of variants) {
        await apply({ operation: op.value, count: op.count === false ? 1 : 3, ...who, ...v })
        await stepFast(op.value === 'add' || op.value === 'show' || op.value === 'start' ? 6 : 3)
        opRuns++
      }
      await stepFast(30)
      await apply({ operation: op.value, count: 2, username: '', avatar: '' })   // 无昵称
      await stepFast(10)
      opRuns++
    }
    await apply({ operation: 'nonsense-op', count: 2, ...who })   // 未知操作 = 默认操作
    await stepFast(10)
    await apply({ operation: clearOp(meta) })
    await settleIdle(`${meta.name} 全部操作后清场`)
    const banner = await page.evaluate(() => document.getElementById('btx').textContent)
    assert.ok(!/undefined|null|NaN/.test(banner), `${meta.name}：横幅文案异常「${banner}」`)

    // 3) 玩法专属语义（重新加载一页，状态干净）
    if (SEMANTIC[id]) {
      await load(id)
      await SEMANTIC[id]()
      await apply({ operation: clearOp(meta) })
      await settleIdle(`${meta.name} 语义检查后清场`)
    }

    // 4) 预览模式：无错误、不调 getUserMedia、媒体全部静音播放
    const previewParams = {
      big_mosquito: { controlMode: 'both' },
      gesture_fly: { controlMode: 'both' },
      fan_video_call: { cameraEnabled: true }
    }[id] || {}
    await load(id, { preview: true, params: previewParams })
    assert.equal(await page.evaluate(() => window.__MUTED), true, `${meta.name}：预览默认静音`)
    await apply({ operation: 'spawn', count: 6, ...who })
    await stepSlow(40)
    if (id === 'fan_call' || id === 'fan_video_call') {
      const d = await dbg()
      await pointer('down', d.answerAt[0], d.answerAt[1])
      await stepSlow(10)
    }
    if (id === 'talisman_seal' || id === 'mosquito' || id === 'big_mosquito' || id === 'gesture_fly') {
      await waitDbg((d) => d.micKind === 'preview', '预览提示不收音', 3000)
    }
    await stepSlow(10)
    if (id === 'talisman_seal' || id === 'fan_video_call') await capture(`${id}-preview`)
    const gum = await page.evaluate(() => window.__gum.calls)
    assert.equal(gum, 0, `${meta.name}：预览里不许调 getUserMedia（调了 ${gum} 次）`)
    const loud = await page.evaluate(() => window.__plays.filter((p) => !p.muted).map((p) => p.src))
    assert.equal(loud.length, 0, `${meta.name}：预览里媒体必须静音播放（${loud.join(', ')}）`)
    await apply({ operation: clearOp(meta) })
    await settleIdle(`${meta.name} 预览清场`)

    if (errors.length > errBefore) throw new Error('页面错误：' + errors.slice(errBefore).join(' | '))
    console.log(`PASS ${meta.name}（${id}）墨量 ${ink} → ${inkAfter}，操作 ${opRuns} 次`)
    passed++
  } catch (e) {
    fail.push(`${meta.name}（${id}）：${e.message}`)
    console.log(`FAIL ${meta.name}（${id}）：${e.message}`)
  }
}

// 不抢前台：全程所有窗口不可见、不聚焦
const noFocus = await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused())
)
assert.equal(noFocus, true, '测试窗口不得可见或聚焦（防抢前台）')

await app.close()
// 临时 Electron 资料目录用完即删（不然每跑一次留一个）
await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})

if (notes.length) {
  console.log('\n记录：')
  for (const n of notes) console.log('  ' + n)
}
if (errors.length) {
  console.log('\n页面错误：')
  for (const e of errors) console.log('  ' + e)
}
console.log(`\nSPECIAL GAMES: ${passed}/${builtIds.length} PASS` + (fail.length ? `，失败 ${fail.length}` : ''))
if (fail.length || errors.length) process.exit(1)
