# -*- coding: utf-8 -*-
"""礼物名和启用开关搬到列表行里直接改（2026-09-08 用户：
  「那个礼物触发多个礼物能不能拿到外面来，现在要点好几下设置好不方便」）

以前绑一条礼物要：点「编辑」→ 填礼物名 → 点「保存」→ 关弹窗，三四下点击 ×N 条规则。
导入品游项目动辄几十条（「虚拟主播时间」61 条），照这么点没法用。
现在：列表每行直接有礼物名输入框 + 启用开关；
      输入框回车 = 存下并跳到下一条的输入框（连着打完一个项目不用碰鼠标）。

用法：python tools/patch-inline-gift.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, 'src', 'renderer', 'src', 'pages', 'EntertainmentGiftRules.tsx')

EDITS = [
    # ---- 行内编辑用的状态 ----
    ('const giftDraft', """  const [presetName, setPresetName] = useState('')""",
     """  const [presetName, setPresetName] = useState('')
  // 行内改礼物名：草稿存在这里，失焦/回车才写库（每敲一个字都写库会卡）
  const [giftDraft, setGiftDraft] = useState<Record<string, string>>({})
  const [giftSaving, setGiftSaving] = useState('')
  // 回车跳到下一条的输入框：连着填一个项目的礼物不用碰鼠标
  const giftInputs = useRef<Record<string, HTMLInputElement | null>>({})"""),

    # ---- 行内保存 / 行内开关 ----
    ('const saveGiftName', """  const remove = async (id: string) => {""",
     """  // 行内存礼物名。★没绑礼物的规则本来就是停用的，这里【只存礼物名不自动启用】——
  //   一次导入几十条，自动启用等于突然全部生效，主播该自己按项目开关打开。
  const saveGiftName = async (rule: EntertainmentRule, next: string) => {
    const value = next.trim()
    if (value === String(rule.giftName || '').trim()) {
      setGiftDraft((prev) => { const copy = { ...prev }; delete copy[rule.id]; return copy })
      return true
    }
    setGiftSaving(rule.id)
    try {
      const r = await window.api.entertainmentRuleUpdate({ ...rule, giftName: value })
      if (!r.ok) {
        toast(r.error ?? '保存失败', 'error')
        return false
      }
      setGiftDraft((prev) => { const copy = { ...prev }; delete copy[rule.id]; return copy })
      await load()
      return true
    } finally {
      setGiftSaving('')
    }
  }

  // 行内开关一条规则（原来要进弹窗才能开停）
  const toggleRule = async (rule: EntertainmentRule, on: boolean) => {
    const r = await window.api.entertainmentRuleUpdate({ ...rule, enabled: on })
    if (!r.ok) return toast(r.error ?? '保存失败', 'error')
    await load()
  }

  const remove = async (id: string) => {"""),

    # ---- 页面级 datalist：行内输入框也要用礼物名候选 ----
    ('ent-gift-presets" data-page-level', """      <ProjectImportModal
        open={projectImport}""",
     """      {/* 礼物名候选（146 个抖音礼物）：弹窗和列表行内的输入框共用这一份 */}
      <datalist id="ent-gift-presets" data-page-level>
        {GIFT_PRESETS.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <ProjectImportModal
        open={projectImport}"""),

    # ---- 左边：礼物名那两个 pill 换成一句话（真正的输入框挪到右边操作区）----
    ('未绑礼物</Pill>', """                  {/* 规则名和礼物名是两回事：名字是人认的，礼物名才是触发条件 */}
                  {r.giftName ? (
                    <span className="shrink-0 text-xs text-[var(--text-3)]">礼物：{r.giftName}</span>
                  ) : (
                    <Pill tone="warn">未设礼物</Pill>
                  )}""",
     """                  {/* 规则名和礼物名是两回事：名字是人认的，礼物名才是触发条件。
                      礼物名的输入框在这一行右边，不用再进弹窗改 */}
                  {!r.giftName && <Pill tone="warn">未绑礼物</Pill>}"""),

    # ---- 右边：礼物名输入框 + 启用开关 ----
    ('aria-label={`规则 ${r.name || r.giftName || \'\'} 的礼物名`}', """              <div className="flex shrink-0 items-center gap-1">
                <Btn size="sm" variant="ghost" onClick={() => trigger(r)} title="测试触发">""",
     """              <div className="flex shrink-0 items-center gap-1">
                {/* 礼物名直接在这儿填：回车存下并跳到下一条 */}
                <Input
                  aria-label={`规则 ${r.name || r.giftName || ''} 的礼物名`}
                  value={giftDraft[r.id] ?? r.giftName ?? ''}
                  list="ent-gift-presets"
                  placeholder="填礼物名"
                  disabled={giftSaving === r.id}
                  ref={(el) => { giftInputs.current[r.id] = el }}
                  onChange={(e) => setGiftDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  onBlur={(e) => void saveGiftName(r, e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') {
                      setGiftDraft((prev) => { const copy = { ...prev }; delete copy[r.id]; return copy })
                      e.currentTarget.blur()
                      return
                    }
                    if (e.key !== 'Enter') return
                    const ok = await saveGiftName(r, e.currentTarget.value)
                    if (!ok) return
                    // 跳到下一条（列表当前顺序），连着填一个项目不用碰鼠标
                    const index = ordered.findIndex((x) => x.id === r.id)
                    const next = ordered[index + 1]
                    if (next) giftInputs.current[next.id]?.focus()
                    else e.currentTarget.blur()
                  }}
                  className={`h-8 w-28 text-xs ${r.giftName ? '' : 'border-[var(--warn)]'}`}
                />
                {/* 开关也搬出来：原来开停一条规则得进弹窗 */}
                <Toggle
                  value={r.enabled !== false}
                  disabled={!String(r.giftName || '').trim()}
                  onChange={(on) => void toggleRule(r, on)}
                />
                <Btn size="sm" variant="ghost" onClick={() => trigger(r)} title="测试触发">"""),

    # ---- 顶部说明改一句：告诉主播可以直接在列表里填 ----
    ('直接在下面每行填礼物名', """          收到礼物时自动执行对应动作（键鼠 / 脚本 / 音效 / 系统动作）。礼物名来自连接器日志，
          如「火箭」「小心心」。测试触发用规则右侧的 ▶ 按钮。""",
     """          收到礼物时自动执行对应动作（键鼠 / 脚本 / 音效 / 系统动作）。礼物名来自连接器日志，
          如「火箭」「小心心」——<b className="text-[var(--text-2)]">直接在下面每行填礼物名</b>，
          回车就存并跳到下一条；右边的开关开停这条规则。测试触发用 ▶ 按钮。"""),
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
