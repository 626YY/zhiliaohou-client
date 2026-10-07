// 下架的游戏（mod 状态 unlisted）在这台电脑没装时「不显示」回归（2026-10-07 用户：「图书管理员要下架的，应该是不显示的才对」）：
//   隔离隐藏客户端 + 本地 HTTP 当更新源（ZL_MODS_CATALOG_URL），清单里把图书管理员标成 unlisted：
//   · 没装：游戏库、游戏列表（遥控 / 参数 / 启动游戏 / 设置）都不出现图书管理员；启动游戏页没有它；
//   · 装着（游戏目录里有 mod 标记）：照常出现（下架只对还没装的人生效，2026-09-19 定的规矩）。
// 用法：npx electron-vite build --outDir output/free-always-on-build && node tools/verify-delisted-game.mjs
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_DELIST_OUT_DIR || 'output/free-always-on-build'
const out = path.join(root, 'output/playwright/delisted-game')
await fs.mkdir(out, { recursive: true })
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch { /* 再等 */ } await sleep(200) } return null }

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ generatedAt: 'delist-test', mods: { 'darkmage-librarian': { status: 'unlisted' } } }))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const catalogUrl = `http://127.0.0.1:${server.address().port}/mods-catalog.json`

const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: catalogUrl, ZL_MODS_CATALOG_REFRESH_MS: '300' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForFunction(() => !!window.api?.gamesList)
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })

  // ---- 没装：哪儿都不显示 ----
  const hiddenInLibrary = await waitFor(async () => !(await api('listMods')).mods.some((m) => m.id === 'darkmage-librarian'))
  check('没装：游戏库里没有图书管理员（清单下架生效）', !!hiddenInLibrary)
  const games = await api('gamesList')
  check('没装：游戏列表里没有图书管理员（遥控 / 参数 / 启动游戏 / 设置都用这份）', !games.some((g) => g.id === 'librarian') && games.some((g) => g.id === '4wheel-challenge') && games.some((g) => g.id === 'dontscream'), games.map((g) => g.id).join(','))

  // 界面：登录后看游戏库和启动游戏页
  await page.evaluate(async () => { await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true }); localStorage.setItem('zl-guide-seen', '1') })
  const reg = await api('register', 'delist_tester', 'Delist-' + crypto.randomUUID().slice(0, 8), '下架测试')
  if (reg?.ok) {
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: 30000 })
    await page.evaluate(() => { location.hash = '/' })
    await page.waitForTimeout(1500)
    const libraryText = await page.locator('main').innerText()
    check('界面：游戏库页面不出现「图书管理员」', !/图书管理员/.test(libraryText))
    await page.screenshot({ path: path.join(out, 'library.png') })
    await page.evaluate(() => { location.hash = '/launch' })
    await page.waitForTimeout(1500)
    check('界面：启动游戏页不出现「图书管理员」', !/图书管理员/.test(await page.locator('main').innerText()))
    await page.screenshot({ path: path.join(out, 'launch.png') })
  } else {
    check('界面检查要先登录（本地账号注册失败）：' + JSON.stringify(reg), false)
  }

  // ---- 装着：照常显示 ----
  const settings = (await api('getSettings')).settings
  const exe = settings.gamePaths?.librarian
  if (exe) {
    const marker = path.join(path.dirname(exe), 'ue4ss/Mods/DarkMage/enabled.txt')
    await fs.mkdir(path.dirname(marker), { recursive: true })
    await fs.writeFile(marker, '1')
    const back = await waitFor(async () => (await api('gamesList')).some((g) => g.id === 'librarian'))
    check('装着（游戏目录里有 mod）：游戏列表里照常有图书管理员', !!back)
    check('装着：游戏库里照常有图书管理员', (await api('listMods')).mods.some((m) => m.id === 'darkmage-librarian'))
  } else {
    check('测试 profile 没有图书管理员游戏路径', false)
  }
  check('全程页面无报错', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('意外中断：' + (e?.stack || e).toString().slice(0, 400), false)
} finally {
  try { await app.close() } catch { /* 已关 */ }
  server.close()
}
const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} PASS`)
process.exit(failed ? 1 : 0)
