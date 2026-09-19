// 用户实拍回归：归零中文不能压住 y=98 的底部装饰横线；普通数字的字号不变。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/countdown-zero-layout')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, '--user-data-dir=' + profile], cwd: root, env })
const results = [], errors = []
app.on('window', p => p.on('pageerror', e => errors.push(e.message)))
const measure = element => {
  const head = element.parentElement, area = element.getBoundingClientRect(), board = head.getBoundingClientRect()
  const range = document.createRange(); range.selectNodeContents(element)
  const text = range.getBoundingClientRect()
  return { value:element.textContent, top:(text.top-board.top)/board.height*103, bottom:(text.bottom-board.top)/board.height*103,
    safeBottom:(area.bottom-board.top)/board.height*103, fontSize:parseFloat(getComputedStyle(element).fontSize),
    width:text.width, available:area.width, height:board.height }
}
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.timeWidgetOpen)
  const api = (name, ...args) => page.evaluate(([name,args]) => window.api[name](...args), [name,args])
  await api('register', 'zero_layout', 'Fixture123!', '归零排版')
  assert.equal((await api('login', 'zero_layout', 'Fixture123!')).ok, true)
  await api('saveSettings', { guideSeen:true })
  await page.evaluate(() => {
    localStorage.setItem('zl-guide-seen','1')
    localStorage.setItem('ent_time_cfg', JSON.stringify({ title:'倒计时 · 流光测试', initial:1, enable:false, theme:'aurora', zeroText:'时间到', autoHide:false,
      giftColumns:2, giftPanelWidth:1, startHotkey:{enabled:false,func:'无',key:''},endHotkey:{enabled:false,func:'无',key:''},
      gifts:[{name:'棒棒糖',mode:'blindbox',op:'加减',seconds:1},{name:'为你闪耀',mode:'blindbox',op:'加减',seconds:1}] }))
  })
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => !!document.querySelector('main'))
  await page.evaluate(() => { location.hash='/ent' })
  await page.getByRole('button',{name:/^时间插件/}).first().dispatchEvent('click')
  await page.getByRole('button',{name:'开启',exact:true}).dispatchEvent('click')
  let timer
  for(let i=0;i<80&&!timer;i++){timer=app.windows().find(p=>p.url().includes('time-widget'));if(!timer)await page.waitForTimeout(100)}
  assert.ok(timer)
  await timer.waitForFunction(() => !!document.getElementById('time'))
  await api('timeWidgetClear')
  const selector = page.getByRole('combobox',{name:'时间皮肤',exact:true})
  const themes = await selector.locator('option').evaluateAll(options => options.map(o=>o.value))
  for(const theme of themes) {
    await selector.selectOption(theme)
    await timer.waitForFunction(theme => document.body.dataset.theme===theme&&document.querySelector('#time')?.textContent==='时间到',theme)
    const live = await timer.locator('#time').evaluate(measure)
    assert.ok(live.bottom <= 96 && live.top >= 51, theme+' 输出文字侵入横线 '+JSON.stringify(live))
    assert.ok(live.width <= live.available + 1, theme+' 输出横向溢出')
    await page.waitForFunction(() => document.querySelector('[data-testid="time-preview-value"]')?.textContent==='时间到')
    const preview = await page.getByTestId('time-preview-value').evaluate(measure)
    assert.ok(preview.bottom <= 96 && preview.top >= 51, theme+' 预览文字侵入横线 '+JSON.stringify(preview))
    const win = await app.browserWindow(timer)
    const bytes = await win.evaluate(async w => [...(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()])
    await fs.writeFile(path.join(output, 'zero-'+theme+'.png'),Buffer.from(bytes))
    results.push({theme,live,preview})
  }
  await selector.selectOption('aurora')
  await api('timeWidgetAdjust',65)
  await timer.waitForFunction(() => document.querySelector('#time')?.textContent==='01:05')
  const normal = await timer.locator('#time').evaluate(measure)
  assert.ok(normal.fontSize >= 38, '归零修复不应缩小正常数字 '+JSON.stringify(normal))
  assert.equal(await timer.locator('#time').getAttribute('data-zeroed'),'false')
  await api('timeWidgetClear')
  await api('timeWidgetUpdate',{zeroText:'本轮挑战时间已经结束'})
  await timer.waitForFunction(() => document.querySelector('#time')?.textContent==='本轮挑战时间已经结束')
  const longer = await timer.locator('#time').evaluate(measure)
  assert.ok(longer.bottom <= 96 && longer.width <= longer.available + 1, '自定义归零文字不应遮线或溢出')
  assert.deepEqual(errors,[])
  console.log(`归零排版 ${themes.length} 皮肤 × 预览/输出 PASS；正常数字 ${normal.fontSize}px 保持；长归零文字 PASS`)
} finally {
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({results,errors},null,2))
  await app.close().catch(()=>{})
}
