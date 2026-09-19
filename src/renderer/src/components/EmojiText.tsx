// 昵称 / 礼物名 / 文案里的 emoji 贴成 Twemoji 图（图集在 resources/emoji72，与挂件页面同一套）。
// 用户 2026-09-13：「客户端显示名字的地方都要替换成那一套 emoji」——Windows 字体画不出的 🐦‍⬛ 这类 ZWJ 组合在主窗口里
// 原来是一串空方块。图集索引通过 window.api.emojiAssets() 取一次，全局缓存；没拿到（老 preload / 图集缺失）就退回纯文字。
import { useEffect, useState, type ReactNode } from 'react'
import { splitEmoji } from '@shared/emojiSplit'
import { mediaUrl } from '../utils/mediaUrl'

type Assets = { dir: string; keys: Set<string> }
let cached: Assets | null = null
let loading: Promise<Assets> | null = null
const listeners = new Set<() => void>()

function load(): Promise<Assets> {
  if (cached) return Promise.resolve(cached)
  if (!loading) {
    const api = (window as unknown as { api?: { emojiAssets?: () => Promise<{ dir: string; keys: string[] }> } }).api
    loading = (api?.emojiAssets ? api.emojiAssets() : Promise.resolve({ dir: '', keys: [] as string[] }))
      .then((r) => ({ dir: String(r?.dir || ''), keys: new Set(Array.isArray(r?.keys) ? r.keys : []) }))
      .catch(() => ({ dir: '', keys: new Set<string>() }))
      .then((assets) => { cached = assets; listeners.forEach((fn) => fn()); return assets })
  }
  return loading
}

function useEmojiAssets(): Assets | null {
  const [assets, setAssets] = useState<Assets | null>(cached)
  useEffect(() => {
    if (cached) { setAssets(cached); return }
    const fn = () => setAssets(cached)
    listeners.add(fn)
    void load()
    return () => { listeners.delete(fn) }
  }, [])
  return assets
}

/** 渲染带 emoji 的一段文字：emoji 换成 <img class="emo">，其余原样（沿用父元素字号 / 颜色 / 省略号） */
export default function EmojiText({ text, className }: { text: unknown; className?: string }): ReactNode {
  const assets = useEmojiAssets()
  const value = String(text == null ? '' : text)
  if (!assets || !assets.dir || !assets.keys.size) return className ? <span className={className}>{value}</span> : <>{value}</>
  const segments = splitEmoji(value, assets.keys)
  const nodes = segments.map((seg, i) => seg.key
    ? <img key={i} className="emo" alt={seg.text} draggable={false} src={mediaUrl(assets.dir + '/' + seg.key + '.png')} data-emoji={seg.key}
        style={{ display: 'inline-block', width: '1.15em', height: '1.15em', verticalAlign: '-0.2em', margin: '0 .04em', objectFit: 'contain' }} />
    : <span key={i}>{seg.text}</span>)
  return className ? <span className={className}>{nodes}</span> : <>{nodes}</>
}
