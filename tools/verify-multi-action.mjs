// 「一条规则多个动作」主进程链路真机验证：起一个隐藏的隔离 Electron 实例，
// 用倒计时挂件当「可观测的动作」——每个动作都是「倒计时加减」，看数值什么时候变、变多少，
// 就知道主动作 / 附加动作有没有按顺序执行、「先等几秒」有没有等够。
// 覆盖：规则落盘（extraActions 清洗）、连接器礼物事件触发全部动作、延迟顺序、排队窗口标签、老单动作规则不受影响、清空附加动作。
// 用法：node tools/verify-multi-action.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'multi-action-electron')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const errors = []

function attachErrors(page) {
  const where = () => page.url().split('/').pop()
  page.on('pageerror', (error) => errors.push(`[${where()}] ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${where()}] console: ${message.text()}`)
  })
}

// arg 会原样传给页面里的 predicate（跨进程序列化），别忘了传，否则 predicate 拿到 undefined 永远不成立
async function waitForApiState(page, predicate, arg = null, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return
    await page.waitForTimeout(100)
  }
  throw new Error(`等待主进程状态超时：${predicate}`)
}

async function ensureTestSession(page) {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  const result = await page.evaluate(async () => {
    const username = 'multi_action_verify'
    const password = 'Fixture123!'
    await window.api.register(username, password, '多动作验证')
    const login = await window.api.login(username, password)
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return login
  })
  assert.equal(result.ok, true, result.error || '本地测试账号登录失败')
  await waitForApiState(page, () => window.api.getSettings().then((r) => (r.settings ?? r).guideSeen === true))
}

function widgetConfig(initial) {
  return {
    on: false, enable: false, title: '多动作验证', initial, clockSpeed: 1000,
    addGift: '', addSeconds: 60, subGift: '', subSeconds: 30, autoHide: false, showGift: false,
    showNegative: true, showSeconds: true, zeroText: '时间到', bgImage: '', theme: '1',
    titleColor: '#ffffff', timeColor: '#ffffff',
    startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' },
    posX: 200, posY: 30
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  const userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  const entry = await writeHiddenElectronBootstrap(root, userDataDir)
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: electronPath,
    args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: root,
    env,
    timeout: 30_000
  })
  app.on('window', attachErrors)
  const page = await app.firstWindow()
  attachErrors(page)
  const api = (fn, arg) => page.evaluate(fn, arg)
  const remaining = () => api(() => window.api.timeWidgetState().then((s) => s.remaining))
  const passed = []

  try {
    await ensureTestSession(page)
    // 倒计时挂件：数值可观测的动作靶子（不走秒，只被规则加减）
    const opened = await api((cfg) => window.api.timeWidgetOpen(cfg), widgetConfig(100))
    assert.equal(opened.ok, true, opened.error || '倒计时挂件打开失败')
    await waitForApiState(page, () => window.api.timeWidgetState().then((s) => s.open))
    await page.waitForTimeout(300)
    let base = await remaining()
    assert.ok(Math.abs(base - 100) <= 1, `倒计时初值不对：${base}`)

    // ---- 1. 规则落盘：附加动作被清洗（非法项丢掉、delayMs 取整非负、只留认识的字段） ----
    const added = await api(() => window.api.entertainmentRuleAdd({
      id: '', giftName: '多动作', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '5',
      enabled: true, queueMode: 'instant', multiply: false,
      extraActions: [
        { actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '7', delayMs: 700.9, junk: 'x' },
        { actionType: 'nonsense', commandCmd: 'countdown-adjust', commandParam: '999' },
        null,
        { actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '9', delayMs: -50 }
      ]
    }))
    assert.equal(added.ok, true, added.error)
    const stored = (await api(() => window.api.entertainmentRulesList())).find((r) => r.giftName === '多动作')
    assert.ok(stored, '规则没存进去')
    assert.equal(stored.extraActions.length, 2, `附加动作没清洗对：${JSON.stringify(stored.extraActions)}`)
    assert.equal(stored.extraActions[0].delayMs, 700)
    assert.equal(stored.extraActions[0].junk, undefined, '不认识的字段应该被丢掉')
    assert.equal(stored.extraActions[1].delayMs, 0)
    passed.push('规则落盘清洗')

    // ---- 2. 连接器礼物事件 → 主动作立刻、附加动作 1 等 0.7 秒、附加动作 2 紧跟 ----
    base = await remaining()
    const t0 = Date.now()
    await api(() => window.api.connectorSimulate('礼物: 多动作 ×1  by 验证'))
    await page.waitForTimeout(250)
    const afterFirst = await remaining()
    assert.ok(Math.abs(afterFirst - base - 5) <= 1, `主动作应先加 5：${base} → ${afterFirst}`)
    // 0.7 秒的延迟还没到，附加动作不该已经执行
    assert.ok(afterFirst - base < 12, `附加动作提前执行了：${base} → ${afterFirst}`)
    await waitForApiState(page, (b) => window.api.timeWidgetState().then((s) => s.remaining - b >= 20), base, 5000)
    const elapsed = Date.now() - t0
    const afterAll = await remaining()
    assert.ok(Math.abs(afterAll - base - 21) <= 1, `三个动作合计应加 21：${base} → ${afterAll}`)
    assert.ok(elapsed >= 650, `附加动作没等够 0.7 秒就跑完了：${elapsed}ms`)
    passed.push(`礼物触发三动作按序（主动作 +5 → 等 0.7s → +7 → +9，共 ${elapsed}ms）`)

    // ---- 3. 排队规则：排队窗口/列表看到的标签把所有动作串起来 ----
    await api(() => window.api.entertainmentRuleAdd({
      id: '', giftName: '排队多动作', actionType: 'key', keySeq: '{F13}', enabled: true, queueMode: 'normal', multiply: false,
      extraActions: [{ actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '2', delayMs: 0 }]
    }))
    base = await remaining()
    await api(() => window.api.connectorSimulate('礼物: 排队多动作 ×1  by 验证'))
    const snap = await api(() => window.api.queueState().then((s) => s.snapshot))
    const label = snap.running?.action || snap.pending[0]?.action || ''
    assert.match(label, /按键 \{F13\} → 倒计时加减 2/, `排队标签没串起全部动作：${label}`)
    await waitForApiState(page, (b) => window.api.timeWidgetState().then((s) => s.remaining - b >= 2), base, 5000)
    passed.push('排队规则标签与执行')

    // ---- 4. 老的单动作规则（没有 extraActions 字段）照常 ----
    await api(() => window.api.entertainmentRuleAdd({ id: '', giftName: '单动作', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '3', enabled: true, queueMode: 'instant', multiply: false }))
    base = await remaining()
    await api(() => window.api.connectorSimulate('礼物: 单动作 ×1  by 验证'))
    await waitForApiState(page, (b) => window.api.timeWidgetState().then((s) => Math.abs(s.remaining - b - 3) <= 1), base, 5000)
    passed.push('老单动作规则兼容')

    // ---- 5. 编辑把附加动作删光：update 带空数组后再触发只加主动作 ----
    const cleared = await api((id) => window.api.entertainmentRuleUpdate({ id, giftName: '多动作', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '5', enabled: true, queueMode: 'instant', multiply: false, extraActions: [] }), stored.id)
    assert.equal(cleared.ok, true)
    const again = (await api(() => window.api.entertainmentRulesList())).find((r) => r.id === stored.id)
    assert.equal(again.extraActions.length, 0, '删光附加动作没落盘')
    base = await remaining()
    await api(() => window.api.connectorSimulate('礼物: 多动作 ×1  by 验证'))
    await page.waitForTimeout(1200)
    const only = await remaining()
    assert.ok(Math.abs(only - base - 5) <= 1, `删光附加动作后应只加 5：${base} → ${only}`)
    passed.push('清空附加动作')

    // ---- 6. 用户原话场景：「播视频的时候再加个动作」——画面窗口开起来的同时另一个动作照跑 ----
    // 0.3.43 起不带后缀的画面默认去绿幕排队（没开绿幕窗口就不播），这里要验的是老的视频播放器窗口，显式写「|视频」
    const media = path.join(root, 'gift-assets', 'douyin', '+1里程加加卡.png') + '|视频'
    await api((p) => window.api.entertainmentRuleAdd({
      id: '', giftName: '视频加动作', actionType: 'command', commandCmd: 'video-gif', commandParam: p,
      enabled: true, queueMode: 'instant', multiply: false,
      extraActions: [{ actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '6', delayMs: 200 }]
    }), media)
    base = await remaining()
    await api(() => window.api.connectorSimulate('礼物: 视频加动作 ×1  by 验证'))
    await waitForApiState(page, () => window.api.videoWidgetState().then((s) => Boolean(s.main)), null, 5000)
    await waitForApiState(page, (b) => window.api.timeWidgetState().then((s) => Math.abs(s.remaining - b - 6) <= 1), base, 5000)
    assert.equal(await api(() => window.api.videoWidgetState().then((s) => Boolean(s.main))), true, '画面窗口在第二个动作跑完后应该还开着')
    await api(() => window.api.videoWidgetClose?.() ?? window.api.entertainmentCommand('video-stop', ''))
    passed.push('播画面 + 另一个动作同时生效')

    assert.deepEqual(errors, [], `Electron 页面错误：${errors.join(' | ')}`)
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((win) => !win.isVisible() && !win.isFocused())), true, '隐藏验证不得显示窗口或抢焦点')
    console.log(`多动作规则主进程链路 ${passed.length}/6 PASS：${passed.join('；')}`)
  } catch (error) {
    if (errors.length) console.error('页面错误：', errors.slice(0, 8).join(' | '))
    throw error
  } finally {
    await page.evaluate(() => Promise.allSettled([window.api.timeWidgetClose(), window.api.queueClear()])).catch(() => {})
    await app.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
