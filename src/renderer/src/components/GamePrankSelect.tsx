// 「游戏整蛊」动作的选择框：三款游戏的整蛊菜单（整蛊器定义包），值是 游戏id|整蛊id|显示名。
// 礼物触发的动作编辑、特色整蛊的「同时触发游戏整蛊」共用。危险整蛊（关游戏之类）和转盘一样不给选。
import { useEffect, useState } from 'react'
import { Select } from './ui'
import { prankGroups, usePrankCatalog } from '../lib/pranks'

export const PRANK_GAMES = [
  ['4wheel-challenge', '轮椅模拟器'],
  ['librarian', '图书管理员'],
  ['dontscream', '不要尖叫']
] as const

/**
 * 能选的游戏：只列游戏列表里有的（mod 下架且这台电脑没装的不列，和游戏库同一条规矩）；
 * keep = 已经选着的那款，照常列出，老规则 / 老奖项的值不丢。礼物触发、转盘奖项、时间盲盒事件的「游戏整蛊」共用。
 */
export function useVisiblePrankGames(keep = ''): (typeof PRANK_GAMES)[number][] {
  const visible = useVisibleGameIds()
  return PRANK_GAMES.filter(([g]) => !visible || visible.has(g) || g === keep)
}

/** 游戏列表里有的游戏 id（还没读到时是 null = 先全列，读到再收） */
export function useVisibleGameIds(): Set<string> | null {
  const [visible, setVisible] = useState<Set<string> | null>(null)
  useEffect(() => {
    let alive = true
    // 读不到游戏列表（接口不在 / 出错）就全列：宁可多列一款，也不能让整个编辑器白屏
    try {
      if (typeof window.api?.gamesList !== 'function') return
      Promise.resolve(window.api.gamesList())
        .then((list) => { if (alive && Array.isArray(list)) setVisible(new Set(list.map((g) => g.id))) })
        .catch(() => {})
    } catch {
      /* 同上 */
    }
    return () => { alive = false }
  }, [])
  return visible
}

export default function GamePrankSelect({
  value,
  onChange,
  allowNone = false,
  label = '游戏整蛊'
}: {
  /** 游戏id|整蛊id|显示名 */
  value: string | undefined
  onChange: (param: string) => void
  /** 下拉第一项「不触发」（可选动作用） */
  allowNone?: boolean
  label?: string
}): React.JSX.Element {
  usePrankCatalog() // 定义包到位 / 刷新时重渲染
  const [game = '', id = ''] = String(value || '').split('|')
  const current = game && id ? `${game}|${id}` : ''
  const games = useVisiblePrankGames(game)
  return (
    <Select
      aria-label={label}
      value={current}
      onChange={(e) => {
        const v = e.target.value
        if (!v) { onChange(''); return }
        const [g, p] = v.split('|')
        const name = prankGroups(g).flatMap((x) => x.items).find((x) => x.id === p)?.name || p
        onChange(`${g}|${p}|${name}`)
      }}
    >
      <option value="">{allowNone ? '不触发游戏整蛊' : '选择游戏整蛊…'}</option>
      {games.map(([g, gameName]) => (
        <optgroup key={g} label={gameName}>
          {prankGroups(g)
            .flatMap((grp) => grp.items)
            .filter((p) => !p.danger)
            .map((p) => (
              <option key={p.id} value={`${g}|${p.id}`}>{p.name}</option>
            ))}
        </optgroup>
      ))}
    </Select>
  )
}
