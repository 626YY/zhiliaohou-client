/**
 * obs-client.ts —— OBS 远程控制（主进程入口，薄封装）
 *
 * 全部实现在 ./obs-ws-core.ts（纯 Node、零依赖、不 import electron，可脱离 Electron 做冒烟测试：
 * `node tools/obs-smoke.mjs`）。本文件只做两件事：
 *   1. 原样导出 API，业务代码统一 `import { obsConnect, obsToggleFilter, ... } from './obs-client'`
 *   2. 应用退出前主动断开，避免 OBS 端留下半开的连接
 *
 * 用法示例：
 *   const r = await obsConnect({ host: '127.0.0.1', port: 4455, password: '...' })
 *   if (!r.ok) console.warn(r.error)            // 中文错误，如「OBS 密码错误」
 *   await obsToggleFilter('游戏采集', '翻转整蛊')  // 返回翻转后的开关状态
 *   const off = onObsStateChange((s) => { if (!s.connected) { ...上层决定要不要重连... } })
 */
import { app } from 'electron'
import { obsDisconnect } from './obs-ws-core'

export {
  obsConnect,
  obsDisconnect,
  obsState,
  obsRequest,
  obsListScenes,
  obsListFilters,
  obsSetFilterEnabled,
  obsToggleFilter,
  obsSetScene,
  onObsEvent,
  onObsStateChange,
  obsComputeAuth,
  obsClient,
  ObsClient,
  ObsError,
  ObsEventSubscription,
  DEFAULT_EVENT_SUBSCRIPTIONS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS
} from './obs-ws-core'

export type {
  ObsConnectOptions,
  ObsConnectResult,
  ObsFilterInfo,
  ObsState,
  ObsEventHandler,
  ObsStateHandler
} from './obs-ws-core'

// 在纯 Node 环境里 require('electron') 只会得到可执行文件路径（字符串），app 是 undefined——加个守卫，
// 万一本文件被非 Electron 环境加载也不至于炸。
if (app && typeof app.on === 'function') {
  app.on('before-quit', () => {
    obsDisconnect()
  })
}
