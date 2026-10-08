// 当前游戏 mod 目录定位：所有要读写 bridge.txt / config.json / connector.py / 礼物图 的地方共用。
// WheelLive（Unity/BepInEx）：<exe目录>/Mods/WheelLive
// DON'T SCREAM（UE5/UE4SS）：<exe目录>/ue4ss/Mods/zhiliao
// Librarian（UE5/UE4SS）：<exe目录>/ue4ss/Mods/DarkMage
// 没装游戏整蛊 mod（或当前游戏没装）时，连接器用客户端自己的目录（userData/connector）跑：
//   特色整蛊、转盘、时间盲盒这些只靠礼物事件，不需要游戏；2026-10-08 用户要把游戏 mod 全部下架，「要确认软件自己连直播间也好使」。
import fs from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { currentGameId, gamePathFor } from './games'

export function wheelLiveDir(): string {
  const p = gamePathFor()
  if (!p) return ''
  const exeDir = dirname(p)
  const gid = currentGameId()
  if (gid === 'dontscream') {
    const dir = join(exeDir, 'ue4ss', 'Mods', 'zhiliao')
    return fs.existsSync(dir) ? dir : ''
  }
  if (gid === 'librarian') {
    const dir = join(exeDir, 'ue4ss', 'Mods', 'DarkMage')
    return fs.existsSync(dir) ? dir : ''
  }
  const dir = join(exeDir, 'Mods', 'WheelLive')
  return fs.existsSync(dir) ? dir : ''
}

export function bridgePath(): string {
  const dir = wheelLiveDir()
  return dir ? join(dir, 'bridge.txt') : ''
}

/** 客户端自己的连接器目录（没装游戏整蛊 mod 时用）：连接器脚本、抖音登录、bridge.txt、礼物图、头像、本场统计都在这里。 */
export function standaloneConnectorDir(): string {
  return join(app.getPath('userData'), 'connector')
}

/**
 * 连接器的家：当前游戏装了整蛊 mod 就是 mod 目录（和游戏共用 bridge.txt，游戏照常收整蛊），没装就是客户端自己的目录。
 * 连接器把礼物图 / 头像 / live_stats.json 写在 bridge.txt 同目录，客户端读这些缓存都按这里找。
 */
export function connectorHomeDir(): string {
  return wheelLiveDir() || standaloneConnectorDir()
}

/** 连接器写事件的 bridge.txt：有 mod 用 mod 的，没有用客户端自己目录里的。 */
export function connectorBridgePath(): string {
  return join(connectorHomeDir(), 'bridge.txt')
}
