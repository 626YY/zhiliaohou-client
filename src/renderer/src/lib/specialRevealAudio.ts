// 在设置页里试听盲盒开奖：先一声锣，隔一会儿念「锁链加5」——和直播窗口里的开奖同一套做法
// （Web Audio 解码后量一下：跳过开头的静音，人声统一到时间盲盒配音的响度），只是不出画面。
import type { SpecialVoicePreview } from '@shared/specialGames'

let ctx: AudioContext | null = null
let playing: AudioBufferSourceNode[] = []
const cache = new Map<string, Promise<Clip | null>>()
// 放完让声音模块歇着（开着的音频线程不放也一直在跑，主界面里别留着它）
let sleepTimer: ReturnType<typeof setTimeout> | null = null
function sleepAfter(seconds: number): void {
  if (sleepTimer) clearTimeout(sleepTimer)
  sleepTimer = setTimeout(() => { if (ctx && ctx.state === 'running') void ctx.suspend() }, Math.max(0, seconds) * 1000 + 1500)
}

interface Clip { buf: AudioBuffer; off: number; dur: number; gain: number }

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    return ctx
  } catch {
    return null
  }
}

function measure(buf: AudioBuffer, norm: boolean): Clip | null {
  const d = buf.getChannelData(0)
  const sr = buf.sampleRate
  let peak = 0
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  if (peak < 0.0001) return null
  const th = peak * 0.018
  let a = 0
  let b = d.length - 1
  while (a < d.length && Math.abs(d[a]) < th) a++
  while (b > a && Math.abs(d[b]) < th) b--
  a = Math.max(0, a - Math.round(0.025 * sr))
  b = Math.min(d.length - 1, b + Math.round(0.06 * sr))
  let gain = 1
  if (norm) {
    let s = 0
    for (let i = a; i <= b; i++) s += d[i] * d[i]
    const rms = Math.sqrt(s / Math.max(1, b - a + 1))
    gain = Math.max(0.25, Math.min(4, 0.125 / Math.max(0.000001, rms), 0.98 / peak))
  }
  return { buf, off: a / sr, dur: Math.max(0.05, (b - a) / sr), gain }
}

function load(url: string, norm: boolean): Promise<Clip | null> {
  if (!url) return Promise.resolve(null)
  const key = `${norm ? 'v' : 'g'} ${url}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`http ${r.status}`))))
      .then((bytes) => audio()!.decodeAudioData(bytes))
      .then((buf) => measure(buf, norm))
      .catch(() => null)
    cache.set(key, p)
    if (cache.size > 60) cache.delete(cache.keys().next().value as string)
  }
  return p
}

export function stopRevealPreview(): void {
  for (const s of playing) { try { s.stop() } catch { /* 已经停了 */ } }
  playing = []
}

/** 放一遍：锣 → 停顿 → 配音；返回放完要多久（秒） */
export async function playRevealPreview(p: SpecialVoicePreview): Promise<number> {
  stopRevealPreview()
  const ac = audio()
  if (!ac) return 0
  if (sleepTimer) clearTimeout(sleepTimer)
  const [gong, voice] = await Promise.all([load(p.gongUrl, false), load(p.voiceUrl, true), ac.state === 'suspended' ? ac.resume().catch(() => undefined) : null])
  const now = ac.currentTime + 0.05
  const at = now + (gong ? Math.max(0, p.gapMs) / 1000 : 0)
  const start = (clip: Clip, when: number, volume: number) => {
    const src = ac.createBufferSource()
    src.buffer = clip.buf
    const g = ac.createGain()
    g.gain.value = Math.max(0, Math.min(1, volume / 100)) * clip.gain
    src.connect(g)
    g.connect(ac.destination)
    src.start(when, clip.off, clip.dur)
    playing.push(src)
  }
  if (gong) start(gong, now, p.gongVolume)
  if (voice) start(voice, at, p.voiceVolume)
  const total = voice ? at - ac.currentTime + voice.dur : gong ? gong.dur : 0
  sleepAfter(total)
  return total
}
