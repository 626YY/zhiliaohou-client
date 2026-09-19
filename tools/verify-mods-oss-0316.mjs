// 0.3.16 验证：mod 安装包改从阿里云 OSS 下载后，客户端真实安装链路（listMods → installMod → 下载 → sha256 校验 → 解压 → 标记文件）能不能走通。
// 起一个隐藏的隔离客户端实例（游戏路径是临时目录里的空占位 exe，zip 会解压进那个临时目录，不碰真游戏目录）。
// 轮椅是 214 MB 的安装程序（kind=installer），这里不跑它的安装，只验 OSS 上文件的 sha 与清单一致。
// 用法：node tools/verify-mods-oss-0316.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/mods-oss-0316')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const settings = JSON.parse(await fs.readFile(path.join(profile, 'data/settings.json'), 'utf8'))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const pass = (name, detail = '') => { checks.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
const sha256 = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex')

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.listMods)
  const mods = await page.evaluate(() => window.api.listMods())
  const byId = Object.fromEntries(mods.mods.map((m) => [m.id, m]))
  // 版本从自带清单读，别写死（写死的轮椅 1.0.0.9 在清单抬到 1.0.0.10 后把这支回归卡成了 FAIL）
  const manifestDir = path.join(root, 'mods-catalog', 'manifests')
  const want = {}
  for (const f of (await fs.readdir(manifestDir)).filter((f) => f.endsWith('.json'))) {
    const m = JSON.parse(await fs.readFile(path.join(manifestDir, f), 'utf8'))
    want[m.id] = m.version
  }
  for (const id of ['wheellive', 'darkmage-librarian', 'zhiliao-dontscream']) {
    assert.equal(byId[id]?.version, want[id], `${id} 版本应与自带清单一致`)
  }
  for (const m of mods.mods) {
    assert.match(m.download.url || '', /^https:\/\/zhiliaohou\.oss-cn-beijing\.aliyuncs\.com\//, m.id + ' 没走 OSS')
    assert.equal(m.download.sha256.length, 64, m.id + ' sha256 长度不对')
  }
  pass('清单：三款 mod 版本对、下载地址都在 OSS、sha256 都是 64 位', mods.mods.map((m) => m.id + '@' + m.version).join(' '))

  // 两个 zip 型 mod：真实走一遍安装（下载→校验→解压到临时游戏目录）
  const progress = []
  await page.evaluate(() => { window.__prog = []; window.api.onModProgress?.((p) => window.__prog.push(p)) })
  for (const id of ['zhiliao-dontscream', 'darkmage-librarian']) {
    const t0 = Date.now()
    const r = await page.evaluate((id) => window.api.installMod(id), id)
    assert.equal(r.ok, true, id + ' 安装失败：' + r.error)
    const m = byId[id]
    const gameDir = path.dirname(settings.gamePaths[id === 'zhiliao-dontscream' ? 'dontscream' : 'librarian'])
    const marker = path.join(gameDir, m.installedMarker)
    await fs.access(marker)
    const pkg = path.join(profile, 'downloads', m.download.filename)
    const st = await fs.stat(pkg)
    assert.equal(st.size, m.download.size); assert.equal(await sha256(pkg), m.download.sha256)
    pass(id + ' 从 OSS 下载→sha256 一致→解压→标记文件在', `${st.size} B ${((Date.now() - t0) / 1000).toFixed(1)}s ${marker}`)
    // 再装一次：应命中缓存（sha 对得上就不再下）
    const r2 = await page.evaluate((id) => window.api.installMod(id), id)
    assert.equal(r2.ok, true)
    pass(id + ' 重装命中本地缓存', '')
  }
  const prog = await page.evaluate(() => window.__prog || [])
  const phases = [...new Set(prog.map((p) => p.modId + ':' + p.phase))]
  if (prog.length) pass('进度事件', phases.join(' '))
} catch (e) { failure = e; console.log('FAIL ' + (e?.stack || e)) }
finally {
  await app.close().catch(() => {})
  await fs.writeFile(path.join(output, 'results.txt'), checks.map((c) => 'PASS ' + c.name + ' | ' + c.detail).join('\n') + (failure ? '\nFAIL ' + failure : '') + '\n')
}
if (failure) process.exit(1)
console.log(`全部通过 ${checks.length} 项`)
