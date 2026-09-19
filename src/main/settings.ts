import { readJson, writeJson } from './db'
import { SERVER_URL_HTTPS, migrateServerUrl } from './server-tls'
import type { Settings } from '@shared/types'

const defaultSettings: Settings = {
  gamePath: '',
  gameExeName: '4WheelChallenge.exe',
  modConfigPath: '',
  modRootPath: '',
  connectorPath: '',
  pythonPath: 'python',
  downloadDir: '',
  rememberMe: true,
  autoLogin: false,
  alwaysOnTop: false,
  outputsAlwaysOnTop: false,
  outputCaptureMode: 'green',
  outputStandbyVisible: false,
  outputTitleStyle: 'short',
  outputRaiseOnOpen: false,
  outputKeepStandby: true,
  keepClosedSources: false,
  outputFitMedia: true,
  hardwareAcceleration: process.platform !== 'win32',
  renderMode: 'balanced',
  // 进程模式：lean = 所有挂件与主界面共用一个渲染进程（实测总内存少四到六成）；stable = 每个窗口独立进程
  processMode: 'stable',
  // 页面前进后退缓存：绿幕每条视频整页加载，旧页面副本会被缓存住占内存（实测关掉少 18～23%），默认关
  pageBackForwardCache: false,
  // 内存守卫（memory-guard.ts）：系统可用内存低于吃紧线提示、低于告急线暂停自动视频
  memoryGuard: true,
  memoryTightMb: 800,
  memoryCriticalMb: 400,
  // 素材自动瘦身（media-optimize.ts）：超过最高分辨率的视频后台压一份缓存副本再播
  mediaOptimize: true,
  mediaOptimizeMaxHeight: 720,
  mediaCacheMaxMb: 4096,
  // 主窗口防采集保护默认开（远程桌面管理这台机时在设置页关掉）
  mainContentProtection: true,
  // 「抽时间记录」窗口开机要不要自动开
  timeLogWindow: false,
  // 视频窗口排队：默认关（只在默认窗口排队等）、排队用几个绿幕、默认播放窗口
  videoQueue: false,
  videoPoolSlots: 4,
  videoDefaultSlot: 1,
  // 视频排队上限：0 = 不限（默认）。粉丝连送一千个一万个都排着播，主播想限再填
  videoQueueLimit: 0,
  // 内置绿幕抠图默认参数（开关在动作上，参数在设置页调）
  chromaKey: { enabled: false, color: '#00ff00', similarity: 40, smoothness: 12, spill: 30 },
  serverUrl: SERVER_URL_HTTPS,
  guideSeen: false,
  currentGameId: '4wheel-challenge',
  gamePaths: {}
}

// 读盘结果留 250 毫秒：拖动挂件窗口时 move 事件每秒几十次、每次都要看设置，不能每次都同步读盘 + JSON.parse。
// 自己写盘立刻失效；外部直接改 settings.json（测试脚本会这么干）最多晚 250 毫秒生效。
let cached: { at: number; value: Settings } | undefined
const CACHE_MS = 250

export function getSettings(): Settings {
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.value }
  const value = readSettings()
  cached = { at: Date.now(), value }
  return { ...value }
}

function readSettings(): Settings {
  const merged = { ...defaultSettings, ...readJson<Partial<Settings>>('settings', {}) }
  merged.outputCaptureMode = normalizeCaptureMode(merged.outputCaptureMode)
  merged.outputTitleStyle = merged.outputTitleStyle === 'legacy' ? 'legacy' : 'short'
  merged.outputStandbyVisible = merged.outputStandbyVisible === true
  merged.outputRaiseOnOpen = merged.outputRaiseOnOpen === true
  merged.outputKeepStandby = merged.outputKeepStandby !== false
  merged.keepClosedSources = merged.keepClosedSources === true
  merged.renderMode = normalizeRenderMode(merged)
  merged.outputFitMedia = merged.outputFitMedia !== false
  merged.mainContentProtection = merged.mainContentProtection !== false
  merged.videoQueueLimit = Math.min(100000, Math.max(0, Math.round(Number(merged.videoQueueLimit)) || 0))
  // 0.3.44 候选包曾把默认值 300 写进过设置文件（只在开发机上跑过）；用户定的是不限，把那个旧默认当成 0
  if (merged.videoQueueLimit === 300) merged.videoQueueLimit = 0
  merged.serverUrl = migrateServerUrl(merged.serverUrl)
  return merged
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch }
  next.outputCaptureMode = normalizeCaptureMode(next.outputCaptureMode)
  writeJson('settings', next)
  cached = undefined
  return next
}

/**
 * 画面渲染方式。没存过 renderMode 的老配置按原来的硬件加速开关迁移：
 * 关着的（0.3.40 及以前的默认）迁到 balanced —— 实测显卡画、系统合成时，
 * 停在屏幕外的挂件窗口照样能被窗口捕获抓到，而且客户端明显不卡了。
 */
function normalizeRenderMode(settings: Partial<Settings>): 'balanced' | 'compatible' | 'hardware' {
  const mode = settings.renderMode
  if (mode === 'balanced' || mode === 'compatible' || mode === 'hardware') return mode
  return settings.hardwareAcceleration === true ? 'hardware' : 'balanced'
}

function normalizeCaptureMode(value: unknown): 'green' | 'transparent' {
  // 0.3.36 测试版把总开关关闭错误地存成 black；保留关闭意图并迁移为透明。
  return value === 'transparent' || value === 'black' ? 'transparent' : 'green'
}
