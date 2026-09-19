// 真实 React 导入页 + 可控 IPC 等待/失败；检查 busy 期间遮罩、Esc、X 和重复提交。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'pinyou-import')
await fs.mkdir(output, { recursive: true })
const source = `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import Rules from './src/renderer/src/pages/EntertainmentGiftRules';
  import { useToast } from './src/renderer/src/stores/ui';
  const plan = { name: '兼容回归', file: 'fixture.py', rules: [{id:'',giftName:'小心心',actionType:'command',commandCmd:'mobile',commandParam:'fwd|3000'}], notes:[{gift:'连招',text:'已转成顺序敲击'}], skipped:[{gift:'硬件礼物',category:'物理',reason:'需要设备'}], empty:0 };
  window.applyCalls = 0; window.toasts = () => useToast.getState().toasts;
  window.api = {
    entertainmentRulesList: async () => [],
    queueState: async () => ({config:null,open:false,snapshot:{running:null,pending:[]}}), onQueueChanged: () => () => {},
    entertainmentPinyouImport: async () => ({ok:true,plans:[plan,{...plan,name:'第二方案'}]}),
    entertainmentPinyouApply: () => { window.applyCalls++; return new Promise(resolve => window.finishApply = resolve); }
  };
  createRoot(document.getElementById('root')).render(<Rules/>);
`
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@shared': path.join(root, 'src/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setContent('<html><head><meta charset="UTF-8"></head><body><div id="root"></div></body></html>')
  const assets = path.join(root, 'out', 'renderer', 'assets')
  const css = (await fs.readdir(assets)).find(name => name.startsWith('index-') && name.endsWith('.css'))
  if (css) await page.addStyleTag({ content: await fs.readFile(path.join(assets, css), 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: '导入旧软件配置', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /手游动作 自动前进 3秒/)
  await dialog.getByRole('button', { name: '导入 1 条', exact: true }).evaluate(button => { button.click(); button.click() })
  await page.waitForFunction(() => window.applyCalls === 1)
  assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true)
  assert.equal(await dialog.getByRole('combobox').isDisabled(), true)
  assert.equal(await dialog.getByRole('switch').isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.mouse.click(2, 2)
  assert.equal(await dialog.count(), 1)
  await page.screenshot({ path: path.join(output, 'busy-protection.png'), fullPage: true })
  await page.evaluate(() => window.finishApply({ok:true,added:1,removed:2}))
  await dialog.getByRole('status').waitFor()
  assert.match(await dialog.innerText(), /已导入 1 条规则，替换 2 条旧规则，1 条未导入/)
  assert.match(await dialog.innerText(), /硬件礼物.*需要设备/)
  assert.equal(await dialog.getByRole('button', { name: '已导入', exact: true }).isDisabled(), true)
  assert.match(await page.evaluate(() => window.toasts().at(-1).text), /1 条未导入/)
  await page.screenshot({ path: path.join(output, 'result-retained.png'), fullPage: true })
  await dialog.getByRole('combobox').selectOption('1')
  await dialog.getByRole('button', { name: '导入 1 条', exact: true }).click()
  await page.evaluate(() => window.finishApply({ok:false,error:'导入失败：模拟磁盘写满；原规则未改动'}))
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /原规则未改动/)
  assert.equal(await dialog.getByRole('button', { name: '导入 1 条', exact: true }).isEnabled(), true)
  await dialog.getByRole('combobox').selectOption('0')
  assert.equal(await dialog.getByRole('button', { name: '已导入', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS P0-2 UI: busy blocks Esc/backdrop/X/plan/switch; duplicate submit blocked; result+skipped retained; failure visible+retry; completed plan stays disabled')
  console.log(`Screenshots: ${output}`)
} finally { await browser.close() }
