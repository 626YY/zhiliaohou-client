// 内存守卫验证（隔离 userData、隐藏窗口）：不真把机器内存耗光，用探针接口按「可用 MB」跑判定。
//   1. 启动记 [memory] 内存守卫已启动（吃紧线 / 告急线来自设置）
//   2. 绿幕排队里堆 8 条规则视频 → 探针 100MB（告急）：排队被清空、日志「已清掉 N 条」、连接器面板有提示
//   3. 告急期间再来一条规则视频：不播、错误文案说明原因、排队仍为 0
//   4. 探针 5000MB（恢复）：日志「降级解除」、规则视频又能播 / 排队
//   5. 关掉守卫（memoryGuard=false）后探针 100MB 不再降级
// 用法：node tools/verify-memory-guard.mjs   （先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'memory-guard')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const results = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function check(name, fn) { try { const d = await fn(); results.push(true); console.log(`PASS ${name}${typeof d === 'string' && d ? '  ' + d : ''}`) } catch (e) { results.push(false); console.log(`FAIL ${name}  ${e?.message || e}`) } }
async function waitFor(fn, label, timeout = 15_000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return } catch { /* 再等 */ } await sleep(200) } throw new Error('等超时：' + label) }

await fs.mkdir(outputDir, { recursive: true })
const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const log = path.join(profile, 'logs', 'main.log')
const longVideo = path.join(profile, '长视频.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=15:d=120', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longVideo], { windowsHide: true })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
const page = await app.firstWindow()
await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
await page.evaluate(async () => { await window.api.register('mem_user', 'Fixture123!', '内存'); await window.api.login('mem_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
const api = (fn, arg) => page.evaluate(fn, arg)
const readLog = () => fs.readFile(log, 'utf8').catch(() => '')
const connectorLog = async () => (await api(() => window.api.connectorLog?.() ?? window.api.getConnectorLog?.() ?? []))

await check('启动：内存守卫已启动（默认吃紧 800 / 告急 400）', async () => { await waitFor(async () => /\[memory\] 内存守卫已启动：吃紧线 800MB \/ 告急线 400MB/.test(await readLog()), 'memory 行'); return (await readLog()).match(/\[memory\] [^\n]*/)[0].slice(9, 90) })

// 绿幕 1 号开着，一条 120 秒长视频占住，后面 8 条排队
await api(() => window.api.greenScreenClose()); await sleep(200)
assert.equal((await api(() => window.api.greenScreenOpen('', 'video', '', 1))).ok, true)
assert.equal((await api((v) => window.api.entertainmentRuleAdd({ id: '', giftName: '长视频', actionType: 'command', commandCmd: 'video-play', commandParam: v, enabled: true, queueMode: 'instant', multiply: true, extraActions: [] }), longVideo)).ok, true)
await api(() => window.api.connectorSimulate('礼物: 长视频 ×9  by 内存测试'))
await check('准备：绿幕排队里有 8 条', async () => { await waitFor(async () => (await api(() => window.api.greenScreenState())).queued >= 8, '排队 8 条', 20_000); return `排队 ${(await api(() => window.api.greenScreenState())).queued}` })

await check('告急：探针 100MB → 排队原样保留 8 条（只停不丢）、日志「排队中的 8 条先停着不播」', async () => {
  const level = await api(() => window.api.memoryGuardProbe(100))
  assert.equal(level, 'critical')
  await waitFor(async () => /排队中的 8 条先停着不播/.test(await readLog()), '告急日志')
  assert.equal((await api(() => window.api.greenScreenState())).queued, 8)
})
await check('告急期间：窗口空出来也不开播，新来的规则视频照样进队列（一条不丢）', async () => {
  // 把正在播的长视频撤掉：窗口空了，告急中也不能从队列里拿来播
  await api(() => window.api.greenScreenClose(1)); await sleep(300)
  assert.equal((await api(() => window.api.greenScreenOpen('', 'video', '', 1))).ok, true)
  await sleep(800)
  const beforeQ = (await api(() => window.api.greenScreenState())).queued
  await api(() => window.api.connectorSimulate('礼物: 长视频 ×3  by 内存测试'))
  await sleep(2000)
  const st = await api(() => window.api.greenScreenState())
  assert.equal(st.queued, beforeQ + 3, JSON.stringify({ beforeQ, queued: st.queued }))
  assert.ok(!st.slots.find(s => s.slot === 1)?.src, '告急期间不该开播')
})
await check('恢复：探针 5000MB → 日志「降级解除…按顺序补播」、停着的视频开始播、队列减少', async () => {
  const before = (await api(() => window.api.greenScreenState())).queued
  const level = await api(() => window.api.memoryGuardProbe(5000))
  assert.equal(level, 'normal')
  await waitFor(async () => /降级解除（期间攒下 \d+ 条自动视频，现在按顺序补播）/.test(await readLog()), '恢复日志')
  await waitFor(async () => { const s = await api(() => window.api.greenScreenState()); return !!s.slots.find(x => x.slot === 1)?.src && s.queued < before }, '补播开始', 20_000)
})
await check('关掉守卫：探针 100MB 不再降级', async () => {
  await api(() => window.api.saveSettings({ memoryGuard: false }))
  const level = await api(() => window.api.memoryGuardProbe(100))
  assert.equal(level, 'normal')
})
await check('自定义阈值：吃紧 2000 / 告急 1500 → 探针 1600 为吃紧、1400 为告急', async () => {
  await api(() => window.api.saveSettings({ memoryGuard: true, memoryTightMb: 2000, memoryCriticalMb: 1500 }))
  assert.equal(await api(() => window.api.memoryGuardProbe(1600)), 'tight')
  assert.equal(await api(() => window.api.memoryGuardProbe(1400)), 'critical')
  assert.equal(await api(() => window.api.memoryGuardProbe(2500)), 'normal')
})
try { await app.evaluate(({ app }) => app.quit()) } catch { /* 已退出 */ }
await sleep(1500)
const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS`)
process.exit(bad ? 1 : 0)
