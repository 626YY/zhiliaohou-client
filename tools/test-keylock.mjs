// 真起独立客户端 + 本脚本专属记事本；SendKeys 经过系统钩子，读取记事本 Edit 内容断言。
// 只关闭本脚本创建的进程。产物保留在 output/playwright/keylock-*。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'output', 'playwright')
await fs.mkdir(base, { recursive: true })
const output = await fs.mkdtemp(path.join(base, 'keylock-'))
const file = path.join(output, 'keylock-target.txt')
await fs.writeFile(file, '')
const driverFile = path.join(output, 'notepad-driver.ps1')
await fs.writeFile(driverFile, '\ufeff' + String.raw`
param([string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Pad {
  public delegate bool EnumProc(IntPtr w,IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc,IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr w,StringBuilder name,int size);
  public static IntPtr WindowForPid(int pid) {
    IntPtr result=IntPtr.Zero;
    EnumWindows(delegate(IntPtr w,IntPtr p) { uint owner; GetWindowThreadProcessId(w,out owner); var name=new StringBuilder(256); GetClassName(w,name,256); if(owner==pid && name.ToString()=="Notepad") { result=w; return false; } return true; },IntPtr.Zero);
    return result;
  }
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr c,string cls,string text);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr w);
  public static void FocusEdit(IntPtr window,IntPtr edit) {
    uint owner; uint other=GetWindowThreadProcessId(edit,out owner); uint self=GetCurrentThreadId();
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out owner);
    AttachThreadInput(self,foreground,true);
    AttachThreadInput(self,other,true);
    try { SetForegroundWindow(window); SetFocus(edit); }
    finally { AttachThreadInput(self,other,false); AttachThreadInput(self,foreground,false); }
  }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w,int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr info);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr w);
  [DllImport("user32.dll",EntryPoint="SendMessageW")] public static extern IntPtr Control(IntPtr w,int msg,IntPtr a,IntPtr b);
  public static void CloseIme(IntPtr edit) { Control(ImmGetDefaultIMEWnd(edit),0x283,new IntPtr(6),IntPtr.Zero); }
  [DllImport("user32.dll",EntryPoint="SendMessageW",CharSet=CharSet.Unicode)] public static extern IntPtr ReadText(IntPtr w,int m,IntPtr a,StringBuilder b);
  [DllImport("user32.dll",EntryPoint="SendMessageW",CharSet=CharSet.Unicode)] public static extern IntPtr SetText(IntPtr w,int m,IntPtr a,string b);
  public static string Text(IntPtr w) { var b=new StringBuilder(2048); ReadText(w,13,new IntPtr(2048),b); return b.ToString(); }
}
'@
$padProcess = $null
$heldShift = $false
$sender = New-Object -ComObject WScript.Shell
try {
  $padProcess = Start-Process notepad.exe -ArgumentList ('"' + $Target + '"') -WindowStyle Hidden -PassThru
  for ($i=0; $i -lt 100; $i++) {
    $window = [Pad]::WindowForPid($padProcess.Id)
    if ($window -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 50
  }
  $edit = [Pad]::FindWindowEx($window,[IntPtr]::Zero,'Edit',$null)
  if ($window -eq [IntPtr]::Zero -or $edit -eq [IntPtr]::Zero) { throw 'Cannot find the owned Notepad Edit control' }
  [Pad]::ShowWindow($window,5) | Out-Null
  [Pad]::ShowWindow($window,9) | Out-Null
  [Pad]::SetWindowPos($window,[IntPtr](-1),50,50,700,500,0x40) | Out-Null
  Start-Sleep -Milliseconds 200
  [Console]::Out.WriteLine('{"id":0,"ok":true}')
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $cmd = $line | ConvertFrom-Json
    try {
      if ($cmd.op -eq 'quit') { break }
      if ($cmd.op -eq 'clear') { [Pad]::SetText($edit,12,[IntPtr]::Zero,[string]'') | Out-Null }
      if ($cmd.op -in @('send','focus','down','up','tap')) {
        if (![Pad]::IsWindowVisible($window)) { throw 'Notepad is hidden' }
        for ($attempt=0; $attempt -lt 10; $attempt++) {
          if ([Pad]::GetForegroundWindow() -eq $window) { break }
          [Pad]::FocusEdit($window,$edit)
          Start-Sleep -Milliseconds 100
          if ([Pad]::GetForegroundWindow() -eq $window) { break }
        }
        Start-Sleep -Milliseconds 20
        [Pad]::CloseIme($edit)
        if ([Pad]::GetForegroundWindow() -ne $window) { throw ('Notepad lost foreground to ' + [Pad]::Text([Pad]::GetForegroundWindow()) + '; no keys sent') }
        if ($cmd.op -eq 'send') { $sender.SendKeys([string]$cmd.keys) }
        if ($cmd.op -eq 'down' -or $cmd.op -eq 'tap') { [Pad]::keybd_event([byte]$cmd.keys,0,0,[UIntPtr]::Zero) }
        if ($cmd.op -eq 'up' -or $cmd.op -eq 'tap') { [Pad]::keybd_event([byte]$cmd.keys,0,2,[UIntPtr]::Zero) }
        if ($cmd.keys -eq 16) { $heldShift = $cmd.op -eq 'down' }
        Start-Sleep -Milliseconds 60
      }
      [Console]::Out.WriteLine((@{ id=$cmd.id; ok=$true; text=[Pad]::Text($edit); window=$window.ToInt64() } | ConvertTo-Json -Compress))
    } catch {
      [Console]::Out.WriteLine((@{ id=$cmd.id; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress))
    }
  }
} catch {
  [Console]::Out.WriteLine((@{ id=0; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress))
} finally {
  if ($heldShift) { [Pad]::keybd_event(16,0,2,[UIntPtr]::Zero) }
  if ($padProcess -and !$padProcess.HasExited) { $padProcess.Kill() }
}
`, 'utf8')

let nextId = 0
const pending = new Map()
const driver = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driverFile, '-Target', file], { windowsHide: true })
driver.stderr.on('data', d => process.stderr.write(d))
const lines = createInterface({ input: driver.stdout })
lines.on('line', line => {
  const result = JSON.parse(line)
  const request = pending.get(result.id)
  if (request) { pending.delete(result.id); clearTimeout(request.timer); result.ok ? request.resolve(result) : request.reject(Error(result.error)) }
})
function response(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Notepad driver timed out: ${id}`)) }, 15_000)
    pending.set(id, { resolve, reject, timer })
  })
}
function pad(op, keys) {
  const id = ++nextId
  const result = response(id)
  driver.stdin.write(JSON.stringify({ id, op, keys }) + '\n')
  return result
}
let app
let page
const log = []
const pass = text => { log.push('PASS ' + text); console.log('PASS ' + text) }
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
try {
  await response(0)
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${path.join(output, 'user-data')}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
  page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.keyboardState))
  await page.waitForTimeout(700)
  const command = async (cmd, param) => {
    const result = await page.evaluate(([cmd, param]) => window.api.entertainmentCommand(cmd, param), [cmd, param])
    assert.equal(result.ok, true, result.error)
  }
  const state = () => page.evaluate(() => window.api.keyboardState())
  const unlocked = async () => {
    const deadline = Date.now() + 6000
    while ((await state()).lock.active) {
      assert.ok(Date.now() < deadline, 'Lock did not expire within 6 seconds')
      await page.waitForTimeout(50)
    }
  }

  await pad('clear')
  assert.equal((await pad('send', 'w')).text, 'w')
  await pad('clear')
  await command('key-lock', 'W|2000')
  const started = Date.now()
  assert.equal((await state()).open, false)
  assert.equal((await pad('send', 'wa')).text, 'a')
  assert.ok((await state()).lock.remainingMs > 1000, 'The blocking assertion must occur before expiry')
  pass('key-lock W|2000: Notepad receives "a", blocked "w" (widget closed)')
  await unlocked()
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 1800 && elapsed < 3000, `Expiry timing: ${elapsed}ms`)
  assert.equal((await pad('send', 'w')).text, 'aw')
  pass(`automatic unlock: Notepad receives "w" after ${elapsed}ms`)

  await pad('clear')
  await command('key-lock', '全部|5000')
  assert.equal((await pad('send', 'wasd')).text, '')
  assert.equal((await pad('send', '{ESC}w')).text, 'w')
  await unlocked()
  pass('all keys blocked; Esc immediately unlocks and passes subsequent W')

  await command('key-lock', 'W,A,S,D|5000')
  await pad('clear')
  assert.equal((await pad('send', 'wasdx')).text, 'x')
  await command('key-unlock')
  assert.equal((await pad('send', 'wasd')).text, 'xwasd')
  pass('WSAD blocked, X passes; key-unlock immediately restores WSAD')

  await command('key-lock', 'W|700')
  await command('key-lock', '调整|2000')
  await page.waitForTimeout(800)
  assert.ok((await state()).lock.remainingMs > 1000)
  await pad('clear')
  assert.equal((await pad('send', 'w')).text, '')
  await command('key-lock', '调整|-5000')
  assert.equal((await pad('send', 'w')).text, 'w')
  await command('key-lock', '调整|2000')
  assert.equal((await state()).lock.active, false)
  pass('remaining time increase extends blocking; decrease to zero unlocks; idle adjustment does not lock')

  for (const param of ['W|0', 'W|-1', 'W|NaN', 'W|Infinity', 'W|', 'W|2|3', '|1000', 'ESC|1000', 'W,BOGUS|1000']) {
    const result = await page.evaluate(p => window.api.entertainmentCommand('key-lock', p), param)
    assert.equal(result.ok, false, param)
  }
  assert.equal((await state()).lock.active, false)
  pass('invalid parameters and explicit Esc locking are rejected without locking')

  assert.equal((await page.evaluate(() => window.api.keyboardOpen())).ok, true)
  await command('key-lock', 'W|5000')
  await command('key-unlock')
  assert.equal((await state()).hook.running, true)
  assert.equal((await state()).open, true)
  pass('unlock preserves keyboard display monitoring while its window is open')
  await pad('clear')
  await pad('down', 16)
  await command('key-lock', 'SHIFT|5000')
  await pad('down', 16)
  await pad('up', 16)
  assert.equal((await pad('tap', 87)).text, 'w')
  await command('key-unlock')
  pass('Shift held before lock, repeated during lock, then released does not stay stuck in Notepad')
  await command('key-lock', 'W|5000')
  await page.evaluate(() => window.api.keyboardClose())
  await pad('clear')
  assert.equal((await pad('send', 'w')).text, '')
  await command('key-unlock')
  assert.equal((await pad('send', 'w')).text, 'w')
  pass('closing keyboard widget preserves active lock; explicit unlock releases it')

  await page.evaluate(async () => {
    await window.api.register('keylock_regression', 'Fixture123!', '键盘锁定回归')
    const result = await window.api.login('keylock_regression', 'Fixture123!')
    if (!result.ok) throw Error(result.error)
    await window.api.saveSettings({ guideSeen: true, gamePath: '', autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '娱乐助手', exact: true }).click()
  await page.getByRole('button', { name: /键盘显示/ }).click()
  await command('key-lock', '全部|5000')
  await page.getByRole('button', { name: '解锁键盘', exact: true }).click()
  assert.equal((await state()).lock.active, false)
  await pad('clear')
  assert.equal((await pad('send', 'w')).text, 'w')
  await page.screenshot({ path: path.join(output, 'keyboard-unlock.png') })
  pass('keyboard page unlock button restores Notepad input during all-key lock')

  await page.getByRole('button', { name: /返回/ }).click()
  await page.getByRole('button', { name: /礼物触发/ }).click()
  await page.getByRole('button', { name: '新增规则', exact: true }).first().click()
  await page.getByRole('button', { name: '动作命令', exact: true }).click()
  const commandSelect = page.locator('select').filter({ has: page.locator('option[value="key-lock"]') })
  await commandSelect.selectOption('key-lock')
  assert.ok((await page.locator('body').innerText()).includes('调整|-1000'))
  await commandSelect.selectOption('key-unlock')
  assert.ok((await page.locator('body').innerText()).includes('无需参数'))
  await page.getByRole('button', { name: '取消', exact: true }).click()
  pass('rule editor offers key-lock / key-unlock with duration and emergency-unlock hints')
  await command('key-lock', 'W|5000')
  await page.getByRole('button', { name: '解锁键盘', exact: true }).click()
  assert.equal((await state()).lock.active, false)
  pass('gift rules page unlock button immediately unlocks')

  await command('key-lock', 'W|5000')
  await pad('clear')
  assert.equal((await pad('send', 'w')).text, '')
  await app.close()
  app = null
  assert.equal((await pad('send', 'w')).text, 'w')
  pass('client exit removes hook and restores Notepad input')
  console.log('keylock regression passed')
} finally {
  if (app) {
    await page?.evaluate(() => window.api.entertainmentCommand('key-unlock')).catch(() => {})
    await app.close()
  }
  driver.stdin.end(JSON.stringify({ op: 'quit' }) + '\n')
  await fs.writeFile(path.join(output, 'results.txt'), log.join('\n') + '\n')
  console.log('Evidence: ' + output)
}
