import AdvancedSection from './AdvancedSection'
// 抽奖页的「方案」：把当前奖项 + 动作 + 上播表现整套存下来，随时切回来；
// 也能导出成一个 JSON 换台电脑 / 给别的主播用（和礼物规则、时间插件的方案是一套思路）。
import { useRef, useState } from 'react'
import { Download, Save, Upload, X } from 'lucide-react'
import { Btn, Input, Select } from './ui'
import { useToast } from '../stores/ui'

export type LotteryPreset = { name: string; config: Record<string, unknown> }

export function readLotteryPresets(storageKey: string): LotteryPreset[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(saved)
      ? saved.filter((row): row is LotteryPreset => !!row && typeof row === 'object' && typeof row.name === 'string' && !!row.config)
      : []
  } catch {
    return []
  }
}

function writePresets(storageKey: string, plans: LotteryPreset[]): void {
  localStorage.setItem(storageKey, JSON.stringify(plans))
}

/** 方案配置里取数组/字符串的小工具：导入的文件可能是别人手改的，取值一律带兜底。 */
function asItems(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : undefined
}

/** 导出文件的 kind → 给人看的名字（导错页面时提示用） */
const KIND_LABELS: Record<string, string> = {
  'zhiliao-wheel-cfg': '转盘',
  'zhiliao-nine-cfg': '九宫格',
  'zhiliao-time-cfg': '时间插件',
  'zhiliao-rules': '礼物规则'
}

/** 数一数这些方案里有多少个奖项（含附加动作）会运行文件 / 结束进程。 */
function riskyActionCount(configs: Record<string, unknown>[]): number {
  const risky = (action: unknown, param: unknown): boolean =>
    action === 'command' && /^\s*(run-file|kill)\s*(\||$)/i.test(String(param ?? ''))
  let count = 0
  for (const config of configs) {
    for (const item of asItems(config.items) || []) {
      const extras = Array.isArray(item.actions) ? (item.actions as Record<string, unknown>[]) : []
      if (risky(item.action, item.actionParam) || extras.some((a) => risky(a?.action, a?.actionParam))) count++
    }
  }
  return count
}

export default function LotteryPresets({
  storageKey,
  exportKind,
  fileName,
  snapshot,
  apply,
  hint = '方案里存的是这套奖项、动作和上播表现；换方案立刻生效。'
}: {
  storageKey: string
  exportKind: string
  fileName: string
  snapshot: () => Record<string, unknown>
  apply: (config: Record<string, unknown>) => void
  hint?: string
}) {
  const toast = useToast((s) => s.toast)
  const [plans, setPlans] = useState<LotteryPreset[]>(() => readLotteryPresets(storageKey))
  const [name, setName] = useState('')
  const [pick, setPick] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const save = (): void => {
    const title = name.trim() || `方案${plans.length + 1}`
    const next = [...plans.filter((p) => p.name !== title), { name: title, config: snapshot() }]
    setPlans(next)
    writePresets(storageKey, next)
    setName('')
    setPick(title)
    toast(`方案「${title}」已保存`, 'success')
  }

  const load = (title: string): void => {
    const plan = plans.find((p) => p.name === title)
    if (!plan) return
    apply(plan.config)
    setPick(title)
    toast(`已切换到方案「${title}」`, 'success')
  }

  const remove = (): void => {
    if (!pick) return
    const next = plans.filter((p) => p.name !== pick)
    setPlans(next)
    writePresets(storageKey, next)
    setPick('')
    toast(`方案「${pick}」已删除`, 'info')
  }

  const exportFile = (): void => {
    const payload = { kind: exportKind, version: 1, exportedAt: new Date().toISOString(), plans, config: snapshot() }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('设置已导出', 'success')
  }

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { kind?: unknown; plans?: unknown; config?: unknown }
      // 只认本页导出的文件：九宫格的方案导进转盘页会把奖项以外的开关悄悄改掉，还提示「已替换」
      if (!Array.isArray(parsed) && typeof parsed?.kind === 'string' && parsed.kind !== exportKind) {
        toast(`这不是本页导出的文件（是${KIND_LABELS[parsed.kind] || '别的功能'}的设置），请到对应页面导入`, 'error')
        return
      }
      const rows = Array.isArray(parsed) ? (parsed as unknown[]) : Array.isArray(parsed?.plans) ? (parsed.plans as unknown[]) : []
      const incoming: LotteryPreset[] = rows
        .filter((row): row is { name: string; config: Record<string, unknown> } => !!row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string')
        .map((row) => ({ name: row.name, config: (row.config || {}) as Record<string, unknown> }))
      let count = 0
      if (incoming.length) {
        const names = new Set(incoming.map((p) => p.name))
        const next = [...plans.filter((p) => !names.has(p.name)), ...incoming]
        setPlans(next)
        writePresets(storageKey, next)
        count = incoming.length
      }
      const config = (Array.isArray(parsed) ? undefined : parsed?.config) as Record<string, unknown> | undefined
      // 别人给的方案里可能藏着「运行文件 / 结束进程」这类动作，中奖就会在这台电脑上执行——导入时点出来
      const risky = riskyActionCount([...(config ? [config] : []), ...incoming.map((p) => p.config)])
      if (config && typeof config === 'object') {
        apply(config)
        toast(`设置已导入：${count ? `${count} 套方案，` : ''}当前奖项已替换`, 'success')
        if (risky) toast(`注意：导入的奖项里有 ${risky} 个会运行文件或结束进程，确认是自己配的再用`, 'error')
        return
      }
      if (!count) throw new Error('格式不对')
      toast(`已导入 ${count} 套方案`, 'success')
      if (risky) toast(`注意：导入的方案里有 ${risky} 个奖项会运行文件或结束进程，确认是自己配的再用`, 'error')
    } catch {
      toast('导入失败：请选择本页导出的 JSON 设置文件', 'error')
    }
  }

  return (
    <AdvancedSection title="方案与导入导出">
    <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-[var(--text-3)]">方案</span>
        <Input
          aria-label="方案名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="方案名"
          className="w-32"
        />
        <Btn size="sm" variant="secondary" onClick={save} title="把当前奖项、动作和上播表现存成一套方案">
          <Save size={12} /> 保存方案
        </Btn>
        <Select
          aria-label="选择已保存方案"
          value={pick}
          onChange={(e) => { if (e.target.value) load(e.target.value) }}
          className="min-w-[140px] flex-1"
        >
          <option value="">选择已保存方案</option>
          {plans.map((plan) => (
            <option key={plan.name} value={plan.name}>{plan.name}</option>
          ))}
        </Select>
        {pick ? <Btn size="sm" variant="ghost" onClick={remove} title={`删除方案「${pick}」`}><X size={13} /></Btn> : null}
        <Btn size="sm" variant="secondary" onClick={exportFile} title="把当前设置和全部方案导出成 JSON">
          <Download size={12} /> 导出设置
        </Btn>
        <Btn size="sm" variant="secondary" onClick={() => fileRef.current?.click()} title="从 JSON 导入设置和方案">
          <Upload size={12} /> 导入设置
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>
      <p className="text-xs leading-5 text-[var(--text-4)]">{hint}</p>
    </div>
    </AdvancedSection>
  )
}

/** 导入/应用方案时，从别人给的 JSON 里安全取值：类型不对就当没这一项。 */
export function presetItems(config: Record<string, unknown>): Record<string, unknown>[] | undefined {
  return asItems(config.items)
}
