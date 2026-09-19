# -*- coding: utf-8 -*-
"""透明图：加「从礼物规则生成」——菜单按【当前启用的礼物规则】生成。
用户 2026-09-08：「透明图那边还是只有从游戏配置生成，没有从启动规则方案处生成…
                 透明图那边也是读预设就好了」
主播用项目预设开了哪几个项目，菜单就只有那几个项目，观众看到的 = 实际能触发的。
用法：python tools/patch-transparent-from-rules.py"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, 'src', 'renderer', 'src', 'pages', 'EntertainmentTransparent.tsx')

EDITS = [
    # 图标 + ruleActionLabel
    ('ListChecks', ", Gamepad2, Copy } from 'lucide-react'", ", Gamepad2, Copy, ListChecks } from 'lucide-react'"),
    ("from '@shared/entertainmentLabels'",
     "import type { EntertainmentGiftImage, TransparentColorRecord, TransparentGiftVersion } from '@shared/types'",
     "import type { EntertainmentGiftImage, TransparentColorRecord, TransparentGiftVersion } from '@shared/types'\n"
     "import { ruleActionLabel } from '@shared/entertainmentLabels'"),

    # 生成函数：插在 importFromGameConfig 之前
    ('const importFromRules',
     """  // 一键从当前游戏的礼物映射（GiftMap）生成菜单：菜单和游戏实际触发永远一致，
  // 这才是「正确」——手打的菜单迟早和配置对不上。
  const importFromGameConfig = async () => {""",
     """  // 一键从「礼物触发」的规则生成菜单：只取【当前启用】的规则。
  // 主播在礼物触发页用「项目预设」开了哪几个项目，这里就只出那几个项目 ——
  // 观众看到的菜单 = 实际能触发的东西，换直播换个预设，菜单跟着变。
  const importFromRules = async () => {
    const rules = await window.api.entertainmentRulesList()
    const live = rules.filter(
      (rule) =>
        rule.enabled !== false &&
        String(rule.giftName || '').trim() &&
        (rule.triggerType || 'gift') === 'gift'
    )
    if (!live.length) {
      return toast('没有启用中的礼物规则：先去「礼物触发」开几个项目，或选一个项目预设', 'error')
    }
    // 同一个礼物可能挂了好几条规则（几个项目都绑了它）：合成一行，效果用「、」连起来
    const merged = new Map<string, { name: string; effects: string[] }>()
    for (const rule of live) {
      const gift = String(rule.giftName).trim()
      const key = normalizedLabel(gift)
      // 展示用的是规则名（品游项目里的条目名，主播自己起的），没名字才退回动作描述
      const label = String(rule.name || '').trim() || ruleActionLabel(rule)
      const row = merged.get(key) || { name: gift, effects: [] }
      if (label && !row.effects.includes(label)) row.effects.push(label)
      merged.set(key, row)
    }
    const rows: GiftLibraryItem[] = [...merged].map(([key, row], index) => {
      const image = giftImageByKey.get(key)
      return {
        id: `gift-rule-${index}-${row.name}`,
        platform: 'dy',
        name: image?.name || row.name,
        giftId: image?.giftId || '',
        diamondCount: image?.diamondCount ?? DOUYIN_PRICES.get(key) ?? 0,
        giftData: '',
        imagePath: image?.path || '',
        imageName: '',
        // 一个礼物挂太多条就截断，菜单一行放不下那么多字
        effect: row.effects.slice(0, 3).join('、') + (row.effects.length > 3 ? ' 等' : '')
      }
    })
    rows.sort((a, b) => (a.diamondCount || 0) - (b.diamondCount || 0))
    setGiftMenuItems(rows)
    setGiftMenuPreview(true)
    const groups = new Set(live.map((rule) => String(rule.group || '').trim()).filter(Boolean))
    toast(
      `已按启用中的规则生成 ${rows.length} 行（便宜→贵）` + (groups.size ? `，${groups.size} 个项目` : ''),
      'success'
    )
  }

  // 一键从当前游戏的礼物映射（GiftMap）生成菜单：菜单和游戏实际触发永远一致，
  // 这才是「正确」——手打的菜单迟早和配置对不上。
  const importFromGameConfig = async () => {"""),

    # 按钮
    ('从礼物规则生成',
     """                <div className="mt-1.5 flex gap-2">
                  <Btn size="sm" variant="secondary" onClick={importFromGameConfig} className="flex-1" title="按当前游戏礼物映射自动生成"><Gamepad2 size={13} /> 从游戏配置生成</Btn>
                  <Btn size="sm" variant="ghost" onClick={sortMenuByPrice} title="按礼物价格重排当前列表（便宜→贵）">按价排序</Btn>
                </div>""",
     """                <div className="mt-1.5 flex gap-2">
                  <Btn size="sm" variant="secondary" onClick={importFromRules} className="flex-1" title="按「礼物触发」里当前启用的规则生成（用项目预设开哪几个项目，这儿就出哪几个）"><ListChecks size={13} /> 从礼物规则生成</Btn>
                  <Btn size="sm" variant="secondary" onClick={importFromGameConfig} className="flex-1" title="按当前游戏礼物映射自动生成"><Gamepad2 size={13} /> 从游戏配置生成</Btn>
                </div>
                <div className="mt-1.5 flex gap-2">
                  <Btn size="sm" variant="ghost" onClick={sortMenuByPrice} title="按礼物价格重排当前列表（便宜→贵）">按价排序</Btn>
                </div>"""),

    # 空态提示也提一句
    ('从礼物规则一键生成',
     "上面写好「礼物名 = 整蛊」点生成，或从游戏配置一键生成",
     "上面写好「礼物名 = 整蛊」点生成，或从礼物规则一键生成"),
]


def main() -> int:
    src = io.open(FILE, encoding='utf-8').read()
    out = src
    bad = []
    for marker, old, new in EDITS:
        if marker in out:
            print('  已有 %s，跳过' % marker[:36])
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
        print('EntertainmentTransparent.tsx %d → %d' % (len(src), len(out)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
