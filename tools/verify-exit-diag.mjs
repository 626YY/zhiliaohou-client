// 退出诊断真机验证：真起 Electron（独立 userData、隐藏窗口），走三条死法，核对 main.log / run-state.json / 退出码记录员。
//   1. 正常关闭（关主窗口）：[window]→[quit]→[exit] 全在，标记盖 clean 章，记录员写「已退出 code=0x00000000 正常；标记=正常退出」
//   2. 被强杀（TerminateProcess）：日志无 [quit]，记录员写「消失 code=0x00000001 被结束」；下次启动 [unclean-exit] 带死前资源
//   3. 原生崩溃（process.crash）：Crashpad 落 .dmp，记录员写非 0 退出码；下次启动 [crash-dump]
//   附：上次异常退出 / 转储 会 POST 到 settings.serverUrl（这里指向本地假服务器，不碰生产 /api/error）
// 用法：node tools/verify-exit-diag.mjs   （先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'exit-diag')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const results = []
function pass(name, detail = '') { results.push({ name, ok: true, detail }); console.log(`PASS ${name}${detail ? '  ' + detail : ''}`) }
function fail(name, detail = '') { results.push({ name, ok: false, detail }); console.log(`FAIL ${name}${detail ? '  ' + detail : ''}`) }
async function check(name, fn) { try { const d = await fn(); pass(name, typeof d === 'string' ? d : '') } catch (e) { fail(name, e?.message || String(e)) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

let userDataDir, entry, logFile, markerFile
const uploads = []

async function readLog() { return fs.readFile(logFile, 'utf8').catch(() => '') }
async function waitForLog(re, timeoutMs = 10_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const text = await readLog()
    const m = text.match(re)
    if (m) return m
    await sleep(300)
  }
  throw new Error(`等 ${timeoutMs}ms 没在 main.log 里见到 ${re}`)
}
async function readMarker() { return JSON.parse(await fs.readFile(markerFile, 'utf8')) }

function recorderProcesses(pid) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*exit-recorder.ps1*' -and $_.CommandLine -like '* ${pid} *' } | ForEach-Object { '{0}(parent {1})' -f $_.ProcessId, $_.ParentProcessId }`
  ], { encoding: 'utf8' })
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

async function launch() {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
  await app.firstWindow()
  // Playwright 在 Windows 上起的 electron.exe 外面还套一层同参数的父进程（直接双击没有这层），
  // 真正跑主进程代码的是里面那个：pid 从主进程里问，杀也杀它
  const pid = await app.evaluate(() => process.pid)
  const exited = new Promise(resolve => app.process().once('exit', code => resolve(code)))
  return { app, pid, exited }
}

async function waitGone(pid, timeoutMs = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { process.kill(pid, 0) } catch { return true }
    await sleep(300)
  }
  return false
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  entry = await writeHiddenElectronBootstrap(root, userDataDir)
  logFile = path.join(userDataDir, 'logs', 'main.log')
  markerFile = path.join(userDataDir, 'logs', 'run-state.json')

  // 本地假 /api/error：收什么记什么
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { uploads.push({ url: req.url, body }); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":1}') })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const settingsPath = path.join(userDataDir, 'data', 'settings.json')
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
  settings.serverUrl = `http://127.0.0.1:${server.address().port}`
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))

  // ---------- 1. 正常关闭 ----------
  let { app, pid, exited } = await launch()
  await check('启动：[sys] 机器信息 + [perf] 首条资源曲线', async () => {
    await waitForLog(/\[sys\] Windows_NT .* 内存 \d+MB/, 8000)
    const m = await waitForLog(/\[perf\] 系统剩余 (\d+)MB\/(\d+)MB \| 客户端 (\d+) 进程共 (\d+)MB/, 8000)
    return `系统剩余 ${m[1]}MB，客户端 ${m[3]} 进程 ${m[4]}MB`
  })
  await check('启动：run-state.json 心跳标记（pid 对得上、没盖 clean 章）', async () => {
    const st = await readMarker()
    assert.equal(st.pid, pid); assert.ok(!st.clean); assert.ok(st.totalWsMb > 0); assert.ok(st.sysTotalMb > 0)
    return `pid ${pid} 总内存 ${st.totalWsMb}MB`
  })
  await check('启动：退出码记录员在等（隐藏 powershell，命令行带主进程 pid）', async () => {
    for (let i = 0; i < 10 && !recorderProcesses(pid).length; i++) await sleep(500)
    const ps = recorderProcesses(pid)
    assert.equal(ps.length, 1, `记录员进程数 ${ps.length}`)
    return `记录员 pid ${ps[0]}`
  })
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close() })
  await check('正常关闭：主进程退出', async () => { assert.ok(await waitGone(pid), '主进程 15 秒没退出'); const c = await Promise.race([exited, sleep(5000).then(() => 'timeout')]); return `外层 code ${c}` })
  await check('正常关闭：[window]→[quit before-quit]→[quit exitCode]→[exit] 链路全在', async () => {
    const text = await readLog()
    // 没开挂件时 window-all-closed 先到并 quit，closeAllOutputWindows 那句就不会再补；两条路二选一
    assert.ok(/\[quit\] 主窗口关闭，挂件已全部销毁，退出程序/.test(text) || /\[quit\] window-all-closed/.test(text), '缺退出入口留痕')
    for (const re of [/\[window\] 主窗口 close/, /\[quit\] before-quit：主窗口已关闭（收工）/, /\[quit\] quit exitCode=0：主窗口已关闭（收工）/, /\[exit\] 主进程退出 code=0/]) assert.match(text, re)
  })
  await check('正常关闭：标记盖了 clean 章', async () => { const st = await readMarker(); assert.equal(st.clean?.reason, '主窗口已关闭（收工）') })
  await check('正常关闭：记录员写下「已退出 code=0x00000000 正常；标记=正常退出」并自行退出', async () => {
    await waitForLog(new RegExp(`\\[watchdog\\] 主进程 pid=${pid} 已退出 code=0x00000000 正常；标记=正常退出（主窗口已关闭（收工））`), 8000)
    for (let i = 0; i < 10 && recorderProcesses(pid).length; i++) await sleep(500)
    assert.equal(recorderProcesses(pid).length, 0, '记录员没退出')
  })

  // ---------- 2. 被强杀 ----------
  ;({ app, pid, exited } = await launch())
  await check('再启动：认出上次是正常退出', async () => { await waitForLog(/\[exit-diag\] 上次运行 .* 正常退出：主窗口已关闭（收工）/, 8000) })
  // 记录员是经 wscript 异步拉起的，等它「就位」再杀（真实直播里程序至少跑几分钟，不存在这个竞争）
  await waitForLog(new RegExp(`退出码记录员就位，盯着主进程 pid=${pid}`), 15_000)
  await sleep(500)
  process.kill(pid) // Windows 上 = TerminateProcess，退出码 1，主进程零机会写日志
  const code2 = (await waitGone(pid)) ? 'gone' : 'timeout'
  await check('强杀：主进程消失，日志里没有任何 [quit]/[exit]', async () => {
    assert.notEqual(code2, 'timeout')
    const text = await readLog()
    const afterSecondStart = text.slice(text.lastIndexOf('[start] 知了猴整蛊台'))
    assert.ok(!/\[quit\]|\[exit\]/.test(afterSecondStart), '不该有退出留痕')
    return `code ${code2}`
  })
  await check('强杀：记录员写下「消失 code=0x00000001 被结束…；标记=没走正常退出流程」', async () => {
    await waitForLog(new RegExp(`\\[watchdog\\] 主进程 pid=${pid} 消失 code=0x00000001 被结束（taskkill / 任务管理器 / 杀毒软件）；标记=没走正常退出流程`), 12_000)
  })

  // ---------- 3. 原生崩溃 ----------
  ;({ app, pid, exited } = await launch())
  await check('再启动：[unclean-exit] 认出上次异常退出，带最后心跳与死前资源', async () => {
    const m = await waitForLog(/\[unclean-exit\] 上次运行没有走正常退出流程[^\n]*最后心跳 (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[^\n]*客户端 (\d+) 个进程共 (\d+)MB[^\n]*系统剩余内存 (\d+)MB/, 8000)
    return `最后心跳 ${m[1]}，${m[2]} 进程 ${m[3]}MB，系统剩余 ${m[4]}MB`
  })
  await check('再启动：异常退出记录 POST 到了 serverUrl 的 /api/error（本地假服务器）', async () => {
    for (let i = 0; i < 60 && !uploads.length; i++) await sleep(500)
    assert.ok(uploads.length, '没收到上报')
    const body = JSON.parse(uploads[0].body)
    assert.equal(uploads[0].url, '/api/error')
    assert.ok(body.e.some(e => e.tag === 'unclean-exit'))
    await waitForLog(/\[exit-diag\] 异常退出记录已上报服务器（1 条）/, 5000)
    return `${body.e.length} 条`
  })
  await waitForLog(new RegExp(`退出码记录员就位，盯着主进程 pid=${pid}`), 15_000)
  await app.evaluate(() => { setTimeout(() => process.crash(), 200) })
  const code3 = (await waitGone(pid, 20_000)) ? 'gone' : 'timeout'
  await check('原生崩溃：主进程退出码非 0，记录员记下退出码', async () => {
    assert.notEqual(code3, 'timeout')
    const m = await waitForLog(new RegExp(`\\[watchdog\\] 主进程 pid=${pid} 消失 code=(0x[0-9A-F]{8}) ([^；]*)；标记=没走正常退出流程`), 10_000)
    return `code ${m[1]} ${m[2]}`
  })
  await check('原生崩溃：Crashpad 在 userData/Crashpad 留下 .dmp', async () => {
    const dumps = []
    const walk = async d => { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (/\.dmp$/i.test(e.name)) dumps.push(p) } }
    for (let i = 0; i < 20 && !dumps.length; i++) { dumps.length = 0; await walk(path.join(userDataDir, 'Crashpad')); if (!dumps.length) await sleep(500) }
    assert.ok(dumps.length, '没有转储')
    const st = await fs.stat(dumps[0])
    return `${path.basename(dumps[0])} ${Math.round(st.size / 1024)}KB`
  })

  // ---------- 4. 崩溃后再启动 ----------
  ;({ app, pid, exited } = await launch())
  await check('再启动：[crash-dump] 记下新转储路径', async () => { const m = await waitForLog(/\[crash-dump\] 发现崩溃转储 ([^\n（]+)（(\d+)KB/, 8000); return `${path.basename(m[1])} ${m[2]}KB` })
  await app.evaluate(({ app }) => app.quit())
  await waitGone(pid)
  await check('app.quit() 直接退出：也留 [quit] 且标记 clean', async () => {
    // app.quit() 会先关窗，window-all-closed 抢先标注了理由；只要有 quit 留痕且盖章即可
    await waitForLog(/\[quit\] quit exitCode=0：/, 5000)
    const st = await readMarker(); assert.ok(st.clean)
  })

  server.close()
  const bad = results.filter(r => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} PASS  userData=${userDataDir}`)
  if (bad.length) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
