import { create } from 'zustand'
import type { SessionUser } from '@shared/types'

interface AuthState {
  user: SessionUser | null
  loading: boolean
  setUser: (u: SessionUser | null) => void
  setLoading: (b: boolean) => void
  updateRooms: (rooms: string[]) => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  updateRooms: (rooms) =>
    set((s) => ({ user: s.user ? { ...s.user, boundRooms: rooms } : null }))
}))
