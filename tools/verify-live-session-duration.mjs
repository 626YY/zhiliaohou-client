// 真实 Electron / IPC / 统计页回归；只使用隔离配置和不会联网的 Python 连接器桩。
// 可加 --packaged 从本版本发行 ASAR 验证；不启动游戏或真实直播连接。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const packaged = process.argv.includes('--packaged')
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
const output = path.join(root, 'output/playwright/live-session-duration' + (packaged ? '-packaged' : ''))
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const modDir = path.join(path.dirname(settings.gamePaths['4wheel-challenge']), 'Mods/WheelLive')
await fs.mkdir(modDir, { recursive: true })
await fs.writeFile(path.join(modDir, 'connector.py'), 'import time\nprint("stub connector", flush=True)\nwhile True: time.sleep(1)\n')
await fs.writeFile(path.join(modDir, 'bridge.txt'), '')
const file = path.join(profile, 'data/live-session.json')
const at = Math.floor(Date.now() / 1000)
const legacy = { room: 'duration-fixture', started: at - 160669, last: at, gifts: 23, coins: 23, likes: 0, follows: 0, running: 0 }
await fs.writeFile(file, JSON.stringify(legacy))
const archive = path.join(root, `release/v${version}/win-unpacked/resources/app.asar`)
const entry = await writeHiddenElectronBootstrap(root, profile, {
  isolateGames: false, offscreen: true, ...(packaged ? { outDir: path.join(archive, 'out') } : {})
})
if (packaged) {
  let source = await fs.readFile(entry, 'utf8')
  source = source.replace(`electron.app.setAppPath(${JSON.stringify(root)});`,
    `electron.app.setAppPath(${JSON.stringify(archive)});\nObject.defineProperty(electron.app,'isPackaged',{get:()=>true});\nObject.defineProperty(process,'resourcesPath',{value:${JSON.stringify(path.dirname(archive))}});`)
  await fs.writeFile(entry, source)
}
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const errors = []
const pass = (name, detail) => { checks.push({ name, detail }); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let app, page, failure
const launch = async () => {
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.api?.liveStats)
}
const stats = () => page.evaluate(() => window.api.liveStats())
const stop = () => page.evaluate(() => window.api.connectorStop())
const start = async () => {
  const result = await page.evaluate(() => window.api.connectorStart('', true))
  assert.equal(result.ok, true, result.error)
}
const read = async () => JSON.parse(await fs.readFile(file, 'utf8'))
const duration = () => page.getByText('开播时长', { exact: true }).locator('..').innerText()
const capture = async name => {
  const handle = await app.browserWindow(page)
  const bytes = await handle.evaluate(async win => Array.from((await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
  const png = Buffer.from(bytes)
  await fs.writeFile(path.join(output, name + '.png'), png)
  return createHash('md5').update(png).digest('hex')
}
try {
  await launch()
  let result = await stats()
  assert.equal(result.session.durationUnknown, true)
  assert.equal(result.session.gifts, 23)
  assert.equal(result.session.running, 0)
  await page.evaluate(async () => {
    await window.api.register('duration_fixture', 'Fixture123!', '时长验收')
    const r = await window.api.login('duration_fixture', 'Fixture123!'); if (!r.ok) throw Error(r.error)
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('main'))
  await page.evaluate(() => { location.hash = '/stats' })
  await page.getByText('开播时长', { exact: true }).waitFor()
  assert.match(await duration(), /—/)
  await page.getByText('旧版未准确记录本场下播时间，时长暂不显示。礼物等统计已保留。', { exact: true }).waitFor()
  await capture('legacy-duration-unavailable')
  await stop(); await sleep(1200); await stop()
  assert.deepEqual(await read(), legacy)
  await app.close(); app = null
  assert.deepEqual(await read(), legacy)
  pass('旧版异常时长不冒充准确值，23 个礼物保留，重复断开和退出不改历史')

  await launch()
  // 新鲜的旧 mod 文件也不能将另一个房间的开始时间嫁接到当前场次。
  await fs.writeFile(path.join(modDir, 'live_stats.json'), JSON.stringify({ ...legacy, room: 'other-room', running: 1, last: Math.floor(Date.now() / 1000) }))
  await start()
  result = await stats()
  assert.equal(result.session.room, 'sim')
  assert.equal(result.session.gifts, 0)
  assert.equal(result.session.durationUnknown, undefined)
  assert.ok(Math.abs(result.session.started - Date.now() / 1000) < 5)
  pass('新场从零计时，不混入其他房间新鲜残留文件')
  await page.evaluate(async () => {
    await window.api.login('duration_fixture', 'Fixture123!')
    await window.api.connectorSimulate('礼物: 小心心 ×3  by 验收')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('main'))
  await page.evaluate(() => { location.hash = '/stats' })
  await page.getByText('开播时长', { exact: true }).waitFor()
  await page.getByText('直播中', { exact: true }).waitFor()
  const activeText1 = await duration(), activePng1 = await capture('running-1')
  await sleep(2200)
  const activeText2 = await duration(), activePng2 = await capture('running-2')
  assert.notEqual(activeText1, activeText2)
  assert.notEqual(activePng1, activePng2)
  pass('真实统计页逐秒推进，截图去重通过', activeText1.replaceAll('\n', ' ') + ' → ' + activeText2.replaceAll('\n', ' '))

  await stop()
  const stopped = await stats()
  assert.equal(stopped.session.running, 0)
  assert.equal(stopped.session.endedAt, stopped.session.last)
  assert.equal(stopped.session.gifts, 3)
  const stored = await read()
  await page.getByText('已下播', { exact: true }).waitFor()
  const frozenText = await duration()
  await capture('stopped-1')
  await sleep(3200); await stop()
  assert.deepEqual(await read(), stored)
  assert.deepEqual((await stats()).session, stopped.session)
  assert.equal(await duration(), frozenText)
  await capture('stopped-2')
  pass('停止后结束时间及画面定格，重复断开不会增加时长', frozenText.replaceAll('\n', ' '))
  await app.close(); app = null
  assert.deepEqual(await read(), stored)
  await launch()
  result = await stats()
  assert.equal(result.session.endedAt, stored.endedAt)
  assert.equal(result.session.gifts, 3)
  assert.equal(result.session.running, 0)
  assert.equal(result.session.durationUnknown, false)
  await stop()
  assert.deepEqual(await read(), stored)
  pass('退出再打开仍保留准确结束时间与礼物数')
  await start()
  result = await stats()
  assert.equal(result.session.gifts, 0)
  assert.equal(result.session.endedAt, undefined)
  assert.ok(result.session.started >= stored.endedAt)
  await stop()
  pass('下一场重新开账，不沿用上一场时长')
  await app.close(); app = null

  const crashed = { ...legacy, running: 1, started: at - 7200, last: at - 3600 }
  await fs.writeFile(file, JSON.stringify(crashed))
  await fs.unlink(path.join(modDir, 'live_stats.json'))
  await launch()
  result = await stats()
  assert.equal(result.session.running, 0)
  assert.equal(result.session.endedAt - result.session.started, 3600)
  assert.equal(result.session.durationUnknown, false)
  await stop()
  assert.deepEqual(await read(), crashed)
  pass('异常退出只截至最后心跳，重启后不计入离线的一小时')
  assert.deepEqual(errors, [])
  pass('统计页无渲染异常')
} catch (error) { failure = String(error.stack || error); console.error('FAIL ' + failure) }
finally {
  await app?.close().catch(() => {})
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ version, packaged, checks, failure, profile }, null, 2))
  console.log(`SUMMARY ${checks.length}/8 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + output)
}
if (failure) process.exitCode = 1
