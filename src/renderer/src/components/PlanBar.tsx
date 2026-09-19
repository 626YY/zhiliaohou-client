import AdvancedSection from './AdvancedSection'
import { useState } from 'react'
import { Save, Trash2, FilePlus2 } from 'lucide-react'
import { Btn, Input, Select } from './ui'
import { planList, planLoad, planRemove, planSave } from '../lib/plans'

// 方案栏（复刻原版「插件配置倒计时 / 插件配置计数 / 插件配置加班」下拉 + 保存按钮）：
// 选方案即载入，保存写回当前方案，另存为新建，删除移除。
export function PlanBar<T>({
  ns,
  current,
  onLoad,
  toast
}: {
  ns: string
  current: T
  onLoad: (value: T) => void
  toast: (text: string, kind?: 'success' | 'error' | 'info') => void
}) {
  const [names, setNames] = useState<string[]>(() => planList(ns))
  const [picked, setPicked] = useState('')
  const [newName, setNewName] = useState('')

  const refresh = () => setNames(planList(ns))

  const load = (name: string) => {
    setPicked(name)
    if (!name) return
    const value = planLoad<T>(ns, name)
    if (!value) return toast('方案读取失败', 'error')
    onLoad(value)
    toast(`已载入方案「${name}」`, 'success')
  }

  const save = () => {
    const name = (picked || newName).trim()
    if (!name) return toast('先填方案名再保存', 'info')
    planSave(ns, name, current)
    refresh()
    setPicked(name)
    setNewName('')
    toast(`方案「${name}」已保存`, 'success')
  }

  const saveAs = () => {
    const name = newName.trim()
    if (!name) return toast('请填新方案名', 'info')
    planSave(ns, name, current)
    refresh()
    setPicked(name)
    setNewName('')
    toast(`已新建方案「${name}」`, 'success')
  }

  const remove = () => {
    if (!picked) return toast('先选一个方案', 'info')
    planRemove(ns, picked)
    refresh()
    setPicked('')
    toast('方案已删除', 'info')
  }

  return (
    <AdvancedSection title="方案管理">
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
      <span className="text-xs text-[var(--text-3)]">方案</span>
      <div className="min-w-[150px]">
        <Select value={picked} onChange={(e) => load(e.target.value)}>
          <option value="">（当前配置）</option>
          {names.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </Select>
      </div>
      <div className="w-[150px]">
        <Input value={newName} placeholder="新方案名" onChange={(e) => setNewName(e.target.value)} />
      </div>
      <Btn size="sm" variant="secondary" onClick={save}><Save size={13} /> 保存</Btn>
      <Btn size="sm" variant="secondary" onClick={saveAs}><FilePlus2 size={13} /> 另存为</Btn>
      <Btn size="sm" variant="secondary" onClick={remove}><Trash2 size={13} /> 删除</Btn>
    </div>
    </AdvancedSection>
  )
}
