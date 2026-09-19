// 记住密码：主进程文件存储（userData/data/creds.json），密码用 safeStorage(DPAPI) 加密。
// 之前放 renderer localStorage：多实例抢不到 leveldb 锁时全程内存态、退出即丢，用户每次都要重填。
// 卡密平台模式用另一份文件（card-auth.ts 里按平台来源分文件），旧服务器的密码绝不会被读出来送去新平台。
import { safeStorage } from 'electron'
import { readJson, writeJson } from './db'

interface CredFile {
  last: string
  map: Record<string, string>
}

export interface Cred {
  username: string
  password: string
}

export interface CredStore {
  getLast: () => Cred | null
  getUser: (username: string) => string | null
  save: (username: string, password: string) => void
  clearLast: () => void
  clearUser: (username: string) => void
}

const FILE = 'creds'

function enc(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'v1:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    /* 加密不可用则明文兜底 */
  }
  return 'p:' + Buffer.from(plain, 'utf-8').toString('base64')
}

function dec(stored: string): string | null {
  try {
    if (stored.startsWith('v1:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64'))
    }
    if (stored.startsWith('p:')) {
      return Buffer.from(stored.slice(2), 'base64').toString('utf-8')
    }
  } catch {
    /* 解密失败当作没存过 */
  }
  return null
}

/** 按文件名建一份「记住密码」存储；旧账号系统固定用 creds，卡密平台按来源另开文件。 */
export function createCredStore(file: string): CredStore {
  const load = (): CredFile => ({ last: '', map: {}, ...readJson<Partial<CredFile>>(file, {}) })
  return {
    getLast: () => {
      const f = load()
      if (!f.last) return null
      const stored = f.map[f.last]
      if (!stored) return null
      const password = dec(stored)
      return password ? { username: f.last, password } : null
    },
    getUser: (username) => {
      const stored = load().map[username.toLowerCase()]
      return stored ? dec(stored) : null
    },
    save: (username, password) => {
      const f = load()
      const key = username.toLowerCase()
      f.map[key] = enc(password)
      f.last = key
      writeJson(file, f)
    },
    clearLast: () => {
      const f = load()
      f.last = ''
      writeJson(file, f)
    },
    clearUser: (username) => {
      const f = load()
      const key = username.toLowerCase()
      delete f.map[key]
      if (f.last === key) f.last = ''
      writeJson(file, f)
    }
  }
}

const legacy = createCredStore(FILE)

export function credGetLast(): Cred | null {
  return legacy.getLast()
}

export function credGetUser(username: string): string | null {
  return legacy.getUser(username)
}

export function credSave(username: string, password: string): void {
  legacy.save(username, password)
}

export function credClearLast(): void {
  legacy.clearLast()
}

export function credClearUser(username: string): void {
  legacy.clearUser(username)
}
