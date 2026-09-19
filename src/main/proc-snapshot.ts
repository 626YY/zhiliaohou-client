// 进程快照：全客户端唯一一处 tasklist，异步 + 3 秒缓存 + 并发合并。
// 2026-09-07 用户「点设置就转圈」根因：自检/OBS/直播伴侣各自 spawnSync tasklist / powershell，主线程一卡就是好几秒，
// 窗口整块冻住、鼠标转圈。规矩：主进程里不许再有 spawnSync 枚举进程；要判「某 exe 在不在跑」一律走这里。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const TTL_MS = 3000
type Snapshot = { names: Set<string>; pids: Map<string, number> }
let cache: (Snapshot & { at: number }) | null = null
let inflight: Promise<Snapshot> | null = null

function systemTool(name: string): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const abs = join(root, 'System32', name)
  return existsSync(abs) ? abs : name
}

/** 一次 tasklist（CSV，进程名不截断），解析出进程名集合（小写，含 .exe）与每个名字的第一个 pid。失败给空集合，不抛。 */
function enumerate(): Promise<Snapshot> {
  return new Promise((resolve) => {
    const names = new Set<string>()
    const pids = new Map<string, number>()
    if (process.platform !== 'win32') return resolve({ names, pids })
    execFile(
      systemTool('tasklist.exe'),
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 8000, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve({ names, pids })
        // 进程名列全是 ASCII，按 latin1 解就够；中文只出现在会话名/内存列，不看
        const text = Buffer.isBuffer(stdout) ? stdout.toString('latin1') : String(stdout)
        for (const line of text.split(/\r?\n/)) {
          const m = /^"([^"]+)","(\d+)"/.exec(line)
          if (!m) continue
          const name = m[1].toLowerCase()
          names.add(name)
          if (!pids.has(name)) pids.set(name, Number(m[2]))
        }
        resolve({ names, pids })
      }
    )
  })
}

/** 取（可能缓存的）进程快照；force=true 忽略缓存。同一时刻多路调用只起一个 tasklist。 */
export function processSnapshot(force = false): Promise<Snapshot> {
  const now = Date.now()
  if (!force && cache && now - cache.at < TTL_MS) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = enumerate().then((r) => {
    cache = { at: Date.now(), ...r }
    inflight = null
    return r
  })
  return inflight
}

/** 上次快照里的结论，不等待、不发起枚举（给必须同步返回的老接口用）；没有快照时返回 undefined。 */
export function processRunningCached(exeName: string): boolean | undefined {
  if (!cache) return undefined
  return cache.names.has(exeName.toLowerCase())
}

/** exe 是否在跑（按完整进程名，大小写不敏感） */
export async function processRunning(exeName: string, force = false): Promise<boolean> {
  const snap = await processSnapshot(force)
  return snap.names.has(exeName.toLowerCase())
}

export async function processPid(exeName: string, force = false): Promise<number | undefined> {
  const snap = await processSnapshot(force)
  return snap.pids.get(exeName.toLowerCase())
}

/** 让缓存失效（刚启动/刚关掉某程序后，下一次查询要看到最新状态） */
export function invalidateProcessSnapshot(): void {
  cache = null
}
