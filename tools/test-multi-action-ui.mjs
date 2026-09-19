// 礼物规则「一条规则多个动作」页面回归：真实 React 页面 + 假 window.api，用 Edge 无头跑。
// 覆盖：新增规则里「添加动作」出现第二/第三个动作编辑器；先等几秒按毫秒落到 extraActions；
//       保存后列表显示「+N 动作」和「→」串起来的摘要；▶ 测试触发按顺序执行且等够延迟；编辑时删掉附加动作后 update 带空数组。
// 用法：node tools/test-multi-action-ui.mjs（先 npm run build 出 out/renderer 的样式）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'multi-action')
await fs.mkdir(output, { recursive: true })

const source = `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import Rules from './src/renderer/src/pages/EntertainmentGiftRules';
  window.rules = []; window.calls = []; window.updates = [];
  const now = () => Math.round(performance.now());
  window.api = {
    entertainmentRulesList: async () => window.rules.map((r) => ({ ...r })),
    entertainmentRuleAdd: async (r) => { const id = 'r' + (window.rules.length + 1); window.rules.push({ ...r, id }); return { ok: true, id } },
    entertainmentRuleUpdate: async (r) => { window.updates.push(r); const i = window.rules.findIndex((x) => x.id === r.id); if (i >= 0) window.rules[i] = { ...window.rules[i], ...r }; return { ok: true } },
    entertainmentRuleRemove: async (id) => { window.rules = window.rules.filter((x) => x.id !== id); return { ok: true } },
    entertainmentCommand: async (cmd, param) => { window.calls.push({ kind: 'command', cmd, param, t: now() }); return { ok: true } },
    entertainmentSendKeys: async (seq) => { window.calls.push({ kind: 'keys', seq, t: now() }); return { ok: true } },
    entertainmentSystemAction: async (cmd, param) => { window.calls.push({ kind: 'system', cmd, param, t: now() }); return { ok: true } },
    queueState: async () => ({ config: null, open: false, snapshot: { running: null, pending: [] } }), onQueueChanged: () => () => {},
    obsState: async () => ({ connection: { connected: false }, filters: [], scenes: { scenes: [] } }),
    selectFile: async () => ({ ok: false }),
    entertainmentPinyouImport: async () => ({ ok: false, canceled: true })
  };
  createRoot(document.getElementById('root')).render(<Rules/>);
`
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@shared': path.join(root, 'src/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<html><head><meta charset="UTF-8"></head><body><div id="root"></div></body></html>')
  const assets = path.join(root, 'out', 'renderer', 'assets')
  const css = (await fs.readdir(assets)).find((name) => name.startsWith('index-') && name.endsWith('.css'))
  if (css) await page.addStyleTag({ content: await fs.readFile(path.join(assets, css), 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  // ---- 1. 新增规则：主动作 + 两个附加动作 ----
  await page.getByRole('button', { name: /新增规则/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByPlaceholder('如：火箭 / 小心心').fill('火箭')
  const a0 = dialog.getByTestId('action-0')
  await a0.getByRole('button', { name: '动作命令', exact: true }).click()
  await a0.getByPlaceholder('30').fill('5') // 倒计时加减 5 秒
  assert.equal(await dialog.getByTestId('action-1').count(), 0, '还没点添加动作就有了第二个动作')
  await dialog.getByRole('button', { name: /添加动作/ }).click()
  const a1 = dialog.getByTestId('action-1')
  await a1.waitFor()
  await a1.getByPlaceholder('{F1} / {ENTER} / ^s').fill('{F1}')
  await a1.getByLabel('先等几秒').fill('0.3')
  await dialog.getByRole('button', { name: /添加动作/ }).click()
  const a2 = dialog.getByTestId('action-2')
  await a2.waitFor()
  await a2.getByRole('button', { name: '动作命令', exact: true }).click()
  await a2.getByPlaceholder('30').fill('7')
  // 每个动作「高亮的动作类型」必须和它下面渲染的字段一致（三个编辑器共用一个组件，串了就全乱）
  const segments = await page.evaluate(() => {
    const names = ['键鼠按键', '执行脚本', '播放音效', '系统动作', '动作命令', 'OBS']
    const fieldOf = { 键鼠按键: '按键序列', 执行脚本: '脚本 / 程序路径', 播放音效: '音效文件', 系统动作: '系统动作', 动作命令: '动作命令', OBS: 'OBS 动作' }
    return [0, 1, 2].map((i) => {
      const el = document.querySelector(`[data-testid="action-${i}"]`)
      const on = [...el.querySelectorAll('button')].filter((b) => names.includes(b.textContent.trim()) && b.className.includes('accent-soft')).map((b) => b.textContent.trim())
      const text = el.innerText
      return { i, on, fieldShown: on.length === 1 && text.includes(fieldOf[on[0]]) }
    })
  })
  assert.deepEqual(segments.map((s) => s.on), [['动作命令'], ['键鼠按键'], ['动作命令']], `动作类型高亮不对：${JSON.stringify(segments)}`)
  assert.ok(segments.every((s) => s.fieldShown), `高亮的动作类型和下面渲染的字段对不上：${JSON.stringify(segments)}`)
  await page.screenshot({ path: path.join(output, 'editor-three-actions.png'), fullPage: true })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => window.rules.length === 1)
  const saved = await page.evaluate(() => window.rules[0])
  assert.equal(saved.actionType, 'command')
  assert.equal(saved.commandCmd, 'countdown-adjust')
  assert.equal(saved.commandParam, '5')
  assert.equal(saved.extraActions?.length, 2, `附加动作没存进规则：${JSON.stringify(saved)}`)
  assert.deepEqual({ t: saved.extraActions[0].actionType, k: saved.extraActions[0].keySeq, d: saved.extraActions[0].delayMs }, { t: 'key', k: '{F1}', d: 300 })
  assert.deepEqual({ t: saved.extraActions[1].actionType, c: saved.extraActions[1].commandCmd, p: saved.extraActions[1].commandParam, d: saved.extraActions[1].delayMs }, { t: 'command', c: 'countdown-adjust', p: '7', d: 0 })

  // ---- 2. 列表：+2 动作 + 摘要用 → 串起来 ----
  await page.locator('.ent-extra-count').waitFor()
  assert.equal((await page.locator('.ent-extra-count').innerText()).trim(), '+2 动作')
  const summary = await page.locator('.ent-extra-count').locator('xpath=../..').innerText()
  assert.match(summary, /倒计时加减 5 → 按键 \{F1\} → 倒计时加减 7/, `列表摘要不对：${summary}`)
  await page.screenshot({ path: path.join(output, 'list-multi.png'), fullPage: true })

  // ---- 3. ▶ 测试触发：三个动作按顺序，第二个等够 300ms ----
  await page.getByTitle('测试触发').click()
  await page.waitForFunction(() => window.calls.length === 3, null, { timeout: 5000 })
  const calls = await page.evaluate(() => window.calls)
  assert.deepEqual(calls.map((c) => c.kind), ['command', 'keys', 'command'])
  assert.equal(calls[0].param, '5')
  assert.equal(calls[1].seq, '{F1}')
  assert.equal(calls[2].param, '7')
  assert.ok(calls[1].t - calls[0].t >= 280, `第二个动作没等够 0.3 秒：${calls[1].t - calls[0].t}ms`)
  assert.ok(calls[2].t - calls[1].t < 200, `第三个动作（先等 0）不该等：${calls[2].t - calls[1].t}ms`)

  // ---- 4. 编辑：删掉动作 2，再上移/下移不越界，保存后 update 只剩一个附加动作 ----
  await page.getByTitle('编辑').click()
  await dialog.waitFor()
  assert.equal(await dialog.getByTestId('action-2').count(), 1, '编辑时没把两个附加动作都显示出来')
  await dialog.getByTestId('action-1').getByTitle('删除这个动作').click()
  assert.equal(await dialog.getByTestId('action-2').count(), 0)
  assert.equal(await dialog.getByTestId('action-1').getByPlaceholder('30').inputValue(), '7', '删掉动作 2 之后动作 3 应该顶上来')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => window.updates.length === 1)
  const updated = await page.evaluate(() => window.updates[0])
  assert.equal(updated.extraActions.length, 1)
  assert.equal(updated.extraActions[0].commandParam, '7')
  assert.equal((await page.locator('.ent-extra-count').innerText()).trim(), '+1 动作')

  // ---- 5. 老规则（没有 extraActions 字段）照常显示，不出「+N 动作」 ----
  // 直接塞进假后端，再借一次「编辑→保存」触发列表重新拉取
  await page.evaluate(() => { window.rules.push({ id: 'old', giftName: '玫瑰', actionType: 'key', keySeq: '{F2}', enabled: true }) })
  await page.getByTitle('编辑').first().click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('玫瑰'))
  assert.equal(await page.locator('.ent-extra-count').count(), 1, '老规则不该显示附加动作数')
  assert.match(await page.locator('text=玫瑰').first().locator('xpath=../..').innerText(), /按键 \{F2\}/)

  // ---- 6. 动作类型的下拉默认值要真的存进去（选「动作命令」不碰下拉框直接保存也能执行）----
  await page.getByRole('button', { name: /新增规则/ }).first().click()
  await dialog.waitFor()
  await dialog.getByPlaceholder('如：火箭 / 小心心').fill('默认命令')
  await dialog.getByTestId('action-0').getByRole('button', { name: '动作命令', exact: true }).click()
  await dialog.getByTestId('action-0').getByPlaceholder('30').fill('4')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => window.rules.some((r) => r.giftName === '默认命令'))
  const defaulted = await page.evaluate(() => window.rules.find((r) => r.giftName === '默认命令'))
  assert.equal(defaulted.commandCmd, 'countdown-adjust', '没碰下拉框时界面显示的默认命令没存进规则')

  assert.deepEqual(errors, [], `页面错误：${errors.join(' | ')}`)
  console.log('PASS 多动作规则 UI：添加/删除动作、延迟按毫秒保存、列表 +N 动作与 → 摘要、测试触发按顺序等延迟、老规则兼容')
  console.log(`Screenshots: ${output}`)
} finally {
  await browser.close()
}
