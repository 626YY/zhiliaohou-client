import { create } from 'zustand'

// 有没有可用的游戏整蛊：游戏库里看得到的 mod（上架的，或者主播本机装着的）。
// 一个都没有时，侧边栏不放游戏库 / 参数调整 / 整蛊遥控 / 启动游戏这几页，打开软件直接进娱乐助手；
// 后台把 mod 上架、或者主播本机装着 mod，这几页自动回来。
// 2026-10-08 用户把游戏 mod 全部下架：「只有我在后台点上架才能看得到」。
interface GamesState {
  /** 已经问过主进程（没问到之前按「有游戏」显示，免得闪一下） */
  known: boolean
  hasGames: boolean
  refresh: () => Promise<void>
}

export const useGames = create<GamesState>((set) => ({
  known: false,
  hasGames: true,
  refresh: async () => {
    try {
      const r = await window.api.listMods()
      set({ known: true, hasGames: r.mods.length > 0 })
    } catch {
      // 读不到就照旧全部显示
      set({ known: true, hasGames: true })
    }
  }
}))

/** 只在有游戏整蛊时才有意义的页面 */
export const GAME_ONLY_PATHS = ['/', '/config', '/remote', '/launch']
export const isGameOnlyPath = (p: string): boolean => GAME_ONLY_PATHS.includes(p) || p.startsWith('/mod/')
