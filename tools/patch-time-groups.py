# -*- coding: utf-8 -*-
"""时间插件：盲盒事件按项目分组 + 每组一个小开关 + 整套设置导出导入。
用户 2026-09-08：「时间插件也要做项目规划预设开关规划。导出导入设置」

顺带修一个真 bug：「开时间盲盒」动作命令留空参数本该「从全部启用的事件里随机抽」，
实际 ids 传了 undefined，resolveTimeBlindBoxPool 直接报「盲盒奖池为空」——从来没随机抽成过。

用法：python tools/patch-time-groups.py
"""
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

# ---------------- types ----------------
ok &= edit('src/shared/types.ts', [
    ('/** 分组：来自品游项目名', """export interface TimeBlindBoxEvent {
  id: string
  name: string""",
     """export interface TimeBlindBoxEvent {
  id: string
  name: string
  /** 分组：来自品游项目名（导入时自动填）。主播按项目整组开关 */
  group?: string
  /** 停用的事件不参与抽奖（整组开关就是批量改这个字段）；缺省 = 启用 */
  enabled?: boolean"""),
])

# ---------------- timeBlindBox.ts ----------------
ok &= edit('src/shared/timeBlindBox.ts', [
    ("group: String(item.group", """    id: String(item.id ?? '').trim(), name: String(item.name ?? '').trim(),""",
     """    id: String(item.id ?? '').trim(), name: String(item.name ?? '').trim(),
    group: String(item.group ?? '').trim(), enabled: item.enabled !== false,"""),
    ('skipDisabled', """export function resolveTimeBlindBoxPool(events: TimeBlindBoxEvent[], ids: string[] | undefined): { ok: boolean; events?: TimeBlindBoxEvent[]; error?: string } {
  const chosen = [...new Set(Array.isArray(ids) ? ids : [])]
  if (!chosen.length) return { ok: false, error: '盲盒奖池为空，请选择参与抽奖的事件' }
  const pool: TimeBlindBoxEvent[] = []
  for (const id of chosen) {
    const matches = events.filter(event => event.id === id)
    if (matches.length !== 1) return { ok: false, error: matches.length ? '事件编号重复，请重新保存事件' : '奖池中的事件已删除，请重新选择' }
    const error = validateTimeBlindBoxEvent(matches[0])
    if (error) return { ok: false, error: `「${matches[0].name || '未命名事件'}」：${error}` }
    pool.push({ ...matches[0] })
  }
  return { ok: true, events: pool }
}""",
     """/**
 * 把选中的事件 id 解析成抽奖池。
 * skipDisabled=true 时跳过停用的事件（真触发走这条：项目开关关了就不该抽到它）；
 * 缺省 false 保留原行为，让「测试」按钮能试停用的事件。
 */
export function resolveTimeBlindBoxPool(
  events: TimeBlindBoxEvent[],
  ids: string[] | undefined,
  options?: { skipDisabled?: boolean }
): { ok: boolean; events?: TimeBlindBoxEvent[]; error?: string } {
  const chosen = [...new Set(Array.isArray(ids) ? ids : [])]
  if (!chosen.length) return { ok: false, error: '盲盒奖池为空，请选择参与抽奖的事件' }
  const pool: TimeBlindBoxEvent[] = []
  let disabled = 0
  for (const id of chosen) {
    const matches = events.filter(event => event.id === id)
    if (matches.length !== 1) return { ok: false, error: matches.length ? '事件编号重复，请重新保存事件' : '奖池中的事件已删除，请重新选择' }
    if (options?.skipDisabled && matches[0].enabled === false) { disabled += 1; continue }
    const error = validateTimeBlindBoxEvent(matches[0])
    if (error) return { ok: false, error: `「${matches[0].name || '未命名事件'}」：${error}` }
    pool.push({ ...matches[0] })
  }
  // 全被项目开关关掉了：说清是「停用」而不是「没选」，不然主播只会以为奖池坏了
  if (!pool.length) return { ok: false, error: disabled ? `奖池里 ${disabled} 个事件都停用了，去事件库把项目开关打开` : '盲盒奖池为空，请选择参与抽奖的事件' }
  return { ok: true, events: pool }
}

/** 事件库按项目分组一览（界面按组显示 + 组开关要用） */
export function blindBoxGroups(events: TimeBlindBoxEvent[]): { group: string; total: number; enabled: number }[] {
  const map = new Map<string, { total: number; enabled: number }>()
  for (const event of events) {
    const key = String(event.group || '').trim() || '未分组'
    const cur = map.get(key) || { total: 0, enabled: 0 }
    cur.total += 1
    if (event.enabled !== false) cur.enabled += 1
    map.set(key, cur)
  }
  return [...map].map(([group, v]) => ({ group, ...v }))
}"""),
])

# ---------------- pinyouTime.ts：导入的事件带项目名 ----------------
ok &= edit('src/shared/pinyouTime.ts', [
    ('group: idPrefix', """  return {
    id: `${idPrefix}-${index + 1}`,
    name: entry.name.slice(0, 40),""",
     """  return {
    id: `${idPrefix}-${index + 1}`,
    name: entry.name.slice(0, 40),
    group: idPrefix,   // ★项目名 = 分组名：主播按项目整组开关、存成预设
    enabled: true,"""),
])

# ---------------- time-widget.ts：真触发跳过停用；留空参数真的随机抽 ----------------
ok &= edit('src/main/time-widget.ts', [
    ('从全部启用的事件里抽', """  const ids = want
    ? all.filter((e) => e.id === want || String(e.name || '').trim() === want).map((e) => e.id)
    : undefined
  if (want && !ids?.length) return { ok: false, error: `没有找到盲盒事件「${want}」` }
  const pool = resolveTimeBlindBoxPool(all, ids)""",
     """  // ★留空 = 从全部启用的事件里抽。以前这里传 undefined，resolveTimeBlindBoxPool
  //   一律回「盲盒奖池为空」，所以「开时间盲盒」不填名字从来没抽成过。
  const ids = want
    ? all.filter((e) => e.id === want || String(e.name || '').trim() === want).map((e) => e.id)
    : all.filter((e) => e.enabled !== false).map((e) => e.id)
  if (want && !ids.length) return { ok: false, error: `没有找到盲盒事件「${want}」` }
  if (!ids.length) return { ok: false, error: '事件库里没有启用的盲盒事件' }
  const pool = resolveTimeBlindBoxPool(all, ids, { skipDisabled: true })"""),
    ('row.blindBoxEventIds, { skipDisabled: true }',
     "    const pool = resolveTimeBlindBoxPool(config.blindBoxEvents || [], row.blindBoxEventIds)",
     "    const pool = resolveTimeBlindBoxPool(config.blindBoxEvents || [], row.blindBoxEventIds, { skipDisabled: true })"),
])

print('\n' + ('写入完成' if ok else '★有锚点没对上'))
sys.exit(0 if ok else 2)
