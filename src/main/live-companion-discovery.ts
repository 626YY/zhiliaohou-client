import { basename, dirname, join } from 'node:path'

// 只接受抖音程序名，绝不把 B 站 livehime 当作直播伴侣。
export const COMPANION_EXE = '直播伴侣.exe'
export const COMPANION_LAUNCHER = '直播伴侣 Launcher.exe'
export interface CompanionProbe {
  fileExists(path: string): boolean
  directories(path: string): string[]
}

export function companionExecutable(input: string, probe: CompanionProbe): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim().replace(/^"|"$/g, '')
  if (!value) return null
  if ([COMPANION_EXE, COMPANION_LAUNCHER].some((name) => name.toLowerCase() === basename(value).toLowerCase())) {
    return probe.fileExists(value) ? value : null
  }
  // 用户可选安装根目录，也可选当前版本目录。
  for (const name of [COMPANION_LAUNCHER, COMPANION_EXE]) {
    const file = join(value, name)
    if (probe.fileExists(file)) return file
  }
  const versions = probe.directories(value).filter((name) => /^\d+(?:\.\d+)+$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of versions) {
    const file = join(value, version, COMPANION_EXE)
    if (probe.fileExists(file)) return file
  }
  return null
}

export function discoverCompanion(
  sources: { preferred?: string; processes?: string[]; defaults?: string[]; registry?: string[] },
  probe: CompanionProbe
): { installDir: string; exePath: string } | null {
  for (const candidate of [sources.preferred || '', ...(sources.processes || []), ...(sources.defaults || []), ...(sources.registry || [])]) {
    const exePath = companionExecutable(candidate, probe)
    if (exePath) return { installDir: dirname(exePath), exePath }
  }
  return null
}

export function companionRegistryLocations(entries: unknown): string[] {
  return (Array.isArray(entries) ? entries : [entries]).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const e = entry as Record<string, unknown>
    const name = String(e.DisplayName || '')
    if (!/直播伴侣|webcast_mate/i.test(name) || /哔哩|bilibili|bililive|livehime/i.test(name)) return []
    const location = String(e.InstallLocation || '').trim()
    const icon = String(e.DisplayIcon || '').replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '')
    return [location, icon].filter(Boolean)
  })
}
