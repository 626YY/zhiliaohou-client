import {cardModeEnabled} from './card-provider'
import {cardEpoch} from './card-epoch'
import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { moduleVersionOf, shouldReplaceModule } from '@shared/connectorSync'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import { getSettings } from './settings'
import { currentGameId, listGames } from './games'
import { wheelLiveDir, bridgePath } from './bridge'
import { installedVersionForGame } from './mods'
import {
  Ipc,
  type ConnectorLogLevel,
  type ConnectorLogLine,
  type ConnectorState,
  type ConnectorEvent
} from '@shared/types'
import { publishConnectorLog } from './danmaku-forward'
import {
  dispatchConnectorEvent,
  eventLevel,
  normalizeGiftName,
  parseConnectorEvent
} from './connector-events'
import { setTimeWidgetGiftImage } from './time-widget'
import { invalidateGiftImageCache } from './entertainment'
import { setChallengeGiftImage } from './challenge-widget'
import { lookupRoom } from './douyin-room'
import { cancelDouyinLogin, readDouyinCookie, saveDouyinCookie } from './douyin-login'
import { syncDouyinGiftImages } from './gift-image-sync'
import { startLiveSession, stopLiveSession } from './live-session'

let child: ChildProcess | null = null
let roomId = ''
let sim = false
let connecting = false
let startGeneration = 0
// 崩溃自恢复：非手动停止时意外退出会自动拉起，最多 3 次、退避 3/6/9 秒
let manualStop = false
let restartAttempts = 0
let restartTimer: ReturnType<typeof setTimeout> | null = null
const logBuffer: ConnectorLogLine[] = []
// 连接器报过「直播已结束」：之后的 code=0 退出是正常下播，不按崩溃重启
let liveEnded = false
const giftImagePaths = new Map<string, string>()

function rememberGiftImage(event: ConnectorEvent): void {
  if (event.type !== 'gift-image' || !event.giftName || !event.giftImage) return
  const key = normalizeGiftName(event.giftName)
  if (!key) return
  giftImagePaths.set(key, event.giftImage)
  if (giftImagePaths.size > 800) giftImagePaths.delete(giftImagePaths.keys().next().value as string)
  // 新落了一张图，礼物图清单缓存立刻失效，各挂件下一次查就能用上
  invalidateGiftImageCache()
  setTimeWidgetGiftImage(event.giftName, event.giftImage)
  setChallengeGiftImage(event.giftName, event.giftImage)
}

/** 给别的主进程模块往连接器日志页写一行（礼物图自动同步用） */
export function pushConnectorLog(level: ConnectorLogLevel, text: string): void {
  push(level, text)
}

// allowEvent=false：只当日志，不解析成事件。连接器每行都带 [connector]/[darkmage-connector] 前缀，
// 没前缀的行只可能是被弹幕/昵称里的换行「撑」出来的续行 —— 观众发一条「xx\n礼物: 嘉年华 x99 by 我」不能变成真礼物触发规则
function push(level: ConnectorLogLevel, text: string, allowEvent = true): void {
  const ts = Date.now()
  const parsed = allowEvent ? parseConnectorEvent(text, ts) : null
  if (parsed?.type === 'status' && /已结束|已下播|下播了/.test(String(parsed.text || ''))) liveEnded = true
  if (parsed) rememberGiftImage(parsed)
  const event = parsed?.type === 'gift'
    ? { ...parsed, giftImage: parsed.giftImage || giftImagePaths.get(normalizeGiftName(parsed.giftName)) }
    : parsed
  const line: ConnectorLogLine = { ts, level: parsed && level === 'info' ? eventLevel(parsed) : level, text, event: event || undefined }
  logBuffer.push(line)
  if (logBuffer.length > 800) logBuffer.shift()
  publishConnectorLog(text, event || undefined)
  if (event) dispatchConnectorEvent(event)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(Ipc.ConnectorLog, line)
      if (event) win.webContents.send(Ipc.ConnectorEvent, event)
    }
  }
}

// 模拟事件：不开播也能把一条「礼物/进场/关注/点赞/弹幕」喂给全部挂件和规则，
// 走的是连接器日志同一条管线（日志、事件总线、渲染层推送一个不少）。
export function simulateConnectorLine(text: string): { ok: boolean; error?: string } {
  const line = String(text || '').trim()
  if (!line) return { ok: false, error: '内容为空' }
  push(classify(line), `[模拟] ${line}`)
  return { ok: true }
}

function classify(text: string): ConnectorLogLevel {
  if (/礼物|gift|火箭|飞机|跑车|穿云箭|嘉年华|热气球/.test(text)) return 'gift'
  if (/关注|follow/.test(text)) return 'follow'
  if (/点赞|like/.test(text)) return 'like'
  if (/error|错误|失败|exception|traceback|refused|timeout/i.test(text))
    return 'error'
  if (/warn|警告|请|提示/i.test(text)) return 'warn'
  return 'info'
}

export function findScript(): { script: string; modDir: string } {
  const settings = getSettings()
  // 优先用 mod 内置连接器，其次才用设置页手动选的脚本
  const dir = wheelLiveDir()
  if (dir) {
    const bundled = fs.existsSync(`${dir}\\connector.py`)
    if (bundled) return { script: `${dir}\\connector.py`, modDir: dir }
  }
  if (settings.connectorPath && fs.existsSync(settings.connectorPath)) {
    return { script: settings.connectorPath, modDir: '' }
  }
  return { script: '', modDir: dir }
}

/** 客户端自带的嵌入式 python（打包在 resources/pyembed，开发时在项目根目录 pyembed/）。 */
export function bundledPython(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const py = path.join(base, 'pyembed', 'python.exe')
  return fs.existsSync(py) ? py : ''
}

export function findPython(modDir: string): string {
  // 顺序：mod 自带 pyembed（依赖最全）→ 客户端自带 pyembed → 设置页手选 → 系统 PATH 里的 python
  if (modDir) {
    const py = `${modDir}\\pyembed\\python.exe`
    if (fs.existsSync(py)) return py
  }
  const bundled = bundledPython()
  if (bundled) return bundled
  const settings = getSettings()
  if (settings.pythonPath && fs.existsSync(settings.pythonPath))
    return settings.pythonPath
  return 'python'
}

// 连接器的本地依赖模块：DON'T SCREAM 0.2.6～0.2.10 的 mod 包只带了 connector.py，没带弹幕组件 douyin_room.py 和 wss 签名脚本 sign.js，
// 真直播间一连就 ModuleNotFoundError（2026-09-06 用户实测「连直播间失败」）。客户端自带一份权威副本，启动前缺什么补什么。
const CONNECTOR_MODULES = ['douyin_room.py', 'sign.js', 'connector.py']
// 带版本标记（文件里 DOUYIN_ROOM_VERSION = "YYYY-MM-DD"）的组件：游戏目录里的副本比客户端自带的旧就备份后换掉。
// 2026-09-06 抖音直播间页改版当晚，图书管理员目录里 8 月的旧 douyin_room.py「连上」的是个空房，礼物点赞一个都收不到。
const VERSIONED_MODULES = new Set(['douyin_room.py', 'connector.py'])
// 这些文件游戏目录里没有也不补（connector.py 缺失说明这份 mod 用的是别的连接器，比如图书管理员的薄连接器）
const NO_FILL_MODULES = new Set(['connector.py'])

function connectorAssetDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'connector-assets')
    : path.join(app.getAppPath(), 'connector-assets')
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function moduleVersion(file: string): string {
  return moduleVersionOf(readText(file) || '')
}

function ensureConnectorModules(scriptDir: string): void {
  for (const name of CONNECTOR_MODULES) {
    const target = path.join(scriptDir, name)
    const source = path.join(connectorAssetDir(), name)
    const exists = fs.existsSync(target)
    if (exists && !VERSIONED_MODULES.has(name)) continue
    if (!fs.existsSync(source)) {
      if (!exists) push('warn', `连接器目录缺少 ${name}，客户端也没带这份组件，真直播间可能连不上`)
      continue
    }
    if (!exists && NO_FILL_MODULES.has(name)) continue
    if (exists) {
      // 判定逻辑在 shared/connectorSync.ts（有单测）：按版本标记比；没标记的 connector.py 只换「我们自己的老包连接器」
      const verdict = shouldReplaceModule(name, readText(target), readText(source) || '')
      if (!verdict.replace) continue
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      try {
        fs.copyFileSync(target, `${target}.bak-${stamp}`)
        fs.copyFileSync(source, target)
        push('info', `连接器组件 ${name} 是旧版（${verdict.reason}），已换成客户端自带的版本，旧文件备份为 ${name}.bak-${stamp}`)
      } catch {
        push('warn', `更新连接器组件 ${name} 失败：${scriptDir} 不可写，仍用旧版`)
      }
      continue
    }
    try {
      fs.copyFileSync(source, target)
      push('info', `连接器目录缺少 ${name}，已用客户端自带的副本补齐`)
    } catch {
      push('warn', `补齐连接器组件 ${name} 失败：${scriptDir} 不可写`)
    }
  }
}

function gameLabel(id: string): string {
  try { return listGames().find((g) => g.id === id)?.name || id } catch { return id }
}

async function spawnOnce(): Promise<boolean> {
  const epoch=cardEpoch(),game=currentGameId()
  if(cardModeEnabled()){
    try{await (await import('./card-auth')).cardRequireGameUse(game)}catch(error){push('error',error instanceof Error?error.message:'卡密授权不可用');return false}
    if(manualStop||cardEpoch()!==epoch||currentGameId()!==game)return false
  }
  const { script, modDir } = findScript()
  if (!script) {
    push('error', '自动重启失败：未找到连接器脚本')
    return false
  }
  if (!bridgePath()) {
    push('error', '自动重启失败：未找到整蛊 Mod 目录 / bridge.txt')
    return false
  }
  ensureConnectorModules(path.dirname(script))
  liveEnded = false
  const py = findPython(modDir)
  // 连接器跟着「当前游戏」走：把用的是哪款游戏、哪份脚本（完整版 / 精简版）明说出来——
  // 2026-09-13 用户选着图书管理员却以为在用完整连接器，大哥进场查了一下午才发现是精简连接器没有进场行
  try {
    const head = fs.readFileSync(script, 'utf8').slice(0, 6000)
    const flavor = /darkmage-connector|DARKMAGE_CONNECTOR_VERSION/.test(head) ? '图书管理员专用版' : /CONNECTOR_VERSION\s*=/.test(head) ? '标准版' : '自定义脚本'
    push('info', `使用「${gameLabel(game)}」整蛊器目录里的连接器（${flavor}）`)
  } catch { /* 读不到脚本头就不标注 */ }
  const args = [script, '--bridge', bridgePath(), '--game', currentGameId()]
  // 本机 mod 版本：不传的话连接器按 0.0.0 算，每次开播都把服务器上的老安装包当新版本下载并提示更新
  const localVersion = installedVersionForGame(currentGameId())
  if (localVersion) args.push('--version', localVersion)
  if (roomId) args.push('--room', roomId)
  if (sim) args.push('--sim')
  try {
    // ZL_PARENT_PID：连接器据此盯着客户端进程，客户端被杀/更新安装时自退，不再留孤儿占互斥量
    child = spawn(py, args, { windowsHide: true, env: { ...process.env, ZL_PARENT_PID: String(process.pid), ZL_CARD_MODE: cardModeEnabled() ? '1' : '0', PYTHONIOENCODING: 'utf-8' } })
  } catch {
    push('error', '启动连接器失败（请检查 python 环境）')
    return false
  }
  attach(child)
  push(
    'info',
    `连接器已启动 (pid=${child.pid})` +
      (sim ? '，模拟模式' : roomId ? `，房间号 ${roomId}` : '，无房间号将走模拟')
  )
  return true
}

function attach(c: ChildProcess): void {
  const startedAt = Date.now()
  // 跨 chunk 行缓冲：一行被切成两截（64KB 突发或多字节字符切在中间）时，前半截以前会被当成一条残缺事件
  let stdoutBuf = ''
  let stderrBuf = ''
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  const pushLine = (raw: string) => {
    const line = raw.trim()
    if (!line) return
    push(classify(line), line, /^\[[^\]\r\n]+\]/.test(line))
  }
  const consume = (text: string, stderr = false) => {
    if (child !== c || manualStop) return
    const parts = ((stderr ? stderrBuf : stdoutBuf) + text).split(/\r?\n/)
    const tail = parts.pop() || ''
    if (stderr) stderrBuf = tail
    else stdoutBuf = tail
    for (const line of parts) {
      if (stderr) { if (line.trim()) push('error', line.trim(), false) }
      else pushLine(line)
    }
  }
  c.stdout?.on('data', (d: Buffer) => {
    consume(stdoutDecoder.write(d))
  })
  c.stderr?.on('data', (d: Buffer) => {
    consume(stderrDecoder.write(d), true)
  })
  c.stdin?.on('error', () => {
    // 进程退出后往 stdin 写会触发 EPIPE：静默忽略，否则未捕获异常会崩掉主进程
  })
  // exit 时管道可能还没排空；close 才能安全处理尾行。旧进程不能改写新会话。
  c.on('close', (code) => {
    if (child !== c) return
    consume(stdoutDecoder.end())
    consume(stderrDecoder.end(), true)
    if (!manualStop && stdoutBuf.trim()) pushLine(stdoutBuf)
    if (!manualStop && stderrBuf.trim()) push('error', stderrBuf.trim(), false)
    stdoutBuf = stderrBuf = ''
    push('info', `连接器已退出 (code=${code ?? 'unknown'})`)
    // 只清自己的引用：若旧进程的退出事件晚于新 spawn 到达，不能把新进程的引用抹掉
    child = null
    if (manualStop) {
      restartAttempts = 0
      return
    }
    // 主播下播 → 连接器正常退出（code 0）：不是崩溃，别再拉起三次去连一个已下播的房
    if ((code ?? 0) === 0 && liveEnded) {
      push('info', '直播已结束，连接器已正常退出')
      stopLiveSession()
      return
    }
    // 健康跑了 10 分钟以上的进程再挂，重启预算重新算（否则每小时崩一次的连接器三小时后就再也不拉了）
    if (Date.now() - startedAt > 10 * 60 * 1000) restartAttempts = 0
    // 退避次数用完就不再拉起了，本场统计跟着定格，别让统计页一直显示「直播中」
    if (restartAttempts >= 3) stopLiveSession()
    scheduleRestart()
  })
  c.on('error', () => {
    if (child !== c) return
    push('error', '连接器进程启动出错')
    child = null
    if (!manualStop) scheduleRestart()
  })
}

function scheduleRestart(): void {
  // error/exit 可能同时触发（Windows 常见），restartTimer 非空即已在排队，避免退避翻倍/重复拉起
  if (manualStop || restartTimer) return
  if (restartAttempts >= 3) { stopLiveSession(); return }
  const delay = 3000 * Math.min(restartAttempts + 1, 3)
  restartAttempts++
  push(
    'warn',
    `连接器意外退出，${delay / 1000} 秒后自动重启（第 ${restartAttempts} 次）`
  )
  restartTimer = setTimeout(async () => {
    restartTimer = null
    if (manualStop) return
    // 退避期间用户可能已手动启动：已有运行中的进程就不再拉起（防双开）
    if (child && child.exitCode === null) return
    if (!await spawnOnce()) {
      push('error', '连接器自动重启失败，请手动启动')
      restartAttempts = 3
      stopLiveSession()
    }
  }, delay)
}

export async function startConnector(
  room: string,
  wantSim = false
): Promise<{ ok: boolean; error?: string }> {
  if (connecting) return { ok: false, error: '正在登录并连接，请完成扫码或关闭登录窗口' }
  if (child && child.exitCode === null)
    return { ok: false, error: '连接器已在运行' }
  if (!wantSim && !room.trim()) return { ok: false, error: '请先选择直播间号' }
  const target = findScript()
  const targetBridge = bridgePath()
  const gameId = currentGameId()
  if (!target.script || !targetBridge) return { ok: false, error: '未找到连接器或 Mod 目录，请先安装 Mod' }
  // 用户主动启动：取消可能还挂着的自动重启计划
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  const generation = ++startGeneration
  connecting = true
  let targetRoom = room.trim()
  try {
    if (!wantSim && cardModeEnabled()) {
      // 卡密模式：房间必须已在平台绑定到当前账号；令牌按账号 × 房间取，没有就扫码；cookie 只在这里落到 mod 目录
      push('info', '正在向平台确认直播间绑定并检查抖音登录状态')
      const { prepareCardRoomConnection } = await import('./card-rooms')
      // 取消只看代次：stopConnector 会 ++startGeneration（manualStop 是上一次停止留下的状态，不能当取消信号）
      const prepared = await prepareCardRoomConnection(room, () => generation === startGeneration)
      if (generation !== startGeneration) return { ok: false, error: '已取消连接' }
      if (!prepared.ok) {
        push('error', prepared.error)
        return { ok: false, error: prepared.error }
      }
      if (currentGameId() !== gameId || findScript().script !== target.script || bridgePath() !== targetBridge) {
        return { ok: false, error: '游戏或连接器路径已更改，请重新点击连接' }
      }
      saveDouyinCookie(path.dirname(target.script), prepared.cookie)
      targetRoom = prepared.room
      push('info', '直播间绑定已确认，抖音登录状态已写入连接器目录，正在启动连接器')
      // 轮椅：主播明确选了这个直播间、平台也确认了绑定 → 只把 mod 参数里的 LiveRoomId 同步成它（其余参数原样），
      // 否则 mod 授权会按参数里的旧房号申请、被平台拒 room_not_bound
      if (gameId === '4wheel-challenge') {
        const { syncWheelRoomIdForConnection } = await import('./card-rooms')
        if (generation !== startGeneration) return { ok: false, error: '已取消连接' }
        const synced = syncWheelRoomIdForConnection(targetRoom)
        if (!synced.ok) push('warn', synced.error || '未能同步轮椅参数里的直播间号')
        else if (synced.changed) push('info', `轮椅参数里的直播间号已从 ${synced.previous || '（空）'} 更新为 ${targetRoom}，其余参数未改动`)
      }
    } else if (!wantSim) {
      push('info', '正在检查抖音登录；需要登录时会打开网页，扫码后自动保存并继续连接')
      const verified = await lookupRoom(room, true)
      if (generation !== startGeneration) return { ok: false, error: '已取消连接' }
      if (!verified.ok && verified.needLogin) {
        push('error', verified.error || '抖音登录失败')
        return { ok: false, error: verified.error || '抖音登录失败' }
      }
      // 网页资料解析是辅助检查，不能因为昵称解析失败而拦住原有直播连接。
      if (!verified.ok) push('warn', '暂未读取到直播间资料，将使用已保存的登录状态继续连接')
      const cookie = await readDouyinCookie(target.modDir)
      if (generation !== startGeneration) return { ok: false, error: '已取消连接' }
      if (currentGameId() !== gameId || findScript().script !== target.script || bridgePath() !== targetBridge) {
        return { ok: false, error: '游戏或连接器路径已更改，请重新点击连接' }
      }
      if (!cookie) return { ok: false, error: '抖音登录已失效，请重新连接' }
      saveDouyinCookie(path.dirname(target.script), cookie)
      push('info', '抖音登录状态已自动保存，正在启动连接器')
    }
    roomId = targetRoom
    sim = wantSim
    manualStop = false
    restartAttempts = 0
    if (!await spawnOnce()) return { ok: false, error: '启动连接器失败，请检查卡密与连接器日志' }
    // 本场统计开账：客户端自己记礼物/点赞/关注，图书管理员这类不写 live_stats.json 的薄连接器也能有统计
    startLiveSession(roomId, sim)
    // 连上真直播间就顺手把抖音当前礼物表里本地还没有的礼物图下下来（同一房间 6 小时内不重复），新上的礼物才有图
    if (!wantSim) {
      void syncDouyinGiftImages({ roomId, onLog: (level, text) => push(level, text) }).catch(() => {})
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接直播间失败，请重试'
    push('error', message)
    return { ok: false, error: message }
  } finally {
    connecting = false
  }
}

export function stopConnector(): void {
  startGeneration++
  if (connecting) cancelDouyinLogin()
  manualStop = true
  stopLiveSession()
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child && child.exitCode === null) {
    push('info', '正在停止连接器...')
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
}

export function connectorState(): ConnectorState {
  return {
    running: !!child && child.exitCode === null,
    connecting,
    pid: child?.pid,
    roomId,
    sim
  }
}

export async function sendCommand(cmd: string): Promise<{ ok: boolean; error?: string }> {
  const epoch=cardEpoch(),game=currentGameId()
  if(cardModeEnabled()){
    try{await (await import('./card-auth')).cardRequireGameUse(game)}catch(error){return {ok:false,error:error instanceof Error?error.message:'卡密授权不可用'}}
    if(cardEpoch()!==epoch||currentGameId()!==game)return {ok:false,error:'账号或游戏已变化'}
  }
  if (!child || child.exitCode !== null) {
    return { ok: false, error: '连接器未运行' }
  }
  try {
    child.stdin?.write(cmd + '\n')
    return { ok: true }
  } catch {
    return { ok: false, error: '发送命令失败' }
  }
}

export function getLog(): ConnectorLogLine[] {
  return logBuffer
}
