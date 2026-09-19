import { execFile } from 'node:child_process'
import { join } from 'node:path'

// 本机机器码（Windows MachineGuid）：轮椅 mod 短租约与平台离线凭证都绑定它。
// 原来在 card-mod-license.ts 里；license-connection 也要用（离线凭证要验「就是这台机器」），单独拆出来免得两个模块互相 import。
let machine: Promise<string> | undefined

export function cardMachineId(): Promise<string> {
  if (machine) return machine
  machine = new Promise<string>((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(Error('无法读取本机机器码'))
      return
    }
    execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (error, stdout) => {
      const id = /MachineGuid\s+REG_SZ\s+([A-Za-z0-9-]{8,64})/.exec(stdout || '')?.[1]
      if (error || !id) reject(Error('无法读取本机机器码，请检查 Windows 注册表访问权限'))
      else resolve(id)
    })
  }).catch((error) => {
    machine = undefined
    throw error
  })
  return machine
}
