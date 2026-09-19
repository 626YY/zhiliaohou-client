import { app } from 'electron'
import { join } from 'path'

/** 客户端自带的 mod 目录（清单 / 内置 zip / 定义文件）。单独一个文件是为了让 schema-store 与 mods 互相不用引用。 */
export function catalogDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'mods-catalog')
  }
  return join(app.getAppPath(), 'mods-catalog')
}
