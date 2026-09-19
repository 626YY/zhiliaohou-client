// OBS 滤镜/场景控制服务：把 obs-client（websocket）和 obs-local（本机安装/配置）拼成给页面和礼物规则用的一层。
// 复刻参考软件「滤镜设置」插件：OBS 目录 / 启动 OBS / 加载滤镜配置 / 礼物脚本开关滤镜。
// 连接设置持久化在 userData/data/obs.json；未连接时滤镜列表从本机场景集合离线读，连上后换成实时的。
import { BrowserWindow, app } from 'electron'
import { readJson, writeJson } from './db'
import { getSettings, saveSettings } from './settings'
import {
  obsConnect,
  obsDisconnect,
  obsListFilters,
  obsListScenes,
  obsSetFilterEnabled,
  obsSetScene,
  obsState,
  obsToggleFilter,
  onObsEvent,
  onObsStateChange
} from './obs-client'
import {
  enableObsWebSocket,
  isObsRunning,
  launchObs,
  obsExePath,
  obsInstallDir,
  readObsWebSocketConfig,
  readSceneCollection,
  liveCompanionStatus as readLiveCompanionStatus,
  launchLiveCompanion,
  validateLiveCompanionDirectory
} from './obs-local'
import { Ipc, type EntertainmentRule, type ObsFilterInfo, type ObsPanelState, type ObsSettings, type LiveCompanionStatus } from '@shared/types'

let settings: ObsSettings = normalizeSettings(readJson<Partial<ObsSettings>>('obs', {}))
let filters: ObsFilterInfo[] = []
let scenes: { current: string; scenes: string[] } = { current: '', scenes: [] }
let source: 'live' | 'offline' = 'offline'
let runningCache = false
let runningCheckedAt = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setInterval> | null = null
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>()
// 闪烁滤镜「亮了还没关」的集合：OBS 断线/退出时关不掉，整蛊滤镜（翻转/马赛克）会一直亮着；重连成功和退出前尽力补关
const pendingOff = new Map<string, { sourceName: string; filterName: string }>()
function flushPendingOff(): void {
  if (!obsState().connected) return
  for (const [key, { sourceName, filterName }] of [...pendingOff]) {
    obsSetFilterEnabled(sourceName, filterName, false).then(() => pendingOff.delete(key)).catch(() => {})
  }
}

function normalizeSettings(value?: Partial<ObsSettings>): ObsSettings {
  const local = readObsWebSocketConfig()
  const port = Math.trunc(Number(value?.port) || 0)
  return {
    host: String(value?.host ?? '').trim() || '127.0.0.1',
    port: port > 0 && port < 65536 ? port : (local.port || 4455),
    // 没填过密码就用 OBS 自己配置里那个，主播不用再抄一遍
    password: value?.password != null ? String(value.password) : (local.password || ''),
    autoConnect: value?.autoConnect !== false
  }
}

// OBS 在不在跑：异步刷新（proc-snapshot 共享 tasklist），这里同步返回最近一次结论，过期就顺手在后台刷一次，
// 绝不让 broadcast()/obsPanelState() 卡主线程（2026-09-07「点设置转圈」教训）。
let runningRefresh: Promise<void> | null = null
function refreshRunning(): Promise<void> {
  if (runningRefresh) return runningRefresh
  runningRefresh = isObsRunning()
    .then((v) => { runningCache = v; runningCheckedAt = Date.now() })
    .catch(() => {})
    .finally(() => { runningRefresh = null })
  return runningRefresh
}
function running(): boolean {
  if (Date.now() - runningCheckedAt > 3000) void refreshRunning()
  return runningCache
}

/** 面板拉状态用：先把「OBS 在不在跑」刷新到位再返回（异步，不卡线程） */
export async function obsPanelStateFresh(): Promise<ObsPanelState> {
  if (Date.now() - runningCheckedAt > 3000) await refreshRunning()
  return obsPanelState()
}

function loadOffline(): void {
  const info = readSceneCollection()
  filters = info.filters
  scenes = { current: info.currentScene || '', scenes: info.scenes.map((s) => (typeof s === 'string' ? s : String((s as { name?: string })?.name ?? ''))).filter(Boolean) }
  source = 'offline'
}

export function obsPanelState(): ObsPanelState {
  const dir = obsInstallDir()
  const ws = readObsWebSocketConfig()
  const st = obsState()
  if (!st.connected && source !== 'offline') loadOffline()
  if (!st.connected && !filters.length && !scenes.scenes.length) loadOffline()
  return {
    local: {
      installDir: dir || '',
      exePath: dir ? obsExePath(dir) || '' : '',
      running: running(),
      configFound: ws.found,
      wsEnabled: ws.enabled,
      wsPort: ws.port,
      wsAuthRequired: ws.authRequired,
      wsHasPassword: !!ws.password,
      configPath: ws.path
    },
    connection: { connected: st.connected, host: st.host, port: st.port, version: st.version, wsVersion: st.wsVersion, error: st.error },
    settings: { ...settings },
    filters: filters.map((f) => ({ ...f })),
    scenes: { current: scenes.current, scenes: [...scenes.scenes] },
    source
  }
}

function broadcast(): void {
  const state = obsPanelState()
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send(Ipc.ObsChanged, state)
  }
}

export async function obsRefresh(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (obsState().connected) {
      const [list, sceneList] = await Promise.all([obsListFilters(), obsListScenes()])
      filters = list
      scenes = sceneList
      source = 'live'
    } else {
      loadOffline()
    }
    broadcast()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void obsRefresh()
  }, 300)
}

export function obsConfigure(value: Partial<ObsSettings>): { ok: boolean } {
  settings = normalizeSettings({ ...settings, ...value })
  writeJson('obs', settings)
  broadcast()
  return { ok: true }
}

export async function obsConnectNow(value?: Partial<ObsSettings>): Promise<{ ok: boolean; error?: string; version?: string }> {
  if (value) obsConfigure(value)
  const result = await obsConnect({ host: settings.host, port: settings.port, password: settings.password })
  if (result.ok) await obsRefresh()
  else broadcast()
  return result
}

export function obsDisconnectNow(): { ok: boolean } {
  obsDisconnect()
  loadOffline()
  broadcast()
  return { ok: true }
}

export async function obsSetFilter(sourceName: string, filterName: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!obsState().connected) return { ok: false, error: '尚未连接 OBS，连接后才能开关滤镜' }
    await obsSetFilterEnabled(sourceName, filterName, enabled)
    filters = filters.map((f) => (f.source === sourceName && f.filter === filterName ? { ...f, enabled } : f))
    broadcast()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function obsSwitchScene(scene: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!obsState().connected) return { ok: false, error: '尚未连接 OBS，连接后才能切场景' }
    await obsSetScene(scene)
    scenes = { ...scenes, current: scene }
    broadcast()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function obsLaunch(): Promise<{ ok: boolean; error?: string }> {
  const dir = obsInstallDir(true)
  if (!dir) return { ok: false, error: '没找到 OBS 安装目录（注册表和 Program Files 都没有）' }
  if (await isObsRunning()) return { ok: false, error: 'OBS 已经在运行' }
  const result = launchObs(dir)
  runningCheckedAt = 0
  return result
}

export async function liveCompanionState(refresh = false): Promise<LiveCompanionStatus> {
  return {
    ...(await readLiveCompanionStatus(refresh, getSettings().liveCompanionDir)),
    outputs: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.getTitle().startsWith('知了猴') && w.getTitle() !== '知了猴整蛊台')
      .map((w) => ({ title: w.getTitle(), width: w.getContentSize()[0], height: w.getContentSize()[1] }))
  }
}

export function liveCompanionLaunch(): Promise<{ ok: boolean; error?: string; pid?: number }> {
  return launchLiveCompanion(getSettings().liveCompanionDir)
}

export function liveCompanionSetDirectory(dir: string): { ok: boolean; error?: string } {
  if (!validateLiveCompanionDirectory(String(dir || ''))) return { ok: false, error: '该目录未找到抖音直播伴侣，请选择 webcast_mate 或其版本目录' }
  saveSettings({ liveCompanionDir: dir })
  return { ok: true }
}

export async function obsEnableServer(password: string): Promise<{ ok: boolean; error?: string }> {
  const pwd = String(password || '').trim()
  if (!pwd) return { ok: false, error: '密码不能为空' }
  runningCheckedAt = 0
  const result = await enableObsWebSocket(pwd)
  if (result.ok) {
    const ws = readObsWebSocketConfig()
    obsConfigure({ password: pwd, port: ws.port })
  }
  return { ok: result.ok, error: result.error }
}

// 礼物规则的 OBS 动作（entertainment.ts 执行队列调用）
export async function runObsAction(rule: Pick<EntertainmentRule, 'obsAction' | 'obsSource' | 'obsFilter' | 'obsScene' | 'obsSeconds'>): Promise<{ ok: boolean; error?: string }> {
  if (!obsState().connected) return { ok: false, error: '尚未连接 OBS' }
  const action = rule.obsAction || 'filter-toggle'
  try {
    if (action === 'scene') {
      if (!rule.obsScene) return { ok: false, error: '没填要切的场景' }
      await obsSetScene(rule.obsScene)
      scenes = { ...scenes, current: rule.obsScene }
      broadcast()
      return { ok: true }
    }
    const sourceName = String(rule.obsSource || '').trim()
    const filterName = String(rule.obsFilter || '').trim()
    if (!sourceName || !filterName) return { ok: false, error: '没填源或滤镜名' }
    const key = `${sourceName}\u0000${filterName}`   // 分隔符用转义写法，别把裸 NUL 字节写进源码（git 会当二进制）
    const pending = flashTimers.get(key)
    if (pending) {
      clearTimeout(pending)
      flashTimers.delete(key)
    }
    let enabled: boolean
    if (action === 'filter-on') {
      await obsSetFilterEnabled(sourceName, filterName, true)
      enabled = true
    } else if (action === 'filter-off') {
      await obsSetFilterEnabled(sourceName, filterName, false)
      enabled = false
    } else if (action === 'filter-flash') {
      await obsSetFilterEnabled(sourceName, filterName, true)
      enabled = true
      // 亮 N 秒再关；秒数不设上限，只防 0/负数
      const seconds = Math.max(0.1, Number(rule.obsSeconds) || 3)
      pendingOff.set(key, { sourceName, filterName })
      flashTimers.set(key, setTimeout(() => {
        flashTimers.delete(key)
        obsSetFilterEnabled(sourceName, filterName, false)
          .then(() => {
            pendingOff.delete(key)
            filters = filters.map((f) => (f.source === sourceName && f.filter === filterName ? { ...f, enabled: false } : f))
            broadcast()
          })
          .catch(() => { /* 断线了：留在 pendingOff，重连后补关 */ })
      }, seconds * 1000))
    } else {
      enabled = await obsToggleFilter(sourceName, filterName)
    }
    filters = filters.map((f) => (f.source === sourceName && f.filter === filterName ? { ...f, enabled } : f))
    broadcast()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// 客户端启动后：OBS 在跑 + 远程接口已开 + 自动连接开着 → 静默连；掉线后每 20 秒再试
export function initObsService(): void {
  onObsStateChange(() => {
    broadcast()
    flushPendingOff()
  })
  onObsEvent((type) => {
    if (/Filter|Scene|Input/.test(type)) scheduleRefresh()
  })
  const tryConnect = async () => {
    if (!settings.autoConnect || obsState().connected) return
    if (!readObsWebSocketConfig().enabled) return
    await refreshRunning()
    if (!runningCache) return
    void obsConnectNow()
  }
  setTimeout(() => { void tryConnect() }, 3000)
  retryTimer = setInterval(() => { void tryConnect() }, 20_000)
}

app.on('before-quit', () => {
  if (retryTimer) clearInterval(retryTimer)
  for (const timer of flashTimers.values()) clearTimeout(timer)
  flashTimers.clear()
  flushPendingOff()
})
