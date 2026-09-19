# -*- coding: utf-8 -*-
"""礼物触发页：单个项目导出、单个预设导出，导入时把素材路径改到本机。
用户 2026-09-08：「增加一个可以导出预设，或者单独项目的设置导出」
                「别的主播也想要这个项目的话，可以直接导出这个项目给别人」
用法：python tools/patch-export-ui.py"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, 'src', 'renderer', 'src', 'pages', 'EntertainmentGiftRules.tsx')

EDITS = [
    # ---- 统一的下载函数 + 分项目/分预设导出 ----
    ('const downloadJson', """  // 导出配置为 JSON 文件：规则 + 项目预设一整包（换台电脑、换个直播方案都能带走）""",
     """  // 存成 JSON 文件（浏览器下载那套，Electron 里会落到下载目录）
  const downloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
  const today = () => new Date().toISOString().slice(0, 10)

  // 单个项目导出：别的主播想要这个项目，直接把这个文件发给他。
  // ★只带规则，不带视频——素材得另外发（对方把同名文件夹放进自己的素材目录即可）
  const exportGroup = (group: string) => {
    const rows = rules.filter((r) => String(r.group || '').trim() === group)
    if (!rows.length) return toast('这个项目下没有规则', 'error')
    downloadJson(
      { kind: 'zhiliao-ent-rules', version: 1, project: group, exportedAt: new Date().toISOString(), rules: rows },
      `项目_${group}_${today()}.json`
    )
    toast(`已导出项目「${group}」${rows.length} 条规则。视频素材要另外发给对方，让他把同名文件夹放进自己的品游素材目录`, 'success')
  }

  // 单个预设导出：预设 + 它涉及的那些项目的规则，一份文件就能让对方复现这套直播方案
  const exportPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return toast('先在下拉里选一个预设', 'error')
    const want = new Set(preset.groups)
    const rows = rules.filter((r) => want.has(String(r.group || '').trim()))
    downloadJson(
      {
        kind: 'zhiliao-ent-rules',
        version: 1,
        exportedAt: new Date().toISOString(),
        rules: rows,
        presets: [{ id: preset.id, name: preset.name, groups: preset.groups }]
      },
      `预设_${preset.name}_${today()}.json`
    )
    toast(`已导出预设「${preset.name}」：${preset.groups.length} 个项目、${rows.length} 条规则`, 'success')
  }

  // 导出配置为 JSON 文件：规则 + 项目预设一整包（换台电脑、换个直播方案都能带走）"""),

    # ---- 全量导出改用 downloadJson ----
    ('downloadJson(payload,', """    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `礼物触发规则_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('配置已导出', 'success')""",
     """    downloadJson(payload, `礼物触发规则_${today()}.json`)
    toast('配置已导出（含项目预设）', 'success')"""),

    # ---- 导入：先把素材路径改到本机 ----
    ('pinyouRelocateRules', """      if (!arr.length) throw new Error('格式不对')
      let added = 0
      let skipped = 0
      for (const r of arr) {""",
     """      if (!arr.length) throw new Error('格式不对')
      // ★别人导出的路径是他机器上的（盘符/目录都不一样）：按项目文件夹名改到本机素材目录，
      //   改不动的如实报出来——对方缺的是视频素材本身。
      let moved = 0
      let missing: string[] = []
      let list = arr
      try {
        const fixed = await window.api.pinyouRelocateRules(arr)
        list = fixed.rules
        moved = fixed.moved
        missing = fixed.missing
      } catch {
        /* 改不了就按原样导入，不因为这一步整个失败 */
      }
      let added = 0
      let skipped = 0
      for (const r of list) {"""),

    ('已改到本机素材目录', """      const tail = [
        skipped ? `${skipped} 条没导入（缺规则名和礼物名）` : '',
        presetAdded ? `${presetAdded} 个预设` : ''
      ].filter(Boolean).join('，')
      toast(`已导入 ${added} 条规则${tail ? '，' + tail : ''}`, added ? 'success' : 'error')""",
     """      const tail = [
        skipped ? `${skipped} 条没导入（缺规则名和礼物名）` : '',
        presetAdded ? `${presetAdded} 个预设` : '',
        moved ? `${moved} 处素材路径已改到本机素材目录` : ''
      ].filter(Boolean).join('，')
      toast(`已导入 ${added} 条规则${tail ? '，' + tail : ''}`, added ? 'success' : 'error')
      if (missing.length) {
        toast(`本机素材目录里没有这些项目文件夹：${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}——把对方的视频文件夹放进素材目录再试`, 'info')
      }"""),

    # ---- 预设栏加「导出这个预设」 ----
    ('title="把这个预设连它的项目规则一起导出', """          {presetPick && (
            <Btn size="sm" variant="ghost" onClick={() => void deletePreset()} title="删除这个预设">
              <Trash2 size={13} />
            </Btn>
          )}""",
     """          {presetPick && (
            <>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => exportPreset(presetPick)}
                title="把这个预设连它的项目规则一起导出，发给别的主播"
                aria-label="导出这个预设"
              >
                <Download size={13} />
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => void deletePreset()} title="删除这个预设">
                <Trash2 size={13} />
              </Btn>
            </>
          )}"""),

    # ---- 组标题加「导出这个项目」 ----
    ('onExport', """                <GroupHeaderRow name={groupOf(r)} stat={groupStat(groupOf(r))} onToggle={toggleGroup} />""",
     """                <GroupHeaderRow
                  name={groupOf(r)}
                  stat={groupStat(groupOf(r))}
                  onToggle={toggleGroup}
                  onExport={exportGroup}
                />"""),

    ('onExport: (name: string) => void', """function GroupHeaderRow({
  name,
  stat,
  onToggle
}: {
  name: string
  stat: { total: number; enabled: number; unbound: number }
  onToggle: (name: string, on: boolean) => void | Promise<void>
}) {""",
     """function GroupHeaderRow({
  name,
  stat,
  onToggle,
  onExport
}: {
  name: string
  stat: { total: number; enabled: number; unbound: number }
  onToggle: (name: string, on: boolean) => void | Promise<void>
  onExport: (name: string) => void
}) {"""),

    ('aria-label={`导出项目 ${name}`}', """      <Toggle value={stat.enabled > 0} onChange={(on) => void onToggle(name, on)} />""",
     """      <div className="flex shrink-0 items-center gap-1">
        {/* 单个项目导出：别的主播想要这个项目，把这个文件发给他就行 */}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => onExport(name)}
          title={`导出「${name}」这一个项目的规则（发给别的主播用；视频素材要另外发）`}
          aria-label={`导出项目 ${name}`}
        >
          <Download size={12} />
        </Btn>
        <Toggle value={stat.enabled > 0} onChange={(on) => void onToggle(name, on)} />
      </div>"""),
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
    for b in bad:
        print('！锚点没对上：%s' % b)
    if bad:
        return 2
    if out != src:
        io.open(FILE, 'w', encoding='utf-8', newline='').write(out)
        print('EntertainmentGiftRules.tsx %d → %d' % (len(src), len(out)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
