// 环境自检：开播前一键把「能不能跑起来」的硬条件过一遍，每项给出可操作的提示。
// 主播机器千奇百怪（没装 python、游戏挪盘、mod 没装、服务器连不上、盘满了），
// 与其等直播时报错，不如在设置页先亮红黄绿灯。
// 2026-09-07：外部命令全部异步并行（之前 python/powershell/tasklist 同步串行 3～8 秒，设置页一开整个窗口冻住、鼠标转圈）。
import { app, net } from 'electron'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { findPython, findScript, connectorState } from './connector'
import { currentGameId, gamePathFor, listGames } from './games'
import { listMods } from './mods'
import { getSettings } from './settings'
import { listGiftImages } from './entertainment'
import { isLiveCompanionRunning, isObsRunning, liveCompanionInstallDir, obsInstallDir, readObsWebSocketConfig } from './obs-local'
import { obsState } from './obs-client'
import type { SelfCheckItem, SelfCheckResult } from '@shared/types'

function item(id: string, label: string, level: SelfCheckItem['level'], detail: string, hint?: string): SelfCheckItem {
  return { id, label, level, detail, hint }
}

function fetchText(url: string, timeoutMs = 5000): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value: { status: number; body: string } | null) => {
      if (!done) {
        done = true
        resolve(value)
      }
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      const request = net.request({ url, method: 'GET' })
      const chunks: Buffer[] = []
      request.on('response', (response) => {
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          clearTimeout(timer)
          finish({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
        })
        response.on('error', () => {
          clearTimeout(timer)
          finish(null)
        })
      })
      request.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      request.end()
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

// 版本比较：返回 >0 表示 a 比 b 新
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** 异步跑一个命令（超时/起不来都不抛）；code 是 ENOENT 之类的起不来原因 */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string; error?: string; code?: unknown }> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr || ''}`.trim()
        if (!err) return resolve({ ok: true, out })
        resolve({ ok: false, out, error: err.message, code: (err as { code?: unknown }).code })
      })
    } catch (e) {
      resolve({ ok: false, out: '', error: (e as Error).message, code: 'THROW' })
    }
  })
}

async function checkPython(modDir: string): Promise<SelfCheckItem> {
  const py = findPython(modDir)
  const r = await run(py, ['--version'], 8000)
  if (r.ok && /Python\s+\d/.test(r.out)) {
    return item('python', 'Python 运行环境', 'ok', `${r.out}（${py === 'python' ? '系统 PATH' : py}）`)
  }
  if (!r.ok && !r.out) {
    return item('python', 'Python 运行环境', 'error', `${py} 无法启动：${r.error || ''}`, '直播连接器靠 python 跑，没有它收不到礼物。安装 mod（自带 pyembed）或安装 Python 3.11')
  }
  return item('python', 'Python 运行环境', 'error', r.out || `${py} 没有返回版本号`, '安装 mod 后自带的嵌入式 python 会被优先使用；否则请安装 Python 3.11 并勾选加入 PATH，或在设置里手选 python.exe')
}

// 管理员判断：fltmc.exe 只有提权后才退出码 0（~30ms；本机实测普通权限退出码 1，与 PowerShell IsInRole 一致），不用冷启动 PowerShell（1～2 秒）
async function checkAdmin(): Promise<SelfCheckItem> {
  if (process.platform !== 'win32') return item('admin', '运行权限', 'ok', '未能判断')
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const r = await run(path.join(root, 'System32', 'fltmc.exe'), [], 4000)
  if (r.code === 'ENOENT' || r.code === 'THROW') return item('admin', '运行权限', 'ok', '未能判断')
  const admin = r.ok
  return item('admin', '运行权限', 'ok', admin ? '管理员身份运行' : '普通权限运行', admin ? undefined : '游戏以管理员运行时键盘显示会收不到键，届时在键盘显示页点「以管理员身份重启」即可')
}

function checkDisk(): SelfCheckItem {
  try {
    const dir = app.getPath('userData')
    const st = fs.statfsSync(dir)
    const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3
    const text = `${dir.slice(0, 2)} 剩余 ${freeGb.toFixed(1)} GB`
    if (freeGb < 0.5) return item('disk', '磁盘空间', 'error', text, '安装包 200 多 MB、礼物图和日志都写在这个盘，先腾出空间')
    if (freeGb < 2) return item('disk', '磁盘空间', 'warn', text, '空间偏紧，更新下载可能失败')
    return item('disk', '磁盘空间', 'ok', text)
  } catch (e) {
    return item('disk', '磁盘空间', 'warn', `未能读取：${(e as Error).message}`)
  }
}

function checkDataDir(): SelfCheckItem {
  const dir = app.getPath('userData')
  try {
    const probe = path.join(dir, `.write-test-${process.pid}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return item('data', '数据目录可写', 'ok', dir)
  } catch (e) {
    return item('data', '数据目录可写', 'error', `${dir}：${(e as Error).message}`, '配置和统计都存这里，写不进去会丢设置。检查目录权限或杀毒软件拦截')
  }
}

export async function runSelfCheck(): Promise<SelfCheckResult> {
  const items: SelfCheckItem[] = []
  const version = app.getVersion()
  const settings = getSettings()
  const gameId = currentGameId()
  const gameName = listGames().find((g) => g.id === gameId)?.name || gameId

  // 1. 服务器 + 版本
  const base = String(settings.serverUrl || 'https://47.251.93.171:8770').replace(/\/+$/, '')
  const script = findScript()
  // 慢的（网络 / 起进程 / 进程枚举）全部并行：总耗时 = 最慢的一项而不是加起来，且全是异步，主线程不冻
  const [latest, pyItem, adminItem, liveDir, liveRunning, obsRunning] = await Promise.all([
    fetchText(`${base}/updates/latest.yml`),
    checkPython(script.modDir),
    checkAdmin(),
    liveCompanionInstallDir(false, settings.liveCompanionDir),
    isLiveCompanionRunning(),
    isObsRunning()
  ])
  if (!latest || latest.status >= 400) {
    items.push(item('server', '服务器连接', 'error', `${base} 连不上（${latest ? 'HTTP ' + latest.status : '超时/无响应'}）`, '授权验证、自动更新、公告都走这台服务器。检查网络，或稍后再试'))
  } else {
    const remote = /version:\s*([\d.]+)/.exec(latest.body)?.[1] || ''
    if (remote && compareVersion(remote, version) > 0) {
      items.push(item('server', '服务器连接', 'warn', `已连上；当前 ${version}，服务器最新 ${remote}`, '启动时会弹「软件更新」，或在设置页点检查更新'))
    } else {
      items.push(item('server', '服务器连接', 'ok', `已连上；当前 ${version}${remote ? `，已是最新` : ''}`))
    }
  }

  // 2. 游戏路径
  const gamePath = gamePathFor(gameId)
  if (gamePath && fs.existsSync(gamePath)) items.push(item('game', `游戏路径（${gameName}）`, 'ok', gamePath))
  else if (gamePath) items.push(item('game', `游戏路径（${gameName}）`, 'error', `${gamePath} 不存在`, '游戏挪过位置？去「启动游戏」页重新探测或手选 exe'))
  else items.push(item('game', `游戏路径（${gameName}）`, 'warn', '还没定位到游戏', '去「启动游戏」页点自动探测 Steam 库，或手选游戏 exe'))

  // 3. mod 安装
  try {
    const mods = listMods()
    const forGame = mods.mods.filter((m) => (m.gameId || '4wheel-challenge') === gameId)
    const installed = forGame.map((m) => ({ m, inst: mods.installed[m.id] })).filter((x) => x.inst)
    if (!forGame.length) items.push(item('mod', 'Mod 安装', 'warn', `游戏库里没有 ${gameName} 的 mod`, '换个游戏或等 mod 上架'))
    else if (!installed.length) items.push(item('mod', 'Mod 安装', 'warn', `${gameName} 的 mod 还没安装`, '去「游戏库」点安装，连接器和整蛊都在 mod 里'))
    else {
      const missing = installed.filter((x) => x.inst.installPath && !fs.existsSync(x.inst.installPath))
      if (missing.length) items.push(item('mod', 'Mod 安装', 'error', `${missing.map((x) => x.m.name).join('、')} 的安装目录不存在`, '游戏或 mod 目录被删过，去游戏库重新安装'))
      else {
        const stale = installed.filter((x) => x.inst.version && compareVersion(x.m.version, x.inst.version) > 0)
        const text = installed.map((x) => `${x.m.name} ${x.inst.version ? 'v' + x.inst.version : '（本机检测到）'}`).join('、')
        if (stale.length) items.push(item('mod', 'Mod 安装', 'warn', text, `有新版本：${stale.map((x) => `${x.m.name} v${x.m.version}`).join('、')}，去「游戏库」点更新`))
        else items.push(item('mod', 'Mod 安装', 'ok', text))
      }
    }
  } catch (e) {
    items.push(item('mod', 'Mod 安装', 'warn', `读取失败：${(e as Error).message}`))
  }

  // 4. 连接器脚本 + python
  if (script.script) items.push(item('script', '直播连接器脚本', 'ok', script.script))
  else items.push(item('script', '直播连接器脚本', 'error', '没找到 connector.py', '安装当前游戏的 mod（自带连接器），或在设置里手选连接器脚本'))
  items.push(pyItem)

  // 5. 连接器进程（未开播时没跑是正常的）
  const cs = connectorState()
  items.push(item('connector', '直播连接器', 'ok', cs.running ? `运行中${cs.sim ? '（模拟模式）' : ''}` : '未运行（开播前在「直播连接器」页启动）'))

  // 6. OBS / 抖音直播伴侣
  const obsDir = obsInstallDir()
  if (!obsDir && !liveDir && !liveRunning) items.push(item('obs', 'OBS / 直播伴侣', 'ok', '未检测到 OBS 或直播伴侣（不用抠像可忽略）'))
  else if (liveRunning) {
    items.push(item(
      'obs',
      'OBS / 直播伴侣',
      'ok',
      '抖音直播伴侣运行中；采集是否成功需在伴侣预览中确认',
      '绿幕素材在直播伴侣里加色度键；不要把客户端主界面加入直播画面'
    ))
  }
  else {
    const ws = readObsWebSocketConfig()
    const st = obsState()
    if (st.connected) items.push(item('obs', 'OBS / 直播伴侣', 'ok', `已连接 OBS ${st.version || ''}`))
    else if (!obsDir && liveDir) items.push(item('obs', 'OBS / 直播伴侣', 'ok', `已安装抖音直播伴侣${liveRunning ? '，运行中' : ''}；请在伴侣中选择输出窗口`))
    else if (!ws.enabled) items.push(item('obs', 'OBS / 直播伴侣', 'warn', `${obsDir}；远程接口未启用`, '去「滤镜设置」页一键启用远程接口（要先关 OBS），礼物才能触发滤镜'))
    else items.push(item('obs', 'OBS / 直播伴侣', 'ok', `${obsRunning ? 'OBS 运行中，' : ''}远程接口已启用（端口 ${ws.port}）`, obsRunning ? '客户端会自动连；没连上就去滤镜设置页点连接' : undefined))
  }

  // 7. 权限 / 磁盘 / 数据目录 / 礼物图
  items.push(adminItem)
  items.push(checkDisk())
  items.push(checkDataDir())
  const gifts = listGiftImages().length
  items.push(gifts > 0
    ? item('gifts', '礼物图库', 'ok', `${gifts} 张礼物图`)
    : item('gifts', '礼物图库', 'warn', '没有礼物图', '安装包里应自带；重装客户端可恢复。直播时连接器也会自动下载'))

  return { at: Date.now(), version, items }
}
