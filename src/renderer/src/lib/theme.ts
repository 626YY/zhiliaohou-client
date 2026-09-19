// 主题：九套外观，默认「自动」按时间段切换（6-18 点白天，其余黑夜）。
// 选择存在 localStorage（纯客户端偏好，不进服务器设置）。
export type ThemeMode = 'auto' | 'dark' | 'light' | 'cream' | 'ocean' | 'amethyst' | 'forest' | 'sakura' | 'terracotta' | 'moonlight'

const KEY = 'zl-theme'
export const THEME_MODES: ThemeMode[] = ['auto', 'dark', 'light', 'cream', 'ocean', 'amethyst', 'forest', 'sakura', 'terracotta', 'moonlight']
export const MOTION_THEMES: ThemeMode[] = ['ocean', 'amethyst', 'sakura', 'moonlight']
export const THEME_NOTES: Record<ThemeMode, string> = {
  auto: '昼夜随行', dark: '经典游戏库', light: '清爽白昼', cream: '暖调留白',
  ocean: '深蓝流光', amethyst: '霓虹夜航', forest: '静谧松绿', sakura: '落樱花笺', terracotta: '暖陶质感', moonlight: '月环漫游'
}

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY) as ThemeMode | null
  return v && THEME_MODES.includes(v) ? v : 'auto'
}

export function setThemeMode(m: ThemeMode): void {
  localStorage.setItem(KEY, m)
  applyTheme(m)
}

// 应用当前主题到 <html data-theme>；自动模式按本地时间解析
export function applyTheme(mode?: ThemeMode): void {
  const m = mode ?? getThemeMode()
  const eff = m === 'auto' ? resolveAuto() : m
  document.documentElement.dataset.theme = eff
  document.documentElement.dataset.motion = getThemeMotion() ? 'on' : 'off'
}

function resolveAuto(): 'dark' | 'light' {
  const h = new Date().getHours()
  return h >= 6 && h < 18 ? 'light' : 'dark'
}

export const THEME_LABELS: Record<ThemeMode, string> = {
  auto: '自动',
  dark: '黑夜',
  light: '白天',
  cream: '米色',
  ocean: '深海', amethyst: '紫晶', forest: '松林', sakura: '樱花', terracotta: '赤陶', moonlight: '月光'
}

export function getThemeMotion(): boolean { return localStorage.getItem('zl-theme-motion') !== 'off' }
export function setThemeMotion(enabled: boolean): void {
  localStorage.setItem('zl-theme-motion', enabled ? 'on' : 'off')
  document.documentElement.dataset.motion = enabled ? 'on' : 'off'
}
