import { join, dirname } from 'path'
import fs from 'fs'
import { getSettings, saveSettings } from './settings'
import { currentGameId, gamePathFor } from './games'
import { getBindsFor, getPranksFor, getSchemaFor } from './schema-store'
import type { ConfigReadResult, ConfigSaveResult, ConfigSchema, NativeKeybinds, PrankDef } from '@shared/types'

// 参数说明 / 整蛊清单 / 默认键位都从 schema-store 取：更新源发的定义包优先，自带的兜底（2026-09-14 起菜单不随客户端发版）
export function getSchema(): ConfigSchema {
  return getSchemaFor(currentGameId())
}

export function getPranks(): PrankDef[] {
  return getPranksFor(currentGameId())
}

export function getNativeKeybinds(): NativeKeybinds {
  return getBindsFor(currentGameId())
}

function collectConfigCandidates(): string[] {
  const settings = getSettings()
  const list: string[] = []
  if (settings.modConfigPath && configPathValidForCurrentGame(settings.modConfigPath)) {
    list.push(settings.modConfigPath)
  }
  const gp = gamePathFor()
  if (gp) {
    const gameDir = dirname(gp)
    const gid = currentGameId()
    if (gid === 'dontscream') {
      list.push(join(gameDir, 'ue4ss', 'Mods', 'zhiliao', 'config.json'))
    } else if (gid === 'librarian') {
      list.push(join(gameDir, 'ue4ss', 'Mods', 'DarkMage', 'config.json'))
    } else {
      list.push(join(gameDir, 'Mods', 'WheelLive', 'config.json'))
    }
    const modsDir = join(gameDir, 'Mods')
    try {
      for (const sub of fs.readdirSync(modsDir)) {
        list.push(join(modsDir, sub, 'config.json'))
      }
    } catch {
      /* Mods 目录不存在 */
    }
    list.push(join(gameDir, 'config.json'))
  }
  return list
}

// modConfigPath 缓存只信任当前游戏目录下的（切游戏后旧缓存会指到别的游戏）
function configPathValidForCurrentGame(p: string): boolean {
  if (!p) return false
  const gp = gamePathFor()
  if (!gp) return true
  return p.startsWith(dirname(gp))
}

function guessConfigPath(): string {
  for (const p of collectConfigCandidates()) {
    if (p && fs.existsSync(p)) return p
  }
  return ''
}

export function readConfig(): ConfigReadResult {
  const settings = getSettings()
  let path = settings.modConfigPath
  if (!path || !fs.existsSync(path) || !configPathValidForCurrentGame(path)) {
    path = guessConfigPath()
  }

  if (!path) {
    const noGame = !gamePathFor()
    return {
      ok: false,
      schema: getSchema(),
      values: {},
      error: noGame
        ? '未找到已安装的游戏。请先到「启动游戏」页让客户端自动搜索游戏。'
        : '已找到游戏，但尚未安装 Mod，参数文件不存在。请先到「游戏库」安装 Mod。'
    }
  }
  try {
    const values = JSON.parse(fs.readFileSync(path, 'utf-8'))
    if (settings.modConfigPath !== path) saveSettings({ modConfigPath: path })
    return { ok: true, schema: getSchema(), values, configPath: path }
  } catch {
    return {
      ok: false,
      schema: getSchema(),
      values: {},
      error: 'config.json 解析失败，文件可能已损坏'
    }
  }
}

export function saveConfig(
  values: Record<string, unknown>
): ConfigSaveResult {
  const settings = getSettings()
  let path = settings.modConfigPath
  if (!path || !fs.existsSync(path) || !configPathValidForCurrentGame(path)) {
    path = guessConfigPath()
  }
  if (!path) {
    return { ok: false, error: '找不到 config.json，无法保存' }
  }
  try {
    const existing = JSON.parse(fs.readFileSync(path, 'utf-8'))
    const merged = { ...existing, ...values }
    // 游戏内 mod 在轮询这个文件：先写同目录临时文件再改名，别让 mod 读到 0 字节/半截 JSON
    const tmp = `${path}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8')
    fs.renameSync(tmp, path)
    return { ok: true }
  } catch {
    return { ok: false, error: '保存 config.json 失败' }
  }
}
