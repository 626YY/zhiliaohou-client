// 项目（文件夹）里每条视频在整蛊台配的动作：品游 .脚本 里的动作照跑（可关），整蛊台里再加的按顺序执行。
// 用户 2026-09-11：「读取项目以后，应该也可以设置里面的视频的动作，现在读取项目以后就不管了，就是随机视频了」。
// 存在客户端 data/pinyou-item-actions.json（按项目目录 + 条目名），不往主播的素材文件夹里写东西。
import path from 'path'
import { readJson, writeJson } from './db'
import type { EntertainmentAction, PinyouItemActions } from '@shared/types'

const STORE = 'pinyou-item-actions'
type Store = Record<string, Record<string, PinyouItemActions>>
let cache: Store | null = null

function load(): Store {
  if (!cache) {
    const raw = readJson<Store | null>(STORE, null)
    cache = raw && typeof raw === 'object' ? raw : {}
  }
  return cache
}

/** Windows 路径大小写不敏感、尾部斜杠可有可无：统一成一个键 */
function keyOf(dir: string): string {
  return path.normalize(String(dir || '')).replace(/[\\/]+$/, '').toLowerCase()
}

/** 某个项目里所有配过动作的条目（条目名 → 配置） */
export function projectItemActions(dir: string): Record<string, PinyouItemActions> {
  const entry = load()[keyOf(dir)]
  return entry ? JSON.parse(JSON.stringify(entry)) : {}
}

/** 触发时查这一条视频配没配动作；没配回 null（照老样子：播视频 + 跑脚本） */
export function itemActionsFor(dir: string, name: string): PinyouItemActions | null {
  const entry = load()[keyOf(dir)]
  const cfg = entry?.[String(name || '')]
  return cfg ? { actions: Array.isArray(cfg.actions) ? cfg.actions : [], useScript: cfg.useScript !== false } : null
}

/** 保存一条视频的动作；传 null = 清掉这条的配置（恢复只播视频 + 跑脚本） */
export function setProjectItemActions(
  dir: string,
  name: string,
  config: PinyouItemActions | null,
  normalize: (actions: unknown) => EntertainmentAction[]
): { ok: boolean; error?: string } {
  const key = keyOf(dir)
  const item = String(name || '').trim()
  if (!key || !item) return { ok: false, error: '没有指定项目或视频' }
  const store = load()
  const entry = store[key] || (store[key] = {})
  if (!config) delete entry[item]
  else {
    const actions = normalize(config.actions)
    const useScript = config.useScript !== false
    // 没动作又没关脚本 = 等于没配，别留一条空记录
    if (!actions.length && useScript) delete entry[item]
    else entry[item] = { actions, useScript }
  }
  if (!Object.keys(entry).length) delete store[key]
  try {
    writeJson(STORE, store)
  } catch (e) {
    return { ok: false, error: '保存失败：' + (e as Error).message }
  }
  return { ok: true }
}
