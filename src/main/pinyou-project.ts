// 品游式「项目」：一个项目就是一个文件夹（2026-09-07 用户原话「人家的管理是一个项目就是一个文件夹，
// 然后盲盒可以触发这个文件夹里面的东西」）。
//
// 文件夹里是「视频 + 同名 .脚本」成对：
//   加减播1-60分钟/
//     -10分.mp4        ← 播这个
//     -10分.脚本       ← 同时执行「加班减少:600秒」
// 触发一个项目 = 从里面随机抽一条，播它的视频，并把它同名脚本里的动作也执行掉。
//
// 主播真实素材库（F:\知了猴工作室\视频，23 个项目 574 个视频）里两类项目都有：
//   带脚本的：加减播1-60分钟 38/37、翻牌子时间 57/56、虚拟主播时间 61/59
//   纯视频的：刮刮乐作业 86/0、翻牌子作业 60/0、抓鸭子 26/0 —— 只播视频，没有附加动作
// 所以「没有脚本」是正常情况，不是错误。
//
// 为什么不能用现成的 video-random：它只播视频，不认旁边的 .脚本；random-script 反过来只跑脚本
// 不播视频。品游的精髓正是这两者绑在一条条目上。
import fs from 'fs'
import path from 'path'
import { decodeText } from './pinyou-file'
import { parsePinyouScript, type PinyouScriptCommand } from '../shared/pinyou'
import { getSettings } from './settings'

const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|flv|wmv)$/i
const SCRIPT_EXT = '.脚本'

export interface ProjectItem {
  /** 条目名（视频文件去掉扩展名），如「-10分」 */
  name: string
  video: string
  /** 同名 .脚本 的绝对路径；纯视频项目没有 */
  script?: string
}

export interface ProjectInfo {
  name: string
  dir: string
  videos: number
  scripts: number
  /** 有视频且有同名脚本的条目数 */
  paired: number
}

/** 素材根目录候选：设置里指定的 → 下载目录下的 pinyou-assets */
export function assetRoots(): string[] {
  const s = getSettings()
  const out: string[] = []
  const configured = String((s as { pinyouAssetRoot?: string }).pinyouAssetRoot || '').trim()
  if (configured) out.push(configured)
  if (s.downloadDir) out.push(path.join(s.downloadDir, 'pinyou-assets'))
  return out.filter((p, i) => p && out.indexOf(p) === i)
}

/**
 * 把脚本里写的目录解析成真实路径。
 * 品游脚本里写的是【相对项目名】（「播放视频:哈喽体力转盘\随机播放[绿幕2]」），
 * 不是绝对路径，所以要在素材根目录下找同名文件夹。
 */
export function resolveProjectDir(raw: string, extraRoots: string[] = []): string | null {
  const want = String(raw || '').trim().replace(/[\\/]+$/, '')
  if (!want) return null
  const isDir = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  }
  if (path.isAbsolute(want) && isDir(want)) return want
  // extraRoots：正在执行的项目所在的目录先找——品游脚本里「播放视频:哈喽体力转盘\随机播放」写的是同一个素材库里的兄弟项目，
  //   主播没在设置里填素材目录、规则里用的是绝对路径时（2026-09-11 用户就是这样），只有这条路能解析出来
  for (const root of [...extraRoots, ...assetRoots()]) {
    const direct = path.join(root, want)
    if (isDir(direct)) return direct
    // 品游脚本里可能写多层（「A\B」），也可能大小写不一致
    try {
      const hit = fs.readdirSync(root).find((n) => n.toLowerCase() === want.toLowerCase())
      if (hit && isDir(path.join(root, hit))) return path.join(root, hit)
    } catch {
      /* 这个根目录读不了，看下一个 */
    }
  }
  return isDir(want) ? want : null
}

/** 列出一个项目里的全部条目（视频 + 同名脚本） */
export function projectItems(dir: string): ProjectItem[] {
  let files: string[] = []
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }
  const scripts = new Set(files.filter((f) => f.endsWith(SCRIPT_EXT)))
  return files
    .filter((f) => VIDEO_RE.test(f))
    .map((f) => {
      const name = f.slice(0, f.length - path.extname(f).length)
      const script = scripts.has(name + SCRIPT_EXT) ? path.join(dir, name + SCRIPT_EXT) : undefined
      return { name, video: path.join(dir, f), script }
    })
}

/** 随机抽一条。上一次抽到的不连着再抽（只有一条时除外），免得连着触发老是同一个 */
const lastPicked = new Map<string, string>()
export function pickProjectItem(dir: string): ProjectItem | null {
  const items = projectItems(dir)
  if (!items.length) return null
  if (items.length === 1) return items[0]
  const prev = lastPicked.get(dir)
  const pool = items.filter((i) => i.video !== prev)
  const picked = (pool.length ? pool : items)[Math.floor(Math.random() * (pool.length || items.length))]
  lastPicked.set(dir, picked.video)
  return picked
}

/** 读一条 .脚本 的文本（品游是 GBK） */
export function readScript(file: string): string {
  try {
    return decodeText(fs.readFileSync(file))
  } catch {
    return ''
  }
}

/** 扫素材根目录，列出所有项目——「导入品游项目」页要用 */
export function listProjects(rootArg?: string): { root: string; projects: ProjectInfo[]; error?: string } {
  const root = String(rootArg || '').trim() || assetRoots()[0] || ''
  if (!root) return { root: '', projects: [], error: '还没有指定品游素材目录' }
  let names: string[] = []
  try {
    names = fs.readdirSync(root)
  } catch (e) {
    return { root, projects: [], error: '读不到这个目录：' + String((e as Error).message || e) }
  }
  const projects: ProjectInfo[] = []
  for (const name of names) {
    const dir = path.join(root, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    let files: string[] = []
    try {
      files = fs.readdirSync(dir)
    } catch {
      continue
    }
    const videos = files.filter((f) => VIDEO_RE.test(f))
    const scripts = new Set(files.filter((f) => f.endsWith(SCRIPT_EXT)))
    if (!videos.length) continue // 没视频的目录不算项目（比如放图片/字体的）
    const paired = videos.filter((v) => scripts.has(v.slice(0, v.length - path.extname(v).length) + SCRIPT_EXT)).length
    projects.push({ name, dir, videos: videos.length, scripts: scripts.size, paired })
  }
  projects.sort((a, b) => b.videos - a.videos || a.name.localeCompare(b.name, 'zh'))
  return { root, projects }
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i

export interface MediaFile {
  name: string
  path: string
  type: 'video' | 'image'
  size: number
}

/**
 * 列一个文件夹里的绿幕素材（视频 + 图片）。
 * 绿幕原来只能一个个挑文件，主播素材动辄几十上百个（真实素材库里「刮刮乐作业」86 个），
 * 逐个选根本用不起来 —— 这个给「素材文件夹」用。
 */
export function listMedia(dir: string): { dir: string; files: MediaFile[]; error?: string } {
  const target = String(dir || '').trim()
  if (!target) return { dir: '', files: [], error: '没有选择文件夹' }
  let names: string[] = []
  try {
    names = fs.readdirSync(target)
  } catch (e) {
    return { dir: target, files: [], error: '读不到这个文件夹：' + String((e as Error).message || e) }
  }
  const files: MediaFile[] = []
  for (const name of names) {
    const full = path.join(target, name)
    const video = VIDEO_RE.test(name)
    const image = !video && IMAGE_RE.test(name)
    if (!video && !image) continue
    let size = 0
    try {
      const st = fs.statSync(full)
      if (!st.isFile()) continue
      size = st.size
    } catch {
      continue
    }
    files.push({ name, path: full, type: video ? 'video' : 'image', size })
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
  return { dir: target, files }
}

/** 项目里每个条目连同它脚本里的动作 —— 「按条目导入」用 */
/**
 * 把别人导出的规则里的素材路径改到本机的素材目录。
 *
 * 导出的 JSON 带的是绝对路径（对方机器上的 `F:\知了猴工作室\视频\虚拟主播时间`），
 * 本机素材目录大概率不在同一个盘。按【项目文件夹名】在本机素材库里重新定位：
 * 路径里从后往前找第一个能对上本机项目名的段，把它前面那截换成本机的项目目录。
 *
 * 找不到的不瞎改（保留原路径），并把缺的项目名报回去 —— 对方缺的是视频素材本身，
 * 得让主播知道「把这个文件夹放进你的素材目录」。
 */
export function relocateRules(rules: unknown[]): {
  rules: Record<string, unknown>[]
  moved: number
  missing: string[]
} {
  const projects = listProjects().projects
  const byName = new Map(projects.map((p) => [p.name, p.dir]))
  const missing = new Set<string>()
  let moved = 0

  const relocatePath = (raw: string): string | null => {
    const parts = String(raw || '').split(/[\\/]/).filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      const dir = byName.get(parts[i])
      if (!dir) continue
      const next = path.join(dir, ...parts.slice(i + 1))
      if (fs.existsSync(next)) return next
      // 项目文件夹在、但里面少这个视频：仍然改到本机项目目录（规则还能用，缺的是素材）
      return next
    }
    // 一个段都对不上：把看起来像项目名的那段（最后一个目录名）报出来
    const guess = parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1]
    if (guess) missing.add(guess)
    return null
  }

  const fixParam = (value: unknown): string | null => {
    const raw = String(value ?? '')
    if (!raw) return null
    // 参数形如 `<路径>` / `<路径>|绿幕2` / `<视频>|3.5`
    const cut = raw.lastIndexOf('|')
    const head = cut > 1 ? raw.slice(0, cut) : raw
    const tail = cut > 1 ? raw.slice(cut) : ''
    if (fs.existsSync(head)) return null // 本机就有这条路径，不动
    const next = relocatePath(head)
    return next ? next + tail : null
  }

  const MEDIA_CMDS = new Set(['project-random', 'video-play', 'video-random', 'sound-random', 'video-gif'])
  const out = (Array.isArray(rules) ? rules : []).map((item) => {
    const rule = { ...(item as Record<string, unknown>) }
    if (rule.actionType === 'command' && MEDIA_CMDS.has(String(rule.commandCmd))) {
      const next = fixParam(rule.commandParam)
      if (next) {
        rule.commandParam = next
        moved += 1
      }
    }
    if (Array.isArray(rule.extraActions)) {
      rule.extraActions = (rule.extraActions as Record<string, unknown>[]).map((action) => {
        if (!action || action.actionType !== 'command' || !MEDIA_CMDS.has(String(action.commandCmd))) return action
        const next = fixParam(action.commandParam)
        if (!next) return action
        moved += 1
        return { ...action, commandParam: next }
      })
    }
    return rule
  })
  return { rules: out, moved, missing: [...missing] }
}

export function projectEntries(dir: string): { name: string; video: string; commands: PinyouScriptCommand[] }[] {
  return projectItems(dir).map((it) => ({
    name: it.name,
    video: it.video,
    commands: it.script ? parsePinyouScript(readScript(it.script)).commands : []
  }))
}
