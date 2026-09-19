import { create } from 'zustand'
import type { PrankGroup } from '@shared/types'

// 整蛊菜单（按游戏、按分组）。数据来自主进程的定义包（更新源优先、客户端自带兜底），
// 渲染层不再写死任何整蛊名 —— mod 上新整蛊只要发定义包，客户端菜单自动跟上（2026-09-14）。
interface PrankState {
  catalog: Record<string, PrankGroup[]>
  loaded: boolean
  load: () => Promise<void>
}

let inflight: Promise<void> | null = null

export const usePrankStore = create<PrankState>((set) => ({
  catalog: {},
  loaded: false,
  load: () => {
    if (inflight) return inflight
    inflight = window.api
      .prankCatalog()
      .then((catalog) => set({ catalog: catalog || {}, loaded: true }))
      .catch(() => {
        /* 拿不到就保持现状（空菜单只是暂时的，主进程一广播就会重拉） */
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }
}))
