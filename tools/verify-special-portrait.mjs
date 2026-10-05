// 特色整蛊竖屏检查：17 个玩法在竖屏 720×1280（主播竖屏直播）下渲染，断言无页面错误、画面有内容，截图留证人工逐张看布局。
// 不启动客户端、不接触用户配置；窗口离屏不可见不聚焦（不抢前台）。
// 用法：node tools/verify-special-portrait.mjs [宽x高，默认 720x1280]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const [W, H] = (process.argv[2] || '720x1280').split('x').map(Number)
const output = path.join(root, `output/playwright/special-portrait-${W}x${H}`)
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetBase = pathToFileURL(path.join(root, 'assets/special-games')).href.replace(/\/?$/, '/')

const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, defaultSpecialConfig} from './src/shared/specialGames';
export {buildSpecialPage} from './src/main/special-page';
export {GAME_CODE} from './src/main/special-games';`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const { SPECIAL_GAMES, defaultSpecialConfig, buildSpecialPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:${W},height:${H},show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false,autoplayPolicy:'no-user-gesture-required'}});win.loadURL('about:blank')});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files', '--mute-audio'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|getUserMedia|NotAllowedError|Requested device not found/.test(m.text())) errors.push('[console] ' + m.text()) })

let passed = 0
const fail = []
for (const meta of SPECIAL_GAMES) {
  const id = meta.id
  try {
    const cfg = defaultSpecialConfig(meta)
    cfg.width = W
    cfg.height = H
    const file = path.join(output, `portrait-${id}.html`)
    await fs.writeFile(file, buildSpecialPage(meta, cfg, GAME_CODE[id], assetBase))
    const win = await app.browserWindow(page)
    await win.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
    await page.goto(pathToFileURL(file).href)
    await page.waitForFunction(() => typeof window.__apply === 'function')
    await page.waitForTimeout(500)
    const op = meta.ops[0].value
    await page.evaluate((cmd) => window.__apply(cmd), { operation: op, count: meta.countDef * 3, username: '示例观众' })
    for (let t = 0; t < 1600; t += 40) await page.evaluate(() => window.__step(40))
    await page.waitForTimeout(120)
    await page.evaluate(() => window.__step(16))
    const ink = await page.evaluate(() => {
      const cv = document.getElementById('cv'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 16) n++; return n
    })
    const png = await win.evaluate(async (w) => Array.from((await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()))
    await fs.writeFile(path.join(output, `${id}.png`), Buffer.from(png))
    assert.ok(ink > 80, `画面没东西（墨量 ${ink}）`)
    console.log(`PASS ${meta.name}（${id}）墨量 ${ink}`)
    passed++
  } catch (e) {
    fail.push(`${meta.name}：${e.message}`)
    console.log(`FAIL ${meta.name}（${id}）：${e.message}`)
  }
}
await app.close()
if (errors.length) { console.log('\n页面错误：'); for (const e of errors) console.log('  ' + e) }
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
console.log(`\nSPECIAL PORTRAIT ${W}x${H}: ${passed}/${SPECIAL_GAMES.length} PASS  截图：${output}`)
if (fail.length || errors.length) process.exitCode = 1
