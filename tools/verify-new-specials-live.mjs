// 真实客户端验收：新玩法「拆炸弹」「礼物拔河」真正能用（2026-10-08 用户：「你好好设计，并且验证真正能够使用」）。
// 完整当前构建（真实登录 / 礼物规则 / 主进程 / 特色整蛊窗口），独立资料目录、隐藏窗口、静音，不抢前台：
//   1. 建礼物规则：嘉年华 → 拆炸弹（礼物炸弹）；小心心 → 礼物拔河 +3；
//   2. 模拟送礼（和真礼物走同一条规则匹配链路）→「特色整蛊」窗口自动打开，炸弹 / 拔河真的出现；
//   3. 用 Chromium 真实鼠标输入事件（webContents.sendInputEvent，不是页面里造的事件）在直播窗口上剪线、狂点、按住擦；
//   4. 剪对拆弹成功；观众减时引爆后满屏黑灰按住擦干净；拔河主播狂点赢、观众拉满主播挨砸再擦干净；
//   5. 全部清屏后窗口空闲。
// 用法：node tools/verify-new-specials-live.mjs   （先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/new-specials-live')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--mute-audio'], cwd: root, env })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let passed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const api = (fn, arg) => page.evaluate(fn, arg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TITLE = '特色整蛊'
// 隐藏窗口拿不到正常的屏幕刷新节拍（正式运行时直播窗口在屏幕上、满帧跑），等待时按真实时间替它推帧：
// 送礼、规则、窗口、鼠标输入仍全部走真实链路，只是玩法时钟由这里驱动
let pumpAt = Date.now()
async function pump() {
  const now = Date.now(), ms = Math.min(400, now - pumpAt); pumpAt = now
  const n = Math.max(1, Math.round(ms / 33))
  await js(`(function(){ if(window.__frameStep) for(var i=0;i<${n};i++) window.__frameStep(33) })()`)
}
async function until(fn, what, timeout = 15_000) {
  const end = Date.now() + timeout
  for (;;) {
    await pump()
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('等待超时：' + what)
    await sleep(100)
  }
}
const js = (script) => app.evaluate(async ({ BrowserWindow }, a) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === a.title)
  if (!w) return { missing: true }
  return { value: await w.webContents.executeJavaScript(a.script) }
}, { title: TITLE, script })
const dbg = async (id) => (await js(`(function(){ var g=window.__game&&window.__game(${JSON.stringify(id)}); return g&&g.debug?JSON.parse(JSON.stringify(g.debug())):null })()`)).value
// 真实鼠标输入：发给直播窗口的 webContents（走 Chromium 输入管线 → #hit 的 pointer 事件 → 玩法）
const mouse = (events) => app.evaluate(({ BrowserWindow }, a) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === a.title)
  for (const e of a.events) w.webContents.sendInputEvent(e)
}, { title: TITLE, events })
const click = (x, y) => mouse([
  { type: 'mouseMove', x: Math.round(x), y: Math.round(y) },
  { type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 },
  { type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
])
// 按住来回擦：像真人那样一笔一笔（每笔按下 → 拖到下一个拐点 → 松开），之字形扫过整块
const rub = async (h) => {
  const [cx, cy, sz] = h
  const pts = []
  for (let k = 0; k <= 12; k++) pts.push([Math.round(cx - sz * 0.46 + sz * 0.92 * (k % 2)), Math.round(cy - sz * 0.46 + sz * 0.92 * k / 12)])
  for (let k = 0; k < 12; k++) {
    const [a, b] = [pts[k], pts[k + 1]]
    await mouse([
      { type: 'mouseMove', x: a[0], y: a[1] },
      { type: 'mouseDown', x: a[0], y: a[1], button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: Math.round((a[0] + b[0]) / 2), y: Math.round((a[1] + b[1]) / 2), button: 'left', modifiers: ['leftButtonDown'] },
      { type: 'mouseMove', x: b[0], y: b[1], button: 'left', modifiers: ['leftButtonDown'] },
      { type: 'mouseUp', x: b[0], y: b[1], button: 'left', clickCount: 1 }
    ])
  }
}
async function shot(name) {
  const png = await app.evaluate(async ({ BrowserWindow }, a) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === a.title)
    return Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
  }, { title: TITLE })
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(png))
}

try {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 20_000 })
  const login = await api(async () => {
    await window.api.register('new_specials_live', 'Fixture123!', '新玩法验收')
    const r = await window.api.login('new_specials_live', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return r
  })
  assert.equal(login.ok, true, login.error)
  await page.reload({ waitUntil: 'domcontentloaded' })   // 引导已看过：刷新后进主界面
  await page.waitForFunction(() => Boolean(window.api?.specialState), null, { timeout: 20_000 })
  await sleep(1500)
  // 开奖画面关掉：礼物直接生效（不等敲锣念完），验收更快
  await api(() => window.api.specialRevealConfigure({ enabled: false }))
  const base = { group: '验收', triggerType: 'gift', actionType: 'command', commandCmd: 'special-play', times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true }
  const r1 = await api((r) => window.api.entertainmentRuleAdd(r), { ...base, id: '', name: '嘉年华扔炸弹', giftName: '嘉年华', commandParam: 'bomb_defuse|add|1|kind=gift' })
  const r2 = await api((r) => window.api.entertainmentRuleAdd(r), { ...base, id: '', name: '小心心拔河', giftName: '小心心', commandParam: 'tug_of_war|add|3' })
  assert.ok(r1.ok && r2.ok, JSON.stringify([r1, r2]))
  ok('建了两条礼物规则：嘉年华 → 拆炸弹（礼物炸弹），小心心 → 礼物拔河 +3')

  // —— 拆炸弹：送礼 → 窗口自动开 → 炸弹落稳 → 真实鼠标剪对 ——
  await api(() => window.api.connectorSimulate('礼物: 嘉年华 ×1  by 爱吃西瓜的知了'))
  let d = await until(async () => { const x = await dbg('bomb_defuse'); return x && x.phase === 'armed' ? x : null }, '送礼后炸弹落稳', 20_000)
  assert.equal(d.kind, 'gift', '规则里选的礼物炸弹')
  const win = await app.evaluate(({ BrowserWindow }, t) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === t); return w ? { visible: w.isVisible(), focused: w.isFocused(), size: w.getContentSize() } : null }, TITLE)
  ok(`模拟送礼「嘉年华×1」→「特色整蛊」窗口自动打开（${win.size.join('×')}），礼物炸弹落稳，${d.wires.length} 根线`)
  await shot('01-bomb-armed')
  const right = d.wires.find((w) => w[2])
  await click(right[0], right[1])
  d = await until(async () => { const x = await dbg('bomb_defuse'); return x && x.phase === 'cut' ? x : null }, '剪下去先停顿', 5000)
  await shot('02-bomb-suspense')
  d = await until(async () => { const x = await dbg('bomb_defuse'); return x && x.phase === 'ok' ? x : null }, '停顿后揭晓拆弹成功', 8000)
  ok('真实鼠标点对的那根线：先停顿（心跳 + 问号）再揭晓「拆出惊喜！」')
  await shot('03-bomb-defused')
  await until(async () => { const x = await dbg('bomb_defuse'); return x && !x.phase ? x : null }, '拆完收场', 8000)

  // —— 再扔一颗：观众送礼减时引爆 → 满屏黑灰 → 真实鼠标按住擦干净 ——
  await api(() => window.api.connectorSimulate('礼物: 嘉年华 ×1  by 路过的小猴'))
  d = await until(async () => { const x = await dbg('bomb_defuse'); return x && x.phase === 'armed' ? x : null }, '第二颗落稳', 20_000)
  await api(() => window.api.entertainmentCommand('special-play', 'bomb_defuse|hasten|60'))
  d = await until(async () => { const x = await dbg('bomb_defuse'); return x && x.exploded >= 1 && x.splats > 0 ? x : null }, '减时引爆', 8000)
  await shot('04-bomb-boom')
  const n0 = d.splats
  for (let i = 0; i < 40; i++) {
    const x = await dbg('bomb_defuse')
    if (!x.splats) break
    await rub(x.hits[0])
    await sleep(150); await pump()
  }
  d = await until(async () => { const x = await dbg('bomb_defuse'); return x && x.splats === 0 ? x : null }, '黑灰擦干净', 10_000)
  ok(`观众减时引爆，${n0} 块黑灰用真实鼠标按住来回擦干净`)

  // —— 礼物拔河：送礼开局 → 真实鼠标狂点赢 ——
  await api(() => window.api.connectorSimulate('礼物: 小心心 ×1  by 爱吃西瓜的知了'))
  d = await until(async () => { const x = await dbg('tug_of_war'); return x && x.round && !x.round.result ? x : null }, '送礼开一局拔河', 20_000)
  assert.ok(d.round.p < 0 && d.round.vp === 3, `观众拉 3 下：${JSON.stringify(d.round)}`)
  await shot('05-tug-start')
  for (let i = 0; i < 120; i++) {
    const x = await dbg('tug_of_war')
    if (x.round && x.round.result) break
    await click(640, 220)
    await pump()
  }
  d = await until(async () => { const x = await dbg('tug_of_war'); return x && x.round && x.round.result ? x : null }, '拔河出结果', 10_000)
  assert.equal(d.round.result, 'streamer', '主播狂点应该赢：' + JSON.stringify(d.round))
  ok(`送礼「小心心」开局，真实鼠标狂点 ${d.round.sp} 下把绳子拽回来，主播赢`)
  await shot('06-tug-streamer-win')
  await until(async () => { const x = await dbg('tug_of_war'); return x && !x.round ? x : null }, '这局收场', 10_000)

  // —— 观众拉满：主播挨砸 → 真实鼠标擦干净 ——
  await api(() => window.api.connectorSimulate('礼物: 小心心 ×5  by 路过的小猴'))
  d = await until(async () => { const x = await dbg('tug_of_war'); return x && x.round && x.round.result === 'viewers' && x.splats >= 1 && x.flying === 0 ? x : null }, '观众拉满主播挨砸', 20_000)
  await shot('07-tug-penalty')
  const m0 = d.splats
  for (let i = 0; i < 40; i++) {
    const x = await dbg('tug_of_war')
    if (!x.splats) break
    await rub(x.hits[0])
    await sleep(150); await pump()
  }
  await until(async () => { const x = await dbg('tug_of_war'); return x && x.splats === 0 ? x : null }, '糊的东西擦干净', 10_000)
  ok(`观众送「小心心×5」拉满（15 下），主播挨砸 ${m0} 个，用真实鼠标擦干净`)

  // —— 数值不设上限：详情页手填超过滑杆范围也照样存（只有防爆上限）——
  await api(() => { window.location.hash = '#/special?tool=bomb_defuse' })
  const timerBox = page.getByLabel('倒计时数值', { exact: true })
  await timerBox.waitFor({ timeout: 15000 })
  await timerBox.fill('600'); await timerBox.blur()
  const wiresBox = page.getByLabel('几根线数值', { exact: true })
  await wiresBox.fill('30'); await wiresBox.blur()
  await sleep(800)
  const saved = await api(() => window.api.specialState().then((s) => { const g = s.games.find((x) => x.id === 'bomb_defuse'); return g.config.params }))
  assert.ok(saved.timerSec === 600 && saved.wireCount === 24, '手填超过滑杆范围应照存（线的根数防爆 24）：' + JSON.stringify({ t: saved.timerSec, w: saved.wireCount }))
  ok(`详情页手填「倒计时 600 秒」照存（滑杆常用范围到 120），「几根线 30」按防爆存成 24`)
  await api(() => { window.location.hash = '#/ent' })

  // —— 全部清屏 → 窗口空闲 ——
  await api(() => window.api.connectorSimulate('礼物: 嘉年华 ×1  by 爱吃西瓜的知了'))
  await until(async () => { const x = await dbg('bomb_defuse'); return x && x.phase ? x : null }, '再来一颗', 20_000)
  await api(() => window.api.specialClearAll())
  await until(async () => (await js('window.__alive && window.__alive()')).value === false, '清屏后窗口空闲', 15_000)
  ok('全部清屏：炸弹和拔河都收掉，窗口回到空闲')
  const nofocus = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isFocused()))
  assert.ok(nofocus, '测试窗口不该抢焦点')
  ok('全程不抢前台')
} catch (e) {
  errors.push(String(e && e.stack || e))
} finally {
  await app.close().catch(() => {})
}
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
if (errors.length) { console.log('\n错误：'); for (const e of errors.slice(0, 6)) console.log('  ' + e) }
console.log(`\nNEW SPECIALS LIVE: ${passed} PASS${errors.length ? '，有失败' : ''}  截图：${output}`)
if (errors.length) process.exitCode = 1
