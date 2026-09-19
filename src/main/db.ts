import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import crypto from 'crypto'

let dataDir = ''

function ensureDataDir(): string {
  // 有些模块会在 app.whenReady 前被静态加载并读取一次数据。
  // 这时不能让空 dataDir 退化成相对路径（打包后会指向 Program Files/data）。
  if (!dataDir) dataDir = app.getPath('userData')
  fs.mkdirSync(join(dataDir, 'data'), { recursive: true })
  return dataDir
}

export function initDb(): void {
  ensureDataDir()
}

function filePath(name: string): string {
  return join(ensureDataDir(), 'data', `${name}.json`)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(name: string, data: T): void {
  const target = filePath(name)
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  try {
    // 同目录写完再替换；序列化、写入或重命名失败时，旧配置仍然完整。
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf-8', flag: 'wx', flush: true })
    fs.renameSync(temporary, target)
  } finally {
    try { fs.unlinkSync(temporary) } catch { /* 成功后临时文件已重命名；清理失败不掩盖原错误 */ }
  }
}

export function uid(): string {
  return crypto.randomBytes(8).toString('hex')
}

export function createCollection<T extends { id: string }>(name: string): {
  all: () => T[]
  find: (pred: (item: T) => boolean) => T | undefined
  insert: (item: T) => void
  update: (id: string, patch: Partial<T>) => void
  remove: (id: string) => void
} {
  return {
    all: () => readJson<T[]>(name, []),
    find: (pred) => readJson<T[]>(name, []).find(pred),
    insert: (item) => {
      const list = readJson<T[]>(name, [])
      list.push(item)
      writeJson(name, list)
    },
    update: (id, patch) => {
      const list = readJson<T[]>(name, [])
      const idx = list.findIndex((x) => x.id === id)
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch }
        writeJson(name, list)
      }
    },
    remove: (id) => {
      writeJson(
        name,
        readJson<T[]>(name, []).filter((x) => x.id !== id)
      )
    }
  }
}

export { readJson, writeJson, filePath }
