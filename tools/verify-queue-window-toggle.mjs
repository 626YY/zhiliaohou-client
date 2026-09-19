// 排队窗口「绿幕/透明」切换后关不掉（2026-09-07 用户实测：「点了绿幕切换，
// 卡出来一个莫名其妙的窗口，去不掉了」）。
//
// 根因：切换背景走「关旧窗 → 开新窗」，而旧窗的 closed 回调晚一步才触发，
// 那时模块里的 win 已经指向新窗口，回调无条件 `win = null` 把【新窗口】的引用弄丢了。
// 之后点关闭 → win?.close() → win 是 null → 什么都没关 → 屏幕上留个关不掉的窗口。
//
// 覆盖：① 切换背景后仍然只有一个排队窗口（不留孤儿）
//       ② 切换后「关闭」真的能关掉（这就是用户卡住的那一步）
//       ③ 连续切换多次也不堆窗口
//       ④ 关掉后状态是「未打开」
// 用法：node tools/verify-queue-window-toggle.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'queue-toggle')
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, keepClosedSources: true }))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

let app
try {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.queueOpen))

  // 数「排队窗口」有几个：按窗口标题认（captureTitle 打的是「排队」）
  const countWindows = async () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /排队/.test(w.getTitle() || '')).length
    )
  const state = () => page.evaluate(() => window.api.queueState())

  // ---- 开窗 ----
  await page.evaluate(() => window.api.queueOpen({ background: 'green' }))
  await page.waitForTimeout(1200)
  assert.equal(await countWindows(), 1, '开窗后该只有 1 个排队窗口')
  assert.equal((await state()).open, true)
  pass('开排队窗口', '1 个')

  // ---- ① 切换背景：绿幕 → 透明 ----
  await page.evaluate(() => window.api.queueConfigure({ background: 'transparent' }))
  await page.waitForTimeout(1500)
  const afterToggle = await countWindows()
  assert.equal(afterToggle, 1, `切换背景后该仍是 1 个窗口，实际 ${afterToggle}（多出来的就是关不掉的孤儿窗口）`)
  assert.equal((await state()).open, true, '切换后状态该还是「打开」')
  pass('★切换绿幕/透明后不留孤儿窗口', `${afterToggle} 个`)

  // ---- ③ 连续切换多次 ----
  for (const bg of ['green', 'transparent', 'green']) {
    await page.evaluate((b) => window.api.queueConfigure({ background: b }), bg)
    await page.waitForTimeout(900)
  }
  const afterMany = await countWindows()
  assert.equal(afterMany, 1, `连续切换 4 次后该仍是 1 个窗口，实际 ${afterMany}`)
  pass('连续切换多次也不堆窗口', `${afterMany} 个`)

  // ---- ② 停止内容，保留采集源，避免直播伴侣跳到主界面 ----
  // 2026-09-09 起待机窗口输出的是色度绿（#00FF00），不是黑：黑块被采进直播就糊在画面上，
  // 绿底抠掉等于什么都没有。断言跟着改成绿底（原来是按黑色写的）。
  await page.evaluate(() => window.api.queueClose())
  await page.waitForTimeout(1200)
  const afterClose = await countWindows()
  assert.equal(afterClose, 1, '停止后保留一个稳定采集窗口')
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='排队')?.getBackgroundColor()),'#00FF00')
  pass('切换过背景之后，停止内容并保留色度绿采集窗口（抠像后画面干净）')

  // ---- ④ 状态 ----
  assert.equal((await state()).open, false, '关掉后状态该是「未打开」')
  pass('关掉后状态是「未打开」')
} finally {
  await app?.close().catch(() => {})
}
console.log(`\n排队窗口切换 ${passed.length}/5 PASS`)
