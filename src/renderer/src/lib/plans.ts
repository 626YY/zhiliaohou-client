// 方案存取（复刻原版「插件配置倒计时 / 插件配置计数 / 插件配置加班」方案下拉）。
// 每个模块一个命名空间，下面挂若干具名配置，可新建 / 保存 / 删除 / 切换。
// 存 localStorage，和各页原有的当前配置键并存：方案是存档，当前配置是工作区。

const PREFIX = 'ent_plans_'

type PlanMap = Record<string, unknown>

function read(ns: string): PlanMap {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + ns) || '{}') as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PlanMap) : {}
  } catch {
    return {}
  }
}

function write(ns: string, map: PlanMap): void {
  try {
    localStorage.setItem(PREFIX + ns, JSON.stringify(map))
  } catch {
    // 配额满时保住当前配置，不影响直播。
  }
}

export function planList(ns: string): string[] {
  return Object.keys(read(ns)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function planLoad<T>(ns: string, name: string): T | null {
  const value = read(ns)[name]
  return value == null ? null : (value as T)
}

export function planSave<T>(ns: string, name: string, value: T): boolean {
  const key = String(name || '').trim()
  if (!key) return false
  const map = read(ns)
  map[key] = value
  write(ns, map)
  return true
}

export function planRemove(ns: string, name: string): void {
  const map = read(ns)
  delete map[name]
  write(ns, map)
}
