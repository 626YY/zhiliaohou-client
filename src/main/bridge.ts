// 当前游戏 mod 目录定位：所有要读写 bridge.txt / config.json / connector.py / 礼物图 的地方共用。
// WheelLive（Unity/BepInEx）：<exe目录>/Mods/WheelLive
// DON'T SCREAM（UE5/UE4SS）：<exe目录>/ue4ss/Mods/zhiliao
// Librarian（UE5/UE4SS）：<exe目录>/ue4ss/Mods/DarkMage
import fs from 'fs'
import { join, dirname } from 'path'
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
