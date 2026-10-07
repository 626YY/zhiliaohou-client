// 特色整蛊「从头玩到结束」回归：每个玩法按主播真实的玩法玩完一轮（在直播窗口上点、拖、挥、对麦克风喊，或等它自己结束），
// 玩完以后画面必须自己干净——不靠「全部清屏」：
//   每层画布（玩法层 + 计数面板层）一个像素不剩、停帧（不一直刷）、没有还在响的声音、麦克风 / 摄像头释放，而且要在限定时间内玩得完。
// 2026-10-07 用户：「顶金币那个，也是顶完了以后不消失」「切水果那个一直切不完啊」「都看看，特色整蛊别再有不好使的了，做完并且验证好」。
// 页面 = 真直播窗口（buildSpecialWindowPage，默认设置），鼠标事件发在 #hit 上（和主播在窗口上操作走同一条路由）；
// 推帧用 __frameStep（和真实渲染循环一样只推醒着的玩法），停了帧以后该做的事（关麦克风之类）没做就测得出来；
// 假麦克风 = 页面里一个 AudioContext 的流（不碰真设备）；离屏窗口不可见不聚焦（不抢前台）、静音。
// 每个玩法连玩两轮（第二轮也得一样玩得完：状态有重置）；加 --portrait 用竖屏 720×1280 再跑（东西别跑到画面外够不着）；
// 加 --rotate 每个玩法玩到一半把窗口从横屏切成竖屏（主播点「一键竖屏」），场上的东西得挪回画面、照样玩得完。
// 两轮之后还有专项场景（EXTRA）：连续送礼排队的也要落、拖出窗口松手不丢、砖块消失后不吞点击、声控拍完关麦、麦克风打不开时点画面破符咒。
// 用法：node tools/verify-special-playthrough.mjs [--portrait | --rotate] [玩法id ...]
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const PORTRAIT = process.argv.includes('--portrait')
const ROTATE = process.argv.includes('--rotate')
const output = path.join(root, 'output/playwright/special-playthrough' + (PORTRAIT ? '-portrait' : ROTATE ? '-rotate' : ''))
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

// 假麦克风 / 摄像头（记下发出去的流）+ 冻结 rAF（只靠 __step 推帧）+ 记下放过的音视频
const TEST_PRE = `<script>(function(){
  window.__micAc=new AudioContext({ sampleRate:48000 });
  window.__micDest=window.__micAc.createMediaStreamDestination();
  var n=window.__micAc.sampleRate*4, b=window.__micAc.createBuffer(1,n,window.__micAc.sampleRate), d=b.getChannelData(0), s=11;
  for(var i=0;i<n;i++){ s=(s*1103515245+12345)&0x7fffffff; d[i]=(s/0x7fffffff*2-1)*0.0031; }
  var bed=window.__micAc.createBufferSource(); bed.buffer=b; bed.loop=true; bed.connect(window.__micDest); bed.start();
  window.__streams=[];
  function keep(st){ window.__streams.push(st); return st; }
  function fakeVideo(){ var cv=document.createElement('canvas'); cv.width=320; cv.height=180; var g=cv.getContext('2d'); g.fillStyle='#2b6cb0'; g.fillRect(0,0,320,180); return cv.captureStream(5); }
  // window.__noMic = true 时麦克风打不开（没插 / 被拒）
  var fake={ getUserMedia:function(c){ if(c&&c.video) return Promise.resolve(keep(fakeVideo())); if(window.__noMic) return Promise.reject(new Error('NotAllowedError')); return Promise.resolve(keep(window.__micDest.stream.clone())); },
    enumerateDevices:function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake', groupId:'g' }]); } };
  try{ Object.defineProperty(navigator,'mediaDevices',{ value:fake, configurable:true }); }catch(e){}
  window.__realRaf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=function(){ return 0; };
  window.__media=[];
  var play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){ if(window.__media.indexOf(this)<0) window.__media.push(this); return play.apply(this,arguments); };
})();</script>`

let W = PORTRAIT ? 720 : 1280, H = PORTRAIT ? 1280 : 720
const W0 = W, H0 = H
let rotated = false
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
  args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|play\(\) request was interrupted|NotSupportedError/.test(m.text())) errors.push('[console] ' + m.text()) })

let passed = 0, failed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const bad = (m) => { failed++; console.log('FAIL ' + m) }

// —— 小工具 ——
const apply = (cmd) => page.evaluate((c) => window.__apply(c), cmd)
const config = (next, id) => page.evaluate(({ next, id }) => window.__config(next, id), { next, id })
const dbg = (id) => page.evaluate((g) => { const o = window.__game(g); return o && o.debug ? JSON.parse(JSON.stringify(o.debug(), (k, v) => (typeof v === 'function' || (typeof HTMLMediaElement !== 'undefined' && v instanceof HTMLMediaElement)) ? undefined : v)) : null }, id)
const step = (n, dt = 40) => page.evaluate(({ n, dt }) => { let a = false; for (let i = 0; i < n; i++) a = window.__frameStep(dt) || a; return a }, { n, dt })
const realWait = (ms) => page.evaluate((t) => new Promise((r) => { const iv = setInterval(() => window.__frameStep(40), 40); setTimeout(() => { clearInterval(iv); r() }, t) }), ms)
// #hit 上的鼠标：click = 按下抬起；drag = 按住拖过去；swipe = 不按住快速划过
const fire = (list) => page.evaluate((list) => {
  const hit = document.getElementById('hit')
  for (const [type, x, y, buttons] of list) hit.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 5, bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons, pointerType: 'mouse' }))
}, list)
const click = (x, y) => fire([['pointerdown', x, y, 1], ['pointerup', x, y, 0]])
const drag = (x0, y0, x1, y1, n = 10) => fire([['pointerdown', x0, y0, 1], ...Array.from({ length: n }, (_, i) => ['pointermove', x0 + (x1 - x0) * (i + 1) / n, y0 + (y1 - y0) * (i + 1) / n, 1]), ['pointerup', x1, y1, 0]])
const swipe = (x0, y0, x1, y1, n = 6) => fire(Array.from({ length: n + 1 }, (_, i) => ['pointermove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 0]))
const inside = ([x, y]) => x > 20 && x < W - 20 && y > 20 && y < H - 20
// 往假麦克风里放 count 下「喊到快爆音」，放的同时按实时推帧
const roar = (count, gapMs) => page.evaluate(async ({ count, gapMs }) => {
  const ac = window.__micAc
  if (ac.state !== 'running') await ac.resume()
  const SR = ac.sampleRate, dur = 0.5, n = Math.round(SR * dur)
  for (let k = 0; k < count; k++) {
    const a = new Float32Array(n)
    for (let i = 0; i < n; i++) { const t = i / SR; let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 170 * h * t + h) / h; a[i] = Math.tanh(v * 6) * 0.95 * Math.max(0, Math.min(1, t / 0.04, (dur - t) / 0.06)) }
    const b = ac.createBuffer(1, n, SR); b.copyToChannel(a, 0)
    const s = ac.createBufferSource(); s.buffer = b; s.connect(window.__micDest); s.start(ac.currentTime + 0.15 + k * gapMs / 1000)
  }
  const ms = 150 + count * gapMs + 700
  await new Promise((r) => { const iv = setInterval(() => window.__frameStep(40), 40); setTimeout(() => { clearInterval(iv); r() }, ms) })
}, { count, gapMs })
// 每层画布上不透明像素（隔一取一）
const residue = () => page.evaluate(() => [...document.querySelectorAll('#stage canvas, #hud canvas')].map((c) => {
  const w = c.width, h = c.height
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
  if (w && h) {
    const d = c.getContext('2d').getImageData(0, 0, w, h).data
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 8) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y }
  }
  return { id: c.getAttribute('data-game') || c.getAttribute('data-hud') || '?', hud: c.hasAttribute('data-hud'), n, box: n ? [x0, y0, x1, y1] : null }
}).filter((r) => r.n > 0))
// 停不下来的声音：循环的，或者等一次性音效自然放完（最多 8 秒）以后还在响的
// （一轮被推帧压缩到一两秒内玩完，玩的时候触发的音效在真实时间里还没放完，属正常）
const playing = () => page.evaluate(() => (window.__media || []).filter((m) => !m.paused && !m.ended).map((m) => ({ src: (m.currentSrc || m.src || (m.srcObject ? '(流)' : '?')).split('/').slice(-2).join('/'), loop: !!m.loop })))
async function sounding() {
  for (let i = 0; i < 32; i++) {
    const list = await playing()
    if (!list.length || list.some((m) => m.loop)) return list.map((m) => m.src + (m.loop ? '（循环）' : ''))
    await realWait(250)
  }
  return (await playing()).map((m) => m.src + '（8 秒后还在响）')
}
const liveTracks = () => page.evaluate(() => (window.__streams || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').map((t) => t.kind))
const shot = async (name) => {
  const bw = await app.browserWindow(page)
  await page.evaluate(() => new Promise((r) => window.__realRaf(() => window.__realRaf(r))))
  const png = await bw.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}
// 一直玩到 done(d) 成立：每轮先推几帧，再让 act(d) 出一手；超过 maxRounds 判「玩不完」
async function playUntil(id, done, act, maxRounds = 400, framesPer = 2) {
  for (let i = 0; i < maxRounds; i++) {
    // --rotate：玩到一半切竖屏（每个玩法只切一次）
    if (ROTATE && !rotated && i === 6) { rotated = true; await setSize(H, W) }
    await step(framesPer)
    const d = await dbg(id)
    if (done(d)) return { d, rounds: i }
    if (act) await act(d)
  }
  throw new Error(`玩不完：${JSON.stringify(await dbg(id)).slice(0, 300)}`)
}
const firstHit = (d) => (d.hits || []).find((h) => inside(h))
async function setSize(w, h) {
  W = w; H = h
  const bw = await app.browserWindow(page)
  await bw.evaluate((x, s) => x.setContentSize(s.w, s.h), { w, h })
  await page.waitForFunction(({ w, h }) => innerWidth === w && innerHeight === h, { w, h })
  await step(2)
}
// 往假麦克风里放 count 下真实的「啪」（素材 slap.mp3，−4 dB），放的同时按实时推帧
const slapUrl = pathToFileURL(path.join(root, 'assets/special-games/big_mosquito/slap.mp3')).href
const slaps = (count, gapMs) => page.evaluate(async ({ count, gapMs, slapUrl }) => {
  const ac = window.__micAc
  if (ac.state !== 'running') await ac.resume()
  if (!window.__slap) window.__slap = await ac.decodeAudioData(await (await fetch(slapUrl)).arrayBuffer())
  const ch = window.__slap.getChannelData(0), n = Math.min(ch.length, Math.round(ac.sampleRate * 0.6))
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(ch[i]))
  for (let k = 0; k < count; k++) {
    const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = ch[i] / pk * Math.pow(10, -4 / 20)
    const b = ac.createBuffer(1, n, ac.sampleRate); b.copyToChannel(a, 0)
    const s = ac.createBufferSource(); s.buffer = b; s.connect(window.__micDest); s.start(ac.currentTime + 0.15 + k * gapMs / 1000)
  }
  const ms = 150 + count * gapMs + 700
  await new Promise((r) => { const iv = setInterval(() => window.__frameStep(40), 40); setTimeout(() => { clearInterval(iv); r() }, ms) })
}, { count, gapMs, slapUrl })

// —— 每个玩法怎么玩完一轮（返回一句说明）——
const PLAY = {
  async chain_challenge(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    await playUntil(id, (d) => d.phase === 'sustain', null, 80, 5)
    const r = await playUntil(id, (d) => d.phase !== 'sustain', async () => { await click(W * 0.06, H * 0.92) }, 40, 3)
    return `锁链 5 环，点空白处 ${r.rounds} 下挣开`
  },
  async catch_duck(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => d.count === 0 && d.pending === 0, async (d) => { const h = firstHit(d); if (h) await click(h[0], h[1]) })
    return `5 只鸭子点着抓完（${r.d.caught} 只）`
  },
  async throw_poop(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => d.count === 0 && d.pending === 0, async (d) => { const h = firstHit(d); if (h) await click(h[0], h[1]) })
    return `5 坨粑粑点着清完（${r.d.caught}）`
  },
  async throw_trash(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => d.count === 0 && d.pending === 0, async (d) => { const h = firstHit(d); if (h) await drag(h[0], h[1], d.drop[0], d.drop[1]) })
    return `5 件垃圾拖进桶（${r.d.collected}）`
  },
  async catch_bullet(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => d.count === 0 && d.pending === 0 && !d.flying, async (d) => { const h = firstHit(d); if (h) await click(h[0], h[1]) })
    return `5 颗子弹点着抓完（${r.d.caught}）`
  },
  async caterpillar(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => d.count === 0 && d.pending === 0, async (d) => { const h = firstHit(d); if (h) await click(h[0], h[1]) })
    return `5 条毛毛虫点着抓完（${r.d.caught}）`
  },
  async xiaoxin_hey(id) {
    await apply({ game: id, operation: 'add', count: 3, username: '测试' })
    // 先不碰它，看会不会自己结束；不会再点
    let selfEnd = false
    for (let i = 0; i < 300; i++) { await step(5); const d = await dbg(id); if (d.count === 0 && d.pending === 0) { selfEnd = true; break } }
    if (!selfEnd) await playUntil(id, (d) => d.count === 0 && d.pending === 0, async (d) => { const h = firstHit(d); if (h) await click(h[0], h[1]) })
    return selfEnd ? '3 个小新自己演完退场' : '3 个小新点掉'
  },
  async fan_call(id) {
    await apply({ game: id, operation: 'show', count: 1, username: '测试' })
    await step(10)
    let d = await dbg(id)
    await click(d.hangupAt[0], d.hangupAt[1])
    await playUntil(id, (x) => !x.current && x.queued === 0, null, 200, 5)
    // 第二通：接听，等它自己放完
    await apply({ game: id, operation: 'show', count: 1, username: '测试二' })
    await step(10)
    d = await dbg(id)
    await click(d.answerAt[0], d.answerAt[1])
    await realWait(300)
    const media = await page.evaluate((g) => (window.__game(g).debug().media || []).filter(Boolean).map((m) => ({ d: m.duration, src: (m.currentSrc || '').split('/').pop() })), id)
    // 接听语音快进到结尾（不白等）
    await page.evaluate((g) => { for (const m of (window.__game(g).debug().media || [])) if (m && m.duration > 1) m.currentTime = m.duration - 0.3 }, id)
    await playUntil(id, (x) => !x.current && x.queued === 0, async () => { await realWait(200) }, 200, 5)
    return `挂断一通、接听一通（语音 ${media.map((m) => Math.round(m.d) + 's').join('/') || '无'}）都收掉`
  },
  async fan_video_call(id) {
    await apply({ game: id, operation: 'show', count: 1, username: '测试' })
    await step(10)
    let d = await dbg(id)
    await click(d.hangupAt[0], d.hangupAt[1])
    await playUntil(id, (x) => !x.current && x.queued === 0, null, 200, 5)
    await apply({ game: id, operation: 'show', count: 1, username: '测试二' })
    await step(10)
    d = await dbg(id)
    await click(d.answerAt[0], d.answerAt[1])
    await realWait(800)
    await page.evaluate((g) => { for (const m of (window.__game(g).debug().media || [])) if (m && m.duration > 1) m.currentTime = m.duration - 0.3 }, id)
    await playUntil(id, (x) => !x.current && x.queued === 0, async () => { await realWait(200) }, 300, 5)
    return '挂断一通、接听一通（视频放完）都收掉'
  },
  async talisman_seal(id) {
    await apply({ game: id, operation: 'add', count: 3, username: '测试' })
    await playUntil(id, (d) => d.phase === 'sustain', null, 80, 5)
    await realWait(800)   // 麦克风打开
    for (let i = 0; i < 6; i++) { await roar(1, 700); const d = await dbg(id); if (d.phase !== 'sustain' && d.phase !== 'locking') break }
    const d = await dbg(id)
    if (d.phase === 'sustain') throw new Error('喊了 6 声还没破：' + JSON.stringify(d))
    return '3 点封印，对麦克风喊破'
  },
  async mosquito(id) {
    await apply({ game: id, operation: 'add', count: 10, username: '测试' })
    await realWait(600)
    const r = await playUntil(id, (d) => d.alive === 0 && d.pending === 0, async (d) => { const h = (d.hits || []).find(inside); if (h) await click(h[0], h[1]) }, 400, 1)
    return `10 只蚊子点着拍完（${r.rounds} 手）`
  },
  async big_mosquito(id) { return swatAll(id) },
  async gesture_fly(id) { return swatAll(id) },
  async fruit_slice(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => d.queued === 0 && d.whole.length === 0, async (d) => {
      const f = d.whole.find((w) => inside(w))
      if (f) await swipe(f[0] - 90, f[1] - 25, f[0] + 90, f[1] + 25)
    }, 600, 1)
    return `5 个水果挥着切（切开 ${r.d.sliced}、漏掉不再抛 ${r.d.dropped}）`
  },
  async coin_bump(id) {
    // 点砖块顶到空为止（金币随机弹，落回来挡在砖块上时这一下会变成收金币，所以不按固定次数点）
    const bumpAll = () => playUntil(id, (x) => x.remaining === 0, async (x) => { await click(x.brickAt[0], x.brickAt[1]) }, 60, 8)
    await apply({ game: id, operation: 'add', count: 3, username: '测试' })
    await step(10)
    let d = await dbg(id)
    await bumpAll()
    // 第一轮：等金币落地，点着收走
    await playUntil(id, (x) => x.coins === 0 && x.remaining === 0, async (x) => { const h = (x.hits || []).find(inside); if (h) await click(h[0], h[1]) }, 300, 3)
    // 第二轮：顶完不收，等落地金币自己收走（停留时间调成 3 秒省等待；按真实时间算，竖屏落得远、落定晚，多留余量）
    await config({ coinStaySec: 3 }, id)
    await apply({ game: id, operation: 'add', count: 2, username: '测试' })
    await step(10)
    await bumpAll()
    await step(60)
    await realWait(6000)
    const x = await dbg(id)
    await config({ coinStaySec: 8 }, id)
    if (x.coins !== 0 || x.brick) throw new Error('落地金币没自动收走 / 砖块没消失：' + JSON.stringify(x))
    return '顶 3 枚点着收走；再顶 2 枚不收，落地停够时间自己收走，砖块顶空就消失'
  },
  async leaf_pickup(id) {
    await apply({ game: id, operation: 'add', count: 5, username: '测试' })
    const r = await playUntil(id, (d) => !d.roundActive && d.remaining === 0 && d.field === 0 && d.flying === 0, async (d) => { const h = firstHit(d); if (h) await click(h[0], h[1]) }, 400, 3)
    return `5 片叶子点着扫进桶（${r.d.cleared}）`
  },
  async music_ball(id) {
    await apply({ game: id, operation: 'start', count: 1, username: '测试' })
    await playUntil(id, (d) => d.state === 'playing', async () => { await realWait(200) }, 100, 2)
    await realWait(1500)
    // 快进到歌曲结尾，看它自己收场
    await page.evaluate((g) => { for (const m of (window.__game(g).debug().media || [])) if (m && m.duration > 3) m.currentTime = m.duration - 1.5 }, id)
    const r = await playUntil(id, (d) => d.state !== 'playing' && d.state !== 'loading', async () => { await realWait(250) }, 120, 2)
    return `音乐球放到结尾自己收场（${r.d.state}）`
  }
}
// —— 专项场景：两轮正常玩完以后再跑，最后同样要画面全空、停帧、不响、设备释放 ——
const EXTRA = {
  async catch_duck(id) {
    // 场上留一只不抓，每半秒来一份礼物：排队的也得在 1.2 秒一批的节奏里落下来（以前一直不落）
    await apply({ game: id, operation: 'add', count: 1, username: '测试' })
    await playUntil(id, (d) => d.count === 1 && d.pending === 0, null, 100, 5)
    // 1.2 秒一批：礼物不停时排队里最多是最近 1 秒多来的两三只；以前每来一份都清零计时，8 份会全卡在排队里
    for (let i = 0; i < 8; i++) { await apply({ game: id, operation: 'add', count: 1, username: '测试' }); await realWait(500) }
    const d = await dbg(id)
    if (d.pending > 3) throw new Error('连续送礼时排队的鸭子不落：' + JSON.stringify({ pending: d.pending, count: d.count }))
    await playUntil(id, (x) => x.count === 0 && x.pending === 0, async (x) => { const h = firstHit(x); if (h) await click(h[0], h[1]) })
    return '连续送礼（每半秒一份）时排队的鸭子照样落下来'
  },
  async throw_trash(id) {
    // 拖到窗口外松手：垃圾停在窗口边上，还能拖进桶（以前留在窗外，桶永远不消失）
    await apply({ game: id, operation: 'add', count: 1, username: '测试' })
    let d = (await playUntil(id, (x) => (x.hits || []).some(inside), null, 100, 5)).d
    const h = firstHit(d)
    await drag(h[0], h[1], -300, -300)
    d = await dbg(id)
    const out = (d.hits || []).filter((x) => x[0] < 0 || x[1] < 0 || x[0] > W || x[1] > H)
    if (out.length) throw new Error('拖出窗口松手，垃圾留在窗外：' + JSON.stringify(d.hits))
    await playUntil(id, (x) => x.count === 0 && x.pending === 0, async (x) => { const g = firstHit(x); if (g) await drag(g[0], g[1], x.drop[0], x.drop[1]) })
    return '拖到窗口外松手，垃圾停在边上，再拖进桶'
  },
  async coin_bump(id) {
    // 砖块顶空消失后，屏幕中间那块不能再接住点击（不然锁链在那儿点不开、下层的东西点不到）
    const d = await dbg(id)
    const took = await page.evaluate(({ id, x, y }) => window.__game(id).pointer('down', x, y) === true, { id, x: d.brickAt[0], y: d.brickAt[1] })
    if (took) throw new Error('砖块已经消失，中间的点击还是被它接住了')
    return '砖块消失后中间不再吞点击'
  },
  async big_mosquito(id) {
    // 切到拍手声控：对假麦克风拍到打完，打完麦克风要释放（以前一直开着）
    await config({ controlMode: 'clap' }, id)
    await apply({ game: id, operation: 'add', count: 2, size: 'small', username: '测试' })
    await step(10); await realWait(900)
    for (let i = 0; i < 8; i++) { await slaps(1, 600); const x = await dbg(id); if (x.alive === 0 && x.pending === 0) break }
    const x = await dbg(id)
    if (x.alive !== 0) throw new Error('拍手声控拍了 8 下还没打完：' + JSON.stringify({ alive: x.alive, hp: x.hpNow }))
    await config({ controlMode: 'mouse' }, id)
    return '拍手声控：对麦克风拍完 2 只'
  },
  async music_ball(id) {
    // 播放中又点歌：排队，这首放完接着放，放完再收场（以前每次从头重放，礼物一密一首歌永远放不完）
    await apply({ game: id, operation: 'start', count: 1, username: '测试' })
    await playUntil(id, (d) => d.state === 'playing', async () => { await realWait(200) }, 100, 2)
    await apply({ game: id, operation: 'start', count: 1, username: '测试二' })
    const d = await dbg(id)
    if (d.encore !== 1 || d.state !== 'playing') throw new Error('播放中又点歌没排队：' + JSON.stringify({ s: d.state, e: d.encore }))
    const ff = () => page.evaluate((g) => { for (const m of (window.__game(g).debug().media || [])) if (m && m.duration > 3) m.currentTime = m.duration - 1.5 }, id)
    await realWait(800); await ff()
    await playUntil(id, (x) => x.encore === 0 && x.state === 'playing', async () => { await realWait(250) }, 160, 2)
    await realWait(800); await ff()
    await playUntil(id, (x) => x.state === 'idle', async () => { await realWait(250) }, 160, 2)
    return '播放中又点一首：排队，第一首放完接着放第二首，放完收场'
  },
  async talisman_seal(id) {
    // 麦克风打不开：提示可以点画面，点一下破一点，点完碎裂收场
    await page.evaluate(() => { window.__noMic = true })
    await apply({ game: id, operation: 'add', count: 3, username: '测试' })
    let d = (await playUntil(id, (x) => x.phase === 'sustain' && x.micKind === 'error', async () => { await realWait(100) }, 80, 5)).d
    if (!/点/.test(d.micState)) throw new Error('麦克风打不开时没提示可以点：' + d.micState)
    await playUntil(id, (x) => x.phase !== 'sustain' && x.phase !== 'locking', async () => { await click(W * 0.5, H * 0.5) }, 30, 3)
    await page.evaluate(() => { window.__noMic = false })
    return '麦克风打不开时提示「' + d.micState + '」，点画面破封'
  }
}
async function swatAll(id) {
  await apply({ game: id, operation: 'add', count: 3, username: '测试' })
  await step(20)
  const r = await playUntil(id, (d) => d.alive === 0 && d.pending === 0, async (d) => {
    const h = (d.hits || []).find(inside)
    if (h) { await swipe(h[0] - 120, h[1] - 30, h[0] + 120, h[1] + 30, 8); await step(3) }
  }, 400, 2)
  return `3 只挥着拍完（${r.rounds} 下）`
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
try {
  const bw = await app.browserWindow(page)
  await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
  for (const meta of SPECIAL_GAMES) {
    if (only.length && !only.includes(meta.id)) continue
    const fn = PLAY[meta.id]
    if (!fn) { bad(`${meta.name}（${meta.id}）：没写玩完流程`); continue }
    await page.goto(pathToFileURL(file).href)
    await page.waitForFunction(() => typeof window.__applyMany === 'function' && typeof window.__game === 'function')
    if (ROTATE) { rotated = false; await setSize(W0, H0) }
    const rounds = EXTRA[meta.id] ? [1, 2, 'extra'] : [1, 2]
    for (const round of rounds) {
    const t0 = Date.now()
    let note = ''
    try {
      note = await (round === 'extra' ? EXTRA[meta.id](meta.id) : fn(meta.id))
    } catch (e) {
      await shot('fail-' + meta.id + '-' + round).catch(() => {})
      bad(`${meta.name}（${meta.id}）第 ${round} 轮：${e.message}`)
      break
    }
    // 玩完：推到停帧（动画放完），再查画面 / 声音 / 设备
    let idle = -1
    for (let i = 0; i < 400; i++) { if (!(await step(1, 40))) { idle = i; break } }
    await realWait(2500)
    await step(2)
    const left = await residue()
    const snd = await sounding()
    const tracks = await liveTracks()
    const problems = []
    if (idle < 0) problems.push('停不了帧（一直在刷）')
    if (left.length) problems.push(`画面还剩 ${left.map((r) => `${r.id}${r.hud ? '·面板' : ''} ${r.n}点 @${r.box.join(',')}`).join('；')}`)
    if (snd.length) problems.push(`还在响 ${snd.join('、')}`)
    if (tracks.length) problems.push(`${tracks.join('、')} 没释放`)
    if (problems.length) { await shot('left-' + meta.id + '-' + round); bad(`${meta.name}（${meta.id}）第 ${round} 轮玩完：${problems.join('；')}（${note}）`); break }
    ok(`${meta.name}（${meta.id}）第 ${round} 轮：${note}；玩完画面全空、停帧、不响、设备释放（${((Date.now() - t0) / 1000).toFixed(1)}s）`)
    }
  }
} catch (e) {
  bad(String(e && e.stack || e))
} finally {
  await app.close().catch(() => {})
}
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
if (errors.length) { console.log('\n页面错误：'); for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e) }
console.log(`\nSPECIAL PLAYTHROUGH: ${passed} PASS, ${failed} FAIL${errors.length ? `，页面错误 ${errors.length}` : ''}  截图：${output}`)
if (failed || errors.length) process.exitCode = 1
