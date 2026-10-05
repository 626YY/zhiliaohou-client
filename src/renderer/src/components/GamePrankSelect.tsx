// 「游戏整蛊」动作的选择框：三款游戏的整蛊菜单（整蛊器定义包），值是 游戏id|整蛊id|显示名。
// 礼物触发的动作编辑、特色整蛊的「同时触发游戏整蛊」共用。危险整蛊（关游戏之类）和转盘一样不给选。
import { Select } from './ui'
import { prankGroups, usePrankCatalog } from '../lib/pranks'

export const PRANK_GAMES = [
  ['4wheel-challenge', '轮椅模拟器'],
  ['librarian', '图书管理员'],
  ['dontscream', '不要尖叫']
] as const

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
      {PRANK_GAMES.map(([g, gameName]) => (
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
