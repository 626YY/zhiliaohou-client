// 特色整蛊合并窗口回归：17 个玩法同在一个「特色整蛊」页面（buildSpecialWindowPage），离屏 Electron 里验：
//   1. 按需加载：开窗时一个玩法都不加载；收到谁的命令才加载谁，各自一层画布、按图层顺序叠（来视频在最上面）
//   2. 每个玩法一份自己的 ZL 小工具（音量、素材缓存不串）
//   3. 点击各玩各的：点中鸭子只抓鸭子、锁链不掉环；点空白处才挣开锁链一环；按住拖动不挣锁链；
//      来视频的挂断键在最上层先接住，下面的鸭子和锁链都不受影响
//   4. 窗口底色切换传到每个玩法；一次下发多条 + 开出提示横幅；累计统计；全部清屏后停帧
//   5. 17 个一起加载、一起动：每帧耗时
// 不启动客户端、不碰用户配置；窗口离屏不可见不聚焦（不抢前台）；麦克风/摄像头用假的。
// 用法：node tools/verify-special-window.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/special-window')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetBase = pathToFileURL(path.join(root, 'assets/special-games')).href.replace(/\/?$/, '/')

const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig, specialDefaultParam, parseSpecialParam} from './src/shared/specialGames';
export {buildSpecialWindowPage} from './src/main/special-page';
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
const { SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig, specialDefaultParam, parseSpecialParam, buildSpecialWindowPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

// 假麦克风/摄像头（测试页专用，不碰真设备）+ 冻结页面自己的 rAF：只靠 __step 推帧，点击前后状态确定
const TEST_PRE = `<script>(function(){
  var sharedAc=null;
  function fakeVideo(){ var cv=document.createElement('canvas'); cv.width=320; cv.height=180; var g=cv.getContext('2d'); g.fillStyle='#2b6cb0'; g.fillRect(0,0,320,180); return cv.captureStream(5); }
  var fake={ getUserMedia:function(c){ if(c&&c.video) return Promise.resolve(fakeVideo()); if(!sharedAc) sharedAc=new AudioContext(); return Promise.resolve(sharedAc.createMediaStreamDestination().stream); },
    enumerateDevices:function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake-mic', groupId:'g' }]); } };
  try{ Object.defineProperty(navigator,'mediaDevices',{ value:fake, configurable:true }); }catch(e){}
  window.__realRaf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=function(){ return 0; };
})();</script>`

const W = 1280, H = 720
const win = { ...DEFAULT_SPECIAL_WINDOW, width: W, height: H }
const html = buildSpecialWindowPage(SPECIAL_GAMES.map((meta) => ({ meta, cfg: defaultSpecialConfig(meta), code: GAME_CODE[meta.id] || '' })), win, SPECIAL_LAYER_ORDER, assetBase)
  .replace('<div id="stage">', TEST_PRE + '<div id="stage">')
const file = path.join(output, 'special-window.html')
await fs.writeFile(file, html)

const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:${W},height:${H},show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false,autoplayPolicy:'no-user-gesture-required'}});win.loadURL('about:blank')});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files', '--mute-audio'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|getUserMedia|NotAllowedError|Requested device not found|play\(\) request was interrupted/.test(m.text())) errors.push('[console] ' + m.text()) })

let passed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const apply = (cmd) => page.evaluate((c) => window.__apply(c), cmd)
const dbg = (id) => page.evaluate((g) => { const o = window.__game(g); return o && o.debug ? JSON.parse(JSON.stringify(o.debug(), (k, v) => (typeof v === 'function' || (typeof HTMLMediaElement !== 'undefined' && v instanceof HTMLMediaElement)) ? undefined : v)) : null }, id)
const step = (n, dt = 40) => page.evaluate(({ n, dt }) => { let a = false; for (let i = 0; i < n; i++) a = window.__step(dt) || a; return a }, { n, dt })
const layers = () => page.evaluate(() => [...document.querySelectorAll('#stage canvas')].map((c) => c.getAttribute('data-game')))
// 在 #hit 上发一串指针事件（同一次 evaluate 里，状态读取和点击之间不会有帧插进来）
const gesture = (x, y, to) => page.evaluate(({ x, y, to }) => {
  const hit = document.getElementById('hit')
  const fire = (type, px, py) => hit.dispatchEvent(new PointerEvent(type, { clientX: px, clientY: py, pointerId: 7, bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse' }))
  fire('pointerdown', x, y)
  if (to) for (let i = 1; i <= 8; i++) fire('pointermove', x + (to[0] - x) * i / 8, y + (to[1] - y) * i / 8)
  fire('pointerup', to ? to[0] : x, to ? to[1] : y)
}, { x, y, to })
const shot = async (name) => {
  const bw = await app.browserWindow(page)
  await page.evaluate(() => new Promise((r) => window.__realRaf(() => window.__realRaf(r))))
  const png = await bw.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}

try {
  const bw = await app.browserWindow(page)
  await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => typeof window.__applyMany === 'function' && typeof window.__game === 'function')

  // ---- 1. 按需加载 ----
  assert.deepEqual(await page.evaluate(() => window.__loaded()), [], '开窗时不该加载任何玩法')
  assert.equal((await layers()).length, 0)
  const html0 = Buffer.byteLength(html)
  ok(`开窗不加载玩法（页面 ${(html0 / 1024).toFixed(0)} KB，17 个玩法代码都在、没执行）`)

  await apply({ game: 'catch_duck', operation: 'add', count: 8, username: '阿彪' })
  await page.evaluate(() => { window.__zlDuck = window.__ZL })
  await apply({ game: 'chain_challenge', operation: 'add', count: 3, username: '小美' })
  const zlSeparate = await page.evaluate(() => window.__ZL !== window.__zlDuck && typeof window.__zlDuck.img === 'function' && typeof window.__ZL.img === 'function' && window.__zlDuck.kick !== window.__ZL.kick)
  assert.ok(zlSeparate, '每个玩法应有自己的 ZL 小工具')
  assert.deepEqual(await page.evaluate(() => window.__loaded()), ['catch_duck', 'chain_challenge'])
  ok('收到命令才加载：鸭子、锁链各自一份 ZL（素材缓存/音量/叫醒各管各的）')

  // 等鸭子落地、锁链挂好
  for (let i = 0; i < 120; i++) {
    await step(5)
    const d = await dbg('catch_duck'), c = await dbg('chain_challenge')
    if (d.hits.length >= 6 && c.phase === 'sustain') break
  }
  const c0 = await dbg('chain_challenge')
  assert.equal(c0.phase, 'sustain', `锁链没挂好：${JSON.stringify(c0)}`)

  // ---- 3a. 点中鸭子：只抓鸭子，锁链不掉环 ----
  const d0 = await dbg('catch_duck')
  const [dx, dy] = d0.hits[d0.hits.length - 1]
  await gesture(dx, dy)
  const d1 = await dbg('catch_duck'), c1 = await dbg('chain_challenge')
  assert.equal(d1.caught, d0.caught + 1, `点中的鸭子应被抓：${JSON.stringify({ d0, d1 })}`)
  assert.equal(c1.remaining, c0.remaining, `点鸭子不该挣开锁链：${c0.remaining} → ${c1.remaining}`)
  ok(`点中鸭子：鸭子 ${d0.caught}→${d1.caught}，锁链 ${c0.remaining} 环不变`)

  // ---- 3b. 点空白：挣开锁链一环，鸭子不变 ----
  const empty = (hits) => {
    for (let y = 80; y < H - 40; y += 37) for (let x = 60; x < W - 60; x += 41) {
      if (hits.every(([hx, hy, s]) => Math.hypot(hx - x, hy - y) > s + 40)) return [x, y]
    }
    return [10, 10]
  }
  const d2 = await dbg('catch_duck')
  const [ex, ey] = empty(d2.hits)
  await gesture(ex, ey)
  await step(2)
  const d3 = await dbg('catch_duck'), c3 = await dbg('chain_challenge')
  assert.ok(c3.remaining < c1.remaining, `点空白应挣开锁链：${c1.remaining} → ${c3.remaining}`)
  assert.equal(d3.caught, d2.caught, '点空白不该抓到鸭子')
  ok(`点空白（${ex},${ey}）：锁链 ${c1.remaining}→${c3.remaining}，鸭子不变`)

  // ---- 3c. 按住拖动（像切水果）：不算点击，锁链不掉环 ----
  const d4 = await dbg('catch_duck')
  const [sx, sy] = empty(d4.hits)
  await gesture(sx, sy, [Math.min(W - 20, sx + 260), Math.min(H - 20, sy + 120)])
  await step(2)
  const c4 = await dbg('chain_challenge')
  assert.equal(c4.remaining, c3.remaining, `拖动不该挣开锁链：${c3.remaining} → ${c4.remaining}`)
  ok('按住拖动不算点击：锁链环数不变')

  // ---- 3d. 来视频在最上层：挂断键先接住，下面的不受影响 ----
  await apply({ game: 'fan_video_call', operation: 'show', count: 1, username: '老铁' })
  await step(10)
  const order = await layers()
  assert.deepEqual(order, ['catch_duck', 'chain_challenge', 'fan_video_call'], `图层顺序不对：${order}`)
  assert.equal(order[order.length - 1], 'fan_video_call', '来视频应在最上层')
  const v0 = await dbg('fan_video_call')
  assert.ok(v0.current, `来视频卡片没出现：${JSON.stringify(v0)}`)
  await shot('01-duck-chain-video')
  const before = { duck: (await dbg('catch_duck')).caught, chain: (await dbg('chain_challenge')).remaining }
  await gesture(v0.hangupAt[0], v0.hangupAt[1])
  await step(30)
  const v1 = await dbg('fan_video_call')
  const after = { duck: (await dbg('catch_duck')).caught, chain: (await dbg('chain_challenge')).remaining }
  assert.ok(!v1.current || v1.current.name !== v0.current.name || v1.queued < v0.queued, `挂断键没接住：${JSON.stringify({ v0, v1 })}`)
  assert.deepEqual(after, before, `点挂断不该影响鸭子和锁链：${JSON.stringify({ before, after })}`)
  await shot('01b-after-hangup')
  ok(`来视频在最上层（图层 ${order.join(' < ')}），点挂断只挂断，鸭子/锁链不动`)

  // ---- 4. 窗口底色 / 一次多条 + 横幅 / 统计 / 清屏 ----
  await page.evaluate(() => window.__window({ background: 'transparent' }))
  const bg = await page.evaluate(() => ({ body: document.body.style.background, chain: window.__INITIAL_CFGS.chain_challenge.background, duck: window.__INITIAL_CFGS.catch_duck.background }))
  assert.equal(bg.body, 'transparent')
  assert.equal(bg.chain, 'transparent')
  assert.equal(bg.duck, 'transparent')
  await page.evaluate(() => window.__window({ background: 'green' }))
  ok('窗口底色切透明：页面和每个玩法都收到（锁链配色按底色避开绿）')

  const announce = '🎁 阿彪的「特色盲盒」×3 开出：扔粑粑 +7个、抓鸭子 +4只'
  const n = await page.evaluate((a) => window.__applyMany([
    { game: 'throw_poop', operation: 'add', count: 7, username: '阿彪' },
    { game: 'catch_duck', operation: 'add', count: 4, username: '阿彪' }
  ], a, ''), announce)
  assert.equal(n, 2)
  const banner = await page.evaluate(() => document.getElementById('btx').textContent)
  assert.equal(banner, announce)
  assert.ok((await page.evaluate(() => window.__loaded())).includes('throw_poop'))
  ok(`一次下发 2 条（盲盒开出）：横幅「${banner}」`)

  const stats = await page.evaluate(() => window.__stats('catch_duck'))
  assert.equal(stats?.value, (await dbg('catch_duck')).caught, `累计统计不对：${JSON.stringify(stats)}`)
  ok(`累计统计按玩法读：抓鸭子 ${stats.value}`)

  // ---- 4b. 左上角计数面板：几个玩法同时在场时上下排开，不叠在一起；清空的玩法让位 ----
  await apply({ game: 'catch_bullet', operation: 'add', count: 5, username: '阿彪' })
  await step(12)
  const hud = await page.evaluate(() => window.__hudLayout())
  const rows = Object.entries(hud).sort((a, b) => a[1].y - b[1].y)
  assert.ok(rows.length >= 3, `至少鸭子/粑粑/子弹三块面板：${JSON.stringify(hud)}`)
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i][1].y >= rows[i - 1][1].y + rows[i - 1][1].h, `面板叠住了：${JSON.stringify(rows)}`)
  await shot('01c-hud-stack')
  await page.evaluate(() => window.__apply({ game: 'throw_poop', operation: 'clear', count: 1 }))
  await step(4)
  const hud2 = await page.evaluate(() => window.__hudLayout())
  assert.ok(!hud2.throw_poop, `清空的玩法应收起面板：${JSON.stringify(hud2)}`)
  const order2 = Object.entries(hud2).sort((a, b) => a[1].y - b[1].y)
  assert.equal(order2[0][1].y, 10, `剩下的面板应顶上去：${JSON.stringify(hud2)}`)
  ok(`计数面板排队：${rows.map(([id, v]) => `${id}@${Math.round(v.y)}`).join(' / ')}；粑粑清空后收起、其余顶上去`)

  // ---- 5. 17 个一起加载、一起动 ----
  for (const meta of SPECIAL_GAMES) {
    const p = parseSpecialParam(specialDefaultParam(meta.id))
    await apply({ game: meta.id, operation: p.op, count: meta.countDef * 2, username: '压测' })
  }
  const all = await layers()
  assert.equal(all.length, 17, `应有 17 层画布：${all}`)
  assert.deepEqual(all, SPECIAL_LAYER_ORDER, '画布顺序应等于图层顺序')
  await step(25)
  const perf = await page.evaluate(() => {
    const t0 = performance.now()
    for (let i = 0; i < 120; i++) window.__step(16)
    return (performance.now() - t0) / 120
  })
  await shot('02-all-17')
  // 来电 / 来视频是整屏的通话界面，盖住下面所有层；挂掉它俩再拍一张看其余 15 层叠在一起
  await page.evaluate(() => window.__applyMany([{ game: 'fan_video_call', operation: 'clear', count: 1 }, { game: 'fan_call', operation: 'clear', count: 1 }], '', ''))
  await step(15)
  await shot('03-all-under-calls')
  console.log(`  17 个玩法同时在动：平均每帧逻辑+绘制 ${perf.toFixed(2)} ms（60 帧预算 16.7 ms）`)
  assert.ok(perf < 16.7, `17 个一起动每帧 ${perf.toFixed(1)} ms，超出 60 帧预算`)
  ok(`17 个玩法同窗：17 层画布按图层顺序，平均每帧 ${perf.toFixed(2)} ms`)

  const cmds = SPECIAL_GAMES.map((g) => ({ game: g.id, operation: g.ops.some((o) => o.value === 'clear') ? 'clear' : 'stop', count: 1 }))
  await page.evaluate((c) => window.__applyMany(c, '', ''), cmds)
  let idle = -1
  for (let i = 0; i < 600; i++) { if (!(await page.evaluate(() => window.__step(50)))) { idle = i; break } }
  assert.ok(idle >= 0, '全部清屏后应停帧')
  ok(`全部清屏后 ${idle} 帧内停帧`)
} catch (e) {
  console.log('FAIL ' + (e && e.message))
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
if (errors.length) { console.log('\n页面错误：'); for (const e of errors) console.log('  ' + e) }
console.log(`\nSPECIAL WINDOW: ${passed} PASS${process.exitCode ? '，有失败' : ''}${errors.length ? `，页面错误 ${errors.length}` : ''}  截图：${output}`)
if (errors.length) process.exitCode = 1
