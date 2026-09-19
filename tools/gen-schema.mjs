// 从 mod 源码 Config.cs 提取 ConfigData 属性，生成参数编辑器真实 schema
// 用法: node tools/gen-schema.mjs <Config.cs路径> [输出路径]
import fs from 'fs'
import path from 'path'

const src = process.argv[2] ?? 'C:/wheellive/mod/Config.cs'
const out = process.argv[3] ?? 'mods-catalog/schemas/config.schema.json'

const code = fs.readFileSync(src, 'utf-8').replace(/^﻿/, '')

// 只取 ConfigData 类块内的内容
const clsStart = code.indexOf('public class ConfigData')
if (clsStart < 0) throw new Error('找不到 ConfigData 类')
const afterCls = code.slice(clsStart)
let clsEnd = afterCls.indexOf('\n}')
if (clsEnd < 0) clsEnd = afterCls.length
const body = afterCls.slice(0, clsEnd)

const FIELD_RE =
  /^\s*public\s+([A-Za-z][A-Za-z0-9_<>,.\[\] ]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*get;\s*set;\s*\}\s*(?:=\s*([^;]*))?;[ \t]*(?:\/\/[ \t]*(.*))?$/

const COMPLEX =
  /Dictionary|List|KeyValuePair|Vector|Color|GameObject|string\[\]|Queue|Stack|Func|Action/

// 找属性上方的注释块（Config.cs 的注释大多写在属性上一行），返回最上面那行作标题
function commentAbove(lines, i) {
  const group = []
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim()
    if (t.startsWith('//')) { group.unshift(t.replace(/^\/\/\s*/, '').trim()); continue }
    break
  }
  return group[0] ?? ''
}

const fields = []
const lines = body.split(/\r?\n/)
const CLASS_RE = /^\s*public\s+(?:static\s+)?class\s+\w+/
let nestedDepth = 0 // 嵌套类(WorkCustom/LedgerEntry…)的花括号深度，>0 = 正在跳过
let inNested = false
let nestedOpen = false // 是否已见到类体的 `{`（类声明行本身可能不带大括号）
let seenConfig = false // body 第一行必是 ConfigData 声明，它要跳过、但不是要跳过的嵌套类
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  // 嵌套辅助类是内部记录结构(WorkCustom/WorkLogEntry/LedgerEntry/SpeedRec/CustomBoxDef/ViewerStat)，
  // 不是可调参数，整体跳过——否则 Id/Name/Who/What 之类会混进参数表
  if (!inNested && CLASS_RE.test(line)) {
    if (!seenConfig) {
      seenConfig = true
      continue // ConfigData 声明行本身：只跳过这一行，继续收集它的顶层属性
    }
    inNested = true
    nestedDepth = 0
    nestedOpen = false
  }
  if (inNested) {
    nestedDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    if (nestedDepth > 0) nestedOpen = true
    if (nestedOpen && nestedDepth <= 0) inNested = false
    continue
  }
  const m = lines[i].match(FIELD_RE)
  if (!m) continue
  const typeRaw = m[1].trim()
  const name = m[2]
  const defaultRaw = (m[3] ?? '').trim()
  let comment = (m[4] ?? '').trim()
  if (!comment) comment = commentAbove(lines, i)

  if (COMPLEX.test(typeRaw) || typeRaw.includes(' ')) continue

  let type
  if (/^bool$/.test(typeRaw)) type = 'boolean'
  else if (/^(int|uint|long|ulong|short|float|double|decimal)$/.test(typeRaw)) type = 'number'
  else if (/^string$/.test(typeRaw)) type = 'string'
  else continue // 其它类型跳过

  // 默认值解析
  let def
  if (/^new\s/.test(defaultRaw)) continue
  if (type === 'boolean') def = defaultRaw === 'true' ? true : false
  else if (type === 'number') {
    const n = parseFloat(defaultRaw.replace(/[fFdDmM]$/, ''))
    def = Number.isFinite(n) ? n : 0
  } else {
    def = defaultRaw.startsWith('"') ? defaultRaw.replace(/^"|"$/g, '') : defaultRaw
  }

  fields.push({ key: name, type, default: def, comment, label: cleanLabel(name, comment) })
}

// 分组：按整蛊类型细分 + 业务域，按字段名前缀精确匹配（顺序即显示顺序）
const GROUPS = [
  { id: 'system', name: '系统与音效', match: /^(Enabled|MenuKey|ErrorReport|DebugLog|IgnoredUpdateVersion|ShareAuthor|UnstuckPanicKeySet|SoundOn|SoundVolume|ShowVideoFx)$/ },
  { id: 'protect', name: '护体与防死', match: /^(Protect|StuckGuards|EasyMode|EasyLevel|AutoRespawnAll|RespawnInvuln|KillDeathShowSec|VoidDeath|VoidDepth|OutlineR|OutlineG|OutlineB|BulletHellEasyDrop)/ },
  { id: 'prank-rocket', name: '整蛊·火箭与爆炸', match: /^(Rocket|Bomb|Rain|MachineGun|Gun|WeaponAmmo|LaunchPower|BlastPower|SuperMissile|Homing|SkyDrop|Smash|Explo|Knock)/ },
  { id: 'prank-duck', name: '整蛊·鸭子', match: /^Duck/ },
  { id: 'prank-thunder', name: '整蛊·雷电与禁锢', match: /^(Lightning|Thunder|SpaceLock)/ },
  { id: 'prank-thrust', name: '整蛊·速度与推力', match: /^(SuperJump|Nitro|Jetpack|BoostPower|FastSpeed|SlowSpeed|Push|Spin|Tip|LowGrav|MoonGrav|AntiGrav|HeavyGrav)/ },
  { id: 'prank-scale', name: '整蛊·体型缩放', match: /^(Giant|Mini|Scale)/ },
  { id: 'prank-fx', name: '整蛊·黑科技', match: /^(Blackhole|Arrow|Quake|BulletHell)/ },
  { id: 'record', name: '纪录与计数', match: /^(CountDeaths|CountClears|DeathShow|ClearShow|CountWindow|TotalHudDefaultOn|PranksTakenTotal|FollowsEver|Achieve|SpeedRecord|TopSpeed|Fly|FinishGate|FirstKill|ShowFirstKillHud)/ },
  { id: 'hud', name: '显示与界面', match: /^(ShowHudMaster|Show.*Hud|ShowGiftFeed|GiftFeedRows|DeathHud|HudScale|Menu[XYWH]|AnnounceScale|ShowWatermark|Watermark|DeathLabel|ShowLiveStatusHud)/ },
  { id: 'board', name: '观众榜与界面', match: /^(ShowViewerBoard|Board|Leaderboard|ShowAvatars|AnchorNameMax|BannerNickMax|LedgerNickMax)/ },
  { id: 'live', name: '直播互动', match: /^(Like|ShowLikeBar|BoxAnnounce|BoxRoll|GiftFire|FollowBox|BadgeBox|LiveRoom|AnchorName$)/ },
  { id: 'work', name: '上班打卡', match: /^Work/ },
  { id: 'multi', name: '联机', match: /^(Coop|Peer|Sync|KillFeedEnabled)/ }
]

function groupOf(name, label) {
  for (const g of GROUPS) if (g.match.test(name)) return g.id
  return 'other'
}

// 不暴露给用户的内部/次要参数：迁移旗、调试日志、布局坐标微调、颜色分量(RGB 三个滑条)、水印，
// 以及 mod 自动写入的记录/状态字段（终身计数、历史纪录、首杀文案、续班存档——这些是 mod 记的数，主播不该手动改）
const HIDDEN_RE =
  /^(MenuKey|Enabled|ErrorReport|DebugLog|IgnoredUpdateVersion|ShareAuthor|UnstuckPanicKeySet|ProtectPerfectSet|TotalHudDefaultOn|BoardCompactSet|ShowWatermark|WatermarkAlpha|ShowDeathHud|DeathHudH|DeathHudY|MenuY|MenuH|OutlineR|OutlineG|OutlineB|BoardColorR|BoardColorG|BoardColorB|WorkTextR|WorkTextG|WorkTextB|PranksTakenTotal|FollowsEver|FirstKillHudText|FirstKillHudEmptyText|FirstKillDate|FirstKillName|TopSpeedEver|TopSpeedBy|FlyBestEver|FlyBestBy|WorkSavedRunning|WorkSavedRemainSec)$/

// 布局类（位置/尺寸，游戏内布局模式拖动调整，工作台不暴露）：菜单窗口、死亡计数窗口
const LAYOUT_RE =
  /^(MenuX|MenuW|DeathHudX|DeathHudW)$/

// C# 注释没写中文、但主播会调的重要参数，补中文标题
const LABEL_OVERRIDE = {
  SoundVolume: '特效音量',
  SuperJumpGrav: '超级跳·重力削弱',
  SuperJumpBoost: '超级跳·弹射增益',
  NitroMaxSpeed: '氮气·速度上限',
  JetpackRise: '喷气背包·上升速度',
  JetpackAccel: '喷气背包·加速度',
  LightningRadius: '雷击范围',
  LightningScorchSec: '雷击灼烧秒数',
  SuperMissileRadius: '超级导弹·爆炸半径',
  SuperMissilePower: '超级导弹·威力',
  BoardShowFly: '榜单·飞行榜',
  BoardShowKill: '榜单·击杀榜',
  BoardShowDuck: '榜单·鸭榜',
  DuckMissText: '鸭子落空文案',
  DuckCountText: '鸭群数量文案',
  ProtectOnText: '护体开启文案',
  ProtectTimeText: '护体剩余文案',
  SuperJumpText: '超级跳文案',
  NitroText: '氮气文案',
  JetpackText: '喷气背包文案',
  ArrowHitText: '箭命中文案',
  LikeBarLabel: '点赞条文案',
  BadgeBoxId: '灯牌盲盒 Id',
  LikeBoxId: '点赞盲盒 Id',
  FollowBoxId: '关注盲盒 Id',
  DeathLabel: '死亡提示文案',
  FirstKillEnabled: '今日首杀记录',
  BulletHellEnabled: '枪林弹雨模式开关'
}

// 固定枚举字段：本质是"选一项"而非调数值，给下拉。value 保持数字(和 config.json 存的一致)
const SELECT_OPTIONS = {
  CoopCastTarget: { label: '礼物整谁', options: [{ value: 0, label: '整自己' }, { value: 1, label: '整对面主播' }, { value: 2, label: '双方随机' }] },
  DuckMode: { label: '抓鸭·落鸭模式', options: [{ value: 0, label: '爆炸（落地炸开消失）' }, { value: 1, label: '挡道（落地当路障）' }] },
  BoardWindow: { label: '观众榜时间窗', options: [{ value: 0, label: '今日' }, { value: 1, label: '本周' }, { value: 2, label: '本月' }, { value: 3, label: '总' }, { value: 4, label: '本年' }] },
  BoardAlign: { label: '观众榜对齐方式', options: [{ value: 0, label: '靠左' }, { value: 1, label: '居中' }, { value: 2, label: '靠右' }] },
  CountWindow: { label: '记分板时间窗', options: [{ value: 0, label: '今日' }, { value: 1, label: '本周' }, { value: 2, label: '本月' }, { value: 3, label: '总' }] },
  FlyCreditMode: { label: '飞天榜功臣归因', options: [{ value: 0, label: '一场飞行内送礼最多者' }, { value: 1, label: '最先触发者' }, { value: 2, label: '最后触发者' }] },
  WorkZeroAction: { label: '归零行为', options: [{ value: 0, label: '大字庆祝 + 号角' }, { value: 1, label: '小字提示' }, { value: 2, label: '安静' }] }
}

// 这三个是「某个触发源开哪个盒」：选项 = 用户自定义盲盒(动态，前端从 CustomBoxes 生成)，空 = 纯机选大盲盒
const BOX_PICKER_KEYS = ['FollowBoxId', 'BadgeBoxId', 'LikeBoxId']

// 百分比/比例类字段补滑条范围：概率/程度/透明度/音量/0~1 系数给 0~1，程度类给 0~100
function percentRange(name, def) {
  if (/^(EasyLevel|BulletHellEasyDrop)$/.test(name)) return { min: 0, max: 100, step: 1 }
  // 概率类默认值是百分比整数(>1) → 0~100
  if (/Chance/.test(name) && typeof def === 'number' && def > 1) return { min: 0, max: 100, step: 1 }
  const is01 =
    /Chance|Alpha|Volume|Vol$|Damp|RarityK|JackpotBoost|ShockSlow|SpeedGain|JumpGain/.test(name) ||
    (/Mul|Scale/.test(name) && typeof def === 'number' && def > 0 && def <= 1)
  if (is01) return { min: 0, max: 1, step: 0.01 }
  return null
}

// 个别注释批注太重、正则清不干净的字段，直接写说明
const DESC_OVERRIDE = {
  ShowHeightHud: '实时高度（相对最近安全点，站着≈0）',
  BoardCycle: '今日→本月→世界总榜 自动轮着放，带切页动画',
  BoardNameMax: '榜上昵称最多显示几个字，超出省略号',
  AnchorNameMax: '主播+联机对手名牌上屏最多几个字'
}

// 说明文字：C# 注释清掉版本号/用户点名/分隔线等开发批注后作 desc，与 label 重复则省略
function makeDesc(name, comment) {
  if (DESC_OVERRIDE[name]) return DESC_OVERRIDE[name]
  let c = comment
    .replace(/^[★☆*◆]+/, '')
    .replace(/^[=‐—\-]+/, '')
    .replace(/^（旧[^）]*）\s*/, '')
    .replace(/^\(旧[^)]*\)\s*/, '')
    .replace(/^旧·已弃用[，,、\s]*/, '')
    .trim()
  if (!c) return ''
  c = c
    .replace(/[（(]\s*v[0-9][^）)]*[）)]/g, '') // (v0.9.11 默认开)
    .replace(/[（(]\s*20\d\d[-/]\d{1,2}[-/]\d{1,2}[^）)]*[）)]/g, '') // (2026-08-03 用户点名)
    .replace(/[。；，,]?\s*[★]?用户\s*20\d\d[-/]\d{1,2}[-/]\d{1,2}\s*[:：]?\s*[「『][^」』]*[」』]?/g, '') // 用户 2026 「引用」
    .replace(/[。；，,]?\s*★[vV][0-9][^。；]*/g, '') // ★v2(2026-08-01)…
    .replace(/[=－_—~*☆★]+$/, '') // 尾部装饰线
    .trim()
  if (!c) return ''
  const label = LABEL_OVERRIDE[name] ?? cleanLabel(name, comment)
  if (c === label) return ''
  if (c.startsWith(label) && c.length - label.length <= 3) return ''
  return c.slice(0, 80)
}

const groupList = GROUPS.map((g) => ({ id: g.id, name: g.name }))

const fieldDefs = fields.map((f) => {
  const range = percentRange(f.key, f.default)
  const desc = makeDesc(f.key, f.comment)
  const sel = SELECT_OPTIONS[f.key]
  const boxPicker = BOX_PICKER_KEYS.includes(f.key)
  return {
    key: f.key,
    label: sel?.label ?? LABEL_OVERRIDE[f.key] ?? f.label,
    type: sel ? 'select' : boxPicker ? 'select' : f.type,
    group: groupOf(f.key, f.label),
    default: f.default,
    // 下拉的选项本身就是说明，枚举字段不重复挂 desc；盲盒选择保留 desc 解释语义
    ...(sel ? {} : desc ? { desc } : {}),
    ...(sel ? { options: sel.options } : {}),
    ...(boxPicker ? { boxPicker: true } : {}),
    ...(range ? { min: range.min, max: range.max, step: range.step } : {}),
    ...(HIDDEN_RE.test(f.key) || LAYOUT_RE.test(f.key)
      ? { hidden: true }
      : {})
  }
})
const schema = {
  version: '1.0.0',
  generatedFrom: src,
  generatedAt: new Date().toISOString().slice(0, 10),
  groups: groupList,
  fields: fieldDefs
}

fs.writeFileSync(out, JSON.stringify(schema, null, 2), 'utf-8')
console.log(`✅ 生成 ${fields.length} 个字段 -> ${out}`)

// ===== 快捷键清单：解析同目录 Pranks.cs 的 Add/AddOrReplace(id, 中文名, cat) 提取 =====
const pranksSrc = path.join(path.dirname(src), 'Pranks.cs')
const PRANK_CAT_NAME = {
  Target: '定向整主播', Smash: '观众互动', Weapon: '军火武器', Teleport: '传送',
  Level: '关卡联机', Chaos: '全场混乱', Fun: '搞笑视觉', Versus: '整对手联机', Assist: '辅助护体'
}
let pranks = []
if (fs.existsSync(pranksSrc)) {
  const pcode = fs.readFileSync(pranksSrc, 'utf-8').replace(/^﻿/, '')
  const PRANK_RE = /Add(?:OrReplace)?\("([A-Za-z0-9_]+)",\s*"([^"]+)",\s*PrankCat\.(\w+)/g
  let m
  while ((m = PRANK_RE.exec(pcode))) {
    pranks.push({
      id: m[1],
      name: m[2].trim(),
      cat: PRANK_CAT_NAME[m[3]] ?? m[3]
    })
  }
}
const pranksOut = out.replace('config.schema.json', 'pranks.json')
fs.writeFileSync(pranksOut, JSON.stringify(pranks, null, 2), 'utf-8')
console.log(`✅ 生成 ${pranks.length} 个快捷键条目 -> ${pranksOut}`)

// ===== 原生默认键位：从 Config.cs 提取 ApplyDefaultBinds 写死的键 + 复刻 EnsureDefaultBinds 的自动分配 =====
// 游戏启动时会给每个没绑键的整蛊自动分配键位(EnsureDefaultBinds，只补缺失不改已有)，
// 所以 config.json 里会残留旧版本的旧键/错键。这里把「当前源码会分配的原生键位」原样算出来，
// 前端快捷键页用来显示没绑定时的默认键、以及「恢复默认键位」一键刷回。
function extractMethodBody(codeStr, methodDecl) {
  const i = codeStr.indexOf(methodDecl)
  if (i < 0) return ''
  const open = codeStr.indexOf('{', i)
  if (open < 0) return ''
  let depth = 0, j = open
  while (j < codeStr.length) {
    if (codeStr[j] === '{') depth++
    else if (codeStr[j] === '}') { depth--; if (depth === 0) return codeStr.slice(open + 1, j) }
    j++
  }
  return ''
}
function extractPropDefault(codeStr, prop) {
  const re = new RegExp(`public\\s+string\\s+${prop}\\s*\\{\\s*get;\\s*set;\\s*\\}\\s*=\\s*"([^"]+)"`)
  const m = codeStr.match(re)
  return m ? m[1] : ''
}
function computeDefaultBinds(pranks, codeStr) {
  const body = extractMethodBody(codeStr, 'private static void ApplyDefaultBinds()')
  const hardcoded = {}
  const PAIR_RE = /\{\s*"([A-Za-z0-9_]+)"\s*,\s*"([A-Za-z0-9_+]+)"\s*\}/g
  let mm
  while ((mm = PAIR_RE.exec(body))) hardcoded[mm[1]] = mm[2]
  const menuKey = extractPropDefault(codeStr, 'MenuKey')
  const leaderboardKey = extractPropDefault(codeStr, 'LeaderboardKey')
  const mods = ['', 'Ctrl+', 'Shift+', 'Alt+', 'Ctrl+Shift+', 'Ctrl+Alt+', 'Shift+Alt+', 'Ctrl+Shift+Alt+']
  const keys = []
  for (let i = 1; i <= 9; i++) keys.push('Alpha' + i)
  keys.push('Alpha0')
  for (let i = 1; i <= 12; i++) keys.push('F' + i)
  const pool = []
  for (const mod of mods)
    for (const k of keys) {
      const combo = mod + k
      if (combo === menuKey || combo === leaderboardKey) continue
      pool.push(combo)
    }
  const used = new Set(Object.values(hardcoded))
  const binds = {}
  let pi = 0
  for (const p of pranks) {
    if (hardcoded[p.id]) { binds[p.id] = hardcoded[p.id]; continue }
    while (pi < pool.length && used.has(pool[pi])) pi++
    if (pi >= pool.length) break
    binds[p.id] = pool[pi]
    used.add(pool[pi]); pi++
  }
  return { menu: menuKey, leaderboard: leaderboardKey, binds }
}
const defaultBinds = computeDefaultBinds(pranks, code)
const bindsOut = out.replace('config.schema.json', 'default_binds.json')
fs.writeFileSync(bindsOut, JSON.stringify(defaultBinds, null, 2), 'utf-8')
console.log(`✅ 生成 ${Object.keys(defaultBinds.binds).length} 个原生默认键位 -> ${bindsOut}`)

console.log('按分组:')
console.log('按分组:')
const byG = {}
for (const f of fieldDefs) byG[f.group] = (byG[f.group] ?? 0) + 1
console.log(byG)

function cleanLabel(name, comment) {
  let c = comment
    .replace(/^[★☆*◆]+/, '')
    .replace(/^[=‐—\-]+/, '')
    .replace(/^（旧[^）]*）\s*/, '')
    .replace(/^\(旧[^)]*\)\s*/, '')
    .replace(/^旧·已弃用[，,、\s]*/, '')
    // 清掉版本号/用户点名等开发批注，避免混进标题
    .replace(/^[vV][0-9]+(\.[0-9]+)*[：:，,、\s]*/, '')
    .replace(/[。；，,]?\s*[★]?用户\s*20\d\d[-/]\d{1,2}[-/]\d{1,2}[^。；]*[。；]?/g, '')
    .replace(/[（(]\s*v[0-9][^）)]*[）)]/g, '')
    .replace(/[（(]\s*20\d\d[-/]\d{1,2}[-/]\d{1,2}[^）)]*[）)]/g, '')
    .trim()
  if (!c || !/[一-鿿]/.test(c)) return name
  // 取「：/；/——」前的短语作短标题
  const cut = c.split(/[：:；;——]/)[0].trim()
  if (cut) c = cut
  // 去尾部括号说明与标点
  c = c.replace(/[（(].*$/, '').replace(/[。.！!？?、，,\s]+$/, '').trim()
  return (c || name).slice(0, 24)
}
