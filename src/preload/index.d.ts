import type { ZLAPI } from './index'

declare global {
  interface Window {
    api: ZLAPI
  }
}

export {}
