// 时间插件三件事的验收（2026-09-11 用户实测报的）：
//   ① 头像：连接器打「头像: 昵称 -> 路径」行 → 客户端记住 → 之后的礼物带头像；晚到的头像回填到滚动条和记录
//   ② 送礼滚动条透底（不画底色 / 边线），8 秒无新记录淡出
//   ③ emoji 贴图（轮椅整蛊台的 Twemoji 图集）：🐦‍⬛ 整个一张图、🥲 这种新 emoji 有图、★ 这类字体画得出的符号仍是文字、国旗 / 键帽 / 肤色都对
// 用法：node tools/verify-avatar-emoji.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'avatar-emoji')
const checks = []
const pass = (name) => { checks.push(name); console.log('PASS ' + name) }

// ---- 纯函数部分：拿页面脚本原文在 Node 里跑 emoji 切分 ----
const emojiSource = await fs.readFile(path.join(root, 'src/main/emoji-assets.ts'), 'utf8')
const runtime = emojiSource.match(/export const EMOJI_RUNTIME = `([\s\S]*?)`\n/)?.[1]
assert.ok(runtime, '找不到 EMOJI_RUNTIME')
const keys = (await fs.readdir(path.join(root, 'assets', 'emoji72'))).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
assert.ok(keys.length > 3000, `表情图太少：${keys.length}`)
const sandbox = { globalThis: null }
sandbox.globalThis = sandbox
vm.runInNewContext(runtime.replace('__BASE__', JSON.stringify('file:///x/')).replace('__KEYS__', JSON.stringify(keys.join('|'))), sandbox)
const split = sandbox.__emojiSplit
const keysOf = (text) => split(text).map((s) => s.key || `文:${s.text}`).join(' ')
assert.equal(keysOf('飞鸟🐦‍⬛×3'), '文:飞鸟 1f426-200d-2b1b 文:×3', keysOf('飞鸟🐦‍⬛×3'))
assert.equal(keysOf('🥲小美彡★'), '1f972 文:小美彡★', keysOf('🥲小美彡★'))
assert.equal(keysOf('❤️❤'), '2764 文:❤', keysOf('❤️❤'))          // 带 FE0F 的红心贴图；裸 ❤ 是字体画得出的 BMP 符号，留文字
assert.equal(keysOf('🇨🇳加油'), '1f1e8-1f1f3 文:加油', keysOf('🇨🇳加油'))
assert.equal(keysOf('1️⃣'), '31-20e3', keysOf('1️⃣'))
assert.equal(keysOf('👍🏽'), '1f44d-1f3fd', keysOf('👍🏽'))
assert.equal(keysOf('👨‍👩‍👧'), '1f468-200d-1f469-200d-1f467', keysOf('👨‍👩‍👧'))
assert.equal(keysOf('纯中文 abc'), '文:纯中文 abc')
pass('emoji 切分：ZWJ 组合整张 / 新 emoji / 国旗 / 键帽 / 肤色 / 家庭；★❤ 这类字体符号仍是文字')

// ---- Electron 部分 ----
await fs.mkdir(outputDir, { recursive: true })
const userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const entry = await writeHiddenElectronBootstrap(root, userDataDir)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
const api = (fn, arg) => page.evaluate(fn, arg)
const inWidget = (title, js) => app.evaluate(async ({ BrowserWindow }, { title, js }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === title); return w ? w.webContents.executeJavaScript(js) : null }, { title, js })
const avatarFile = path.join(root, 'build', 'icon.png')
try {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  const opened = await api(() => window.api.timeWidgetOpen({ on: true, enable: true, title: '倒计时🎉', initial: 3600, clockSpeed: 60000, addGift: '', subGift: '', showGift: true, giftTicker: true, timeLogWindow: true, theme: '1',
    gifts: [{ name: '小心心', mode: 'fixed', op: '加减', seconds: 60, showOnPanel: true }, { name: '棒棒糖🍭', mode: 'fixed', op: '加减', seconds: -30, showOnPanel: true }],
    startHotkey: { enabled: false }, endHotkey: { enabled: false } }))
  assert.equal(opened.ok, true, opened.error)
  assert.equal((await api(() => window.api.timeLogOpen())).ok, true, '记录窗口没开出来')
  await page.waitForTimeout(1000)
  // 先送礼（头像还没到）
  await api(() => window.api.connectorSimulate('礼物: 小心心 ×1  by 飞鸟🐦‍⬛×3'))
  await api(() => window.api.connectorSimulate('礼物: 棒棒糖🍭 ×1  by 阿彪'))
  await page.waitForTimeout(900)
  const t1 = await inWidget('倒计时', `(() => ({
    bg: getComputedStyle(document.getElementById('ticker')).backgroundColor, border: getComputedStyle(document.getElementById('ticker')).borderTopWidth,
    on: document.getElementById('ticker').classList.contains('on'),
    rows: [...document.querySelectorAll('#ticker .tk')].map((r) => ({ name: r.dataset.name, face: !!r.querySelector('.tk-empty'), emo: [...r.querySelectorAll('img.emo')].map((i) => i.getAttribute('src').split('/').pop()) })),
    giftNameEmo: [...document.querySelectorAll('.gift-name img.emo')].map((i) => i.getAttribute('src').split('/').pop()),
    titleEmo: [...document.querySelectorAll('#title img.emo')].length
  }))()`)
  // 2026-09-13 起滚动条跟插件皮肤同底色（格子底色 + 边线），不再透底：透底会被直播伴侣的绿幕抠掉
  assert.notEqual(t1.bg, 'rgba(0, 0, 0, 0)', `滚动条不该透底：${t1.bg}`)
  assert.equal(t1.border, '1px', `滚动条要有和皮肤同色的边线：${t1.border}`)
  assert.equal(t1.on, true)
  pass('送礼滚动条透底、无边线，有记录时显示')
  const bird = t1.rows.find((r) => r.name === '飞鸟🐦‍⬛×3')
  assert.ok(bird && bird.emo.includes('1f426-200d-2b1b.png') && bird.face, JSON.stringify(t1.rows))
  assert.ok(t1.giftNameEmo.includes('1f36d.png'), `礼物名 🍭 该贴图：${JSON.stringify(t1.giftNameEmo)}`)
  assert.equal(t1.titleEmo, 1, '标题里的 🎉 该贴图')
  pass('滚动条昵称 / 礼物栏名字 / 标题里的 emoji 都贴成 Twemoji 图')
  // 头像行晚到 → 滚动条、记录回填；之后的礼物直接带头像
  await api((f) => window.api.connectorSimulate('头像: 阿彪 -> ' + f), avatarFile)
  await page.waitForTimeout(700)
  const t2 = await inWidget('倒计时', `(() => [...document.querySelectorAll('#ticker .tk')].map((r) => ({ name: r.dataset.name, img: !!r.querySelector('img:not(.emo)') })))()`)
  assert.ok(t2.find((r) => r.name === '阿彪')?.img, `头像行到了滚动条没换图：${JSON.stringify(t2)}`)
  assert.ok(!t2.find((r) => r.name === '飞鸟🐦‍⬛×3')?.img, '别人的行不该被换')
  let log = await api(() => window.api.timeWidgetLog())
  assert.equal(log.find((r) => r.sender === '阿彪')?.avatar, avatarFile, `记录没回填头像：${JSON.stringify(log.map((r) => [r.sender, r.avatar]))}`)
  pass('晚到的头像回填到滚动条和记录')
  await api(() => window.api.connectorSimulate('礼物: 小心心 ×1  by 阿彪'))
  await page.waitForTimeout(700)
  log = await api(() => window.api.timeWidgetLog())
  assert.equal(log[0].sender, '阿彪'); assert.equal(log[0].avatar, avatarFile, '之后的礼物该直接带头像')
  const logWin = await inWidget('抽时间记录', `(() => ({ imgs: [...document.querySelectorAll('.gift-icon img')].map((i) => i.getAttribute('src')), names: [...document.querySelectorAll('.gift-name')].map((n) => n.textContent + '|' + n.querySelectorAll('img.emo').length) }))()`)
  assert.ok(logWin && logWin.imgs.some((s) => s.endsWith('icon.png')), `记录窗口没显示头像：${JSON.stringify(logWin)}`)
  assert.ok(logWin.names.some((n) => n.startsWith('飞鸟') && n.endsWith('|1')), `记录窗口昵称 emoji 没贴图：${JSON.stringify(logWin.names)}`)
  pass('后续礼物直接带头像；记录窗口显示头像、昵称 emoji 贴图')
  // 8 秒无新记录淡出（淡出动画 .25s，计时从最后一条上屏算起：轮询到 12 秒，别卡在临界点上）
  let opacity = '1'
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(500)
    opacity = await inWidget('倒计时', `getComputedStyle(document.getElementById('ticker')).opacity`)
    if (Number(opacity) < 0.1) break
  }
  assert.ok(Number(opacity) < 0.1, `8 秒后滚动条该淡出：${opacity}`)
  pass('8 秒没有新记录，滚动条淡出')
  console.log(`SUMMARY ${checks.length}/${checks.length} PASS`)
} finally {
  await app.close().catch(() => {})
}
