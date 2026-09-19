# -*- coding: utf-8 -*-
"""规则分组 + 预设，透明图菜单从规则读（2026-09-08 用户）：
  「触发礼物项目那里应该给一个预设功能，可以自己设置开什么项目有一个小开关，
    然后透明图那边也是读预设就好了」
  「透明图那边还是只有从游戏配置生成，没有从启动规则方案处生成」

模型：
  分组（group）= 一个品游项目（「虚拟主播时间」），导入时自动填；手建的规则可自己填
  预设（preset）= 「今晚开哪几个组」的一套组合，应用时把这些组的规则启用、其余停用
  透明图菜单 = 从【当前启用的规则】生成（礼物名 + 规则名当效果说明），
              所以观众看到的菜单永远等于实际能触发的东西

改动：
  types.ts        EntertainmentRule 加 group?；新增 EntertainmentPreset；4 个 IPC 通道
  entertainment.ts 分组开关 / 预设 CRUD / 应用预设（都在主进程，连接器和透明图都能读到同一份）
  ipc.ts + preload  接上
用法：python tools/patch-rule-presets.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731

# ---------------- types.ts ----------------
T_RULE_OLD = """  /** 备注：导入来源之类（「品游 虚拟主播时间」），只给人看 */
  remark?: string"""
T_RULE_NEW = """  /** 备注：导入来源之类（「品游 虚拟主播时间」），只给人看 */
  remark?: string
  /**
   * 分组：一般就是品游项目名（「虚拟主播时间」），导入时自动填。
   * 主播按组开关（今晚开哪几个项目），预设保存的就是「开哪几个组」。
   */
  group?: string"""

T_PRESET_OLD = """export interface EntertainmentRulesResult {"""
T_PRESET_NEW = """/**
 * 规则预设：「今晚开哪几个项目」的一套组合。
 * 应用时把 groups 里的组全部启用、其余组停用（没分组的规则不动）。
 * 透明图的观众菜单也从当前启用的规则生成，所以菜单和实际能触发的永远一致。
 */
export interface EntertainmentPreset {
  id: string
  name: string
  groups: string[]
  updatedAt?: number
}

export interface EntertainmentRulesResult {"""

T_IPC_OLD = "  PinyouTimeImport: 'pinyou:time-import',"
T_IPC_NEW = """  PinyouTimeImport: 'pinyou:time-import',
  EntertainmentGroupToggle: 'ent:group-toggle',
  EntertainmentPresetList: 'ent:preset-list',
  EntertainmentPresetSave: 'ent:preset-save',
  EntertainmentPresetRemove: 'ent:preset-remove',
  EntertainmentPresetApply: 'ent:preset-apply',"""

# ---------------- entertainment.ts ----------------
E_ANCHOR = "export function removeRule(id: string): { ok: boolean } {"
E_NEW = '''/** 规则分组一览：每组几条、开着几条 —— 界面按组显示、组开关要用 */
export function ruleGroups(): { group: string; total: number; enabled: number }[] {
  const map = new Map<string, { total: number; enabled: number }>()
  for (const r of allRules()) {
    const g = String(r.group || '').trim()
    if (!g) continue
    const cur = map.get(g) || { total: 0, enabled: 0 }
    cur.total += 1
    if (r.enabled !== false) cur.enabled += 1
    map.set(g, cur)
  }
  return [...map].map(([group, v]) => ({ group, ...v })).sort((a, b) => a.group.localeCompare(b.group, 'zh'))
}

/**
 * 整组开关。
 * ★没绑礼物的规则开不起来（空礼物名永不匹配），所以这里只开有礼物名的，
 *   并把「因为没填礼物名而没能开起来」的条数报回去 —— 否则主播会以为开了却不触发。
 */
export function toggleRuleGroup(group: string, on: boolean): { ok: boolean; changed: number; skipped: number } {
  const g = String(group || '').trim()
  if (!g) return { ok: false, changed: 0, skipped: 0 }
  let changed = 0
  let skipped = 0
  for (const r of allRules()) {
    if (String(r.group || '').trim() !== g) continue
    if (on && !String(r.giftName || '').trim()) {
      skipped += 1
      continue
    }
    if ((r.enabled !== false) === on) continue
    rules.update(r.id, { enabled: on })
    changed += 1
  }
  if (changed) rulesCache = null
  return { ok: true, changed, skipped }
}

// ---- 预设：「今晚开哪几个组」----
const presets = createCollection<EntertainmentPreset>('ent-presets')

export function listPresets(): EntertainmentPreset[] {
  return presets.all()
}

export function savePreset(value: Partial<EntertainmentPreset>): { ok: boolean; id?: string; error?: string } {
  const name = String(value?.name || '').trim()
  if (!name) return { ok: false, error: '预设名不能为空' }
  const groups = [...new Set((Array.isArray(value?.groups) ? value.groups : []).map((g) => String(g || '').trim()).filter(Boolean))]
  const existing = presets.all().find((p) => p.id === value?.id || p.name === name)
  const id = existing?.id || randomUUID()
  const row = { id, name, groups, updatedAt: Date.now() }
  if (existing) presets.update(id, row)
  else presets.insert(row)
  return { ok: true, id }
}

export function removePreset(id: string): { ok: boolean } {
  presets.remove(String(id || ''))
  return { ok: true }
}

/** 应用预设：预设里的组全开，其它有分组的全关。没分组的规则不动（主播手建的别乱改） */
export function applyPreset(id: string): { ok: boolean; error?: string; on: number; off: number; skipped: number } {
  const preset = presets.all().find((p) => p.id === String(id || ''))
  if (!preset) return { ok: false, error: '找不到这个预设', on: 0, off: 0, skipped: 0 }
  const want = new Set(preset.groups.map((g) => String(g || '').trim()).filter(Boolean))
  let on = 0
  let off = 0
  let skipped = 0
  for (const r of allRules()) {
    const g = String(r.group || '').trim()
    if (!g) continue
    const shouldOn = want.has(g)
    if (shouldOn && !String(r.giftName || '').trim()) {
      skipped += 1
      if (r.enabled !== false) { rules.update(r.id, { enabled: false }); off += 1 }
      continue
    }
    if ((r.enabled !== false) === shouldOn) continue
    rules.update(r.id, { enabled: shouldOn })
    if (shouldOn) on += 1
    else off += 1
  }
  rulesCache = null
  return { ok: true, on, off, skipped }
}

''' + E_ANCHOR


def apply(path, pairs, tag):
    src = io.open(path, encoding="utf-8").read()
    out = src
    for old, new in pairs:
        if new.strip() and new.strip() in out:
            print("[%s] 已含目标代码，跳过一处" % tag)
            continue
        if old not in out:
            print("！[%s] 找不到锚点：%r" % (tag, old.strip().splitlines()[0][:60]))
            return None
        out = out.replace(old, new, 1)
    if out != src:
        io.open(path, "w", encoding="utf-8", newline="").write(out)
        print("[%s] 已写入（%d → %d）" % (tag, len(src), len(out)))
    return out


def main() -> int:
    if apply(P("src", "shared", "types.ts"),
             [(T_RULE_OLD, T_RULE_NEW), (T_PRESET_OLD, T_PRESET_NEW), (T_IPC_OLD, T_IPC_NEW)], "types.ts") is None:
        return 2
    if apply(P("src", "main", "entertainment.ts"), [(E_ANCHOR, E_NEW)], "entertainment.ts") is None:
        return 2

    # entertainment.ts 的类型 import 要有 EntertainmentPreset
    p = P("src", "main", "entertainment.ts")
    s = io.open(p, encoding="utf-8").read()
    if "EntertainmentPreset" in s and "type EntertainmentPreset" not in s and "EntertainmentPreset," not in s.split("createCollection")[0]:
        import re
        m = re.search(r"import type \{([^}]*)\} from '\.\./shared/types'", s) or re.search(r"import type \{([^}]*)\} from '@shared/types'", s)
        if m and "EntertainmentPreset" not in m.group(1):
            names = [n.strip() for n in m.group(1).split(",") if n.strip()]
            names.append("EntertainmentPreset")
            src_mod = s[m.start():m.end()]
            mod = "'@shared/types'" if "@shared/types" in src_mod else "'../shared/types'"
            s = s[: m.start()] + "import type { " + ", ".join(sorted(set(names))) + " } from " + mod + s[m.end():]
            io.open(p, "w", encoding="utf-8", newline="").write(s)
            print("[entertainment.ts] 已补 EntertainmentPreset 类型导入")
    print("\n下一步：ipc.ts / preload 接通道，UI 做分组与预设，透明图加「从礼物规则生成」")
    return 0


if __name__ == "__main__":
    sys.exit(main())
