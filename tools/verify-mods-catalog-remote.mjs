// 端到端：隔离隐藏客户端走真实 IPC 验「远端 mod 清单覆盖自带清单」——上新一版 mod 不用再发客户端。
//   本地起一个 HTTP 服务当更新源（ZL_MODS_CATALOG_URL 指过去），依次喂三份清单：
//   ① 更新的版本 + 合格直链 → 游戏库里版本被抬高、下载地址换成远端的，介绍/封面这类字段不许被改
//   ② 站外直链 → 版本还能抬，但 download 被剔掉、退回自带的（不能把主播导去别处下东西）
//   ③ 更旧的版本 → 一点都不许覆盖（不能把主播降级）
//   ④ 更新源整个挂掉 → 用上次缓存；缓存也没有时回自带清单，游戏库照常能开
// 用法：node tools/verify-mods-catalog-remote.mjs   （不需要外网）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/mods-catalog-remote')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
await prepareIsolatedGameProfile(root, profile)

// 自带清单里挑一款当被测对象
const manifestDir = path.join(root, 'mods-catalog', 'manifests')
const bundled = JSON.parse(await fs.readFile(path.join(manifestDir, 'zhiliao-dontscream.json'), 'utf8'))
const MOD_ID = bundled.id
const baseVer = bundled.version
const newerVer = baseVer.replace(/(\d+)$/, (n) => String(Number(n) + 1))
const olderVer = baseVer.replace(/(\d+)$/, (n) => String(Math.max(0, Number(n) - 1)))
const OK_URL = `https://zhiliaohou.oss-cn-beijing.aliyuncs.com/mods/${MOD_ID}-v${newerVer}.zip`
const SHA = 'b'.repeat(64)

let served = null // 当前要吐出去的清单；null = 服务端 500（模拟更新源挂掉）
let servedSchema = '' // /schema.json 吐的字节（定义包；⑦⑧ 用）
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/schema.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(servedSchema)
    return
  }
  if (!served) {
    res.writeHead(500).end('down')
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(served))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const catalogUrl = `http://127.0.0.1:${server.address().port}/mods-catalog.json`
const schemaUrl = `http://127.0.0.1:${server.address().port}/schema.json`

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: catalogUrl, ZL_MODS_CATALOG_REFRESH_MS: '300' }
delete env.ELECTRON_RUN_AS_NODE
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
  await page.waitForFunction(() => !!window.api?.listMods)
  // 第一次 listMods 只会触发后台拉取，拉回来之后再读才生效；轮询到位或超时
  // 按「条件」等而不是按版本等：换清单时版本可能没变（变的是下载地址），
  //   只按版本等会立刻拿到上一份缓存的数据（第一版测试就这么误判过）。
  const modUntil = async (ok, label) => {
    const deadline = Date.now() + 10000
    let last = null
    while (Date.now() < deadline) {
      const r = await page.evaluate((id) => window.api.listMods().then((x) => x.mods.find((m) => m.id === id)), MOD_ID)
      last = r
      if (r && ok(r)) return r
      await sleep(250)
    }
    assert.fail(`${label}：等了 10 秒没等到，当前 version=${last?.version} url=${last?.download?.url}`)
  }

  // ① 更新的版本 + 合格直链
  served = { generatedAt: 'test-1', mods: { [MOD_ID]: { version: newerVer, download: { url: OK_URL, size: 12345, sha256: SHA, filename: 'x.zip' } } } }
  const m1 = await modUntil((m) => m.version === newerVer && m.download?.url === OK_URL, '远端新版本生效')
  assert.equal(m1.version, newerVer, `远端更新的版本应生效：${baseVer} → ${newerVer}`)
  assert.equal(m1.download.url, OK_URL, '下载地址应换成远端的')
  assert.equal(m1.download.sha256, SHA)
  assert.equal(m1.name, bundled.name, '名字这类字段不许被远端改')
  assert.equal(m1.installedMarker, bundled.installedMarker, 'installedMarker 不许被远端改')
  assert.equal(m1.cover, bundled.cover, '封面不许被远端改')
  pass('远端新版本覆盖自带清单', `${baseVer} → ${m1.version}`)

  // ② 站外直链：版本能抬，但下载地址必须退回自带的
  served = { generatedAt: 'test-2', mods: { [MOD_ID]: { version: newerVer, download: { url: 'https://evil.example.com/x.zip', size: 1, sha256: SHA } } } }
  const m2 = await modUntil((m) => m.download?.url === bundled.download.url, '站外直链被剔掉')
  assert.equal(m2.version, newerVer, '版本还是能抬（只是 download 不认）')
  pass('站外直链被拒', m2.download.url.slice(0, 48) + '…')

  // ③ 更旧的版本：一点都不许覆盖
  served = { generatedAt: 'test-3', mods: { [MOD_ID]: { version: olderVer, download: { url: OK_URL, size: 1, sha256: SHA } } } }
  const m3 = await modUntil((m) => m.version === baseVer, '更旧版本不覆盖')
  assert.equal(m3.download.url, bundled.download.url, '更旧版本连下载地址也不许换')
  pass('更旧版本不覆盖', `停在 ${m3.version}`)

  // ④ 更新源挂掉：用缓存，游戏库照常能开
  served = { generatedAt: 'test-4', mods: { [MOD_ID]: { version: newerVer, download: { url: OK_URL, size: 12345, sha256: SHA } } } }
  await modUntil((m) => m.version === newerVer && m.download?.url === OK_URL, '缓存里先存上新版本')
  served = null // 服务端开始 500
  const all = await page.evaluate(() => window.api.listMods())
  assert.ok(all.mods.length >= 3, '更新源挂了游戏库照样列得出全部 mod')
  const m5 = all.mods.find((m) => m.id === MOD_ID)
  assert.equal(m5.version, newerVer, '更新源挂了应继续用上次缓存')
  const cached = JSON.parse(await fs.readFile(path.join(profile, 'data', 'mods-catalog.json'), 'utf8'))
  assert.equal(cached.mods[MOD_ID].version, newerVer, '缓存文件应落盘')
  pass('更新源挂掉用缓存', `${all.mods.length} 款 mod 照常列出`)

  // ⑤ 只下发状态（版本不变）：待发售 → 游戏库看得到、带 status，首次安装被拒
  // 后台「发布状态」以线上正在生效的清单为底：版本/直链照旧、只多一个 status
  served = { generatedAt: 'test-5', mods: { [MOD_ID]: { version: newerVer, download: { url: OK_URL, size: 12345, sha256: SHA }, status: 'coming_soon' } } }
  const m6 = await modUntil((m) => m.status === 'coming_soon', '待发售状态生效')
  assert.equal(m6.version, newerVer, '状态和版本互不影响')
  const blocked = await page.evaluate((id) => window.api.installMod(id), MOD_ID)
  assert.equal(blocked.ok, false)
  assert.match(String(blocked.error), /尚未发售/, '待发售的不能首次安装')
  pass('待发售：可见、带 status、拒绝首次安装', blocked.error)

  // ⑥ 下架：页面拿到的清单里没有它
  served = { generatedAt: 'test-6', mods: { [MOD_ID]: { version: newerVer, download: { url: OK_URL, size: 12345, sha256: SHA }, status: 'unlisted' } } }
  {
    const deadline = Date.now() + 10000
    let gone = false
    while (Date.now() < deadline) {
      const list = await page.evaluate(() => window.api.listMods())
      if (!list.mods.some((m) => m.id === MOD_ID)) { gone = true; break }
      await sleep(250)
    }
    assert.ok(gone, '下架的 mod 应从页面清单里消失')
  }
  pass('下架：页面清单里不再出现')

  // ⑦ 定义包（2026-09-14）：清单里带 schema → 客户端下回来验 sha256 → 菜单 / 参数说明 / 键位换成远端的，不用发客户端
  const { createHash } = await import('node:crypto')
  const bundledPranks = JSON.parse(await fs.readFile(path.join(root, 'mods-catalog', 'schemas', 'dontscream', 'pranks.json'), 'utf8'))
  const NEW_ID = 'zl_test_newprank'
  const bundle = {
    gameId: 'dontscream', version: newerVer,
    pranks: [...bundledPranks, { id: NEW_ID, name: '回归新整蛊', cat: '回归专用组' }],
    config: { version: '9.9.9', groups: [{ id: 'zltest', name: '回归组' }], fields: [{ key: 'ZlTestField', label: '回归字段', type: 'number', group: 'zltest', default: 1 }] },
    binds: { menu: 'F9', leaderboard: 'BackQuote', binds: { [NEW_ID]: 'K' } }
  }
  servedSchema = JSON.stringify(bundle)
  const schemaSha = createHash('sha256').update(servedSchema).digest('hex')
  served = { generatedAt: 'test-7', mods: { [MOD_ID]: { version: newerVer, download: { url: OK_URL, size: 12345, sha256: SHA }, schema: { url: schemaUrl, size: servedSchema.length, sha256: schemaSha } } } }
  {
    const deadline = Date.now() + 15000
    let cat = null
    while (Date.now() < deadline) {
      cat = await page.evaluate(() => window.api.prankCatalog())
      if (cat?.dontscream?.some((g) => g.items.some((p) => p.id === NEW_ID))) break
      await sleep(250)
    }
    const group = cat?.dontscream?.find((g) => g.name === '回归专用组')
    assert.ok(group && group.items[0]?.name === '回归新整蛊', `远端定义包里的新整蛊应出现在菜单里（分组名 = cat）；当前分组：${(cat?.dontscream || []).map((g) => g.name).join('/')}`)
    const bundledGroups = new Set(bundledPranks.map((p) => p.cat)).size
    assert.equal(cat.dontscream.length, bundledGroups + 1, `自带 ${bundledGroups} 组 + 新的 1 组`)
    assert.ok(cat['4wheel-challenge']?.length >= 10 && cat.librarian?.length >= 4, '别的游戏照常是自带定义')
    // 参数说明 / 整蛊清单 / 默认键位三个出口都换成远端的（先把当前游戏切到不要尖叫）
    await page.evaluate(() => window.api.setGameCurrent('dontscream'))
    const cfg = await page.evaluate(() => window.api.readConfig())
    assert.ok(cfg.schema.fields.some((f) => f.key === 'ZlTestField' && f.label === '回归字段'), '参数页的说明应来自远端定义包')
    assert.equal(cfg.schema.version, '9.9.9')
    const pr = await page.evaluate(() => window.api.readPranks())
    assert.ok(pr.pranks.some((p) => p.id === NEW_ID), '整蛊清单应含远端新整蛊')
    assert.equal(pr.defaults.menu, 'F9', '默认键位应来自远端定义包')
    assert.equal(pr.defaults.binds[NEW_ID], 'K')
    const onDisk = JSON.parse(await fs.readFile(path.join(profile, 'data', 'schemas', 'dontscream.json'), 'utf8'))
    assert.equal(onDisk.pranks.length, bundledPranks.length + 1, '定义包应落盘（离线下次启动还在）')
  }
  pass('远端定义包生效：菜单 / 参数说明 / 键位都换成远端的，无需发客户端')

  // ⑧ sha256 对不上的定义包：一律不认，继续用上一份
  servedSchema = JSON.stringify({ ...bundle, pranks: [{ id: 'evil', name: '篡改的', cat: 'x' }] })
  served = { generatedAt: 'test-8', mods: { [MOD_ID]: { version: newerVer, download: { url: OK_URL, size: 12345, sha256: SHA }, schema: { url: schemaUrl, size: servedSchema.length, sha256: 'c'.repeat(64) } } } }
  await modUntil(() => true, '清单刷新')
  await sleep(1500)
  {
    const cat = await page.evaluate(() => window.api.prankCatalog())
    assert.ok(cat.dontscream.some((g) => g.items.some((p) => p.id === NEW_ID)), '上一份验过的定义包应保留')
    assert.ok(!cat.dontscream.some((g) => g.items.some((p) => p.id === 'evil')), 'sha256 不符的定义包不许生效')
  }
  pass('sha256 不符的定义包被拒，沿用上一份')
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile, catalogUrl }, null, 2))
  await app.close()
  server.close()
  console.log(`SUMMARY ${checks.length}/8 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1
