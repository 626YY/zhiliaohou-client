# -*- coding: utf-8 -*-
"""礼物触发页：规则按项目分组 + 每组一个小开关 + 项目预设（存/选/删）+ 导出导入带上预设。
用法：python tools/patch-presets-ui.py"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, 'src', 'renderer', 'src', 'pages', 'EntertainmentGiftRules.tsx')

EDITS = [
    # ---- import ----
    ('Fragment', "import { useCallback, useEffect, useRef, useState } from 'react'",
     "import { Fragment, useCallback, useEffect, useRef, useState } from 'react'"),
    ('Save, Layers', "ChevronUp, ChevronDown, FolderInput } from 'lucide-react'",
     "ChevronUp, ChevronDown, FolderInput, Save, Layers } from 'lucide-react'"),
    ('EntertainmentPreset,', "import type { EntertainmentAction, EntertainmentActionType,",
     "import type { EntertainmentAction, EntertainmentActionType, EntertainmentPreset,"),

    # ---- state ----
    ('const [presets, setPresets]', """  const fileRef = useRef<HTMLInputElement>(null)""",
     """  const fileRef = useRef<HTMLInputElement>(null)
  // 项目预设：一套「今晚开哪几个项目」。分组一般就是品游项目名（导入时自动填）
  const [presets, setPresets] = useState<EntertainmentPreset[]>([])
  const [presetPick, setPresetPick] = useState('')
  const [presetName, setPresetName] = useState('')"""),

    # ---- load 顺带拉预设 ----
    ('setPresets(list.presets', """  const load = async () => {
    const r = await window.api.entertainmentRulesList()
    setRules(r)
  }""",
     """  const load = async () => {
    const r = await window.api.entertainmentRulesList()
    setRules(r)
    try {
      const list = await window.api.entertainmentPresetList()
      setPresets(list.presets || [])
    } catch {
      /* 预设读不到不影响规则列表 */
    }
  }"""),

    # ---- 分组 / 预设 的处理函数（插在 remove 之后）----
    ('const groupOf = ', """  const remove = async (id: string) => {
    await window.api.entertainmentRuleRemove(id)
    await load()
  }""",
     """  const remove = async (id: string) => {
    await window.api.entertainmentRuleRemove(id)
    await load()
  }

  // ---- 项目分组：一个组 = 一个品游项目（导入时自动填 group），主播按组整开整关 ----
  const UNGROUPED = '未分组'
  const groupOf = (r?: EntertainmentRule) => (r ? String(r.group || '').trim() || UNGROUPED : '')
  // 有项目的排前面、同项目挨着；组内保持原顺序（sort 是稳定的）
  const ordered = [...rules].sort((a, b) => {
    const ga = groupOf(a)
    const gb = groupOf(b)
    if (ga === gb) return 0
    if (ga === UNGROUPED) return 1
    if (gb === UNGROUPED) return -1
    return ga.localeCompare(gb, 'zh')
  })
  const groupStat = (name: string) => {
    const list = rules.filter((r) => groupOf(r) === name)
    return {
      total: list.length,
      enabled: list.filter((r) => r.enabled !== false).length,
      // 没绑礼物的规则开了也不触发（主进程会拦），这里明说，免得主播以为开了
      unbound: list.filter((r) => !String(r.giftName || '').trim()).length
    }
  }
  const toggleGroup = async (name: string, on: boolean) => {
    const r = await window.api.entertainmentGroupToggle(name, on)
    await load()
    if (!r.ok) return toast('整组开关没生效', 'error')
    const tail = r.skipped && on ? `，${r.skipped} 条还没绑礼物（绑了才能启用）` : ''
    toast(`「${name}」已${on ? '启用' : '停用'} ${r.changed} 条${tail}`, r.skipped && on ? 'info' : 'success')
  }

  const applyPreset = async (id: string) => {
    setPresetPick(id)
    if (!id) return
    const r = await window.api.entertainmentPresetApply(id)
    await load()
    if (!r.ok) return toast(r.error || '应用预设失败', 'error')
    const tail = r.skipped ? `，${r.skipped} 条没绑礼物` : ''
    toast(`已应用预设：开 ${r.on} 条、关 ${r.off} 条${tail}`, 'success')
  }
  const savePreset = async () => {
    const on = [
      ...new Set(
        rules
          .filter((r) => r.enabled !== false && String(r.group || '').trim())
          .map((r) => String(r.group).trim())
      )
    ]
    if (!on.length) return toast('当前没有启用的项目，先开几个再存预设', 'error')
    const name = presetName.trim() || `直播方案${presets.length + 1}`
    const r = await window.api.entertainmentPresetSave({ name, groups: on })
    if (!r.ok) return toast(r.error || '保存预设失败', 'error')
    setPresetName('')
    setPresetPick(r.id || '')
    await load()
    toast(`预设「${name}」已保存：${on.length} 个项目`, 'success')
  }
  const deletePreset = async () => {
    if (!presetPick) return
    await window.api.entertainmentPresetRemove(presetPick)
    setPresetPick('')
    await load()
  }"""),

    # ---- 导出：规则 + 预设一整包 ----
    ('kind: \'zhiliao-ent-rules\'', """  // 导出配置为 JSON 文件
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], {
      type: 'application/json'
    })""",
     """  // 导出配置为 JSON 文件：规则 + 项目预设一整包（换台电脑、换个直播方案都能带走）
  const exportConfig = () => {
    const payload = {
      kind: 'zhiliao-ent-rules',
      version: 1,
      exportedAt: new Date().toISOString(),
      rules,
      presets
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    })"""),

    # ---- 导入：认新老两种格式，预设一起进来 ----
    ('已导入 ${added} 条规则', """      const arr = JSON.parse(await f.text())
      if (!Array.isArray(arr)) throw new Error('格式不对')
      let added = 0
      let skipped = 0
      for (const r of arr) {
        if (!r?.giftName) {
          skipped++
          continue
        }
        const res = await window.api.entertainmentRuleAdd({ ...r, id: '' })
        if (res.ok) added++
        else skipped++
      }
      await load()
      toast(`已导入 ${added} 条规则${skipped ? `，${skipped} 条没导入（缺礼物名或格式不对）` : ''}`, added ? 'success' : 'error')""",
     """      const parsed = JSON.parse(await f.text())
      // 老版本导出的是一个裸数组，新版本是 { rules, presets } —— 两种都认
      const arr: EntertainmentRule[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rules)
          ? parsed.rules
          : []
      if (!arr.length) throw new Error('格式不对')
      let added = 0
      let skipped = 0
      for (const r of arr) {
        // 规则名或礼物名有一个就收（导入品游项目建的规则本来就还没绑礼物）
        if (!r?.giftName && !r?.name) {
          skipped++
          continue
        }
        const res = await window.api.entertainmentRuleAdd({ ...r, id: '' })
        if (res.ok) added++
        else skipped++
      }
      let presetAdded = 0
      for (const p of Array.isArray(parsed?.presets) ? parsed.presets : []) {
        if (!p?.name) continue
        const res = await window.api.entertainmentPresetSave({
          name: String(p.name),
          groups: Array.isArray(p.groups) ? p.groups.map(String) : []
        })
        if (res.ok) presetAdded++
      }
      await load()
      const tail = [
        skipped ? `${skipped} 条没导入（缺规则名和礼物名）` : '',
        presetAdded ? `${presetAdded} 个预设` : ''
      ].filter(Boolean).join('，')
      toast(`已导入 ${added} 条规则${tail ? '，' + tail : ''}`, added ? 'success' : 'error')"""),

    # ---- 预设条 ----
    ('aria-label="项目预设"', """      <ProjectImportModal
        open={projectImport}""",
     """      {/* 项目预设：不同直播开不同项目，存一套选一套；透明图菜单也按当前开着的项目生成 */}
      {rules.some((r) => String(r.group || '').trim()) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-3 py-2"
          aria-label="项目预设"
        >
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-2)]">
            <Layers size={13} /> 项目预设
          </span>
          <Select
            aria-label="选择项目预设"
            value={presetPick}
            onChange={(e) => void applyPreset(e.target.value)}
            className="w-48"
          >
            <option value="">选择预设（选中即应用）</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.groups.length} 个项目）
              </option>
            ))}
          </Select>
          {presetPick && (
            <Btn size="sm" variant="ghost" onClick={() => void deletePreset()} title="删除这个预设">
              <Trash2 size={13} />
            </Btn>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="预设名"
            className="w-28"
            aria-label="预设名"
          />
          <Btn size="sm" variant="secondary" onClick={() => void savePreset()} title="把当前开着的项目存成一个预设">
            <Save size={12} /> 存为预设
          </Btn>
          <span className="text-[11px] text-[var(--text-4)]">存的是「开哪几个项目」，切直播换一套就行</span>
        </div>
      )}

      <ProjectImportModal
        open={projectImport}"""),

    # ---- 列表按分组显示 ----
    ('{ordered.map((r, i) => (', """          {rules.map((r) => (
            <div
              key={r.id}""",
     """          {ordered.map((r, i) => (
            <Fragment key={r.id}>
              {groupOf(r) !== groupOf(ordered[i - 1]) && (
                <GroupHeaderRow name={groupOf(r)} stat={groupStat(groupOf(r))} onToggle={toggleGroup} />
              )}
            <div"""),
    ('</Fragment>', """              </div>
            </div>
          ))}
        </div>
      )}""",
     """              </div>
            </div>
            </Fragment>
          ))}
        </div>
      )}"""),

    # ---- 分组标题组件 ----
    ('function GroupHeaderRow', """// 整蛊排队展示：规则按优先级排队执行，这个窗口把「正在执行 + 排队中」摆上直播画面""",
     """// 分组标题行：一个组 = 一个品游项目，右边小开关整组开停。
// ★没绑礼物的规则开了也不会触发（主进程拦着），所以这里把条数标出来。
function GroupHeaderRow({
  name,
  stat,
  onToggle
}: {
  name: string
  stat: { total: number; enabled: number; unbound: number }
  onToggle: (name: string, on: boolean) => void | Promise<void>
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 px-1 pt-1 first:mt-0" aria-label={`项目 ${name}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-semibold text-[var(--text-2)]">{name}</span>
        <span className="tnum shrink-0 text-[11px] text-[var(--text-4)]">
          {stat.enabled}/{stat.total} 启用
        </span>
        {stat.unbound > 0 && <Pill tone="warn">{stat.unbound} 条未绑礼物</Pill>}
      </div>
      <Toggle value={stat.enabled > 0} onChange={(on) => void onToggle(name, on)} />
    </div>
  )
}

// 整蛊排队展示：规则按优先级排队执行，这个窗口把「正在执行 + 排队中」摆上直播画面"""),
]


def main() -> int:
    src = io.open(FILE, encoding='utf-8').read()
    out = src
    bad = []
    for marker, old, new in EDITS:
        if marker in out:
            print('  已有 %s，跳过' % marker[:40])
            continue
        if old not in out:
            bad.append(old.strip().splitlines()[0][:70])
            continue
        out = out.replace(old, new, 1)
    if bad:
        for b in bad:
            print('！锚点没对上：%s' % b)
        return 2
    if out != src:
        io.open(FILE, 'w', encoding='utf-8', newline='').write(out)
        print('EntertainmentGiftRules.tsx %d → %d' % (len(src), len(out)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
