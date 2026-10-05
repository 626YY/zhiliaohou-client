import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  Ipc,
  type AppVersionInfo,
  type TimeBlindBoxEvent,
  type MediaFileInfo,
  type PinyouProjectInfo,
  type PinyouItemActions,
  type PinyouProjectItem,
  type AuthResult,
  type AuthAccount,
  type SessionUser,
  type ModsListResult,
  type ConfigReadResult,
  type ConfigSaveResult,
  type PranksResult,
  type PrankGroup,
  type BindRoomResult,
  type GameLaunchResult,
  type GameProcessState,
  type GameItem,
  type ConnectorState,
  type ConnectorLogLine,
  type ConnectorEvent,
  type EntertainmentGiftImage,
  type Settings,
  type SettingsResult,
  type NewsItem,
  type LiveStateResult,
  type GiftLogState,
  type GiftImageSyncResult,
  type UpdateCheckResult,
  type UpdateStatusPayload,
  type RoomAutoBoundPayload,
  type RoomsSyncedPayload,
  type SyncEmailRoomsResult,
  type EmailAuthResult,
  type EmailLicense,
  type EmailGameApplyResult,
  type AppNotification,
  type NotifyListResult,
  type ConfigCloudResult,
  type LiveStatsResult,
  type DouyinRoomLookup,
  type EntertainmentRule,
  type EntertainmentPreset,
  type MouseActionType,
  type EntertainmentCommandCmd,
  type DanmakuForwardEvent,
  type DanmakuForwardState,
  type TimeWidgetConfig,
  type TimeWidgetState,
  type TimeGiftLogEntry,
  type CountChallengeConfig,
  type CountChallengeGift,
  type VideoWidgetConfig,
  type VideoWidgetSlot,
  type VideoWidgetState,
  type GreenScreenSlot,
  type GreenScreenState,
  type LotteryItem,
  type LotteryTrigger,
  type LotteryEvent,
  type LotteryDraw,
  type EffectKind,
  type EffectsConfig,
  type EntranceConfig,
  type EntranceState,
  type ViewerListResult,
  type ExecQueueSnapshot,
  type QueueWidgetConfig,
  type QueueWidgetState,
  type AdvancedWheelConfig,
  type ProgressConfig,
  type ProgressState,
  type KeyboardWidgetConfig,
  type KeyboardWidgetState,
  type ObsPanelState,
  type ObsSettings,
  type LiveCompanionStatus,
  type StickerState,
  type SelfCheckResult,
  type ModInstallProgress,
  type MarqueeConfig,
  type WishConfig,
  type WishWidgetState,
  type EntertainmentSoundEvent,
  type TransparentDbImportResult,
  type PinyouImportResult,
  type PinyouApplyResult,
  type TransparentColorRecord,
  type TransparentGiftRecord,
  type TransparentGiftVersion,
  type TransparentMenuProgram,
  type ModHealth,
  type CardSnapshot,
  type CardRoomsResult,
  type CardRoomVerifyResult,
  type CardRoomCommitInput,
  type CardRoomCommitResult,
} from '../shared/types'
import type { SpecialBoxEvent, SpecialGameId, SpecialGameConfig, SpecialGameplayState, SpecialTestAction, SpecialWindowConfig } from '../shared/specialGames'

export interface ZLAPI {
  register: (
    username: string,
    password: string,
    nickname: string
  ) => Promise<AuthResult>
  login: (username: string, password: string) => Promise<AuthResult>
  logout: () => Promise<{ ok: boolean }>
  session: () => Promise<SessionUser | null>
  bindRoom: (roomId: string) => Promise<BindRoomResult>
  unbindRoom: (roomId: string) => Promise<BindRoomResult>
  deleteAccount: (id: string) => Promise<{ ok: boolean; error?: string; email?: string }>
  listAccounts: () => Promise<AuthAccount[]>
  credLoad: () => Promise<{ last: { username: string; password: string } | null }>
  credUser: (username: string) => Promise<{ password: string | null }>
  credSave: (username: string, password: string) => Promise<{ ok: boolean }>
  credClearLast: () => Promise<{ ok: boolean }>
  credClearUser: (username: string) => Promise<{ ok: boolean }>
  updateAvatar: (avatar: string) => Promise<SessionUser | null>
  bindRoomWithLicense: (roomId: string) => Promise<BindRoomResult>
  roomLookup: (roomId: string, interactive?: boolean) => Promise<DouyinRoomLookup>
  submitRoomApply: (roomId: string) => Promise<BindRoomResult>
  cancelRoomApply: () => Promise<{ ok: boolean }>
  onRoomAutoBound: (cb: (payload: RoomAutoBoundPayload) => void) => () => void
  reportRoomUnbind: (room: string) => Promise<BindRoomResult>
  syncEmailRooms: () => Promise<SyncEmailRoomsResult>
  onRoomsSynced: (cb: (payload: RoomsSyncedPayload) => void) => () => void

  emailSendCode: (email: string) => Promise<EmailAuthResult>
  emailRegister: (
    email: string,
    code: string,
    password: string,
    nickname?: string
  ) => Promise<AuthResult>
  emailLogin: (email: string, password: string) => Promise<AuthResult>
  emailReset: (
    email: string,
    code: string,
    password: string
  ) => Promise<EmailAuthResult>
  emailGetLicense: (email: string) => Promise<EmailLicense>
  /** 测试用：按给定可用内存（MB）跑一次内存守卫判定，返回等级 */
  memoryGuardProbe: (availableMb: number) => Promise<'normal' | 'tight' | 'critical'>
  /** 素材瘦身状态：ffmpeg 有没有、排队 / 已压 / 跳过 / 失败数、缓存占用 */
  mediaOptimizeState: () => Promise<{ enabled: boolean; ffmpeg: string; target: number; pending: number; done: number; skipped: number; failed: number; cacheMb: number }>
  emailGameApply: (email: string, game: string) => Promise<EmailGameApplyResult>
  emailNotifyList: (email: string) => Promise<NotifyListResult>
  emailNotifyRead: (email: string, id: string) => Promise<void>
  emailNotifyReadAll: (email: string) => Promise<void>
  emailConfigSave: (email: string, data: unknown) => Promise<ConfigCloudResult>
  emailConfigLoad: (email: string) => Promise<ConfigCloudResult>
  emailBuyContact: () => Promise<string>
  onNotifyNew: (cb: (n: AppNotification) => void) => () => void

  liveStats: () => Promise<LiveStatsResult>
  statsPrankTick: () => Promise<void>

  listMods: () => Promise<ModsListResult>
  installMod: (modId: string) => Promise<{ ok: boolean; error?: string }>
  uninstallMod: (modId: string) => Promise<{ ok: boolean; error?: string }>
  modHealth: (gameId?: string) => Promise<ModHealth>
  modRepair: (gameId?: string) => Promise<{ ok: boolean; error?: string; did: string[] }>
  modDiagnose: (gameId?: string) => Promise<{ ok: boolean; file?: string; error?: string }>
  modDiagnoseUpload: (gameId?: string) => Promise<{ ok: boolean; code?: string; error?: string }>
  appVersion: () => Promise<AppVersionInfo>
  pinyouProjects: (root?: string) => Promise<{ root: string; projects: PinyouProjectInfo[]; error?: string }>
  pinyouAssetRootPick: () => Promise<{ ok: boolean; root?: string; projects?: PinyouProjectInfo[]; error?: string }>
  pinyouProjectTest: (dir: string, slot?: number) => Promise<{ ok: boolean; error?: string }>
  // 项目里每条视频的动作（读取项目后可以给单条视频配动作）
  pinyouItemActionsGet: (dir: string) => Promise<{ ok: boolean; dir?: string; items: PinyouProjectItem[]; actions: Record<string, PinyouItemActions>; error?: string }>
  pinyouItemActionsSet: (dir: string, name: string, config: PinyouItemActions | null) => Promise<{ ok: boolean; error?: string }>
  pinyouProjectsImport: (dirs: string[], slot?: number) => Promise<{ ok: boolean; added: string[]; skipped: string[] }>
  pinyouItemsImport: (
    dirs: string[],
    slot?: number
  ) => Promise<{ ok: boolean; added: number; projects: string[]; skipped: string[] }>
  pinyouTimeImport: (dirs: string[]) => Promise<{
    ok: boolean
    events: TimeBlindBoxEvent[]
    report: { project: string; added: number; skipped: number; why: string[] }[]
  }>
  /** 导入别人导出的规则时，把素材路径改到本机素材目录；missing = 本机缺的项目文件夹 */
  pinyouRelocateRules: (rules: EntertainmentRule[]) => Promise<{
    rules: EntertainmentRule[]
    moved: number
    missing: string[]
  }>
  /** 导出一个项目成文件夹（素材 + 项目规则.json），别人「导入项目」能直接读 */
  projectExport: (
    project: string,
    rules: EntertainmentRule[],
    /** 目标目录；不传就弹选择框（回归测试直接给路径） */
    destRoot?: string
  ) => Promise<{ ok: boolean; canceled?: boolean; error?: string; dir?: string; files?: number; bytes?: number; withMedia?: boolean }>
  /** 从文件夹导入项目（不传路径就弹选择框）；added = 建成的规则条数 */
  projectImportFolder: (dir?: string) => Promise<{
    ok: boolean
    canceled?: boolean
    error?: string
    project?: string
    dir?: string
    added?: number
    copied?: number
    fromManifest?: boolean
    skipped?: string[]
  }>
  /** 新建项目：素材目录里建文件夹 + 复制视频 + 自动建规则 */
  projectCreate: (
    name: string,
    files?: string[]
  ) => Promise<{ ok: boolean; error?: string; dir?: string; copied?: number; added?: number }>
  mediaList: (dir: string) => Promise<{ dir: string; files: MediaFileInfo[]; error?: string }>
  mediaFolderPick: () => Promise<{ ok: boolean; dir: string; files: MediaFileInfo[]; error?: string }>
  onModInstallProgress: (cb: (p: ModInstallProgress) => void) => () => void

  readConfig: () => Promise<ConfigReadResult>
  saveConfig: (values: Record<string, unknown>) => Promise<ConfigSaveResult>
  readPranks: () => Promise<PranksResult>
  /** 全部游戏的整蛊菜单（按分组；定义包更新源优先、自带兜底） */
  prankCatalog: () => Promise<Record<string, PrankGroup[]>>
  /** 定义包从更新源刷新后触发（渲染层据此重拉 prankCatalog） */
  onPrankCatalogChanged: (cb: () => void) => () => void

  launchGame: () => Promise<GameLaunchResult>
  gameState: () => Promise<GameProcessState>
  detectGamePath: () => Promise<{ ok: boolean; path?: string; error?: string }>
  detectAllGames: () => Promise<{ ok: boolean; found: Record<string, string> }>
  /** 设置某款游戏的 exe 路径；选错会自动纠正到正确的那个（fixed=true 表示改过） */
  setGamePath: (
    gameId: string,
    path: string
  ) => Promise<{ ok: boolean; path?: string; fixed?: boolean; error?: string }>
  gamesList: () => Promise<GameItem[]>
  setGameCurrent: (id: string) => Promise<{ ok: boolean }>

  liveSet: (key: string, value: unknown) => Promise<{ ok: boolean; error?: string }>
  livePrank: (id: string) => Promise<{ ok: boolean; error?: string }>
  liveCmd: (cmd: string) => Promise<{ ok: boolean; error?: string }>
  liveState: () => Promise<LiveStateResult>
  /** 手动同步抖音礼物图（连接直播间时也会自动做） */
  giftImagesSync: (roomId?: string) => Promise<GiftImageSyncResult>

  connectorStart: (
    room: string,
    sim?: boolean,
    platform?: 'douyin' | 'bilibili'
  ) => Promise<{ ok: boolean; error?: string }>
  connectorStop: () => Promise<{ ok: boolean }>
  connectorState: () => Promise<ConnectorState>
  connectorSend: (cmd: string) => Promise<{ ok: boolean; error?: string }>
  // 模拟一条连接器日志行（礼物/进场/关注/点赞/弹幕），不开播也能测全部挂件和规则
  connectorSimulate: (text: string) => Promise<{ ok: boolean; error?: string }>
  connectorLog: () => Promise<ConnectorLogLine[]>
  onConnectorLog: (cb: (line: ConnectorLogLine) => void) => () => void
  onConnectorEvent: (cb: (event: ConnectorEvent) => void) => () => void
  onEntertainmentSound: (cb: (event: EntertainmentSoundEvent) => void) => () => void

  getSettings: () => Promise<SettingsResult>
  saveSettings: (patch: Partial<Settings>) => Promise<SettingsResult>
  listNews: () => Promise<NewsItem[]>

  checkForUpdates: (silent?: boolean) => Promise<UpdateCheckResult>
  onUpdateStatus: (cb: (payload: UpdateStatusPayload) => void) => () => void
  downloadUpdate: () => Promise<UpdateCheckResult>
  updateInstall: () => void

  selectFile: (options: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory')[]
  }) => Promise<{ ok: boolean; path?: string; paths?: string[] }>

  windowMinimize: () => void
  windowMaximizeToggle: () => void
  windowClose: () => void
  windowSetAlwaysOnTop: (flag: boolean) => Promise<{ ok: boolean }>
  windowResize: (w: number, h: number, minW: number, minH: number) => void
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void

  entertainmentRulesList: () => Promise<EntertainmentRule[]>
  entertainmentRuleAdd: (rule: EntertainmentRule) => Promise<{ ok: boolean; id?: string; error?: string }>
  entertainmentRuleUpdate: (rule: EntertainmentRule) => Promise<{ ok: boolean; error?: string }>
  entertainmentRuleRemove: (id: string) => Promise<{ ok: boolean }>
  /** 整组规则开关（一个组 = 一个品游项目）；skipped = 还没绑礼物所以开不起来的条数 */
  entertainmentGroupToggle: (
    group: string,
    on: boolean
  ) => Promise<{ ok: boolean; changed: number; skipped: number }>
  entertainmentPresetList: () => Promise<{
    presets: EntertainmentPreset[]
    groups: { group: string; total: number; enabled: number }[]
  }>
  entertainmentPresetSave: (preset: {
    id?: string
    name: string
    groups: string[]
  }) => Promise<{ ok: boolean; id?: string; error?: string }>
  entertainmentPresetRemove: (id: string) => Promise<{ ok: boolean }>
  entertainmentPresetApply: (
    id: string
  ) => Promise<{ ok: boolean; error?: string; on: number; off: number; skipped: number }>
  entertainmentSendKeys: (keySeq: string) => Promise<{ ok: boolean; error?: string }>
  entertainmentSystemAction: (
    cmd: 'shutdown' | 'lock' | 'displayoff' | 'kill',
    param?: string
  ) => Promise<{ ok: boolean; error?: string }>
  entertainmentListGiftImages: () => Promise<EntertainmentGiftImage[]>
  entertainmentListImageFiles: (dir: string) => Promise<{ ok: boolean; list?: { name: string; path: string }[]; error?: string }>
  entertainmentTransparentImport: (filePath: string) => Promise<TransparentDbImportResult>
  entertainmentTransparentExport: (payload: {
    gifts: TransparentGiftRecord[]
    textPrograms: TransparentMenuProgram[]
    imagePrograms: TransparentMenuProgram[]
    programs?: { name: string; cfg: Record<string, unknown> }[]
    giftVersions?: TransparentGiftVersion[]
    colors?: TransparentColorRecord[]
  }) => Promise<{ ok: boolean; path?: string; error?: string }>
  entertainmentPinyouImport: () => Promise<PinyouImportResult>
  entertainmentPinyouApply: (rules: EntertainmentRule[], replace: boolean) => Promise<PinyouApplyResult>
  entertainmentRunScript: (path: string) => Promise<{ ok: boolean; error?: string }>
  entertainmentSavePng: (
    dataUrl: string,
    defaultName: string,
    targetDir?: string
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  entertainmentCopyImage: (dataUrl: string) => Promise<{ ok: boolean; error?: string }>
  timeWidgetLog: () => Promise<TimeGiftLogEntry[]>
  timeWidgetLogClear: () => Promise<{ ok: boolean }>
  timeWidgetTestGift: (name: string) => Promise<{ ok: boolean; error?: string; queued?: number }>
  timeWidgetTestEvent: (id: string) => Promise<{ ok: boolean; error?: string; queued?: number }>
  timeWidgetCancelQueue: () => Promise<{ ok: boolean; cancelled: number }>
  entertainmentMouse: (
    action: MouseActionType,
    x?: number,
    y?: number
  ) => Promise<{ ok: boolean; error?: string }>
  entertainmentSendText: (
    text: string,
    mode: 'send' | 'paste',
    enterAfter?: boolean
  ) => Promise<{ ok: boolean; error?: string }>
  entertainmentCommand: (
    cmd: EntertainmentCommandCmd,
    param?: string
  ) => Promise<{ ok: boolean; error?: string }>
  danmakuForwardStart: (port: number) => Promise<{ ok: boolean; error?: string }>
  danmakuForwardStop: () => Promise<{ ok: boolean }>
  danmakuForwardState: () => Promise<DanmakuForwardState>
  danmakuForwardPublish: (event: DanmakuForwardEvent) => Promise<{ ok: boolean; error?: string }>
  greenScreenOpen: (
    src: string,
    type: 'video' | 'image',
    text?: string,
    slot?: GreenScreenSlot,
    options?: { loop?: boolean; maxSeconds?: number; chroma?: boolean; width?: number; height?: number }
  ) => Promise<{ ok: boolean; error?: string }>
  greenScreenClose: (slot?: GreenScreenSlot) => Promise<{ ok: boolean }>
  greenScreenState: () => Promise<GreenScreenState>
  // 调整已开绿幕窗口的大小（收边基准跟着变）；窗口没开时只记住，下次开生效
  greenScreenResize: (slot: GreenScreenSlot, width: number, height: number) => Promise<{ ok: boolean; error?: string }>
  // 通用：按窗口标题调任意采集窗口的大小（转盘/九宫格/绿幕/挂件通用）
  outputWindowResize: (title: string, width: number, height: number) => Promise<{ ok: boolean; error?: string }>
  // 读采集窗口现在的大小（含主播拖边框调过的）；窗口不存在回 null
  outputWindowSize: (title: string) => Promise<{ width: number; height: number } | null>
  timeWidgetOpen: (cfg: Partial<TimeWidgetConfig>) => Promise<{ ok: boolean; error?: string }>
  timeWidgetClose: () => Promise<{ ok: boolean }>
  timeWidgetState: () => Promise<TimeWidgetState>
  timeWidgetUpdate: (cfg: TimeWidgetConfig) => Promise<{ ok: boolean }>
  timeWidgetAdjust: (delta: number) => Promise<{ ok: boolean }>
  timeWidgetClear: () => Promise<{ ok: boolean }>
  timeWidgetPause: (ms: number) => Promise<{ ok: boolean }>
  timeWidgetShowGift: (name: string, imgSrc: string) => Promise<{ ok: boolean }>
  timeLogOpen: () => Promise<{ ok: boolean; error?: string }>
  timeLogClose: () => Promise<{ ok: boolean }>
  timeLogState: () => Promise<{ open: boolean }>
  marqueeOpen: (config?: Partial<MarqueeConfig>) => Promise<{ ok: boolean; error?: string }>
  marqueeConfigure: (config: Partial<MarqueeConfig>) => Promise<{ ok: boolean }>
  marqueeClose: () => Promise<{ ok: boolean }>
  marqueeState: () => Promise<{ open: boolean; config: MarqueeConfig }>
  marqueeSend: (text: string, imgSrc?: string) => Promise<{ ok: boolean }>
  challengeOpen: (cfg: CountChallengeConfig) => Promise<{ ok: boolean; error?: string }>
  challengeUpdate: (cfg: CountChallengeConfig) => Promise<{ ok: boolean }>
  challengeClose: (slot?: 'challenge' | 'overtime') => Promise<{ ok: boolean }>
  challengeState: (slot?: 'challenge' | 'overtime') => Promise<{ open: boolean; value?: number }>
  challengeAdjust: (delta: number) => Promise<{ ok: boolean }>
  challengeApplyGift: (op: CountChallengeGift['op'], before: number, after: number, showRecord?: boolean) => Promise<{ ok: boolean }>
  challengePause: (ms: number) => Promise<{ ok: boolean }>
  openPath: (p: string) => Promise<{ ok: boolean; error?: string }>
  listFontFiles: (dir: string) => Promise<{ ok: boolean; list?: { name: string; path: string }[]; error?: string }>
  videoWidgetOpen: (cfg: VideoWidgetConfig) => Promise<{ ok: boolean; error?: string }>
  videoWidgetClose: (slot?: VideoWidgetSlot) => Promise<{ ok: boolean }>
  videoWidgetState: () => Promise<VideoWidgetState>
  lotteryOpen: (kind: 'wheel' | 'nine' | 'lucky', items: LotteryItem[], centerImg?: string) => Promise<{ ok: boolean; error?: string }>
  lotteryConfigure: (kind: 'wheel' | 'nine' | 'lucky', trigger: LotteryTrigger, items?: LotteryItem[], centerImg?: string) => Promise<{ ok: boolean; error?: string }>
  lotteryClose: (kind: 'wheel' | 'nine' | 'lucky') => Promise<{ ok: boolean }>
  lotterySpin: (kind: 'wheel' | 'nine' | 'lucky') => Promise<{ ok: boolean; error?: string; queued?: number }>
  lotteryState: () => Promise<{ wheel: boolean; nine: boolean; lucky: boolean; draws?: { wheel?: LotteryEvent; nine?: LotteryEvent } }>
  /** 抽奖流水：抽中什么、什么时候、谁送的礼物触发的 */
  lotteryHistory: (limit?: number) => Promise<LotteryDraw[]>
  lotteryHistoryClear: () => Promise<{ ok: boolean; error?: string }>
  onLotteryEvent: (cb: (event: LotteryEvent) => void) => () => void
  advancedWheelOpen: (config: AdvancedWheelConfig) => Promise<{ ok: boolean; error?: string }>
  advancedWheelClose: (source: 1 | 2) => Promise<{ ok: boolean }>
  advancedWheelSpin: (source: 1 | 2) => Promise<{ ok: boolean; result?: number }>
  advancedWheelUpdate: (config: AdvancedWheelConfig) => Promise<{ ok: boolean; error?: string }>
  advancedWheelState: () => Promise<{ one: boolean; two: boolean }>
  advancedWheelImport: (source: 1 | 2) => Promise<{ ok: boolean; config?: AdvancedWheelConfig; error?: string }>
  advancedWheelExport: (config: AdvancedWheelConfig) => Promise<{ ok: boolean; path?: string; error?: string }>
  effectsOpen: (cfg?: Partial<EffectsConfig>) => Promise<{ ok: boolean; error?: string }>
  effectsConfigure: (cfg: Partial<EffectsConfig>) => Promise<{ ok: boolean }>
  effectsClose: () => Promise<{ ok: boolean }>
  effectsFire: (kind: EffectKind, name: string, count?: number, sender?: string) => Promise<{ ok: boolean }>
  effectsState: () => Promise<{ open: boolean; config: EffectsConfig }>
  specialWindowOpen: () => Promise<{ ok: boolean; error?: string }>
  specialWindowClose: () => Promise<{ ok: boolean; closed: number }>
  specialWindowConfigure: (cfg: Partial<SpecialWindowConfig>) => Promise<{ ok: boolean; window: SpecialWindowConfig }>
  specialConfigure: (id: SpecialGameId, cfg: Partial<SpecialGameConfig>) => Promise<{ ok: boolean }>
  specialState: () => Promise<SpecialGameplayState>
  specialTest: (id: SpecialGameId, action?: SpecialTestAction) => Promise<{ ok: boolean; error?: string }>
  specialStats: (id: SpecialGameId) => Promise<{ open: boolean; value?: number }>
  specialClearAll: () => Promise<{ ok: boolean; cleared: number }>
  specialBoxEvents: () => Promise<SpecialBoxEvent[]>
  specialBoxEventsSave: (events: SpecialBoxEvent[]) => Promise<{ ok: boolean; events: SpecialBoxEvent[] }>
  specialBoxEventTest: (id: string) => Promise<{ ok: boolean; error?: string; opened?: string[] }>
  specialBoxDraw: (param: string) => Promise<{ ok: boolean; error?: string; opened?: string[] }>
  specialCloseAll: () => Promise<{ ok: boolean; closed: number }>
  onSpecialChanged: (cb: () => void) => () => void
  entranceOpen: () => Promise<{ ok: boolean; error?: string }>
  entranceClose: () => Promise<{ ok: boolean }>
  entranceConfigure: (cfg: Partial<EntranceConfig>) => Promise<{ ok: boolean }>
  entranceState: () => Promise<EntranceState>
  entranceTest: (name: string, avatar?: string) => Promise<{ ok: boolean; error?: string }>
  onEntranceChanged: (cb: (state: EntranceState) => void) => () => void
  /** 已出现的观众（本机记录，不是抖音粉丝列表）：大哥进场下拉用 */
  viewerList: (limit?: number) => Promise<ViewerListResult>
  /** 渲染层刷新授权快照的周期（毫秒），默认 60 秒；回归用环境变量 ZL_CARD_POLL_MS 缩短 */
  cardPollMs: number
  /** Twemoji 图集位置与文件名索引：渲染层把昵称 / 礼物名里的 emoji 贴成图（与挂件页面同一套） */
  emojiAssets: () => Promise<{ dir: string; keys: string[] }>
  queueOpen: (cfg?: Partial<QueueWidgetConfig>) => Promise<{ ok: boolean; error?: string }>
  queueClose: () => Promise<{ ok: boolean }>
  queueConfigure: (cfg: Partial<QueueWidgetConfig>) => Promise<{ ok: boolean }>
  queueState: () => Promise<QueueWidgetState>
  queueClear: () => Promise<{ ok: boolean; cleared: number }>
  queueSkip: (count?: number) => Promise<{ ok: boolean; skipped: number }>
  onQueueChanged: (cb: (snapshot: ExecQueueSnapshot) => void) => () => void
  wishOpen: () => Promise<{ ok: boolean; error?: string }>
  wishClose: () => Promise<{ ok: boolean }>
  wishConfigure: (cfg: Partial<WishConfig>) => Promise<{ ok: boolean }>
  wishReset: (group?: 0 | 1, gift?: string) => Promise<{ ok: boolean }>
  wishState: () => Promise<WishWidgetState>
  onWishChanged: (cb: (state: WishWidgetState) => void) => () => void
  progressOpen: () => Promise<{ ok: boolean; error?: string }>
  progressClose: () => Promise<{ ok: boolean }>
  progressConfigure: (cfg: Partial<ProgressConfig>) => Promise<{ ok: boolean }>
  progressAdjust: (delta: number) => Promise<{ ok: boolean; score: number }>
  progressReset: () => Promise<{ ok: boolean }>
  progressState: () => Promise<ProgressState>
  onProgressChanged: (cb: (state: ProgressState) => void) => () => void
  keyboardOpen: (cfg?: Partial<KeyboardWidgetConfig>) => Promise<{ ok: boolean; error?: string }>
  keyboardClose: () => Promise<{ ok: boolean }>
  keyboardConfigure: (cfg: Partial<KeyboardWidgetConfig>) => Promise<{ ok: boolean }>
  keyboardState: () => Promise<KeyboardWidgetState>
  obsState: () => Promise<ObsPanelState>
  obsConnect: (cfg?: Partial<ObsSettings>) => Promise<{ ok: boolean; error?: string; version?: string }>
  obsDisconnect: () => Promise<{ ok: boolean }>
  obsConfigure: (cfg: Partial<ObsSettings>) => Promise<{ ok: boolean }>
  obsRefresh: () => Promise<{ ok: boolean; error?: string }>
  obsSetFilter: (source: string, filter: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  obsSetScene: (scene: string) => Promise<{ ok: boolean; error?: string }>
  obsLaunch: () => Promise<{ ok: boolean; error?: string }>
  obsEnableServer: (password: string) => Promise<{ ok: boolean; error?: string }>
  liveCompanionSetDirectory: (dir: string) => Promise<{ ok: boolean; error?: string }>
  liveCompanionState: (refresh?: boolean) => Promise<LiveCompanionStatus>
  liveCompanionLaunch: () => Promise<{ ok: boolean; error?: string; pid?: number }>
  onObsChanged: (cb: (state: ObsPanelState) => void) => () => void
  protectWidgetOpen: (startedAt?: number) => Promise<{ ok: boolean; error?: string }>
  protectWidgetClose: () => Promise<{ ok: boolean }>
  entertainmentRulesPause: (paused: boolean) => Promise<{ ok: boolean; paused: boolean }>
  entertainmentProtectState: () => Promise<{ paused: boolean; protectOpen: boolean; startedAt: number }>
  relaunchElevated: () => Promise<{ ok: boolean; error?: string }>
  selfCheck: () => Promise<SelfCheckResult>
  reportError: (payload: { message?: string; stack?: string; component?: string; route?: string }) => Promise<{ ok: boolean; file: string }>
  openLogs: () => Promise<{ ok: boolean; path: string }>
  /** 礼物记录：谁送了什么（limit=最近多少条明细，默认 100） */
  giftLogState: (limit?: number) => Promise<GiftLogState>
  giftLogClear: () => Promise<{ ok: boolean; cleared: number }>
  onGiftLogChanged: (cb: (state: GiftLogState) => void) => () => void
  stickerState: () => Promise<StickerState>
  stickerReset: () => Promise<{ ok: boolean }>
  stickerImport: (stats: Record<string, number>) => Promise<{ ok: boolean; imported: number }>
  onStickerChanged: (cb: (state: StickerState) => void) => () => void

  /** 卡密平台授权：enabled=false 表示本机没配卡密平台（走原有账号系统） */
  cardState: () => Promise<CardSnapshot>
  /** 兑换卡密到当前登录的平台账号；返回兑换后的快照 */
  cardRedeem: (code: string) => Promise<CardSnapshot>
  /** 用系统浏览器打开本机卡密平台页面 */
  cardOpenPlatform: () => Promise<{ ok: boolean; error?: string }>
  /** 主进程门禁拦下一个需要卡密的动作时通知（product 是平台产品 id，如 platform:assistant / game:librarian） */
  onCardLicenseRequired: (cb: (product: string) => void) => () => void
  /** 卡密模式：向平台读当前账号的直播间名额（capacity / changes_left / rooms…），并同步本机绑定列表 */
  cardRooms: () => Promise<CardRoomsResult>
  /**
   * 卡密模式：绑定 / 改绑前的扫码核实。不带 proof 会打开独立浏览器扫码；room 留空则回 needRoom=true + proof，
   * 之后 cardRoomVerify(room, proof) 复用同一次扫码。登录态只留在主进程，不会回到页面。
   */
  cardRoomVerify: (room?: string, proof?: string) => Promise<CardRoomVerifyResult>
  /** 卡密模式：用 verify 拿到的 proof 提交绑定 / 改绑；名额与改绑次数由平台事务扣减 */
  cardRoomCommit: (input: CardRoomCommitInput) => Promise<CardRoomCommitResult>
  /** 本机只有旧版本地账号（cardState.legacyHold）时：把随安装包的默认平台配置写成本机显式配置，重启后进入新账号系统 */
  cardAdoptDefault: () => Promise<{ ok: boolean; error?: string; restart?: boolean }>
}

const api: ZLAPI = {
  register: (u, p, n) => ipcRenderer.invoke(Ipc.AuthRegister, u, p, n),
  login: (u, p) => ipcRenderer.invoke(Ipc.AuthLogin, u, p),
  logout: () => ipcRenderer.invoke(Ipc.AuthLogout),
  session: () => ipcRenderer.invoke(Ipc.AuthSession),
  bindRoom: (roomId) => ipcRenderer.invoke(Ipc.AuthBindRoom, roomId),
  unbindRoom: (roomId) => ipcRenderer.invoke(Ipc.AuthUnbindRoom, roomId),
  deleteAccount: (id) => ipcRenderer.invoke(Ipc.AuthDeleteAccount, id),
  listAccounts: () => ipcRenderer.invoke(Ipc.AuthListAccounts),
  credLoad: () => ipcRenderer.invoke(Ipc.CredLoad),
  credUser: (username) => ipcRenderer.invoke(Ipc.CredUser, username),
  credSave: (username, password) =>
    ipcRenderer.invoke(Ipc.CredSave, username, password),
  credClearLast: () => ipcRenderer.invoke(Ipc.CredClearLast),
  credClearUser: (username) => ipcRenderer.invoke(Ipc.CredClearUser, username),
  updateAvatar: (avatar) => ipcRenderer.invoke(Ipc.AuthUpdateAvatar, avatar),
  bindRoomWithLicense: (roomId) =>
    ipcRenderer.invoke(Ipc.RoomBindWithLicense, roomId),
  roomLookup: (roomId, interactive) => ipcRenderer.invoke(Ipc.RoomLookup, roomId, interactive),
  submitRoomApply: (roomId) => ipcRenderer.invoke(Ipc.RoomSubmitApply, roomId),
  cancelRoomApply: () => ipcRenderer.invoke(Ipc.RoomCancelApply),
  onRoomAutoBound: (cb) => {
    const listener = (_e: IpcRendererEvent, p: RoomAutoBoundPayload) => cb(p)
    ipcRenderer.on(Ipc.RoomAutoBound, listener)
    return () => ipcRenderer.removeListener(Ipc.RoomAutoBound, listener)
  },
  reportRoomUnbind: (room) =>
    ipcRenderer.invoke(Ipc.RoomUnbindReport, room),
  syncEmailRooms: () => ipcRenderer.invoke(Ipc.RoomSyncEmail),
  onRoomsSynced: (cb: (payload: RoomsSyncedPayload) => void) => {
    const listener = (_e: IpcRendererEvent, p: RoomsSyncedPayload) => cb(p)
    ipcRenderer.on(Ipc.RoomsSynced, listener)
    return () => ipcRenderer.removeListener(Ipc.RoomsSynced, listener)
  },

  emailSendCode: (email) => ipcRenderer.invoke(Ipc.EmailSendCode, email),
  emailRegister: (email, code, password, nickname) =>
    ipcRenderer.invoke(Ipc.EmailRegister, email, code, password, nickname),
  emailLogin: (email, password) =>
    ipcRenderer.invoke(Ipc.EmailLogin, email, password),
  emailReset: (email, code, password) =>
    ipcRenderer.invoke(Ipc.EmailReset, email, code, password),
  emailGetLicense: (email) => ipcRenderer.invoke(Ipc.EmailGetLicense, email),
  memoryGuardProbe: (availableMb) => ipcRenderer.invoke(Ipc.MemoryGuardProbe, availableMb),
  mediaOptimizeState: () => ipcRenderer.invoke(Ipc.MediaOptimizeState),
  emailGameApply: (email, game) =>
    ipcRenderer.invoke(Ipc.EmailGameApply, email, game),
  emailNotifyList: (email) => ipcRenderer.invoke(Ipc.EmailNotifyList, email),
  emailNotifyRead: (email, id) =>
    ipcRenderer.invoke(Ipc.EmailNotifyRead, email, id),
  emailNotifyReadAll: (email) =>
    ipcRenderer.invoke(Ipc.EmailNotifyReadAll, email),
  emailConfigSave: (email, data) =>
    ipcRenderer.invoke(Ipc.EmailConfigSave, email, data),
  emailConfigLoad: (email) => ipcRenderer.invoke(Ipc.EmailConfigLoad, email),
  emailBuyContact: () => ipcRenderer.invoke(Ipc.EmailBuyContact),
  onNotifyNew: (cb) => {
    const listener = (_e: IpcRendererEvent, n: AppNotification) => cb(n)
    ipcRenderer.on(Ipc.NotifyNew, listener)
    return () => ipcRenderer.removeListener(Ipc.NotifyNew, listener)
  },

  liveStats: () => ipcRenderer.invoke(Ipc.LiveStats),
  statsPrankTick: () => ipcRenderer.invoke(Ipc.StatsPrankTick),

  listMods: () => ipcRenderer.invoke(Ipc.ModsList),
  installMod: (id) => ipcRenderer.invoke(Ipc.ModsInstall, id),
  uninstallMod: (id) => ipcRenderer.invoke(Ipc.ModsUninstall, id),
  modHealth: (gameId) => ipcRenderer.invoke(Ipc.ModsHealth, gameId),
  modRepair: (gameId) => ipcRenderer.invoke(Ipc.ModsRepair, gameId),
  modDiagnose: (gameId) => ipcRenderer.invoke(Ipc.ModsDiagnose, gameId),
  modDiagnoseUpload: (gameId) => ipcRenderer.invoke(Ipc.ModsDiagnoseUpload, gameId),
  appVersion: () => ipcRenderer.invoke(Ipc.AppVersion),
  pinyouProjects: (root) => ipcRenderer.invoke(Ipc.PinyouProjects, root),
  pinyouAssetRootPick: () => ipcRenderer.invoke(Ipc.PinyouAssetRootPick),
  pinyouProjectTest: (dir, slot) => ipcRenderer.invoke(Ipc.PinyouProjectTest, dir, slot),
  pinyouItemActionsGet: (dir) => ipcRenderer.invoke(Ipc.PinyouItemActionsGet, dir),
  pinyouItemActionsSet: (dir, name, config) => ipcRenderer.invoke(Ipc.PinyouItemActionsSet, dir, name, config),
  pinyouProjectsImport: (dirs, slot) => ipcRenderer.invoke(Ipc.PinyouProjectsImport, dirs, slot),
  pinyouItemsImport: (dirs, slot) => ipcRenderer.invoke(Ipc.PinyouItemsImport, dirs, slot),
  pinyouTimeImport: (dirs) => ipcRenderer.invoke(Ipc.PinyouTimeImport, dirs),
  pinyouRelocateRules: (rules) => ipcRenderer.invoke(Ipc.PinyouRelocateRules, rules),
  projectExport: (project, rules, destRoot) => ipcRenderer.invoke(Ipc.ProjectExport, project, rules, destRoot),
  projectImportFolder: (dir) => ipcRenderer.invoke(Ipc.ProjectImportFolder, dir),
  projectCreate: (name, files) => ipcRenderer.invoke(Ipc.ProjectCreate, name, files),
  mediaList: (dir) => ipcRenderer.invoke(Ipc.MediaList, dir),
  mediaFolderPick: () => ipcRenderer.invoke(Ipc.MediaFolderPick),
  onModInstallProgress: (cb) => {
    const handler = (_e: unknown, p: ModInstallProgress) => cb(p)
    ipcRenderer.on(Ipc.ModsInstallProgress, handler)
    return () => ipcRenderer.removeListener(Ipc.ModsInstallProgress, handler)
  },

  readConfig: () => ipcRenderer.invoke(Ipc.ConfigRead),
  saveConfig: (values) => ipcRenderer.invoke(Ipc.ConfigSave, values),
  readPranks: () => ipcRenderer.invoke(Ipc.ConfigPranks),
  prankCatalog: () => ipcRenderer.invoke(Ipc.PrankCatalog),
  onPrankCatalogChanged: (cb) => {
    const handler = () => cb()
    ipcRenderer.on(Ipc.PrankCatalogChanged, handler)
    return () => ipcRenderer.removeListener(Ipc.PrankCatalogChanged, handler)
  },

  launchGame: () => ipcRenderer.invoke(Ipc.GameLaunch),
  gameState: () => ipcRenderer.invoke(Ipc.GameState),
  detectGamePath: () => ipcRenderer.invoke(Ipc.GameDetectPath),
  detectAllGames: () => ipcRenderer.invoke(Ipc.GameDetectAll),
  setGamePath: (gameId: string, path: string) => ipcRenderer.invoke(Ipc.GameSetPath, gameId, path),
  gamesList: () => ipcRenderer.invoke(Ipc.GamesList),
  setGameCurrent: (id: string) => ipcRenderer.invoke(Ipc.GameSetCurrent, id),

  liveSet: (key, value) => ipcRenderer.invoke(Ipc.LiveSet, key, value),
  livePrank: (id) => ipcRenderer.invoke(Ipc.LivePrank, id),
  liveCmd: (cmd) => ipcRenderer.invoke(Ipc.LiveCmd, cmd),
  liveState: () => ipcRenderer.invoke(Ipc.LiveState),
  giftImagesSync: (roomId) => ipcRenderer.invoke(Ipc.GiftImagesSync, roomId ?? ''),

  connectorStart: (room, sim, platform) =>
    ipcRenderer.invoke(Ipc.ConnectorStart, room, sim, platform),
  connectorStop: () => ipcRenderer.invoke(Ipc.ConnectorStop),
  connectorState: () => ipcRenderer.invoke(Ipc.ConnectorState),
  connectorSend: (cmd) => ipcRenderer.invoke(Ipc.ConnectorSend, cmd),
  connectorSimulate: (text) => ipcRenderer.invoke(Ipc.ConnectorSimulate, text),
  connectorLog: () => ipcRenderer.invoke(Ipc.ConnectorLog),
  onConnectorLog: (cb) => {
    const listener = (_e: IpcRendererEvent, line: ConnectorLogLine) => cb(line)
    ipcRenderer.on(Ipc.ConnectorLog, listener)
    return () => ipcRenderer.removeListener(Ipc.ConnectorLog, listener)
  },
  onConnectorEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: ConnectorEvent) => cb(event)
    ipcRenderer.on(Ipc.ConnectorEvent, listener)
    return () => ipcRenderer.removeListener(Ipc.ConnectorEvent, listener)
  },
  onEntertainmentSound: (cb) => {
    const listener = (_e: IpcRendererEvent, event: EntertainmentSoundEvent) => cb(event)
    ipcRenderer.on(Ipc.EntertainmentSound, listener)
    return () => ipcRenderer.removeListener(Ipc.EntertainmentSound, listener)
  },

  getSettings: () => ipcRenderer.invoke(Ipc.SettingsGet),
  saveSettings: (patch) => ipcRenderer.invoke(Ipc.SettingsSet, patch),
  listNews: () => ipcRenderer.invoke(Ipc.NewsList),

  checkForUpdates: (silent?: boolean) => ipcRenderer.invoke(Ipc.UpdateCheck, silent),
  onUpdateStatus: (cb) => {
    const listener = (_e: IpcRendererEvent, p: UpdateStatusPayload) => cb(p)
    ipcRenderer.on(Ipc.UpdateStatus, listener)
    return () => ipcRenderer.removeListener(Ipc.UpdateStatus, listener)
  },
  downloadUpdate: () => ipcRenderer.invoke(Ipc.UpdateDownload),
  updateInstall: () => ipcRenderer.invoke(Ipc.UpdateInstall),

  selectFile: (options) => ipcRenderer.invoke(Ipc.DialogSelect, options),

  windowMinimize: () => ipcRenderer.send(Ipc.WindowMinimize),
  windowMaximizeToggle: () => ipcRenderer.send(Ipc.WindowMaximizeToggle),
  windowClose: () => ipcRenderer.send(Ipc.WindowClose),
  windowSetAlwaysOnTop: (flag) =>
    ipcRenderer.invoke(Ipc.WindowSetAlwaysOnTop, flag),
  windowResize: (w: number, h: number, minW: number, minH: number) =>
    ipcRenderer.send(Ipc.WindowResize, w, h, minW, minH),
  onMaximizedChange: (cb: (maximized: boolean) => void) => {
    const listener = (_e: IpcRendererEvent, v: boolean) => cb(v)
    ipcRenderer.on(Ipc.WindowMaximized, listener)
    return () => ipcRenderer.removeListener(Ipc.WindowMaximized, listener)
  },

  entertainmentRulesList: () => ipcRenderer.invoke(Ipc.EntertainmentRulesList),
  entertainmentRuleAdd: (rule) =>
    ipcRenderer.invoke(Ipc.EntertainmentRuleAdd, rule),
  entertainmentRuleUpdate: (rule) =>
    ipcRenderer.invoke(Ipc.EntertainmentRuleUpdate, rule),
  entertainmentRuleRemove: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentRuleRemove, id),
  entertainmentGroupToggle: (group, on) =>
    ipcRenderer.invoke(Ipc.EntertainmentGroupToggle, group, on),
  entertainmentPresetList: () => ipcRenderer.invoke(Ipc.EntertainmentPresetList),
  entertainmentPresetSave: (preset) =>
    ipcRenderer.invoke(Ipc.EntertainmentPresetSave, preset),
  entertainmentPresetRemove: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentPresetRemove, id),
  entertainmentPresetApply: (id) =>
    ipcRenderer.invoke(Ipc.EntertainmentPresetApply, id),
  entertainmentSendKeys: (keySeq) =>
    ipcRenderer.invoke(Ipc.EntertainmentSendKeys, keySeq),
  entertainmentSystemAction: (cmd, param) =>
    ipcRenderer.invoke(Ipc.EntertainmentSystemAction, cmd, param),
  entertainmentListGiftImages: () =>
    ipcRenderer.invoke(Ipc.EntertainmentListGiftImages),
  entertainmentListImageFiles: (dir) =>
    ipcRenderer.invoke(Ipc.EntertainmentListImageFiles, dir),
  entertainmentTransparentImport: (filePath) =>
    ipcRenderer.invoke(Ipc.EntertainmentTransparentImport, filePath),
  entertainmentTransparentExport: (payload) =>
    ipcRenderer.invoke(Ipc.EntertainmentTransparentExport, payload),
  entertainmentPinyouImport: () => ipcRenderer.invoke(Ipc.EntertainmentPinyouImport),
  entertainmentPinyouApply: (rules, replace) => ipcRenderer.invoke(Ipc.EntertainmentPinyouApply, rules, replace),
  entertainmentRunScript: (path) =>
    ipcRenderer.invoke(Ipc.EntertainmentRunScript, path),
  entertainmentSavePng: (dataUrl, defaultName, targetDir) =>
    ipcRenderer.invoke(Ipc.EntertainmentSavePng, dataUrl, defaultName, targetDir),
  entertainmentCopyImage: (dataUrl) =>
    ipcRenderer.invoke(Ipc.EntertainmentCopyImage, dataUrl),
  timeWidgetLog: () => ipcRenderer.invoke(Ipc.TimeWidgetLog),
  timeWidgetLogClear: () => ipcRenderer.invoke(Ipc.TimeWidgetLogClear),
  timeWidgetTestGift: (name) => ipcRenderer.invoke(Ipc.TimeWidgetTestGift, name),
  timeWidgetTestEvent: (id) => ipcRenderer.invoke(Ipc.TimeWidgetTestEvent, id),
  timeWidgetCancelQueue: () => ipcRenderer.invoke(Ipc.TimeWidgetCancelQueue),
  entertainmentMouse: (action, x, y) =>
    ipcRenderer.invoke(Ipc.EntertainmentMouse, action, x, y),
  entertainmentSendText: (text, mode, enterAfter) =>
    ipcRenderer.invoke(Ipc.EntertainmentSendText, text, mode, enterAfter),
  entertainmentCommand: (cmd, param) =>
    ipcRenderer.invoke(Ipc.EntertainmentCommand, cmd, param),
  danmakuForwardStart: (port) => ipcRenderer.invoke(Ipc.DanmakuForwardStart, port),
  danmakuForwardStop: () => ipcRenderer.invoke(Ipc.DanmakuForwardStop),
  danmakuForwardState: () => ipcRenderer.invoke(Ipc.DanmakuForwardState),
  danmakuForwardPublish: (event) => ipcRenderer.invoke(Ipc.DanmakuForwardPublish, event),
  greenScreenOpen: (src, type, text, slot, options) =>
    ipcRenderer.invoke(Ipc.GreenScreenOpen, src, type, text, slot, options),
  greenScreenClose: (slot) => ipcRenderer.invoke(Ipc.GreenScreenClose, slot),
  greenScreenState: () => ipcRenderer.invoke(Ipc.GreenScreenState),
  greenScreenResize: (slot, width, height) => ipcRenderer.invoke(Ipc.GreenScreenResize, slot, width, height),
  outputWindowResize: (title, width, height) => ipcRenderer.invoke(Ipc.OutputWindowResize, title, width, height),
  outputWindowSize: (title) => ipcRenderer.invoke(Ipc.OutputWindowSize, title),
  timeWidgetOpen: (cfg) => ipcRenderer.invoke(Ipc.TimeWidgetOpen, cfg),
  timeWidgetClose: () => ipcRenderer.invoke(Ipc.TimeWidgetClose),
  timeWidgetState: () => ipcRenderer.invoke(Ipc.TimeWidgetState),
  timeWidgetUpdate: (cfg) => ipcRenderer.invoke(Ipc.TimeWidgetUpdate, cfg),
  timeWidgetAdjust: (delta) => ipcRenderer.invoke(Ipc.TimeWidgetAdjust, delta),
  timeWidgetClear: () => ipcRenderer.invoke(Ipc.TimeWidgetClear),
  timeWidgetPause: (ms) => ipcRenderer.invoke(Ipc.TimeWidgetPause, ms),
  timeWidgetShowGift: (name, imgSrc) =>
    ipcRenderer.invoke(Ipc.TimeWidgetShowGift, name, imgSrc),
  timeLogOpen: () => ipcRenderer.invoke(Ipc.TimeLogOpen),
  timeLogClose: () => ipcRenderer.invoke(Ipc.TimeLogClose),
  timeLogState: () => ipcRenderer.invoke(Ipc.TimeLogState),
  marqueeOpen: (config) => ipcRenderer.invoke(Ipc.MarqueeOpen, config),
  marqueeConfigure: (config) => ipcRenderer.invoke(Ipc.MarqueeConfigure, config),
  marqueeClose: () => ipcRenderer.invoke(Ipc.MarqueeClose),
  marqueeState: () => ipcRenderer.invoke(Ipc.MarqueeState),
  marqueeSend: (text, imgSrc) =>
    ipcRenderer.invoke(Ipc.MarqueeSend, text, imgSrc),
  challengeOpen: (cfg) => ipcRenderer.invoke(Ipc.ChallengeOpen, cfg),
  challengeUpdate: (cfg) => ipcRenderer.invoke(Ipc.ChallengeUpdate, cfg),
  challengeClose: (slot) => ipcRenderer.invoke(Ipc.ChallengeClose, slot),
  challengeState: (slot) => ipcRenderer.invoke(Ipc.ChallengeState, slot),
  challengeAdjust: (delta) => ipcRenderer.invoke(Ipc.ChallengeAdjust, delta),
  challengeApplyGift: (op, before, after, showRecord) => ipcRenderer.invoke(Ipc.ChallengeApplyGift, op, before, after, showRecord),
  challengePause: (ms) => ipcRenderer.invoke(Ipc.ChallengePause, ms),
  openPath: (p) => ipcRenderer.invoke(Ipc.OpenPath, p),
  listFontFiles: (dir) => ipcRenderer.invoke(Ipc.ListFontFiles, dir),
  videoWidgetOpen: (cfg) => ipcRenderer.invoke(Ipc.VideoWidgetOpen, cfg),
  videoWidgetClose: (slot) => ipcRenderer.invoke(Ipc.VideoWidgetClose, slot),
  videoWidgetState: () => ipcRenderer.invoke(Ipc.VideoWidgetState),
  lotteryOpen: (kind, items, centerImg) => ipcRenderer.invoke(Ipc.LotteryOpen, kind, items, centerImg),
  lotteryConfigure: (kind, trigger, items, centerImg) => ipcRenderer.invoke(Ipc.LotteryConfigure, kind, trigger, items, centerImg),
  lotteryClose: (kind) => ipcRenderer.invoke(Ipc.LotteryClose, kind),
  lotterySpin: (kind) => ipcRenderer.invoke(Ipc.LotterySpin, kind),
  lotteryState: () => ipcRenderer.invoke(Ipc.LotteryState),
  lotteryHistory: (limit) => ipcRenderer.invoke(Ipc.LotteryHistory, limit),
  lotteryHistoryClear: () => ipcRenderer.invoke(Ipc.LotteryHistoryClear),
  onLotteryEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: LotteryEvent) => cb(event)
    ipcRenderer.on(Ipc.LotteryEvent, listener)
    return () => ipcRenderer.removeListener(Ipc.LotteryEvent, listener)
  },
  advancedWheelOpen: (config) => ipcRenderer.invoke(Ipc.AdvancedWheelOpen, config),
  advancedWheelClose: (source) => ipcRenderer.invoke(Ipc.AdvancedWheelClose, source),
  advancedWheelSpin: (source) => ipcRenderer.invoke(Ipc.AdvancedWheelSpin, source),
  advancedWheelUpdate: (config) => ipcRenderer.invoke(Ipc.AdvancedWheelUpdate, config),
  advancedWheelState: () => ipcRenderer.invoke(Ipc.AdvancedWheelState),
  advancedWheelImport: (source) => ipcRenderer.invoke(Ipc.AdvancedWheelImport, source),
  advancedWheelExport: (config) => ipcRenderer.invoke(Ipc.AdvancedWheelExport, config),
  progressOpen: () => ipcRenderer.invoke(Ipc.ProgressOpen),
  progressClose: () => ipcRenderer.invoke(Ipc.ProgressClose),
  progressConfigure: (cfg) => ipcRenderer.invoke(Ipc.ProgressConfigure, cfg),
  progressAdjust: (delta) => ipcRenderer.invoke(Ipc.ProgressAdjust, delta),
  progressReset: () => ipcRenderer.invoke(Ipc.ProgressReset),
  progressState: () => ipcRenderer.invoke(Ipc.ProgressState),
  onProgressChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, state: ProgressState) => cb(state)
    ipcRenderer.on(Ipc.ProgressChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.ProgressChanged, listener)
  },
  keyboardOpen: (cfg) => ipcRenderer.invoke(Ipc.KeyboardOpen, cfg),
  keyboardClose: () => ipcRenderer.invoke(Ipc.KeyboardClose),
  keyboardConfigure: (cfg) => ipcRenderer.invoke(Ipc.KeyboardConfigure, cfg),
  keyboardState: () => ipcRenderer.invoke(Ipc.KeyboardState),
  obsState: () => ipcRenderer.invoke(Ipc.ObsState),
  obsConnect: (cfg) => ipcRenderer.invoke(Ipc.ObsConnect, cfg),
  obsDisconnect: () => ipcRenderer.invoke(Ipc.ObsDisconnect),
  obsConfigure: (cfg) => ipcRenderer.invoke(Ipc.ObsConfigure, cfg),
  obsRefresh: () => ipcRenderer.invoke(Ipc.ObsRefresh),
  obsSetFilter: (source, filter, enabled) => ipcRenderer.invoke(Ipc.ObsSetFilter, source, filter, enabled),
  obsSetScene: (scene) => ipcRenderer.invoke(Ipc.ObsSetScene, scene),
  obsLaunch: () => ipcRenderer.invoke(Ipc.ObsLaunch),
  obsEnableServer: (password) => ipcRenderer.invoke(Ipc.ObsEnableServer, password),
  liveCompanionSetDirectory: (dir) => ipcRenderer.invoke(Ipc.LiveCompanionDirectory, dir),
  liveCompanionState: (refresh) => ipcRenderer.invoke(Ipc.LiveCompanionState, !!refresh),
  liveCompanionLaunch: () => ipcRenderer.invoke(Ipc.LiveCompanionLaunch),
  onObsChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, state: ObsPanelState) => cb(state)
    ipcRenderer.on(Ipc.ObsChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.ObsChanged, listener)
  },
  protectWidgetOpen: (startedAt) => ipcRenderer.invoke(Ipc.ProtectWidgetOpen, startedAt),
  protectWidgetClose: () => ipcRenderer.invoke(Ipc.ProtectWidgetClose),
  entertainmentRulesPause: (paused) => ipcRenderer.invoke(Ipc.EntertainmentRulesPause, paused),
  entertainmentProtectState: () => ipcRenderer.invoke(Ipc.EntertainmentProtectState),
  relaunchElevated: () => ipcRenderer.invoke(Ipc.AppRelaunchElevated),
  selfCheck: () => ipcRenderer.invoke(Ipc.AppSelfCheck),
  reportError: (payload) => ipcRenderer.invoke(Ipc.AppReportError, payload),
  openLogs: () => ipcRenderer.invoke(Ipc.AppOpenLogs),
  giftLogState: (limit) => ipcRenderer.invoke(Ipc.GiftLogState, limit),
  giftLogClear: () => ipcRenderer.invoke(Ipc.GiftLogClear),
  onGiftLogChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, state: GiftLogState) => cb(state)
    ipcRenderer.on(Ipc.GiftLogChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.GiftLogChanged, listener)
  },
  stickerState: () => ipcRenderer.invoke(Ipc.StickerState),
  stickerReset: () => ipcRenderer.invoke(Ipc.StickerReset),
  stickerImport: (stats) => ipcRenderer.invoke(Ipc.StickerImport, stats),
  onStickerChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, state: StickerState) => cb(state)
    ipcRenderer.on(Ipc.StickerChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.StickerChanged, listener)
  },
  effectsOpen: (cfg) => ipcRenderer.invoke(Ipc.EffectsOpen, cfg),
  effectsConfigure: (cfg) => ipcRenderer.invoke(Ipc.EffectsConfigure, cfg),
  effectsClose: () => ipcRenderer.invoke(Ipc.EffectsClose),
  effectsFire: (kind, name, count, sender) => ipcRenderer.invoke(Ipc.EffectsFire, kind, name, count, sender),
  effectsState: () => ipcRenderer.invoke(Ipc.EffectsState),
  specialWindowOpen: () => ipcRenderer.invoke(Ipc.SpecialWindowOpen),
  specialWindowClose: () => ipcRenderer.invoke(Ipc.SpecialWindowClose),
  specialWindowConfigure: (cfg) => ipcRenderer.invoke(Ipc.SpecialWindowConfigure, cfg),
  specialConfigure: (id, cfg) => ipcRenderer.invoke(Ipc.SpecialConfigure, id, cfg),
  specialState: () => ipcRenderer.invoke(Ipc.SpecialState),
  specialTest: (id, action) => ipcRenderer.invoke(Ipc.SpecialTest, id, action),
  specialStats: (id) => ipcRenderer.invoke(Ipc.SpecialStats, id),
  specialClearAll: () => ipcRenderer.invoke(Ipc.SpecialClearAll),
  specialBoxEvents: () => ipcRenderer.invoke(Ipc.SpecialBoxEvents),
  specialBoxEventsSave: (events) => ipcRenderer.invoke(Ipc.SpecialBoxEventsSave, events),
  specialBoxEventTest: (id) => ipcRenderer.invoke(Ipc.SpecialBoxEventTest, id),
  specialBoxDraw: (param) => ipcRenderer.invoke(Ipc.SpecialBoxDraw, param),
  specialCloseAll: () => ipcRenderer.invoke(Ipc.SpecialCloseAll),
  onSpecialChanged: (cb) => {
    const fn = () => cb()
    ipcRenderer.on(Ipc.SpecialChanged, fn)
    return () => ipcRenderer.removeListener(Ipc.SpecialChanged, fn)
  },
  entranceOpen: () => ipcRenderer.invoke(Ipc.EntranceOpen),
  entranceClose: () => ipcRenderer.invoke(Ipc.EntranceClose),
  entranceConfigure: (cfg) => ipcRenderer.invoke(Ipc.EntranceConfigure, cfg),
  entranceState: () => ipcRenderer.invoke(Ipc.EntranceState),
  entranceTest: (name, avatar) => ipcRenderer.invoke(Ipc.EntranceTest, name, avatar ?? ''),
  viewerList: (limit) => ipcRenderer.invoke(Ipc.ViewerList, limit ?? 1000),
  cardPollMs: Math.max(1000, Number(process.env.ZL_CARD_POLL_MS) || 60_000),
  emojiAssets: () => ipcRenderer.invoke(Ipc.EmojiAssets),
  onEntranceChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, state: EntranceState) => cb(state)
    ipcRenderer.on(Ipc.EntranceChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.EntranceChanged, listener)
  },
  queueOpen: (cfg) => ipcRenderer.invoke(Ipc.QueueOpen, cfg),
  queueClose: () => ipcRenderer.invoke(Ipc.QueueClose),
  queueConfigure: (cfg) => ipcRenderer.invoke(Ipc.QueueConfigure, cfg),
  queueState: () => ipcRenderer.invoke(Ipc.QueueState),
  queueClear: () => ipcRenderer.invoke(Ipc.QueueClear),
  queueSkip: (count) => ipcRenderer.invoke(Ipc.QueueSkip, count),
  onQueueChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, snapshot: ExecQueueSnapshot) => cb(snapshot)
    ipcRenderer.on(Ipc.QueueChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.QueueChanged, listener)
  },
  wishOpen: () => ipcRenderer.invoke(Ipc.WishOpen),
  wishClose: () => ipcRenderer.invoke(Ipc.WishClose),
  wishConfigure: (cfg) => ipcRenderer.invoke(Ipc.WishConfigure, cfg),
  wishReset: (group, gift) => ipcRenderer.invoke(Ipc.WishReset, group, gift),
  wishState: () => ipcRenderer.invoke(Ipc.WishState),
  onWishChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, state: WishWidgetState) => cb(state)
    ipcRenderer.on(Ipc.WishChanged, listener)
    return () => ipcRenderer.removeListener(Ipc.WishChanged, listener)
  },
  cardState: () => ipcRenderer.invoke(Ipc.CardState),
  cardRedeem: (code) => ipcRenderer.invoke(Ipc.CardRedeem, code),
  cardOpenPlatform: () => ipcRenderer.invoke(Ipc.CardOpenPlatform),
  onCardLicenseRequired: (cb) => {
    const listener = (_e: IpcRendererEvent, product: string) => cb(String(product ?? ''))
    ipcRenderer.on(Ipc.CardLicenseRequired, listener)
    return () => ipcRenderer.removeListener(Ipc.CardLicenseRequired, listener)
  },
  cardRooms: () => ipcRenderer.invoke(Ipc.CardRooms),
  cardRoomVerify: (room, proof) => ipcRenderer.invoke(Ipc.CardRoomVerify, room, proof),
  cardRoomCommit: (input) => ipcRenderer.invoke(Ipc.CardRoomCommit, input),
  cardAdoptDefault: () => ipcRenderer.invoke(Ipc.CardAdoptDefault)
}

contextBridge.exposeInMainWorld('api', api)
