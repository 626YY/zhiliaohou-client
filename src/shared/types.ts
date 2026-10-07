import type { EntranceEffectId } from './entranceEffects'
import type { WidgetSkinId } from './widgetSkins'
// ============ 账号 ============

export interface User {
  /** 邮箱账号的服务器会话凭证（随账号本地保存，重启后仍可用） */
  emailSession?: string
  id: string
  username: string
  passwordHash: string
  nickname: string
  avatar: string
  createdAt: number
  lastLoginAt: number
  boundRooms?: string[]
  // 本地解绑墓碑：邮箱授权同步时跳过这些房，防止「解绑上报失败」后下次同步把房复活
  unboundRooms?: string[]
  // 每个房的本地绑定时间：同步时与后台解绑/换绑动作时间对比，决定「补报」还是「跟后台解绑」
  roomBindAt?: Record<string, number>
  // 邮箱账号（服务器验证）的用户名就是邮箱，此标记用于区分邮箱/普通账号
  email?: string
  // 是否已绑定过直播间：首次绑定直接绑，解绑后再绑需申请（持久标记，防清空列表重拿首绑）
  everBound?: boolean
}

export interface SessionUser {
  id: string
  username: string
  nickname: string
  avatar: string
  createdAt: number
  boundRooms: string[]
  email?: string
}

export interface AuthResult {
  ok: boolean
  user?: SessionUser
  error?: string
  /** 登录成功后要告诉主播的一句话（如：服务器暂时连不上，已直接进入，功能照常用） */
  notice?: string
}

// 登录页账号下拉用的本地账号摘要（不含密码哈希）
export interface AuthAccount {
  id: string
  username: string
  nickname: string
  email?: string
  avatar?: string
  lastLoginAt: number
}

export interface BindRoomResult {
  ok: boolean
  boundRooms?: string[]
  error?: string
  // 卡密门禁：需要先申请授权（弹申请引导）
  needApply?: boolean
  // 卡密门禁：申请已在审批中，通过后自动绑定
  pending?: boolean
  // 提交申请时发现该房已授权，已直接完成绑定（不用等审批）
  bound?: boolean
  // 卡密平台模式：平台错误码（room_slot_card_required / room_change_card_required / room_not_bound …）
  code?: string
  // 卡密平台模式：名额 / 改绑次数不够，要先兑换对应卡种
  needCard?: 'room_slot' | 'room_change'
}

// 邮箱绑定同步结果：restored = 从服务器恢复回来的；removed = 跟后台动作本地解掉的
export interface SyncEmailRoomsResult {
  ok: boolean
  boundRooms?: string[]
  restored?: string[]
  removed?: string[]
  error?: string
}

// 抖音直播间身份验证结果（绑定前确认主播昵称+头像）
export interface DouyinRoomLookup {
  ok: boolean
  room?: string
  nickname?: string
  avatar?: string
  needLogin?: boolean
  // 直播间没开播，回落的当前登录账号身份（无法直接读到房主）
  offline?: boolean
  error?: string
}

// 卡密授权状态（连接器写入的 license_status.json 解析结果）
export interface LicenseStatus {
  known: boolean // 状态文件存在且记录的直播间与目标一致
  room: string
  licensed: boolean
  banned: boolean
  applying: boolean
  expire: string
}

// 申请授权获批后自动绑定直播间的事件载荷
export interface RoomAutoBoundPayload {
  room: string
  boundRooms: string[]
}

// 邮箱绑定同步后广播给渲染层刷新房间列表的载荷（后台解绑/换绑、换机恢复触发）
export interface RoomsSyncedPayload {
  boundRooms: string[]
  restored: string[]
  removed: string[]
}

// ============ 邮箱账号 ============

export interface EmailAuthResult {
  /** 服务器发的会话凭证（登录/注册/重置成功时才有） */
  session?: string
  ok: boolean
  email?: string
  licensed?: number
  banned?: number
  error?: string
  /** 平台错误码（卡密平台模式：invalid_code / code_expired / rate_limited …），页面按码给提示 */
  code?: string
  /** 卡密平台模式：找回密码成功后平台直接建立会话，这里带上已登录的账号 */
  user?: SessionUser
}

export interface EmailLicense {
  ok: boolean
  licensed: number
  banned: number
  expire: string
  note: string
  // 已授权游戏：gameId → 1
  games?: Record<string, number>
  // 已提交申请、待审批的游戏 id 列表
  pendingGames?: string[]
  // 服务器侧该邮箱已登记的绑定直播间（换机/重装后客户端据此恢复本地绑定）
  rooms?: string[]
}

// 游戏授权申请结果 status: granted(首个直通)/pending(待审批)/already(已授权)
export interface EmailGameApplyResult {
  ok: boolean
  status?: 'granted' | 'pending' | 'already'
  error?: string
}

// 配置云同步结果：has=false 表示云端还没有备份
export interface ConfigCloudResult {
  ok: boolean
  data?: Record<string, unknown>
  has?: boolean
  error?: string
}

// ============ 卡密平台授权（userData/license-provider.json 存在时启用）============

/** 平台返回的一项权益：allowed 才代表允许执行（游戏权益要娱乐助手同时有效） */
export type CardRight = {
  id: string
  name: string
  kind: string
  status: string
  permanent: boolean
  expires_at: number | null
  allowed: boolean
  reasons: string[]
}

/** 直播间名额（由平台 room_quota 映射，平台是唯一权威；本机只缓存 rooms 给界面显示） */
export type RoomQuotaState = {
  /** 长期名额总数（默认 1，名额卡 +1） */
  capacity: number
  /** 剩余改绑次数（初始 3，每张改绑卡 +3，可累加） */
  changes_left: number
  changes_used: number
  /** 还能新绑几个直播间 */
  available: number
  rooms: string[]
  bindings: { slot: number; room: string }[]
  /** 用过后解绑的空名额；省略表示旧平台未知，空数组表示没有用过的空名额。 */
  empty_slots?: { slot: number; last_room: string | null }[]
  /** 免检模式：数量和改绑次数都不限（capacity / changes_left 只是让预检放行的大数），界面显示「不限」 */
  free?: boolean
}

/** 卡密授权快照：enabled=false 表示本机没有配置卡密平台（走原有账号系统） */
export type CardSnapshot = {
  ok: boolean
  enabled: boolean
  /** 授权检查已暂停（license-policy enforce=false）：rights 是「全部已激活（永久）」的免检快照，不来自平台 */
  free?: boolean
  /** 平台基地址（含子路径，如 https://47.251.93.171:8770/card） */
  origin?: string
  user?: { id: string; email: string }
  rights?: CardRight[]
  roomQuota?: RoomQuotaState
  error?: string
  /** 配置来源：userData 显式文件 / 随安装包的 resources 默认文件 */
  source?: 'userData' | 'resources'
  /** 平台身份模式：existing = 正式（复用原邮箱身份服务，注册 / 找回要验证码）；local = 本机测试平台；不知道时留空 */
  identityMode?: 'existing' | 'local'
  /** 注册 / 找回密码是否需要邮箱验证码。读不到平台元信息时按「需要」处理，不假设是本机模式 */
  registrationRequiresCode?: boolean
  /** enabled=false 且本机只有旧版本地账号时给出的原因：默认平台配置已随安装包带上，但为了不丢他们的账号而暂不启用 */
  legacyHold?: 'local-accounts'
  /** legacyHold 时：可以用 cardAdoptDefault() 切到新账号系统（需重启） */
  defaultAvailable?: boolean
  /** 平台暂时联系不上，正按本机保存的平台签名凭证（离线凭证）继续用；rights 里的 allowed 来自验过签的凭证 */
  offline?: boolean
  /** 离线凭证（娱乐助手那张）的到期时间（秒）：过了这个点还联系不上平台就真的用不了了 */
  offlineUntil?: number
}

/** window.api.cardRooms()：向平台读当前账号的直播间名额（同时把本机缓存的绑定列表同步成平台的） */
export type CardRoomsResult = { ok: boolean; quota?: RoomQuotaState; error?: string; code?: string }

/**
 * window.api.cardRoomVerify(room?, proof?)：
 *   - 不带 proof：打开独立浏览器窗口扫码，拿到真实登录态后核实 room；room 留空则回 needRoom=true + proof，让主播粘贴一次链接
 *   - 带 proof：复用刚扫码取得的登录态核实 room，不用再扫
 *   proof 是主进程内的短效一次性凭证，只关联当前卡密账号 / 来源 / 房间 / 登录态；取消、超时、换号都不消耗名额
 */
export type CardRoomVerifyResult = {
  ok: boolean
  proof?: string
  room?: string
  nickname?: string
  avatar?: string
  /** 直播间当前没开播：昵称 / 头像是扫码登录账号本人的，请主播自行核对房号 */
  offline?: boolean
  needRoom?: boolean
  error?: string
  code?: string
}

export type CardRoomCommitInput = { action: 'bind' | 'replace'; room: string; previous?: string; proof: string }

/** window.api.cardRoomCommit：平台事务扣名额 / 改绑次数；needCard 表示要先兑换对应卡种再重试（proof 仍有效） */
export type CardRoomCommitResult = {
  ok: boolean
  boundRooms?: string[]
  quota?: RoomQuotaState
  error?: string
  code?: string
  needCard?: 'room_slot' | 'room_change'
}

// ============ 通知中心 ============

// 服务端通知（后台解绑/换绑、购买成功、授权开通等写入，客户端轮询拉取 + 新通知弹 toast）
export interface AppNotification {
  id: string
  type: string // unbind / replace / purchase / approve / grant
  text: string
  ts: number
  read: number // 0 未读 / 1 已读
  // 后台解绑/换绑动作涉及的直播间（replace 时 room=旧房、newRoom=新房），同步绑定用
  room?: string
  newRoom?: string
}

export interface NotifyListResult {
  ok: boolean
  list?: AppNotification[]
  error?: string
}

// ============ Mod 库 ============

export interface ModChangeNote {
  version: string
  date: string
  notes: string[]
}

/**
 * Mod 上架状态（缺省 listed）。由后台「Mod 管理」通过远端清单 updates/mods-catalog.json 下发，
 * 和版本号互不牵扯（版本没变也能改状态）：
 *   listed      在售：游戏库正常显示、可安装
 *   coming_soon 待发售：游戏库看得到、详情页写「待发售」，不能首次安装
 *   unlisted    下架：游戏库里不出现，不能首次安装；已装好的照常修复 / 卸载 / 识别本机版本
 */
export type ModStatus = 'listed' | 'coming_soon' | 'unlisted'

export interface ModManifest {
  id: string
  name: string
  tagline: string
  description: string
  category: string
  version: string
  author: string
  game: string
  gameExe: string
  // 关联 games.ts CATALOG 的游戏 id（多游戏路由用，缺省为 WheelLive 单游戏行为）
  gameId?: string
  // 安装目标：userData=客户端数据目录（默认）；exeDir=游戏 exe 所在目录（UE4SS 这类必须进游戏目录的）
  installInto?: 'userData' | 'exeDir'
  // 装好后游戏目录里一定存在的文件（相对游戏 exe 目录），客户端靠它识别「不是我装的但确实装了」
  installedMarker?: string
  // 上架状态，缺省 listed（见 ModStatus）。远端清单能单独盖这个字段，不必抬版本
  status?: ModStatus
  cover: string
  color: string
  tags: string[]
  screenshots: string[]
  features: string[]
  changelog: ModChangeNote[]
  download: {
    url: string
    size: number
    sha256: string
    filename: string
    // zip=解压到目标目录（默认）；installer=Inno Setup 安装程序，静默运行装进游戏目录（轮椅 mod）
    kind?: 'zip' | 'installer'
  }
}

export interface ModInstallProgress {
  modId: string
  phase: 'download' | 'cached' | 'verify' | 'install' | 'done'
  percent: number
  detail?: string
}

export interface InstalledMod {
  id: string
  modId: string
  version: string
  installPath: string
  installedAt: number
  // 不是客户端装的、而是在游戏目录里检测到的（版本可能为空）
  detected?: boolean
}

export interface ModsListResult {
  mods: ModManifest[]
  installed: Record<string, InstalledMod>
}

// ============ 盲盒 ============

export interface CustomBox {
  Id: string
  Name: string
  Gift: string
  AllowKill: boolean
  Pool: string[]
  OpenCount: number
}

// ============ 配置编辑器 ============

export type ParamType = 'number' | 'boolean' | 'string' | 'select' | 'list'

export interface ParamOption {
  value: string
  label: string
}

export interface ParamField {
  key: string
  label: string
  type: ParamType
  desc?: string
  group?: string
  min?: number
  max?: number
  step?: number
  options?: ParamOption[]
  default?: unknown
  listType?: ParamType
  hidden?: boolean
  // 盲盒选择器：选项 = 自定义盲盒列表（空 = 纯机选大盲盒），由前端运行时生成
  boxPicker?: boolean
  // 整蛊勾选面板：值 = prank id 数组。绑定 BoxExclude 时为「排除名单」语义（勾上=在盲盒池=不在名单里）
  prankPicker?: boolean
}

export interface ConfigGroup {
  id: string
  name: string
  desc?: string
}

export interface ConfigSchema {
  version: string
  groups: ConfigGroup[]
  fields: ParamField[]
}

export interface ConfigReadResult {
  ok: boolean
  schema: ConfigSchema
  values: Record<string, unknown>
  configPath?: string
  error?: string
}

export interface ConfigSaveResult {
  ok: boolean
  error?: string
}

// ============ 直播互动统计 ============

export interface LiveSessionStats {
  room: string
  started: number
  last: number
  /** 本场确认结束的时间（秒）；与心跳分开。 */
  endedAt?: number
  /** 旧版已结束记录的 last 可能被退出流程覆盖，无法还原准确时长。 */
  durationUnknown?: boolean
  gifts: number
  coins: number
  likes: number
  follows: number
  running: number
}

// 累计看板单元格（从 world_board.json 的 cells 尽力解析：metric=维度序号、window=时间窗序号）
export interface LiveBoardCell {
  metric: number
  window: number
  value: number
}

export interface LiveBoard {
  ts?: number
  cells: LiveBoardCell[]
}

export interface LiveStatsResult {
  ok: boolean
  session?: LiveSessionStats
  remotePranks: number
  board?: LiveBoard
  error?: string
}

// ============ 快捷键 ============

/** 一条整蛊：id 与 mod 内注册的 prank id 一一对应；name / cat 是主播看到的中文名和分组 */
export interface PrankDef {
  id: string
  name: string
  cat: string
  /** 致命/破坏类：抽奖、盲盒这类自动触发的地方默认排除 */
  danger?: boolean
  /** 给主播看的说明（可选） */
  desc?: string
}

/** 整蛊菜单的一组（按 PrankDef.cat 分组，顺序 = 定义文件里首次出现的顺序） */
export interface PrankGroup {
  id: string
  name: string
  items: PrankDef[]
}

/**
 * 一款游戏的「菜单 + 参数 + 默认键位」定义包。客户端自带一份（mods-catalog/schemas），
 * 更新源上跟 mod 清单一起发布的会覆盖它 —— 上新整蛊 / 改参数说明不用再发客户端（2026-09-14）。
 */
export interface SchemaBundle {
  gameId: string
  version?: string
  pranks: PrankDef[]
  config?: ConfigSchema
  binds?: NativeKeybinds
}

// mod 源码里的原生默认键位（从 ApplyDefaultBinds + EnsureDefaultBinds 复刻而来）
export interface NativeKeybinds {
  menu: string
  leaderboard: string
  binds: Record<string, string>
}

export interface PranksResult {
  pranks: PrankDef[]
  defaults: NativeKeybinds
}

// ============ 游戏 ============

export interface ModHealthIssue {
  code:
    | 'missing-files'
    | 'misplaced'
    | 'not-loaded'
    | 'no-path'
    | 'not-installed'
    // 2026-09-07 晚补的四种「文件全在、就是没加载」：
    | 'other-copy' // 启动的是另一份游戏，客户端检查的是我们装 mod 的那份
    | 'loader-not-injected' // UE4SS/MelonLoader 没注入（本次没有加载器日志）
    | 'mod-not-started' // 加载器起来了，日志里没有我们的 mod
    | 'mod-disabled' // UE4SS 的 mods.txt 里把整蛊器标成了停用
    | 'no-vcruntime' // 系统缺 VC++ 运行库，UE4SS 起不来
    | 'last-run-not-loaded' // 游戏已经关了，但上次那一局整蛊器没加载
    | 'mod-outdated-hardcoded-path' // 老版整蛊器写死了作者机器的路径，主播换了盘位就整个不加载
  text: string
  fixable: boolean
  files?: string[]
}
export interface ModHealth {
  gameId: string
  modId?: string
  ok: boolean
  issues: ModHealthIssue[]
  loaded?: boolean
  hbAgeSec?: number
  version?: string
  checkedAt: number
  /** 加载器（UE4SS / MelonLoader）的证据：日志时间、日志里有没有我们的 mod、像报错的行 */
  loader?: { name: string; logAt?: number; modInLog?: boolean; errors?: string[] }
}

export interface GameProcessState {
  running: boolean
  pid?: number
  exeName?: string
  /** 判定的是哪款游戏（主进程当前游戏）；启动页各卡片据此只给自己那款亮「运行中」 */
  gameId?: string
}

export interface GameLaunchResult {
  ok: boolean
  pid?: number
  error?: string
}

export interface GameItem {
  id: string
  name: string
  appid: string
  /** 路径合格才算已安装（2026-09-07 起不再只判文件存在，见 shared/gamePaths.ts） */
  installed: boolean
  /** 当前记着的 exe 路径（主播能直接看到认到的是哪个文件） */
  path?: string
  /** 路径不合格的原因，installed=false 时给主播看 */
  pathError?: string
  hero?: string
  header?: string
  logo?: string
}

/** 自动缓存抖音礼物图的一次同步结果 */
export interface GiftImageSyncResult {
  ok: boolean
  /** 6 小时内同步过同一房间，本次没动 */
  skipped: boolean
  /** 礼物图缓存目录（连接器目录/礼物图/抖音） */
  dir: string
  /** 抖音礼物表里的礼物数（按名字去重） */
  total: number
  /** 本地已有图的 */
  existing: number
  downloaded: number
  failed: number
  failedNames?: string[]
  at: number
  error?: string
}

export interface LiveStateResult {
  running: boolean
  bridgeOk: boolean
  path: string
  // mod 心跳（hb.json，轮椅 / 图书管理员 mod 每 5 秒写一次）：没有这个文件的 mod 三项都是 undefined
  modAlive?: boolean // 心跳在 20 秒内更新过 = mod 真在跑
  inGame?: boolean // 主播在局内（菜单里发的整蛊不会生效）
  bridgeReady?: boolean // mod 已开始读事件桥；游戏在跑但一直 false = mod 主循环出了问题
  hbAgeSec?: number
}

// ============ 直播连接器 ============

export interface ConnectorState {
  running: boolean
  connecting?: boolean
  pid?: number
  roomId?: string
  sim?: boolean
}

export type ConnectorLogLevel = 'info' | 'warn' | 'error' | 'gift' | 'follow' | 'like'

export interface ConnectorLogLine {
  ts: number
  level: ConnectorLogLevel
  text: string
  // 连接器日志的结构化解析结果。旧日志没有该字段时仍按 text 兼容显示。
  event?: ConnectorEvent
}

export type ConnectorEventType =
  | 'gift'
  | 'gift-image'
  // 连接器把观众头像下载到本地后打的「头像: 昵称 -> 路径」行（2026-09-11.1 起），挂件按昵称配头像
  | 'avatar'
  | 'comment'
  | 'member'
  | 'follow'
  | 'badge'
  | 'like'
  | 'anchor'
  | 'status'

// 连接器/抖音事件的统一模型。raw 永远保留原始行，便于现场诊断协议漂移。
export interface ConnectorEvent {
  type: ConnectorEventType
  ts: number
  raw: string
  /** 主播在客户端里点的「模拟」事件（互动工具 / 整蛊遥控的模拟观众）：照常触发规则和挂件，但不上报直播数据 */
  simulated?: boolean
  giftName?: string
  count?: number
  diamondCount?: number
  sender?: string
  uid?: string
  avatar?: string
  giftImage?: string
  text?: string
}

// 内置或连接器实时缓存的抖音礼物图。同名礼物可能有多个活动/历史图片变体；
// name 始终是真实礼物名，label 仅用于菜单中区分图片，不能用于事件匹配。
export interface EntertainmentGiftImage {
  name: string
  label: string
  path: string
  variant: number
  canonical: boolean
  source: 'connector' | 'builtin'
  // 官方礼物清单的可选元数据；连接器临时缓存没有这些字段。
  giftId?: string
  giftIds?: string[]
  diamondCount?: number
  pages?: string[]
  current?: boolean
}

// ============ 设置 ============

// 内置绿幕抠图（客户端自己把视频里的纯绿背景扣成透明，直播伴侣不用再开抠像）。
// 动作里只存「开/关」，这四个参数统一走设置页那套默认值。
export interface ChromaKeyConfig {
  enabled: boolean
  color?: string // 抠掉的颜色，默认 #00ff00
  similarity?: number // 0~100，越大越容易把接近这个颜色的像素扣掉
  smoothness?: number // 0~100，边缘过渡范围
  spill?: number // 0~100，溢色抑制（压掉人物边缘的绿边）
}

export interface Settings {
  gamePath: string
  gameExeName: string
  modConfigPath: string
  modRootPath: string
  connectorPath: string
  pythonPath: string
  downloadDir: string
  liveCompanionDir?: string // 手动指定的抖音直播伴侣安装目录
  rememberMe: boolean
  autoLogin: boolean
  // 窗口是否总在最前（标题栏 pin 图标切换）
  alwaysOnTop: boolean
  // 输出窗口（绿幕 / 视频 / 转盘 / 九宫格 / 挂件）是否总在最前；默认关，主播可把它们放到游戏后面
  outputsAlwaysOnTop?: boolean
  // 全局绿幕底开关：开启绿底，关闭透明底；切换后重开已开启的挂件生效。
  outputCaptureMode?: 'green' | 'transparent'
  outputStandbyVisible?: boolean // 旧字段（0.3.41～0.3.42 的「待机窗口停到屏幕外」），0.3.43 起不再停放、不再读
  // 采集窗口标题风格：short=「倒计时」（直播伴侣来源名里看得全），legacy=「知了猴倒计时」（老名字）。
  outputTitleStyle?: 'short' | 'legacy'
  // 播放/开启时是否把输出窗口抬到最前。默认 false：窗口原地更新内容，不盖住你正在看的东西。
  outputRaiseOnOpen?: boolean
  outputKeepStandby?: boolean // 旧字段（0.3.41～0.3.42），0.3.43 起改用 keepClosedSources，不再读
  // 关掉挂件后留不留那个采集窗口（留着 = 原地一块纯绿底，直播伴侣里的来源不失效）。默认不留：开哪个才有哪个窗口
  keepClosedSources?: boolean
  // 播放窗口是否跟着视频比例收边。默认 true：竖屏视频塞进横窗会留一圈黑边，收边后采集画面里没有多余边框。
  outputFitMedia?: boolean
  // 主窗口防采集保护。默认 true：直播伴侣/录屏软件/远程桌面都采不到操作台（防误采集）。
  // 用 ToDesk/向日葵等远程桌面管理这台电脑时关掉它，否则主窗口在远程画面里整个看不见。
  mainContentProtection?: boolean
  // 「抽时间记录」窗口：开着时多一个采集窗口，列出今天粉丝送礼抽到的时间（开关在时间插件页）
  timeLogWindow?: boolean
  // 视频素材自动排队：没指定窗口的（或指定的窗口正忙）自动用池子里空闲的绿幕窗口，多个同时触发不叠在一起
  videoQueue?: boolean
  // 排队池用几个绿幕窗口（1~4，默认 4；直播伴侣里只加了 3 个就填 3）
  videoPoolSlots?: number
  // 默认播放窗口（1~4，默认 1）：没指定窗口的素材最优先播到它；它忙时按「视频窗口自动排队」开关决定排队等它还是分流到其他开着的窗口
  videoDefaultSlot?: number
  // 视频排队上限：0 = 不限（默认，连送一千个一万个都排着播）；填了数就最多排这么多条，超过的不播并在日志里说明
  videoQueueLimit?: number
  // 内置绿幕抠图的默认参数：动作上只存开/关，具体参数用这一套（设置页可调）。
  chromaKey?: ChromaKeyConfig
  // Windows 默认软件合成以兼容窗口捕获；动效保留，修改后重启客户端生效。
  // 旧字段，只用来迁移到 renderMode：false→balanced、true→hardware。
  hardwareAcceleration?: boolean
  // 画面渲染方式（改完重启生效）：
  //   balanced  = 显卡负责画、系统负责合成窗口（推荐：客户端不卡，直播伴侣照样采得到）
  //   compatible= 全部交给 CPU（最保险，也最吃 CPU，是 0.3.40 及以前的行为）
  //   hardware  = 全交给显卡（最快，但静止不动的挂件窗口可能被采成黑屏）
  renderMode?: 'balanced' | 'compatible' | 'hardware'
  /** 进程模式：lean 省内存（挂件与主界面共用渲染进程，改完重启生效）/ stable 每窗口独立进程 */
  processMode?: 'lean' | 'stable'
  /** Chromium 前进后退页面缓存：默认关（旧视频页面副本白占内存），改完重启生效 */
  pageBackForwardCache?: boolean
  /** 内存守卫：可用内存低于吃紧线提示、低于告急线暂停新来的自动视频（清排队），回落自动恢复 */
  memoryGuard?: boolean
  memoryTightMb?: number
  memoryCriticalMb?: number
  /** 素材自动瘦身：超过最高分辨率（默认 720p）的视频后台压一份副本再播；缓存上限 MB */
  mediaOptimize?: boolean
  mediaOptimizeMaxHeight?: number
  mediaCacheMaxMb?: number
  // 邮箱验证/授权服务器地址
  serverUrl: string
  // 首次使用向导是否已看过（迁移自 localStorage，持久化防每次弹引导）
  guideSeen: boolean
  /** 是否已完成或跳过首次素材库引导。 */
  assetGuideSeen?: boolean
  // 当前游戏 id：决定 mod 目录路由 / 游戏检测 / 连接器 --game 参数（多游戏切换）
  currentGameId: string
  // 每游戏的 exe 路径（gameId → path）。旧字段 gamePath 只作 WheelLive 的兼容兜底
  gamePaths: Record<string, string>
  // 品游素材目录：品游把「一个项目」放成「一个文件夹」（视频 + 同名 .脚本），
  // 脚本里写的是相对项目名（如「播放视频:哈喽体力转盘\随机播放[绿幕2]」），要靠这个根目录去找
  pinyouAssetRoot?: string
}

export interface SettingsResult {
  settings: Settings
  outputWindowsNeedReopen?: boolean
}

// ============ 娱乐助手 ============

// 礼物触发的动作类型：键鼠 / 脚本 / 音效 / 系统动作 / 动作命令 / OBS 滤镜与场景
export type EntertainmentActionType = 'key' | 'script' | 'sound' | 'system' | 'command' | 'obs'

// OBS 动作：开/关/切换某个源的滤镜、亮 N 秒再关、切场景（走 obs-websocket）
export type EntertainmentObsAction = 'filter-on' | 'filter-off' | 'filter-toggle' | 'filter-flash' | 'scene'

// 系统动作：shutdown=自动关机 / lock=锁定屏幕 / displayoff=显示器息屏 / kill=结束进程
export type EntertainmentSystemCmd = 'shutdown' | 'lock' | 'displayoff' | 'kill'

// 动作命令（复刻参考软件「动作命令」子执行器，逆向 0x4d8942）：
// countdown-adjust=倒计时加减(param=秒数 或 "a,b"范围内随机) / countdown-clear=倒计时清零
// send-text=发送文本 / paste-text=粘贴文本 / run-file=运行文件/创建进程(param=路径)
// kill=结束进程(param=进程名) / mouse=鼠标操作(param=MouseActionType)
// video-play=播放视频(param=视频路径) / video-stop=停止视频 / video-gif=播放动图(param=gif路径)
// mobile=手游动作(param=up/down/turn/dance/fwd/back/lmove/rmove) → SendKeys 模拟
export type EntertainmentCommandCmd =
  | 'countdown-adjust'
  | 'countdown-clear'
  | 'send-text'
  | 'paste-text'
  | 'run-file'
  | 'kill'
  | 'mouse'
  | 'video-play'
  | 'video-play-wait'
  | 'video-random'
  | 'sound-random'
  | 'video-stop'
  | 'video-gif'
  | 'mobile'
  | 'wheel-spin'
  | 'nine-spin'
  | 'count-adjust'
  | 'count-clear'
  | 'count-mul'
  | 'count-div'
  | 'overtime-adjust'
  | 'overtime-clear'
  | 'overtime-mul'
  | 'overtime-div'
  // key-hold=键盘按住(param="键名,毫秒" 如 W,3000) / random-script=随机执行目录里的一个脚本(param=目录)
  | 'key-hold'
  | 'key-lock' // 全部|3000 / W,A,S,D|5000 / 调整|-1000（剩余时长增减）
  | 'key-unlock'
  | 'key-up'
  | 'key-sequence'
  | 'script-sequence'
  | 'random-script'
  // ★project-random=品游式「项目」：param 是一个文件夹（可带 |绿幕N 指定播放窗口）。
  //   触发时从文件夹里随机抽一条视频播放，若旁边有同名 .脚本 就顺带执行它里面的动作。
  //   品游的组织方式就是「一个项目一个文件夹」，盲盒/礼物触发整个文件夹而不是单个文件。
  | 'project-random'
  // ★blindbox-open=开一次【时间盲盒】：param 填盲盒事件名/id，留空 = 从全部启用的事件里随机抽。
  //   用户 2026-09-07：「礼物触发应该包含所有能触发的东西……比如说我们设置的时间盲盒」——
  //   在这之前时间盲盒只能靠它自己那份礼物表触发，礼物规则/转盘/九宫格都碰不到它。
  | 'blindbox-open'
  // ★special-play=特色整蛊（锁链/抓鸭子/粉丝来电…17 个绿幕小游戏）：param = 玩法|操作|数量|选项，
  //   例 catch_duck|add|5|size=big。拆合与中文标签在 shared/specialGames.ts。窗口「特色整蛊」没开会自动打开（窗口设置可关）。
  | 'special-play'
  // ★special-box=特色整蛊盲盒（照时间插件的盲盒）：param = 事件id,事件id,…|显示名（* = 事件库全部启用的），
  //   每份礼物从勾选的事件里随机抽一个执行；事件库在特色整蛊页。
  | 'special-box'
  // ★game-prank=游戏整蛊（整蛊器里的整蛊，轮椅翻车/DS 惊吓…）：param = 游戏id|整蛊id|显示名，
  //   例 4wheel-challenge|flip|翻车。只在当前选中的就是这款游戏时执行（经 bridge 推给运行中的整蛊器）。
  | 'game-prank'

// 手游动作（参考软件：自动抬头/低头/原地转圈/蹦迪/前进/后退/左右移动）
export type MobileActionType =
  | 'up' | 'down' | 'turn' | 'turnfire' | 'dance' | 'dance2' | 'fwd' | 'back' | 'lmove' | 'rmove'

// 触发来源（复刻参考软件「动作分类」里的 礼物 / 关注触发 / 点赞触发，
// 以及 选择框_动作_关注模式）。gift=送礼；follow=关注；like=点赞；
// member=进场；comment=弹幕关键词（giftName 当关键词用）。
export type EntertainmentTriggerType = 'gift' | 'follow' | 'like' | 'member' | 'comment'

// 排队方式（参考软件「整蛊排队」：即时 / 插队）。
// normal=排队尾；jump=插到队头；instant=不排队立刻执行。
export type EntertainmentQueueMode = 'normal' | 'jump' | 'instant'

// 一条规则里的「一个动作」。主动作的字段直接放在规则上（老数据兼容），
// 附加动作放 EntertainmentRule.extraActions，字段完全一样；触发时按顺序执行。
export interface EntertainmentAction {
  actionType: EntertainmentActionType
  keySeq?: string // actionType=key 时：SendKeys 序列，如 "{F1}"、"{ENTER}"、"abc"
  scriptPath?: string // actionType=script 时：脚本/程序路径
  soundPath?: string // actionType=sound 时：音效文件名（downloadDir/entertainment/sounds 下）
  soundMode?: 'sync' | 'unique' // 音效方式：sync=同步完整播放；unique=相同音效不重叠
  soundVolume?: number // 音效音量 0~100，不填=100
  systemCmd?: EntertainmentSystemCmd // actionType=system 时：系统动作
  systemParam?: string // 结束进程时的进程名
  commandCmd?: EntertainmentCommandCmd // actionType=command 时：动作命令
  commandParam?: string // 动作命令参数（倒计时秒数/文本/路径/进程名/鼠标动作；支持 "a,b" 范围随机）
  obsAction?: EntertainmentObsAction // actionType=obs 时：做什么
  obsSource?: string // 滤镜所在的源
  obsFilter?: string // 滤镜名
  obsScene?: string // 要切到的场景
  obsSeconds?: number // filter-flash：亮几秒后关
  delayMs?: number // 执行这个动作前先等多少毫秒（0/不填 = 紧跟上一个动作，等于同时触发）
  // 这个动作播的视频要不要走内置绿幕抠图（只对 project-random / video-play 这类动作有意义）
  chroma?: boolean
}

export interface EntertainmentRule extends EntertainmentAction {
  id: string
  /**
   * 规则名：人认的名字（「-10分」「虚拟主播时间」）。
   * 2026-09-08 之前没有这个字段，列表直接显示 giftName，礼物名被当成了规则身份 ——
   * 于是导入品游项目只能拿项目名去占礼物名，改成真礼物名后就认不出是哪个项目的了。
   * 留空则列表回退显示礼物名（老规则兼容）。
   */
  name?: string
  /** 备注：导入来源之类（「品游 虚拟主播时间」），只给人看 */
  remark?: string
  /**
   * 分组：一般就是品游项目名（「虚拟主播时间」），导入时自动填。
   * 主播按组开关（今晚开哪几个项目），预设保存的就是「开哪几个组」。
   */
  group?: string
  /** 礼物名 = 触发条件。★可以留空（导入的规则就是空的），但空的规则不允许启用、也永不匹配 */
  giftName: string
  extraActions?: EntertainmentAction[] // 附加动作：主动作之后按顺序执行，每个可设 delayMs
  times?: number // 礼物数量：累计收到多少个才触发一次（组合框_动作_礼物数量）
  triggerType?: EntertainmentTriggerType // 触发来源，默认 gift（选择框_动作_关注模式）
  multiply?: boolean // 执行倍数：送 N 个就执行 N 次；关掉则一次事件只执行一次（选择框_动作_执行倍数）
  repeat?: number // 执行次数：每次触发连续执行几次（组合框_动作_执行次数）
  priority?: number // 优先等级：数字越大越先执行，同级按先来后到
  queueMode?: EntertainmentQueueMode // 排队方式：排队 / 插队 / 即时
  enabled?: boolean
}

export interface EntertainmentSoundEvent {
  path: string
  mode: 'sync' | 'unique'
  volume?: number // 0~100，不填=100
}

// 整蛊排队：礼物规则执行队列的快照（排队展示窗口 / 规则页实时显示）
export interface ExecQueueItem {
  id: number
  gift: string // 触发来源：礼物名 / 关注 / 点赞 / 进场 / 弹幕
  sender: string
  image: string
  action: string // 要执行什么（短标签）
  priority: number
}

export interface ExecQueueSnapshot {
  running: ExecQueueItem | null
  /** 只带前 60 条；总数看 total */
  pending: ExecQueueItem[]
  total?: number
}

export interface QueueWidgetConfig {
  skin?: WidgetSkinId // 原版或成套挂件皮肤，不改变业务配置
  title: string
  maxRows: number // 窗口最多显示几条排队中的
  showSender: boolean
  showAction: boolean
  background: 'green' | 'transparent'
  width: number
  height: number
}

export interface QueueWidgetState {
  open: boolean
  config: QueueWidgetConfig
  snapshot: ExecQueueSnapshot
}

/**
 * 规则预设：「今晚开哪几个项目」的一套组合。
 * 应用时把 groups 里的组全部启用、其余组停用（没分组的规则不动）。
 * 透明图的观众菜单也从当前启用的规则生成，所以菜单和实际能触发的永远一致。
 */
export interface EntertainmentPreset {
  id: string
  name: string
  groups: string[]
  updatedAt?: number
}

export interface EntertainmentRulesResult {
  ok: boolean
  id?: string
  rules?: EntertainmentRule[]
  error?: string
}

// ---- 导入「品游娱乐助手Pro」的礼物配置（src/shared/pinyou.ts）----
export interface PinyouRuleNote {
  gift: string
  text: string // 这条礼物导过来时要提醒主播的事（如：品游还跑了自家脚本，客户端没法运行）
}
export interface PinyouSkipped {
  gift: string
  category: string // 品游里的分类：动作 / 视频 / 物理
  reason: string
}
export interface PinyouPlan {
  name: string // 方案名（从文件名推）
  file: string
  rules: EntertainmentRule[] // 已转成客户端规则，id 留空，导入时再生成
  notes: PinyouRuleNote[]
  skipped: PinyouSkipped[]
  empty: number // 品游里挂着但什么都没配的礼物数
}
export interface PinyouImportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  root?: string // 认出来的品游安装目录（用来定位 音效\ 视频\）
  plans?: PinyouPlan[]
}

export interface PinyouApplyResult {
  ok: boolean
  added?: number
  removed?: number
  removedIds?: string[]
  error?: string
}

// 原版「弹幕转发」WebSocket 负载，监听端为 ws://127.0.0.1:<port>。
export interface DanmakuForwardEvent {
  type: 'comment' | 'gift' | 'member' | 'follow' | 'like' | 'liveroom'
  uid: string
  name: string
  url: string
  msg: string
  gift: string
  num: number
}

export interface DanmakuForwardState {
  running: boolean
  port: number
  clients: number
  error?: string
}

// 透明图合成方案
export interface TransparentProgram {
  id: string
  name: string
  text: string
  font: string
  fontSize: number
  color: string
  strokeColor: string
  spacing: number
  scale: string // 如 '1080x1920(竖)'、'1280x720(横)'
  rolling: boolean
  imgPath?: string
}

// 透明图助手原版 SQLite 的礼物记录。字段同时覆盖 gf.db 的小写列和
// 客户端菜单所需的本地图片信息；giftDataBase64 用来保证未知 BLOB 可无损往返。
export type TransparentGiftPlatform = 'dy' | 'ks' | 'bz' | 'sph' | 'tk'

export interface TransparentGiftRecord {
  id: string
  platform: TransparentGiftPlatform
  name: string
  giftId: string
  diamondCount: number
  giftData: string
  giftDataBase64?: string
  imagePath: string
  imageName: string
}

export interface TransparentMenuProgram {
  name: string
  program: string
  listPro: TransparentGiftRecord[]
  // 原版 config.db 中 giftpro 可能不是 JSON；保留原始 BLOB 才能无损迁移。
  giftProBase64?: string
}

export interface TransparentGiftVersion {
  name: string
  version: number
}

export interface TransparentColorRecord {
  name: string
  value: string
  valueBase64?: string
}

export interface TransparentDbImportResult {
  ok: boolean
  gifts?: TransparentGiftRecord[]
  textPrograms?: TransparentMenuProgram[]
  imagePrograms?: TransparentMenuProgram[]
  programs?: { name: string; cfg: Record<string, unknown> }[]
  giftVersions?: TransparentGiftVersion[]
  colors?: TransparentColorRecord[]
  source?: string
  warnings?: string[]
  error?: string
}

// 鼠标模拟动作：移动 / 左键单击 / 右键单击 / 左键双击 / 按住·左 / 弹起·左 / 按住·右 / 弹起·右
export type MouseActionType =
  | 'move'
  | 'click-left'
  | 'click-right'
  | 'dblclick-left'
  | 'down-left'
  | 'up-left'
  | 'down-right'
  | 'up-right'

// ===== 时间插件 = 倒计时插件（参考软件「倒计时插件」窗口EX1，礼物触发加减）=====
// 逆向自脱壳 exe：配置字段 插件配置倒计时/显示文字内容/增加时间礼物/减少时间礼物/
// 增加时间秒数/减少时间秒数/是否自动隐藏/是否显示礼物/开始·结束是否执行热键/
// 开始·结束热键功能键(无/Alt/Ctrl/Ctrl+Alt/Shift)/开始·结束热键主键/是否开启倒计时。
export interface TimeWidgetHotkey {
  enabled: boolean // 是否在倒计时开始/结束时向前台程序发送按键
  func: string // 热键功能键（无/Alt/Ctrl/Ctrl+Alt/Shift）
  key: string // 热键主键
}

export interface TimeWidgetConfig {
  on: boolean
  enable: boolean // 是否开启倒计时（选择框_开启倒计时）
  title: string // 标签_倒计时_标题 / 编辑框_倒计时_显示文字
  // 原版挂件的运行参数。旧配置没有这些字段时由主进程补默认值。
  initial: number // 初始时间（秒）
  clockSpeed: number // 时钟周期（毫秒）
  // 礼物触发加减
  addGift: string // 增加时间礼物（收到该礼物 → +增加时间秒数）
  addSeconds: number // 增加时间秒数
  subGift: string // 减少时间礼物（收到该礼物 → -减少时间秒数）
  subSeconds: number // 减少时间秒数
  // 运算方式与区间随机（原版运算器 0x430c55：加减/范围/清零/乘以/除以；
  // 动作命令说明「-1000,1000 表示范围内随机」）。留空=加减，秒数2 留空=不随机。
  addOp?: CountdownOp
  addSeconds2?: number | null // 增加时间秒数区间终点
  subOp?: CountdownOp
  subSeconds2?: number | null // 减少时间秒数区间终点
  // 挂件礼物栏：加几个显示几个，最多 6 格（原版 礼物1~6 控件组）
  gifts?: TimeWidgetGift[]
  blindBoxEvents?: TimeBlindBoxEvent[]
  // 指定播放窗口：盲盒视频、礼物栏里配的视频都播到这个绿幕（1~4，默认 4，别覆盖主播自己配的绿幕 1~3）
  boxVideoSlot?: number
  // 挂件下方的送礼滚动条：谁（带头像）送了什么、抽了多少时间
  giftTicker?: boolean
  // 指定窗口忙时去不去别的开着的绿幕窗口（默认去）
  boxVideoOverflow?: boolean
  // 「抽时间记录」窗口：标题牌上的字、最多显示今天最近几条（皮肤/配色/字号/缩放全部跟倒计时挂件走）
  logTitle?: string
  logRows?: number
  giftPanel?: boolean // 是否显示挂件礼物栏
  giftColumns?: number // 每行几格（1/2/3）
  giftPanelWidth?: number // 礼物栏相对标题条的宽度倍率（原版礼物栏更宽）
  // 挂件配色（全部可调；留空走主题预设）
  giftNameColor?: string
  addColor?: string // 加时效果文字色
  subColor?: string // 减时效果文字色
  boxColor?: string // 盲盒效果文字色
  cellBg?: string // 礼物格底色
  cellBorder?: string // 礼物格边框色
  cellAlpha?: number // 礼物格底色透明度
  petMotion?: boolean // 萌宠皮肤配件的轻微摆动，默认开启
  charmScale?: number // 萌宠皮肤边上吊饰的大小，默认 0.70 对齐原稿尺寸。
  giftNameSize?: number
  giftTextSize?: number
  giftIconSize?: number
  scale?: number // 整体缩放（直播里要多大就多大）
  // 显示
  autoHide: boolean // 是否自动隐藏（到0自动隐藏窗口）
  showGift: boolean // 是否显示礼物（收到触发礼物时显示礼物图）
  showNegative: boolean // 是否显示负数
  showSeconds: boolean // 是否直接显示原始秒数
  zeroText: string // 归零时显示文字
  bgImage: string // 自定义背景图；空值使用原版主题
  theme: string // 1=青蓝、2=橙色、3=宽横幅
  titleColor: string
  timeColor: string
  // 开始/结束时向前台程序发送的按键。
  startHotkey: TimeWidgetHotkey
  endHotkey: TimeWidgetHotkey
  posX: number
  posY: number
}

// 倒计时礼物运算方式（原版运算器 0x430c55）
export type CountdownOp = '加减' | '范围' | '清零' | '乘以' | '除以'

// 挂件礼物行的运算方式（原版「组合框_计时_增减N」）。
export type TimeGiftOp = '加减' | '乘以' | '除以' | '范围' | '清零'

// 挂件上的一格礼物（原版 图片框_计时_礼物N + 标签_计时_礼物名字N +
// 标签_计时_礼物时间N + 图片框_计时_分隔条N，最多 6 组，配几个显示几个）。
export interface TimeWidgetGift {
  name: string // 礼物名（真实抖音礼物）
  mode?: 'direct' | 'blindbox'
  blindBoxEventIds?: string[] // 空奖池不触发；每份礼物从所选事件中抽一项。
  op: TimeGiftOp
  seconds: number // 数值（时间前）；加减=秒数，乘/除=倍数，范围=目标值
  seconds2?: number | null // 数值区间终点（时间后，所有运算共用；留空=固定值）
  text?: string // 自定义效果文字（编辑框_计时_文字N），留空按运算方式自动生成
  img?: string // 自定义图标，留空用真实抖音礼物图
  // 收到该礼物后播放的绿幕视频。固定占用 4 号窗口，不影响主播手动摆放的 1～3 号窗口。
  video?: string
  // 循环播放；关闭后视频自然播完自动关闭。videoSeconds>0 时到点强制关闭。
  videoLoop?: boolean
  videoSeconds?: number
  // 屏幕显示：关掉后这个礼物照样触发计时变化，只是不上挂件的礼物栏（缺省 = 显示）
  showOnPanel?: boolean
}

export interface TimeBlindBoxEvent {
  id: string
  name: string
  /** 分组：来自品游项目名（导入时自动填）。主播按项目整组开关 */
  group?: string
  /** 停用的事件不参与抽奖（整组开关就是批量改这个字段）；缺省 = 启用 */
  enabled?: boolean
  op: 'add' | 'subtract' | 'multiply' | 'divide'
  value: number
  value2?: number | null
  video?: string
  videoSeconds?: number // 0=播完；不循环，连击逐项播放。
  sound?: string
  soundVolume?: number // 0～100
  action?: 'none' | 'prank' | 'effect'
  actionParam?: string
}

export interface TimeBlindBoxResult {
  id: string
  eventId: string
  eventName: string
  giftName: string
  sender: string
  source: 'live' | 'test'
  phase: 'running' | 'completed' | 'error' | 'cancelled'
  op: TimeBlindBoxEvent['op']
  value: number
  before: number
  after: number
  ts: number
  error?: string
}

export interface TimeGiftLogEntry {
  ts: number
  name: string
  sender: string
  delta: number
  remaining: number
  source: 'live' | 'test'
  eventName?: string
  error?: string
  // 观众头像（连接器给的 URL）；记录窗口和滚动条要带头像
  avatar?: string
}

export interface TimeWidgetState {
  open: boolean
  remaining: number
  running: boolean
  zeroed?: boolean
  hidden?: boolean
  queueLength?: number
  activeEvent?: { id: string; name: string }
  lastResult?: TimeBlindBoxResult
}

// ===== 计数挑战插件（参考软件「计数挑战」H5 插件，独立模块）=====
// 逆向自 extracted_h5\25_计数挑战模块.html + 控件：编辑框_计时_标题/初始时间/归零文字、
// 组合框_计时_礼物1~6+增减1~6、编辑框_计时_时间前1~6/后1~6/文字1~6、组合框_计时自动加减热键
// H5 面板：320×300、rgba(0,0,0,0.7)、12px 圆角、标题24px、数字48px、礼物48px图、3.5s 轮转
export interface CountChallengeGift {
  name: string // 计数礼物N（组合框_计时_礼物N）
  delta: string // 增减数值N（如 +50 / -10；老字段，填了 before/after 时忽略）
  img: string // 礼物图本地路径
  // 原始组合框_计时_增减N：按“时间前/时间后”闭区间随机取值。
  op?: '加减' | '乘以' | '除以' | '范围' | '清零' | '加' | '减'
  before?: number // 编辑框_计时_时间前N（区间起点）
  after?: number // 编辑框_计时_时间后N（区间终点）
  text?: string // 编辑框_计时_文字N（挂件礼物行自定义文字，替代默认 ±Ns）
}
export interface CountChallengeHotkey {
  enabled: boolean
  func: string // 无/Alt/Ctrl/Ctrl+Alt/Shift
  key: string
  value: number // 热键数值（加减量）
}
export interface CountChallengeConfig {
  // 原版共用同一套 H5 挂件，但“计时”与“计数”是两套独立配置。
  // timer=编辑框_计时_*；counter=编辑框/组合框_计数_*。
  mode?: 'timer' | 'counter'
  // 槽位：原版「计数挑战」(插件配置计数) 与「加班器」(插件配置加班) 是两个独立插件，
  // 各占一个挂件窗口、各有自己的数值和礼物表，可以同时挂在屏幕上。
  slot?: 'challenge' | 'overtime'
  // 挑战样式（组合框_计数挑战样式 / 组合框_加班挑战样式）
  style?: string
  on: boolean
  title: string // 编辑框_计时_标题
  initial: number // 编辑框_计时_初始时间
  zeroText: string // 编辑框_计时_归零文字
  clockSpeed: number // 计时模式的时钟间隔（ms）
  clockOn: boolean // 时钟开启
  countColor: number // 文字颜色 7色索引
  third: string // 第三行文字
  pauseText: string // 暂停文字
  showRecord?: boolean // 选择框_加班显示记录：在暂停行显示本次礼物操作结果
  gifts: CountChallengeGift[] // 计时礼物或计数礼物1~6（由 mode 决定下行含义）
  giftShow: boolean // 礼物展示
  giftCount: number // 礼物数量 2/4/6
  showLock: boolean // 锁图标
  showNegative: boolean // 是否显示负数
  showSeconds: boolean // 是否显示秒数
  zeroHide: boolean // 归零隐藏
  pauseAdjust: boolean // 是否暂停加减
  pauseGift: string // 暂停加减礼物
  pauseTime: number // 暂停加减时间(秒)
  hotkeys: CountChallengeHotkey[] // 计数挑战热键1~4
  mouseEnabled?: boolean // 选择框_计数挑战_鼠标
  mouseAction?: '左键单击' // 组合框_计数挑战_热键功能键5
  mouseValue: number // 编辑框_计数挑战_鼠标数字
  bgColor: string // 背景色 #RRGGBB
  bgAlpha: number // 背景透明度 0~1
  bgTransparent: boolean
  posX: number
  posY: number
  // ===== 计数(28)组：四色分开配置（原版 7 色，缺省回落 countColor）=====
  titleColor?: number // 组合框_计数_文字颜色（标题/第三行）
  numColor?: number // 组合框_计数_数字颜色（大数字）
  giftNameColor?: number // 组合框_计数_礼物名称颜色
  deltaColor?: number // 组合框_计数_加减数字颜色
  // 自动加减：选择框_计数_自动加减 + 组合框_计数_自动速度 + 编辑框_计数_自动数字
  autoAdjust?: boolean
  autoSpeed?: number // 速度倍率 1=正常，2~10=X2~X10
  autoValue?: number // 每次 ±N
  autoToggleHotkey?: string // 组合框_计时自动加减热键：无/F1~F12
}

// 转盘/九宫格/幸运盘的礼物触发：autoSpin=收到礼物自动转；triggerGift 留空=任何礼物都触发。
// 配置由主进程常驻持有，页面关掉窗口照样转。
export interface LotteryTrigger {
  skin?: WidgetSkinId // 原版或成套挂件皮肤，不改变业务配置
  autoSpin: boolean
  triggerGift: string
  // 幸运转盘外圈灯珠：chase=转起来时灯跟着盘跑、抽中齐闪（默认）；blink=一直慢闪（老样子）；off=不闪
  bulbs?: LotteryBulbMode
  // 转动与抽中的声音；不配也有内置默认音
  sound?: LotterySound
  // 抽中要播的视频直接铺在转盘窗口里放（包括动作命令、导入项目随机挑的那种）。
  // 默认开：直播伴侣只采转盘这一个来源就够，转盘也不会被视频窗口挡在后面。
  stageVideo?: boolean
  // 空闲时不出现在直播画面里（窗口只输出纯底色），礼物触发抽奖才亮出来。默认开。
  idleHide?: boolean
  // 抽中之后画面还留几秒再收起来（配合 idleHide）。默认 6 秒。
  holdSeconds?: number
  // 中心图跟着触发礼物走：谁送什么礼物触发的，转盘中心就换成那个礼物的图
  // （礼物图库里没有这张图、或主播手动点「转起来」时，还是用固定的中心图）。默认开。
  centerGift?: boolean
}

export type LotteryBulbMode = 'chase' | 'blink' | 'off'

// 一条抽奖流水：什么时候抽的、抽中什么、是谁送礼物触发的
export interface LotteryDraw {
  id: string
  at: number // 时间戳
  kind: 'wheel' | 'nine'
  prize: string
  prizeImg?: string
  source: 'gift' | 'manual' | 'chain' // 礼物触发 / 主播手动 / 上一轮联动
  user?: string // 送礼物的观众
  gift?: string // 触发的礼物名
  action?: string // 抽中后执行的动作
}

export interface LotteryDrawSource {
  kind: 'gift' | 'manual' | 'chain'
  user?: string
  gift?: string
}

// 抽奖音效：preset=转盘实录（真转盘的哒哒声与中奖声）；chime=合成的电子音；custom=自己的文件；off=静音
export interface LotterySound {
  mode: 'preset' | 'chime' | 'custom' | 'off'
  spin?: string // 自定义转动音（循环播放到停）
  win?: string  // 自定义抽中音
  volume: number // 0~100
}

// 转盘/九宫格绿幕挂件窗口的奖项（复刻参考 H5：转盘扇形 / 九宫格 96×96 礼物图格）
export interface LotteryItem {
  name: string
  color: string
  img?: string // 礼物图（本地路径或 URL）
  // 抽中后执行的动作；空值只显示中奖结果，不执行动作。
  action?: LotteryAction
  actionParam?: string // effect=特效名；video/green-video=视频路径；countdown-adjust=秒数或范围
  actionSeconds?: number // 视频播放秒数，0=按视频自然结束
  // 抽中先播这段语音（「恭喜抽中一等奖」之类），在转盘窗口里出声，直播伴侣采得到
  voice?: string
  // 语音播完再执行动作；关掉就是语音和动作一起来。默认播完再执行。
  voiceWait?: boolean
  // 附加动作：抽中后按顺序接着执行（转盘/九宫格/时间盲盒共用）。
  // 2026-09-07 之前一个奖项只能配一个动作，主播想「播视频 + 加班 +30 秒」做不到。
  actions?: LotteryExtraAction[]
  // 这个奖项播的视频要不要走内置绿幕抠图（参数在设置页）。只对播视频/项目素材的动作有意义。
  chroma?: boolean
}

/** 奖项的附加动作。字段和主动作一样，另带一个「先等几秒」 */
export interface LotteryExtraAction {
  action: LotteryAction
  actionParam?: string
  actionSeconds?: number
  /** 执行前先等多少毫秒；0 = 紧跟上一个 */
  delayMs?: number
  /** 同上：这条动作播的视频要不要抠绿 */
  chroma?: boolean
}

export type LotteryAction =
  | 'none'
  | 'prank'
  | 'effect'
  | 'green-video'
  | 'video'
  | 'countdown-adjust'
  | 'countdown-clear'
  | 'wheel-spin'
  | 'nine-spin'
  // 就在转盘/九宫格自己的窗口里播视频：直播伴侣只要采这一个来源，不用再单独加视频窗口
  | 'stage-video'
  // ★万能出口：actionParam = '<动作命令>|<参数>'，把礼物规则那 30 多个动作命令
  //   （加班加减 / 计数 / 锁键盘 / 触发项目 / 随机视频…）整套接过来，
  //   转盘、九宫格、时间盲盒都能用，不必再各自补一遍。
  | 'command'

export type LotteryKind = 'wheel' | 'nine' | 'lucky'
export interface LotteryEvent {
  kind: 'wheel' | 'nine'
  id: string
  phase: 'started' | 'result' | 'error' | 'closed' | 'configured'
  index: number
  item?: LotteryItem
  items: LotteryItem[]
  duration: number
  startedAt: number
  queued: number
  error?: string
  // 这一轮转盘中心显示的图（跟着触发礼物走时是那个礼物的图；没跟就是固定中心图）
  center?: string
}

// 原版「高级转盘」固定 16 个扇区。图片路径、音效路径和脚本路径均保留为本地原始路径。
export interface AdvancedWheelOption {
  text: string
  bgColor: string
  textColor: string
  bgImage: string
  bgImageScale: number
  bgImageOffsetX: number
  bgImageOffsetY: number
  weight: number
  sound: string
  scriptCategory: string
  script: string
}

export interface AdvancedWheelConfig {
  source: 1 | 2
  // 原版可切换 10 / 12 / 14 / 16 个扇区，配置文件仍保留全部 16 个选项。
  sectorCount: 10 | 12 | 14 | 16
  options: AdvancedWheelOption[]
  centerImage: string
  centerScale: number
  spinSound: string
  triggerGift: string
  hotkey: string
  // 空闲时不出现在直播画面里（窗口只剩绿底），礼物或热键触发才亮出来。默认开。
  idleHide?: boolean
  // 抽中之后画面还留几秒再收起来。默认 6 秒。
  holdSeconds?: number
  // 没配自己的音效文件时用内置音（转动哒哒声 + 抽中上扬音）。默认开。
  builtinSound?: boolean
}

// 礼物心愿 A/B（复刻参考 H5 21_礼物心愿：两组 vote-box，每组若干心愿礼物，送满达成）
// 计数、达成动作全在主进程常驻，页面切走照样累计。
export interface WishItem {
  gift: string
  target: number
  count: number
  img?: string
  sound?: string // 达成时播的音效
  script?: string // 达成时执行的脚本/程序
  done?: boolean // 达成动作已触发（清零后重置）
}

export interface WishGroup {
  title: string
  wishes: WishItem[]
}

export interface WishConfig {
  skin?: WidgetSkinId // 原版或成套挂件皮肤，不改变业务配置
  groups: [WishGroup, WishGroup] // A / B 两组
  showB: boolean // 窗口是否显示 B 组
  autoAdd: boolean // 收到礼物自动累计
}

export interface WishWidgetState {
  open: boolean
  config: WishConfig
}

// 礼物积分进度条（复刻参考 H5 10_礼物积分进度条：指定礼物积分值、多目标里程碑执行脚本）
// count=每个礼物 1 分；diamond=按钻石价计分；table=按礼物积分表，表里没有的按 defaultScore
export type ProgressScoreMode = 'count' | 'diamond' | 'table'

export interface ProgressGiftScore {
  gift: string
  score: number
}

export interface ProgressMilestone {
  score: number
  note: string
  sound?: string // 达成时播的音效
  script?: string // 达成时执行的脚本/程序
}

export interface ProgressConfig {
  skin?: WidgetSkinId // 原版或成套挂件皮肤，不改变业务配置
  title: string
  target: number
  autoAdd: boolean
  scoreMode: ProgressScoreMode
  defaultScore: number
  giftScores: ProgressGiftScore[]
  milestones: ProgressMilestone[]
  resetOnTarget: boolean // 到达目标后自动清零重新累计
}

export interface ProgressState {
  open: boolean
  config: ProgressConfig
  score: number
  reached: number[] // 已触发过动作的里程碑分值（清零后重置）
}

// 键盘显示挂件：把主播按下的键鼠实时显示给观众（复刻参考「键盘显示」插件：卡通 / 专业两种样式）
export interface KeyboardWidgetConfig {
  style: 'cartoon' | 'pro' // cartoon=按下的键冒大键帽气泡；pro=整块键盘高亮
  theme: 'dark' | 'light' | 'neon' | WidgetSkinId
  showMouse: boolean
  keyScale: number // 键帽大小倍率
  fadeMs: number // 卡通样式：松开后键帽多久消失
  maxKeys: number // 卡通样式：最多同时显示几个键帽
  opacity: number // 整体透明度 0.2~1
  background: 'green' | 'transparent'
  width: number
  height: number
}

export interface KeyboardWidgetState {
  open: boolean
  config: KeyboardWidgetConfig
  hook: { running: boolean; error?: string; lastEventAt?: number; forwarded?: number; forwardError?: string }
  lock: { active: boolean; remainingMs: number; keys: string }
}

// 环境自检：开播前一键把 python/连接器/游戏/mod/服务器/OBS/权限/磁盘 都过一遍，出问题给可操作的提示
export type SelfCheckLevel = 'ok' | 'warn' | 'error'

export interface SelfCheckItem {
  id: string
  label: string
  level: SelfCheckLevel
  detail: string
  hint?: string
}

export interface SelfCheckResult {
  at: number
  version: string
  items: SelfCheckItem[]
}

// 礼物贴纸统计（复刻参考「礼物贴纸统计」：每款礼物累计次数）——主进程常驻累计，页面关着也记
// 礼物记录：谁送了什么（main/gift-log.ts 常驻记，留 30 天最多 3000 条）
export interface GiftLogRow {
  ts: number
  sender: string // 送礼人昵称；连接器没给就是空串
  gift: string
  count: number // 连击真实个数
  coins: number // 抖币合计 = 单价 × 个数（薄连接器不发单价时按内置礼物表补）
  image?: string // 礼物图本地路径（渲染层用 mediaUrl 转）
  sim?: boolean // 模拟事件造出来的（模拟模式连接器或互动工具的「模拟事件」），别当真礼物看
}

// 送礼榜一行（按送礼人聚合）
export interface GiftSenderRow {
  sender: string
  gifts: number
  coins: number
  last: number
}

export interface GiftLogState {
  rows: GiftLogRow[] // 最近的在前
  senders: GiftSenderRow[] // 抖币从高到低，前 50
  kept: number // 保留的记录条数
  total: number // 礼物总个数
  totalCoins: number
}

export interface StickerRow {
  name: string
  count: number
  image?: string
  last: number // 最近一次收到的时间戳
}

export interface StickerState {
  rows: StickerRow[] // 按次数从高到低
  total: number
  lastGift: string
  lastAt: number
}

// OBS 滤镜设置（复刻参考「滤镜设置」插件：OBS 目录 / 启动 OBS / 加载配置 / 脚本开关滤镜）
// 走 OBS 28+ 自带的 obs-websocket；未连接时从本机场景集合离线读滤镜列表
export interface ObsFilterInfo {
  source: string
  filter: string
  kind: string
  enabled: boolean
}

export interface ObsSettings {
  host: string
  port: number
  password: string
  autoConnect: boolean // 客户端启动、OBS 在跑时自动连
}

export interface ObsPanelState {
  local: {
    installDir: string
    exePath: string
    running: boolean
    configFound: boolean
    wsEnabled: boolean
    wsPort: number
    wsAuthRequired: boolean
    wsHasPassword: boolean
    configPath: string
  }
  connection: {
    connected: boolean
    host: string
    port: number
    version?: string
    wsVersion?: string
    error?: string
  }
  settings: ObsSettings
  filters: ObsFilterInfo[]
  scenes: { current: string; scenes: string[] }
  source: 'live' | 'offline' // 滤镜/场景列表来自实时 OBS 还是离线场景集合
}

/** 抖音直播伴侣本机状态；启动只打开桌面程序，不会开始直播。 */
export interface LiveCompanionStatus {
  installed: boolean
  running: boolean
  installDir: string | null
  configRoot: string | null
  outputs?: { title: string; width: number; height: number }[] // 已打开输出，不代表已被直播伴侣采集
}

// 飘屏：礼物/弹幕滚动显示。外观全部可调（复刻「文字开启/礼物开启」并加上主播真正会改的那些）
export type MarqueePosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
export type MarqueeStyle = 'pill' | 'danmu' | 'neon' | WidgetSkinId

export interface MarqueeConfig {
  giftOn: boolean
  chatOn: boolean
  gifts: string[]
  chatKeywords: string
  followOn?: boolean // 关注也飘（「xxx 关注了主播」）
  memberOn?: boolean // 进场也飘
  style?: MarqueeStyle // pill=黑底胶囊 / danmu=纯文字描边（弹幕感）/ neon=霓虹
  fontSize?: number // 字号 px
  color?: string // 文字颜色
  bgOpacity?: number // 底色不透明度 0~1（pill 样式）
  keepMs?: number // 每条停留毫秒
  maxLines?: number // 最多同时显示几条
  showImage?: boolean // 显示礼物图/头像
  position?: MarqueePosition // 窗口贴在屏幕哪个角
  width?: number
  height?: number
  giftTemplate?: string // 礼物文案模板：{name} {gift} {count}
  chatTemplate?: string // 弹幕文案模板：{name} {text}
}

// 礼物动画挂件：5 种特效共用一个绿幕/透明窗口，礼物→特效映射由主进程常驻持有
export type EffectKind = 'parabola' | 'bomb' | 'car' | 'firework' | 'rain'

export interface EffectRule {
  gift: string
  effect: EffectKind
}

export interface EffectsConfig {
  autoPlay: boolean // 收到礼物自动播放
  defaultEffect: EffectKind | 'none' // 没单独指定的礼物用哪种特效；none=不播
  rules: EffectRule[] // 指定礼物 → 特效
  minDiamond: number // 只对钻石价 ≥ N 的礼物播；0=全部
  imageSize: number // 礼物图尺寸（px）
  countCap: number // 单次礼物出图上限（掉落/炸弹按个数出图，防卡）
  speed: number // 动画速度倍率
  showText: boolean // 显示「谁送出了什么」
  background: 'green' | 'transparent'
  width: number
  height: number
  // 连击：同一个人短时间内连送同一礼物，屏幕上叠出「×N 连击」并越叠越大；0=关
  comboSeconds: number
}

// 视频播放器配置（主 / VIP 两个独立播放窗口）
export type VideoWidgetSlot = 'main' | 'vip'

export interface VideoWidgetConfig {
  path: string
  loop: boolean
  muted: boolean
  volume: number // 0~1
  topMost: boolean
  width: number
  height: number
  bgColor: string // #RRGGBB
  // 主 / VIP 窗口；不填=主
  slot?: VideoWidgetSlot
  // 窗口位置（屏幕坐标）；不填或 0,0 = 居中
  x?: number
  y?: number
  // 播完自动关窗口（进场视频/礼物触发的一次性视频用）
  autoClose?: boolean
  // 最长播几秒后强制关（0=不限制，播完为止）
  maxSeconds?: number
  // 这个视频要不要走内置绿幕抠图（参数在设置页）
  chroma?: boolean
}

export interface VideoWidgetState {
  open: boolean
  main: boolean
  vip: boolean
  mainBounds?: { x: number; y: number; width: number; height: number }
  vipBounds?: { x: number; y: number; width: number; height: number }
}

// 绿幕窗口 1～4
export type GreenScreenSlot = 1 | 2 | 3 | 4

export interface GreenScreenState {
  open: boolean
  slots: { slot: GreenScreenSlot; open: boolean; src: string; type: 'video' | 'image'; text: string }[]
  // 还在排队等窗口的素材条数（视频窗口自动排队）
  queued?: number
  // 看门狗处理过的视频：撤掉的 / 推醒的次数（本次运行累计）
  rescued?: number
  nudged?: number
  // 每个正在播的非循环视频的看门狗读数（排查「卡住」用）
  watchdog?: Record<string, { time: number; idleMs: number; nudges: number; ready: number }>
}

// 大哥进场：观众进直播间时按规则播欢迎横幅 / 视频 / 音效
// （复刻参考「大哥进场」插件：进场规则 / 内容 / 视频播放窗口 / 视频文件 / 去重）
export type EntranceMatch = 'any' | 'equals' | 'contains'
// 横幅皮肤：3 款经典 + 通用皮肤 + 高能进场特效；规则里可选，空 = 跟全局
export type EntranceBannerStyle = 'gold' | 'neon' | 'clean' | WidgetSkinId | EntranceEffectId

export interface EntranceRule {
  id: string
  enabled: boolean
  match: EntranceMatch // any=任何人；equals=昵称等于；contains=昵称包含
  name: string // 匹配用的昵称 / 关键词
  text: string // 横幅文案，{name} 会换成观众昵称
  video: string // 进场视频文件；空=不放
  videoWindow: 'video' | 'green' // 视频放到视频播放器窗口还是绿幕窗口
  sound: string // 进场音效；空=不放
  dedupeSeconds: number // 同一观众多少秒内只触发一次；0=每次进场都触发
  // 从「已出现的观众」下拉里选的人：头像（连接器缓存的本地路径或 URL）和观众 id（连接器给了才有）。
  // 手填昵称的老规则没有这两项；进场事件自带头像时以事件为准，没有才用这里存的。
  avatar?: string
  uid?: string
  // 这条规则专属的横幅皮肤（给某个大哥单独一套进场样式）；不填 = 跟全局 bannerStyle
  bannerStyle?: EntranceBannerStyle
}

// 已出现的观众（大哥进场下拉用）：只来自本机记录——送礼/进场/弹幕/关注/点赞过的人和连接器缓存的头像，
// 不是抖音粉丝列表，也不抓取任何账号数据。
export interface ViewerRow {
  name: string
  uid?: string // 连接器给的观众 id；文本协议不带，多数为空
  avatar?: string // 本地缓存路径或 URL；空=还没缓存到
  lastSeen: number
  seen: number // 出现次数
  sim?: boolean // 模拟事件造的
}

export interface ViewerListResult {
  rows: ViewerRow[] // 最近出现的在前
  total: number
}

export interface EntranceConfig {
  enabled: boolean
  rules: EntranceRule[]
  bannerSeconds: number // 横幅停留秒数
  bannerStyle: EntranceBannerStyle
  bannerPosition: 'top' | 'center' | 'bottom'
  bannerWidth: number
  bannerHeight: number
  videoSeconds: number // 进场视频最长播几秒；0=播完为止
}

export interface EntranceRecent {
  name: string
  ts: number
  rule: string // 命中的规则文案（没命中=空）
}

export interface EntranceState {
  open: boolean
  config: EntranceConfig
  recent: EntranceRecent[]
}

// ============ 公告 ============

export interface NewsItem {
  id: string
  title: string
  date: string
  category: '发布' | '公告' | '修复'
  content: string
}

// ============ 更新 ============

export type UpdateState =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface UpdateStatusPayload {
  state: UpdateState
  detail?: string
  progress?: number // downloading 时的下载百分比
  silent?: boolean // 后台自动检查/下载，不弹更新窗口
}

export interface UpdateCheckResult {
  ok: boolean
  error?: string
}

/** 一个文件夹里的绿幕素材（视频/图片） */
export interface MediaFileInfo {
  name: string
  path: string
  type: 'video' | 'image'
  size: number
}

/** 品游式「项目」：一个文件夹一个项目，里面是「视频 + 同名 .脚本」成对 */
/** 项目里单条视频在整蛊台配的动作（存客户端 data/pinyou-item-actions.json，按项目目录 + 条目名，不动素材文件夹） */
export interface PinyouItemActions {
  /** 抽到这条视频时，播完视频、跑完品游脚本后按顺序执行（和规则附加动作同一套：可先等几秒） */
  actions: EntertainmentAction[]
  /** 视频旁边的品游 .脚本 还跑不跑；默认跑，关掉 = 只跑整蛊台里配的 */
  useScript?: boolean
}
/** 项目里的一条视频（给「配动作」列表看的） */
export interface PinyouProjectItem {
  name: string
  video: string
  hasScript: boolean
  /** 品游脚本里的动作摘要（中文名 + 参数），没脚本为空 */
  script: string[]
}

export interface PinyouProjectInfo {
  name: string
  dir: string
  videos: number
  scripts: number
  /** 视频里有同名脚本的条数；0 = 纯视频项目（只播视频，没有附加动作） */
  paired: number
}

/** 关于本机这一份客户端：版本号给主播报障用，运行环境给我们查兼容问题用 */
export interface AppVersionInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  osVersion: string
  packaged: boolean
}

// ============ IPC 通道 ============

export const Ipc = {
  AuthRegister: 'auth:register',
  AuthLogin: 'auth:login',
  AuthLogout: 'auth:logout',
  AuthSession: 'auth:session',
  AuthBindRoom: 'auth:bind-room',
  AuthUnbindRoom: 'auth:unbind-room',
  AuthDeleteAccount: 'auth:delete-account',
  AuthListAccounts: 'auth:list-accounts',
  AuthUpdateAvatar: 'auth:update-avatar',
  CredLoad: 'cred:load',
  CredUser: 'cred:user',
  CredSave: 'cred:save',
  CredClearLast: 'cred:clear-last',
  CredClearUser: 'cred:clear-user',
  RoomBindWithLicense: 'room:bind-with-license',
  RoomLookup: 'room:lookup',
  RoomSubmitApply: 'room:submit-apply',
  RoomCancelApply: 'room:cancel-apply',
  RoomAutoBound: 'room:auto-bound',
  RoomUnbindReport: 'room:unbind-report',
  RoomSyncEmail: 'room:sync-email',
  RoomsSynced: 'room:rooms-synced',
  EmailSendCode: 'email:send-code',
  EmailRegister: 'email:register',
  EmailLogin: 'email:login',
  EmailReset: 'email:reset',
  EmailGetLicense: 'email:get-license',
  EmailGameApply: 'email:game-apply',
  EmailNotifyList: 'email:notify-list',
  EmailNotifyRead: 'email:notify-read',
  EmailNotifyReadAll: 'email:notify-read-all',
  EmailConfigSave: 'email:config-save',
  EmailConfigLoad: 'email:config-load',
  EmailBuyContact: 'email:buy-contact',
  NotifyNew: 'notify:new',
  MemoryGuardProbe: 'memory:guard-probe',
  MediaOptimizeState: 'media:optimize-state',
  LiveStats: 'live:stats',
  StatsPrankTick: 'stats:prank-tick',
  ModsList: 'mods:list',
  ModsInstall: 'mods:install',
  ModsUninstall: 'mods:uninstall',
  ModsHealth: 'mods:health',
  ModsRepair: 'mods:repair',
  ModsDiagnose: 'mods:diagnose',
  ModsDiagnoseUpload: 'mods:diagnose-upload',
  ModsInstallProgress: 'mods:install-progress',
  ConfigRead: 'config:read',
  ConfigSave: 'config:save',
  ConfigPranks: 'config:pranks',
  /** 全部游戏的整蛊菜单（按分组），渲染层启动时拉一次；定义包从更新源刷新后主进程会广播 PrankCatalogChanged */
  PrankCatalog: 'pranks:catalog',
  PrankCatalogChanged: 'pranks:catalog-changed',
  GameLaunch: 'game:launch',
  GameState: 'game:state',
  GameDetectPath: 'game:detect-path',
  GameDetectAll: 'game:detect-all',
  GameSetPath: 'game:set-path',
  GamesList: 'games:list',
  GameSetCurrent: 'game:set-current',
  LiveSet: 'live:set',
  LivePrank: 'live:prank',
  LiveCmd: 'live:cmd',
  LiveState: 'live:state',
  GiftImagesSync: 'gifts:sync-images',
  ConnectorStart: 'connector:start',
  ConnectorStop: 'connector:stop',
  ConnectorState: 'connector:state',
  ConnectorSend: 'connector:send',
  ConnectorLog: 'connector:log',
  ConnectorEvent: 'connector:event',
  ConnectorSimulate: 'connector:simulate',
  EntertainmentSound: 'ent:sound',
  AnnouncePlay: 'announce:play',
  AppNotice: 'app:notice',
  AnnounceConfig: 'announce:config',
  AnnounceConfigure: 'announce:configure',
  AnnouncePreview: 'announce:preview',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  NewsList: 'news:list',
  UpdateCheck: 'update:check',
  AppVersion: 'app:version',
  PinyouProjects: 'pinyou:projects',
  PinyouAssetRootPick: 'pinyou:asset-root-pick',
  PinyouProjectTest: 'pinyou:project-test',
  PinyouProjectsImport: 'pinyou:projects-import',
  PinyouItemsImport: 'pinyou:items-import',
  PinyouTimeImport: 'pinyou:time-import',
  PinyouRelocateRules: 'pinyou:relocate-rules',
  PinyouItemActionsGet: 'pinyou:item-actions-get',
  PinyouItemActionsSet: 'pinyou:item-actions-set',
  ProjectExport: 'project:export',
  ProjectImportFolder: 'project:import-folder',
  ProjectCreate: 'project:create',
  EntertainmentGroupToggle: 'ent:group-toggle',
  EntertainmentPresetList: 'ent:preset-list',
  EntertainmentPresetSave: 'ent:preset-save',
  EntertainmentPresetRemove: 'ent:preset-remove',
  EntertainmentPresetApply: 'ent:preset-apply',
  MediaList: 'media:list',
  MediaFolderPick: 'media:folder-pick',
  UpdateStatus: 'update:status',
  UpdateDownload: 'update:download',
  UpdateInstall: 'update:install',
  DialogSelect: 'dialog:select',
  WindowMinimize: 'window:minimize',
  WindowMaximizeToggle: 'window:maximize-toggle',
  WindowMaximized: 'window:maximized',
  WindowSetAlwaysOnTop: 'window:set-always-on-top',
  WindowResize: 'window:resize',
  WindowClose: 'window:close',
  EntertainmentRulesList: 'ent:rules-list',
  EntertainmentRuleAdd: 'ent:rule-add',
  EntertainmentRuleUpdate: 'ent:rule-update',
  EntertainmentRuleRemove: 'ent:rule-remove',
  EntertainmentSendKeys: 'ent:send-keys',
  EntertainmentSystemAction: 'ent:system-action',
  EntertainmentListGiftImages: 'ent:gift-images',
  EntertainmentListImageFiles: 'ent:image-files',
  EntertainmentTransparentImport: 'ent:transparent-import',
  EntertainmentTransparentExport: 'ent:transparent-export',
  EntertainmentPinyouImport: 'ent:pinyou-import',
  EntertainmentPinyouApply: 'ent:pinyou-apply',
  EntertainmentRunScript: 'ent:run-script',
  EntertainmentSavePng: 'ent:save-png',
  EntertainmentCopyImage: 'ent:copy-image',
  TimeWidgetLog: 'time:log',
  TimeWidgetLogClear: 'time:log-clear',
  TimeWidgetTestGift: 'time:test-gift',
  TimeWidgetTestEvent: 'time:test-event',
  TimeWidgetCancelQueue: 'time:cancel-queue',
  EntertainmentMouse: 'ent:mouse',
  EntertainmentSendText: 'ent:send-text',
  EntertainmentCommand: 'ent:command',
  DanmakuForwardStart: 'ent:forward-start',
  DanmakuForwardStop: 'ent:forward-stop',
  DanmakuForwardState: 'ent:forward-state',
  DanmakuForwardPublish: 'ent:forward-publish',
  GreenScreenOpen: 'ent:green-open',
  GreenScreenClose: 'ent:green-close',
  GreenScreenState: 'ent:green-state',
  GreenScreenResize: 'ent:green-resize',
  OutputWindowResize: 'ent:output-resize',
  OutputWindowSize: 'ent:output-size',
  TimeWidgetOpen: 'ent:time-open',
  TimeWidgetClose: 'ent:time-close',
  TimeWidgetState: 'ent:time-state',
  TimeWidgetUpdate: 'ent:time-update',
  TimeWidgetAdjust: 'ent:time-adjust',
  TimeWidgetClear: 'ent:time-clear',
  TimeWidgetPause: 'ent:time-pause',
  TimeWidgetShowGift: 'ent:time-show-gift',
  TimeLogOpen: 'ent:time-log-open',
  TimeLogClose: 'ent:time-log-close',
  TimeLogState: 'ent:time-log-state',
  MarqueeOpen: 'ent:marquee-open',
  MarqueeConfigure: 'ent:marquee-configure',
  MarqueeClose: 'ent:marquee-close',
  MarqueeState: 'ent:marquee-state',
  MarqueeSend: 'ent:marquee-send',
  ChallengeOpen: 'ent:challenge-open',
  ChallengeUpdate: 'ent:challenge-update',
  ChallengeClose: 'ent:challenge-close',
  ChallengeState: 'ent:challenge-state',
  ChallengeAdjust: 'ent:challenge-adjust',
  ChallengeApplyGift: 'ent:challenge-apply-gift',
  ChallengePause: 'ent:challenge-pause',
  OpenPath: 'app:open-path',
  ListFontFiles: 'ent:list-font-files',
  VideoWidgetOpen: 'ent:video-open',
  VideoWidgetClose: 'ent:video-close',
  VideoWidgetState: 'ent:video-state',
  LotteryOpen: 'ent:lottery-open',
  LotteryConfigure: 'ent:lottery-configure',
  LotteryClose: 'ent:lottery-close',
  LotterySpin: 'ent:lottery-spin',
  LotteryState: 'ent:lottery-state',
  LotteryHistory: 'ent:lottery-history',
  LotteryHistoryClear: 'ent:lottery-history-clear',
  LotteryEvent: 'ent:lottery-event',
  AdvancedWheelOpen: 'ent:advanced-wheel-open',
  AdvancedWheelClose: 'ent:advanced-wheel-close',
  AdvancedWheelSpin: 'ent:advanced-wheel-spin',
  AdvancedWheelUpdate: 'ent:advanced-wheel-update',
  AdvancedWheelState: 'ent:advanced-wheel-state',
  AdvancedWheelImport: 'ent:advanced-wheel-import',
  AdvancedWheelExport: 'ent:advanced-wheel-export',
  ProgressOpen: 'ent:progress-open',
  ProgressClose: 'ent:progress-close',
  ProgressConfigure: 'ent:progress-configure',
  ProgressAdjust: 'ent:progress-adjust',
  ProgressReset: 'ent:progress-reset',
  ProgressState: 'ent:progress-state',
  ProgressChanged: 'ent:progress-changed',
  KeyboardOpen: 'ent:keyboard-open',
  KeyboardClose: 'ent:keyboard-close',
  KeyboardConfigure: 'ent:keyboard-configure',
  KeyboardState: 'ent:keyboard-state',
  ObsState: 'ent:obs-state',
  ObsConnect: 'ent:obs-connect',
  ObsDisconnect: 'ent:obs-disconnect',
  ObsConfigure: 'ent:obs-configure',
  ObsRefresh: 'ent:obs-refresh',
  ObsSetFilter: 'ent:obs-set-filter',
  ObsSetScene: 'ent:obs-set-scene',
  ObsLaunch: 'ent:obs-launch',
  ObsEnableServer: 'ent:obs-enable-server',
  ObsChanged: 'ent:obs-changed',
  LiveCompanionState: 'ent:live-companion-state',
  LiveCompanionLaunch: 'ent:live-companion-launch',
  LiveCompanionDirectory: 'ent:live-companion-directory',
  ProtectWidgetOpen: 'ent:protect-open',
  ProtectWidgetClose: 'ent:protect-close',
  EntertainmentRulesPause: 'ent:rules-pause',
  EntertainmentProtectState: 'ent:protect-state',
  AppRelaunchElevated: 'app:relaunch-elevated',
  AppSelfCheck: 'app:self-check',
  AppReportError: 'app:report-error',
  AppOpenLogs: 'app:open-logs',
  GiftLogState: 'gift-log:state',
  GiftLogClear: 'gift-log:clear',
  GiftLogChanged: 'gift-log:changed',
  StickerState: 'ent:sticker-state',
  StickerReset: 'ent:sticker-reset',
  StickerImport: 'ent:sticker-import',
  StickerChanged: 'ent:sticker-changed',
  EffectsOpen: 'ent:effects-open',
  EffectsConfigure: 'ent:effects-configure',
  EffectsClose: 'ent:effects-close',
  EffectsFire: 'ent:effects-fire',
  EffectsState: 'ent:effects-state',
  SpecialWindowOpen: 'special:window-open',
  SpecialWindowClose: 'special:window-close',
  SpecialWindowConfigure: 'special:window-configure',
  SpecialConfigure: 'special:configure',
  SpecialState: 'special:state',
  SpecialTest: 'special:test',
  SpecialFire: 'special:fire',
  SpecialStats: 'special:stats',
  SpecialClearAll: 'special:clear-all',
  SpecialBoxEvents: 'special:box-events',
  SpecialBoxEventsSave: 'special:box-events-save',
  SpecialBoxEventTest: 'special:box-event-test',
  SpecialBoxDraw: 'special:box-draw',
  SpecialRevealConfigure: 'special:reveal-configure',
  SpecialVoicePreview: 'special:voice-preview',
  SpecialBoxImportVideos: 'special:box-import-videos',
  SpecialCloseAll: 'special:close-all',
  SpecialChanged: 'special:changed',
  EntranceOpen: 'ent:entrance-open',
  EntranceClose: 'ent:entrance-close',
  EntranceConfigure: 'ent:entrance-configure',
  EntranceState: 'ent:entrance-state',
  EntranceTest: 'ent:entrance-test',
  EntranceChanged: 'ent:entrance-changed',
  ViewerList: 'ent:viewer-list',
  EmojiAssets: 'ent:emoji-assets',
  QueueOpen: 'ent:queue-open',
  QueueClose: 'ent:queue-close',
  QueueConfigure: 'ent:queue-configure',
  QueueState: 'ent:queue-state',
  QueueClear: 'ent:queue-clear',
  QueueSkip: 'ent:queue-skip',
  QueueChanged: 'ent:queue-changed',
  WishOpen: 'ent:wish-open',
  WishClose: 'ent:wish-close',
  WishConfigure: 'ent:wish-configure',
  WishReset: 'ent:wish-reset',
  WishState: 'ent:wish-state',
  WishChanged: 'ent:wish-changed',
  CardState: 'card:state',
  CardRedeem: 'card:redeem',
  CardOpenPlatform: 'card:open-platform',
  CardLicenseRequired: 'card:license-required',
  CardRooms: 'card:rooms',
  CardRoomVerify: 'card:room-verify',
  CardRoomCommit: 'card:room-commit',
  CardAdoptDefault: 'card:adopt-default'
} as const

export type IpcChannel = (typeof Ipc)[keyof typeof Ipc]
