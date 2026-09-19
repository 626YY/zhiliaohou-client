// 素材自动瘦身：主播的礼物视频常常是 4K（真机日志里见过 3852×1280），却播在 640×360 的绿幕窗口里。
// 实测同一个窗口：360p 素材页面进程私有内存 34MB、1080p 90MB、4K 437MB 且 CPU 13%（软件解码）——两三条 4K 同时播就是一个多 GB，
// 这是内存峰值和被系统终止的头号来源。这里把超过「最高分辨率」的视频在后台压一份缓存副本（默认 720p，设置页可调），
// 之后播放一律用副本；第一次遇到某个文件先照播原片、同时排队压制，不阻塞礼物。
//   · 只处理本地视频文件；图片 / 网络地址 / 已经够小的原样返回
//   · 压制走随包的 ffmpeg（resources/ffmpeg/ffmpeg.exe；开发态用仓库 ffmpeg/ 或 PATH）；一次一条、低优先级、限 2 线程，内存告急时暂停
//   · 缓存 userData/media-cache，按 (路径, 大小, 修改时间, 目标高度) 命中；总量超过上限按最久未用删
//   · 音轨保留（转 AAC 128k），画面 H.264 veryfast CRF 23，faststart
import { app } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { getSettings } from './settings'
import { logLine } from './crash-log'
import { memoryLevel } from './memory-guard'

const VIDEO_RE = /\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv|ts|mpg|mpeg)$/i
type Entry = { key: string; src: string; size: number; mtime: number; target: number; width?: number; height?: number; out?: string; status: 'pending' | 'done' | 'skip' | 'fail'; at: number; error?: string; ms?: number }
const index = new Map<string, Entry>()
let loaded = false
const queue: string[] = []
let running: { key: string; child?: ReturnType<typeof spawn> } | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'media-cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function indexFile(): string { return path.join(cacheDir(), 'index.json') }
function loadIndex(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    if (Array.isArray(raw)) for (const e of raw) if (e && typeof e.key === 'string') index.set(e.key, e as Entry)
  } catch { /* 没有索引就从零开始 */ }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveIndex(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { fs.writeFileSync(indexFile(), JSON.stringify([...index.values()])) } catch { /* 写不进下次再写 */ }
  }, 500)
}

export function ffmpegPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')]
    : [path.join(app.getAppPath(), 'ffmpeg', 'ffmpeg.exe'), 'ffmpeg']
  for (const c of candidates) { if (c === 'ffmpeg' || fs.existsSync(c)) return c }
  return ''
}

function settings(): { enabled: boolean; target: number; maxMb: number } {
  const s = getSettings()
  return {
    enabled: s.mediaOptimize !== false,
    target: Math.max(240, Math.min(2160, Number(s.mediaOptimizeMaxHeight) || 720)),
    maxMb: Math.max(256, Math.min(65536, Number(s.mediaCacheMaxMb) || 4096))
  }
}

function keyOf(src: string, size: number, mtime: number, target: number): string {
  return createHash('sha1').update(`${src.toLowerCase()}|${size}|${Math.round(mtime)}|${target}`).digest('hex')
}

/**
 * 播放前调一次：有瘦身副本就用副本；没有就排队压制、这次先播原片。同步、不阻塞。
 */
export function optimizedMedia(src: string): string {
  try {
    const cfg = settings()
    if (!cfg.enabled || !src || /^(?:https?|data|zlmedia):/i.test(src) || !VIDEO_RE.test(src)) return src
    if (!ffmpegPath()) return src
    let st: fs.Stats
    try { st = fs.statSync(src) } catch { return src }
    if (!st.isFile()) return src
    loadIndex()
    const key = keyOf(src, st.size, st.mtimeMs, cfg.target)
    const entry = index.get(key)
    if (entry) {
      if (entry.status === 'done' && entry.out && fs.existsSync(entry.out)) { entry.at = Date.now(); saveIndex(); return entry.out }
      if (entry.status === 'skip') return src
      if (entry.status === 'pending') return src
      if (entry.status === 'fail' && Date.now() - entry.at < 6 * 3600_000) return src
    }
    index.set(key, { key, src, size: st.size, mtime: st.mtimeMs, target: cfg.target, status: 'pending', at: Date.now() })
    saveIndex()
    if (!queue.includes(key)) queue.push(key)
    pump()
    return src
  } catch {
    return src
  }
}

/** 一批可能要播的视频提前排队（启动后扫规则 / 盲盒 / 进场里配的视频）。 */
export function prewarmMedia(paths: Iterable<string>): void {
  for (const p of paths) if (typeof p === 'string' && p) optimizedMedia(p)
}

function probeDims(file: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', () => resolve(null))
    child.on('exit', () => {
      const m = /Video:[^\n]*?\s(\d{2,5})x(\d{2,5})/.exec(err)
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : null)
    })
  })
}

function pump(): void {
  if (running || !queue.length) return
  if (memoryLevel() === 'critical') { if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; pump() }, 30_000); return }
  const key = queue.shift()!
  const entry = index.get(key)
  if (!entry || entry.status !== 'pending') { pump(); return }
  running = { key }
  void (async () => {
    const t0 = Date.now()
    try {
      const dims = await probeDims(entry.src)
      if (!dims) throw new Error('读不出视频分辨率')
      entry.width = dims.width; entry.height = dims.height
      // 高度不超过目标的 1.15 倍：压了也省不了多少，标记跳过（不占磁盘）
      if (dims.height <= entry.target * 1.15) { entry.status = 'skip'; entry.at = Date.now(); saveIndex(); return }
      const out = path.join(cacheDir(), `${key}.mp4`)
      // 临时文件也必须是 .mp4 后缀（ffmpeg 按后缀猜容器，.part 会报「无法打开输出文件」）
      const tmp = path.join(cacheDir(), `${key}.tmp.mp4`)
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', entry.src,
        '-vf', `scale=-2:${entry.target}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'mp4', tmp]
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath(), args, { windowsHide: true })
        running!.child = child
        try { os.setPriority(child.pid!, os.constants.priority.PRIORITY_LOW) } catch { /* 降不了优先级也照压 */ }
        let err = ''
        child.stderr.on('data', (d) => { err += String(d) })
        child.on('error', reject)
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}：${err.slice(-200)}`))))
      })
      fs.renameSync(tmp, out)
      entry.out = out; entry.status = 'done'; entry.at = Date.now(); entry.ms = Date.now() - t0
      const outSize = (() => { try { return fs.statSync(out).size } catch { return 0 } })()
      logLine('media', `已瘦身 ${path.basename(entry.src)}：${dims.width}x${dims.height} → 高 ${entry.target}，${Math.round(entry.size / 1048576)}MB → ${Math.round(outSize / 1048576)}MB，耗时 ${Math.round(entry.ms / 1000)} 秒`)
      saveIndex()
      evict()
    } catch (e) {
      entry.status = 'fail'; entry.at = Date.now(); entry.error = e instanceof Error ? e.message : String(e)
      logLine('media', `瘦身失败 ${path.basename(entry.src)}：${entry.error}`)
      saveIndex()
    } finally {
      running = null
      setTimeout(pump, 200)
    }
  })()
}

/** 缓存总量超过上限：按最久未用删，直到回到上限以内。 */
function evict(): void {
  const cfg = settings()
  const done = [...index.values()].filter((e) => e.status === 'done' && e.out)
  let total = 0
  const sized = done.map((e) => { let size = 0; try { size = fs.statSync(e.out!).size } catch { /* 文件没了 */ } total += size; return { e, size } })
  if (total <= cfg.maxMb * 1048576) return
  sized.sort((a, b) => a.e.at - b.e.at)
  for (const { e, size } of sized) {
    if (total <= cfg.maxMb * 1048576) break
    try { fs.unlinkSync(e.out!) } catch { /* 已经不在 */ }
    index.delete(e.key)
    total -= size
    logLine('media', `缓存超上限，删掉最久未用的瘦身副本 ${path.basename(e.src)}`)
  }
  saveIndex()
}

export function mediaOptimizeState(): { enabled: boolean; ffmpeg: string; target: number; pending: number; done: number; skipped: number; failed: number; cacheMb: number } {
  loadIndex()
  const all = [...index.values()]
  let cache = 0
  for (const e of all) if (e.status === 'done' && e.out) { try { cache += fs.statSync(e.out).size } catch { /* */ } }
  return { enabled: settings().enabled, ffmpeg: ffmpegPath(), target: settings().target, pending: all.filter((e) => e.status === 'pending').length + (running ? 1 : 0), done: all.filter((e) => e.status === 'done').length, skipped: all.filter((e) => e.status === 'skip').length, failed: all.filter((e) => e.status === 'fail').length, cacheMb: Math.round(cache / 1048576) }
}

export function initMediaOptimize(): void {
  loadIndex()
  const cfg = settings()
  logLine('media', `素材瘦身${cfg.enabled ? '已启用' : '已关闭'}：最高 ${cfg.target}p，缓存上限 ${cfg.maxMb}MB，ffmpeg ${ffmpegPath() || '未找到（本机不压制）'}`)
  // 上次没压完的接着压
  for (const e of index.values()) if (e.status === 'pending') queue.push(e.key)
  pump()
  app.on('before-quit', () => { try { running?.child?.kill() } catch { /* */ } })
}
