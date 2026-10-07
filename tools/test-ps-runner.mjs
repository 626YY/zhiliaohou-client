// PowerShell 排队执行器（src/main/ps-runner.ts）回归：真起隐藏 PowerShell 跑无害的小脚本（睡一下、往临时文件写一行），
// 不按键、不动鼠标、不弹窗、不抢前台。验：短动作同时最多 3 个、按先来后到开始、一条不丢；按住类单独一道最多 4 个；跑太久的被结束。
// 用法：node tools/test-ps-runner.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zl-ps-runner-'))
const bundle = path.join(tmp, 'runner.cjs')
await build({
  entryPoints: [path.join(root, 'src/main/ps-runner.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
  plugins: [{ name: 'stub-log', setup(b) { b.onResolve({ filter: /\/crash-log$/ }, () => ({ path: 'crash-log', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports={logLine(){}}', loader: 'js' })) } }]
})
const { createRequire } = await import('node:module')
const runner = createRequire(import.meta.url)(bundle)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }

try {
  // ---- 短动作：12 条，同时最多 3 个，按顺序开始，全部跑完 ----
  // 每条写自己的文件（同时往一个文件追加会撞文件锁，那是测试自己的问题）：内容是开始时刻
  for (let i = 0; i < 12; i++) runner.runPowerShell(`Set-Content -LiteralPath '${path.join(tmp, `s${i}.txt`)}' -Value ([DateTime]::UtcNow.Ticks); Start-Sleep -Milliseconds 300`)
  let maxShort = 0
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    const s = runner.powerShellQueueState()
    maxShort = Math.max(maxShort, s.short.running)
    if (s.short.running === 0 && s.short.waiting === 0) break
    await sleep(20)
  }
  const started = []
  for (let i = 0; i < 12; i++) {
    const t = await fs.readFile(path.join(tmp, `s${i}.txt`), 'utf8').then((s) => BigInt(s.trim()), () => null)
    if (t !== null) started.push({ i, t })
  }
  const lines = started.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)).map((x) => x.i)
  assert.ok(maxShort <= 3 && maxShort >= 2, `同时跑的短动作应 ≤3（实际最多 ${maxShort}）`)
  assert.equal(lines.length, 12, `12 条应全部执行：${lines}`)
  // 同时起 3 个时谁先写文件有先后抖动，但不会跨批：第 k 条一定在第 k+3 条之后开始之前就开始了
  assert.ok(lines.every((v, i) => Math.abs(v - i) <= 2), `大体按先来后到开始：${lines}`)
  ok(`短动作 12 条：同时最多 ${maxShort} 个、全部执行、按顺序开始（${lines.join(',')}）`)

  // ---- 按住类：6 条，单独一道最多 4 个，不占短动作的位置 ----
  for (let i = 0; i < 6; i++) runner.runPowerShell('Start-Sleep -Milliseconds 800', { long: true, timeoutMs: 20_000 })
  runner.runPowerShell(`Add-Content -LiteralPath '${path.join(tmp, 'side.txt')}' -Value side`)
  let maxLong = 0
  let shortDoneWhileLongRunning = false
  const end2 = Date.now() + 30_000
  while (Date.now() < end2) {
    const s = runner.powerShellQueueState()
    maxLong = Math.max(maxLong, s.long.running)
    if (s.long.running > 0 && await fs.access(path.join(tmp, 'side.txt')).then(() => true, () => false)) shortDoneWhileLongRunning = true
    if (s.long.running === 0 && s.long.waiting === 0 && s.short.running === 0) break
    await sleep(20)
  }
  assert.ok(maxLong <= 4 && maxLong >= 3, `按住类同时最多 4 个（实际 ${maxLong}）`)
  assert.ok(shortDoneWhileLongRunning, '按住类在跑时短动作照样能执行（不同道）')
  ok(`按住类 6 条：同时最多 ${maxLong} 个；按住期间短动作照常执行`)

  // ---- 跑太久的被结束，位置让出来 ----
  const t0 = Date.now()
  runner.runPowerShell('Start-Sleep -Seconds 20', { timeoutMs: 1500 })
  await sleep(200)
  assert.equal(runner.powerShellQueueState().short.running, 1)
  while (runner.powerShellQueueState().short.running > 0 && Date.now() - t0 < 10_000) await sleep(50)
  const took = Date.now() - t0
  assert.ok(took < 5000, `超时应在约 1.5 秒后结束（实际 ${took}ms）`)
  ok(`跑太久的在 ${took}ms 后被结束，位置让出来`)
  console.log(`\nPS RUNNER ${passed}/3 PASS`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
}
