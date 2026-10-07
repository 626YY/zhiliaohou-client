// 「全部清屏」回归：清屏之后特色窗口必须真的干净——
//   每一层画布（玩法层 + 左上角计数面板层）一个像素不剩、摄像头/麦克风全部释放、清屏不出声、横幅收起，
//   而且清屏后在窗口上乱点、乱拖、晃鼠标，也不能再画出任何东西（刀光、手印之类）。
// 2026-10-07 用户：点完清屏以后，扔垃圾的垃圾桶居然还在；切水果、枫叶启动完以后都没关掉
//   ——原来的用例只验「清屏后停帧」，没验画面真的空了。
//   A. 每个玩法单独来：新开页面 → 把它会出东西的操作各触发一次 → 推帧让东西出场 → 走和「全部清屏」按钮
//      同样的流程（special-gameplay.ts clearAllSpecial）→ 推到停帧 → 逐项查 → 乱点乱拖再查一遍画面。
//   B. 17 个一起来一遍（主播真实的样子），再整窗清屏，同样查。
// 不启动客户端、不碰用户配置；离屏窗口不可见不聚焦（不抢前台）、静音；麦克风/摄像头用假的。
// 用法：node tools/verify-special-clear.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/special-clear')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetBase = pathToFileURL(path.join(root, 'assets/special-games')).href.replace(/\/?$/, '/')

const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig} from './src/shared/specialGames';
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
const { SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig, buildSpecialWindowPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

// 假麦克风/摄像头（记下发出去的流，清屏后查还开着没有）+ 冻结页面自己的 rAF（只靠 __step 推帧）
// + 记下所有放过的音视频和开始时间（清屏后查谁还在响、清屏本身有没有出声）
const TEST_PRE = `<script>(function(){
  var sharedAc=null;
  window.__streams=[];
  function keep(s){ window.__streams.push(s); return s; }
  function fakeVideo(){ var cv=document.createElement('canvas'); cv.width=320; cv.height=180; var g=cv.getContext('2d'); g.fillStyle='#2b6cb0'; g.fillRect(0,0,320,180); return cv.captureStream(5); }
  var fake={ getUserMedia:function(c){ if(c&&c.video) return Promise.resolve(keep(fakeVideo())); if(!sharedAc) sharedAc=new AudioContext(); return Promise.resolve(keep(sharedAc.createMediaStreamDestination().stream)); },
    enumerateDevices:function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake-mic', groupId:'g' }]); } };
  try{ Object.defineProperty(navigator,'mediaDevices',{ value:fake, configurable:true }); }catch(e){}
  window.__realRaf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=function(){ return 0; };
  window.__media=[]; window.__plays=[];
  var play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){
    if(window.__media.indexOf(this)<0) window.__media.push(this);
    window.__plays.push({ t:performance.now(), src:String(this.currentSrc||this.src||'').split('/').slice(-2).join('/') });
    return play.apply(this,arguments);
  };
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

let passed = 0, failed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const bad = (m) => { failed++; console.log('FAIL ' + m) }
const step = (n, dt = 40) => page.evaluate(({ n, dt }) => { let a = false; for (let i = 0; i < n; i++) a = window.__step(dt) || a; return a }, { n, dt })
const shot = async (name) => {
  const bw = await app.browserWindow(page)
  await page.evaluate(() => new Promise((r) => window.__realRaf(() => window.__realRaf(r))))
  const png = await bw.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}
// 每层画布上不透明像素（隔一取一）的个数和范围
const residue = () => page.evaluate(() => [...document.querySelectorAll('#stage canvas, #hud canvas')].map((c) => {
  const w = c.width, h = c.height
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
  if (w && h) {
    const d = c.getContext('2d').getImageData(0, 0, w, h).data
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      if (d[(y * w + x) * 4 + 3] > 8) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y }
    }
  }
  return { id: c.getAttribute('data-game') || c.getAttribute('data-hud') || c.id || '?', hud: c.hasAttribute('data-hud'), n, box: n ? [x0, y0, x1, y1] : null }
}))
// 清屏后还在响的音视频：循环的、或还没放完且剩下超过 1.5 秒的（短音效自己会放完，不算）
const sounding = () => page.evaluate(() => (window.__media || []).filter((m) => !m.paused && !m.ended && (m.loop || !(m.duration > 0) || m.duration - m.currentTime > 1.5)).map((m) => (m.currentSrc || m.src || (m.srcObject ? '(流)' : '?')).split('/').slice(-2).join('/')))
const clearCmds = (ids) => ids.map((id) => {
  const meta = SPECIAL_GAMES.find((g) => g.id === id)
  return { game: id, operation: meta.ops.some((o) => o.value === 'clear') ? 'clear' : 'stop', count: 1, username: '', avatar: '', gift: '', wipe: true }
})
// 和主进程 clearAllSpecial 一样：先清开奖队列，再给窗口里用过的玩法各发 clear（没有 clear 的发 stop，都带 wipe），最后 __wipe 收尾
const clearAll = async () => {
  const cmds = clearCmds(await page.evaluate(() => window.__loaded()))
  await page.evaluate((c) => {
    window.__clearAt = performance.now()
    if (window.__revealClear) window.__revealClear()
    window.__applyMany(c, '', '')
    if (window.__wipe) window.__wipe()
  }, cmds)
}
// 清屏后还开着的摄像头 / 麦克风
const liveTracks = () => page.evaluate(() => (window.__streams || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').map((t) => t.kind))
// 清屏这一下自己放出来的声音
const clearSounds = () => page.evaluate(() => (window.__plays || []).filter((p) => p.t >= (window.__clearAt || Infinity)).map((p) => p.src))
const bannerShown = () => page.evaluate(() => { const b = document.getElementById('banner'); return !!b && Number(getComputedStyle(b).opacity) > 0.01 })
// 清屏后乱点、乱拖、晃鼠标（像主播回到窗口上点清屏按钮、拖窗口那样）
const pointerStorm = () => page.evaluate(({ W, H }) => {
  const hit = document.getElementById('hit')
  if (!hit) return 0
  let n = 0
  const fire = (type, x, y) => { n++; hit.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 9, bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons: type === 'pointerup' || type === 'pointermove' ? 0 : 1, pointerType: 'mouse' })) }
  const drag = (x0, y0, x1, y1) => {
    hit.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 9, bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse' }))
    for (let i = 1; i <= 12; i++) hit.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + (x1 - x0) * i / 12, clientY: y0 + (y1 - y0) * i / 12, pointerId: 9, bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse' }))
    fire('pointerup', x1, y1); n += 13
  }
  for (const [x, y] of [[W * 0.5, H * 0.5], [W * 0.2, H * 0.8], [W * 0.85, H * 0.85], [W * 0.5, H * 0.92], [W * 0.1, H * 0.1]]) { fire('pointerdown', x, y); fire('pointerup', x, y) }
  drag(W * 0.1, H * 0.5, W * 0.9, H * 0.6)
  drag(W * 0.45, H * 0.95, W * 0.6, H * 0.3)
  for (let i = 0; i <= 20; i++) fire('pointermove', W * (0.1 + 0.04 * i), H * (0.3 + 0.02 * i))
  return n
}, { W, H })
const untilIdle = async () => { for (let i = 0; i < 750; i++) { if (!(await page.evaluate(() => window.__step(40)))) return i } return -1 }
const SPAWN_SKIP = new Set(['clear', 'stop', 'reset', 'remove', 'reduce', 'minus', 'hangup'])
const fresh = async () => {
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => typeof window.__applyMany === 'function' && typeof window.__game === 'function')
}

try {
  const bw = await app.browserWindow(page)
  await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })

  // ---- A. 每个玩法单独：触发 → 出场 → 全部清屏 → 一个像素不剩 ----
  for (const meta of SPECIAL_GAMES) {
    await fresh()
    const ops = meta.ops.map((o) => o.value).filter((v) => !SPAWN_SKIP.has(v))
    for (const op of ops) await page.evaluate((c) => window.__apply(c), { game: meta.id, operation: op, count: Math.max(1, meta.countDef || 1), username: '测试' })
    await step(60)
    const before = (await residue()).filter((r) => r.n > 0)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
    const tracksBefore = await liveTracks()
    await clearAll()
    const idle = await untilIdle()
    await step(3)
    const left = (await residue()).filter((r) => r.n > 0)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1200)))
    const snd = await sounding()
    const own = await clearSounds()
    const tracks = await liveTracks()
    const banner = await bannerShown()
    // 清屏后乱点乱拖，推几帧，画面也得还是空的
    await pointerStorm()
    await step(8)
    const after = (await residue()).filter((r) => r.n > 0)
    await untilIdle()
    const problems = []
    if (left.length) problems.push(`清屏后还剩 ${left.map((r) => `${r.id}${r.hud ? '·面板' : ''} ${r.n}点 @${r.box.join(',')}`).join('；')}`)
    if (snd.length) problems.push(`还在响 ${snd.join('、')}`)
    if (own.length) problems.push(`清屏时出了声 ${[...new Set(own)].join('、')}`)
    if (tracks.length) problems.push(`${tracks.join('、')} 没释放`)
    if (banner) problems.push('横幅没收')
    if (after.length) problems.push(`清屏后点/拖鼠标又画出 ${after.map((r) => `${r.id} ${r.n}点 @${r.box.join(',')}`).join('；')}`)
    if (idle < 0) problems.push('没停帧')
    const tag = `${meta.name}（${meta.id}，触发 ${ops.join('/') || '—'}，清屏前 ${before.map((r) => r.id + (r.hud ? '·面板' : '')).join('+') || '空'}${tracksBefore.length ? '，开着 ' + tracksBefore.join('/') : ''}）`
    if (problems.length) {
      await shot('A-' + meta.id)
      bad(`${tag}：${problems.join('；')}`)
    } else ok(`${tag}：清屏后画面全空、设备释放、没出声，乱点乱拖也不画东西，${idle} 帧停帧`)
  }

  // ---- B. 17 个一起，再整窗清屏 ----
  await fresh()
  for (const meta of SPECIAL_GAMES) {
    for (const op of meta.ops.map((o) => o.value).filter((v) => !SPAWN_SKIP.has(v))) {
      await page.evaluate((c) => window.__apply(c), { game: meta.id, operation: op, count: Math.max(1, meta.countDef || 1), username: '一起' })
    }
  }
  await step(60)
  await shot('B-before')
  await clearAll()
  const idle = await untilIdle()
  await step(3)
  const left = (await residue()).filter((r) => r.n > 0)
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  const tracks = await liveTracks()
  const snd = await sounding()
  await pointerStorm()
  await step(8)
  const after = (await residue()).filter((r) => r.n > 0)
  await shot('B-after')
  const problems = []
  if (left.length) problems.push(`还剩 ${left.map((r) => `${r.id}${r.hud ? '·面板' : ''} ${r.n}点`).join('；')}`)
  if (tracks.length) problems.push(`${tracks.join('、')} 没释放`)
  if (snd.length) problems.push(`还在响 ${snd.join('、')}`)
  if (after.length) problems.push(`乱点乱拖又画出 ${after.map((r) => `${r.id} ${r.n}点`).join('；')}`)
  if (idle < 0) problems.push('没停帧')
  if (problems.length) bad(`17 个一起后整窗清屏：${problems.join('；')}`)
  else ok(`17 个一起后整窗清屏：${(await residue()).length} 层画布全空、设备全释放、乱点乱拖不画东西，${idle} 帧停帧`)
} catch (e) {
  bad(String(e && e.stack || e))
} finally {
  await app.close().catch(() => {})
}
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
if (errors.length) { console.log('\n页面错误：'); for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e) }
console.log(`\nSPECIAL CLEAR: ${passed} PASS, ${failed} FAIL${errors.length ? `，页面错误 ${errors.length}` : ''}  截图：${output}`)
if (failed || errors.length) process.exitCode = 1
