// 整蛊台 AI 语音播报回归（2026-10-07）：隐藏离屏 Electron + 真主进程，整个客户端静音，不连网、不出声、不抢前台。
//   · 要念的句子先在本测试的隔离 userData/special-voice/ 里放好声音文件（文件名规则同 special-voice-name.ts），不依赖在线语音
//   · 时间插件：送礼加时间 → 念「加30秒」；配了视频的礼物默认不念，打开「配了视频的也念」才念
//   · 礼物触发：游戏整蛊规则 → 念「翻车」，连击 3 份 → 「翻车，3次」；特色整蛊规则不在这里念（它自己开奖念）
//   · 模块开关 / 总开关关掉就不念；设置能存能读回；试听接口回可播放的地址
//   · 界面：时间插件页头有「AI 播报」开关（和设置同步）；基础模式第一次进有引导卡，点「知道了」后不再出
// 用法：npx electron-vite build --outDir output/free-always-on-build && node tools/verify-announce.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_ANNOUNCE_OUT_DIR || 'output/free-always-on-build'
const out = path.join(root, 'output/playwright/announce')
await fs.mkdir(out, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))

const results = []
const check = (name, value, detail = '') => { results.push({ name, ok: !!value }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch { /* 再等 */ } await sleep(150) } return null }

const VOICE = 'zh-CN-XiaoyiNeural'
const voiceName = (text) => `v-${crypto.createHash('sha1').update(`${VOICE}|0|${text}`, 'utf8').digest('hex').slice(0, 16)}.mp3`
const LINES = ['加30秒', '翻车', '翻车，3次', '加1分钟']

const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
// 预先放好要念的句子（拿随包的一段配音当内容就行，测的是「念哪句、念不念」）
const sample = path.join(root, 'assets/special-games/box_voice', (await fs.readdir(path.join(root, 'assets/special-games/box_voice'))).find((f) => /^v-.*\.mp3$/.test(f)))
await fs.mkdir(path.join(profile, 'special-voice'), { recursive: true })
for (const line of LINES) await fs.copyFile(sample, path.join(profile, 'special-voice', voiceName(line)))

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
const muteAll = () => app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.setAudioMuted(true) } catch { /* 关了 */ } } })
app.on('window', () => { void muteAll().catch(() => {}) })
const page = await app.firstWindow()
await muteAll()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.waitForFunction(() => !!window.api?.announceConfig)
assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile)
const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
await page.evaluate(() => { window.__ann = []; window.api.onAnnouncePlay((item) => window.__ann.push(item.line)) })
const heard = () => page.evaluate(() => window.__ann.slice())
const clearHeard = () => page.evaluate(() => { window.__ann.length = 0 })
const gift = (name, n = 1) => api('connectorSimulate', `礼物: ${name} ×${n}  by 测试观众`)

const inSpecial = (script) => app.evaluate(async ({ BrowserWindow }, s) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === '特色整蛊')
  return w ? await w.webContents.executeJavaScript(s) : null
}, script)
// 特色整蛊开奖：等下一条开奖出来，返回它带没带配音（voiced）
async function nextReveal() {
  for (let i = 0; i < 80; i++) {
    const s = await inSpecial('window.__revealState && window.__revealState()').catch(() => null)
    if (s?.current?.text) return s.current
    await sleep(100)
  }
  return null
}
async function revealsDrained() {
  await waitFor(async () => { const s = await inSpecial('window.__revealState && window.__revealState()').catch(() => null); return !!s && !s.current && s.pending === 0 }, 20000)
}

try {
  // ---- 默认设置：各模块默认不念（开了播报才念），总开关开着 ----
  const cfg0 = await api('announceConfig')
  check('默认：各模块都没开播报、配了视频的不念、总开关开、晓伊正常语速', cfg0.enabled === true && Object.values(cfg0.modules).every((m) => m.on === false && m.withMedia === false) && cfg0.voiceName === VOICE && cfg0.rate === 0)

  // ---- 时间插件：送礼加时间 ----
  const opened = await api('timeWidgetOpen', { enable: true, initial: 60, gifts: [], addGift: '小心心', addSeconds: 30, subGift: '' })
  check('时间插件打开', opened?.ok === true, JSON.stringify(opened))
  await muteAll()
  await clearHeard()
  await gift('小心心')
  await sleep(1200)
  check('没开播报：送小心心加时间，一句都不念', (await heard()).length === 0, JSON.stringify(await heard()))
  await api('announceConfigure', { modules: { time: { on: true, withMedia: false }, gift: { on: true, withMedia: false } } })
  await clearHeard()
  await gift('小心心')
  check('打开时间插件播报后：送小心心加 30 秒 → 念「加30秒」', !!(await waitFor(async () => (await heard()).includes('加30秒'))), JSON.stringify(await heard()))

  // 配了视频的礼物行：默认不念；打开「配了视频的也念」才念
  await api('timeWidgetUpdate', { gifts: [{ name: '玫瑰', mode: 'direct', op: '加减', seconds: 60, video: path.join(profile, 'no-such-video.mp4') }] })
  await clearHeard()
  await gift('玫瑰')
  await sleep(1200)
  check('时间插件：配了视频的礼物默认不念', !(await heard()).includes('加1分钟'), JSON.stringify(await heard()))
  await api('announceConfigure', { modules: { time: { on: true, withMedia: true } } })
  await gift('玫瑰')
  check('打开「配了视频的也念」后：念「加1分钟」', !!(await waitFor(async () => (await heard()).includes('加1分钟'))), JSON.stringify(await heard()))

  // ---- 礼物触发：游戏整蛊 ----
  const add = await api('entertainmentRuleAdd', { id: '', name: '', giftName: '火箭', triggerType: 'gift', actionType: 'command', commandCmd: 'game-prank', commandParam: '4wheel-challenge|flip|翻车', times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true })
  check('建一条游戏整蛊礼物规则', add?.ok === true)
  await clearHeard()
  await gift('火箭')
  check('礼物触发：送火箭 → 念「翻车」', !!(await waitFor(async () => (await heard()).includes('翻车'))), JSON.stringify(await heard()))
  await clearHeard()
  await gift('火箭', 3)
  check('礼物触发：连送 3 个只念一句「翻车，3次」', !!(await waitFor(async () => (await heard()).includes('翻车，3次'))) && (await heard()).filter((l) => l.startsWith('翻车')).length === 1, JSON.stringify(await heard()))

  // 特色整蛊规则：礼物触发这边不念（它自己开奖念）
  await api('entertainmentRuleAdd', { id: '', name: '特色整蛊·抓鸭子', group: '特色整蛊', giftName: '棒棒糖', triggerType: 'gift', actionType: 'command', commandCmd: 'special-play', commandParam: 'catch_duck|add|5', times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true })
  await clearHeard()
  await gift('棒棒糖')
  const voicedOn = await nextReveal()
  await sleep(800)
  check('礼物触发：特色整蛊规则不在播报里重复念', (await heard()).length === 0, JSON.stringify(await heard()))
  check('总开关开着：特色整蛊开奖带 AI 配音', voicedOn?.voiced === true, JSON.stringify(voicedOn))
  await revealsDrained()
  await api('announceConfigure', { enabled: false })
  await gift('棒棒糖')
  const voicedOff = await nextReveal()
  check('总开关关掉：特色整蛊照样敲锣开奖，但不念', !!voicedOff && voicedOff.voiced === false, JSON.stringify(voicedOff))
  await api('announceConfigure', { enabled: true })
  await revealsDrained()
  await api('specialCloseAll').catch(() => {})

  // ---- 模块开关 / 总开关 ----
  await api('announceConfigure', { modules: { gift: { on: false, withMedia: false } } })
  await clearHeard()
  await gift('火箭')
  await sleep(1200)
  check('礼物触发模块关掉：不念', !(await heard()).includes('翻车'), JSON.stringify(await heard()))
  await api('announceConfigure', { modules: { gift: { on: true, withMedia: false } }, enabled: false })
  await clearHeard()
  await gift('火箭')
  await gift('小心心')
  await sleep(1500)
  check('总开关关掉：哪个模块都不念', (await heard()).length === 0, JSON.stringify(await heard()))
  await api('announceConfigure', { enabled: true })

  // ---- 设置存盘 + 夹紧 ----
  const saved = await api('announceConfigure', { volume: 250, rate: -999, maxQueue: 0, voiceName: 'bad voice' })
  check('设置夹紧：音量 ≤100、语速 ≥-50、排队上限 ≥1、坏声音名回默认', saved.volume === 100 && saved.rate === -50 && saved.maxQueue === 1 && saved.voiceName === VOICE)
  const file = JSON.parse(await fs.readFile(path.join(profile, 'data', 'announce.json'), 'utf8'))
  check('设置存进 data/announce.json', file.volume === 100 && file.modules?.time?.withMedia === true && file.modules?.time?.on === true)
  await api('announceConfigure', { volume: 100, rate: 0, maxQueue: 6 })

  // ---- 试听 ----
  const pv = await api('announcePreview', { text: '加30秒' })
  check('试听：回可播放的地址（zlspecial 协议）', pv?.ok === true && /^zlspecial:\/\//.test(pv.voiceUrl) && pv.line === '加30秒', JSON.stringify(pv).slice(0, 160))

  // ---- 界面：模块页头开关 + 基础模式引导 ----
  await page.evaluate(async () => { await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true }); localStorage.setItem('zl-guide-seen', '1'); localStorage.setItem('zl_configuration_level', 'basic'); localStorage.removeItem('zl-announce-guide-seen') })
  const reg = await api('register', 'announce_tester', 'Announce-' + crypto.randomUUID().slice(0, 8), '播报测试')
  if (reg?.ok) {
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: 30000 })
    await page.evaluate(() => { location.hash = '/ent?tool=time' })
    const sw = page.getByTestId('announce-switch')
    check('时间插件页头有「AI 播报」开关', await sw.waitFor({ timeout: 15000 }).then(() => true, () => false))
    const guide = page.getByTestId('announce-guide')
    check('基础模式：第一次进有 AI 播报引导卡', await guide.waitFor({ timeout: 8000 }).then(() => true, () => false))
    await page.screenshot({ path: path.join(out, 'time-page-announce.png') })
    await guide.getByRole('button', { name: '知道了', exact: true }).click()
    check('点「知道了」后引导卡收起', (await guide.count()) === 0)
    await sw.getByRole('switch').click().catch(async () => { await sw.locator('button').first().click() })
    const afterToggle = await waitFor(async () => { const c = await api('announceConfig'); return c.modules.time.on === false ? c : null })
    check('页头开关关掉 → 设置里时间插件不念', !!afterToggle)
    await page.evaluate(() => { location.hash = '/ent?tool=gift' })
    await page.waitForTimeout(800)
    check('别的模块不再出引导卡（看过一次就够）', (await page.getByTestId('announce-guide').count()) === 0)
    await page.evaluate(() => { location.hash = '/settings' })
    const settings = page.getByTestId('announce-settings')
    check('设置页有「AI 语音播报」', await settings.waitFor({ timeout: 10000 }).then(() => true, () => false))
    await settings.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await settings.screenshot({ path: path.join(out, 'settings-announce.png') })
    check('设置页列出 8 个模块且时间插件那行是关着的（和页头开关同步）', (await settings.locator('[data-announce-module]').count()) === 8 && (await settings.locator('[data-announce-module="time"] [role="switch"]').last().getAttribute('aria-checked')) === 'false')
  } else {
    check('界面检查需要登录进主界面（本地账号注册失败）：' + JSON.stringify(reg), false)
  }
  check('全程页面无报错', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('意外中断：' + (e?.stack || e).toString().slice(0, 500), false)
} finally {
  try { await app.close() } catch { /* 已关 */ }
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
process.exit(failed.length ? 1 : 0)
