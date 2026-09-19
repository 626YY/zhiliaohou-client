// 键鼠钩子冒烟测试（不依赖 Electron）。
//
// 流程：
//   1) 从 src/main/keyboard-hook-script.ts 用正则抠出 PowerShell 钩子脚本原文，写到临时 .ps1
//   2) 用 Node 直接 spawn 同一份脚本（powershell.exe -File），等 ready
//   3) 用另一个 PowerShell 调 user32 keybd_event 注入 VK_F13(0x7C) 与 VK_F14(0x7D)
//      —— 选 F13/F14 是因为它们无副作用：不会往前台窗口打出可见字符（对比 SendKeys('ab')）
//   4) 收集约 3 秒 stdout，断言收到 vk 124/125 的 down 与 up
//   5) 向子进程 stdin 写 quit，断言子进程 3 秒内退出
//   6) 打印 PASS / FAIL 并以对应退出码结束
//
// 用法：node tools/keyboard-hook-smoke.mjs
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptTs = path.join(root, 'src', 'main', 'keyboard-hook-script.ts')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function waitFor(pred, timeout) {
  return new Promise((res) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (pred() || Date.now() - t0 > timeout) {
        clearInterval(iv)
        res(pred())
      }
    }, 50)
  })
}

function extractPs() {
  const srcText = fs.readFileSync(scriptTs, 'utf8')
  // 脚本内绝不含反引号，故非贪婪匹配到第一个反引号即脚本结尾
  const m = srcText.match(/String\.raw`([\s\S]*?)`/)
  if (!m) throw new Error('未能从 keyboard-hook-script.ts 提取 PS 脚本（正则未命中）')
  return m[1]
}

async function main() {
  const ps = extractPs()

  // 写到 ASCII 且必然可写的目录（本机用户名含中文，避免临时路径带中文引发的边角问题）
  const workDir = path.join('C:\\Users\\Public', 'zl-khook-smoke')
  fs.mkdirSync(workDir, { recursive: true })
  const psPath = path.join(workDir, 'keyboard-hook.ps1')
  fs.writeFileSync(psPath, '\ufeff' + ps, 'utf8')

  const lines = []
  let buf = ''
  let stderr = ''
  let exited = false
  let exitCode = null

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psPath],
    { windowsHide: true }
  )
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '').trim()
      buf = buf.slice(i + 1)
      if (line) lines.push(line)
    }
  })
  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8')
  })
  child.on('exit', (c) => {
    exited = true
    exitCode = c
  })

  // 1) 等钩子就绪
  const ready = await waitFor(() => lines.includes('ready'), 8000)
  if (!ready) {
    console.error('收到的行:', JSON.stringify(lines))
    if (stderr.trim()) console.error('stderr:\n' + stderr.trim())
    finish(false, '钩子未就绪：8 秒内未收到 ready（可能 Add-Type 编译失败或 PowerShell 启动异常）', child)
    return
  }
  await sleep(300)

  // 2) 注入 F13 / F14（keybd_event，KEYEVENTF_KEYUP = 0x0002）
  await injectKeys()

  // 3) 收集约 3 秒
  await sleep(3000)

  const hasKD = (vk) => lines.some((l) => new RegExp('^k d ' + vk + '( |$)').test(l))
  const hasKU = (vk) => lines.some((l) => new RegExp('^k u ' + vk + '( |$)').test(l))
  const hbCount = lines.filter((l) => l === 'hb').length

  const checks = [
    ['收到 ready', lines.includes('ready')],
    ['F13(124) down', hasKD(124)],
    ['F13(124) up', hasKU(124)],
    ['F14(125) down', hasKD(125)],
    ['F14(125) up', hasKU(125)]
  ]

  console.log('--- 收到的事件行（前 40 条）---')
  console.log(lines.slice(0, 40).join('\n'))
  console.log('--- 断言 ---')
  let allOk = true
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
    if (!ok) allOk = false
  }
  console.log('心跳 hb 收到 ' + hbCount + ' 次（参考值，2 秒一次）')

  // 4) 发 quit，断言 3 秒内退出
  try {
    child.stdin.write('quit\n')
  } catch {
    // ignore
  }
  const gone = await waitFor(() => exited, 3000)
  console.log((gone ? 'PASS' : 'FAIL') + '  收到 quit 后子进程 3 秒内退出' + (gone ? '（exitCode=' + exitCode + '）' : ''))
  if (!gone) allOk = false

  if (stderr.trim()) console.error('stderr:\n' + stderr.trim())
  finish(allOk, null, child)
}

async function injectKeys() {
  const injPs = [
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Inj{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte a,byte b,uint c,UIntPtr d);}'",
    '[Inj]::keybd_event(0x7C,0,0,[UIntPtr]::Zero)',
    'Start-Sleep -Milliseconds 60',
    '[Inj]::keybd_event(0x7C,0,2,[UIntPtr]::Zero)',
    'Start-Sleep -Milliseconds 80',
    '[Inj]::keybd_event(0x7D,0,0,[UIntPtr]::Zero)',
    'Start-Sleep -Milliseconds 60',
    '[Inj]::keybd_event(0x7D,0,2,[UIntPtr]::Zero)'
  ].join('; ')
  await new Promise((res) => {
    const c = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', injPs],
      { windowsHide: true }
    )
    c.on('exit', () => res())
    c.on('error', () => res())
  })
}

function finish(ok, reason, child) {
  try {
    child?.stdin?.write('quit\n')
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      child?.kill()
    } catch {
      // ignore
    }
    if (reason) console.error(reason)
    console.log(ok ? '\n==== SMOKE PASS ====' : '\n==== SMOKE FAIL ====')
    process.exit(ok ? 0 : 1)
  }, 300)
}

main().catch((e) => {
  console.error('冒烟脚本异常：', e)
  console.log('\n==== SMOKE FAIL ====')
  process.exit(1)
})
