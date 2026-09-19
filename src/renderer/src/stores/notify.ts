import { create } from 'zustand'

interface NotifyState {
  unread: number
  setUnread: (n: number) => void
  bump: () => void
}

export const useNotify = create<NotifyState>((set) => ({
  unread: 0,
  setUnread: (n) => set({ unread: n }),
  bump: () => set((s) => ({ unread: s.unread + 1 }))
}))
