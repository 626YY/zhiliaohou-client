// 诊断报告一键上传的 e2e（2026-09-07：用户「诊断报错为啥不能直接上传呢」）。
// 起一个本地假服务器冒充 /api/error，按请求次数依次返回 200 / 429 / 直接断开，
// 一个 Electron 实例就能把「传成功」「被限流」「连不上」三条路都走一遍。
// 覆盖：① 真的把报告传出去了、分片都在服务器的 2000 字上限内、一次请求发完
//       ② 给主播一个能报给客服的编号 ③ 429 说「过十分钟再试」④ 连不上给人话
// 用法：node tools/verify-diag-upload.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'diag-upload')
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

// ---- 假游戏目录：文件齐全，但没有任何加载证据（诊断报告最长的那种情形）----
const EXE = 'DontScream-Win64-Shipping.exe'
const win64 = path.join(out, 'game', 'DontScream', 'Binaries', 'Win64')
for (const rel of ['dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/Mods/mods.txt', 'ue4ss/Mods/zhiliao/enabled.txt',
  'ue4ss/Mods/zhiliao/Scripts/main.lua', 'ue4ss/Mods/zhiliao/config.json',
  'ue4ss/Mods/zhiliao/connector.py', 'ue4ss/Mods/zhiliao/douyin_room.py']) {
  const p = path.join(win64, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, rel.endsWith('.json') ? '{}' : 'zltest')
}
await fs.writeFile(path.join(win64, EXE), 'zltest exe')
// 塞一份够长的加载器日志，逼出多片上传
const noise = Array.from({ length: 400 }, (_, i) => `[2026-09-07 20:36:39.${i}] FStructProperty::Member_${i} = 0x${i.toString(16)}`)
await fs.writeFile(path.join(win64, 'ue4ss', 'UE4SS.log'), [
  ...noise,
  "[2026-09-07 20:36:39.829] Error executing script: main.lua:22: F:/SteamLibrary/x/ue4ss/zhiliao.log: No such file or directory"
].join('\r\n'))

// ---- 假服务器：第 1 次 200、第 2 次 429、第 3 次直接断开 ----
const seen = []
let hit = 0
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    hit += 1
    seen.push({ url: req.url, method: req.method, body: Buffer.concat(chunks).toString('utf8'), ct: req.headers['content-type'] })
    if (hit === 1) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":1}') }
    if (hit === 2) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"ok":0}') }
    res.destroy()   // 第 3 次：连接直接断，模拟服务器挂了
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({
  currentGameId: 'dontscream',
  gamePaths: { dontscream: path.join(win64, EXE) },
  gamePath: path.join(win64, EXE),
  gameExeName: EXE,
  guideSeen: true,
  serverUrl: `http://127.0.0.1:${port}`   // 本地 http：证书钉只对真服务器 IP 生效，这里不受影响
}))
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
  await page.waitForFunction(() => Boolean(window.api?.modDiagnoseUpload))
  const upload = () => page.evaluate(() => window.api.modDiagnoseUpload('dontscream'))

  // ---- ① 传成功 ----
  const r1 = await upload()
  assert.equal(r1.ok, true, `上传应该成功：${JSON.stringify(r1)}`)
  assert.equal(seen.length, 1, `报告必须一次请求发完（发了 ${seen.length} 次，会把自己限流掉）`)
  assert.equal(seen[0].method, 'POST')
  assert.equal(seen[0].url, '/api/error')
  assert.match(String(seen[0].ct || ''), /application\/json/)
  const body = JSON.parse(seen[0].body)
  assert.ok(Array.isArray(body.e) && body.e.length >= 2, `长报告应该分成多片：${body.e?.length}`)
  assert.ok(body.e.length <= 50, `一批最多 50 条，实际 ${body.e.length}`)
  assert.ok(body.v && /^\d+\.\d+\.\d+/.test(body.v), `要带客户端版本：${body.v}`)
  for (const it of body.e) {
    assert.ok(it.stack.length <= 2000, `单片超过服务器 2000 字上限：${it.stack.length}`)
    assert.equal(it.tag, 'diag')
    assert.match(it.msg, /^诊断 \d{4}-[A-Z0-9]{4} dontscream 第\d+\/\d+片$/, `片标题格式不对：${it.msg}`)
  }
  assert.ok(Buffer.byteLength(seen[0].body) <= 64 * 1024, `body 超过服务器 64KB 上限：${Buffer.byteLength(seen[0].body)}`)
  pass('一次请求把报告传完', `${body.e.length} 片 / ${Buffer.byteLength(seen[0].body)} 字节`)

  // ---- ② 编号：主播要能念给客服，服务器那边也认得出 ----
  assert.match(r1.code, /^\d{4}-[A-Z0-9]{4}$/, `编号格式不对：${r1.code}`)
  assert.ok(body.e.every((it) => it.msg.includes(r1.code)), '每一片都要带上编号，否则捞不成一份')
  const joined = body.e.map((it) => it.stack).join('')
  assert.match(joined, /知了猴整蛊器 诊断报告/, '传上去的应该就是那份诊断报告')
  assert.match(joined, /No such file or directory/, '关键报错要在报告里')
  pass('给主播一个编号，且每片都带着它', r1.code)

  // ---- ③ 被限流 → 说人话 ----
  const r2 = await upload()
  assert.equal(r2.ok, false)
  assert.match(r2.error, /太频繁|十分钟/, `429 应该说清楚怎么办：${r2.error}`)
  pass('被限流 → 提示过十分钟再试', r2.error)

  // ---- ④ 服务器断开 → 不卡住、给人话、还能引导去导出 ----
  const t0 = Date.now()
  const r3 = await upload()
  assert.equal(r3.ok, false)
  assert.ok(Date.now() - t0 < 25_000, `连不上不该等太久：${Date.now() - t0}ms`)
  assert.ok(r3.error && r3.error.length > 4, `要给一句人能看懂的原因：${r3.error}`)
  assert.ok(!/undefined|\[object/.test(r3.error), `错误信息不能是内部对象：${r3.error}`)
  assert.ok(!/net::|ERR_/.test(r3.error), `不能把 net:: 错误码摆给主播看：${r3.error}`)
  assert.match(r3.error, /存到桌面/, `连不上时要指一条退路：${r3.error}`)
  pass('服务器连不上 → 不卡住并给出原因', r3.error)
} finally {
  await app?.close().catch(() => {})
  server.close()
}
console.log(`\n诊断上传 ${passed.length}/4 PASS`)
