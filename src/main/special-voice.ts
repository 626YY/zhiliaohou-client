// 特色整蛊盲盒开奖配音：一句话 → 声音文件。
// 查找顺序：随包的（assets/special-games/box_voice/，默认事件和各玩法常用数量都用晓伊念好了，不联网也能用）
// → 本机缓存（userData/special-voice/）→ 现念（Edge 在线语音，edge-tts.ts）并存进缓存，下回直接用。
// 文件名规则见 special-voice-name.ts（随包生成工具 tools/gen-special-voice.mjs 用的是同一套）。
// 连不上语音服务时一分钟内不再试（断网时别每份礼物都去等超时）；同一句同时只念一次。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { edgeTts } from './edge-tts'
import { specialAssetDir } from './special-assets'
import { voiceFileName } from './special-voice-name'

const SHIPPED = 'box_voice'
// 缓存只存主播自己写的台词、随机到的冷门数量，一句十来 KB；超过这么多句删掉最久没用的一批
const CACHE_LIMIT = 3000
const MAX_PARALLEL = 3
const OFFLINE_COOLDOWN_MS = 60_000

const inflight = new Map<string, Promise<string>>()
let offlineUntil = 0
let offlineError = ''
let running = 0
const waiting: (() => void)[] = []
let writes = 0

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'special-voice')
}

function usable(file: string): boolean {
  try {
    return fs.statSync(file).size > 0
  } catch {
    return false
  }
}

/** 内置开场锣（时间盲盒那一声）；素材目录不在时回空 */
export function specialGongFile(): string {
  const dir = specialAssetDir()
  const file = dir ? path.join(dir, SHIPPED, 'gong.mp3') : ''
  return file && usable(file) ? file : ''
}

/** 已经有的（随包或缓存）：有就回绝对路径，没有回空 */
export function specialVoiceCached(text: string, voice: string, rate: number): string {
  const line = String(text || '').trim()
  if (!line) return ''
  const name = voiceFileName(voice, rate, line)
  const dir = specialAssetDir()
  if (dir) {
    const shipped = path.join(dir, SHIPPED, name)
    if (usable(shipped)) return shipped
  }
  const cached = path.join(cacheDir(), name)
  if (usable(cached)) {
    try { fs.utimesSync(cached, new Date(), new Date()) } catch { /* 只为记一下最近用过 */ }
    return cached
  }
  return ''
}

async function slot(): Promise<void> {
  if (running < MAX_PARALLEL) { running++; return }
  await new Promise<void>((resolve) => waiting.push(resolve))
  running++
}
function release(): void {
  running--
  waiting.shift()?.()
}

function prune(dir: string): void {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => {
      const full = path.join(dir, f)
      return { full, t: fs.statSync(full).mtimeMs }
    })
    if (files.length <= CACHE_LIMIT) return
    files.sort((a, b) => a.t - b.t)
    for (const f of files.slice(0, files.length - Math.floor(CACHE_LIMIT * 0.8))) {
      try { fs.rmSync(f.full, { force: true }) } catch { /* 正在用就下回再删 */ }
    }
  } catch (e) {
    console.warn('[special-voice] 清理缓存失败', (e as Error).message)
  }
}

async function synth(line: string, voice: string, rate: number, name: string): Promise<string> {
  await slot()
  try {
    const mp3 = await edgeTts(line, { voice, rate, timeoutMs: 10_000 })
    const dir = cacheDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    fs.writeFileSync(`${file}.part`, mp3)
    fs.renameSync(`${file}.part`, file)
    offlineUntil = 0
    if (++writes % 50 === 0) prune(dir)
    return file
  } catch (e) {
    offlineUntil = Date.now() + OFFLINE_COOLDOWN_MS
    offlineError = (e as Error).message
    throw e
  } finally {
    release()
  }
}

/**
 * 念这一句的声音文件（绝对路径）：随包 / 缓存里有就直接回；没有就现念，最多等 waitMs——
 * 等不到先回空（念好了照样存进缓存，下回直接用）；念不出来回空和原因。
 */
export async function specialVoiceFile(text: string, voice: string, rate: number, waitMs = 8000): Promise<{ file: string; error?: string }> {
  const line = String(text || '').trim()
  if (!line) return { file: '' }
  const hit = specialVoiceCached(line, voice, rate)
  if (hit) return { file: hit }
  if (Date.now() < offlineUntil) return { file: '', error: `语音服务暂时连不上（${offlineError}），这句先不念` }
  const name = voiceFileName(voice, rate, line)
  let job = inflight.get(name)
  if (!job) {
    job = synth(line, voice, rate, name).finally(() => inflight.delete(name))
    inflight.set(name, job)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const file = await Promise.race([
      job,
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve(''), Math.max(0, waitMs)) })
    ])
    return file ? { file } : { file: '', error: '语音还在生成，这次先不念' }
  } catch (e) {
    return { file: '', error: `念不出来：${(e as Error).message}` }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 直播窗口（file:// 页面）里用的地址 */
export function voiceFileUrl(file: string): string {
  return file ? pathToFileURL(file).href : ''
}

/** 设置页（渲染层）里试听用的地址：走 zlspecial 协议（素材目录里的走 assets/，别处的走 file/） */
export function voicePreviewUrl(file: string): string {
  if (!file) return ''
  const dir = specialAssetDir()
  const rel = dir ? path.relative(dir, file) : ''
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return `zlspecial://app/assets/${rel.split(path.sep).map(encodeURIComponent).join('/')}`
  return `zlspecial://app/file/${file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`
}
