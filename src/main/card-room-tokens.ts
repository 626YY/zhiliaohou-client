// 卡密模式的抖音登录令牌：按「平台账号 × 直播间」各存一份，safeStorage(DPAPI) 加密后落 userData/data/。
//   - 只在主进程读写；绝不进 renderer、不上传、不打日志；
//   - 一个房间换新令牌不碰别的房间；退出 / 换号不清别人的；
//   - 准备连接时才按连接器既有格式（douyin_cookie.txt）写到对应 mod 目录。
import { safeStorage } from 'electron'
import { readJson, writeJson } from './db'

interface TokenEntry {
  /** 加密后的 cookie 串 */
  v: string
  at: number
  nickname?: string
}

type TokenFile = Record<string, Record<string, TokenEntry>>

export interface RoomTokenStore {
  get: (userId: string, room: string) => string | null
  set: (userId: string, room: string, cookie: string, meta?: { nickname?: string }) => void
  remove: (userId: string, room: string) => void
  /** 某账号已存令牌的房间（不含令牌本身，给界面显示「已登录」用） */
  rooms: (userId: string) => string[]
}

function enc(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('本机不支持加密保存登录状态（safeStorage 不可用）')
  return 'v1:' + safeStorage.encryptString(plain).toString('base64')
}

function dec(stored: string): string | null {
  try {
    if (stored.startsWith('v1:')) return safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64'))
  } catch {
    /* 解密失败（换机 / 换用户）当作没存过 */
  }
  return null
}

export function createRoomTokenStore(file: string): RoomTokenStore {
  const load = (): TokenFile => {
    const raw = readJson<unknown>(file, {})
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as TokenFile) : {}
  }
  return {
    get: (userId, room) => {
      const entry = load()[userId]?.[room]
      return entry?.v ? dec(entry.v) : null
    },
    set: (userId, room, cookie, meta = {}) => {
      const f = load()
      const mine = { ...(f[userId] ?? {}) }
      mine[room] = { v: enc(cookie), at: Date.now(), ...(meta.nickname ? { nickname: meta.nickname } : {}) }
      writeJson(file, { ...f, [userId]: mine })
    },
    remove: (userId, room) => {
      const f = load()
      if (!f[userId]?.[room]) return
      const mine = { ...f[userId] }
      delete mine[room]
      writeJson(file, { ...f, [userId]: mine })
    },
    rooms: (userId) => Object.keys(load()[userId] ?? {})
  }
}
