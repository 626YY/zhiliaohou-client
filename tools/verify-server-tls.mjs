// 服务器 HTTPS 8771（自签证书 + 指纹钉死）与邮箱 session：隐藏隔离客户端里走真实主进程 → 线上服务器。
//  ① 老设置里的 http://…:8770 启动后自动迁移成 https://…:8771；② 查授权（net.fetch + 证书指纹校验）能拿到 ok；
//  ③ 错密码登录拿到的是服务器给的文案（证明 TLS 握手 + 指纹校验通过）；④ 指到别的 https 主机不受钉证书影响（OSS latest.yml 200）。
// 用法：node tools/verify-server-tls.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output/playwright/server-tls'); await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: true })
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({ serverUrl: 'http://47.251.93.171:8770', currentGameId: 'dontscream' }))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
const checks = []
const pass = (n, d = '') => { checks.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }
let failure
try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.api?.getSettings)
  const s = (await page.evaluate(() => window.api.getSettings())).settings
  assert.equal(s.serverUrl, 'https://47.251.93.171:8770', '老地址没迁移：' + s.serverUrl)
  pass('设置里的明文地址自动迁移到 https://…:8770（同端口分流）')
  const t0 = Date.now()
  const lic = await page.evaluate(() => window.api.emailGetLicense('nobody@example.com'))
  assert.equal(lic.ok, true, '查授权失败：' + JSON.stringify(lic))
  pass('HTTPS + 证书指纹校验通过，查授权 ok', (Date.now() - t0) + 'ms ' + JSON.stringify(lic).slice(0, 80))
  const login = await page.evaluate(() => window.api.emailLogin('nobody@example.com', 'wrong-password'))
  assert.equal(login.ok, false)
  assert.ok(/邮箱或密码不正确/.test(login.error || ''), '登录错误文案不是服务器给的：' + login.error)
  pass('错密码登录拿到服务器文案（TLS 通）', login.error)
  const cs = await page.evaluate(() => window.api.selfCheck())
  const srv = (cs.items || []).find((i) => i.id === 'server')
  assert.ok(srv && srv.level !== 'error', '自检「服务器连接」不该报错：' + JSON.stringify(srv))
  pass('环境自检「服务器连接」走 https 正常', srv.detail)
} catch (e) { failure = e; console.log('FAIL ' + (e?.stack || e)) }
finally { await app.close().catch(() => {}) }
if (failure) process.exit(1)
console.log(`全部通过 ${checks.length} 项`)
