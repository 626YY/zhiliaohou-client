// 选一个特色整蛊盲盒（礼物触发、转盘/九宫格/时间盲盒的动作里用）。值 = 盲盒id|显示名。
import { Select } from '../ui'
import { useSpecialBoxes } from '../../lib/useSpecialBoxes'
import { parseSpecialBoxParam } from '@shared/specialGames'

export default function SpecialBoxSelect({ value, onChange, label = '特色整蛊盲盒' }: { value: string | undefined; onChange: (param: string) => void; label?: string }) {
  const { boxes } = useSpecialBoxes()
  const cur = parseSpecialBoxParam(value)
  const known = boxes.some((b) => b.id === cur.id)
  return (
    <Select
      aria-label={label}
      value={cur.id}
      onChange={(e) => {
        const box = boxes.find((b) => b.id === e.target.value)
        onChange(box ? `${box.id}|${box.name}` : '')
      }}
    >
      <option value="">选择盲盒…</option>
      {cur.id && !known && <option value={cur.id}>{cur.name || cur.id}（已删除）</option>}
      {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}（{b.entries.length} 种）</option>)}
    </Select>
  )
}
