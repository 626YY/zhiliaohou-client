// 量「点设置就转圈」：隐藏客户端（真实设置副本）里逐个 IPC 计时 + 主线程冻结探测。
// 冻结探测：把设置页会触发的重活（selfCheck / liveCompanionState(true) / obsState / gameState）一起发出去，
// 同时每 40ms 敲一次极轻的 getSettings；主线程若被同步命令卡住，轻调用的最大延迟就会飙到秒级。
// 0.3.17 及之前：selfCheck 里 python/powershell/tasklist 全是 spawnSync，冻结 3～8 秒；0.3.18 改异步后应 < 150ms。
// 默认使用隔离游戏路径；只有显式 --real-profile 才复制正式配置。
// 用法：node tools/bench-ipc-latency.mjs   （退出码 1 = 主线程最大冻结超过 400ms）
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output/playwright/ipc-bench'); await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const isolated = !process.argv.includes('--real-profile')
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: isolated })
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
const src = path.join(process.env.APPDATA, 'zhiliao-client', 'data', 'settings.json')
if (!isolated) await fs.copyFile(src, path.join(profile, 'data', 'settings.json'))
console.log(isolated ? '隔离游戏路径基准（不访问正式配置）' : '真实配置副本基准')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
let worst = 0
try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.api?.gamesList)
  await new Promise((r) => setTimeout(r, 1500))
  const calls = [['getSettings'], ['gamesList'], ['detectGamePath'], ['listMods'], ['gameState'], ['liveState'], ['obsState'], ['liveCompanionState', true], ['modHealth', 'dontscream'], ['selfCheck'], ['readPranks']]
  for (const [c, arg] of calls) {
    const ms = await page.evaluate(async ([name, a]) => { const t = performance.now(); try { await window.api[name](a) } catch (e) { return -1 } return Math.round(performance.now() - t) }, [c, arg])
    console.log(String(ms).padStart(6) + ' ms  ' + c + (arg !== undefined ? `(${JSON.stringify(arg)})` : ''))
  }
  // 主线程冻结探测
  const r = await page.evaluate(async () => {
    const gaps = []
    let stop = false
    const pinger = (async () => {
      while (!stop) {
        const t = performance.now()
        await window.api.getSettings()
        gaps.push(Math.round(performance.now() - t))
        await new Promise((res) => setTimeout(res, 40))
      }
    })()
    const t0 = performance.now()
    await Promise.all([window.api.selfCheck(), window.api.liveCompanionState(true), window.api.obsState(), window.api.gameState(), window.api.liveState()])
    const heavyMs = Math.round(performance.now() - t0)
    stop = true; await pinger
    return { heavyMs, max: Math.max(...gaps), p95: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)], n: gaps.length }
  })
  worst = r.max
  console.log(`重活并发总耗时 ${r.heavyMs} ms；期间轻调用 ${r.n} 次：最大 ${r.max} ms，p95 ${r.p95} ms  → ${r.max <= 400 ? '主线程没冻' : '主线程被卡住了！'}`)
} finally { await app.close().catch(() => {}) }
if (worst > 400) process.exit(1)
