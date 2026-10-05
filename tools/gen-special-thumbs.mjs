// 特色整蛊卡片缩略图：没有单张主图的玩法（毛毛虫、粉丝来电、粉丝来视频、音乐球）
// 用真实玩法代码离屏渲染一帧，按画布内容裁边，存到 assets/special-games/_thumbs/<id>.png（跟素材一起打包，不进 git）。
// 不启动客户端、不接触用户配置；窗口离屏不可见不聚焦。
// 用法：node tools/gen-special-thumbs.mjs [玩法id…]
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const assets = path.join(root, 'assets/special-games')
const outDir = path.join(assets, '_thumbs')
const work = path.join(root, 'output/playwright/special-thumbs')
await fs.mkdir(outDir, { recursive: true })
await fs.mkdir(work, { recursive: true })

// 每个玩法：渲染窗口大小、下发的命令、推多少帧（毫秒）；
// blank = 裁边前先擦掉的区域（画布上的计数框之类，卡片上不要），round = 输出切圆角半径，
// params = 覆盖玩法参数，seed = 固定随机种子（每次生成同一张图，挑过好看的）
const PLAN = {
  caterpillar: { w: 520, h: 300, cmd: { operation: 'add', count: 2, color: 'green' }, ms: 4200, blank: [[0, 0, 220, 70]], params: { sizePercent: 170 }, seed: 23 },
  fan_call: { w: 1280, h: 720, cmd: { operation: 'show', count: 1, username: '示例观众' }, ms: 900 },
  fan_video_call: { w: 405, h: 720, cmd: { operation: 'show', count: 1, username: '示例观众' }, ms: 900, round: 44 },
  music_ball: { w: 1280, h: 720, cmd: { operation: 'start' }, ms: 5200 }
}
// 锁链每套皮肤一张（皮肤选择器和卡片主图用）：chain-<皮肤>.png；静态帧（关掉动态光效），不带解锁提示
for (const skin of ['neon', 'candy', 'rosegold', 'laser', 'ice', 'default', 'style_1', 'style_2']) {
  PLAN['chain-' + skin] = { game: 'chain_challenge', w: 960, h: 540, cmd: { operation: 'add', count: 8 }, ms: 900, params: { visualStyle: skin, skinMotion: false, showUnlockHint: false } }
}
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLAN)

const bundle = path.join(work, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAME_MAP, defaultSpecialConfig} from './src/shared/specialGames';
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
const { SPECIAL_GAME_MAP, defaultSpecialConfig, buildSpecialPage, GAME_CODE } = createRequire(import.meta.url)(bundle)
const assetBase = pathToFileURL(assets).href.replace(/\/?$/, '/')

const profile = await fs.mkdtemp(path.join(work, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:720,show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false,autoplayPolicy:'no-user-gesture-required'}});win.loadURL('about:blank')});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--force-device-scale-factor=2', '--allow-file-access-from-files', '--mute-audio'],
  cwd: root,
  env
})
const page = await app.firstWindow()

for (const id of ids) {
  const plan = PLAN[id]
  const meta = SPECIAL_GAME_MAP[plan?.game || id]
  if (!plan || !meta) { console.log(`跳过 ${id}（没有缩略图方案）`); continue }
  const cfg = defaultSpecialConfig(meta)
  cfg.background = 'transparent'
  Object.assign(cfg.params, plan.params || {})
  const file = path.join(work, `thumb-${id}.html`)
  let html = buildSpecialPage(meta, cfg, GAME_CODE[meta.id], assetBase)
  // 固定种子的 Math.random（mulberry32），放在所有页面脚本前面
  if (plan.seed != null) html = html.replace('<script>', `<script>(function(a){Math.random=function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})(${Number(plan.seed)});</script><script>`)
  await fs.writeFile(file, html)
  const win = await app.browserWindow(page)
  await win.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: plan.w, h: plan.h })
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => typeof window.__apply === 'function')
  await page.waitForTimeout(400) // 素材图片加载
  await page.evaluate((cmd) => window.__apply(cmd), plan.cmd)
  for (let t = 0; t < plan.ms; t += 40) await page.evaluate(() => window.__step(40))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.__step(16))
  // 画布按不透明像素裁边，留一圈边距，长边缩到 640
  const dataUrl = await page.evaluate(({ blank, round }) => {
    const cv = document.getElementById('cv')
    const g = cv.getContext('2d')
    const { width: W, height: H } = cv
    // 按 2 倍像素密度渲染（卡片放大不糊）；blank / round 写的是页面坐标，换算成画布像素
    const dpr = window.devicePixelRatio || 1
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0)
    for (const [bx, by, bw, bh] of blank || []) g.clearRect(bx * dpr, by * dpr, bw * dpr, bh * dpr)
    g.restore()
    const d = g.getImageData(0, 0, W, H).data
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      if (d[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0) return ''
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04)
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad)
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1
    const s = Math.min(1, 640 / Math.max(cw, ch))
    const out = document.createElement('canvas')
    out.width = Math.round(cw * s); out.height = Math.round(ch * s)
    const og = out.getContext('2d')
    og.imageSmoothingQuality = 'high'
    if (round) {
      const r = round * dpr * s
      og.beginPath()
      og.roundRect(0, 0, out.width, out.height, r)
      og.clip()
    }
    og.drawImage(cv, x0, y0, cw, ch, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }, { blank: plan.blank, round: plan.round })
  if (!dataUrl) { console.log(`FAIL ${id}：画布是空的`); process.exitCode = 1; continue }
  const target = path.join(outDir, `${id}.png`)
  await fs.writeFile(target, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`OK ${id} → ${path.relative(root, target)}`)
}

await app.close()
