// 登录页回归：真实 Electron、隔离配置；不连接用户账号、不发送验证码。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

export async function verifyLoginMotion(app, page, output) {
  await fs.mkdir(output, { recursive: true })
  const checks = [], frames = [], errors = []
  const onError = e => errors.push(e.message)
  page.on('pageerror', onError)
  page.setDefaultTimeout(10000)
  const win = await app.browserWindow(page)
  const pass = (name, detail) => { checks.push({ name, detail }); console.log('PASS ' + name + (detail ? ' | ' + JSON.stringify(detail) : '')) }
  const shot = async name => {
    const file = path.join(output, name + '.png')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // Electron 的页面截图在 zoomFactor != 1 时会按 CSS 视口裁掉右/下区域。
    // 直接读取同一 BrowserWindow 的完整画面，保留实际窗口像素。
    const bytes = Buffer.from(await win.evaluate(async w => [...(await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()]))
    await fs.writeFile(file, bytes)
    const frame = { file, md5: createHash('md5').update(bytes).digest('hex') }
    frames.push(frame)
    return frame.md5
  }
  const layout = () => page.evaluate(() => {
    const area = document.querySelector('.login-form-area')
    return {
      width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: area.clientWidth, scrollWidth: area.scrollWidth,
      clientHeight: area.clientHeight, scrollHeight: area.scrollHeight
    }
  })
  try {
    await page.waitForSelector('.cicada-body')
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion })
      await page.reload()
      await page.waitForSelector('.cicada-body')
      await page.getByPlaceholder('邮箱 / 用户名').fill('layout-motion-fixture')
      const baseline = await page.getByPlaceholder('邮箱 / 用户名').boundingBox()
      const samples = [], hashes = []
      for (let i = 0; i < 8; i++) {
        samples.push(await page.evaluate(() => {
          const style = selector => getComputedStyle(document.querySelector(selector))
          return {
            float: style('.cicada-body').transform,
            scan: style('.cicada-scan').transform,
            glow: style('.cicada-glow').opacity,
            background: style('.auth-backdrop-glow').transform,
            animations: document.getAnimations().filter(a => a.animationName).map(a => ({ name: a.animationName, duration: a.effect.getTiming().duration, repeats: a.effect.getTiming().iterations === Infinity }))
          }
        }))
        if (i % 2 === 0) hashes.push(await shot(reducedMotion + '-frame-' + i))
        if (i < 7) await page.waitForTimeout(650)
      }
      for (const key of ['float', 'scan', 'glow', 'background']) assert.ok(new Set(samples.map(s => s[key])).size >= 3, key + ' 没有持续变化')
      for (const name of ['zl-float', 'zl-scan', 'zl-pulse-glow', 'auth-glow-drift']) assert.ok(samples.every(s => s.animations.some(a => a.name === name && a.duration >= 3000 && a.repeats)), name + ' 被压缩/停止')
      assert.equal(new Set(hashes).size, hashes.length, '动效实际截图重复')
      assert.deepEqual(await page.getByPlaceholder('邮箱 / 用户名').boundingBox(), baseline, '背景带动表单晃动')
      assert.equal(await page.getByPlaceholder('邮箱 / 用户名').inputValue(), 'layout-motion-fixture')
      const size = await layout()
      assert.equal(size.scrollWidth, size.clientWidth)
      pass(reducedMotion + '：蝉悬浮、扫光、光晕和背景持续变化，表单保持原位', { distinctFrames: hashes.length, size })
    }

    const centering = await page.evaluate(() => {
      document.querySelector('.cicada-glow').getAnimations().forEach(a => a.cancel())
      const mark = document.querySelector('.cicada-mark').getBoundingClientRect()
      const glow = document.querySelector('.cicada-glow').getBoundingClientRect()
      return { dx: glow.x + glow.width / 2 - mark.x - mark.width / 2, dy: glow.y + glow.height / 2 - mark.y - mark.height / 2 }
    })
    assert.ok(Math.abs(centering.dx) < 0.5 && Math.abs(centering.dy) < 0.5)
    assert.equal((await layout()).scrollWidth, (await layout()).clientWidth)
    await shot('cancelled-glow-centered')
    pass('即使动画被取消，光晕仍居中且无横向溢出', centering)

    for (const [width, height, zoom] of [[840, 500, 1], [780, 460, 1], [840, 500, 1.25], [780, 460, 1.5]]) {
      await page.reload()
      await page.waitForSelector('.login-form-area')
      // App 挂载会恢复默认登录尺寸，必须等挂载结束后再模拟用户缩放。
      await win.evaluate((w, [width, height, zoom]) => { w.setSize(width, height); w.webContents.setZoomFactor(zoom) }, [width, height, zoom])
      await page.waitForFunction(([width, height, zoom]) => Math.abs(innerWidth - width / zoom) <= 1 && Math.abs(innerHeight - height / zoom) <= 1, [width, height, zoom])
      for (const mode of ['login', 'register', 'reset']) {
        if (mode === 'register') await page.getByRole('button', { name: /创建账号/ }).click()
        if (mode === 'reset') { await page.getByRole('button', { name: '← 返回登录', exact: true }).click(); await page.getByRole('button', { name: /忘记密码/ }).click() }
        const size = await layout()
        assert.ok(Math.abs(size.width - width / zoom) <= 1 && Math.abs(size.height - height / zoom) <= 1, '窗口未达到测试尺寸')
        assert.equal(size.scrollWidth, size.clientWidth, mode + ' 横向溢出')
        assert.equal(size.documentWidth, size.width, mode + ' 根节点横向溢出')
        // 用实际控件滚入视野，检查放大后的首字段与提交按钮都可达。
        for (const control of [page.locator('form input').first(), page.locator('form button[type="submit"]')]) {
          await control.scrollIntoViewIfNeeded()
          const b = await control.boundingBox(), a = await page.locator('.login-form-area').boundingBox()
          assert.ok(b.y >= a.y - 1 && b.y + b.height <= a.y + a.height + 1, mode + ' 控件被纵向裁掉')
          assert.ok(b.x >= 0 && b.x + b.width <= size.width, mode + ' 控件被横向裁掉')
        }
        await shot(`${mode}-${width}-${height}-${zoom}`)
        pass(`${mode} ${width}×${height} ${zoom * 100}%：无横条、所有字段可达`, size)
      }
    }

    await win.evaluate(w => { w.webContents.setZoomFactor(1); w.setSize(840, 500) })
    for (const theme of ['dark', 'light', 'cream', 'ocean', 'amethyst', 'forest', 'sakura', 'terracotta', 'moonlight']) {
      await page.evaluate(theme => localStorage.setItem('zl-theme', theme), theme)
      await page.reload()
      await page.waitForSelector('.cicada-body')
      const size = await layout()
      assert.equal(size.scrollWidth, size.clientWidth)
      assert.equal(await page.locator('.cicada-mark img').evaluate(im => im.complete && im.naturalWidth > 0), true)
      await shot('login-theme-' + theme)
    }
    pass('九套主题的原蝉素材都正常显示，登录页均无横向溢出')

    // 只替换本测试进程的本地登录应答以停留过渡屏，绝不发真实登录/验证码请求。
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('auth:login')
      ipcMain.handle('auth:login', () => new Promise(resolve => { global.__loginMotionResolve = resolve }))
    })
    await page.evaluate(() => localStorage.setItem('zl-theme', 'dark'))
    await page.reload()
    await page.waitForSelector('.login-form-area')
    await page.getByPlaceholder('邮箱 / 用户名').fill('motion-test-only')
    await page.getByPlaceholder('密码', { exact: true }).fill('Fixture-not-sent')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForSelector('.auth-backdrop-cover')
    const loadingFrames = []
    for (let i = 0; i < 3; i++) {
      loadingFrames.push(await page.evaluate(() => ({ cover: getComputedStyle(document.querySelector('.auth-backdrop-cover')).transform, glow: getComputedStyle(document.querySelector('.auth-backdrop-glow')).transform, spin: getComputedStyle(document.querySelector('.animate-spin')).transform })))
      await shot('loading-' + i)
      if (i < 2) await page.waitForTimeout(700)
    }
    for (const key of ['cover', 'glow', 'spin']) assert.equal(new Set(loadingFrames.map(f => f[key])).size, 3)
    pass('实际登录过渡屏的模糊封面、炫光和加载环都持续播放')
    // 模拟封面加载失败；原有光斑仍覆盖背景，品牌/加载提示保持可见。
    await page.locator('.auth-backdrop-cover').evaluate(img => { img.src = 'data:image/png;base64,broken' })
    await page.waitForFunction(() => document.querySelector('.auth-backdrop-cover').complete)
    assert.equal(await page.getByText('正在登录…', { exact: true }).isVisible(), true)
    assert.equal(await page.locator('.auth-backdrop-glow').evaluate(e => e.getAnimations().some(a => a.playState === 'running')), true)
    await shot('loading-cover-unavailable')
    await app.evaluate(() => { global.__loginMotionResolve({ ok: false, error: '隔离测试返回' }); delete global.__loginMotionResolve })
    await page.waitForSelector('.login-form-area')
    pass('封面不可用仍有完整背景动效；失败后正常返回登录表单')
    assert.deepEqual(errors, [])
    pass('上述交互无页面异常')
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, frames, errors }, null, 2))
    console.log(`LOGIN MOTION ${checks.length}/${checks.length} PASS`)
    return { checks: checks.length, frames: frames.length }
  } finally {
    page.off('pageerror', onError)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
}

if (typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { _electron: electron } = await import('playwright-core')
  const root = path.resolve(import.meta.dirname, '..'), packaged = process.argv.includes('--packaged')
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  const resources = path.join(root, `release/v${version}/win-unpacked/resources`), archive = path.join(resources, 'app.asar')
  const output = path.join(root, 'output/playwright/login-motion' + (packaged ? '-packaged' : ''))
  await fs.mkdir(output, { recursive: true })
  const profile = await fs.mkdtemp(path.join(output, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir: packaged ? path.join(archive, 'out') : 'out' })
  if (packaged) {
    let b = await fs.readFile(entry, 'utf8')
    b = b.replace(`electron.app.setAppPath(${JSON.stringify(root)});`, `electron.app.setAppPath(${JSON.stringify(archive)});Object.defineProperty(electron.app,'isPackaged',{get:()=>true});Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});`)
    await fs.writeFile(entry, b)
  }
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, '--user-data-dir=' + profile], cwd: root, env })
  try { await verifyLoginMotion(app, await app.firstWindow(), output) }
  finally { await app.close() }
}
