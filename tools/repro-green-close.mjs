// 最小复现：one-shot 绿幕视频（maxSeconds 0.6）播完后的窗口状态
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const run = promisify(execFile)
const output = path.join(root, 'output/playwright/green-close-repro')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as green from ${JSON.stringify(path.join(root, 'src/main/green-screen.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
app.whenReady().then(async()=>{ global.qa=require('./qa.cjs'); const c=new BrowserWindow({show:false}); await c.loadURL('about:blank'); global.qa.ready=true });`)
const video = path.join(isolated, 'v.mp4')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=320x180:r=15', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video], { windowsHide: true })

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (fn, args = []) => app.evaluate((_, { fn, args }) => global.qa.green[fn](...args), { fn, args })

for (let i = 0; i < 50 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)
console.log('open:', await call('openGreenScreen', [video, 'video', 'x', 0, { loop: false, maxSeconds: 0.6 }]))
for (let i = 0; i < 10; i++) {
  await sleep(400)
  const st = await call('greenScreenState')
  console.log(`t+${(i + 1) * 0.4}s`, JSON.stringify(st.slots.filter(s => s.open || s.src)))
}
await app.close().catch(() => {})
