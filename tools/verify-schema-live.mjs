// 真机冒烟：隔离隐藏客户端连**真实更新源**（不打 ZL_MODS_CATALOG_URL），验「菜单随 mod 更新」这条链在线上是通的：
//   ① 启动后自动从更新源拿到三款游戏的定义包并落盘（data/schemas/<gameId>.json + .meta.json 的 sha 与线上清单一致）
//   ② 整蛊菜单：不要尖叫 87 条 / 12 组，全部中文名；轮椅 86 条含神罗天征等 11 个新补的；图书管理员 50 条
//   ③ 整蛊台页面（/remote）切到不要尖叫后，页面文字里有中文整蛊名、没有裸露的英文 id
// 用法：node tools/verify-schema-live.mjs   （需要外网）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/schema-live')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
await prepareIsolatedGameProfile(root, profile)

const live = await fetch('https://zhiliaohou.oss-cn-beijing.aliyuncs.com/updates/mods-catalog.json?t=' + Date.now()).then((r) => r.json())
const liveSha = {}
for (const [id, e] of Object.entries(live.mods)) if (e.schema) liveSha[id] = e.schema.sha256
assert.ok(Object.keys(liveSha).length >= 3, '线上清单应给三款 mod 带 schema')

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ZL_MODS_CATALOG_URL
const checks = []
const pass = (name, detail = '') => { checks.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.prankCatalog)
  // 触发一次清单拉取（listMods 会顺手刷新远端清单 → 同步定义包）
  await page.evaluate(() => window.api.listMods())

  // ① 定义包落盘且 sha 与线上一致
  const modGame = { 'zhiliao-dontscream': 'dontscream', 'darkmage-librarian': 'librarian', wheellive: '4wheel-challenge' }
  const deadline = Date.now() + 30000
  let metas = {}
  while (Date.now() < deadline) {
    metas = {}
    for (const [mid, gid] of Object.entries(modGame)) {
      try { metas[mid] = JSON.parse(await fs.readFile(path.join(profile, 'data', 'schemas', `${gid}.meta.json`), 'utf8')) } catch { /* 还没到 */ }
    }
    if (Object.keys(metas).length === 3) break
    await sleep(500)
  }
  for (const [mid, gid] of Object.entries(modGame)) {
    assert.ok(metas[mid], `${gid} 的定义包 30 秒内没落盘`)
    assert.equal(metas[mid].sha256, liveSha[mid], `${gid} 落盘的定义包 sha 应与线上清单一致`)
    const bundle = JSON.parse(await fs.readFile(path.join(profile, 'data', 'schemas', `${gid}.json`), 'utf8'))
    assert.equal(bundle.gameId, gid)
  }
  pass('三款定义包从真实更新源落盘，sha 与线上清单一致')

  // ② 菜单内容
  const cat = await page.evaluate(() => window.api.prankCatalog())
  const flat = (gid) => cat[gid].flatMap((g) => g.items)
  const zh = /[一-鿿]/
  assert.equal(flat('dontscream').length, 88, '不要尖叫 87 条 + 惊吓盲盒')
  assert.equal(cat.dontscream.length, 13, '不要尖叫 12 组 + 盲盒组')
  assert.ok(flat('dontscream').every((p) => zh.test(p.name)), '不要尖叫全部中文名')
  assert.ok(cat.dontscream.every((g) => zh.test(g.name)), '不要尖叫分组名全部中文')
  assert.equal(flat('4wheel-challenge').length, 86, '轮椅 86 条')
  for (const name of ['神罗天征', '巨型黑洞', '醉驾', '洗衣机模式', '命运红线']) assert.ok(flat('4wheel-challenge').some((p) => p.name === name), `轮椅菜单应有「${name}」`)
  assert.equal(flat('librarian').length, 50, '图书管理员 50 条')
  assert.ok(['4wheel-challenge', 'dontscream', 'librarian'].every((g) => flat(g).every((p) => zh.test(p.name))), '三款菜单全部中文名')
  pass('菜单内容：不要尖叫 87/12 组、轮椅 86（含新补 11 个）、图书管理员 50，全部中文', `${flat('dontscream').slice(0, 3).map((p) => p.name).join('、')}…`)

  // ③ 整蛊台页面切到不要尖叫：页面文字里有中文整蛊名、没有裸 id（主窗口要登录才有页面，用和 test-formal-card-ui 一样的夹具账号）
  await page.waitForFunction(() => !!window.api?.register)
  const login = await page.evaluate(async () => {
    await window.api.register('schema_live_fixture', 'Fixture123!', '定义包真机冒烟')
    const res = await window.api.login('schema_live_fixture', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true, currentGameId: 'dontscream' })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'basic')
    return res
  })
  assert.equal(login.ok, true, '夹具账号登录：' + JSON.stringify(login))
  await page.evaluate(() => window.api.setGameCurrent('dontscream'))
  await page.reload()
  await page.waitForFunction(() => !!window.api?.prankCatalog)
  await page.evaluate(() => { window.location.hash = '#/remote' })
  await page.waitForFunction(() => document.body.innerText.includes('冥婚贴脸') || document.body.innerText.includes('突脸暴击'), null, { timeout: 15000 })
  const text = await page.evaluate(() => document.body.innerText)
  const ids = flat('dontscream').map((p) => p.id)
  const leaked = ids.filter((id) => new RegExp(`(^|[^\\w])${id}([^\\w]|$)`).test(text))
  assert.equal(leaked.length, 0, `页面不该裸露英文 id：${leaked.slice(0, 5).join(',')}`)
  const shown = flat('dontscream').filter((p) => text.includes(p.name)).length
  assert.ok(shown >= 80, `页面上应看到几乎全部中文整蛊名，实际 ${shown}/87`)
  // 隐藏窗口整页截图会卡住，只截可视区且失败不算错
  await page.screenshot({ path: path.join(profile, 'remote-dontscream.png'), timeout: 5000 }).catch(() => {})
  pass('整蛊台页面：不要尖叫菜单全中文、无英文 id', `页面可见 ${shown}/87`)
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile }, null, 2))
  await app.close()
  console.log(`SUMMARY ${checks.length}/3 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
