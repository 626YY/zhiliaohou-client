// 整蛊台 AI 语音播报（规格见 src/shared/announce.ts）：各模块出结果时调 announce(模块, 一句话, {自带声音?})。
//   · 声音和特色整蛊开奖同一套（special-voice：随包晓伊 → 本机缓存 → Edge 在线现念），断网又没缓存就不念（不等、不报错）；
//   · 交给主窗口按顺序放（App 根组件常驻，和礼物规则的音效同一条路，直播软件采桌面声音就能听到），不另开窗口、不抢前台；
//   · 现念的可以并行准备，但一定按先来后到放；排着的超过上限就不念了（连击别攒一长串）。
import { readJson, writeJson } from './db'
import { getMainWindow } from './main-window-ref'
import { specialGongFile, specialVoiceFile, voicePreviewUrl } from './special-voice'
import { Ipc } from '@shared/types'
import type { SpecialVoicePreview } from '@shared/specialGames'
import { ANNOUNCE_MODULE_MAP, announceLine, normalizeAnnounce, type AnnounceConfig, type AnnounceModule, type AnnouncePreviewRequest } from '@shared/announce'

const FILE = 'announce'
let config: AnnounceConfig | null = null
let chain: Promise<void> = Promise.resolve()
let waiting = 0

export function announceConfig(): AnnounceConfig {
  if (!config) config = normalizeAnnounce(readJson<unknown>(FILE, {}))
  return config
}

export function configureAnnounce(patch: Partial<AnnounceConfig>): AnnounceConfig {
  const cur = announceConfig()
  const modules = { ...cur.modules }
  if (patch?.modules && typeof patch.modules === 'object') {
    for (const [id, m] of Object.entries(patch.modules)) {
      if (ANNOUNCE_MODULE_MAP[id] && m && typeof m === 'object') modules[id as AnnounceModule] = { ...modules[id as AnnounceModule], ...m }
    }
  }
  config = normalizeAnnounce({ ...cur, ...(patch || {}), modules })
  try { writeJson(FILE, config) } catch { /* 存不下只影响下次启动 */ }
  return config
}

function payload(cfg: AnnounceConfig, line: string, file: string): SpecialVoicePreview {
  const gong = cfg.gong ? specialGongFile() : ''
  return { ok: true, line, text: line, voiceUrl: voicePreviewUrl(file), gongUrl: gong ? voicePreviewUrl(gong) : '', gapMs: cfg.gapMs, voiceVolume: cfg.volume, gongVolume: cfg.gongVolume }
}

/**
 * 念一句。hasOwnMedia：这次的事件自己配了视频 / 声音（默认不念，模块里打开「配了视频的也念」才念）。
 * 总开关、模块开关没开就什么都不做；念不出来（断网没缓存）就算了。
 */
export function announce(module: AnnounceModule, text: string, opts: { hasOwnMedia?: boolean } = {}): void {
  const cfg = announceConfig()
  if (!cfg.enabled) return
  const m = cfg.modules[module]
  if (!m?.on) return
  if (opts.hasOwnMedia && !m.withMedia) return
  const line = announceLine(text)
  if (!line || waiting >= cfg.maxQueue) return
  waiting++
  const voice = specialVoiceFile(line, cfg.voiceName, cfg.rate, 8000).catch(() => ({ file: '' }))
  chain = chain.then(async () => {
    try {
      const r = await voice
      if (!r.file) return
      const win = getMainWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(Ipc.AnnouncePlay, payload(announceConfig(), line, r.file))
    } catch {
      // 这一句没送出去就算了；链子不能断（断了后面每一句都不会再念）
    } finally {
      waiting--
    }
  })
}

/** 试听：给模块就念它的示例句，给 text 就念这一句；按页面上正在调的设置（还没存也行）。现念最多等 12 秒 */
export async function announcePreview(req: AnnouncePreviewRequest): Promise<SpecialVoicePreview> {
  const cfg = normalizeAnnounce({ ...announceConfig(), ...(req?.config || {}) })
  const line = announceLine(String(req?.text || (req?.module ? ANNOUNCE_MODULE_MAP[req.module]?.example : '') || '加30秒'))
  const base = { ok: false, line, text: line, voiceUrl: '', gongUrl: '', gapMs: cfg.gapMs, voiceVolume: cfg.volume, gongVolume: cfg.gongVolume }
  if (!line) return { ...base, error: '没有要念的话' }
  const r = await specialVoiceFile(line, cfg.voiceName, cfg.rate, 12_000)
  if (!r.file) return { ...base, error: r.error || '暂时念不出来，请检查网络后再试' }
  return payload(cfg, line, r.file)
}
