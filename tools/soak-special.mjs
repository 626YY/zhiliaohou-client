// 特色整蛊直播窗口长跑压力：17 个玩法同在一个真直播窗口（buildSpecialWindowPage，真实渲染循环、30 帧上限），
// 固定随机种子每 150ms 随机来一下——给随机玩法下随机操作（加 / 减 / 乘 / 除 / 清场 / 来电 / 开歌 / 暂停…）、随机数量，
// 在窗口上点 / 拖 / 挥，对假麦克风拍手喊叫，偶尔全部清屏、切横竖屏、改设置。
// 每 15 秒记：页面 JS 堆、还开着的 AudioContext / 媒体元素 / 麦克风摄像头音轨、平均帧耗时；全程收页面报错。
// 结束：全部清屏 → 等停帧 → 强制 GC，断言：没有页面报错、内存回落（没越跑越大）、AudioContext 和音轨都释放、画面全空、页面还能响应。
// 2026-10-07 用户：「不会出现软件闪退的情况吧，没问题就发布吧」。
// 不启动客户端、不碰用户配置；离屏窗口不可见不聚焦（不抢前台）、静音。
// 用法：node tools/soak-special.mjs [--minutes 4] [--seed 7]
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : d }
const MINUTES = arg('--minutes', 4)
const SEED = arg('--seed', 7)
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/soak-special')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetBase = pathToFileURL(path.join(root, 'assets/special-games')).href.replace(/\/?$/, '/')
const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: { contents: `export {SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig} from './src/shared/specialGames';\nexport {buildSpecialWindowPage} from './src/main/special-page';\nexport {GAME_CODE} from './src/main/special-games';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning'
})
const { SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig, buildSpecialWindowPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

// 假麦克风 / 摄像头 + 记 AudioContext 开关数量（关掉的减掉）+ 记媒体元素
const TEST_PRE = `<script>(function(){
  var AC=window.AudioContext;
  window.__acOpen=0;
  function Counted(o){ var c=o?new AC(o):new AC(); window.__acOpen++; var close=c.close.bind(c); c.close=function(){ if(!c.__closed){ c.__closed=true; window.__acOpen--; } return close(); }; return c; }
  Counted.prototype=AC.prototype;
  window.AudioContext=Counted; window.webkitAudioContext=Counted;
  window.__micAc=new AC({ sampleRate:48000 });
  window.__micDest=window.__micAc.createMediaStreamDestination();
  var n=window.__micAc.sampleRate*4, b=window.__micAc.createBuffer(1,n,window.__micAc.sampleRate), d=b.getChannelData(0), s=11;
  for(var i=0;i<n;i++){ s=(s*1103515245+12345)&0x7fffffff; d[i]=(s/0x7fffffff*2-1)*0.0031; }
  var bed=window.__micAc.createBufferSource(); bed.buffer=b; bed.loop=true; bed.connect(window.__micDest); bed.start();
  window.__streams=[];
  function keep(st){ window.__streams.push(st); return st; }
  function fakeVideo(){ var cv=document.createElement('canvas'); cv.width=320; cv.height=180; var g=cv.getContext('2d'); g.fillStyle='#2b6cb0'; g.fillRect(0,0,320,180); return cv.captureStream(5); }
  var fake={ getUserMedia:function(c){ if(c&&c.video) return Promise.resolve(keep(fakeVideo())); return Promise.resolve(keep(window.__micDest.stream.clone())); },
    enumerateDevices:function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake', groupId:'g' }]); } };
  try{ Object.defineProperty(navigator,'mediaDevices',{ value:fake, configurable:true }); }catch(e){}
  window.__media=[];
  var play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){ if(window.__media.indexOf(this)<0) window.__media.push(this); return play.apply(this,arguments); };
  // 帧耗时：真实渲染循环里每帧间隔
  window.__frames=[]; var last=0;
  (function loop(t){ if(last) window.__frames.push(t-last); last=t; if(window.__frames.length>2000) window.__frames.splice(0,1000); requestAnimationFrame(loop); })(0);
})();</script>`

let W = 1280, H = 720
const html = buildSpecialWindowPage(SPECIAL_GAMES.map((meta) => ({ meta, cfg: defaultSpecialConfig(meta), code: GAME_CODE[meta.id] || '' })), { ...DEFAULT_SPECIAL_WINDOW, width: W, height: H }, SPECIAL_LAYER_ORDER, assetBase)
  .replace('<div id="stage">', TEST_PRE + '<div id="stage">')
const file = path.join(output, 'special-window.html')
await fs.writeFile(file, html)
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:${W},height:${H},show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false,autoplayPolicy:'no-user-gesture-required'}});win.webContents.setFrameRate(30);win.loadURL('about:blank')});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|play\(\) request was interrupted|NotSupportedError|AbortError/.test(m.text())) errors.push('[console] ' + m.text()) })
let crashed = false
page.on('crash', () => { crashed = true })

let seed = SEED
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const bw = await app.browserWindow(page)
await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
await page.goto(pathToFileURL(file).href)
await page.waitForFunction(() => typeof window.__applyMany === 'function')
const visible = await page.evaluate(() => document.visibilityState)
// 离屏窗口要是报 hidden，真实渲染循环不会跑：用 30Hz 的定时器按同样规矩推帧（只推醒着的玩法）
if (visible !== 'visible') await page.evaluate(() => { setInterval(() => window.__frameStep(33), 33) })
const sample = () => page.evaluate(() => {
  const fr = window.__frames.slice(-300)
  return {
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    ac: window.__acOpen,
    media: (window.__media || []).filter((m) => !m.paused && !m.ended).length,
    mediaTotal: (window.__media || []).length,
    tracks: (window.__streams || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length,
    frame: fr.length ? Math.round(fr.reduce((a, b) => a + b, 0) / fr.length) : 0,
    loaded: window.__loaded().length
  }
})
const gc = () => page.evaluate(async () => { for (let i = 0; i < 3; i++) { if (window.gc) window.gc(); await new Promise((r) => setTimeout(r, 200)) } })
await gc()
const base = await sample()
console.log(`起点（${visible}）：堆 ${base.heap}MB、AudioContext ${base.ac}`)

const fieldsFor = (meta) => Object.fromEntries((meta.fields || []).map((f) => [f.key, pick(f.options.map((o) => o.value))]))
const fire = (list) => page.evaluate((list) => { const hit = document.getElementById('hit'); if (!hit) return; for (const [type, x, y, b] of list) hit.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 3, bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons: b, pointerType: 'mouse' })) }, list)
const sound = (loud) => page.evaluate((loud) => {
  const ac = window.__micAc, SR = ac.sampleRate, n = Math.round(SR * (loud ? 0.5 : 0.12)), a = new Float32Array(n)
  let s = 5
  for (let i = 0; i < n; i++) { const t = i / SR; s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = loud ? Math.tanh(Math.sin(2 * Math.PI * 170 * t) * 6) * 0.9 * Math.min(1, t / 0.04, (0.5 - t) / 0.06) : (s / 0x7fffffff * 2 - 1) * Math.exp(-t / 0.03) * 0.7 }
  const b = ac.createBuffer(1, n, SR); b.copyToChannel(a, 0); const src = ac.createBufferSource(); src.buffer = b; src.connect(window.__micDest); src.start()
}, loud)
const counts = { apply: 0, pointer: 0, wipe: 0, rotate: 0, config: 0, sound: 0 }
const changed = {}   // 长跑里随机改过的设置 {玩法: {参数: 值}}
const samples = []
const t0 = Date.now(), end = t0 + MINUTES * 60_000
let nextSample = t0 + 15_000
while (Date.now() < end && !crashed) {
  const r = rnd()
  try {
    if (r < 0.45) {
      const meta = pick(SPECIAL_GAMES), op = pick(meta.ops).value
      await page.evaluate((c) => window.__apply(c), { game: meta.id, operation: op, count: 1 + Math.floor(rnd() * 20), username: rnd() < 0.7 ? '观众' + Math.floor(rnd() * 99) : '', avatar: '', ...fieldsFor(meta) })
      counts.apply++
    } else if (r < 0.75) {
      const x = rnd() * W, y = rnd() * H, x2 = rnd() * W, y2 = rnd() * H, kind = rnd()
      if (kind < 0.4) await fire([['pointerdown', x, y, 1], ['pointerup', x, y, 0]])
      else if (kind < 0.7) await fire([['pointerdown', x, y, 1], ...Array.from({ length: 8 }, (_, i) => ['pointermove', x + (x2 - x) * (i + 1) / 8, y + (y2 - y) * (i + 1) / 8, 1]), ['pointerup', x2, y2, 0]])
      else await fire(Array.from({ length: 7 }, (_, i) => ['pointermove', x + (x2 - x) * i / 6, y + (y2 - y) * i / 6, 0]))
      counts.pointer++
    } else if (r < 0.82) {
      await sound(rnd() < 0.5); counts.sound++
    } else if (r < 0.86) {
      const meta = pick(SPECIAL_GAMES), p = pick(meta.params)
      if (p) {
        let v = p.def
        // 数值：九成在滑杆常用范围里取，一成取到防爆上限（数值不设上限后 max 动辄 1e6，均匀取几乎全是离谱值）
        if (p.type === 'number') { const lo = p.min ?? 0, hi = rnd() < 0.1 ? (p.max ?? 100) : (p.sliderMax ?? p.max ?? 100); v = lo + rnd() * (hi - lo) }
        else if (p.type === 'toggle') v = rnd() < 0.5
        else if (p.type === 'select') v = pick(p.options).value
        if (p.type === 'number' || p.type === 'toggle' || p.type === 'select') { await page.evaluate(({ id, k, v }) => window.__config({ [k]: v }, id), { id: meta.id, k: p.key, v }); counts.config++; (changed[meta.id] = changed[meta.id] || {})[p.key] = v }
      }
    } else if (r < 0.88) {
      await page.evaluate(() => { if (window.__revealClear) window.__revealClear(); window.__applyMany(window.__loaded().map((g) => ({ game: g, operation: 'clear', count: 1, wipe: true })), '', ''); if (window.__wipe) window.__wipe() })
      counts.wipe++
    } else if (r < 0.885) {
      ;[W, H] = [H, W]
      await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
      counts.rotate++
    }
  } catch (e) { errors.push('[驱动] ' + e.message) }
  await page.waitForTimeout(150)
  if (Date.now() >= nextSample) {
    nextSample += 15_000
    const s = await sample()
    samples.push(s)
    console.log(`  ${Math.round((Date.now() - t0) / 1000)}s：堆 ${s.heap}MB、AudioContext ${s.ac}、在响 ${s.media}/${s.mediaTotal}、音轨 ${s.tracks}、平均帧间隔 ${s.frame}ms、已加载玩法 ${s.loaded}、报错 ${errors.length}`)
  }
}

// 收场：先把随机改过的设置恢复默认（比如计数面板被改成「一直显示」，清屏后面板本来就该留着），再全部清屏 → 等停帧 → GC
let ok = true
const fail = (m) => { ok = false; console.log('FAIL ' + m) }
if (crashed) fail('页面崩溃了')
const pinned = Object.entries(changed).filter(([, c]) => c.statsPanel === 'always' || c.binShow === 'always').map(([id, c]) => `${id}（${Object.entries(c).filter(([k, v]) => v === 'always').map(([k]) => k).join('、')} = 一直显示）`)
if (pinned.length) console.log('长跑里被随机改成「一直显示」的：' + pinned.join('；'))
for (const meta of SPECIAL_GAMES) if (changed[meta.id]) await page.evaluate(({ id, cfg }) => window.__config(cfg, id), { id: meta.id, cfg: defaultSpecialConfig(meta).params })
await page.evaluate(() => { if (window.__revealClear) window.__revealClear(); window.__applyMany(window.__loaded().map((g) => ({ game: g, operation: 'clear', count: 1, wipe: true })), '', ''); if (window.__wipe) window.__wipe() })
await page.waitForTimeout(3000)
await gc()
await page.waitForTimeout(1000)
const fin = await sample()
// 残留按层列出来（哪个玩法、玩法层还是计数面板层、范围），连同那个玩法当时的 debug()，方便定位
const leftBy = await page.evaluate(() => [...document.querySelectorAll('#stage canvas, #hud canvas')].map((c) => {
  const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) if (d[(y * w + x) * 4 + 3] > 8) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y }
  const id = c.getAttribute('data-game') || c.getAttribute('data-hud') || '?'
  let dbg = null
  try { const g = window.__game(id); dbg = g && g.debug ? JSON.stringify(g.debug(), (k, v) => (typeof v === 'function' || (typeof HTMLMediaElement !== 'undefined' && v instanceof HTMLMediaElement)) ? undefined : v).slice(0, 300) : null } catch (e) { dbg = String(e) }
  return { id, hud: c.hasAttribute('data-hud'), n, box: [x0, y0, x1, y1], dbg }
}).filter((r) => r.n > 0))
const left = leftBy.reduce((a, r) => a + r.n, 0)
for (const r of leftBy) console.log(`  残留：${r.id}${r.hud ? '·面板' : ''} ${r.n} 点 @${r.box.join(',')}  状态 ${r.dbg}`)
if (leftBy.length) { const png = await bw.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())); await fs.writeFile(path.join(output, 'left.png'), Buffer.from(png)) }
const responsive = await Promise.race([page.evaluate(() => 1 + 1), new Promise((r) => setTimeout(() => r(0), 5000))])
console.log(`\n收场：堆 ${fin.heap}MB（起点 ${base.heap}MB，峰值 ${Math.max(...samples.map((s) => s.heap), fin.heap)}MB）、AudioContext ${fin.ac}、在响 ${fin.media}、音轨 ${fin.tracks}、画面残留 ${left} 点、页面响应 ${responsive === 2}`)
console.log(`操作：下命令 ${counts.apply}、点拖挥 ${counts.pointer}、拍 / 喊 ${counts.sound}、改设置 ${counts.config}、全部清屏 ${counts.wipe}、切横竖屏 ${counts.rotate}`)
if (errors.length) { fail(`页面报错 ${errors.length} 条`); for (const e of [...new Set(errors)].slice(0, 12)) console.log('  ' + e) }
if (fin.heap > base.heap + 40) fail(`内存没回落：${base.heap}MB → ${fin.heap}MB`)
if (fin.ac > 0) fail(`清屏后还开着 ${fin.ac} 个 AudioContext（麦克风没释放）`)
if (fin.tracks > 0) fail(`清屏后还有 ${fin.tracks} 条麦克风 / 摄像头音轨开着`)
if (fin.media > 0) fail(`清屏后还有 ${fin.media} 个声音在响`)
if (left > 0) fail(`清屏后画面还剩 ${left} 点`)
if (responsive !== 2) fail('页面不响应了')
await app.close().catch(() => {})
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
console.log(ok ? `\nSOAK SPECIAL: PASS（${MINUTES} 分钟）` : '\nSOAK SPECIAL: FAIL')
process.exitCode = ok ? 0 : 1
