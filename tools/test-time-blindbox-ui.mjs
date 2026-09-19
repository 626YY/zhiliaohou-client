// 真实时间插件 React 页面 + 可控 IPC。验证编辑、保存、奖池绑定和请求行为；不打开用户客户端。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const outputRoot = path.join(root, 'output/playwright/time-blindbox-ui')
await fs.mkdir(outputRoot, { recursive: true })
const output = await fs.mkdtemp(path.join(outputRoot, 'session-'))
const checks = []
const passed = name => checks.push(name)
const source = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import Time from './src/renderer/src/pages/EntertainmentTime';
  import {useToast} from './src/renderer/src/stores/ui';
  if (!localStorage.getItem('ent_time_cfg')) localStorage.setItem('ent_time_cfg', JSON.stringify({gifts:[{name:'鲜花',op:'盲盒',seconds:-5,seconds2:5}]}));
  window.calls = []; window.currentConfig = null; window.toasts = () => useToast.getState().toasts;
  window.mockState = {open:true,remaining:120,running:false,queueLength:0};
  const record = (method, arg) => window.calls.push({method,arg,config:structuredClone(window.currentConfig)});
  window.api = {
    timeWidgetState: async () => window.mockState, timeWidgetLog: async () => [], timeWidgetLogClear: async () => ({ok:true}),
    entertainmentListGiftImages: async () => [], onConnectorEvent: () => () => {},
    timeWidgetUpdate: async config => {window.currentConfig=structuredClone(config); record('update'); return {ok:true}},
    timeWidgetTestEvent: async id => { record('event', id); return window.failTest ? {ok:false,error:'视频不存在：C:/素材 库/时间×3.mp4'} : {ok:true,queued:1}},
    timeWidgetTestGift: async name => {record('gift',name); if(window.holdTest) return new Promise(resolve=>window.finishTest=resolve); return {ok:true,queued:1}},
    timeWidgetCancelQueue: async () => {record('cancel'); window.mockState={...window.mockState,activeEvent:undefined,queueLength:0}; return {ok:true,cancelled:3}},
    timeWidgetOpen: async config => {window.mockState.open=true; record('open',config); return {ok:true}},
    timeWidgetClose: async () => {window.mockState.open=false; return {ok:true}},
    timeWidgetClear: async () => ({ok:true}),
    selectFile: async options => ({ok:true,path:options.title.includes('音效') ? 'C:/素材 库/倒计时.mp3' : 'C:/素材 库/时间×3.mp4'})
  };
  createRoot(document.getElementById('root')).render(<Time/>);
`
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@shared': path.join(root, 'src/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
const cssSource = await fs.readFile(path.join(root, 'src/renderer/src/index.css'), 'utf8')
const css = await postcss([tailwind({ config: path.join(root, 'tailwind.config.js') })]).process(cssSource, { from: path.join(root, 'src/renderer/src/index.css') })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 940 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:49539/**', route => {
    const url = route.request().url()
    return route.fulfill(url.endsWith('app.js') ? { contentType: 'application/javascript', body: bundle.outputFiles[0].text } : url.endsWith('style.css') ? { contentType: 'text/css', body: css.css } : { contentType: 'text/html', body: '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="/style.css"></head><body style="overflow:auto"><div id="root" style="padding:24px"></div><script src="/app.js"></script></body></html>' })
  })
  await page.goto('http://localhost:49539/')
  const library = page.getByRole('region', { name: '时间盲盒事件库', exact: true })
  await library.waitFor()
  assert.equal(await page.getByLabel('礼物 1 触发方式').inputValue(), 'direct')
  assert.equal(await page.getByLabel('礼物 1 运算').inputValue(), '加减')
  passed('旧 op=盲盒保留加减语义，未自动变成事件盲盒')

  await library.getByRole('button', { name: '添加事件', exact: true }).click()
  await library.getByLabel('事件名称', { exact: true }).fill('时间翻三倍')
  await library.getByRole('button', { name: '乘时间', exact: true }).click()
  await library.getByLabel('事件数值', { exact: true }).fill('3')
  await library.getByRole('button', { name: '选择事件视频', exact: true }).click()
  await library.getByRole('button', { name: '选择事件音效', exact: true }).click()
  await library.getByLabel('事件音效音量', { exact: true }).fill('72')
  await library.getByLabel('附加事件类型', { exact: true }).selectOption('effect')
  await library.getByLabel('事件礼物动画', { exact: true }).selectOption('firework')
  let cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
  const firstId = cfg.blindBoxEvents[0].id
  assert.equal(cfg.blindBoxEvents[0].op, 'multiply')
  assert.equal(cfg.blindBoxEvents[0].value, 3)
  assert.equal(cfg.blindBoxEvents[0].videoSeconds, 0)
  assert.equal(cfg.blindBoxEvents[0].video, 'C:/素材 库/时间×3.mp4')
  assert.equal(cfg.blindBoxEvents[0].sound, 'C:/素材 库/倒计时.mp3')
  assert.equal(cfg.blindBoxEvents[0].soundVolume, 72)
  assert.equal(cfg.blindBoxEvents[0].actionParam, 'firework')
  assert.deepEqual(await library.getByLabel('附加事件类型').locator('option').evaluateAll(items => items.map(item => item.value)), ['none', 'prank', 'effect'])
  passed('×3事件包含独立视频/音效/音量/附加动画，动作范围无递归抽奖')

  await library.getByRole('button', { name: '添加事件', exact: true }).click()
  await library.getByLabel('事件名称', { exact: true }).fill('随机减时')
  await library.getByRole('button', { name: '减时', exact: true }).click()
  await library.getByLabel('事件数值', { exact: true }).fill('10')
  await library.getByRole('switch').click()
  await library.getByLabel('事件范围终点', { exact: true }).fill('30')
  await page.getByLabel('礼物 1 触发方式').selectOption('blindbox')
  const pool = page.getByTestId('time-blindbox-pool')
  assert.match(await pool.innerText(), /盲盒奖池为空/)
  await pool.getByRole('checkbox', { name: '抽奖事件 时间翻三倍', exact: true }).click()
  await pool.getByRole('checkbox', { name: '抽奖事件 随机减时', exact: true }).click()
  assert.equal(await pool.getByRole('alert').count(), 0)
  cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
  assert.equal(cfg.blindBoxEvents[1].op, 'subtract')
  assert.deepEqual([cfg.blindBoxEvents[1].value, cfg.blindBoxEvents[1].value2], [10, 30])
  assert.deepEqual(cfg.gifts[0].blindBoxEventIds, cfg.blindBoxEvents.map(event => event.id))
  passed('添加/减法范围编辑，礼物奖池显式勾选两个事件')

  await page.getByPlaceholder('方案名', { exact: true }).fill('盲盒方案')
  await page.getByRole('button', { name: '保存方案', exact: true }).click()
  await library.getByRole('button', { name: '编辑事件 时间翻三倍', exact: true }).click()
  await library.getByRole('button', { name: '除时间', exact: true }).click()
  await library.getByLabel('事件数值', { exact: true }).fill('0')
  assert.match(await library.innerText(), /除数必须大于 0/)
  assert.equal(await library.getByRole('button', { name: '测试事件 时间翻三倍', exact: true }).isDisabled(), true)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')).blindBoxEvents[0].value), 0)
  passed('除零原值保留、明显报错、阻止事件测试')

  await library.getByLabel('事件数值', { exact: true }).fill('3')
  await library.getByRole('switch').click()
  await library.getByLabel('事件范围终点', { exact: true }).fill('')
  await library.getByLabel('事件视频秒数', { exact: true }).fill('')
  await library.getByLabel('事件音效音量', { exact: true }).fill('')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')).blindBoxEvents[0].value2), 'NaN')
  assert.deepEqual(await page.evaluate(() => { const event=JSON.parse(localStorage.getItem('ent_time_cfg')).blindBoxEvents[0]; return [event.videoSeconds,event.soundVolume] }), ['NaN', 'NaN'])
  await page.getByPlaceholder('方案名', { exact: true }).fill('未填范围方案')
  await page.getByRole('button', { name: '保存方案', exact: true }).click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_plans')).find(plan => plan.name === '未填范围方案').config.blindBoxEvents[0].value2), 'NaN')
  await page.reload()
  await library.getByRole('button', { name: '编辑事件 时间翻三倍', exact: true }).click()
  assert.equal(await library.getByRole('switch').getAttribute('aria-checked'), 'true')
  assert.equal(await library.getByLabel('事件范围终点', { exact: true }).inputValue(), '')
  assert.equal(await library.getByLabel('事件视频秒数', { exact: true }).inputValue(), '')
  assert.equal(await library.getByLabel('事件音效音量', { exact: true }).inputValue(), '')
  assert.equal(await library.getByRole('button', { name: '测试事件 时间翻三倍', exact: true }).isDisabled(), true)
  passed('未填范围/视频时长/音量跨保存方案和重载保留错误，未自动变有效默认值')

  await page.getByRole('combobox').filter({ has: page.locator('option[value="盲盒方案"]') }).selectOption('盲盒方案')
  cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
  assert.equal(cfg.blindBoxEvents[0].op, 'multiply')
  assert.equal(cfg.blindBoxEvents[0].value, 3)
  assert.equal(cfg.blindBoxEvents[0].soundVolume, 72)
  assert.equal(cfg.gifts[0].blindBoxEventIds.length, 2)
  await page.reload()
  await library.waitFor()
  assert.equal(await page.getByLabel('礼物 1 触发方式').inputValue(), 'blindbox')
  assert.equal(await pool.getByRole('checkbox', { checked: true }).count(), 2)
  passed('方案加载和页面重载恢复事件、多媒体及礼物奖池')

  await page.getByRole('button', { name: '测试礼物 鲜花', exact: true }).click()
  await page.waitForFunction(() => window.calls.some(call => call.method === 'gift'))
  const giftCall = await page.evaluate(() => window.calls.find(call => call.method === 'gift'))
  assert.equal(giftCall.arg, '鲜花')
  assert.equal(giftCall.config.blindBoxEvents[0].value, 3)
  assert.equal(giftCall.config.gifts[0].mode, 'blindbox')
  await library.getByRole('button', { name: '测试事件 时间翻三倍', exact: true }).click()
  await page.waitForFunction(() => window.calls.some(call => call.method === 'event'))
  assert.equal(await page.evaluate(() => window.calls.find(call => call.method === 'event').arg), firstId)
  passed('礼物抽一次与事件测试调用不同后端入口，并先同步最新设置')

  await page.evaluate(() => { window.holdTest = true })
  await page.getByRole('button', { name: '测试礼物 鲜花', exact: true }).evaluate(button => { button.click(); button.click() })
  await page.waitForFunction(() => !!window.finishTest)
  assert.equal(await page.getByRole('button', { name: '测试礼物 鲜花', exact: true }).isDisabled(), true)
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'gift').length), 2)
  await page.evaluate(() => { window.holdTest=false; window.finishTest({ok:true,queued:1}) })
  passed('等待 IPC 返回时禁止重复抽奖请求')

  await page.evaluate(() => { window.failTest = true })
  await library.getByRole('button', { name: '测试事件 时间翻三倍', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="盲盒执行状态"]')?.textContent.includes('视频不存在'))
  assert.match(await library.innerText(), /视频不存在：C:\/素材 库\/时间×3.mp4/)
  await page.evaluate(() => { window.mockState = {open:true,remaining:360,running:true,queueLength:2,activeEvent:{id:'active',name:'时间翻三倍'},lastResult:{id:'one',eventId:'active',eventName:'时间翻三倍',giftName:'鲜花',sender:'测试观众',source:'test',phase:'running',op:'multiply',value:3,before:120,after:360,ts:Date.now()}} })
  await page.waitForFunction(() => document.querySelector('[aria-label="盲盒执行状态"]')?.textContent.includes('排队 2 项'))
  assert.match(await library.innerText(), /120 → 360 秒/)
  await library.getByRole('button', { name: '停止盲盒并清空队列', exact: true }).click()
  await page.waitForFunction(() => window.calls.some(call => call.method === 'cancel'))
  assert.match(await library.innerText(), /排队 0 项/)
  passed('缺失媒体错误、当前事件和队列可见，取消调用正确入口')

  for (const theme of ['arena', 'theatre', 'arcade', 'paper', 'abyss']) {
    await page.getByLabel('时间皮肤', { exact: true }).selectOption(theme)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')).theme), theme)
    await page.getByTestId('time-preview').screenshot({ path: path.join(output, `skin-${theme}.png`) })
    if (theme === 'paper') {
      const shadows = await page.getByTestId('time-preview').locator('[style*="text-shadow"]').evaluateAll(items => items.map(item => getComputedStyle(item).textShadow))
      assert.equal(shadows.length, 4)
      assert.deepEqual([...new Set(shadows)], ['none'])
    }
  }
  passed('5套新皮肤可选择并保存，纸页主题的4处文字无黑色描边')
  await library.getByRole('button', { name: '编辑事件 时间翻三倍', exact: true }).click()
  await library.screenshot({ path: path.join(output, 'event-editor.png') })
  await page.getByTestId('time-gift-row').screenshot({ path: path.join(output, 'gift-pool.png') })
  await page.setViewportSize({ width: 760, height: 940 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await library.screenshot({ path: path.join(output, 'event-editor-760.png') })
  passed('1120/760 宽度截图，760 页面无横向溢出')

  await library.getByRole('button', { name: '删除事件 时间翻三倍', exact: true }).click()
  cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg')))
  assert.equal(cfg.blindBoxEvents.length, 1)
  assert.equal(cfg.gifts[0].blindBoxEventIds.includes(firstId), false)
  await library.getByRole('button', { name: '删除事件 随机减时', exact: true }).click()
  assert.match(await pool.innerText(), /盲盒奖池为空/)
  passed('减号删除事件同步清理绑定，最后一项删除后空奖池报错')
  await page.getByRole('button', { name: '测试加时', exact: true }).click()
  await page.waitForFunction(() => window.calls.some(call => call.method === 'gift' && call.arg === '请吃鸡'))
  passed('默认加时测试也走礼物绑定入口')
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: checks, pageErrors: errors }, null, 2))
  console.log(`time blindbox UI passed: ${checks.length} checks (real React, mocked IPC)`)
  console.log(output)
} finally { await browser.close() }
