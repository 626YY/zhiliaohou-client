// 特色整蛊性能对比：同样几个玩法同时在动，「每个玩法一个窗口」（0.3.63 的做法）vs「合并成一个窗口」（现在的做法），
// 各跑一遍，比渲染进程 + GPU 进程的 CPU、内存、进程数和每窗口出帧数。
// 窗口离屏渲染（不显示、不聚焦、不抢前台），麦克风/摄像头用 Chromium 假设备，静音。两种做法用同一套玩法代码和同样的命令。
// 用法：node tools/bench-special-window.mjs [秒数，默认 10]
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const seconds = Math.max(4, Number(process.argv[2]) || 10)
const output = path.join(root, 'output/bench-special-window')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetBase = pathToFileURL(path.join(root, 'assets/special-games')).href.replace(/\/?$/, '/')

const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, SPECIAL_GAME_MAP, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig} from './src/shared/specialGames';
export {buildSpecialPage, buildSpecialWindowPage} from './src/main/special-page';
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
const { SPECIAL_GAMES, SPECIAL_GAME_MAP, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig, buildSpecialPage, buildSpecialWindowPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

const W = 1280, H = 720
// 一直在动的玩法（飞来飞去 / 爬来爬去 / 循环动画 / 音乐球），用来压满渲染
const BUSY = [
  { game: 'gesture_fly', operation: 'add', count: 40 },
  { game: 'caterpillar', operation: 'add', count: 12 },
  { game: 'music_ball', operation: 'start', count: 1 },
  { game: 'chain_challenge', operation: 'add', count: 6 },
  { game: 'big_mosquito', operation: 'add', count: 30 },
  { game: 'xiaoxin_hey', operation: 'add', count: 6 }
]
const SCENARIOS = [3, 6]

// 页面：单玩法页（旧做法每个窗口一个）+ 合并页（现在的做法）
const pages = {}
for (const b of BUSY) {
  const meta = SPECIAL_GAME_MAP[b.game]
  const file = path.join(output, `single-${b.game}.html`)
  await fs.writeFile(file, buildSpecialPage(meta, defaultSpecialConfig(meta), GAME_CODE[b.game], assetBase))
  pages[b.game] = pathToFileURL(file).href
}
const winFile = path.join(output, 'merged.html')
await fs.writeFile(winFile, buildSpecialWindowPage(SPECIAL_GAMES.map((meta) => ({ meta, cfg: defaultSpecialConfig(meta), code: GAME_CODE[meta.id] || '' })), { ...DEFAULT_SPECIAL_WINDOW, width: W, height: H }, SPECIAL_LAYER_ORDER, assetBase))
const mergedUrl = pathToFileURL(winFile).href

const bootstrap = path.join(output, 'bench-main.cjs')
await fs.writeFile(bootstrap, `
const { app, BrowserWindow } = require('electron');
const [mode, n, secs] = [process.env.BENCH_MODE, Number(process.env.BENCH_N), Number(process.env.BENCH_SECONDS)];
const busy = ${JSON.stringify(BUSY)}.slice(0, n);
const pages = ${JSON.stringify(pages)};
app.setPath('userData', ${JSON.stringify(path.join(output, 'profile'))} + '-' + mode + n);
app.whenReady().then(async () => {
  const make = () => {
    const w = new BrowserWindow({ width: ${W}, height: ${H}, show: false, focusable: false, frame: false, transparent: true,
      webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false, autoplayPolicy: 'no-user-gesture-required' } });
    w.webContents.setFrameRate(60);
    w.__paints = 0;
    w.webContents.on('paint', () => { w.__paints++; });
    return w;
  };
  const wins = [];
  if (mode === 'separate') {
    for (const b of busy) { const w = make(); wins.push(w); await w.loadURL(pages[b.game]); await w.webContents.executeJavaScript('window.__apply(' + JSON.stringify(b) + ')'); }
  } else {
    const w = make(); wins.push(w); await w.loadURL(${JSON.stringify(mergedUrl)});
    for (const b of busy) await w.webContents.executeJavaScript('window.__apply(' + JSON.stringify(b) + ')');
  }
  await new Promise((r) => setTimeout(r, 2500)); // 让素材加载、动画进入稳定
  app.getAppMetrics();
  for (const w of wins) w.__paints = 0;
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, secs * 1000));
  const dt = (Date.now() - t0) / 1000;
  const m = app.getAppMetrics();
  const pick = (types) => m.filter((p) => types.includes(p.type));
  const sum = (list, f) => list.reduce((s, p) => s + f(p), 0);
  const renderers = pick(['Tab']), gpu = pick(['GPU']), all = m;
  const alive = await Promise.all(wins.map((w) => w.webContents.executeJavaScript('typeof window.__alive==="function" ? window.__alive() : false').catch(() => false)));
  const out = {
    mode, n, windows: wins.length, processes: all.length, renderers: renderers.length,
    cpuRenderer: sum(renderers, (p) => p.cpu.percentCPUUsage), cpuGpu: sum(gpu, (p) => p.cpu.percentCPUUsage), cpuAll: sum(all, (p) => p.cpu.percentCPUUsage),
    memRendererMB: sum(renderers, (p) => (p.memory.privateBytes || p.memory.workingSetSize) / 1024), memAllMB: sum(all, (p) => (p.memory.privateBytes || p.memory.workingSetSize) / 1024),
    fpsPerWindow: wins.map((w) => w.__paints / dt), alive
  };
  process.stdout.write('BENCH ' + JSON.stringify(out) + '\\n');
  app.exit(0);
});
`)

const electronExe = path.join(root, 'node_modules/electron/dist/electron.exe')
function run(mode, n) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, BENCH_MODE: mode, BENCH_N: String(n), BENCH_SECONDS: String(seconds) }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    const p = spawn(electronExe, [bootstrap, '--force-device-scale-factor=1', '--allow-file-access-from-files', '--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], { cwd: root, env, windowsHide: true })
    let text = ''
    p.stdout.on('data', (d) => { text += d })
    p.stderr.on('data', () => {})
    p.on('exit', () => {
      const line = text.split(/\r?\n/).find((l) => l.startsWith('BENCH '))
      if (!line) return reject(new Error(`${mode} ${n} 没有结果：${text.slice(0, 300)}`))
      resolve(JSON.parse(line.slice(6)))
    })
  })
}

const rows = []
for (const n of SCENARIOS) {
  // 交替跑两遍取平均，减少机器忙闲的影响
  const sep = [], mer = []
  for (let k = 0; k < 2; k++) { sep.push(await run('separate', n)); mer.push(await run('merged', n)) }
  const avg = (list, key) => list.reduce((s, r) => s + r[key], 0) / list.length
  const fps = (list) => list.flatMap((r) => r.fpsPerWindow).reduce((s, v, _, a) => s + v / a.length, 0)
  for (const [label, list] of [['每个玩法一个窗口', sep], ['合并成一个窗口', mer]]) {
    rows.push({
      场景: `${n} 个玩法同时在动`, 做法: label, 窗口: list[0].windows, 进程: list[0].processes,
      '渲染进程CPU%': avg(list, 'cpuRenderer').toFixed(1), 'GPU进程CPU%': avg(list, 'cpuGpu').toFixed(1), '总CPU%': avg(list, 'cpuAll').toFixed(1),
      '渲染进程内存MB': avg(list, 'memRendererMB').toFixed(0), '总内存MB': avg(list, 'memAllMB').toFixed(0), '每窗口帧/秒': fps(list).toFixed(1)
    })
  }
}
console.table(rows)
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(rows, null, 2))
console.log(`BENCH DONE（每种做法每个场景跑 2 遍、每遍采样 ${seconds} 秒）结果：${path.join(output, 'result.json')}`)
