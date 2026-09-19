// 聚焦验证测试隔离：真实构建/IPC/进程查询，不启动游戏，不接触用户 profile。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/game-isolation')
await fs.mkdir(output, { recursive: true })
const checks = [], routeEvents = []
function check(name, value = true) {
  assert.ok(value, name)
  checks.push(name)
  console.log('PASS ' + name)
}

await assert.rejects(() => prepareIsolatedGameProfile(root, root), /non-temporary test profile/)
check('拒绝真实或非临时配置目录')
const configured = await fs.mkdtemp(path.join(output, 'session-'))
await fs.mkdir(path.join(configured, 'data'))
const existing = '{"guideSeen":true,"gamePath":"keep-existing-test-setting"}'
await fs.writeFile(path.join(configured, 'data/settings.json'), existing)
await assert.rejects(() => prepareIsolatedGameProfile(root, configured), /overwrite existing test settings/)
check('已有测试设置保持逐字不变', await fs.readFile(path.join(configured, 'data/settings.json'), 'utf8') === existing)
await writeHiddenElectronBootstrap(root, configured, { isolateGames: false })
check('显式真游戏模式不覆盖测试配置', await fs.readFile(path.join(configured, 'data/settings.json'), 'utf8') === existing)

const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const seeded = JSON.parse(await fs.readFile(path.join(profile, 'data/settings.json'), 'utf8'))
for (const file of Object.values(seeded.gamePaths)) {
  const relative = path.relative(profile, await fs.realpath(file))
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  assert.equal((await fs.stat(file)).size, 0)
  assert.ok(path.basename(file, '.exe').length < 25)
}
check('全部游戏使用本次 profile 内零字节占位，进程名不会截断冲突')

const buildPath = path.join(root, 'out/main/index.js')
const buildHash = createHash('sha256').update(await fs.readFile(buildPath)).digest('hex')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env })
let failure, falseReads = 0
try {
  const page = await app.firstWindow()
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) routeEvents.push(frame.url()) })
  await page.waitForFunction(() => !!window.api?.login)
  check('真实应用使用独立 profile', await app.evaluate(({ app }) => app.getPath('userData')) === profile)
  const inventory = await page.evaluate(async () => ({ games: await window.api.gamesList(), detected: await window.api.detectAllGames(), settings: (await window.api.getSettings()).settings }))
  assert.deepEqual(inventory.games.map(game => game.id).sort(), Object.keys(seeded.gamePaths).sort())
  assert.deepEqual(inventory.detected.found, seeded.gamePaths)
  assert.deepEqual(inventory.settings.gamePaths, seeded.gamePaths)
  check('真实自动探测覆盖全部游戏，未混入 Steam 路径')
  const logged = await page.evaluate(async () => {
    await window.api.register('game_isolation_regression', 'Fixture123!', '游戏隔离回归')
    const result = await window.api.login('game_isolation_regression', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return result
  })
  assert.equal(logged.ok, true, logged.error)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '娱乐助手', exact: true }).click()
  await page.getByRole('button', { name: /时间插件/ }).click()
  await page.getByTestId('time-setup-question').waitFor()
  const deadline = Date.now() + 6500 // 超过两次生产页面的 2500ms 检测周期。
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => ({ game: await window.api.gameState(), live: await window.api.liveState(), route: location.hash }))
    assert.equal(state.game.running, false)
    assert.equal(state.live.running, false)
    assert.equal(state.live.bridgeOk, false)
    assert.equal(state.live.path, '')
    assert.equal(state.route, '#/ent?tool=time')
    falseReads++
    await page.waitForTimeout(500)
  }
  check('真实进程检测持续未运行、无游戏事件桥、页面保持娱乐助手')
  await page.getByRole('button', { name: /返回功能列表/ }).first().click()
  await page.getByRole('button', { name: /积分心愿/ }).click()
  await page.getByText('礼物积分进度条').first().waitFor()
  check('原失败操作返回功能列表并进入积分心愿正常')

  // 阳性对照：仅用已运行的本测试 Electron 作为进程探测目标，不执行占位文件。
  // 保留真实 IPC 和 App 自动导航，防止隔离通过是因为屏蔽了生产行为。
  const testExe = await app.evaluate(({ app }) => app.getPath('exe'))
  await page.evaluate(({ paths, exe }) => window.api.saveSettings({ gamePaths: { ...paths, '4wheel-challenge': exe } }), { paths: seeded.gamePaths, exe: testExe })
  assert.equal((await page.evaluate(() => window.api.gameState())).running, true)
  await page.waitForURL('**#/remote', { timeout: 10_000 })
  check('阳性对照：真实进程出现后原有自动导航仍生效')
  await page.evaluate(paths => window.api.saveSettings({ gamePaths: paths }), seeded.gamePaths)
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ visible: win.isVisible(), focused: win.isFocused() })))
  check('测试全程使用隐藏窗口', windows.length > 0 && windows.every(win => !win.visible && !win.focused))
} catch (error) {
  failure = String(error.stack || error)
  throw error
} finally {
  await app.close()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, profile, seeded, buildPath, buildHash, falseReads, routeEvents, failure, closedOwnInstance: true }, null, 2))
}
console.log(`Game isolation regression: ${checks.length}/${checks.length} PASS`)
