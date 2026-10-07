// 特色整蛊 · 玩法元数据（主进程与渲染层共享）
//
// 每个玩法 = 一个绿幕/透明叠加层小游戏，架在现有采集窗口体系上（参考 effects-widget.ts）：
// 默认关、开哪个才有哪个窗口、无活动自停 rAF。美术/音效素材在 assets/special-games/（不进 git）。
//
// 本文件只放「元数据 + 可调参数规格 + 动作参数的拆合」，不含任何窗口/Canvas 代码——渲染层据此通用渲染
// 卡片与旋钮，主进程据此夹紧配置。玩法的 Canvas 代码在 src/main/special-games/<id>.ts（只有主进程 import）。
// ★本文件不许有运行时 import：entertainmentLabels.ts 要引它，那份又被 tools 里的脚本直接引用。
//
// 触发模型（对齐参考软件「🎪特色玩法」动作模块）：玩法本身不认礼物——礼物/关注/点赞/弹幕/转盘/九宫格/
// 时间盲盒都走娱乐助手的动作体系，动作命令 `special-play`，参数 `玩法|操作|数量|选项`
// （见 parseSpecialParam）。执行时给玩法页面下发一条标准化命令：
//   { operation, count, username, avatar, gift, size?, kind?, color?, test? }
// 礼物通常「生成目标 / 推进计数」，主播再用鼠标/空格/麦克风把互动「完成」。

export type SpecialGameId =
  | 'chain_challenge'
  | 'catch_duck'
  | 'throw_poop'
  | 'throw_trash'
  | 'catch_bullet'
  | 'caterpillar'
  | 'xiaoxin_hey'
  | 'fan_call'
  | 'fan_video_call'
  | 'talisman_seal'
  | 'mosquito'
  | 'big_mosquito'
  | 'gesture_fly'
  | 'fruit_slice'
  | 'coin_bump'
  | 'leaf_pickup'
  | 'music_ball'

/** 一个可调项的规格：渲染层据此通用生成控件，主进程据此夹紧。 */
export interface SpecialParamSpec {
  key: string
  label: string
  /**
   * 控件类型：
   * - file：单个本地文件（fileKind 决定选择框的过滤），留空 = 用内置素材
   * - files：多个本地文件（值是换行分隔的路径串），每次随机挑一个，留空 = 用内置素材
   * - device：麦克风（值是设备名，留空 = 系统默认；设备 id 跨页面不通用，所以按名字认）
   */
  type: 'number' | 'toggle' | 'select' | 'color' | 'text' | 'file' | 'files' | 'device'
  /** number：范围与步进（也是防爆夹紧的上下限） */
  min?: number
  max?: number
  step?: number
  /** number：显示单位（纯 UI） */
  unit?: string
  /** select：候选项 */
  options?: { value: string; label: string }[]
  /** select：每个候选项的预览图（素材目录相对路径），有就用带图的卡片来选（皮肤之类） */
  optionImages?: Record<string, string>
  /** file / files：选什么文件 */
  fileKind?: 'image' | 'audio' | 'video'
  /** 默认值 */
  def: number | string | boolean
  /** 一句话说明「这是什么」（不写实现细节） */
  hint?: string
  /** 高级旋钮：基础模式自动折叠 */
  advanced?: boolean
  /** 分组：界面按组摆放（缺省 = 玩法） */
  group?: 'play' | 'look' | 'sound' | 'media'
}

/** 动作里的一种操作（增加 / 减少 / 清空 …） */
export interface SpecialOpSpec {
  value: string
  label: string
  /** 标签里的符号：+ − × ÷；没有就用 label */
  sign?: string
  /** 这个操作要不要数量（清空 / 停止之类不要） */
  count?: boolean
  /** 数量这一栏叫什么（乘除叫「倍数」） */
  countLabel?: string
  /** 一句话说明 */
  hint?: string
}

/** 动作里的附加选项（大小 / 种类 / 颜色），每次触发可以单独指定 */
export interface SpecialActionField {
  key: 'size' | 'kind' | 'color'
  label: string
  def: string
  options: { value: string; label: string }[]
}

/** 主播怎么完成互动（卡片角标 + 筛选） */
export type SpecialCategory = 'click' | 'drag' | 'swipe' | 'voice' | 'show'

export const SPECIAL_CATEGORY_LABELS: Record<SpecialCategory, string> = {
  click: '鼠标点击',
  drag: '鼠标拖动',
  swipe: '鼠标挥动',
  voice: '声控',
  show: '自动播放'
}

export interface SpecialGameMeta {
  id: SpecialGameId
  name: string
  emoji: string
  /** 卡片副标题：一句话说清玩什么 */
  desc: string
  /** 详情页：主播在直播里怎么玩 */
  how: string
  category: SpecialCategory
  /** 需要主播用鼠标点/拖才能完成互动（画布接收点击） */
  interactive: boolean
  /**
   * 点画面任意处都算（锁链挣脱）：同一个窗口里别的玩法也在，这种玩法只拿「没点中别的东西、也没拖动」的那一下，
   * 免得点鸭子顺手把锁链也挣开一环。点中目标才算的玩法（鸭子、虫子、来电按钮…）不用标。
   */
  pointerAnywhere?: boolean
  /** 单独预览时的画面尺寸（直播窗口的尺寸是全部玩法共用的，见 SpecialWindowConfig） */
  width: number
  height: number
  /** 卡片预览主色（卡片底色） */
  tint: string
  /** 数量的量词（只 / 个 / 件 …） */
  unit: string
  /** 盲盒开奖配音里怎么叫它（「锁链加5」的「锁链」）；没有 = 开出来不念（来电、音乐球这种没数量的） */
  say?: string
  /** 数量的常用值（固定数量时的默认、试玩的默认） */
  countDef: number
  /** 新建联动时默认的随机范围（「a~b」，每次触发在范围里随机）；不给就用固定的 countDef */
  countRange?: string
  /** 支持的操作，第一项是默认操作 */
  ops: SpecialOpSpec[]
  /** 每次触发可单独选的选项 */
  fields?: SpecialActionField[]
  /** 可调参数（玩法专属，通用 speed/countCap 在公共配置里） */
  params: SpecialParamSpec[]
  /** 累计统计的名字（有累计数的玩法才有，如「累计抓到」） */
  statLabel?: string
}

// 每个玩法自己的可调项：速度、在场上限、玩法专属参数。窗口的尺寸/底色/自动开窗是全部玩法共用的（SpecialWindowConfig）。
export interface SpecialGameConfig {
  /** 全局速度倍率 0.25~8 */
  speed: number
  /** 一次触发最多生成多少；0 = 不限（数量很多会更吃性能，弱机可自己设一个值） */
  countCap: number
  /** 玩法专属参数值 */
  params: Record<string, number | string | boolean>
}

// ================= 直播窗口：全部玩法共用一个 =================
// 2026-10-05 用户：「那么多窗口好麻烦，都是全屏特效一个窗口就行；功能还是各是各的，只不过都在一个绿幕窗口」。
// 17 个玩法同在窗口「特色整蛊」里，各自一层画布、各自的设置和互动；直播伴侣只加一次窗口采集。
export const SPECIAL_WINDOW_TITLE = '特色整蛊'
export interface SpecialWindowConfig {
  /** 联动触发时窗口没开就自动打开（关掉 = 窗口没开时忽略触发） */
  autoOpen: boolean
  /** 底色：绿幕（直播伴侣抠绿）或透明（OBS 直接叠） */
  background: 'green' | 'transparent'
  width: number
  height: number
  /**
   * 动画帧率上限，0 = 跟显示器。透明 / 绿幕窗口每画一帧都要整窗刷新（客户端主进程也跟着忙），
   * 直播推流一般就 30 帧，默认画到 30 帧（2026-10-07 用户：「整蛊台内操作的时候有点点卡」）。
   */
  fps: number
}
export const DEFAULT_SPECIAL_WINDOW: SpecialWindowConfig = { autoOpen: true, background: 'green', width: 1280, height: 720, fps: 30 }
export const SPECIAL_FPS_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 帧（和直播一样，省电脑）' },
  { value: 60, label: '60 帧（更顺滑）' },
  { value: 0, label: '跟显示器刷新率' }
]

/**
 * 图层顺序（下 → 上）。一会儿就自己挂断的来电 / 来视频放最上面（用户：「打视频那种要在最前，因为一会儿就没了」）；
 * 锁链、符咒是「封住屏幕」的，压在小东西上面；音乐球的轨道、地上的叶子铺在最底下。
 * 点击也按这个顺序从上往下找：最上面点中东西的那个玩法接住这一下。
 */
export const SPECIAL_LAYER_ORDER: SpecialGameId[] = [
  'music_ball', 'leaf_pickup', 'coin_bump', 'caterpillar', 'xiaoxin_hey', 'catch_duck', 'catch_bullet', 'fruit_slice',
  'throw_trash', 'throw_poop', 'mosquito', 'big_mosquito', 'gesture_fly', 'talisman_seal', 'chain_challenge', 'fan_call', 'fan_video_call'
]

export interface SpecialGameStateItem {
  id: SpecialGameId
  config: SpecialGameConfig
}
export interface SpecialGameplayState {
  games: SpecialGameStateItem[]
  /** 直播窗口（全部玩法共用） */
  window: SpecialWindowConfig & { open: boolean }
  /** 盲盒开奖画面与配音 */
  reveal: SpecialRevealConfig
  /** 素材目录（卡片缩略图 / 预览用）；找不到素材时为空 */
  assetDir: string
}

/** 触发这次动作的观众（礼物规则从连接器事件带过来；转盘/盲盒等没有就空着） */
export interface SpecialViewer {
  name?: string
  avatar?: string
  gift?: string
}

/** 「试一试 / 预览」下发的动作（数量已经是确定的整数） */
export interface SpecialTestAction {
  op?: string
  count?: number
  fields?: Record<string, string>
}

// —— 公共选项表 ——
const SIZE_FIELD: SpecialActionField = {
  key: 'size',
  label: '大小',
  def: 'random',
  options: [
    { value: 'random', label: '随机大小' },
    { value: 'big', label: '大号' },
    { value: 'small', label: '小号' }
  ]
}

// 毛毛虫九色表
const CATERPILLAR_COLORS = [
  { value: 'green', label: '绿色' }, { value: 'red', label: '红色' }, { value: 'orange', label: '橙色' },
  { value: 'yellow', label: '黄色' }, { value: 'cyan', label: '青色' }, { value: 'blue', label: '蓝色' },
  { value: 'purple', label: '紫色' }, { value: 'pink', label: '粉色' }, { value: 'white', label: '白色' }
]

// 垃圾 30 种（id 与素材文件名一致）
export const TRASH_KINDS: { value: string; label: string }[] = [
  { value: 'cola_plastic', label: '可乐塑料瓶' }, { value: 'cola_glass', label: '可乐玻璃瓶' }, { value: 'water_bottle', label: '矿泉水瓶' },
  { value: 'beer_can', label: '啤酒易拉罐' }, { value: 'old_shoe', label: '旧运动鞋' }, { value: 'snack_wrapper', label: '零食包装' },
  { value: 'food_package', label: '食品包装盒' }, { value: 'chocolate_bar', label: '巧克力块' }, { value: 'crackers', label: '剩余小饼干' },
  { value: 'oreo_cookies', label: '夹心饼干' }, { value: 'burger', label: '剩余汉堡' }, { value: 'fish_burger', label: '鱼排汉堡' },
  { value: 'pizza', label: '剩余披萨' }, { value: 'fried_egg', label: '剩余煎蛋' }, { value: 'egg', label: '鸡蛋' },
  { value: 'broccoli_stem', label: '西兰花菜梗' }, { value: 'vegetable_scraps', label: '蔬菜边角料' }, { value: 'dried_banana', label: '香蕉片' },
  { value: 'bell_pepper', label: '彩椒' }, { value: 'avocado', label: '牛油果' }, { value: 'ginger_root', label: '姜块' },
  { value: 'tofu_piece', label: '豆腐块' }, { value: 'bread_slice', label: '剩余面包' }, { value: 'cookie', label: '曲奇饼' },
  { value: 'marshmallow', label: '棉花糖' }, { value: 'chocolate_candy', label: '巧克力糖' }, { value: 'jelly_candy', label: '软糖' },
  { value: 'raffaello', label: '椰蓉糖' }, { value: 'kinder_bueno', label: '巧克力零食' }, { value: 'assorted_candies', label: '剩余糖果' }
]

// 水果 10 种（id 与素材文件名一致）
export const FRUIT_KINDS: { value: string; label: string }[] = [
  { value: 'apple', label: '苹果' }, { value: 'orange', label: '橙子' }, { value: 'watermelon', label: '西瓜' },
  { value: 'banana', label: '香蕉' }, { value: 'strawberry', label: '草莓' }, { value: 'pineapple', label: '菠萝' },
  { value: 'kiwi', label: '猕猴桃' }, { value: 'peach', label: '桃子' }, { value: 'pear', label: '梨' }, { value: 'mango', label: '芒果' }
]

const OP_CLEAR: SpecialOpSpec = { value: 'clear', label: '清空全部', count: false, hint: '把场上的全部清掉' }
const OP_RESET: SpecialOpSpec = { value: 'reset', label: '累计清零', count: false, hint: '把累计数字归零重新数' }
const OP_ADD: SpecialOpSpec = { value: 'add', label: '增加', sign: '+' }
const OP_REDUCE: SpecialOpSpec = { value: 'reduce', label: '减少', sign: '−', hint: '直接替主播消掉这么多' }
const OP_MUL: SpecialOpSpec = { value: 'multiply', label: '乘以', sign: '×', countLabel: '倍数' }
const OP_DIV: SpecialOpSpec = { value: 'divide', label: '除以', sign: '÷', countLabel: '倍数' }

const volumeParam = (def: number, hint: string): SpecialParamSpec => ({
  key: 'volume', label: '音效音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def, hint, group: 'sound'
})
const maxVisibleParam = (def: number, max: number, unit: string, what: string): SpecialParamSpec => ({
  key: 'maxVisible', label: '同屏上限', type: 'number', min: 1, max, step: 10, unit, def, hint: `同时在场的${what}数上限，多出来的排队等空位`, advanced: true
})
// 左上角计数面板（已经抓几只、还剩几只）：全部玩法同在一个窗口，默认只在场上有东西时显示，几个同时在场会上下排开
const STATS_PANEL_PARAM: SpecialParamSpec = {
  key: 'statsPanel', label: '计数面板', type: 'select', def: 'active', group: 'look',
  options: [{ value: 'active', label: '场上有东西时显示' }, { value: 'always', label: '一直显示' }, { value: 'off', label: '不显示' }],
  hint: '左上角的计数（已经抓几只、还剩几只）；几个玩法同时在场会上下排开'
}
const micParam: SpecialParamSpec = {
  key: 'micDevice', label: '麦克风', type: 'device', def: '', hint: '用哪个麦克风听声音，留空 = 系统默认', group: 'sound'
}

// —— 玩法目录 ——
// 顺序即卡片顺序。参数范围的 min/max 同时就是主进程夹紧的上下限。
export const SPECIAL_GAMES: SpecialGameMeta[] = [
  {
    id: 'chain_challenge',
    name: '锁链特效',
    emoji: '⛓️',
    desc: '礼物给主播套上锁链，点击或按空格挣脱',
    how: '观众送礼给画面套上锁链并累加环数，主播点击绿幕（或按空格）一下下挣脱，归零时锁链断裂坠落。',
    category: 'click',
    interactive: true,
    pointerAnywhere: true,
    width: 1280,
    height: 720,
    tint: '#14bcae',
    unit: '环',
    say: '锁链',
    countDef: 1,
    countRange: '1~5',
    ops: [OP_ADD, OP_REDUCE, OP_MUL, OP_DIV, { value: 'clear', label: '直接解锁', count: false, hint: '锁链立刻断开' }],
    params: [
      {
        key: 'visualStyle', label: '锁链皮肤', type: 'select', def: 'neon', group: 'look', hint: '锁链、中间的锁、计数牌和冲击光整套换风格',
        options: [
          { value: 'neon', label: '霓虹' }, { value: 'candy', label: '甜心' }, { value: 'rosegold', label: '玫瑰金' },
          { value: 'laser', label: '赛博光束' }, { value: 'ice', label: '冰晶' },
          { value: 'default', label: '经典金属' }, { value: 'style_1', label: '经典青蓝' }, { value: 'style_2', label: '经典紫' }
        ],
        optionImages: {
          neon: '_thumbs/chain-neon.png', candy: '_thumbs/chain-candy.png', rosegold: '_thumbs/chain-rosegold.png',
          laser: '_thumbs/chain-laser.png', ice: '_thumbs/chain-ice.png', default: '_thumbs/chain-default.png',
          style_1: '_thumbs/chain-style_1.png', style_2: '_thumbs/chain-style_2.png'
        }
      },
      { key: 'skinMotion', label: '皮肤动态光效', type: 'toggle', def: true, hint: '霓虹闪烁、光束电流、冰晶闪光这类小动画；关掉更省电脑', advanced: true, group: 'look' },
      { key: 'thicknessPercent', label: '锁链粗细', type: 'number', min: 30, max: 150, step: 5, unit: '%', def: 60, hint: '锁链相对画面的粗细', group: 'look' },
      { key: 'opacity', label: '整体不透明度', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 100, hint: '锁链和计数牌的不透明度', advanced: true, group: 'look' },
      { key: 'decrementPerClick', label: '每次点击减少', type: 'number', min: 1, max: 20, step: 1, unit: '环', def: 1, hint: '主播点一下减掉的环数' },
      { key: 'unlockMode', label: '解锁方式', type: 'select', def: 'mouse', options: [ { value: 'mouse', label: '点击绿幕' }, { value: 'space', label: '按空格键' }, { value: 'both', label: '点击或空格' } ], hint: '主播怎么解锁' },
      { key: 'showUnlockHint', label: '显示解锁提示', type: 'toggle', def: true, hint: '计数牌上方显示「点击绿幕解锁」', group: 'look' },
      volumeParam(80, '上锁/断裂/点击音效的音量')
    ]
  },
  {
    id: 'catch_duck',
    name: '抓鸭子',
    emoji: '🦆',
    desc: '鸭子从顶部弹跳落下，点击抓住',
    how: '观众送礼放出鸭子，从顶部弹跳着落满画面，主播点一只抓一只，累计抓到的数量会一直记着。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#18bea9',
    unit: '只',
    say: '鸭子',
    countDef: 5,
    countRange: '5~15',
    ops: [OP_ADD, OP_CLEAR, OP_RESET],
    fields: [{ ...SIZE_FIELD, options: [ { value: 'random', label: '随机大小' }, { value: 'big', label: '大鸭子' }, { value: 'small', label: '小鸭子' } ] }],
    statLabel: '累计抓到',
    params: [
      STATS_PANEL_PARAM,
      { key: 'bigDuckSize', label: '大鸭子大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 14, hint: '占窗口短边的百分比（横屏是高度，竖屏是宽度）', group: 'look' },
      { key: 'smallDuckSize', label: '小鸭子大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 8, hint: '占窗口短边的百分比（横屏是高度，竖屏是宽度）', group: 'look' },
      { key: 'randomSizeMin', label: '随机最小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 8, hint: '随机大小的下限', advanced: true, group: 'look' },
      { key: 'randomSizeMax', label: '随机最大', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 14, hint: '随机大小的上限', advanced: true, group: 'look' },
      maxVisibleParam(300, 1000, '只', '鸭子'),
      volumeParam(100, '鸭子出现/被抓的音量')
    ]
  },
  {
    id: 'throw_poop',
    name: '扔粑粑',
    emoji: '💩',
    desc: '粑粑抛物线飞进来黏住，点击清理',
    how: '观众送礼朝画面扔粑粑，粑粑划着抛物线飞进来黏在屏幕上，主播点一个清一个。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#e5cfb4',
    unit: '个',
    say: '粑粑',
    countDef: 5,
    countRange: '5~15',
    ops: [OP_ADD, OP_CLEAR, OP_RESET],
    fields: [{ ...SIZE_FIELD, options: [ { value: 'random', label: '随机大小' }, { value: 'big', label: '大粑粑' }, { value: 'small', label: '小粑粑' } ] }],
    statLabel: '累计清理',
    params: [
      STATS_PANEL_PARAM,
      { key: 'bigPoopSize', label: '大粑粑大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 14, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'smallPoopSize', label: '小粑粑大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 8, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'randomSizeMin', label: '随机最小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 8, hint: '随机大小的下限', advanced: true, group: 'look' },
      { key: 'randomSizeMax', label: '随机最大', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 14, hint: '随机大小的上限', advanced: true, group: 'look' },
      { key: 'spawnIntervalMs', label: '飞入间隔', type: 'number', min: 10, max: 2000, step: 10, unit: '毫秒', def: 100, hint: '一批里连续飞入的间隔', advanced: true },
      maxVisibleParam(300, 1000, '个', '粑粑'),
      volumeParam(100, '飞入音效的音量'),
      { key: 'customImage', label: '自定义粑粑图', type: 'file', fileKind: 'image', def: '', hint: '换成自己的图片，留空用内置粑粑', group: 'media' },
      { key: 'customSound', label: '自定义飞入音效', type: 'file', fileKind: 'audio', def: '', hint: '换成自己的音效，留空用内置音效', group: 'media' }
    ]
  },
  {
    id: 'throw_trash',
    name: '扔垃圾',
    emoji: '🗑️',
    desc: '30 种垃圾糊满屏，拖进底部垃圾桶',
    how: '观众送礼把可乐瓶、旧鞋、剩披萨等 30 种垃圾扔满画面，主播把它们一件件拖进底部的垃圾桶。',
    category: 'drag',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#c4d7e0',
    unit: '件',
    say: '垃圾',
    countDef: 5,
    countRange: '5~15',
    ops: [OP_ADD, OP_CLEAR, OP_RESET],
    fields: [
      SIZE_FIELD,
      { key: 'kind', label: '垃圾种类', def: 'random', options: [{ value: 'random', label: '随机混着扔' }, ...TRASH_KINDS] }
    ],
    statLabel: '累计扔进桶',
    params: [
      STATS_PANEL_PARAM,
      { key: 'bigTrashSize', label: '大垃圾大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 14, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'smallTrashSize', label: '小垃圾大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 8, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'randomSizeMin', label: '随机最小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 8, hint: '随机大小的下限', advanced: true, group: 'look' },
      { key: 'randomSizeMax', label: '随机最大', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 14, hint: '随机大小的上限', advanced: true, group: 'look' },
      { key: 'binSizePercent', label: '垃圾桶大小', type: 'number', min: 10, max: 60, step: 1, unit: '%', def: 45, hint: '垃圾桶宽占窗口宽的比例', group: 'look' },
      { key: 'spawnIntervalMs', label: '飞入间隔', type: 'number', min: 10, max: 2000, step: 10, unit: '毫秒', def: 100, hint: '一批里连续飞入的间隔', advanced: true },
      maxVisibleParam(300, 1000, '件', '垃圾'),
      volumeParam(80, '飞入/进桶音效的音量')
    ]
  },
  {
    id: 'catch_bullet',
    name: '抓子弹',
    emoji: '◎',
    desc: '子弹落下在底部堆成堆，点击抓住',
    how: '观众送礼往下倒子弹，子弹落到底部越堆越高，主播点一颗抓一颗。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#6b4a24',
    unit: '颗',
    say: '子弹',
    countDef: 5,
    countRange: '5~20',
    ops: [OP_ADD, OP_REDUCE, OP_CLEAR, OP_RESET],
    statLabel: '累计抓到',
    params: [
      STATS_PANEL_PARAM,
      { key: 'sizePercent', label: '子弹大小', type: 'number', min: 50, max: 200, step: 5, unit: '%', def: 100, hint: '子弹贴图的缩放比例', group: 'look' },
      maxVisibleParam(300, 2000, '颗', '子弹'),
      volumeParam(100, '子弹落地音效的音量'),
      { key: 'customImages', label: '自定义子弹图', type: 'files', fileKind: 'image', def: '', hint: '可选多张，每颗随机用一张；留空用内置子弹', group: 'media' },
      { key: 'customSound', label: '自定义落地音效', type: 'file', fileKind: 'audio', def: '', hint: '留空用内置音效', group: 'media' }
    ]
  },
  {
    id: 'caterpillar',
    name: '毛毛虫蠕动',
    emoji: '🐛',
    desc: '毛毛虫满屏爬，点击用拖鞋拍死',
    how: '观众送礼放出毛毛虫在画面里蠕动乱爬，主播点哪条，一只拖鞋就拍下去。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#65a91f',
    unit: '条',
    say: '毛毛虫',
    countDef: 5,
    countRange: '3~8',
    ops: [OP_ADD, OP_CLEAR, OP_RESET],
    fields: [{ key: 'color', label: '颜色', def: 'config', options: [{ value: 'config', label: '按玩法设置' }, { value: 'random', label: '随机颜色' }, ...CATERPILLAR_COLORS] }],
    statLabel: '累计拍死',
    params: [
      STATS_PANEL_PARAM,
      { key: 'caterpillarColor', label: '毛毛虫颜色', type: 'select', def: 'green', options: CATERPILLAR_COLORS, hint: '毛毛虫身体的颜色', group: 'look' },
      { key: 'sizePercent', label: '虫子大小', type: 'number', min: 50, max: 180, step: 5, unit: '%', def: 100, hint: '毛毛虫体型缩放', group: 'look' },
      { key: 'speedPercent', label: '爬行速度', type: 'number', min: 30, max: 200, step: 10, unit: '%', def: 100, hint: '毛毛虫爬动的快慢' },
      { key: 'autoDropSeconds', label: '自动掉落', type: 'number', min: 0, max: 600, step: 5, unit: '秒', def: 30, hint: '0 = 不自动掉落；否则到时自己掉出屏幕', advanced: true },
      maxVisibleParam(100, 1000, '条', '毛毛虫')
    ]
  },
  {
    id: 'xiaoxin_hey',
    name: '小新哎嘿',
    emoji: '啪',
    desc: '小新探头喊哎嘿，点击用拖鞋拍走',
    how: '观众送礼让小新从画面里探头喊「哎嘿」，主播点他一下，拖鞋啪地把他拍走。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#20dd57',
    unit: '个',
    say: '小新',
    countDef: 3,
    countRange: '2~5',
    ops: [OP_ADD, OP_CLEAR],
    params: [
      { key: 'maxVisible', label: '同屏上限', type: 'number', min: 1, max: 100, step: 1, unit: '个', def: 12, hint: '同时在场的小新数上限，多余的排队' },
      volumeParam(100, '语音与拍打声的音量')
    ]
  },
  {
    id: 'fan_call',
    name: '粉丝来电',
    emoji: '☎️',
    desc: '粉丝打来电话，接听后播放一条语音',
    how: '观众送礼就给主播打来一通电话，卡片上显示观众昵称和头像，主播点接听播放一段语音，点挂断直接拒接。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#5bc0ff',
    unit: '通',
    countDef: 1,
    ops: [{ value: 'show', label: '打来电话', sign: '+' }, { value: 'clear', label: '挂断全部', count: false, hint: '收起当前来电并清空排队' }],
    params: [
      { key: 'durationSec', label: '来电时长', type: 'number', min: 3, max: 600, step: 1, unit: '秒', def: 10, hint: '没人接多久后自动挂断' },
      { key: 'queueCalls', label: '来电排队', type: 'toggle', def: true, hint: '多通来电排队依次响；关掉则新来电挤掉当前', advanced: true },
      { key: 'showAvatar', label: '显示头像', type: 'toggle', def: true, hint: '来电卡片上显示送礼人头像', group: 'look' },
      { key: 'ringtoneEnabled', label: '来电铃声', type: 'toggle', def: true, hint: '响铃时循环播放铃声', group: 'sound' },
      { key: 'ringtoneVolume', label: '铃声音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 100, hint: '来电铃声的音量', group: 'sound' },
      { key: 'answerVolume', label: '接听音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 100, hint: '接通后语音的音量', group: 'sound' },
      { key: 'answerAudios', label: '接听语音', type: 'files', fileKind: 'audio', def: '', hint: '可选多条，每次接听随机播一条；留空用内置语音', group: 'media' },
      { key: 'ringtonePath', label: '自定义铃声', type: 'file', fileKind: 'audio', def: '', hint: '留空用内置铃声', group: 'media' }
    ]
  },
  {
    id: 'fan_video_call',
    name: '粉丝来视频',
    emoji: '▣',
    desc: '粉丝打来视频电话，接听后播放视频',
    how: '观众送礼就弹出视频来电，主播点接听全屏播放一段视频，播完自动挂断；通话中再来电会在边上排队。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#20aa86',
    unit: '通',
    countDef: 1,
    ops: [{ value: 'show', label: '打来视频', sign: '+' }, { value: 'clear', label: '挂断全部', count: false, hint: '收起当前来电并清空排队' }],
    params: [
      { key: 'durationSec', label: '来电时长', type: 'number', min: 3, max: 600, step: 1, unit: '秒', def: 10, hint: '没人接多久后自动挂断' },
      { key: 'queueCalls', label: '来电排队', type: 'toggle', def: true, hint: '多通来电排队依次响；关掉则新来电挤掉当前', advanced: true },
      { key: 'showAvatar', label: '显示头像', type: 'toggle', def: true, hint: '来电界面显示送礼人头像', group: 'look' },
      { key: 'cameraEnabled', label: '响铃时显示摄像头', type: 'toggle', def: false, hint: '响铃期间背景显示本机摄像头画面；摄像头被直播软件占用时会自动跳过', advanced: true, group: 'look' },
      { key: 'ringtoneEnabled', label: '来电铃声', type: 'toggle', def: true, hint: '响铃时循环播放铃声', group: 'sound' },
      { key: 'ringtoneVolume', label: '铃声音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 100, hint: '来电铃声的音量', group: 'sound' },
      { key: 'answerVideoVolume', label: '视频音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 100, hint: '接通后视频的音量', group: 'sound' },
      { key: 'answerVideos', label: '接听视频', type: 'files', fileKind: 'video', def: '', hint: '可选多条，每次接听随机播一条；留空用内置视频', group: 'media' },
      { key: 'ringtonePath', label: '自定义铃声', type: 'file', fileKind: 'audio', def: '', hint: '留空用内置铃声', group: 'media' }
    ]
  },
  {
    id: 'talisman_seal',
    name: '符咒封印',
    emoji: '封',
    desc: '24 道符咒封满屏，对麦克风大喊破解',
    how: '观众送礼往画面上贴符咒并累加封印点数，主播对着麦克风大喊，每喊一声掉一点，喊到归零符咒全部碎裂。',
    category: 'voice',
    interactive: false,
    width: 1280,
    height: 720,
    tint: '#244f49',
    unit: '点',
    say: '符咒',
    countDef: 3,
    countRange: '2~6',
    ops: [OP_ADD, OP_REDUCE, OP_MUL, OP_DIV, { value: 'clear', label: '直接破解', count: false, hint: '符咒立刻全部碎掉' }],
    params: [
      { key: 'threshold', label: '喊叫音量阈值', type: 'number', min: 1, max: 500, step: 5, def: 240, hint: '麦克风音量超过这个值才算喊了一声（0~500）' },
      { key: 'decrementPerShout', label: '每声减少', type: 'number', min: 1, max: 20, step: 1, unit: '点', def: 1, hint: '每喊一声削减的封印点数' },
      { key: 'cooldownMs', label: '两声间隔', type: 'number', min: 50, max: 5000, step: 10, unit: '毫秒', def: 220, hint: '两声喊叫至少隔多久才算两声', advanced: true },
      micParam,
      volumeParam(100, '符咒音效的音量')
    ]
  },
  {
    id: 'mosquito',
    name: '声控拍蚊子',
    emoji: '蚊',
    desc: '蚊子乱飞嗡嗡叫，拍手或点击消灭',
    how: '观众送礼放出一群嗡嗡叫的蚊子，主播对着麦克风拍手，拍得越响一次消灭越多；也能直接点。',
    category: 'voice',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#496152',
    unit: '只',
    say: '蚊子',
    countDef: 10,
    countRange: '8~25',
    ops: [OP_ADD, OP_REDUCE, OP_CLEAR],
    params: [
      { key: 'threshold', label: '拍手音量阈值', type: 'number', min: 1, max: 500, step: 5, def: 180, hint: '拍手音量超过这个值才算一次（0~500）' },
      { key: 'killPerClap', label: '每次拍手消灭', type: 'number', min: 1, max: 1000, step: 1, unit: '只', def: 1, hint: '一次拍手至少消灭的蚊子数' },
      { key: 'volumeScaledKill', label: '越响灭得越多', type: 'toggle', def: true, hint: '掌声越响一次消灭越多（按下面三档）' },
      { key: 'clapLevel2', label: '第二档音量', type: 'number', min: 1, max: 500, step: 5, def: 200, hint: '掌声到这个音量按第二档消灭', advanced: true },
      { key: 'clapKill2', label: '第二档消灭', type: 'number', min: 1, max: 1000, step: 1, unit: '只', def: 2, hint: '第二档一次消灭几只', advanced: true },
      { key: 'clapLevel3', label: '第三档音量', type: 'number', min: 1, max: 500, step: 5, def: 220, hint: '掌声到这个音量按第三档消灭', advanced: true },
      { key: 'clapKill3', label: '第三档消灭', type: 'number', min: 1, max: 1000, step: 1, unit: '只', def: 4, hint: '第三档一次消灭几只', advanced: true },
      { key: 'maxKillLevel', label: '最响一档音量', type: 'number', min: 1, max: 500, step: 5, def: 240, hint: '掌声到这个音量按最响一档消灭', advanced: true },
      { key: 'loudClapMaxKill', label: '最响一档消灭', type: 'number', min: 1, max: 1000, step: 1, unit: '只', def: 8, hint: '最响一档一次消灭几只', advanced: true },
      { key: 'clapSensitivity', label: '掌声识别灵敏度', type: 'number', min: 1, max: 100, step: 1, def: 70, hint: '越高越容易认出掌声，也更容易把别的声音当成掌声', advanced: true },
      { key: 'cooldownMs', label: '两次拍手间隔', type: 'number', min: 50, max: 5000, step: 10, unit: '毫秒', def: 260, hint: '两次拍手至少隔多久', advanced: true },
      { key: 'showTriggerUser', label: '显示送礼观众', type: 'toggle', def: false, hint: '提示条上显示是谁放的蚊子', group: 'look' },
      maxVisibleParam(1000, 5000, '只', '蚊子'),
      micParam,
      { key: 'soundLoop', label: '嗡嗡声', type: 'toggle', def: true, hint: '有蚊子时循环播放嗡嗡声', group: 'sound' },
      volumeParam(100, '嗡嗡声的音量')
    ]
  },
  {
    id: 'big_mosquito',
    name: '手势拍蚊子',
    emoji: '🖐️',
    desc: '大蚊子要拍三下，挥动鼠标拍晕它们',
    how: '观众送礼放出大小蚊子，大蚊子要拍三下才死。主播快速挥动鼠标扫过蚊子就是一巴掌，也可以切成拍手声控。',
    category: 'swipe',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#6b2530',
    unit: '只',
    say: '蚊子',
    countDef: 3,
    countRange: '2~5',
    ops: [OP_ADD, OP_REDUCE, OP_CLEAR],
    fields: [{ ...SIZE_FIELD, options: [ { value: 'random', label: '大小随机' }, { value: 'big', label: '大蚊子' }, { value: 'small', label: '小蚊子' } ] }],
    params: [
      { key: 'controlMode', label: '控制方式', type: 'select', def: 'mouse', options: [ { value: 'mouse', label: '鼠标挥拍' }, { value: 'clap', label: '拍手声控' }, { value: 'both', label: '鼠标加声控' } ], hint: '鼠标挥拍：快速移动鼠标扫过蚊子；声控：拍手随机击落' },
      { key: 'bigMosquitoSize', label: '大蚊子大小', type: 'number', min: 10, max: 100, step: 1, unit: '%', def: 55, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'smallMosquitoSize', label: '小蚊子大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 18, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'bigMosquitoHp', label: '大蚊子血量', type: 'number', min: 1, max: 50, step: 1, unit: '下', def: 3, hint: '大蚊子要拍几下才死' },
      { key: 'smallMosquitoHp', label: '小蚊子血量', type: 'number', min: 1, max: 50, step: 1, unit: '下', def: 1, hint: '小蚊子要拍几下才死' },
      { key: 'flightSpeed', label: '飞行速度', type: 'number', min: 10, max: 300, step: 10, unit: '%', def: 50, hint: '蚊子飞行的快慢' },
      { key: 'hitRadius', label: '拍击半径', type: 'number', min: 5, max: 40, step: 1, unit: '%', def: 13, hint: '挥一下能拍到的范围（窗口短边百分比）', advanced: true },
      { key: 'gestureSpeed', label: '挥拍速度门槛', type: 'number', min: 5, max: 100, step: 1, def: 30, hint: '鼠标移动多快才算挥了一巴掌', advanced: true },
      { key: 'killPerClap', label: '每次拍手击中', type: 'number', min: 1, max: 1000, step: 1, unit: '只', def: 1, hint: '声控模式下一次拍手打中几只', advanced: true },
      { key: 'threshold', label: '拍手音量阈值', type: 'number', min: 1, max: 500, step: 5, def: 180, hint: '声控模式下拍手音量超过这个值才算（0~500）', advanced: true },
      { key: 'clapSensitivity', label: '掌声识别灵敏度', type: 'number', min: 1, max: 100, step: 1, def: 70, hint: '越高越容易认出掌声', advanced: true },
      { key: 'cooldownMs', label: '两次拍手间隔', type: 'number', min: 50, max: 5000, step: 10, unit: '毫秒', def: 260, hint: '两次拍手至少隔多久', advanced: true },
      { key: 'showTriggerUser', label: '显示送礼观众', type: 'toggle', def: true, hint: '蚊子上方显示送礼人昵称', group: 'look' },
      { key: 'textSize', label: '昵称字号', type: 'number', min: 12, max: 96, step: 2, unit: 'px', def: 32, hint: '蚊子上方昵称的字号', advanced: true, group: 'look' },
      maxVisibleParam(300, 1000, '只', '蚊子'),
      micParam,
      volumeParam(100, '拍击与嗡嗡声的音量'),
      { key: 'customImage', label: '自定义蚊子图', type: 'file', fileKind: 'image', def: '', hint: '换成自己的图片（比如朋友的头像），留空用内置蚊子', group: 'media' }
    ]
  },
  {
    id: 'gesture_fly',
    name: '手势拍苍蝇',
    emoji: '🪰',
    desc: '苍蝇乱飞，挥动鼠标拍死',
    how: '观众送礼放出苍蝇，飞累了会落地爬。主播快速挥动鼠标扫过苍蝇拍死它，也可以切成拍手声控。',
    category: 'swipe',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#31505a',
    unit: '只',
    say: '苍蝇',
    countDef: 3,
    countRange: '2~6',
    ops: [OP_ADD, OP_REDUCE, OP_CLEAR],
    fields: [{ ...SIZE_FIELD, options: [ { value: 'random', label: '大小随机' }, { value: 'big', label: '大苍蝇' }, { value: 'small', label: '小苍蝇' } ] }],
    params: [
      { key: 'controlMode', label: '控制方式', type: 'select', def: 'mouse', options: [ { value: 'mouse', label: '鼠标挥拍' }, { value: 'clap', label: '拍手声控' }, { value: 'both', label: '鼠标加声控' } ], hint: '鼠标挥拍：快速移动鼠标扫过苍蝇；声控：拍手随机击落' },
      { key: 'bigFlySize', label: '大苍蝇大小', type: 'number', min: 10, max: 100, step: 1, unit: '%', def: 55, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'smallFlySize', label: '小苍蝇大小', type: 'number', min: 5, max: 100, step: 1, unit: '%', def: 18, hint: '占窗口短边的百分比', group: 'look' },
      { key: 'bigFlyHp', label: '大苍蝇血量', type: 'number', min: 1, max: 50, step: 1, unit: '下', def: 3, hint: '大苍蝇要拍几下才死' },
      { key: 'smallFlyHp', label: '小苍蝇血量', type: 'number', min: 1, max: 50, step: 1, unit: '下', def: 1, hint: '小苍蝇要拍几下才死' },
      { key: 'flightSpeed', label: '飞行速度', type: 'number', min: 10, max: 300, step: 10, unit: '%', def: 50, hint: '苍蝇飞行的快慢' },
      { key: 'hitRadius', label: '拍击半径', type: 'number', min: 5, max: 40, step: 1, unit: '%', def: 13, hint: '挥一下能拍到的范围（窗口短边百分比）', advanced: true },
      { key: 'gestureSpeed', label: '挥拍速度门槛', type: 'number', min: 5, max: 100, step: 1, def: 30, hint: '鼠标移动多快才算挥了一巴掌', advanced: true },
      { key: 'killPerClap', label: '每次拍手击中', type: 'number', min: 1, max: 1000, step: 1, unit: '只', def: 1, hint: '声控模式下一次拍手打中几只', advanced: true },
      { key: 'threshold', label: '拍手音量阈值', type: 'number', min: 1, max: 500, step: 5, def: 180, hint: '声控模式下拍手音量超过这个值才算（0~500）', advanced: true },
      { key: 'clapSensitivity', label: '掌声识别灵敏度', type: 'number', min: 1, max: 100, step: 1, def: 70, hint: '越高越容易认出掌声', advanced: true },
      { key: 'cooldownMs', label: '两次拍手间隔', type: 'number', min: 50, max: 5000, step: 10, unit: '毫秒', def: 260, hint: '两次拍手至少隔多久', advanced: true },
      { key: 'showTriggerUser', label: '显示送礼观众', type: 'toggle', def: true, hint: '苍蝇上方显示送礼人昵称', group: 'look' },
      { key: 'textSize', label: '昵称字号', type: 'number', min: 12, max: 96, step: 2, unit: 'px', def: 32, hint: '苍蝇上方昵称的字号', advanced: true, group: 'look' },
      maxVisibleParam(300, 1000, '只', '苍蝇'),
      micParam,
      volumeParam(100, '拍击音量'),
      { key: 'customImage', label: '自定义苍蝇图', type: 'file', fileKind: 'image', def: '', hint: '换成自己的图片，留空用内置苍蝇', group: 'media' }
    ]
  },
  {
    id: 'fruit_slice',
    name: '手势切水果',
    emoji: '🍉',
    desc: '水果抛上来，拖动鼠标划出刀光切开',
    how: '观众送礼从底部往上抛水果，主播按住鼠标划过去，刀光所到之处水果一切两半、果汁四溅。',
    category: 'swipe',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#183f36',
    unit: '个',
    say: '水果',
    countDef: 5,
    countRange: '4~10',
    ops: [OP_ADD, OP_CLEAR],
    fields: [{ key: 'kind', label: '水果', def: 'random', options: [{ value: 'random', label: '随机水果' }, ...FRUIT_KINDS] }],
    params: [
      { key: 'throwSpeed', label: '抛射速度', type: 'number', min: 20, max: 300, step: 10, unit: '%', def: 100, hint: '水果抛上来的速度' },
      { key: 'throwIntervalMs', label: '连续抛出间隔', type: 'number', min: 10, max: 2000, step: 10, unit: '毫秒', def: 150, hint: '一波水果逐个抛出的间隔' },
      { key: 'fruitSize', label: '水果大小', type: 'number', min: 5, max: 40, step: 1, unit: '%', def: 18, hint: '占窗口短边的百分比', group: 'look' },
      volumeParam(100, '切割音效的音量')
    ]
  },
  {
    id: 'coin_bump',
    name: '顶金币',
    emoji: '🪙',
    desc: '点击砖块顶出金币，再点击金币收走',
    how: '观众送礼往砖块里充金币，主播点砖块把金币一枚枚顶出来，再点金币收走。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#304a84',
    unit: '枚',
    say: '金币',
    countDef: 5,
    countRange: '5~15',
    ops: [OP_ADD, OP_CLEAR],
    params: [
      { key: 'coinSize', label: '金币大小', type: 'number', min: 1, max: 20, step: 1, unit: '档', def: 5, hint: '档位越大金币越大（1~20）', group: 'look' },
      volumeParam(80, '顶出/收金币音效的音量'),
      { key: 'customCoinImage', label: '自定义金币图', type: 'file', fileKind: 'image', def: '', hint: '换成自己的图片，留空用内置金币', group: 'media' },
      { key: 'customSound', label: '自定义顶出音效', type: 'file', fileKind: 'audio', def: '', hint: '留空用内置音效', group: 'media' }
    ]
  },
  {
    id: 'leaf_pickup',
    name: '捡叶子',
    emoji: '🍂',
    desc: '落叶摇摆飘下，点击扫进右下角垃圾桶',
    how: '观众送礼让落叶摇摇摆摆飘满画面，主播点叶子把它扫进右下角的垃圾桶；还能加速清扫、刮一阵龙卷风。',
    category: 'click',
    interactive: true,
    width: 1280,
    height: 720,
    tint: '#b87527',
    unit: '片',
    say: '叶子',
    countDef: 5,
    countRange: '5~20',
    ops: [
      OP_ADD,
      { value: 'reduce', label: '直接扫掉', sign: '−', hint: '不用点，直接替主播扫掉这么多' },
      { value: 'accelerate', label: '加速清扫', sign: '×', countLabel: '倍数', hint: '这一轮主播每点一下收这么多倍' },
      { value: 'tornado', label: '龙卷风', countLabel: '卷走几片', hint: '刮起龙卷风，把这么多片叶子卷走' },
      OP_CLEAR
    ],
    fields: [{ ...SIZE_FIELD, options: [ { value: 'random', label: '随机大小' }, { value: 'big', label: '大叶子' }, { value: 'small', label: '小叶子' } ] }],
    statLabel: '这一轮已清扫',
    params: [
      STATS_PANEL_PARAM,
      { key: 'leavesPerClick', label: '每次点击收几片', type: 'number', min: 1, max: 100, step: 1, unit: '片', def: 1, hint: '点一片叶子实际收进桶的数量' },
      { key: 'bigLeafSize', label: '大叶子大小', type: 'number', min: 3, max: 100, step: 1, unit: '%', def: 50, hint: '占窗口短边的百分比（横屏是高度，竖屏是宽度）', group: 'look' },
      { key: 'smallLeafSize', label: '小叶子大小', type: 'number', min: 3, max: 100, step: 1, unit: '%', def: 10, hint: '占窗口短边的百分比（横屏是高度，竖屏是宽度）', group: 'look' },
      { key: 'randomSizeMin', label: '随机最小', type: 'number', min: 3, max: 100, step: 1, unit: '%', def: 10, hint: '随机大小的下限', advanced: true, group: 'look' },
      { key: 'randomSizeMax', label: '随机最大', type: 'number', min: 3, max: 100, step: 1, unit: '%', def: 50, hint: '随机大小的上限', advanced: true, group: 'look' }
    ]
  },
  {
    id: 'music_ball',
    name: '音乐球',
    emoji: '♫',
    desc: '彩球踩着节拍滚向判定圈，到圈自动爆发',
    how: '观众送礼点一首歌，彩球踩着节拍从右边滚向判定圈，到圈炸开，重拍时放大招，跟着音乐一起嗨。',
    category: 'show',
    interactive: false,
    width: 1280,
    height: 720,
    tint: '#5637a8',
    unit: '局',
    countDef: 1,
    ops: [
      { value: 'start', label: '开始一局', count: false, hint: '从头播放（正在播会重新开始）' },
      { value: 'pause', label: '暂停', count: false },
      { value: 'resume', label: '继续', count: false },
      { value: 'stop', label: '停止', count: false }
    ],
    params: [
      { key: 'musicPath', label: '自定义音乐', type: 'file', fileKind: 'audio', def: '', hint: '换成自己的歌，节拍会自动分析；留空用内置音乐', group: 'media' },
      { key: 'beatSensitivity', label: '节拍灵敏度', type: 'number', min: 0, max: 100, step: 1, def: 65, hint: '自定义音乐分析节拍时，越高球越密', advanced: true },
      { key: 'volume', label: '音乐音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 90, hint: '背景音乐的音量', group: 'sound' },
      { key: 'travelMs', label: '球滚动提前量', type: 'number', min: 800, max: 5000, step: 100, unit: '毫秒', def: 2200, hint: '球从右边缘滚到判定圈的时间' },
      { key: 'ballSize', label: '球大小', type: 'number', min: 20, max: 160, step: 2, unit: 'px', def: 44, hint: '彩球的基准直径', group: 'look' },
      { key: 'burstSensitivity', label: '爆发灵敏度', type: 'number', min: 0, max: 100, step: 1, def: 68, hint: '越高越多节拍放大招' },
      { key: 'countdownSec', label: '倒计时', type: 'number', min: 0, max: 30, step: 1, unit: '秒', def: 3, hint: '开始前的倒计时，0 = 直接播放' },
      { key: 'loop', label: '循环播放', type: 'toggle', def: false, hint: '音乐播完自动再来一局' },
      { key: 'syncOffsetMs', label: '同步偏移', type: 'number', min: -2000, max: 2000, step: 10, unit: '毫秒', def: 0, hint: '音画对不齐时微调（正值 = 画面提前）', advanced: true }
    ]
  }
]

export const SPECIAL_GAME_IDS = SPECIAL_GAMES.map((g) => g.id)
export const SPECIAL_GAME_MAP: Record<string, SpecialGameMeta> = Object.fromEntries(SPECIAL_GAMES.map((g) => [g.id, g]))

/** 公共配置默认值（玩法专属参数默认值从 params[].def 取）。 */
export function defaultSpecialConfig(meta: SpecialGameMeta): SpecialGameConfig {
  const params: Record<string, number | string | boolean> = {}
  for (const p of meta.params) params[p.key] = p.def
  return {
    speed: 1,
    countCap: 0, // 默认不限（用户铁律：所有东西不设上限）；弱机可在设置里填一个值
    params
  }
}

// ================= 特色整蛊盲盒（照时间插件的盲盒）=================
// 先在「盲盒事件库」里攒好事件（每个事件 = 一条特色整蛊动作，数量可以写随机范围），
// 再给每个礼物自己勾选奖池：观众每送一份，从勾选的事件里随机抽一个执行。
// 动作命令 special-box，参数 `事件id,事件id,…|显示名`；事件id 写 * = 事件库里全部启用的事件。
export interface SpecialBoxEvent {
  id: string
  /** 事件名：奖池里、开出提示里显示 */
  name: string
  /** 开出什么：特色整蛊动作参数 玩法|操作|数量|选项（数量可以写随机范围，如 3~8） */
  param: string
  /** 停用 = 真触发时抽不到（奖池里的勾选保留，打开就回来） */
  enabled: boolean
  /** 抽中权重：默认 1，大家一样；调大更容易抽到，0 = 暂时不抽 */
  weight: number
  /** 抽中时同时触发的游戏整蛊（参数 游戏id|整蛊id|显示名），空 = 不附加 */
  prank: string
  /** 开奖配音念什么：空 = 按「玩法 + 操作 + 数量」自动念（锁链加5）；可以写 {数量} 代入这次开出的数量 */
  voice?: string
  /** 这个事件开出来不念（开奖画面照样出） */
  silent?: boolean
  /**
   * 开奖视频（本地文件，照时间盲盒每个事件一段视频）：开到这个事件就在窗口里放它（抠掉绿幕底），
   * 不敲锣、不出大字；空 = 锣 + 大字 + AI 配音。2026-10-07 用户：「抓鸭子用抓鸭子抓几只那个视频」
   */
  video?: string
  /** 开奖视频音量 0~100（缺省 100） */
  videoVolume?: number
  /** 放开奖视频时也念 AI 配音（视频一般自带配音，缺省不念；念的话在视频放完后念） */
  voiceWithVideo?: boolean
}
export const SPECIAL_BOX_ALL = '*'
export const SPECIAL_BOX_DEFAULT_NAME = '特色盲盒'

/** 新事件的 id（和 0.3.63 那版盲盒 id 区分开） */
export function newSpecialBoxEventId(): string {
  return `sbe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** 事件的默认名字 = 动作的中文描述（改过名字就用自己起的） */
export function specialBoxEventDefaultName(param: string): string {
  return specialActionText(param)
}

// 默认事件库（照时间盲盒那一排「-12分」「时间×2」：每个事件一个固定数量，开出来念的就是它）。
// 2026-10-06 用户：「多配点，多种类一些，类似于时间盲盒那种可选的」「直接给默认加上去」；
// 2026-10-07：「有点少啊，加减的数字，参考时间盲盒呀，多来点」→ 加减照时间盲盒那排数配满（第 3 版）。
// 配音随包带着（box_voice），不联网也能念。id 由 玩法-操作-数量-选项 决定，不能变（礼物奖池按 id 勾）。
// [玩法, 操作, 数量, 选项]
type BoxSpec = [SpecialGameId, string, number, string?]
// 第 2 版（93 个）：每个有数量的玩法几档加 / 减 / 乘 / 除，再带几个大小、种类的变化
const BOX_SPECS_V2: BoxSpec[] = [
  ['chain_challenge', 'add', 1], ['chain_challenge', 'add', 3], ['chain_challenge', 'add', 5], ['chain_challenge', 'add', 10],
  ['chain_challenge', 'reduce', 2], ['chain_challenge', 'reduce', 5],
  ['chain_challenge', 'multiply', 2], ['chain_challenge', 'multiply', 3], ['chain_challenge', 'divide', 2], ['chain_challenge', 'divide', 3],
  ['catch_duck', 'add', 3], ['catch_duck', 'add', 5], ['catch_duck', 'add', 10], ['catch_duck', 'add', 20], ['catch_duck', 'add', 50],
  ['catch_duck', 'add', 5, 'size=big'], ['catch_duck', 'add', 10, 'size=small'],
  ['throw_poop', 'add', 3], ['throw_poop', 'add', 5], ['throw_poop', 'add', 8], ['throw_poop', 'add', 10], ['throw_poop', 'add', 20],
  ['throw_poop', 'add', 3, 'size=big'],
  ['throw_trash', 'add', 3], ['throw_trash', 'add', 5], ['throw_trash', 'add', 10], ['throw_trash', 'add', 20],
  ['throw_trash', 'add', 3, 'kind=old_shoe'], ['throw_trash', 'add', 5, 'kind=beer_can'], ['throw_trash', 'add', 5, 'kind=egg'],
  ['catch_bullet', 'add', 5], ['catch_bullet', 'add', 10], ['catch_bullet', 'add', 20], ['catch_bullet', 'add', 50],
  ['catch_bullet', 'reduce', 5], ['catch_bullet', 'reduce', 10],
  ['caterpillar', 'add', 1], ['caterpillar', 'add', 3], ['caterpillar', 'add', 5], ['caterpillar', 'add', 10], ['caterpillar', 'add', 3, 'color=random'],
  ['xiaoxin_hey', 'add', 1], ['xiaoxin_hey', 'add', 2], ['xiaoxin_hey', 'add', 3], ['xiaoxin_hey', 'add', 5], ['xiaoxin_hey', 'add', 10],
  ['talisman_seal', 'add', 2], ['talisman_seal', 'add', 3], ['talisman_seal', 'add', 5], ['talisman_seal', 'add', 10],
  ['talisman_seal', 'reduce', 2], ['talisman_seal', 'multiply', 2], ['talisman_seal', 'divide', 2],
  ['mosquito', 'add', 5], ['mosquito', 'add', 10], ['mosquito', 'add', 20], ['mosquito', 'add', 50], ['mosquito', 'add', 100], ['mosquito', 'reduce', 10],
  ['big_mosquito', 'add', 1, 'size=big'], ['big_mosquito', 'add', 2, 'size=big'], ['big_mosquito', 'add', 3, 'size=big'],
  ['big_mosquito', 'add', 5, 'size=small'], ['big_mosquito', 'add', 10, 'size=small'], ['big_mosquito', 'reduce', 1],
  ['gesture_fly', 'add', 1, 'size=big'], ['gesture_fly', 'add', 3], ['gesture_fly', 'add', 5], ['gesture_fly', 'add', 10], ['gesture_fly', 'reduce', 2],
  ['fruit_slice', 'add', 3], ['fruit_slice', 'add', 5], ['fruit_slice', 'add', 10], ['fruit_slice', 'add', 20],
  ['fruit_slice', 'add', 3, 'kind=watermelon'], ['fruit_slice', 'add', 3, 'kind=pineapple'], ['fruit_slice', 'add', 5, 'kind=banana'],
  ['coin_bump', 'add', 5], ['coin_bump', 'add', 10], ['coin_bump', 'add', 20], ['coin_bump', 'add', 50], ['coin_bump', 'add', 100],
  ['leaf_pickup', 'add', 5], ['leaf_pickup', 'add', 10], ['leaf_pickup', 'add', 20], ['leaf_pickup', 'add', 50],
  ['leaf_pickup', 'reduce', 10], ['leaf_pickup', 'accelerate', 2], ['leaf_pickup', 'accelerate', 3], ['leaf_pickup', 'tornado', 20],
  ['fan_call', 'show', 1], ['fan_video_call', 'show', 1], ['music_ball', 'start', 1]
]
// 第 3 版：照时间盲盒那排数——加 1~60 十七档、减 1~60 十六档、乘除 2 和 3（时间盲盒就是这些）。
// 手势拍蚊子加的是大蚊子（拍三下那种），念「大蚊子加5」，和声控拍蚊子的「蚊子加5」分开。
export const SPECIAL_BOX_ADD_COUNTS = [1, 2, 4, 5, 8, 9, 10, 12, 15, 18, 20, 25, 30, 35, 40, 50, 60]
export const SPECIAL_BOX_REDUCE_COUNTS = [1, 2, 4, 5, 8, 9, 10, 12, 15, 18, 20, 25, 30, 35, 40, 60]
const OP_COUNTS: Record<string, number[]> = {
  add: SPECIAL_BOX_ADD_COUNTS,
  reduce: SPECIAL_BOX_REDUCE_COUNTS,
  multiply: [2, 3],
  divide: [2, 3],
  accelerate: [2, 3],
  tornado: [10, 20, 30, 50]
}
function boxSpecsV3(): BoxSpec[] {
  const out: BoxSpec[] = []
  for (const g of SPECIAL_GAMES) {
    if (!g.say) continue
    for (const op of g.ops) {
      if (op.count === false) continue
      const fields = g.id === 'big_mosquito' && op.value === 'add' ? 'size=big' : undefined
      for (const n of OP_COUNTS[op.value] ?? []) out.push([g.id, op.value, n, fields])
    }
  }
  return out
}
/** 默认事件库的版本：老用户升级时只补这版新出的默认事件（自己删掉的不会再加回来） */
export const SPECIAL_BOX_DEFAULTS_LEVEL = 3

function specFields(raw?: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of String(raw || '').split(';')) {
    const at = pair.indexOf('=')
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1)
  }
  return out
}

function boxEventFromSpec([id, op, n, raw]: BoxSpec): SpecialBoxEvent {
  const fields = specFields(raw)
  const param = joinSpecialParam({ id, op, count: String(n), fields })
  const tail = Object.values(fields).join('-')
  return { id: `sbe-v-${id}-${op}-${n}${tail ? `-${tail}` : ''}`, name: specialBoxEventDefaultName(param), param, enabled: true, weight: 1, prank: '' }
}

/**
 * 默认事件库：照时间盲盒，每个事件一个固定数量（玩法、操作、数量、选项不变 id 就不变）。
 * sinceLevel = 已经有到第几版：只回之后新出的（老用户升级补事件用）；不给 = 全部。
 * 顺序：按玩法卡片顺序，同一玩法里先加后减再乘除、数量从小到大。
 */
export function defaultSpecialBoxEvents(sinceLevel = 0): SpecialBoxEvent[] {
  const level = new Map<string, number>()
  const events: SpecialBoxEvent[] = []
  for (const [list, lv] of [[BOX_SPECS_V2, 2], [boxSpecsV3(), 3]] as [BoxSpec[], number][]) {
    for (const spec of list) {
      const ev = boxEventFromSpec(spec)
      if (level.has(ev.id)) continue
      level.set(ev.id, lv)
      events.push(ev)
    }
  }
  return sortSpecialBoxEvents(events.filter((e) => (level.get(e.id) ?? 0) > sinceLevel))
}

/** 排个顺序：玩法卡片顺序 → 操作（加、减、乘、除…）→ 数量从小到大 → 不带选项的在前；其余照原来的先后 */
export function sortSpecialBoxEvents<T extends Pick<SpecialBoxEvent, 'param'>>(events: T[]): T[] {
  const key = (e: T): number[] => {
    const p = parseSpecialParam(e.param)
    const meta = p.id ? SPECIAL_GAME_MAP[p.id] : undefined
    const g = meta ? SPECIAL_GAMES.indexOf(meta) : SPECIAL_GAMES.length
    const o = meta ? Math.max(0, meta.ops.findIndex((x) => x.value === p.op)) : 0
    const n = parseInt(p.count, 10)
    return [g, o, Number.isFinite(n) ? n : 0, Object.keys(p.fields).length]
  }
  return events
    .map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3] || a.i - b.i)
    .map((x) => x.e)
}

/** 0.3.64 那版的默认事件（每个玩法一个、数量随机）：判断「奖池是不是还是当初默认全选」用 */
export const LEGACY_DEFAULT_BOX_EVENT_IDS: string[] = SPECIAL_GAMES.map((g) => `sbe-default-${g.id}`)

// ================= 盲盒开奖：画面 + AI 配音 =================
// 照时间盲盒那批视频（2026-10-06 用户：「类似于时间插件盲盒的那种 AI 语音」「前面有一个锣声，然后才是 AI 人声」）：
// 抽中一个事件，窗口里敲一声锣、蹦出「锁链+5」，接着晓伊念「锁链加5」；连送多份逐条播（同时间盲盒连击逐项播放），
// 每条开出的玩法在锣响那一刻生效。没有数量的（粉丝来电、音乐球）只出画面不念。
export type SpecialRevealPosition = 'top' | 'center' | 'bottom' | 'top-left' | 'top-right'
export interface SpecialRevealConfig {
  /** 开奖画面：关掉 = 开出来直接生效（只有顶上那条「某某的盲盒开出：…」） */
  enabled: boolean
  /** AI 配音 */
  voice: boolean
  /** 配音的声音 */
  voiceName: string
  /** 语速（%，0 = 正常） */
  rate: number
  /** 配音音量 0~100 */
  voiceVolume: number
  /** 开场锣声 */
  gong: boolean
  /** 锣声音量 0~100 */
  gongVolume: number
  /** 自定义开场音效（空 = 内置的锣） */
  gongPath: string
  /** 锣响后多久开口（毫秒） */
  gapMs: number
  /** 念完后画面再留多久（毫秒） */
  holdMs: number
  /** 开奖画面的位置 */
  position: SpecialRevealPosition
  /** 开奖画面大小（%） */
  scale: number
  /** 画面里画那面锣 */
  showGong: boolean
  /** 排队上限：等着开奖的超过这么多，新开出的直接生效不再播开奖；0 = 不限 */
  maxQueue: number
  /** 礼物直接触发的特色整蛊（不经过盲盒）也播开奖 */
  direct: boolean
  /** 开奖视频大小（按比例放进窗口，占窗口的百分比） */
  videoScale: number
  /** 开奖视频抠底色：自动（从视频四个角量底色）/ 用下面指定的颜色 */
  videoKeyAuto: boolean
  videoKeyColor: string
  /** 抠图相似度 / 边缘平滑 / 溢色抑制（0~100，和直播伴侣的色度键一个意思） */
  videoSimilarity: number
  videoSmoothness: number
  videoSpill: number
}
export const DEFAULT_SPECIAL_REVEAL: SpecialRevealConfig = {
  enabled: true,
  voice: true,
  voiceName: 'zh-CN-XiaoyiNeural',
  rate: 0,
  voiceVolume: 100,
  gong: true,
  gongVolume: 100,
  gongPath: '',
  gapMs: 565,
  holdMs: 300,
  position: 'top',
  scale: 100,
  showGong: true,
  maxQueue: 20,
  direct: false,
  videoScale: 100,
  videoKeyAuto: true,
  videoKeyColor: '#00ff00',
  videoSimilarity: 40,
  videoSmoothness: 12,
  videoSpill: 30
}
export const SPECIAL_VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 · 萌系女声' },
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 温柔女声' },
  { value: 'zh-CN-YunxiaNeural', label: '云夏 · 可爱少年' },
  { value: 'zh-CN-YunxiNeural', label: '云希 · 阳光男声' },
  { value: 'zh-CN-YunjianNeural', label: '云健 · 激情男声' },
  { value: 'zh-CN-YunyangNeural', label: '云扬 · 播音男声' },
  { value: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 东北话' },
  { value: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 陕西话' },
  { value: 'zh-HK-HiuGaaiNeural', label: '曉佳 · 粤语' },
  { value: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 台湾腔' }
]
export const SPECIAL_REVEAL_POSITIONS: { value: SpecialRevealPosition; label: string }[] = [
  { value: 'top', label: '上方居中' },
  { value: 'center', label: '画面正中' },
  { value: 'bottom', label: '下方居中' },
  { value: 'top-left', label: '左上角' },
  { value: 'top-right', label: '右上角' }
]

/** 开奖设置的控件规格：设置页按它用通用控件摆，min/max 同时是主进程夹紧的上下限 */
export const SPECIAL_REVEAL_PARAMS: SpecialParamSpec[] = [
  { key: 'enabled', label: '开奖画面', type: 'toggle', def: true, hint: '抽中时窗口里敲一声锣、蹦出「锁链+5」这样的大字，一条一条开；关掉就开出来直接生效', group: 'look' },
  { key: 'voice', label: 'AI 配音', type: 'toggle', def: true, hint: '锣响后念出开到的东西，比如「锁链加5」；粉丝来电、音乐球这种没有数量的不念', group: 'sound' },
  { key: 'voiceName', label: '配音声音', type: 'select', def: DEFAULT_SPECIAL_REVEAL.voiceName, options: SPECIAL_VOICE_OPTIONS, hint: '晓伊不联网也能念；换别的声音，每句第一次念的时候要联网', group: 'sound' },
  { key: 'rate', label: '语速', type: 'number', min: -50, max: 100, step: 5, unit: '%', def: DEFAULT_SPECIAL_REVEAL.rate, hint: '0 是正常语速，往负调更慢', group: 'sound' },
  { key: 'voiceVolume', label: '配音音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: DEFAULT_SPECIAL_REVEAL.voiceVolume, group: 'sound' },
  { key: 'gong', label: '开场锣声', type: 'toggle', def: true, hint: '念之前先「咣」一声', group: 'sound' },
  { key: 'gongVolume', label: '锣声音量', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: DEFAULT_SPECIAL_REVEAL.gongVolume, group: 'sound' },
  { key: 'gongPath', label: '自定义开场音效', type: 'file', fileKind: 'audio', def: '', hint: '换成自己的音效，留空用内置的锣', advanced: true, group: 'media' },
  { key: 'gapMs', label: '锣后停顿', type: 'number', min: 0, max: 3000, step: 5, unit: '毫秒', def: DEFAULT_SPECIAL_REVEAL.gapMs, hint: '锣响后过多久开始念', advanced: true, group: 'sound' },
  { key: 'position', label: '画面位置', type: 'select', def: DEFAULT_SPECIAL_REVEAL.position, options: SPECIAL_REVEAL_POSITIONS, group: 'look' },
  { key: 'scale', label: '画面大小', type: 'number', min: 30, max: 300, step: 5, unit: '%', def: DEFAULT_SPECIAL_REVEAL.scale, group: 'look' },
  { key: 'showGong', label: '画面里的锣', type: 'toggle', def: true, hint: '大字左边那面被敲响的锣；关掉只出大字', group: 'look' },
  { key: 'holdMs', label: '念完后停留', type: 'number', min: 0, max: 10000, step: 100, unit: '毫秒', def: DEFAULT_SPECIAL_REVEAL.holdMs, hint: '念完以后大字再留多久', advanced: true, group: 'look' },
  { key: 'maxQueue', label: '排队上限', type: 'number', min: 0, max: 200, step: 1, unit: '条', def: DEFAULT_SPECIAL_REVEAL.maxQueue, hint: '等着开奖的超过这么多条，新开出的直接生效、不再敲锣念；0 = 不限', advanced: true },
  { key: 'direct', label: '直接触发的也播', type: 'toggle', def: false, hint: '礼物规则直接触发的特色整蛊（不经过盲盒）也敲锣、念一句', advanced: true },
  { key: 'videoScale', label: '开奖视频大小', type: 'number', min: 20, max: 100, step: 5, unit: '%', def: DEFAULT_SPECIAL_REVEAL.videoScale, hint: '事件配了开奖视频时，视频按比例放进窗口占多大', group: 'look' },
  { key: 'videoKeyAuto', label: '开奖视频自动抠底色', type: 'toggle', def: true, hint: '从视频四个角量出绿幕底色再抠掉；关掉就用下面的颜色', advanced: true, group: 'look' },
  { key: 'videoKeyColor', label: '开奖视频抠图颜色', type: 'color', def: DEFAULT_SPECIAL_REVEAL.videoKeyColor, hint: '关掉自动抠底色时用这个颜色', advanced: true, group: 'look' },
  { key: 'videoSimilarity', label: '抠图相似度', type: 'number', min: 0, max: 100, step: 1, def: DEFAULT_SPECIAL_REVEAL.videoSimilarity, hint: '越大，跟底色越像的颜色越容易被抠掉', advanced: true, group: 'look' },
  { key: 'videoSmoothness', label: '抠图边缘平滑', type: 'number', min: 0, max: 100, step: 1, def: DEFAULT_SPECIAL_REVEAL.videoSmoothness, hint: '抠除边界的过渡范围，太大边缘会发虚', advanced: true, group: 'look' },
  { key: 'videoSpill', label: '抠图溢色抑制', type: 'number', min: 0, max: 100, step: 1, def: DEFAULT_SPECIAL_REVEAL.videoSpill, hint: '压掉边缘残留的绿边', advanced: true, group: 'look' }
]

/** 试听一句开奖配音（开奖设置、事件库里点「试听」）：给事件（可以是还没存的草稿），或者直接给一句话 */
export interface SpecialVoicePreviewRequest {
  /** 事件的动作参数 玩法|操作|数量|选项 */
  param?: string
  /** 事件自己写的台词（{数量} 换成这次的数量） */
  voice?: string
  silent?: boolean
  /** 直接念这一句（不看事件） */
  text?: string
  /** 用还没存的开奖设置试听（刚换的声音、语速） */
  config?: Partial<SpecialRevealConfig>
}
export interface SpecialVoicePreview {
  ok: boolean
  error?: string
  /** 念的那句（空 = 这个事件不念） */
  line: string
  /** 开奖画面上的大字 */
  text: string
  voiceUrl: string
  gongUrl: string
  gapMs: number
  voiceVolume: number
  gongVolume: number
}

const OP_SAY: Record<string, string> = { add: '加', show: '加', reduce: '减', multiply: '乘以', divide: '除以' }

// 配音 / 开奖大字里的名词：玩法的叫法，带上种类 / 颜色 / 大小（西瓜、彩色毛毛虫、大鸭子）
function sayNoun(p: SpecialActionParam): string {
  const meta = p.id ? SPECIAL_GAME_MAP[p.id] : undefined
  if (!meta?.say) return ''
  const kind = p.fields.kind
  if (kind && kind !== 'random') {
    const label = meta.fields?.find((f) => f.key === 'kind')?.options.find((o) => o.value === kind)?.label
    if (label) return label
  }
  let noun = meta.say
  const color = p.fields.color
  if (color === 'random') noun = `彩色${noun}`
  else if (color && color !== 'config') noun = `${CATERPILLAR_COLORS.find((c) => c.value === color)?.label ?? ''}${noun}`
  if (p.fields.size === 'big') noun = `大${noun}`
  else if (p.fields.size === 'small') noun = `小${noun}`
  return noun
}

/** 开奖配音念的那句：「锁链加5」「锁链乘以3」「龙卷风卷走20片」；没有数量的（来电、音乐球、清空）返回空 = 不念 */
export function specialVoiceLine(param: string, count: number): string {
  const p = parseSpecialParam(param)
  if (!p.id) return ''
  const meta = SPECIAL_GAME_MAP[p.id]
  const op = meta.ops.find((o) => o.value === p.op) ?? meta.ops[0]
  if (op.count === false || !meta.say) return ''
  const n = Math.max(1, Math.trunc(count) || 1)
  if (op.value === 'accelerate') return `清扫速度乘以${n}`
  if (op.value === 'tornado') return `龙卷风卷走${n}${meta.unit}`
  const word = OP_SAY[op.value]
  return word ? `${sayNoun(p)}${word}${n}` : ''
}

/** 开奖画面上蹦出来的大字：「锁链+5」「锁链×3」；没有数量的是「玩法 操作」 */
export function specialRevealText(param: string, count: number): string {
  const p = parseSpecialParam(param)
  if (!p.id) return ''
  const meta = SPECIAL_GAME_MAP[p.id]
  const op = meta.ops.find((o) => o.value === p.op) ?? meta.ops[0]
  const n = Math.max(1, Math.trunc(count) || 1)
  if (op.count === false) return `${meta.name} ${op.label}`
  if (op.value === 'accelerate') return `清扫×${n}`
  if (op.value === 'tornado') return `龙卷风卷走${n}${meta.unit}`
  if (!meta.say) return n > 1 ? `${meta.name}×${n}` : meta.name
  return `${sayNoun(p)}${op.sign || '+'}${n}`
}

/** 这个事件开出来念什么：关了配音 = 空；自己写了台词用自己的（{数量} 换成这次开出的数量）；不然按玩法自动 */
export function specialBoxEventVoice(ev: Pick<SpecialBoxEvent, 'param' | 'voice' | 'silent'>, count: number): string {
  if (ev.silent) return ''
  const custom = String(ev.voice || '').trim()
  if (custom) return custom.replace(/\{数量\}/g, String(Math.max(1, Math.trunc(count) || 1)))
  return specialVoiceLine(ev.param, count)
}

// 一看符号就懂的操作；别的（加速清扫、直接扫掉）短字里要带上操作名，不然只剩「×2」「−10片」看不出是什么
const PLAIN_OP_LABELS = new Set(['增加', '减少', '乘以', '除以', '打来电话', '打来视频'])

/** 奖池小格子上的短字：玩法名已经在分组标题上，这里只写「+5环」「×3」「加速清扫 ×2」「龙卷风20片」 */
export function specialActionShort(raw: string | undefined): string {
  const p = parseSpecialParam(raw)
  if (!p.id) return specialActionText(raw)
  const meta = SPECIAL_GAME_MAP[p.id]
  const full = specialActionText(raw)
  const rest = full.startsWith(`${meta.name} `) ? full.slice(meta.name.length + 1) : full
  const op = meta.ops.find((o) => o.value === p.op) ?? meta.ops[0]
  return op.sign && op.count !== false && !PLAIN_OP_LABELS.has(op.label) ? `${op.label} ${rest}` : rest
}

export interface SpecialBoxParam {
  /** 勾选的事件 id（顺序 = 勾选顺序） */
  ids: string[]
  /** 事件库里全部启用的事件 */
  all: boolean
  /** 显示名（开出提示、标签用），空 = 「特色盲盒」 */
  name: string
}

/** 盲盒动作参数拆合：事件id,事件id,…|显示名 */
export function parseSpecialBoxParam(raw: string | undefined): SpecialBoxParam {
  const text = String(raw || '')
  const at = text.indexOf('|')
  const head = (at >= 0 ? text.slice(0, at) : text).trim()
  const name = at >= 0 ? text.slice(at + 1).trim() : ''
  if (head === SPECIAL_BOX_ALL) return { ids: [], all: true, name }
  const ids = [...new Set(head.split(',').map((x) => x.trim()).filter(Boolean))]
  return { ids, all: false, name }
}
export function joinSpecialBoxParam(p: SpecialBoxParam): string {
  const head = p.all ? SPECIAL_BOX_ALL : [...new Set(p.ids.map((x) => x.trim()).filter(Boolean))].join(',')
  const name = String(p.name || '').replace(/\|/g, ' ').trim()
  return name ? `${head}|${name}` : head
}
export function specialBoxText(raw: string | undefined): string {
  const p = parseSpecialBoxParam(raw)
  const name = p.name || SPECIAL_BOX_DEFAULT_NAME
  if (p.all) return `「${name}」（事件库全部随机）`
  return p.ids.length ? `「${name}」（${p.ids.length} 选 1）` : `「${name}」（奖池没选）`
}

// ================= 直播画面方向 =================
// 特色整蛊基本都铺满画面，窗口比例必须和直播画面一致（直播伴侣里拉满不变形）。横屏 16:9 / 竖屏 9:16 两档常用分辨率。
export const SPECIAL_SCREEN_PRESETS: { value: string; label: string; w: number; h: number }[] = [
  { value: '1280x720', label: '横屏 1280×720', w: 1280, h: 720 },
  { value: '1920x1080', label: '横屏 1920×1080', w: 1920, h: 1080 },
  { value: '720x1280', label: '竖屏 720×1280', w: 720, h: 1280 },
  { value: '1080x1920', label: '竖屏 1080×1920', w: 1080, h: 1920 }
]
export type SpecialOrientation = 'landscape' | 'portrait'
export function specialOrientation(w: number, h: number): SpecialOrientation {
  return h > w ? 'portrait' : 'landscape'
}
/** 换方向：保持当前清晰度档（高清 / 标清），宽高对调成另一个方向的常用分辨率 */
export function specialSizeFor(orientation: SpecialOrientation, w: number, h: number): { width: number; height: number } {
  const hd = Math.max(w, h) >= 1600
  if (orientation === 'portrait') return hd ? { width: 1080, height: 1920 } : { width: 720, height: 1280 }
  return hd ? { width: 1920, height: 1080 } : { width: 1280, height: 720 }
}

// ================= 动作参数：`玩法|操作|数量|选项` =================
// 例：catch_duck|add|5|size=big      throw_trash|add|3~8|size=small;kind=burger      music_ball|start
// 数量可以写范围「3~8」（也认「3,8」），执行时在范围里随机取整数；选项是 key=value 用 ; 隔开。

export interface SpecialActionParam {
  id: SpecialGameId | ''
  op: string
  /** 原样保留的数量串（可能是范围） */
  count: string
  fields: Record<string, string>
}

export function parseSpecialParam(raw: string | undefined): SpecialActionParam {
  const parts = String(raw || '').split('|').map((s) => s.trim())
  const id = (SPECIAL_GAME_MAP[parts[0]] ? parts[0] : '') as SpecialGameId | ''
  const meta = id ? SPECIAL_GAME_MAP[id] : undefined
  const op = meta && meta.ops.some((o) => o.value === parts[1]) ? parts[1] : meta?.ops[0]?.value || 'add'
  const fields: Record<string, string> = {}
  for (const pair of String(parts[3] || '').split(';')) {
    const at = pair.indexOf('=')
    if (at <= 0) continue
    const key = pair.slice(0, at).trim()
    const value = pair.slice(at + 1).trim()
    const spec = meta?.fields?.find((f) => f.key === key)
    if (spec && spec.options.some((o) => o.value === value)) fields[key] = value
  }
  return { id, op, count: parts[2] ?? '', fields }
}

export function joinSpecialParam(p: SpecialActionParam): string {
  const meta = p.id ? SPECIAL_GAME_MAP[p.id] : undefined
  const op = meta?.ops.find((o) => o.value === p.op) ?? meta?.ops[0]
  const needsCount = op?.count !== false
  const fields = Object.entries(p.fields || {})
    .filter(([key, value]) => {
      const spec = meta?.fields?.find((f) => f.key === key)
      return !!spec && value !== spec.def && spec.options.some((o) => o.value === value)
    })
    .map(([key, value]) => `${key}=${value}`)
    .join(';')
  const count = needsCount ? String(p.count ?? '').trim() : ''
  return [p.id, op?.value ?? p.op, count, fields].join('|').replace(/\|+$/, '')
}

/** 新建一条特色整蛊动作时的默认参数：默认操作 + 默认随机数量（没有随机范围的玩法用固定常用值） */
export function specialDefaultParam(id: SpecialGameId): string {
  const meta = SPECIAL_GAME_MAP[id]
  return joinSpecialParam({ id, op: meta.ops[0].value, count: meta.countRange || String(meta.countDef), fields: {} })
}

/** 数量串 → 正整数（范围随机）；空 / 非法回退 def。不设上限，只防非数字。 */
export function resolveSpecialCount(raw: string | number | undefined, def: number): number {
  const text = String(raw ?? '').trim()
  const range = text.match(/^(\d+)\s*[~～,，-]\s*(\d+)$/)
  if (range) {
    const a = Number(range[1]), b = Number(range[2])
    const lo = Math.min(a, b), hi = Math.max(a, b)
    if (Number.isSafeInteger(lo) && Number.isSafeInteger(hi)) return Math.max(1, lo + Math.floor(Math.random() * (hi - lo + 1)))
  }
  const n = Math.trunc(Number(text))
  return Number.isSafeInteger(n) && n >= 1 ? n : Math.max(1, Math.trunc(def) || 1)
}

/** 动作的中文短描述：「抓鸭子 +5只 · 大鸭子」「锁链特效 ×2」「音乐球 开始一局」 */
export function specialActionText(raw: string | undefined): string {
  const p = parseSpecialParam(raw)
  if (!p.id) return '特色整蛊（未选玩法）'
  const meta = SPECIAL_GAME_MAP[p.id]
  const op = meta.ops.find((o) => o.value === p.op) ?? meta.ops[0]
  let text = meta.name
  if (op.count === false) text += ` ${op.label}`
  else {
    const count = p.count.trim() || String(meta.countDef)
    const unit = op.countLabel === '倍数' ? '' : meta.unit
    text += op.sign ? ` ${op.sign}${count}${unit}` : ` ${op.label}${count}${unit}`
  }
  for (const f of meta.fields ?? []) {
    const v = p.fields[f.key]
    if (v && v !== f.def) text += ` · ${f.options.find((o) => o.value === v)?.label ?? v}`
  }
  return text
}
