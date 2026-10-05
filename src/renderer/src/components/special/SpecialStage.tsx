// 特色整蛊详情页的预览舞台：用 iframe 跑和直播窗口完全一样的玩法代码（zlspecial 协议提供页面和素材），
// 按直播窗口的分辨率渲染、整体缩放塞进卡片。可以直接在舞台上点/拖/挥，和直播里手感一样。
// 预览默认静音、不开麦克风；页面空闲时回「special-idle」，开着自动演示就再来一波。
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { specialPreviewUrl } from '../../lib/specialArt'
import type { SpecialGameConfig, SpecialGameId } from '@shared/specialGames'

export type StageBackdrop = 'scene' | 'green' | 'checker'

export interface SpecialStageHandle {
  apply: (cmd: Record<string, unknown>) => void
  reload: () => void
}

const BACKDROPS: Record<StageBackdrop, React.CSSProperties> = {
  // 模拟直播画面：暗色游戏场景感，叠加层效果看得最清楚
  scene: {
    background:
      'radial-gradient(120% 90% at 20% 15%, rgb(90 120 170 / 0.55), transparent 55%), radial-gradient(90% 80% at 85% 90%, rgb(160 90 60 / 0.45), transparent 60%), linear-gradient(160deg, #1d2633 0%, #121821 55%, #0c1016 100%)'
  },
  green: { background: '#00ff00' },
  checker: {
    backgroundColor: '#2a2f38',
    backgroundImage:
      'linear-gradient(45deg, #3a404b 25%, transparent 25%), linear-gradient(-45deg, #3a404b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a404b 75%), linear-gradient(-45deg, transparent 75%, #3a404b 75%)',
    backgroundSize: '24px 24px',
    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0'
  }
}

// 页面里读的扁平配置（和主进程 specialPageConfig 一致）
function pageConfig(cfg: SpecialGameConfig): Record<string, unknown> {
  return { background: cfg.background, speed: cfg.speed, countCap: cfg.countCap, ...cfg.params }
}

const SpecialStage = forwardRef<SpecialStageHandle, {
  id: SpecialGameId
  config: SpecialGameConfig
  backdrop: StageBackdrop
  muted: boolean
  /** 页面加载好 / 动画停下时调用（自动演示）；empty = 画面上已经什么都没有了 */
  onReady?: () => void
  onIdle?: (empty: boolean) => void
}>(function SpecialStage({ id, config, backdrop, muted, onReady, onIdle }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(0)
  const [version, setVersion] = useState(() => Date.now())
  const latest = useRef({ config, muted, onReady, onIdle })
  latest.current = { config, muted, onReady, onIdle }

  const post = useCallback((msg: Record<string, unknown>) => {
    try { frame.current?.contentWindow?.postMessage({ source: 'zl-special-host', ...msg }, '*') } catch { /* 页面正在重载 */ }
  }, [])

  useImperativeHandle(ref, () => ({
    apply: (cmd) => post({ type: 'apply', cmd }),
    reload: () => setVersion(Date.now())
  }), [post])

  // 舞台跟着卡片宽度缩放
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // 页面消息：ready → 推一次配置和静音状态；idle → 交给上层决定要不要再演示
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const m = e.data as { source?: string; type?: string; empty?: boolean }
      if (!m || m.source !== 'zl-special') return
      if (m.type === 'special-ready') {
        post({ type: 'config', cfg: pageConfig(latest.current.config) })
        post({ type: 'mute', value: latest.current.muted })
        latest.current.onReady?.()
      } else if (m.type === 'special-idle') latest.current.onIdle?.(m.empty === true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [post])

  // 改设置即时推给预览
  useEffect(() => { post({ type: 'config', cfg: pageConfig(config) }) }, [config, post])
  useEffect(() => { post({ type: 'mute', value: muted }) }, [muted, post])

  const w = Math.max(160, config.width)
  const h = Math.max(160, config.height)
  // 舞台按直播窗口的比例：横屏铺满卡片宽度；竖屏限高，居中摆，两边留暗边（和直播里竖屏画面一个样子）
  const maxH = 560
  const stageH = width ? Math.min(Math.round((width * h) / w), maxH) : 0
  const scale = width > 0 ? Math.min(width / w, stageH / h) : 0
  const innerW = Math.round(w * scale), innerH = Math.round(h * scale)
  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-deep)]"
      style={{ height: width ? stageH : undefined, aspectRatio: width ? undefined : `${w} / ${h}` }}
    >
      {scale > 0 && (
        <div className="absolute overflow-hidden" style={{ ...BACKDROPS[backdrop], width: innerW, height: innerH, left: Math.round((width - innerW) / 2), top: Math.round((stageH - innerH) / 2) }}>
          <iframe
            ref={frame}
            key={`${id}-${version}`}
            title="特色整蛊预览"
            src={specialPreviewUrl(id, version)}
            sandbox="allow-scripts allow-same-origin"
            className="absolute left-0 top-0 border-0"
            style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', background: 'transparent' }}
          />
        </div>
      )}
      {/* 预览标记：这里的演示只在页面里，不会发到直播窗口 */}
      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">预览 · 不上直播</span>
    </div>
  )
})

export default SpecialStage
