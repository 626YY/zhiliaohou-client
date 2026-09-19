// 整蛊菜单的读取入口。
//   2026-09-14 之前这里写死三款游戏的整蛊清单（和 mods-catalog/schemas/*/pranks.json 各一份，靠人手同步），
//   mod 上新整蛊必须发一版客户端，老客户端见到不认识的 id 就把英文 id 显示给主播。
//   现在唯一来源是主进程的定义包（stores/pranks.ts 拉一次 + 更新源刷新后重拉），这里只剩读法。
import type { PrankDef, PrankGroup } from '@shared/types'
import { usePrankStore } from '../stores/pranks'

export type { PrankDef, PrankGroup }

/**
 * 某款游戏的整蛊菜单（按分组）。同步读 store，组件里配合 usePrankCatalog() 订阅，
 * 定义包到位 / 刷新时会重渲染；还没拉到时是空数组（不是错误，几毫秒后就有）。
 */
export function prankGroups(gameId: string): PrankGroup[] {
  const catalog = usePrankStore.getState().catalog
  // 不认识的 id（老代码有传 'wheellive' / 空串的）按轮椅算，和以前写死时的兜底一致
  return catalog[gameId] ?? catalog['4wheel-challenge'] ?? []
}

/** 订阅整个菜单表：组件里调一下，菜单变化就重渲染 */
export function usePrankCatalog(): Record<string, PrankGroup[]> {
  return usePrankStore((s) => s.catalog)
}

/** 某款游戏 prankId → 中文名 */
export function prankNameMap(gameId: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const g of prankGroups(gameId)) for (const it of g.items) m.set(it.id, it.name)
  return m
}
