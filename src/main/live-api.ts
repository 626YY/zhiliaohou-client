import {cardModeEnabled} from './card-provider'
import {cardEpoch} from './card-epoch'
import {currentGameId} from './games'
// 实时接口：通过 bridge.txt 向运行中的整蛊器推送命令
//   cfgset <字段> <值>  —— 反射改 ConfigData 并落盘（实时生效）
//   prank <id>          —— 立即触发一个整蛊
import fs from 'fs'
import { queryGameState } from './game-launcher'
import { bridgePath, wheelLiveDir } from './bridge'
import { join } from 'path'
import type { LiveStateResult } from '@shared/types'

// mod 心跳：轮椅 / 图书管理员 mod 每 5 秒把 {ts,in,ready} 写进 mod 目录的 hb.json。
// 拿它判断「mod 真在跑、在不在局内、事件桥开没开」，比只看游戏进程靠谱：
// 2026-09-05 真机验证时就靠它发现游戏更新后轮椅 mod 主循环每帧抛异常、事件桥从没启动（ready 一直 0）。
function readHeartbeat(): { alive: boolean; inGame: boolean; ready: boolean; ageSec: number } | null {
  const dir = wheelLiveDir()
  if (!dir) return null
  const p = join(dir, 'hb.json')
  if (!fs.existsSync(p)) return null
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as { ts?: number; in?: number; ready?: number }
    const ts = Number(j.ts || 0)
    const ageSec = ts > 0 ? Math.max(0, Math.round(Date.now() / 1000 - ts)) : 9999
    return { alive: ageSec <= 20, inGame: Number(j.in) === 1, ready: Number(j.ready) === 1, ageSec }
  } catch {
    return null
  }
}

async function send(cmd: string, isCurrent?: () => boolean): Promise<{ ok: boolean; error?: string }> {
  const epoch=cardEpoch(),game=currentGameId()
  if(cardModeEnabled()){
    try{await (await import('./card-auth')).cardRequireGameUse(game)}catch(error){return {ok:false,error:error instanceof Error?error.message:'卡密授权不可用'}}
    const previous=isCurrent
    isCurrent=()=>cardEpoch()===epoch&&currentGameId()===game&&(!previous||previous())
  }
  if (isCurrent && !isCurrent()) return { ok: false, error: '操作已取消' }
  const p = bridgePath()
  const st = await queryGameState()
  if (!st.running) {
    return { ok: false, error: '游戏未在运行，无法实时推送' }
  }
  if (!p || !fs.existsSync(p)) {
    return { ok: false, error: '未找到 bridge.txt，请确认已安装对应游戏的整蛊 Mod' }
  }
  // 事件桥没开时写进去的命令 mod 不会回放（它只读新追加的），与其假装成功不如直说。
  // 轮椅 mod 在主菜单里就会把事件桥开起来（ready=1），所以 ready=0 只有两种情况：刚启动还没转起来 / mod 主循环出了问题。
  const hb = readHeartbeat()
  if (hb && hb.alive && !hb.ready) {
    return { ok: false, error: 'Mod 刚启动、事件桥还没就绪，几秒后再发；一直这样的话看游戏目录 MelonLoader/Latest.log 里 mod 有没有报错' }
  }
  try {
    // 状态查询会等待外部进程；写桥前再检查，关闭抽奖或切换游戏不能放行旧命令。
    if (isCurrent && !isCurrent()) return { ok: false, error: '操作已取消' }
    fs.appendFileSync(p, cmd + '\n', 'utf-8')
    return { ok: true }
  } catch {
    return { ok: false, error: '写入 bridge.txt 失败' }
  }
}

export async function liveState(): Promise<LiveStateResult> {
  const p = bridgePath()
  const st = await queryGameState()
  const hb = st.running ? readHeartbeat() : null
  return {
    running: st.running,
    bridgeOk: !!p && fs.existsSync(p),
    path: p,
    ...(hb ? { modAlive: hb.alive, inGame: hb.inGame, bridgeReady: hb.ready, hbAgeSec: hb.ageSec } : {})
  }
}

/** 发送任意 bridge 命令（护体/盲盒/模拟礼物/布局开关/游戏操作等） */
export async function liveCmd(
  cmd: string
): Promise<{ ok: boolean; error?: string }> {
  return send(cmd)
}

export async function liveSet(
  key: string,
  value: unknown
): Promise<{ ok: boolean; error?: string }> {
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  return send(`cfgset ${key} ${v}`)
}

export async function livePrank(
  id: string,
  isCurrent?: () => boolean
): Promise<{ ok: boolean; error?: string }> {
  return send(`prank ${id}`, isCurrent)
}
