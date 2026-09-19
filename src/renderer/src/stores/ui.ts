import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface UiState {
  toasts: Toast[]
  toast: (text: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

let toastSeq = 0

export const useToast = create<UiState>((set, get) => ({
  toasts: [],
  toast: (text, kind = 'info') => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismiss(id), 3800)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))
