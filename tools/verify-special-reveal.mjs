// 特色整蛊盲盒开奖回归（锣 + 「锁链+5」+ AI 配音，逐条播）：直接用 buildSpecialWindowPage 出的直播窗口页面，离屏 Electron 里验：
//   1. 随包的锣和配音能解码、量得出开口位置 / 时长 / 响度增益（人声统一到时间盲盒配音的响度）
//   2. 逐条开奖：第一条锣响时生效，念完 + 停留才轮到下一条；顺序不乱
//   3. 配音还在现念的那条：等它（__revealVoice 补上就开始），等不到 2.5 秒后不念照样开
//   4. 排队上限：超出的直接生效；全部清屏丢掉排着的；关掉开奖画面时排着的立刻生效（一份不丢）
//   5. 画面：锣 + 大字（含自己起名字时的小字）截图到 output/playwright/special-reveal/
// 不启动客户端、不碰用户配置；窗口离屏不可见不聚焦（不抢前台）；整个进程静音、音量也设 0（直播中跑也不出声）。
// 用法：node tools/verify-special-reveal.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/special-reveal')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetDir = path.join(root, 'assets/special-games')
const assetBase = pathToFileURL(assetDir).href.replace(/\/?$/, '/')

const bundle = path.join(output, 'reveal-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, DEFAULT_SPECIAL_REVEAL, defaultSpecialConfig, specialVoiceLine, specialRevealText} from './src/shared/specialGames';
export {buildSpecialWindowPage} from './src/main/special-page';
export {GAME_CODE} from './src/main/special-games';
export {voiceFileName} from './src/main/special-voice-name';`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const { SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, DEFAULT_SPECIAL_REVEAL, defaultSpecialConfig, specialVoiceLine, specialRevealText, buildSpecialWindowPage, GAME_CODE, voiceFileName } =
  createRequire(import.meta.url)(bundle)

const voiceUrl = (line) => pathToFileURL(path.join(assetDir, 'box_voice', voiceFileName(DEFAULT_SPECIAL_REVEAL.voiceName, DEFAULT_SPECIAL_REVEAL.rate, line))).href
const gongUrl = pathToFileURL(path.join(assetDir, 'box_voice', 'gong.mp3')).href
for (const line of ['锁链加5', '鸭子加10', '龙卷风卷走20片']) await fs.access(new URL(voiceUrl(line)))
// 开奖视频用的测试片：黄绿底（和路师傅那批鸭子视频一个底色 #7FFF00）+ 正中一块红方块 + 一段声音，3 秒
const testVideo = path.join(output, 'reveal-test.mp4')
{
  const { execFileSync } = await import('node:child_process')
  execFileSync(path.join(root, 'ffmpeg', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x7FFF00:s=640x480:d=3:r=30,drawbox=x=220:y=160:w=200:h=160:color=red@1:t=fill',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', testVideo])
}

const W = 1280, H = 720
const win = { ...DEFAULT_SPECIAL_WINDOW, width: W, height: H }
// 音量设 0：时间线照常（锣、人声都解码量好，按时长排），只是不出声
const reveal = { ...DEFAULT_SPECIAL_REVEAL, gongUrl, gongVolume: 0, voiceVolume: 0 }
const html = buildSpecialWindowPage(SPECIAL_GAMES.map((meta) => ({ meta, cfg: defaultSpecialConfig(meta), code: GAME_CODE[meta.id] || '' })), win, SPECIAL_LAYER_ORDER, assetBase, reveal)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = () => page.evaluate(() => window.__revealState())
const loaded = () => page.evaluate(() => window.__loaded())
const dbg = (id) => page.evaluate((g) => { const o = window.__game(g); return o && o.debug ? JSON.parse(JSON.stringify(o.debug(), (k, v) => (typeof v === 'function' || (typeof HTMLMediaElement !== 'undefined' && v instanceof HTMLMediaElement)) ? undefined : v)) : null }, id)
const waitFor = async (fn, ms, what) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`等不到：${what}`)
    await sleep(40)
  }
}
const cmd = (game, operation, count) => ({ game, operation, count, username: '测试观众', avatar: '', gift: '' })
const item = (param, game, op, count, extra = {}) => {
  const line = specialVoiceLine(param, count)
  return { text: specialRevealText(param, count), sub: '', line, voice: line ? voiceUrl(line) : '', vid: '', cmds: [cmd(game, op, count)], ...extra }
}
const shot = async (name) => {
  const bw = await app.browserWindow(page)
  const png = await bw.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}

try {
  const bw = await app.browserWindow(page)
  await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => typeof window.__reveal === 'function' && typeof window.__revealState === 'function')

  // ---- 1. 解码 + 量 ----
  const g = await page.evaluate((u) => window.__revealProbe(u, false), gongUrl)
  assert.ok(g && g.off < 0.06 && g.dur > 0.3 && g.dur < 0.7 && g.gain === 1, `锣：${JSON.stringify(g)}`)
  const probes = {}
  for (const line of ['锁链加5', '鸭子加10', '龙卷风卷走20片']) {
    const v = await page.evaluate((u) => window.__revealProbe(u, true), voiceUrl(line))
    assert.ok(v && v.off >= 0 && v.off < 0.4 && v.dur > 0.4 && v.dur < 2.5 && v.gain >= 0.25 && v.gain <= 4 && v.peak * v.gain <= 0.99, `${line}：${JSON.stringify(v)}`)
    probes[line] = v
  }
  ok(`锣 ${g.dur.toFixed(2)}s；配音开口/时长/增益：${Object.entries(probes).map(([k, v]) => `${k} ${v.off.toFixed(2)}s/${v.dur.toFixed(2)}s/×${v.gain.toFixed(2)}`).join('，')}`)

  // ---- 2. 逐条开奖 ----
  const a = item('chain_challenge|add|5', 'chain_challenge', 'add', 5)
  const b = item('catch_duck|add|10', 'catch_duck', 'add', 10)
  const t0 = Date.now()
  await page.evaluate(([items]) => window.__reveal(items, [], '🎁 测试观众的「特色盲盒」×2 开出：锁链特效 +5环、抓鸭子 +10只', ''), [[a, b]])
  const s0 = await state()
  assert.equal(s0.pending, 2)
  assert.equal(await page.evaluate(() => document.getElementById('btx').textContent.includes('开出')), true, '横幅应立刻出来')
  await waitFor(async () => (await loaded()).includes('chain_challenge'), 1500, '第一条生效')
  const tA = Date.now() - t0
  assert.ok(!(await loaded()).includes('catch_duck'), '第二条不该和第一条一起生效')
  const sA = await state()
  assert.equal(sA.current?.text, '锁链+5')
  await shot('reveal-chain')
  await waitFor(async () => (await loaded()).includes('catch_duck'), 6000, '第二条生效')
  const tB = Date.now() - t0
  const expectGap = (DEFAULT_SPECIAL_REVEAL.gapMs + DEFAULT_SPECIAL_REVEAL.holdMs) / 1000 + probes['锁链加5'].dur
  assert.ok((tB - tA) / 1000 > expectGap * 0.8, `第二条来得太早：${tA}ms → ${tB}ms（应至少隔 ${expectGap.toFixed(2)}s）`)
  const chain = await dbg('chain_challenge')
  assert.equal(chain.remaining ?? chain.count ?? 5, 5, `锁链环数：${JSON.stringify(chain)}`)
  ok(`逐条开奖：锁链 ${tA}ms 生效，鸭子 ${tB}ms 生效（隔 ${((tB - tA) / 1000).toFixed(2)}s ≈ 锣后停顿 + 念「锁链加5」+ 停留）`)
  await waitFor(async () => (await state()).pending === 0, 6000, '两条播完')
  ok('播完自动收起，队列清空')

  // ---- 3. 现念的配音 ----
  const c = item('coin_bump|add|20', 'coin_bump', 'add', 20, { voice: '', vid: 'pending-1' })
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [[c]])
  await sleep(400)
  let sc = await state()
  assert.equal(sc.current, null, '配音没到时先等着')
  assert.equal(sc.pending, 1)
  await page.evaluate((u) => window.__revealVoice('pending-1', u), voiceUrl('金币加20'))
  await waitFor(async () => (await loaded()).includes('coin_bump'), 1500, '配音到了就开')
  ok('配音还在现念：先等，补上地址立刻开奖')
  await waitFor(async () => (await state()).pending === 0, 6000, '金币播完')
  const d = item('fruit_slice|add|5', 'fruit_slice', 'add', 5, { voice: '', vid: 'never' })
  const td = Date.now()
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [[d]])
  await waitFor(async () => (await loaded()).includes('fruit_slice'), 4500, '等不到配音也照开')
  const waited = Date.now() - td
  assert.ok(waited >= 2300, `等配音的时间不对：${waited}ms`)
  ok(`配音一直没来：等了 ${waited}ms 后不念照样开奖`)
  await waitFor(async () => (await state()).pending === 0, 4000, '水果播完')

  // ---- 4. 排队上限 / 清屏 / 关开奖 ----
  await page.evaluate(() => window.__revealConfig({ maxQueue: 2 }))
  const many = [
    item('throw_poop|add|3', 'throw_poop', 'add', 3),
    item('catch_bullet|add|5', 'catch_bullet', 'add', 5),
    item('caterpillar|add|3', 'caterpillar', 'add', 3),
    item('mosquito|add|10', 'mosquito', 'add', 10)
  ]
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [many])
  await sleep(60)
  const l4 = await loaded()
  assert.ok(l4.includes('caterpillar') && l4.includes('mosquito'), `超出上限的应直接生效：${l4}`)
  assert.equal((await state()).pending, 2)
  ok('排队上限 2：第 3、4 条直接生效，前 2 条排着开奖')
  await page.evaluate(() => window.__revealClear())
  const s4 = await state()
  assert.equal(s4.pending, 0)
  await sleep(300)
  assert.equal((await state()).current, null)
  ok('全部清屏：排着的开奖丢掉')
  await page.evaluate(() => window.__revealConfig({ maxQueue: 20 }))
  const more = [item('xiaoxin_hey|add|2', 'xiaoxin_hey', 'add', 2), item('leaf_pickup|add|10', 'leaf_pickup', 'add', 10), item('gesture_fly|add|3', 'gesture_fly', 'add', 3)]
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [more])
  await sleep(50)
  await page.evaluate(() => window.__revealConfig({ enabled: false }))
  const l5 = await loaded()
  assert.ok(['xiaoxin_hey', 'leaf_pickup', 'gesture_fly'].every((id) => l5.includes(id)), `关掉开奖画面时排着的应立刻生效：${l5}`)
  assert.equal((await state()).pending, 0)
  ok('关掉开奖画面：排着的 3 条立刻生效，一份不丢')
  await page.evaluate(() => window.__revealConfig({ enabled: true }))

  // ---- 4b. 开奖视频：自动量底色抠掉、第一帧时生效、放完收起；视频坏了也照样生效 ----
  await page.evaluate(() => window.__revealConfig({ enabled: true, maxQueue: 20 }))
  // 先把场上的玩法清掉，截图里视频周围只剩窗口本身的纯绿
  await page.evaluate(() => { for (const id of window.__loaded()) window.__apply({ game: id, operation: 'clear', count: 1 }) })
  await sleep(3000)
  const vItem = item('catch_bullet|add|20', 'catch_bullet', 'add', 20, { line: '', voice: '', video: pathToFileURL(testVideo).href, videoVolume: 0 })
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [[vItem]])
  const vs = await waitFor(async () => { const s = await state(); return s.current?.video && s.current.shown ? s : null }, 5000, '开奖视频出画面')
  const k = vs.current.key
  assert.ok(k && Math.abs(k[0] - 0.5) < 0.08 && k[1] > 0.9 && k[2] < 0.1, `自动量出的底色不对：${JSON.stringify(k)}`)
  assert.ok((await loaded()).includes('catch_bullet'), '开奖视频第一帧时就该生效')
  await sleep(300)
  // 截一张：视频正中是红方块，四角的黄绿底被抠掉、露出窗口本身的纯绿（640×480 的片子放进 1280×720 = 960×720，左右各留 160）
  const px = await (await app.browserWindow(page)).evaluate(async (w) => {
    const img = await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    const { width, height } = img.getSize()
    const bmp = img.toBitmap()
    const at = (x, y) => { const o = (Math.round(y) * width + Math.round(x)) * 4; return [bmp[o + 2], bmp[o + 1], bmp[o]] }
    return { center: at(width / 2, height / 2), corner: at(160 + 30, height - 30), png: Array.from(img.toPNG()) }
  })
  await fs.writeFile(path.join(output, 'reveal-video.png'), Buffer.from(px.png))
  delete px.png
  assert.ok(px.center[0] > 200 && px.center[1] < 60 && px.center[2] < 60, `视频正中应是红方块：${JSON.stringify(px)}`)
  assert.ok(px.corner[0] < 40 && px.corner[1] > 220 && px.corner[2] < 40, `黄绿底应被抠掉、露出窗口纯绿：${JSON.stringify(px)}`)
  await waitFor(async () => (await state()).pending === 0, 6000, '开奖视频放完收起')
  assert.equal((await state()).current, null)
  ok(`开奖视频：自动量出底色 rgb(${k.map((v) => Math.round(v * 255)).join(',')})、抠掉后露出窗口纯绿，红方块照常显示；第一帧时生效、放完自动收起`)
  const bad = item('coin_bump|add|5', 'coin_bump', 'add', 5, { line: '', voice: '', video: pathToFileURL(path.join(output, '不存在.mp4')).href })
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [[bad]])
  await waitFor(async () => (await state()).pending === 0, 6000, '坏视频的开奖收起')
  assert.ok((await loaded()).includes('coin_bump'), '视频放不了也要照样生效')
  ok('开奖视频文件坏了 / 不在了：直接收起，玩法照样生效')

  // ---- 5. 画面截图（自己起名字的事件、几个位置、不画锣） ----
  // 停住页面自己的动画（不然截图拍到的是实时那一帧），每张都画锣响后 0.45 秒那一刻，等两帧合成好再拍
  await page.evaluate(() => { window.__realRaf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = () => 0 })
  const settle = () => page.evaluate(() => new Promise((r) => window.__realRaf(() => window.__realRaf(r))))
  for (const [name, cfgPatch, it] of [
    ['reveal-top-custom', { position: 'top' }, item('throw_poop|add|8', 'throw_poop', 'add', 8, { text: '粑粑雨', sub: '粑粑+8' })],
    ['reveal-center-big', { position: 'center', scale: 150 }, item('leaf_pickup|tornado|20', 'leaf_pickup', 'tornado', 20)],
    ['reveal-topright-nogong', { position: 'top-right', scale: 100, showGong: false }, item('talisman_seal|multiply|2', 'talisman_seal', 'multiply', 2)]
  ]) {
    await page.evaluate((p) => window.__revealConfig(p), { showGong: true, ...cfgPatch })
    await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [[it]])
    await waitFor(async () => (await state()).current?.impact > 0, 2000, '开始开奖')
    await page.evaluate(() => window.__revealDraw(0.45))
    await settle()
    await shot(name)
    await page.evaluate(() => window.__revealClear())
    await sleep(150)
  }
  // 窗口改竖屏：大字跟着缩
  await bw.evaluate((w) => w.setContentSize(720, 1280))
  await sleep(200)
  await page.evaluate((p) => window.__revealConfig(p), { position: 'top', scale: 100, showGong: true })
  await page.evaluate(([items]) => window.__reveal(items, [], '', ''), [[item('big_mosquito|add|3|size=big', 'big_mosquito', 'add', 3)]])
  await waitFor(async () => (await state()).current?.impact > 0, 2000, '竖屏开奖')
  await page.evaluate(() => window.__revealDraw(0.45))
  await settle()
  await shot('reveal-portrait')
  await page.evaluate(() => window.__revealClear())
  ok('截图：上方 / 正中放大 / 右上不画锣 / 竖屏，自己起名字的带小字')

  assert.deepEqual(errors, [], `页面报错：\n${errors.join('\n')}`)
  ok('全程页面无报错')
  console.log(`\n全部通过：${passed} 项（截图在 ${path.relative(root, output)}）`)
} catch (e) {
  console.error('FAIL', e.message)
  await shot('fail').catch(() => undefined)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
