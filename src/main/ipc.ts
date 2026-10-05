import {ensureCardModSupport} from './card-mod-support'
import os from 'node:os'
import { validMedia } from './capture-output'
import { app, dialog, BrowserWindow, shell } from 'electron'
import { createIpcRegistry } from './ipc-guard'
import { cardOr, cardState, cardRedeem, cardOpenPlatform } from './card-auth'
import { adoptDefaultCardProvider, cardModeEnabled } from './card-provider'
// 直播间绑定层：加载即把 bind / unbind / sync / 复核钩子挂进 card-auth（卡密模式的旧绑定入口也走它）
import { cardRooms, cardRoomVerify, cardRoomCommit, destroyCardRoomProofs } from './card-rooms'
import { applyOutputsAlwaysOnTop, applyOutputCaptureMode, applyOutputTitleStyle, captureSourceBackground, outputWindowSize, resizeOutputWindow } from './output-window'
import {
  register,
  login,
  logout,
  session,
  bindRoom,
  unbindRoom,
  deleteAccount,
  listAccounts,
  updateAvatar,
  registerEmail,
  loginEmail,
  syncEmailRooms
} from './auth'
import {
  credGetLast,
  credGetUser,
  credSave,
  credClearLast,
  credClearUser
} from './cred-store'
import {
  sendEmailCode,
  getEmailLicense,
  gameApply,
  getNotifications,
  markNotifyRead,
  markNotifyReadAll,
  resetPassword,
  configCloudSave,
  configCloudLoad,
  getBuyContact
} from './email-api'
import { readLiveStats, statsPrankTick } from './stats'
import { giftLogClear, giftLogState } from './gift-log'
import { startNotifyWatch, stopNotifyWatch } from './notifications'
import { startHeartbeatWatch, stopHeartbeatWatch } from './heartbeat'
import { visibleMods, installMod, uninstallMod } from './mods'
import { modHealth, repairMod, exportModDiagnosis, uploadModDiagnosis } from './mod-health'
import { readConfig, saveConfig, getPranks, getNativeKeybinds } from './config-editor'
import { prankCatalog } from './schema-store'
import {
  launchGame,
  queryGameState,
  detectSteamGame,
  detectAllGames,
  resolveGamePath
} from './game-launcher'
import { listGames, setCurrentGameId, currentGameId, catalogGameIds } from './games'
import { licenseEnforced } from './license-policy'
import { memoryGuardProbe } from './memory-guard'
import { mediaOptimizeState } from './media-optimize'
import { importPinyouConfig } from './pinyou-import'
import { liveSet, livePrank, liveCmd, liveState } from './live-api'
import { syncDouyinGiftImages } from './gift-image-sync'
import {
  startConnector,
  stopConnector,
  connectorState,
  sendCommand,
  getLog,
  simulateConnectorLine
} from './connector'
import { getSettings, saveSettings } from './settings'
import { applyMainContentProtection } from './main-window-ref'
import { listNews } from './news'
import { checkForUpdates, downloadUpdate, installUpdate } from './updater'
import {
  bindRoomWithLicense,
  submitRoomApply,
  cancelRoomApply,
  unbindRoomWithLog
} from './license'
import { lookupRoom } from './douyin-room'
import {
  listRules,
  addRule,
  importPinyouRules,
  updateRule,
  removeRule,
  sendKeys,
  systemAction,
  runScript,
  savePng,
  copyImageToClipboard,
  mouseAction,
  sendText,
  entertainmentCommand,
  splitVideoTarget,
  listGiftImages, rulesPausedState,
  ruleGroups, toggleRuleGroup, listPresets, savePreset, removePreset, applyPreset } from './entertainment'
import {
  danmakuForwardState,
  publishDanmakuForward,
  startDanmakuForward,
  stopDanmakuForward
} from './danmaku-forward'
import {
  openGreenScreen,
  closeGreenScreen,
  greenScreenState,
  rememberGreenScreenSize
} from './green-screen'
import {
  openTimeWidget,
  closeTimeWidget,
  timeWidgetState,
  timeWidgetUpdate,
  timeWidgetAdjust,
  timeWidgetClear,
  timeWidgetPause,
  timeWidgetShowGift,
  timeLogOpen,
  timeLogClose,
  timeLogState,
  timeWidgetLog,
  timeWidgetLogClear,
  timeWidgetTestGift,
  timeWidgetTestEvent,
  timeWidgetCancelQueue,
  setTimeBlindBoxActionHandler
} from './time-widget'
import {
  openMarquee,
  closeMarquee,
  marqueeState,
  marqueeSend,
  configureMarquee
} from './marquee-widget'
import {
  openChallengeWidget,
  updateChallengeWidget,
  closeChallengeWidget,
  challengeWidgetState,
  challengeAdjust,
  challengeApplyGift,
  challengePause
} from './challenge-widget'
import {
  openVideoWidget,
  closeVideoWidget,
  videoWidgetState
} from './video-widget'
import {
  openWheelWindow,
  openNineGridWindow,
  openLuckyWindow,
  closeLotteryWindow,
  lotterySpin,
  lotteryState,
  lotteryHistory,
  clearLotteryHistory,
  configureLottery,
  setLotteryActionHandler
} from './lottery-widget'
import {
  advancedWheelState,
  closeAdvancedWheel,
  exportAdvancedWheelConfig,
  importAdvancedWheelConfig,
  openAdvancedWheel,
  spinAdvancedWheel,
  updateAdvancedWheel
} from './advanced-wheel'
import {
  openEffectsWindow,
  closeEffectsWindow,
  configureEffects,
  effectsFire,
  effectsFireChecked,
  effectsState
} from './effects-widget'
import {
  openSpecialGame,
  closeSpecialGame,
  configureSpecialGame,
  specialState,
  specialStats,
  testSpecialGame,
  clearAllSpecial,
  closeAllSpecial,
  specialBoxes,
  saveSpecialBox,
  removeSpecialBox,
  testSpecialBox
} from './special-gameplay'
import {
  openEntranceWindow,
  closeEntranceWindow,
  configureEntrance,
  entranceState,
  entranceTest
} from './entrance-widget'
import { emojiDir, emojiKeys } from './emoji-assets'
import { listViewers } from './viewer-directory'
import {
  openQueueWindow,
  closeQueueWindow,
  configureQueueWidget,
  queueWidgetState
} from './queue-widget'
import { clearExecQueue, skipExecQueue } from './entertainment'
import {
  openWishWindow,
  closeWishWindow,
  configureWish,
  wishReset,
  wishWindowState
} from './wish-widget'
import {
  openProgressWindow,
  closeProgressWindow,
  configureProgress,
  progressAdjust,
  progressReset,
  progressState
} from './progress-widget'
import {
  openKeyboardWindow,
  closeKeyboardWindow,
  configureKeyboardWidget,
  keyboardWidgetState
} from './keyboard-widget'
import {
  obsPanelState,
  obsPanelStateFresh,
  obsConnectNow,
  obsDisconnectNow,
  obsConfigure,
  obsRefresh,
  obsSetFilter,
  obsSwitchScene,
  obsLaunch,
  obsEnableServer,
  liveCompanionState,
  liveCompanionLaunch,
  liveCompanionSetDirectory
} from './obs-service'
import { openProtectWidget, closeProtectWidget, protectWidgetState } from './protect-widget'
import { setRulesPaused } from './entertainment'
import { stickerState, stickerReset, stickerImport } from './sticker-stats'
import { runSelfCheck } from './self-check'
import { reportRendererError, openLogsDir, logLine } from './crash-log'
import { markQuitReason } from './exit-diag'
import { exportTransparentDatabase, importTransparentDatabase } from './transparent-db'
import {
  Ipc,
  type DanmakuForwardEvent,
  type LotteryItem,
  type TimeBlindBoxEvent
} from '@shared/types'

export function registerIpc(): void {
  // 集中注册：每个通道只注册一次、只收主窗口主框架的请求；卡密模式下「使用类」通道先过授权门（ipc-guard.ts）
  const { handle, on } = createIpcRegistry()

  // ---- 账号 ----
  // cardOr：本机有 license-provider.json（卡密平台模式）时走卡密账号层（card-auth.ts），否则原样走旧账号系统
  handle(Ipc.AuthRegister, cardOr(Ipc.AuthRegister, (_e, username, password, nickname) =>
    register(username, password, nickname)
  ))
  handle(Ipc.AuthLogin, cardOr(Ipc.AuthLogin, async (_e, username, password) => {
    const r = await login(username, password)
    if (r.ok) startNotifyWatch()
    if (r.ok) startHeartbeatWatch()
    return r
  }))
  handle(Ipc.AuthLogout, cardOr(Ipc.AuthLogout, () => {
    logout()
    stopNotifyWatch()
    stopHeartbeatWatch()
    return { ok: true }
  }))
  handle(Ipc.AuthSession, cardOr(Ipc.AuthSession, () => session()))
  handle(Ipc.AuthBindRoom, cardOr(Ipc.AuthBindRoom, (_e, roomId) => bindRoom(roomId)))
  handle(Ipc.AuthUnbindRoom, cardOr(Ipc.AuthUnbindRoom, (_e, roomId) => unbindRoom(roomId)))
  handle(Ipc.AuthDeleteAccount, cardOr(Ipc.AuthDeleteAccount, (_e, id) => {
    const result = deleteAccount(String(id ?? ''))
    if (result.ok && !session()) {
      stopNotifyWatch()
      stopHeartbeatWatch()
    }
    return result
  }))
  handle(Ipc.AuthListAccounts, cardOr(Ipc.AuthListAccounts, () => listAccounts()))
  handle(Ipc.CredLoad, cardOr(Ipc.CredLoad, () => ({ last: credGetLast() })))
  handle(Ipc.CredUser, cardOr(Ipc.CredUser, (_e, username) => ({
    password: credGetUser(String(username ?? ''))
  })))
  handle(Ipc.CredSave, cardOr(Ipc.CredSave, (_e, username, password) => {
    credSave(String(username ?? ''), String(password ?? ''))
    return { ok: true }
  }))
  handle(Ipc.CredClearLast, cardOr(Ipc.CredClearLast, () => {
    credClearLast()
    return { ok: true }
  }))
  handle(Ipc.CredClearUser, cardOr(Ipc.CredClearUser, (_e, username) => {
    credClearUser(String(username ?? ''))
    return { ok: true }
  }))
  handle(Ipc.AuthUpdateAvatar, cardOr(Ipc.AuthUpdateAvatar, (_e, avatar) =>
    updateAvatar(String(avatar ?? ''))
  ))
  handle(Ipc.EmailSendCode, cardOr(Ipc.EmailSendCode, (_e, email) => sendEmailCode(email)))
  handle(Ipc.EmailRegister, cardOr(Ipc.EmailRegister, async (_e, email, code, password, nickname) => {
    const r = await registerEmail(email, code, password, nickname)
    if (r.ok) startNotifyWatch()
    if (r.ok) startHeartbeatWatch()
    return r
  }))
  handle(Ipc.EmailLogin, cardOr(Ipc.EmailLogin, async (_e, email, password) => {
    const r = await loginEmail(email, password)
    if (r.ok) startNotifyWatch()
    if (r.ok) startHeartbeatWatch()
    return r
  }))
  handle(Ipc.EmailReset, cardOr(Ipc.EmailReset, (_e, email, code, password) =>
    resetPassword(email, code, password)
  ))
  // 免检模式：旧邮箱账号的授权也一律「全部游戏已授权」，不问服务器（旧账号系统的门禁全靠这份结果）
  const freeEmailLicense = (): Awaited<ReturnType<typeof getEmailLicense>> => ({ ok: true, licensed: 1, banned: 0, expire: '', note: '授权检查已暂停', games: Object.fromEntries(catalogGameIds().map((id) => [id, 1])), pendingGames: [] })
  const emailLicenseHandler = cardOr(Ipc.EmailGetLicense, (_e, email) => getEmailLicense(email))
  handle(Ipc.EmailGetLicense, (e, email) => (licenseEnforced() ? emailLicenseHandler(e, email) : freeEmailLicense()))
  handle(Ipc.MemoryGuardProbe, (_e, mb) => memoryGuardProbe(Number(mb)))
  handle(Ipc.MediaOptimizeState, () => mediaOptimizeState())
  handle(Ipc.EmailGameApply, cardOr(Ipc.EmailGameApply, (_e, email, game) => gameApply(email, game)))
  handle(Ipc.EmailNotifyList, cardOr(Ipc.EmailNotifyList, (_e, email) => getNotifications(email)))
  handle(Ipc.EmailNotifyRead, cardOr(Ipc.EmailNotifyRead, (_e, email, id) =>
    markNotifyRead(email, id)
  ))
  handle(Ipc.EmailNotifyReadAll, cardOr(Ipc.EmailNotifyReadAll, (_e, email) =>
    markNotifyReadAll(email)
  ))
  handle(Ipc.EmailConfigSave, cardOr(Ipc.EmailConfigSave, (_e, email, data) =>
    configCloudSave(email, data)
  ))
  handle(Ipc.EmailConfigLoad, cardOr(Ipc.EmailConfigLoad, (_e, email) =>
    configCloudLoad(email)
  ))
  handle(Ipc.EmailBuyContact, cardOr(Ipc.EmailBuyContact, () => getBuyContact()))
  handle(Ipc.RoomBindWithLicense, cardOr(Ipc.RoomBindWithLicense, (_e, roomId) =>
    bindRoomWithLicense(roomId)
  ))
  handle(Ipc.RoomLookup, (_e, roomId, interactive) =>
    lookupRoom(String(roomId ?? ''), interactive === true)
  )
  handle(Ipc.RoomSubmitApply, cardOr(Ipc.RoomSubmitApply, (_e, roomId) => submitRoomApply(roomId)))
  handle(Ipc.RoomCancelApply, () => {if(cardModeEnabled()){destroyCardRoomProofs();return {ok:true}}return cancelRoomApply()})
  handle(Ipc.RoomUnbindReport, cardOr(Ipc.RoomUnbindReport, (_e, roomId) =>
    unbindRoomWithLog(String(roomId ?? ''))
  ))
  handle(Ipc.RoomSyncEmail, cardOr(Ipc.RoomSyncEmail, () => syncEmailRooms()))

  // ---- 卡密平台（没配置时 cardState 回 enabled=false，页面据此不显示卡密入口）----
  handle(Ipc.CardState, () => cardState())
  handle(Ipc.CardRedeem, (_e, code) => cardRedeem(code))
  handle(Ipc.CardOpenPlatform, () => cardOpenPlatform())
  // 本机只有旧版本地账号时默认不启用随包的平台配置；主播明确点「切换」才把默认配置写成显式配置（重启生效）
  handle(Ipc.CardAdoptDefault, () => adoptDefaultCardProvider())
  // 直播间名额 / 扫码核实 / 提交绑定：只信主窗口主框架（registry 已把关），cookie 与令牌绝不回页面
  handle(Ipc.CardRooms, () => cardRooms())
  handle(Ipc.CardRoomVerify, (_e, room, proof) => cardRoomVerify(room, proof))
  handle(Ipc.CardRoomCommit, (_e, input) => cardRoomCommit(input))

  // ---- Mod 库 ----
  // 页面拿的是过滤版（下架的不给）；主进程内部仍用 listMods() 全量，见 mods.ts::visibleMods 注释
  handle(Ipc.ModsList, () => visibleMods())
  // 安装 / 卸载结果一律记 main.log：主播说「装不上 / 没装进游戏目录」时，以前日志里一个字都没有，只能靠截图猜
  handle(Ipc.ModsInstall, async (_e, modId) => {
    logLine('mods', `安装 ${modId} 开始`)
    const r = await installMod(modId)
    if (r.ok && modId === 'wheellive') {
      try { await ensureCardModSupport('4wheel-challenge') } catch (error) {
        const msg = error instanceof Error ? error.message : '授权组件安装失败'
        logLine('mods', `安装 ${modId}：文件已装好，但卡密授权组件失败：${msg}`)
        return { ...r, ok: false, error: msg }
      }
    }
    logLine('mods', `安装 ${modId} ${r.ok ? '成功' : '失败：' + (r.error || '')}`)
    return r
  })
  handle(Ipc.ModsUninstall, (_e, modId) => { const r = uninstallMod(modId); logLine('mods', `卸载 ${modId} ${r.ok ? '成功' : '失败：' + (r.error || '')}`); return r })
  handle(Ipc.ModsHealth, (_e, gameId?: string) => modHealth(gameId))
  handle(Ipc.AppVersion, () => ({
    version: app.getVersion(),
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
    node: process.versions.node || '',
    platform: process.platform,
    osVersion: os.release(),
    packaged: app.isPackaged
  }))
  // ---- 绿幕素材文件夹：选一次文件夹，里面的素材列出来点一下就用 ----
  handle(Ipc.MediaList, async (_e, dir: string) => {
    const { listMedia } = await import('./pinyou-project')
    return listMedia(String(dir || ''))
  })
  handle(Ipc.MediaFolderPick, async () => {
    const r = await dialog.showOpenDialog({ title: '选择素材文件夹', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false, dir: '', files: [] }
    const { listMedia } = await import('./pinyou-project')
    return { ok: true, ...listMedia(r.filePaths[0]) }
  })
  // ---- 品游「项目」（一个文件夹一个项目：视频 + 同名 .脚本）----
  handle(Ipc.PinyouProjects, async (_e, root?: string) => {
    const { listProjects } = await import('./pinyou-project')
    return listProjects(typeof root === 'string' ? root : undefined)
  })
  handle(Ipc.PinyouAssetRootPick, async () => {
    const r = await dialog.showOpenDialog({
      title: '选择品游素材目录（里面每个文件夹是一个项目）',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false }
    const dir = r.filePaths[0]
    saveSettings({ pinyouAssetRoot: dir })
    const { listProjects } = await import('./pinyou-project')
    return { ok: true, ...listProjects(dir) }   // listProjects 自己就带 root
  })
  // 试触发一个项目：主播点一下就知道视频能不能播、脚本动作认不认得出
  // 项目里每条视频的动作：列表（含品游脚本摘要）+ 保存。给规则编辑器「项目里的视频」那一块用
  handle(Ipc.PinyouItemActionsGet, async (_e, dir: string) => {
    const { projectItems, readScript, resolveProjectDir } = await import('./pinyou-project')
    const { parsePinyouScript } = await import('../shared/pinyou')
    const { COMMAND_LABELS } = await import('../shared/entertainmentLabels')
    const { projectItemActions } = await import('./pinyou-item-actions')
    const real = resolveProjectDir(String(dir || ''))
    if (!real) return { ok: false, items: [], actions: {}, error: '找不到项目文件夹' }
    const items = projectItems(real).map((it) => {
      let script: string[] = []
      if (it.script) {
        try {
          script = parsePinyouScript(readScript(it.script)).commands.map((c) => `${(COMMAND_LABELS as Record<string, string>)[c.cmd] || c.cmd}${c.param ? ' ' + String(c.param).slice(0, 40) : ''}`)
        } catch { script = ['（脚本读不了）'] }
      }
      return { name: it.name, video: it.video, hasScript: !!it.script, script }
    })
    return { ok: true, dir: real, items, actions: projectItemActions(real) }
  })
  handle(Ipc.PinyouItemActionsSet, async (_e, dir: string, name: string, config: unknown) => {
    const { setProjectItemActions } = await import('./pinyou-item-actions')
    const { resolveProjectDir } = await import('./pinyou-project')
    const { normalizeExtraActions } = await import('../shared/entertainmentActions')
    const cfg = config && typeof config === 'object' ? (config as { actions?: unknown; useScript?: unknown }) : null
    // ★存的键必须和「读」「触发」用的一样：那两处都先 resolveProjectDir 解析成绝对路径，
    //   这里原来直接用界面传来的原字符串，规则里写相对项目名时配的动作存进去就再也读不回来、也不执行
    const real = resolveProjectDir(String(dir || '')) || String(dir || '')
    return setProjectItemActions(real, String(name || ''), cfg ? { actions: (cfg.actions as never) || [], useScript: cfg.useScript !== false } : null, (a) => normalizeExtraActions(a as never))
  })
  handle(Ipc.PinyouProjectTest, async (_e, dir: string, slot?: number) => {
    const param = slot && slot >= 1 && slot <= 4 ? `${String(dir)}|绿幕${slot}` : String(dir)
    return entertainmentCommand('project-random', param)
  })
  // 「按条目导入」：项目里每个视频各建一条规则（品游就是这么用的，一个视频一条规则绑一个礼物）。
  //   规则名用条目名（「-10分」这种，一看就知道该绑什么礼物），礼物名留给主播填。
  handle(Ipc.PinyouItemsImport, async (_e, dirs: string[], slot?: number) => {
    const { projectEntries, listProjects } = await import('./pinyou-project')
    const known = new Map(listProjects().projects.map((p) => [p.dir, p]))
    let added = 0
    const skipped: string[] = []
    const projects: string[] = []
    for (const dir of Array.isArray(dirs) ? dirs : []) {
      const project = known.get(String(dir))?.name || String(dir).split(/[\\/]/).filter(Boolean).pop() || '项目'
      const entries = projectEntries(String(dir))
      if (!entries.length) { skipped.push(`${project}：没有视频`); continue }
      projects.push(project)
      for (const en of entries) {
        // 主动作：播这个条目的视频（指定了绿幕窗口就播到那儿）
        // ★原来选了窗口就写成 project-random「整个文件夹随机抽一条」，规则名明明是这条视频的名字，
        //   触发时却随机播成别的（主播 2026-09-11：「那就证明他是触发了一个新项目」），脚本动作还会叠一遍
        const main = {
          actionType: 'command' as const,
          commandCmd: 'video-play' as const,
          commandParam: slot && slot >= 1 && slot <= 4 ? `${en.video}|0|绿幕${slot}` : `${en.video}|0`
        }
        // 附加动作：脚本里的动作（加班加减、计数、锁键盘…），delay 转成「先等几秒」
        const extras: Record<string, unknown>[] = []
        let pending = 0
        for (const c of en.commands) {
          if (c.cmd === 'delay') { pending += Number(c.param) || 0; continue }
          extras.push({ actionType: 'command', commandCmd: c.cmd, commandParam: c.param, delayMs: pending })
          pending = 0
        }
        const r = addRule({
          name: en.name,              // ★规则名 = 视频名（「-10分」），人认的就是这个
          giftName: '',               // 礼物名留空：触发条件由主播自己填
          enabled: false,             // 没绑礼物一律停用（addRule 也会强制）
          triggerType: 'gift',
          remark: `品游 ${project}`,
          group: project,            // ★分组 = 项目名：主播按项目整组开关、存预设
          ...main,
          extraActions: extras
        } as never)
        if (r.ok) added += 1
        else skipped.push(`${project}/${en.name}：${r.error || '建不了'}`)
      }
    }
    return { ok: true, added, projects, skipped }
  })
  // 时间类项目 → 时间挂件的盲盒事件（op/秒数/视频都从脚本和文件名来）。
  // ★这里【只算不写】：倒计时配置的权威在渲染进程的 localStorage('ent_time_cfg')，
  //   页面从那里读、改完再 timeWidgetUpdate 推给主进程。反方向写主进程内存是无效的
  //   （页面读不到，而且它下次保存就把这份盖掉）—— 2026-09-07 用户实测「事件库还是 0」就是这个。
  handle(Ipc.PinyouTimeImport, async (_e, dirs: string[]) => {
    const { projectEntries, listProjects } = await import('./pinyou-project')
    const { planTimeProject } = await import('../shared/pinyouTime')
    const known = new Map(listProjects().projects.map((p) => [p.dir, p]))
    const events: TimeBlindBoxEvent[] = []
    const report: { project: string; added: number; skipped: number; why: string[] }[] = []
    for (const dir of Array.isArray(dirs) ? dirs : []) {
      const project = known.get(String(dir))?.name || String(dir).split(/[\\/]/).filter(Boolean).pop() || '项目'
      const plan = planTimeProject(projectEntries(String(dir)), project)
      events.push(...plan.events)
      report.push({
        project,
        added: plan.events.length,
        skipped: plan.skipped.length,
        why: [...new Set(plan.skipped.map((s) => s.why))].slice(0, 3)
      })
    }
    return { ok: true, events, report }
  })
  // 批量导入：每个项目建一条规则（动作=触发这个项目）。
  // ★礼物名先用项目名、规则默认【停用】：项目名不是礼物名，改成真礼物名再启用，免得误触发。
  handle(Ipc.PinyouProjectsImport, async (_e, dirs: string[], slot?: number) => {
    const { listProjects } = await import('./pinyou-project')
    const known = new Map(listProjects().projects.map((p) => [p.dir, p]))
    const added: string[] = []
    const skipped: string[] = []
    for (const dir of Array.isArray(dirs) ? dirs : []) {
      const info = known.get(String(dir))
      const name = info?.name || String(dir).split(/[\/]/).filter(Boolean).pop() || ''
      if (!name) { skipped.push(String(dir)); continue }
      const param = slot && slot >= 1 && slot <= 4 ? `${dir}|绿幕${slot}` : String(dir)
      const r = addRule({
        name,                 // ★规则名 = 项目名；礼物名留给主播填
        giftName: '',
        enabled: false,
        triggerType: 'gift',
        actionType: 'command',
        commandCmd: 'project-random',
        commandParam: param,
        group: name,          // ★分组 = 项目名
        remark: info ? `品游项目：${info.videos} 个视频${info.paired ? `，其中 ${info.paired} 个带动作` : '（纯视频）'}` : '品游项目'
      } as never)
      if (r.ok) added.push(name); else skipped.push(`${name}：${r.error || '建不了'}`)
    }
    return { ok: true, added, skipped }
  })
  // 导入别人导出的项目：把素材路径改到本机的品游素材目录（对方的盘符/目录跟你不一样）
  handle(Ipc.PinyouRelocateRules, async (_e, rules: unknown[]) => {
    const { relocateRules } = await import('./pinyou-project')
    return relocateRules(Array.isArray(rules) ? rules : [])
  })
  // 导出一个项目成【文件夹】：素材 + 项目规则.json，别人「导入项目」直接读
  handle(Ipc.ProjectExport, async (_e, project: string, rules: unknown[], destRoot?: string) => {
    let root = String(destRoot || '')
    if (!root) {
      const picked = await dialog.showOpenDialog({
        title: '选择导出到哪个位置（会在里面建一个项目文件夹）',
        properties: ['openDirectory', 'createDirectory']
      })
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
      root = picked.filePaths[0]
    }
    const { exportProject } = await import('./project-folder')
    return exportProject(String(project || ''), Array.isArray(rules) ? rules : [], root)
  })
  // 从文件夹导入项目（别人发来的项目文件夹，或者任意一个装着视频的文件夹）
  handle(Ipc.ProjectImportFolder, async (_e, dir?: string) => {
    let from = String(dir || '')
    if (!from) {
      const picked = await dialog.showOpenDialog({
        title: '选择项目文件夹（里面是视频，或别人导出的项目）',
        properties: ['openDirectory']
      })
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
      from = picked.filePaths[0]
    }
    const { importProjectFolder } = await import('./project-folder')
    const result = importProjectFolder(from)
    if (!result.ok) return result
    let added = 0
    const skipped: string[] = []
    for (const rule of result.rules || []) {
      const r = addRule(rule as never)
      if (r.ok) added += 1
      else skipped.push(String((rule as Record<string, unknown>).name || '') + '：' + (r.error || '建不了'))
    }
    return { ...result, added, skipped }
  })
  // 新建项目：素材目录里建文件夹 + 复制选中的视频 + 按条目建规则
  handle(Ipc.ProjectCreate, async (_e, name: string, files?: string[]) => {
    const { createProject } = await import('./project-folder')
    const result = createProject(String(name || ''), Array.isArray(files) ? files : [])
    if (!result.ok) return result
    let added = 0
    for (const rule of result.rules || []) if (addRule(rule as never).ok) added += 1
    return { ...result, added }
  })
  handle(Ipc.ModsDiagnose, (_e, gameId?: string) => exportModDiagnosis(gameId))
  handle(Ipc.ModsDiagnoseUpload, (_e, gameId?: string) => uploadModDiagnosis(gameId))
  handle(Ipc.ModsRepair, async (_e, gameId?: string) => {const r=await repairMod(gameId);if(r.ok){try{await ensureCardModSupport(gameId||currentGameId())}catch(error){return {...r,ok:false,error:error instanceof Error?error.message:'授权组件修复失败'}}}return r})

  // ---- 参数编辑器 ----
  handle(Ipc.ConfigRead, () => readConfig())
  handle(Ipc.ConfigSave, (_e, values) => saveConfig(values))
  handle(Ipc.ConfigPranks, () => ({
    pranks: getPranks(),
    defaults: getNativeKeybinds()
  }))
  // 全部游戏的整蛊菜单（定义包：更新源优先、自带兜底），渲染层各处的整蛊下拉 / 名字映射都从这里来
  handle(Ipc.PrankCatalog, () => prankCatalog())
  handle(Ipc.StatsPrankTick, () => statsPrankTick())
  handle(Ipc.LiveStats, () => readLiveStats())
  handle(Ipc.GiftLogState, (_e, limit) => giftLogState(typeof limit === 'number' ? limit : undefined))
  handle(Ipc.GiftLogClear, () => giftLogClear())

  // ---- 游戏 ----
  handle(Ipc.GameLaunch, () => launchGame())
  handle(Ipc.GameState, () => queryGameState())
  handle(Ipc.GameDetectPath, () => detectSteamGame())
  handle(Ipc.GameDetectAll, () => detectAllGames())
  // 主播自己选的 exe 先校验：选到启动器/崩溃处理器会被自动改到真正的游戏本体
  handle(Ipc.GameSetPath, (_e, gameId: string, path: string) =>
    resolveGamePath(String(gameId || ''), String(path || ''))
  )
  handle(Ipc.GamesList, () => listGames())
  // 切当前游戏：主进程的路由（bridge/config/launcher/connector）全部跟着走
  handle(Ipc.GameSetCurrent, (_e, id) => {
    setCurrentGameId(String(id ?? ''))
    return { ok: true }
  })

  // ---- 实时接口（bridge.txt） ----
  handle(Ipc.LiveSet, (_e, key, value) => liveSet(key, value))
  handle(Ipc.LivePrank, (_e, id) => livePrank(id))
  handle(Ipc.LiveCmd, (_e, cmd) => liveCmd(cmd))
  handle(Ipc.LiveState, () => liveState())
  handle(Ipc.GiftImagesSync, (_e, roomId) =>
    syncDouyinGiftImages({ roomId: typeof roomId === 'string' ? roomId : '', force: true })
  )

  // ---- 直播连接器 ----
  handle(Ipc.ConnectorStart, (_e, room, sim, platform) =>
    startConnector(room, sim, platform === 'bilibili' ? 'bilibili' : 'douyin')
  )
  handle(Ipc.ConnectorStop, () => {
    stopConnector()
    return { ok: true }
  })
  handle(Ipc.ConnectorState, () => connectorState())
  handle(Ipc.ConnectorSend, (_e, cmd) => sendCommand(cmd))
  handle(Ipc.ConnectorSimulate, (_e, text) => simulateConnectorLine(String(text ?? '')))
  handle(Ipc.ConnectorLog, () => getLog())

  // ---- 设置 ----
  handle(Ipc.SettingsGet, () => ({ settings: getSettings() }))
  handle(Ipc.SettingsSet, async (_e, patch) => {
    const settings = saveSettings(patch)
    // 「输出窗口总在最前」改了立刻套到所有已开的输出窗口
    if (patch && typeof patch === 'object' && 'outputsAlwaysOnTop' in patch) applyOutputsAlwaysOnTop()
    // 待机窗口显示/隐藏、窗口名称风格都是立刻生效，不用重开挂件
    if (patch && typeof patch === 'object' && 'outputTitleStyle' in patch) applyOutputTitleStyle()
    // 主窗口防采集保护（远程桌面管理时要关掉才能看见主窗口）：立刻生效，不用重启
    if (patch && typeof patch === 'object' && 'mainContentProtection' in patch) applyMainContentProtection()
    const outputWindowsNeedReopen = patch && typeof patch === 'object' && 'outputCaptureMode' in patch
      ? await applyOutputCaptureMode() : false
    return { settings, outputWindowsNeedReopen }
  })

  // ---- 娱乐助手 ----
  handle(Ipc.EntertainmentRulesList, () => listRules())
  handle(Ipc.EntertainmentRuleAdd, (_e, rule) => addRule(rule))
  handle(Ipc.EntertainmentRuleUpdate, (_e, rule) => updateRule(rule))
  handle(Ipc.EntertainmentRuleRemove, (_e, id) =>
    removeRule(String(id ?? ''))
  )
  // ---- 规则分组与预设：「今晚开哪几个项目」----
  // 分组一般就是品游项目名（导入时自动填），预设存的是「开哪几个组」。
  // 放主进程是因为规则的权威在这儿，透明图菜单和连接器匹配都要读同一份。
  handle(Ipc.EntertainmentGroupToggle, (_e, group, on) =>
    toggleRuleGroup(String(group ?? ''), on !== false)
  )
  handle(Ipc.EntertainmentPresetList, () => ({ presets: listPresets(), groups: ruleGroups() }))
  handle(Ipc.EntertainmentPresetSave, (_e, preset) => savePreset(preset))
  handle(Ipc.EntertainmentPresetRemove, (_e, id) => removePreset(String(id ?? '')))
  handle(Ipc.EntertainmentPresetApply, (_e, id) => applyPreset(String(id ?? '')))
  handle(Ipc.EntertainmentSendKeys, (_e, keySeq) =>
    sendKeys(String(keySeq ?? ''))
  )
  handle(Ipc.EntertainmentSystemAction, (_e, cmd, param) =>
    systemAction(cmd as 'shutdown' | 'lock' | 'displayoff' | 'kill', String(param ?? ''))
  )
  handle(Ipc.EntertainmentListGiftImages, () => listGiftImages())
  handle(Ipc.EntertainmentListImageFiles, (_e, dir) => {
    try {
      const fs = require('fs') as typeof import('fs')
      const p = require('path') as typeof import('path')
      const folder = String(dir ?? '')
      if (!folder || !fs.existsSync(folder)) return { ok: true, list: [] }
      const list: { name: string; path: string }[] = []
      for (const file of fs.readdirSync(folder)) {
        if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(file)) list.push({ name: file, path: p.join(folder, file) })
      }
      return { ok: true, list }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle(Ipc.EntertainmentTransparentImport, (_e, filePath) =>
    importTransparentDatabase(String(filePath ?? ''))
  )
  handle(Ipc.EntertainmentTransparentExport, (_e, payload) =>
    exportTransparentDatabase(payload)
  )
  handle(Ipc.EntertainmentPinyouImport, (e) => importPinyouConfig(e.sender))
  handle(Ipc.EntertainmentPinyouApply, (_e, rules, replace) => importPinyouRules(rules, replace === true))
  handle(Ipc.EntertainmentRunScript, (_e, path) =>
    runScript(String(path ?? ''))
  )
  handle(Ipc.EntertainmentSavePng, (_e, dataUrl, defaultName, targetDir) =>
    savePng(String(dataUrl ?? ''), String(defaultName ?? ''), targetDir ? String(targetDir) : undefined)
  )
  handle(Ipc.EntertainmentCopyImage, (_e, dataUrl) =>
    copyImageToClipboard(String(dataUrl ?? ''))
  )
  handle(Ipc.TimeWidgetLog, () => timeWidgetLog())
  handle(Ipc.TimeWidgetLogClear, () => timeWidgetLogClear())
  handle(Ipc.TimeWidgetTestGift, (_e, name) => timeWidgetTestGift(String(name ?? '')))
  handle(Ipc.TimeWidgetTestEvent, (_e, id) => timeWidgetTestEvent(String(id ?? '')))
  handle(Ipc.TimeWidgetCancelQueue, () => timeWidgetCancelQueue())
  handle(Ipc.EntertainmentMouse, (_e, action, x, y) =>
    mouseAction(action, x == null ? undefined : Number(x), y == null ? undefined : Number(y))
  )
  handle(Ipc.EntertainmentSendText, (_e, text, mode, enterAfter) =>
    sendText(String(text ?? ''), mode === 'paste' ? 'paste' : 'send', !!enterAfter)
  )
  handle(Ipc.EntertainmentCommand, (_e, cmd, param) =>
    entertainmentCommand(String(cmd ?? ''), param == null ? undefined : String(param))
  )
  handle(Ipc.DanmakuForwardStart, (_e, port) =>
    startDanmakuForward(Number(port))
  )
  handle(Ipc.DanmakuForwardStop, () => stopDanmakuForward())
  handle(Ipc.DanmakuForwardState, () => danmakuForwardState())
  handle(Ipc.DanmakuForwardPublish, (_e, event) =>
    publishDanmakuForward(event as DanmakuForwardEvent)
  )
  handle(Ipc.GreenScreenOpen, (_e, src, type, text, slot, options) =>
    openGreenScreen(String(src ?? ''), type === 'image' ? 'image' : 'video', String(text ?? ''), slot ?? 1, { ...(options || {}), replace: true })
  )
  // 页面上点的关闭：排队中的素材一起清掉，不然 50 毫秒后下一条又顶上来
  handle(Ipc.GreenScreenClose, (_e, slot) => closeGreenScreen(slot ?? undefined, { clearQueue: true }))
  handle(Ipc.GreenScreenState, () => greenScreenState())
  // 绿幕窗口调尺寸：先记住（窗口没开也记，下次开按它来；触发播放也不会再打回 640×360），开着的当场改
  handle(Ipc.GreenScreenResize, (_e, slot, width, height) => {
    const w = Math.round(Number(width) || 0), h = Math.round(Number(height) || 0)
    if (!rememberGreenScreenSize(slot, w, h)) return { ok: false, error: '尺寸要在 64~4096 之间' }
    const resized = resizeOutputWindow(`绿幕${slot}`, w, h)
    return resized.ok ? resized : { ok: true }
  })
  // 通用：按窗口标题调任意采集窗口的大小（转盘/九宫格/挂件都能用）
  handle(Ipc.OutputWindowResize, (_e, title, width, height) =>
    resizeOutputWindow(String(title ?? ''), Math.round(Number(width) || 0), Math.round(Number(height) || 0))
  )
  // 读采集窗口现在的大小（主播拖边框调过的也算）；窗口不存在回 null
  handle(Ipc.OutputWindowSize, (_e, title) => outputWindowSize(String(title ?? '')))

  // ---- 时间插件挂件 ----
  handle(Ipc.TimeWidgetOpen, (_e, cfg) => openTimeWidget(cfg ?? {}))
  handle(Ipc.TimeWidgetClose, () => closeTimeWidget())
  handle(Ipc.TimeWidgetState, () => timeWidgetState())
  handle(Ipc.TimeWidgetUpdate, (_e, cfg) => timeWidgetUpdate(cfg ?? {}))
  handle(Ipc.TimeWidgetAdjust, (_e, delta) =>
    timeWidgetAdjust(Number(delta) || 0)
  )
  handle(Ipc.TimeWidgetClear, () => timeWidgetClear())
  handle(Ipc.TimeWidgetPause, (_e, ms) =>
    timeWidgetPause(Number(ms) || 0)
  )
  handle(Ipc.TimeWidgetShowGift, (_e, name, imgSrc) =>
    timeWidgetShowGift(String(name || ''), String(imgSrc || ''))
  )
  // 「抽时间记录」窗口：开关状态写进设置，下次开客户端自动恢复
  handle(Ipc.TimeLogOpen, () => {
    const result = timeLogOpen()
    if (result.ok) saveSettings({ timeLogWindow: true })
    return result
  })
  handle(Ipc.TimeLogClose, () => { timeLogClose(); saveSettings({ timeLogWindow: false }); return { ok: true } })
  handle(Ipc.TimeLogState, () => timeLogState())

  // ---- 飘屏 ----
  handle(Ipc.MarqueeOpen, (_e, config) => openMarquee(config ?? undefined))
  // 礼物筛选/弹幕关键词由主进程持有；老版本没注册这个通道，页面改了筛选主进程永远不知道。
  handle(Ipc.MarqueeConfigure, (_e, config) => configureMarquee(config ?? {}))
  handle(Ipc.MarqueeClose, () => closeMarquee())
  handle(Ipc.MarqueeState, () => marqueeState())
  handle(Ipc.MarqueeSend, (_e, text, imgSrc) =>
    marqueeSend(String(text ?? ''), imgSrc ? String(imgSrc) : undefined)
  )

  // ---- 计数挑战 ----
  handle(Ipc.ChallengeOpen, (_e, cfg) => openChallengeWidget(cfg ?? {}))
  handle(Ipc.ChallengeUpdate, (_e, cfg) => updateChallengeWidget(cfg ?? {}))
  handle(Ipc.ChallengeClose, (_e, slot) => closeChallengeWidget(slot))
  handle(Ipc.ChallengeState, (_e, slot) => challengeWidgetState(slot))
  handle(Ipc.ChallengeAdjust, (_e, delta) =>
    challengeAdjust(Number(delta) || 0)
  )
  handle(Ipc.ChallengeApplyGift, (_e, op, before, after, showRecord) =>
    challengeApplyGift(String(op ?? '加减'), Number(before) || 0, Number(after) || 0, !!showRecord)
  )
  handle(Ipc.ChallengePause, (_e, ms) =>
    challengePause(Number(ms) || 0)
  )

  // ---- 转盘/九宫格 绿幕挂件窗口 ----
  const executePrizeAction = async (item: LotteryItem, isCurrent: () => boolean, checkOnly = false, guarded = false): Promise<{ ok: boolean; error?: string }> => {
    if (!isCurrent()) return { ok: false, error: '事件已取消' }
    const param = String(item.actionParam || '').trim()
    switch (item.action) {
      case 'none': return { ok: true }
      case 'prank': {
        const [game, id] = param.split('|')
        if (!id || currentGameId() !== game) return { ok: false, error: '请先切换到奖项绑定的游戏' }
        if (!(await liveState()).inGame) return { ok: false, error: '游戏尚未进入局内' }
        if (!isCurrent()) return { ok: false, error: '抽奖已取消' }
        if (currentGameId() !== game) return { ok: false, error: '当前游戏已切换，中奖事件已取消' }
        if (checkOnly) return { ok: true }
        return livePrank(id, () => isCurrent() && currentGameId() === game)
      }
      case 'effect': {
        if (!['parabola', 'bomb', 'car', 'firework', 'rain'].includes(param)) return { ok: false, error: '请选择礼物动画' }
        if (checkOnly) return { ok: true }
        const opened = openEffectsWindow()
        if (!opened.ok) return opened
        if (guarded) return effectsFireChecked(param as 'parabola' | 'bomb' | 'car' | 'firework' | 'rain', item.name, isCurrent, 1, item.img)
        return effectsFire(param as 'parabola' | 'bomb' | 'car' | 'firework' | 'rain', item.name, 1, item.img)
      }
      // 转盘/九宫格自己会在窗口里播（不走这儿）；时间盲盒等没有舞台的场合退回绿幕窗口
      // 参数尾部可带「|绿幕N」指定窗口；不带 = 默认窗口排队模型
      case 'stage-video':
      case 'green-video': {
        const { rest, target, overflow } = splitVideoTarget(param)
        if (checkOnly) return validMedia(rest) ? { ok: true } : { ok: false, error: '视频素材不存在，请重新选择' }
        return openGreenScreen(rest, 'video', item.name, target === 'video' ? 0 : target, { loop: false, maxSeconds: item.actionSeconds || 0, chroma: item.chroma === true, origin: 'command', overflow })
      }
      case 'video':
        if (checkOnly) return validMedia(param) ? { ok: true } : { ok: false, error: '视频素材不存在，请重新选择' }
        return openVideoWidget({ path: param, loop: false, muted: false, volume: 1, topMost: true, width: 480, height: 270, bgColor: captureSourceBackground(), autoClose: true, maxSeconds: item.actionSeconds || 0, chroma: item.chroma === true })
      case 'countdown-adjust': {
        const range = param.match(/^([+-]?\d+)(?:\s*[,~～]\s*([+-]?\d+))?$/)
        if (!range) return { ok: false, error: '请填写整数秒数或范围，例如 -30 或 10~60' }
        const a = Number(range[1]), b = range[2] == null ? a : Number(range[2])
        const min = Math.min(a, b), span = Math.abs(a - b) + 1
        if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(span)) {
          return { ok: false, error: '秒数或范围过大，请缩小后重试' }
        }
        if (checkOnly) return timeWidgetState().open ? { ok: true } : { ok: false, error: '先开启倒计时挂件' }
        const delta = range[2] == null ? a : min + Math.min(span - 1, Math.floor(Math.random() * span))
        return timeWidgetAdjust(delta)
      }
      case 'countdown-clear':
        if (checkOnly) return timeWidgetState().open ? { ok: true } : { ok: false, error: '先开启倒计时挂件' }
        return entertainmentCommand('countdown-clear', undefined, { isCurrent })
      case 'command': {
        // 万能出口：<动作命令>|<参数>。参数本身可能含 |（如「视频路径|3」「W,A,S,D|5000」），
        // 所以只按第一个 | 切一次。
        const cut = param.indexOf('|')
        const cmd = (cut < 0 ? param : param.slice(0, cut)).trim()
        const rest = cut < 0 ? '' : param.slice(cut + 1).trim()
        if (!cmd) return { ok: false, error: '请选择要执行的动作命令' }
        if (checkOnly) return { ok: true }
        return entertainmentCommand(cmd, rest || undefined, { chroma: item.chroma === true, isCurrent })
      }
      default: return { ok: false, error: '不支持的中奖动作' }
    }
  }
  setLotteryActionHandler(executePrizeAction)
  setTimeBlindBoxActionHandler((event, isCurrent, checkOnly) => executePrizeAction({ name: event.name, color: '', action: event.action || 'none', actionParam: event.actionParam }, isCurrent, checkOnly, true))
  handle(Ipc.LotteryOpen, (_e, kind, items, centerImg) =>
    kind === 'nine'
      ? openNineGridWindow(Array.isArray(items) ? items : [])
      : kind === 'lucky'
        ? openLuckyWindow(Array.isArray(items) ? items : [], centerImg ? String(centerImg) : undefined)
        : openWheelWindow(Array.isArray(items) ? items : [])
  )
  handle(Ipc.LotteryConfigure, (_e, kind, trigger, items, centerImg) =>
    configureLottery(kind === 'nine' ? 'nine' : kind === 'lucky' ? 'lucky' : 'wheel', trigger ?? {}, Array.isArray(items) ? items : undefined, centerImg == null ? undefined : String(centerImg))
  )
  handle(Ipc.LotteryClose, (_e, kind) =>
    closeLotteryWindow(kind === 'nine' ? 'nine' : kind === 'lucky' ? 'lucky' : 'wheel')
  )
  handle(Ipc.LotterySpin, (_e, kind) =>
    lotterySpin(kind === 'nine' ? 'nine' : kind === 'lucky' ? 'lucky' : 'wheel')
  )
  handle(Ipc.LotteryState, () => lotteryState())
  handle(Ipc.LotteryHistory, (_e, limit) => lotteryHistory(Number(limit) || 200))
  handle(Ipc.LotteryHistoryClear, () => clearLotteryHistory())
  handle(Ipc.AdvancedWheelOpen, (_e, config) => openAdvancedWheel(config ?? {}))
  handle(Ipc.AdvancedWheelClose, (_e, source) =>
    closeAdvancedWheel(source === 2 ? 2 : 1)
  )
  handle(Ipc.AdvancedWheelSpin, (_e, source) =>
    spinAdvancedWheel(source === 2 ? 2 : 1)
  )
  handle(Ipc.AdvancedWheelUpdate, (_e, config) => updateAdvancedWheel(config ?? {}))
  handle(Ipc.AdvancedWheelState, () => advancedWheelState())
  handle(Ipc.AdvancedWheelImport, (_e, source) =>
    importAdvancedWheelConfig(source === 2 ? 2 : 1)
  )
  handle(Ipc.AdvancedWheelExport, (_e, config) =>
    exportAdvancedWheelConfig(config ?? {})
  )

  // ---- 礼物积分进度条 绿幕挂件窗口（计分在主进程）----
  handle(Ipc.ProgressOpen, () => openProgressWindow())
  handle(Ipc.ProgressClose, () => closeProgressWindow())
  handle(Ipc.ProgressConfigure, (_e, cfg) => configureProgress(cfg ?? {}))
  handle(Ipc.ProgressAdjust, (_e, delta) => progressAdjust(Number(delta) || 0))
  handle(Ipc.ProgressReset, () => progressReset())
  handle(Ipc.ProgressState, () => progressState())

  // ---- 键盘显示挂件 ----
  handle(Ipc.KeyboardOpen, (_e, cfg) => openKeyboardWindow(cfg ?? undefined))
  handle(Ipc.KeyboardClose, () => closeKeyboardWindow())
  handle(Ipc.KeyboardConfigure, (_e, cfg) => configureKeyboardWidget(cfg ?? {}))
  handle(Ipc.KeyboardState, () => keyboardWidgetState())

  // ---- OBS 滤镜/场景 ----
  handle(Ipc.ObsState, () => obsPanelStateFresh())
  handle(Ipc.ObsConnect, (_e, cfg) => obsConnectNow(cfg ?? undefined))
  handle(Ipc.ObsDisconnect, () => obsDisconnectNow())
  handle(Ipc.ObsConfigure, (_e, cfg) => obsConfigure(cfg ?? {}))
  handle(Ipc.ObsRefresh, () => obsRefresh())
  handle(Ipc.ObsSetFilter, (_e, source, filter, enabled) =>
    obsSetFilter(String(source ?? ''), String(filter ?? ''), !!enabled)
  )
  handle(Ipc.ObsSetScene, (_e, scene) => obsSwitchScene(String(scene ?? '')))
  handle(Ipc.ObsLaunch, () => obsLaunch())
  handle(Ipc.ObsEnableServer, (_e, password) => obsEnableServer(String(password ?? '')))
  handle(Ipc.LiveCompanionState, (_e, refresh) => liveCompanionState(!!refresh))
  handle(Ipc.LiveCompanionLaunch, () => liveCompanionLaunch())
  handle(Ipc.LiveCompanionDirectory, (_e, dir) => liveCompanionSetDirectory(dir))

  // ---- 保护主播：计时牌 + 拒收礼物 ----
  handle(Ipc.ProtectWidgetOpen, (_e, startedAt) => openProtectWidget(Number(startedAt) || Date.now()))
  handle(Ipc.ProtectWidgetClose, () => closeProtectWidget())
  handle(Ipc.EntertainmentRulesPause, (_e, paused) => setRulesPaused(!!paused))
  handle(Ipc.EntertainmentProtectState, () => ({ paused: rulesPausedState(), ...(() => { const s = protectWidgetState(); return { protectOpen: s.open, startedAt: s.startedAt } })() }))

  // ---- 以管理员身份重启（键盘显示对管理员权限的游戏窗口收不到键时用）----
  handle(Ipc.AppRelaunchElevated, () => {
    const { app } = require('electron') as typeof import('electron')
    if (!app.isPackaged) return { ok: false, error: '开发模式不支持，打包版才能以管理员重启' }
    try {
      const exe = process.execPath.replace(/'/g, "''")
      const { spawn } = require('child_process') as typeof import('child_process')
      const elevated = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${exe}' -Verb RunAs`], { windowsHide: true, stdio: 'ignore', detached: true })
      elevated.on('error', () => { /* UAC 拒绝/起不来：不能让 error 事件变成未捕获异常 */ })
      elevated.unref()
      markQuitReason('以管理员身份重启')
      setTimeout(() => app.quit(), 800)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ---- 环境自检 ----
  handle(Ipc.AppSelfCheck, () => runSelfCheck())
  // 页面错误边界 → 主进程日志；设置页「打开日志目录」
  handle(Ipc.AppReportError, (_e, payload) => reportRendererError(payload || {}))
  handle(Ipc.AppOpenLogs, () => openLogsDir())

  // ---- 礼物贴纸统计（主进程常驻累计）----
  handle(Ipc.StickerState, () => stickerState())
  handle(Ipc.StickerReset, () => stickerReset())
  handle(Ipc.StickerImport, (_e, stats) => stickerImport(stats && typeof stats === 'object' ? stats : {}))

  // ---- 礼物动画 绿幕/透明窗口（抛物线/炸弹/小车/烟花/掉落）----
  handle(Ipc.EffectsOpen, (_e, cfg) => openEffectsWindow(cfg ?? undefined))
  handle(Ipc.EffectsClose, () => closeEffectsWindow())
  handle(Ipc.EffectsConfigure, (_e, cfg) => configureEffects(cfg ?? {}))
  handle(Ipc.EffectsFire, (_e, kind, name, count, sender) =>
    effectsFire(kind, String(name ?? ''), Number(count) || 1, undefined, sender ? String(sender) : '')
  )
  handle(Ipc.EffectsState, () => effectsState())

  // ---- 特色整蛊（绿幕叠加层小游戏，独立顶级菜单）----
  handle(Ipc.SpecialOpen, (_e, id, cfg) => openSpecialGame(id, cfg ?? undefined))
  handle(Ipc.SpecialClose, (_e, id) => closeSpecialGame(id))
  handle(Ipc.SpecialConfigure, (_e, id, cfg) => configureSpecialGame(id, cfg ?? {}))
  handle(Ipc.SpecialState, () => specialState())
  handle(Ipc.SpecialTest, (_e, id, action) => testSpecialGame(id, action ?? undefined))
  handle(Ipc.SpecialStats, (_e, id) => specialStats(id))
  handle(Ipc.SpecialClearAll, () => clearAllSpecial())
  handle(Ipc.SpecialBoxes, () => specialBoxes())
  handle(Ipc.SpecialBoxSave, (_e, box) => saveSpecialBox(box ?? {}))
  handle(Ipc.SpecialBoxRemove, (_e, id) => removeSpecialBox(String(id ?? '')))
  handle(Ipc.SpecialBoxTest, (_e, id) => testSpecialBox(String(id ?? '')))
  handle(Ipc.SpecialCloseAll, () => closeAllSpecial())

  // ---- 大哥进场 ----
  handle(Ipc.EntranceOpen, () => openEntranceWindow())
  handle(Ipc.EntranceClose, () => closeEntranceWindow())
  handle(Ipc.EntranceConfigure, (_e, cfg) => configureEntrance(cfg ?? {}))
  handle(Ipc.EntranceState, () => entranceState())
  handle(Ipc.EntranceTest, (_e, name, avatar) => entranceTest(String(name ?? ''), String(avatar ?? '')))
  // 已出现的观众（大哥进场下拉）：只读本机记录，不外传
  handle(Ipc.ViewerList, (_e, limit) => listViewers(Number(limit) || 1000))
  handle(Ipc.EmojiAssets, () => ({ dir: emojiDir() || '', keys: emojiKeys() }))

  // ---- 整蛊排队展示窗口 ----
  handle(Ipc.QueueOpen, (_e, cfg) => openQueueWindow(cfg ?? undefined))
  handle(Ipc.QueueClose, () => closeQueueWindow())
  handle(Ipc.QueueConfigure, (_e, cfg) => configureQueueWidget(cfg ?? {}))
  handle(Ipc.QueueState, () => queueWidgetState())
  handle(Ipc.QueueClear, () => clearExecQueue())
  handle(Ipc.QueueSkip, (_e, count) => skipExecQueue(Number(count) || 1))

  // ---- 礼物心愿 A/B 绿幕窗口（计数在主进程）----
  handle(Ipc.WishOpen, () => openWishWindow())
  handle(Ipc.WishClose, () => closeWishWindow())
  handle(Ipc.WishConfigure, (_e, cfg) => configureWish(cfg ?? {}))
  handle(Ipc.WishReset, (_e, group, gift) =>
    wishReset(group === 0 || group === 1 ? group : undefined, gift ? String(gift) : undefined)
  )
  handle(Ipc.WishState, () => wishWindowState())
  handle(Ipc.OpenPath, (_e, p) => {
    try {
      const r = shell.openPath(String(p ?? ''))
      if (typeof r === 'string' && r) return { ok: false, error: r }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle(Ipc.ListFontFiles, (_e, dir) => {
    try {
      const fs = require('fs') as typeof import('fs')
      const p = require('path') as typeof import('path')
      if (!dir || !fs.existsSync(String(dir))) return { ok: true, list: [] }
      const list: { name: string; path: string }[] = []
      for (const f of fs.readdirSync(String(dir))) {
        if (/\.(ttf|otf|ttc|woff2?)$/i.test(f)) list.push({ name: f.replace(/\.[^.]+$/, ''), path: p.join(String(dir), f) })
      }
      return { ok: true, list }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ---- 视频播放器 ----
  handle(Ipc.VideoWidgetOpen, (_e, cfg) => openVideoWidget(cfg ?? {}))
  handle(Ipc.VideoWidgetClose, (_e, slot) => closeVideoWidget(slot === 'main' || slot === 'vip' ? slot : undefined))
  handle(Ipc.VideoWidgetState, () => videoWidgetState())

  // ---- 公告 ----
  handle(Ipc.NewsList, () => listNews())

  // ---- 更新 ----
  handle(Ipc.UpdateCheck, (_e, silent?: boolean) => checkForUpdates(!!silent))
  handle(Ipc.UpdateDownload, () => downloadUpdate())
  handle(Ipc.UpdateInstall, () => installUpdate())

  // ---- 文件选择 ----
  handle(
    Ipc.DialogSelect,
    async (
      _e,
      options: {
        title?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory')[]
      }
    ) => {
      const win = BrowserWindow.getFocusedWindow()
      const res = await dialog.showOpenDialog(win!, {
        title: options.title ?? '选择文件',
        filters: options.filters,
        properties: options.properties ?? ['openFile']
      })
      if (res.canceled || res.filePaths.length === 0) return { ok: false }
      // 多选时把整份名单也带回去（新建项目要一次挑一堆视频）
      return { ok: true, path: res.filePaths[0], paths: res.filePaths }
    }
  )

  // ---- 窗口控制 ----
  on(Ipc.WindowMinimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  on(Ipc.WindowMaximizeToggle, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  on(Ipc.WindowClose, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    // 留痕：主播自己点的标题栏关闭。日志里紧跟着的「主窗口 close」就有了来源
    logLine('window', `标题栏关闭按钮：${(() => { try { return win?.getTitle() || '' } catch { return '' } })()}`)
    win?.close()
  })
  handle(Ipc.WindowSetAlwaysOnTop, (e, flag) => {
    BrowserWindow.fromWebContents(e.sender)?.setAlwaysOnTop(!!flag)
    saveSettings({ alwaysOnTop: !!flag })
    return { ok: true }
  })
  // 登录小窗 ↔ 主界面大窗切换（renderer 按登录态调用）
  on(Ipc.WindowResize, (e, w: number, h: number, minW: number, minH: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isMaximized()) return
    win.setMinimumSize(minW, minH)
    win.setSize(w, h)
    win.center()
  })
}
