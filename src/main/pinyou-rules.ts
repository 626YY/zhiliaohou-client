import { randomUUID } from 'crypto'
import fs from 'fs'
import type { EntertainmentRule, PinyouApplyResult } from '../shared/types'
import { giftNamesEqual } from '../shared/giftName'
import { filePath, writeJson } from './db'

/** 新规则全部准备好后一次提交；任何失败均保留磁盘上的完整旧规则。 */
export function applyPinyouRules(incoming: EntertainmentRule[], replace: boolean): PinyouApplyResult {
  try {
    if (!Array.isArray(incoming) || incoming.length === 0) throw new Error('没有可导入的规则')
    const additions = incoming.map((rule) => {
      if (typeof rule?.giftName !== 'string' || !rule.giftName.trim()) throw new Error('有规则缺少触发名称')
      if (!['key', 'script', 'sound', 'system', 'command', 'obs'].includes(rule.actionType)) throw new Error(`「${rule.giftName}」的动作类型无效`)
      return {
        ...rule,
        id: randomUUID(),
        giftName: rule.giftName.trim(),
        times: Math.max(1, Math.trunc(Number(rule.times) || 1)),
        enabled: rule.enabled !== false
      }
    })
    const target = filePath('entertainment_rules')
    const old: EntertainmentRule[] = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : []
    if (!Array.isArray(old)) throw new Error('原规则格式损坏，请先恢复规则备份')
    const removedIds = replace ? old.filter((rule) => additions.some((next) =>
      (next.triggerType || 'gift') === (rule.triggerType || 'gift') && giftNamesEqual(next.giftName, rule.giftName)
    )).map((rule) => rule.id) : []
    const removed = new Set(removedIds)
    writeJson('entertainment_rules', [...old.filter((rule) => !removed.has(rule.id)), ...additions])
    return { ok: true, added: additions.length, removed: removedIds.length, removedIds }
  } catch (error) {
    return { ok: false, error: `导入失败：${(error as Error).message}；原规则未改动` }
  }
}
