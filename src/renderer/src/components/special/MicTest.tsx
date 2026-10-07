// 特色整蛊详情页的「麦克风测试」：隐藏的 iframe 打开 zlspecial://app/mictest.html，里面跑和直播窗口完全一样的识别代码
// （见 main/special-games/shared.ts），实时显示音量和阈值线，认出拍手 / 喊叫时记一笔。
// 音量和设置里的「音量阈值」是同一把尺子（0~500，满幅约 300），主播看着条调阈值。
// 只在点了「开始测试」后才开麦克风；停止、离开详情页、两分钟到了都会关掉 iframe，麦克风随之释放。
import { useEffect, useRef, useState } from 'react'
import { Btn } from '../ui'

type Kind = 'clap' | 'shout'
type Params = Record<string, number | string | boolean>

const SCALE_MAX = 300          // 音量条满格 = 满幅（公式最大约 300，到不了 500）
const AUTO_STOP_MS = 120_000   // 测试最长开两分钟
const PEAK_HOLD_MS = 1500

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

/** 阈值线：拍蚊子开着「越响灭得越多」时把各档也画上 */
function marksOf(kind: Kind, p: Params): { v: number; label: string; kills?: number }[] {
  const th = num(p.threshold, kind === 'shout' ? 240 : 180)
  if (kind === 'shout' || !('clapLevel2' in p) || p.volumeScaledKill === false) return [{ v: th, label: '阈值' }]
  const base = Math.max(1, Math.trunc(num(p.killPerClap, 1)))
  return [
    { v: th, label: '阈值', kills: base },
    { v: num(p.clapLevel2, 200), label: '二档', kills: Math.max(1, Math.trunc(num(p.clapKill2, 2))) },
    { v: num(p.clapLevel3, 220), label: '三档', kills: Math.max(1, Math.trunc(num(p.clapKill3, 4))) },
    { v: num(p.maxKillLevel, 240), label: '最响', kills: Math.max(1, Math.trunc(num(p.loudClapMaxKill, 8))) }
  ].sort((a, b) => a.v - b.v)
}

/** 和玩法里一样的分档：够得着的最高一档，不少于每次拍手消灭 */
function killsAt(marks: ReturnType<typeof marksOf>, level: number): number | null {
  if (marks.length < 2) return null
  const base = marks.find((m) => m.label === '阈值')?.kills ?? 1
  let k = base
  for (const m of marks) if (level >= m.v && m.kills) k = m.kills
  return Math.max(base, k)
}

export default function MicTest({ kind, params }: { kind: Kind; params: Params }): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [run, setRun] = useState(0)          // 0 = 没在测；每次开始 +1（换一个 iframe）
  const [state, setState] = useState('')
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)
  const [hits, setHits] = useState<{ at: number; level: number }[]>([])
  const peakRef = useRef({ v: 0, at: 0 })
  const ready = useRef(false)
  const marks = marksOf(kind, params)
  const threshold = marks.find((m) => m.label === '阈值')?.v ?? 180

  // 当前设置 → 测试页（开始时、测试中改了设置都重发一次，测的永远是现在的设置）
  const startMsg = JSON.stringify({
    source: 'zl-mictest-host', type: 'start', kind, threshold,
    sensitivity: num(params.clapSensitivity, 70), cooldownMs: num(params.cooldownMs, kind === 'shout' ? 220 : 260),
    triggerMode: String(params.triggerMode || 'clap'), deviceLabel: String(params.micDevice || '')
  })
  const latest = useRef(startMsg)
  latest.current = startMsg
  const send = () => { if (ready.current) frame.current?.contentWindow?.postMessage(JSON.parse(latest.current), '*') }
  useEffect(send, [startMsg]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!run) return
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { source?: string; type?: string; state?: string; level?: number }
      if (!d || d.source !== 'zl-mictest') return
      if (d.type === 'ready') { ready.current = true; send() }
      else if (d.type === 'state') setState(String(d.state || ''))
      else if (d.type === 'level') {
        const v = Math.max(0, Number(d.level) || 0), now = Date.now()
        setLevel(v)
        if (v >= peakRef.current.v || now - peakRef.current.at > PEAK_HOLD_MS) { peakRef.current = { v, at: now }; setPeak(v) }
      } else if (d.type === 'hit') setHits((h) => [{ at: Date.now(), level: Number(d.level) || 0 }, ...h].slice(0, 5))
    }
    window.addEventListener('message', onMsg)
    const timer = setTimeout(() => setRun(0), AUTO_STOP_MS)
    return () => { window.removeEventListener('message', onMsg); clearTimeout(timer) }
  }, [run]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    ready.current = false
    peakRef.current = { v: 0, at: 0 }
    setLevel(0); setPeak(0); setHits([]); setState('')
    setRun((n) => n + 1)
  }
  const stop = () => { ready.current = false; setRun(0); setLevel(0); setPeak(0) }

  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / SCALE_MAX) * 100))}%`
  const over = level >= threshold
  const what = kind === 'shout' ? '喊' : '拍手'
  return (
    <div className="space-y-2.5" data-mictest={kind}>
      <div className="flex flex-wrap items-center gap-2">
        {run ? <Btn size="sm" variant="secondary" onClick={stop}>停止测试</Btn> : <Btn size="sm" onClick={start}>开始测试</Btn>}
        <span className="text-[11px] leading-4 text-[var(--text-4)]">
          {kind === 'shout'
            ? '对着麦克风喊几声：音量过了阈值线就算喊了一声。喊得很响也够不着线，就把阈值调低一点。'
            : '对着麦克风拍几下手：音量过了阈值线、又是短促的掌声，就会在下面记一笔。'}
        </span>
      </div>
      {run > 0 && (
        <>
          {state === 'no-mic' ? (
            <div className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
              没拿到麦克风。看看麦克风有没有插好、上面选的是不是这一个，或者 Windows 设置 → 隐私和安全性 → 麦克风 里有没有允许桌面应用使用麦克风。
            </div>
          ) : (
            <>
              <div className="relative h-6 overflow-hidden rounded-md border border-[var(--line-strong)] bg-[var(--bg-input)]" aria-label="实时音量">
                <div className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${over ? 'bg-[var(--accent)]' : 'bg-emerald-500/70'}`} style={{ width: pct(level) }} />
                <div className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: pct(peak) }} title="最近最响" />
                {marks.map((m) => (
                  <div key={m.label} className="absolute inset-y-0 w-px bg-[var(--text)]" style={{ left: pct(m.v) }} />
                ))}
              </div>
              {/* 刻度下只写数字（几档挨得近，带名字会叠在一起），名字在下面一行 */}
              <div className="relative h-4 text-[10px] tabular-nums text-[var(--text-3)]">
                {marks.map((m) => (
                  <span key={m.label} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(m.v) }}>{marks.length > 1 ? Math.round(m.v) : `${m.label} ${Math.round(m.v)}`}</span>
                ))}
              </div>
              {marks.length > 1 && (
                <div className="text-[11px] text-[var(--text-4)]">刻度线：{marks.map((m) => `${m.label} ${Math.round(m.v)}`).join(' · ')}</div>
              )}
              <div className="flex flex-wrap gap-x-4 text-xs text-[var(--text-2)]">
                <span>现在 <b className="tabular-nums">{Math.round(level)}</b></span>
                <span>最近最响 <b className="tabular-nums">{Math.round(peak)}</b></span>
                <span className="text-[var(--text-4)]">{state === 'listening' ? '正在听…' : '正在打开麦克风…'}</span>
              </div>
              {hits.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {hits.map((h) => {
                    const k = kind === 'clap' ? killsAt(marks, h.level) : null
                    return (
                      <li key={h.at} className="text-[var(--text-2)]">
                        ✓ 认出{what} · 音量 {Math.round(h.level)}{k != null ? ` · 一次灭 ${k} 只` : ''}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
          <iframe key={run} ref={frame} src="zlspecial://app/mictest.html" allow="microphone" title="麦克风测试" className="hidden" />
        </>
      )}
    </div>
  )
}
