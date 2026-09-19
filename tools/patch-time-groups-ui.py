# -*- coding: utf-8 -*-
"""时间插件界面：事件库按项目分组 + 每组小开关；奖池里标出停用项；整套设置导出导入。
用法：python tools/patch-time-groups-ui.py"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731


def edit(rel, pairs):
    path = P(*rel.split('/'))
    src = io.open(path, encoding='utf-8').read()
    out = src
    bad = []
    for marker, old, new in pairs:
        if marker in out:
            print('  [%s] 已有 %s' % (rel, marker[:34]))
            continue
        if old not in out:
            bad.append(old.strip().splitlines()[0][:66])
            continue
        out = out.replace(old, new, 1)
    for b in bad:
        print('！[%s] 锚点没对上：%s' % (rel, b))
    if bad:
        return False
    if out != src:
        io.open(path, 'w', encoding='utf-8', newline='').write(out)
        print('  [%s] %d → %d' % (rel, len(src), len(out)))
    return True


ok = True

# ---------------- TimeBlindBoxEditor：分组渲染 + 组开关 ----------------
ok &= edit('src/renderer/src/components/TimeBlindBoxEditor.tsx', [
    ('blindBoxGroups', "import { resolveTimeBlindBoxPool, validateTimeBlindBoxEvent } from '@shared/timeBlindBox'",
     "import { blindBoxGroups, resolveTimeBlindBoxPool, validateTimeBlindBoxEvent } from '@shared/timeBlindBox'"),
    ('Pill', "import { Btn, Field, Input, Select, Toggle } from './ui'",
     "import { Btn, Field, Input, Pill, Select, Toggle } from './ui'"),

    # 奖池里把停用的标出来（选了也抽不到，得让主播看见）
    ('已停用', """          {selected && <Check size={12} />} {event.name || '未命名事件'} <span className="tnum text-[var(--text-3)]">{timeEventText(event)}</span>""",
     """          {selected && <Check size={12} />} {event.name || '未命名事件'} <span className="tnum text-[var(--text-3)]">{timeEventText(event)}</span>
          {event.enabled === false && <span className="text-[10px] text-[var(--warn)]">已停用</span>}"""),

    # 事件库：按项目分组渲染 + 组开关
    ('GROUP_NONE', """export default function TimeBlindBoxEditor({ events, gifts, state, busy, error, onChange, onRemove, onTest, onCancel }: {""",
     """const GROUP_NONE = '未分组'
const groupName = (event?: TimeBlindBoxEvent) => (event ? String(event.group || '').trim() || GROUP_NONE : '')

export default function TimeBlindBoxEditor({ events, gifts, state, busy, error, onChange, onRemove, onTest, onCancel }: {"""),

    ('const toggleGroup =', """  const add = () => {""",
     """  // 整组开关：一个组 = 一个品游项目。停用的事件真触发时抽不到（resolveTimeBlindBoxPool 跳过），
  // 但奖池里的勾选保持不动 —— 主播只是「今晚不开这个项目」，不是删掉它。
  const toggleGroup = (name: string, on: boolean) => {
    onChange(events.map((event) => (groupName(event) === name ? { ...event, enabled: on } : event)))
  }
  // 有项目的排前面、同项目挨着（sort 稳定，组内保持原顺序）
  const ordered = [...events].sort((a, b) => {
    const ga = groupName(a)
    const gb = groupName(b)
    if (ga === gb) return 0
    if (ga === GROUP_NONE) return 1
    if (gb === GROUP_NONE) return -1
    return ga.localeCompare(gb, 'zh')
  })
  const stats = new Map(blindBoxGroups(events).map((row) => [row.group, row]))
  const add = () => {"""),

    ('data-testid="time-blindbox-group"', """      {events.map((event, index) => {""",
     """      {ordered.map((event, index) => {
        const group = groupName(event)
        const groupHead = group !== groupName(ordered[index - 1])
        const stat = stats.get(group) || { total: 1, enabled: 1 }"""),

    ('{groupHead && (', """        return <div key={`${event.id}-${index}`} className="py-3" data-testid="time-blindbox-event">""",
     """        return <div key={`${event.id}-${index}`} className="py-3" data-testid="time-blindbox-event">
          {groupHead && (
            <div className="mb-2 flex items-center justify-between gap-2" data-testid="time-blindbox-group" aria-label={`项目 ${group}`}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-semibold text-[var(--text-2)]">{group}</span>
                <span className="tnum shrink-0 text-[11px] text-[var(--text-4)]">{stat.enabled}/{stat.total} 启用</span>
                {stat.enabled === 0 && <Pill tone="muted">整组停用</Pill>}
              </div>
              <Toggle value={stat.enabled > 0} onChange={(on) => toggleGroup(group, on)} />
            </div>
          )}"""),

    # 单条也标出停用
    ('{event.enabled === false && <Pill tone="muted">停用</Pill>}', """            <span className="hidden text-[11px] text-[var(--text-4)] sm:block">{uses} 个礼物</span>""",
     """            {event.enabled === false && <Pill tone="muted">停用</Pill>}
            <span className="hidden text-[11px] text-[var(--text-4)] sm:block">{uses} 个礼物</span>"""),

    # 小标题补一句怎么用
    ('项目开关一关，这个项目今晚就不抽了', """        <p className="mt-1 text-xs text-[var(--text-3)]">每个事件分别设置时间、视频、音效和整蛊</p></div>""",
     """        <p className="mt-1 text-xs text-[var(--text-3)]">每个事件分别设置时间、视频、音效和整蛊。项目开关一关，这个项目今晚就不抽了</p></div>"""),
])

# ---------------- EntertainmentTime：整套设置导出 / 导入 ----------------
ok &= edit('src/renderer/src/pages/EntertainmentTime.tsx', [
    ('const exportSettings', """  const deletePlan = () => {""",
     """  // 导出/导入整套设置：倒计时配置 + 全部方案（换台电脑、给别的主播都能带走）
  const exportSettings = () => {
    const payload = { kind: 'zhiliao-time-cfg', version: 1, exportedAt: new Date().toISOString(), config, plans }
    const blob = new Blob([serializeConfig(payload as never)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `时间插件设置_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('设置已导出', 'success')
  }

  const importSettings = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      // 认三种：整包 { config, plans } / 只有方案的数组 / 单个配置对象
      const incoming = Array.isArray(parsed)
        ? { config: null, plans: parsed }
        : { config: parsed?.config ?? (parsed?.kind ? null : parsed), plans: parsed?.plans }
      let planCount = 0
      if (Array.isArray(incoming.plans)) {
        const rows = incoming.plans
          .filter((item: unknown) => !!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string')
          .map((item: { name: string; config?: Partial<TimeWidgetConfig> }) => ({ name: item.name, config: normalize(item.config || {}) }))
        if (rows.length) {
          const names = new Set(rows.map((row) => row.name))
          const next = [...plans.filter((plan) => !names.has(plan.name)), ...rows]
          setPlans(next)
          localStorage.setItem(PLANS_KEY, serializeConfig(next))
          planCount = rows.length
        }
      }
      if (incoming.config && typeof incoming.config === 'object') {
        // ★事件库要整份换过来（normalize 会补默认值，但事件数组要显式给）
        const next = normalize(incoming.config as Partial<TimeWidgetConfig>)
        next.blindBoxEvents = normalizeTimeBlindBoxEvents((incoming.config as Partial<TimeWidgetConfig>).blindBoxEvents)
        update(next)
        toast(`设置已导入：${next.blindBoxEvents.length} 个盲盒事件` + (planCount ? `、${planCount} 套方案` : ''), 'success')
        return
      }
      if (!planCount) throw new Error('格式不对')
      toast(`已导入 ${planCount} 套方案`, 'success')
    } catch {
      toast('导入失败：请选择本页导出的 JSON 设置文件', 'error')
    }
  }

  const deletePlan = () => {"""),

    # 按钮
    ('导出设置', """          {planPick && <Btn size="sm" variant="ghost" onClick={deletePlan} title="删除当前方案"><X size={13} /></Btn>}
        </div>""",
     """          {planPick && <Btn size="sm" variant="ghost" onClick={deletePlan} title="删除当前方案"><X size={13} /></Btn>}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <Btn size="sm" variant="secondary" onClick={exportSettings} title="把倒计时设置和全部方案导出成 JSON"><Download size={12} /> 导出设置</Btn>
          <Btn size="sm" variant="secondary" onClick={() => settingsFileRef.current?.click()} title="从 JSON 导入设置和方案"><Upload size={12} /> 导入设置</Btn>
          <input
            ref={settingsFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importSettings(file) }}
          />
        </div>"""),

    ('settingsFileRef', """  const [blindBoxError, setBlindBoxError] = useState('')""",
     """  const [blindBoxError, setBlindBoxError] = useState('')
  const settingsFileRef = useRef<HTMLInputElement>(null)"""),
])

print('\n' + ('写入完成' if ok else '★有锚点没对上'))
sys.exit(0 if ok else 2)
