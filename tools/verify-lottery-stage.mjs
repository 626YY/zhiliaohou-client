// 抽奖挂件「上播表现」回归：平时不出现在直播画面里（只剩绿底）、触发才亮出来、抽完自动收，
// 外圈跑马灯跟着盘跑，关掉的挂件待机画面是能抠掉的绿而不是黑。真 Electron，独立 userData，不连直播。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'lottery-stage')
await fs.mkdir(output, { recursive: true })
const isolated = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(isolated, 'qa-entry.ts')
await fs.writeFile(entry, `export * as lottery from ${JSON.stringify(path.join(root, 'src/main/lottery-widget.ts'))}
export * as out from ${JSON.stringify(path.join(root, 'src/main/output-window.ts'))}
export * as video from ${JSON.stringify(path.join(root, 'src/main/video-widget.ts'))}
export * as ent from ${JSON.stringify(path.join(root, 'src/main/entertainment.ts'))}
`)
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(isolated, 'qa.cjs'), external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent' })
const bootstrap = path.join(isolated, 'main.cjs')
await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname);
// 和打包一致地指向仓库根：内置礼物图（gift-assets/douyin）和内置音效都按 appPath 找
app.setAppPath(${JSON.stringify(root)});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
// 和 app-setup 一致：不锁 sRGB 的话，采集出来的绿会被显示器色彩配置改掉，测颜色就不准了
app.commandLine.appendSwitch('force-color-profile','srgb');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{ const qa=require('./qa.cjs'); global.qa=qa;
  const control=new BrowserWindow({show:false}); await control.loadURL('about:blank'); global.qa.ready=true });`)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap, '--no-sandbox'], env, timeout: 30_000 })
const results = []
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS ' + name) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const call = (ns, fn, args = []) => app.evaluate((_, { ns, fn, args }) => global.qa[ns][fn](...args), { ns, fn, args })
const ITEMS = ['大礼物', '再来一次', '谢谢参与', '盲盒'].map((name, i) => ({ name, color: i % 2 ? '#8d3b58' : '#f2e3e8' }))

// 页面状态按 class 读，和实际上播画面同一份真相
const stageState = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '幸运转盘')
  if (!win) return null
  return win.webContents.executeJavaScript(`(() => {
    const stage = document.getElementById('stage');
    return {
      idle: stage.classList.contains('idle'),
      spinning: stage.classList.contains('spin'),
      cheering: stage.classList.contains('cheer'),
      bulbs: document.querySelectorAll('.dot').length,
      lit: document.querySelectorAll('.dot.lit,.dot.trail').length,
      mode: document.body.dataset.bulbs
    }
  })()`)
})
// 采集端看到的就是这张图：取窗口正中间一个点的颜色
const centerPixel = title => app.evaluate(async ({ BrowserWindow }, title) => {
  const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === title)
  if (!win) return null
  const image = await win.capturePage()
  const size = image.getSize()
  const cropped = image.crop({ x: Math.floor(size.width / 2), y: Math.floor(size.height / 2), width: 1, height: 1 })
  const [b, g, r] = cropped.toBitmap()
  return { r, g, b }
}, title)
const isChromaGreen = p => !!p && p.g > 200 && p.r < 90 && p.b < 90

try {
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.qa?.ready)); i++) await sleep(100)

  // 抽完停留 1 秒，测试不用等 6 秒
  check('写入抽奖配置', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS])).ok)
  check('打开幸运转盘', (await call('lottery', 'openWheelWindow', [ITEMS])).ok)
  await sleep(2500)

  const idle = await stageState()
  check('转盘窗口开着，但平时不出现在直播画面里', idle && idle.idle === true)
  check('外圈 16 颗灯珠都在', idle.bulbs === 16)
  check('空闲时采集到的就是能抠掉的绿底', isChromaGreen(await centerPixel('幸运转盘')))

  check('触发抽奖', (await call('lottery', 'lotterySpin', ['wheel'])).ok)
  await sleep(900)
  const spinning = await stageState()
  check('触发后画面亮出来', spinning.idle === false)
  check('转动中盘在转', spinning.spinning === true)
  check('跑马灯跟着盘跑（有灯亮着）', spinning.lit > 0)
  check('转动时采集到的不再是纯绿（画面出来了）', !isChromaGreen(await centerPixel('幸运转盘')))

  // 转 4.2 秒 + 停留 1 秒
  await sleep(5200)
  const done = await stageState()
  check('抽完先留一会儿再收（庆祝闪灯）', done.spinning === false)
  await sleep(1200)
  const back = await stageState()
  check('停留结束自动收回，画面又空了', back.idle === true)
  check('收回后采集到的又是绿底', isChromaGreen(await centerPixel('幸运转盘')))

  // 抽奖流水：抽中什么、什么时候、谁触发的，都要留痕
  const history = await call('lottery', 'lotteryHistory', [50])
  check('抽完写了一条记录', Array.isArray(history) && history.length === 1 && history[0].kind === 'wheel')
  check('记录里有奖项名和时间', !!history[0].prize && Number.isFinite(history[0].at) && Math.abs(Date.now() - history[0].at) < 120_000)
  check('记录里有触发来源', history[0].source === 'manual' || history[0].source === 'gift' || history[0].source === 'chain')
  check('清空记录', (await call('lottery', 'clearLotteryHistory')).ok && (await call('lottery', 'lotteryHistory', [50])).length === 0)

  // ---- 中心图跟着触发礼物走 ----
  // 固定中心图用「玫瑰」，触发礼物用「小心心」——两张都是内置礼物图，正好能分辨换没换
  const rose = await call('ent', 'findGiftImage', ['玫瑰'])
  const heart = await call('ent', 'findGiftImage', ['小心心'])
  check('内置礼物图库能按名字找到图（玫瑰 / 小心心）', !!rose?.path && !!heart?.path && rose.path !== heart.path)
  const fixedUrl = pathToFileURL(rose.path).href
  const heartUrl = pathToFileURL(heart.path).href
  // 页面中心图（#spin 里那张图）实际用的是哪张
  const centerImgSrc = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '幸运转盘')
    if (!win) return null
    return win.webContents.executeJavaScript(`(() => { const img = document.querySelector('#spin img'); return img ? img.getAttribute('src') : '' })()`)
  })
  const giftTrigger = giftName => call('lottery', 'handleLotteryGift', [{ type: 'gift', giftName, sender: '验收观众', count: 1 }])

  check('配好固定中心图并开启「中心图跟着触发礼物走」', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: true, triggerGift: '', centerGift: true, idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS, rose.path])).ok)
  await sleep(600)
  check('没转之前中心就是那张固定图', (await centerImgSrc()) === fixedUrl)

  await giftTrigger('小心心')
  await sleep(900)
  check('送「小心心」转起来后，中心换成小心心的图', (await centerImgSrc()) === heartUrl)
  const giftEvent = (await call('lottery', 'lotteryState')).draws.wheel
  check('这一轮的抽奖事件带着触发礼物的图', giftEvent?.center === heartUrl && giftEvent?.item?.name)
  await sleep(4200)

  await giftTrigger('不存在的礼物名xyz')
  await sleep(900)
  check('送的礼物在图库里没图时，退回固定中心图', (await centerImgSrc()) === fixedUrl)
  await sleep(4200)

  check('关掉「中心图跟着触发礼物走」', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: true, triggerGift: '', centerGift: false, idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS, rose.path])).ok)
  await sleep(400)
  await giftTrigger('小心心')
  await sleep(900)
  check('关掉之后，礼物触发也保持固定中心图', (await centerImgSrc()) === fixedUrl)
  await sleep(4200)

  // 关掉「视频铺在抽奖窗口里播」要能存住（这两个开关以前漏在保存白名单外，重启会变回默认开）
  check('关掉视频铺在窗口里播 + 中心图跟礼物，配置都存住', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', centerGift: false, stageVideo: false, idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS, rose.path])).ok)
  const persisted = JSON.parse(await fs.readFile(path.join(isolated, 'lottery-config.json'), 'utf8'))
  check('落盘的配置里 stageVideo / centerGift 都是 false', persisted.wheel?.trigger?.stageVideo === false && persisted.wheel?.trigger?.centerGift === false)
  check('恢复默认（视频铺窗口 + 中心图跟礼物）', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', centerGift: true, stageVideo: true, idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS])).ok)

  // 奖品视频就在转盘窗口里播：直播伴侣只采这一个来源就够，不用再加视频窗口
  const videoFile = path.join(isolated, 'prize.webm')
  await fs.writeFile(videoFile, Buffer.from(await app.evaluate(async ({ BrowserWindow }) => {
    const maker = new BrowserWindow({ show: false })
    await maker.loadURL('about:blank')
    const bytes = await maker.webContents.executeJavaScript(`(async () => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90;
      const ctx = c.getContext('2d'); const chunks = [];
      const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm;codecs=vp8' });
      const done = new Promise(r => rec.onstop = r); rec.ondataavailable = e => chunks.push(e.data); rec.start();
      const t = setInterval(() => { ctx.fillStyle = '#ff2d55'; ctx.fillRect(0, 0, 160, 90) }, 40);
      await new Promise(r => setTimeout(r, 3000)); rec.stop(); clearInterval(t); await done;
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
    })()`)
    maker.destroy()
    return bytes
  })))
  // 每个奖项都配上，抽到哪个都会播
  const withVideo = ITEMS.map((item) => ({ ...item, action: 'stage-video', actionParam: videoFile }))
  check('配一个「在转盘窗口里播视频」的奖项', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, withVideo])).ok)
  await call('lottery', 'lotterySpin', ['wheel'])
  // 转 4.2 秒后开播，趁视频还在放的时候看一眼是不是铺在转盘窗口上
  await sleep(5400)
  const playing = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '幸运转盘')
    return win.webContents.executeJavaScript(`(() => {
      const v = document.getElementById('prize')
      return { onStage: v.classList.contains('on'), hasSrc: !!v.getAttribute('src'), extraWindows: 0 }
    })()`)
  })
  const openTitles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getTitle()))
  check('奖品视频铺在转盘窗口里', playing.onStage === true && playing.hasSrc === true)
  check('没有另外开绿幕/视频窗口（伴侣不用再加来源）', !openTitles.some(t => t.startsWith('绿幕') || t.startsWith('视频')))

  // 项目文件夹 / 动作命令挑出来的视频，最后走的是绿幕窗口那条路——它也得被转盘接住
  // 真实链路：动作命令 / 项目文件夹最后都调 openVideoWidget，这里照着接一个
  await app.evaluate(() => {
    global.qa.lottery.setLotteryActionHandler(async (item) => {
      const param = String(item.actionParam || '')
      if (item.action === 'command' && param.startsWith('video-play|')) {
        return global.qa.video.openVideoWidget({ path: param.slice('video-play|'.length), loop: false, muted: true, slot: 'main', autoClose: true })
      }
      return { ok: true }
    })
  })
  const viaGreen = ITEMS.map((item) => ({ ...item, action: 'command', actionParam: 'video-play|' + videoFile }))
  check('配一个走绿幕那条路的奖项（动作命令播视频）', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: true, holdSeconds: 1, stageVideo: true, sound: { mode: 'off', volume: 0, chosen: true } }, viaGreen])).ok)
  await call('lottery', 'lotterySpin', ['wheel'])
  await sleep(5600)
  const redirected = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === '幸运转盘')
    return win.webContents.executeJavaScript(`(() => { const v = document.getElementById('prize'); return { onStage: v.classList.contains('on'), hasSrc: !!v.getAttribute('src') } })()`)
  })
  const titlesAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getTitle()))
  check('动作命令 / 项目挑出来的视频也铺在转盘窗口里', redirected.onStage === true && redirected.hasSrc === true)
  check('没有另外弹视频窗口', !titlesAfter.some(t => t.startsWith('视频') || t.startsWith('绿幕')))

  // 关掉挂件 = 窗口真没了（开哪个才有哪个；「留着采集来源」默认关）
  await call('lottery', 'closeLotteryWindow', ['lucky'])
  await sleep(1200)
  check('关掉挂件后窗口真没了（开哪个才有哪个）', (await centerPixel('幸运转盘')) === null)

  // 关掉「平时不出现」后回到老行为：一直显示
  check('关掉空闲隐藏', (await call('lottery', 'configureLottery', ['wheel', { autoSpin: false, triggerGift: '', idleHide: false, holdSeconds: 1, sound: { mode: 'off', volume: 0 } }, ITEMS])).ok)
  check('重新打开转盘', (await call('lottery', 'openWheelWindow', [ITEMS])).ok)
  await sleep(2500)
  const always = await stageState()
  check('关掉空闲隐藏后，转盘一直显示', always.idle === false)

  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, userData: isolated }, null, 2))
  console.log(`lottery stage regression passed: ${results.length} checks`)
} finally {
  await app.close().catch(() => {})
}
