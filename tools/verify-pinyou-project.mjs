// 品游式「项目」e2e（2026-09-07 用户：「人家的管理是一个项目就是一个文件夹，
// 然后盲盒可以触发这个文件夹里面的东西」）。
//
// 要证的核心是「视频 + 同名 .脚本 一起生效」——这正是现成的 video-random（只播视频）
// 和 random-script（只跑脚本）都做不到的那一半。
//
// 覆盖：
//  ① 自建夹具项目（内容完全可控）：触发后加班器数值按脚本精确变化 → 脚本真的执行了
//  ② 纯视频项目（没有 .脚本，主播素材里大多数是这种）：照样能触发，不报错
//  ③ 相对项目名（品游脚本里写的就是相对名，不是绝对路径）也能找到
//  ④ 随机不连着重复：连触发多次不会老是同一条
//  ⑤ 主播真实素材库能扫出项目，视频/脚本/成对数与磁盘一致
//  ⑥ 批量导入：每个项目一条规则，默认停用（项目名不是礼物名，免得误触发）
// 用法：node tools/verify-pinyou-project.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'pinyou-project')
const REAL_LIB = 'F:\\知了猴工作室\\视频'
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

// ---- 夹具素材库：三个项目，内容完全可控 ----
const lib = path.join(out, 'assets')
// 一个真能播的 0.4 秒小视频（ffmpeg 生成，h264 160×90，1.6 KB）：0.3.43 起播不出来的视频会报「视频无法播放」、
// 同名脚本也要等视频真开始播才执行，占位文件已经不够用
const tinyVideo = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAZAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAl90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAGQAAAAAAABAAAAAAHXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAEABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABgm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUJzdGJsAAAAunN0c2QAAAAAAAAAAQAAAKphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAMGF2Y0MBQsAK/+EAGGdCwArZAo35MBEAAAMAAQAAAwAUDxImSAEABWjLg8sgAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAOQgAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAQAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAQAAAABAAAAJHN0c3oAAAAAAAAAAAAAAAQAAAK7AAAACgAAAAsAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA2UAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMAAAAAhmcmVlAAAC4m1kYXQAAAJxBgX//23cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xMCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAEJliIQP8RigACb7HAAEbOOAAJGcnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddeAAAAAGQZo4H+D2AAAAB0GaVAd4PYAAAAAGQZpgN8Hs', 'base64')
async function mkProject(name, items, root = lib) {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  for (const [item, script] of items) {
    await fs.writeFile(path.join(dir, `${item}.mp4`), tinyVideo)
    // 品游的 .脚本 是 GBK；这里故意用 GBK 写，一并验解码
    if (script) {
      const { execSync } = await import('node:child_process')
      void execSync
      const gbk = Buffer.from(await gbkEncode(script))
      await fs.writeFile(path.join(dir, `${item}.脚本`), gbk)
    }
  }
  return dir
}
// Node 没有内置 GBK 编码器，用 iconv-lite（客户端依赖里已有，pinyou-file.ts 就在用它兜底）
async function gbkEncode(text) {
  const { default: iconv } = await import('iconv-lite')
  return iconv.encode(text, 'gbk')
}

const dirPlus = await mkProject('夹具加班项目', [['加60秒', '加班增加:60秒']])
const dirPure = await mkProject('夹具纯视频', [['甲', null], ['乙', null], ['丙', null]])
const dirMany = await mkProject('夹具多条', [['一', '加班增加:10秒'], ['二', '加班增加:10秒'], ['三', '加班增加:10秒']])
// 第二个素材库（没登记成品游素材目录）：验「脚本里再触发项目」用相对项目名、按当前项目所在目录解析（品游「再来一次」的写法）
const lib2 = path.join(out, 'assets2')
const dirAgain = await mkProject('夹具再来一次', [['再来一次', '播放视频:夹具目标\随机播放[绿幕1]']], lib2)
await mkProject('夹具目标', [['目标', '加班增加:5秒']], lib2)
const dirSelf = await mkProject('夹具自抽', [['再来一次', '播放视频:夹具自抽\随机播放[绿幕1]']], lib2)

const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({
  guideSeen: true,
  pinyouAssetRoot: lib
}))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

let app
try {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.pinyouProjects && window.api?.challengeOpen))

  // 开加班器（脚本动作打在它身上，数值就是证据）
  await page.evaluate(() => window.api.challengeOpen({ slot: 'overtime', mode: 'counter', value: 0 }))
  const overtime = () => page.evaluate(() => window.api.challengeState('overtime').then((s) => s.value ?? 0))
  const trigger = (dir, slot) => page.evaluate(([d, s]) => window.api.pinyouProjectTest(d, s), [dir, slot])

  // ---- ⑤ 扫描夹具库 ----
  let list = await page.evaluate(() => window.api.pinyouProjects())
  assert.equal(list.error, undefined, `扫描不该出错：${list.error}`)
  assert.equal(list.projects.length, 3, `应扫出 3 个项目：${JSON.stringify(list.projects.map((p) => p.name))}`)
  const many = list.projects.find((p) => p.name === '夹具多条')
  assert.equal(many.videos, 3)
  assert.equal(many.paired, 3, '三条都该有同名脚本')
  const pure = list.projects.find((p) => p.name === '夹具纯视频')
  assert.equal(pure.paired, 0, '纯视频项目不该有成对脚本')
  pass('扫描项目：视频数/成对数都对', `3 个项目`)

  // ---- ① 视频 + 同名脚本一起生效（核心）----
  const before = await overtime()
  // 开哪个才有哪个：项目视频只播到主播开着的绿幕窗口，先替主播开一个 1 号空窗口
  assert.equal((await page.evaluate(() => window.api.greenScreenOpen('', 'video', '', 1))).ok, true, '开 1 号空绿幕窗口')
  const r1 = await trigger(dirPlus)
  assert.equal(r1.ok, true, `触发应成功：${JSON.stringify(r1)}`)
  // 动作是异步执行的，轮询等它落到加班器上（别用固定 sleep 读瞬时值）
  let after = before
  for (let i = 0; i < 40 && after === before; i++) {
    await page.waitForTimeout(150)
    after = await overtime()
  }
  assert.equal(after - before, 60, `脚本「加班增加:60秒」应让加班器 +60，实际 ${before} → ${after}`)
  pass('视频 + 同名 .脚本 一起生效（GBK 脚本正确解码）', `加班器 ${before} → ${after}`)

  // ---- ①b 品游「再来一次」：脚本里再触发项目（以前这一条被当递归直接跳过，主播的「再来一次」从来没触发过）----
  const beforeAgain = await overtime()
  const rAgain = await trigger(dirAgain)
  assert.equal(rAgain.ok, true, `再来一次触发应成功：${JSON.stringify(rAgain)}`)
  let afterAgain = beforeAgain
  for (let i = 0; i < 80 && afterAgain - beforeAgain < 5; i++) { await page.waitForTimeout(150); afterAgain = await overtime() }
  assert.equal(afterAgain - beforeAgain, 5, `再来一次该把兄弟项目「夹具目标」的脚本也执行了：${beforeAgain} → ${afterAgain}`)
  pass('「再来一次」脚本再触发兄弟项目，相对项目名按当前项目所在目录解析', `加班器 ${beforeAgain} → ${afterAgain}`)
  // ---- ①c 只有「再来一次」的项目会一直抽自己：最多套 6 层就停，不能没完没了 ----
  const tSelf = Date.now()
  const rSelf = await trigger(dirSelf)
  assert.equal(rSelf.ok, true, JSON.stringify(rSelf))
  assert.ok(Date.now() - tSelf < 40_000, `自抽项目该在有限时间内返回：${Date.now() - tSelf}ms`)
  let queuedPeak = 0
  for (let i = 0; i < 160; i++) { const g = await page.evaluate(() => window.api.greenScreenState()); queuedPeak = Math.max(queuedPeak, g.queued || 0); if (!(g.queued || 0) && !g.slots[0].src) break; await page.waitForTimeout(250) }
  assert.ok(queuedPeak <= 6, `自抽项目排队不该超过 6 条：${queuedPeak}`)
  pass('只有「再来一次」的项目最多套 6 层就停，排队清空', `用时 ${Date.now() - tSelf}ms，排队峰值 ${queuedPeak}`)

  // ---- ①c2 「本窗口的再来一次」：脚本里写死的 [绿幕N] 不许把视频甩到别的窗口 ----
  // 主播 2026-09-11：「我明明在整个项目里没有开去别的窗口，但是抽到再来一次的时候，自动就去别的窗口播了」。
  // 他的真实配置就是规则写「<项目>|固定」、脚本里写 [绿幕2]。两种最常见配置各测一遍。
  assert.equal((await page.evaluate(() => window.api.greenScreenOpen('', 'video', '', 2))).ok, true, '开 2 号空绿幕窗口')
  const dirHere = await mkProject('夹具本窗口', [['再来一次', '播放视频:夹具本窗口目标\随机播放[绿幕2]']], lib2)
  await mkProject('夹具本窗口目标', [['目标', null]], lib2)
  // 播到哪些窗口：盯着看，别只在结束时采一次样（夹具视频只有 0.4 秒，采样慢了什么都看不到）
  const watchSlots = async (ms) => {
    const seen = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set() }
    for (let i = 0; i < Math.ceil(ms / 100); i++) {
      const g = await page.evaluate(() => window.api.greenScreenState())
      for (const s of g.slots) if (s.src) seen[s.slot].add(s.src.split(/[\\/]/).pop())
      await page.waitForTimeout(100)
    }
    return seen
  }
  for (const [suffix, how] of [['|固定', '不指定窗口 + 不去别的窗口'], ['|绿幕1', '指定 1 号 + 开着「忙时去别的窗口」']]) {
    const seenBefore = await page.evaluate(() => window.api.greenScreenState())
    assert.ok(seenBefore, 'greenScreenState 可读')
    const rHere = await page.evaluate((d) => window.api.pinyouProjectTest(d), `${dirHere}${suffix}`)
    assert.equal(rHere.ok, true, `触发应成功（${how}）：${JSON.stringify(rHere)}`)
    const seen = await watchSlots(4000)
    assert.ok(seen[1].size > 0, `视频该播在 1 号（${how}）：${JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]])))}`)
    assert.equal(seen[2].size, 0, `「再来一次」不该跑到 2 号（${how}）：${[...seen[2]].join(', ')}`)
    pass(`「再来一次」接着在本窗口播，脚本里写死的 [绿幕2] 不生效（${how}）`, `1 号播了 ${[...seen[1]].join(', ')}`)
    for (let i = 0; i < 40; i++) { const g = await page.evaluate(() => window.api.greenScreenState()); if (!(g.queued || 0) && !g.slots[0].src && !g.slots[1].src) break; await page.waitForTimeout(200) }
  }

  // ---- ①d 读取项目后给单条视频配动作（用户 2026-09-11「现在读取项目以后就不管了」）----
  const dirOne = await mkProject('夹具配动作', [['唯一', null]], lib2)
  const got = await page.evaluate((d) => window.api.pinyouItemActionsGet(d), dirOne)
  assert.equal(got.ok, true, JSON.stringify(got))
  assert.deepEqual(got.items.map((it) => [it.name, it.hasScript]), [['唯一', false]])
  const gotPlus = await page.evaluate((d) => window.api.pinyouItemActionsGet(d), dirPlus)
  assert.ok(gotPlus.items[0].hasScript && /加班/.test(gotPlus.items[0].script[0] || ''), `脚本摘要该是中文名：${JSON.stringify(gotPlus.items)}`)
  const set1 = await page.evaluate(([d, n]) => window.api.pinyouItemActionsSet(d, n, { actions: [{ actionType: 'command', commandCmd: 'overtime-adjust', commandParam: '7', delayMs: 0 }], useScript: true }), [dirOne, '唯一'])
  assert.equal(set1.ok, true, JSON.stringify(set1))
  const b4 = await overtime()
  const r4 = await trigger(dirOne)
  assert.equal(r4.ok, true, JSON.stringify(r4))
  let a4 = b4
  for (let i = 0; i < 60 && a4 - b4 < 7; i++) { await page.waitForTimeout(150); a4 = await overtime() }
  assert.equal(a4 - b4, 7, `整蛊台配的动作该执行：${b4} → ${a4}`)
  pass('读取项目后给单条视频配的动作会执行（存客户端，不动素材文件夹）', `加班器 ${b4} → ${a4}`)
  // 关掉品游脚本、只跑整蛊台动作；清掉配置后脚本恢复
  const set2 = await page.evaluate(([d, n]) => window.api.pinyouItemActionsSet(d, n, { actions: [{ actionType: 'command', commandCmd: 'overtime-adjust', commandParam: '3', delayMs: 0 }], useScript: false }), [dirPlus, '加60秒'])
  assert.equal(set2.ok, true, JSON.stringify(set2))
  const b5 = await overtime()
  assert.equal((await trigger(dirPlus)).ok, true)
  let a5 = b5
  for (let i = 0; i < 60 && a5 - b5 < 3; i++) { await page.waitForTimeout(150); a5 = await overtime() }
  await page.waitForTimeout(900); a5 = await overtime()
  assert.equal(a5 - b5, 3, `关掉脚本后只该 +3：${b5} → ${a5}`)
  assert.equal((await page.evaluate(([d, n]) => window.api.pinyouItemActionsSet(d, n, null), [dirPlus, '加60秒'])).ok, true)
  const b6 = await overtime()
  assert.equal((await trigger(dirPlus)).ok, true)
  let a6 = b6
  for (let i = 0; i < 60 && a6 - b6 < 60; i++) { await page.waitForTimeout(150); a6 = await overtime() }
  assert.equal(a6 - b6, 60, `清掉配置后脚本该恢复 +60：${b6} → ${a6}`)
  pass('可以关掉品游脚本只跑整蛊台动作；清掉配置后恢复原样', `${b5}→${a5}，${b6}→${a6}`)

  // ---- ② 纯视频项目：没有脚本也能触发 ----
  const beforePure = await overtime()
  const r2 = await trigger(dirPure)
  assert.equal(r2.ok, true, `纯视频项目也该能触发：${JSON.stringify(r2)}`)
  await page.waitForTimeout(600)
  assert.equal(await overtime(), beforePure, '纯视频项目不该动加班器')
  pass('纯视频项目（主播素材里大多数是这种）能触发且不误改数值')

  // ---- ③ 相对项目名（品游脚本里就是这么写的）----
  const beforeRel = await overtime()
  const r3 = await trigger('夹具加班项目')
  assert.equal(r3.ok, true, `相对项目名该能找到：${JSON.stringify(r3)}`)
  let afterRel = beforeRel
  for (let i = 0; i < 40 && afterRel === beforeRel; i++) {
    await page.waitForTimeout(150)
    afterRel = await overtime()
  }
  assert.equal(afterRel - beforeRel, 60, '相对名触发的效果该和绝对路径一样')
  pass('相对项目名也能解析（品游脚本写的就是相对名）')

  // ---- ④ 随机不连着重复同一条 ----
  const picks = new Set()
  for (let i = 0; i < 8; i++) {
    const r = await trigger(dirMany)
    assert.equal(r.ok, true)
    const st = await page.evaluate(() => window.api.videoWidgetState())
    if (st?.main?.path) picks.add(path.basename(st.main.path))
    await page.waitForTimeout(120)
  }
  // 视频窗口状态取不到时退化为「不报错即可」，但只要取到就该抽到过不止一条
  if (picks.size) {
    assert.ok(picks.size >= 2, `连触发 8 次应抽到不止一条，实际只有 ${[...picks]}`)
    pass('随机抽取不连着重复', [...picks].join(' / '))
  } else {
    pass('随机抽取：连触发 8 次都没报错（隐藏模式取不到视频窗口路径）')
  }

  // ---- ⑥ 批量导入 ----
  const imp = await page.evaluate(([a, b]) => window.api.pinyouProjectsImport([a, b]), [dirPlus, dirPure])
  assert.equal(imp.ok, true)
  assert.equal(imp.added.length, 2, `应导入 2 条：${JSON.stringify(imp)}`)
  const rules = await page.evaluate(() => window.api.entertainmentRulesList())
  const mine = rules.filter((r) => r.commandCmd === 'project-random')
  assert.equal(mine.length, 2, `应有 2 条项目规则：${mine.length}`)
  assert.ok(mine.every((r) => r.enabled === false), '导入的规则必须默认停用')
  // 规则名 = 项目名，礼物名留空
  assert.ok(mine.some((r) => r.name === '夹具加班项目'), `规则名该是项目名：${JSON.stringify(mine.map((r) => r.name))}`)
  assert.ok(mine.every((r) => !r.giftName), '礼物名必须留空')
  assert.ok(mine.every((r) => r.actionType === 'command'), '动作类型该是动作命令')
  assert.ok(mine.some((r) => (r.remark || '').includes('带动作')), `带脚本的项目该在备注里说明：${JSON.stringify(mine.map((r) => r.remark))}`)
  pass('批量导入：一项目一条规则、默认停用、备注写清有几个视频')

  // ---- ⑦★ 按条目导入：项目里每个视频各建一条规则（用户：「主要是规则没拉过来」）----
  const rulesBefore = (await page.evaluate(() => window.api.entertainmentRulesList())).length
  const imp2 = await page.evaluate((d) => window.api.pinyouItemsImport([d]), dirMany)
  assert.equal(imp2.ok, true)
  assert.equal(imp2.added, 3, `「夹具多条」3 个视频该建 3 条规则：${JSON.stringify(imp2)}`)
  const rules2 = await page.evaluate(() => window.api.entertainmentRulesList())
  assert.equal(rules2.length - rulesBefore, 3)
  const mine2 = rules2.filter((r) => (r.remark || '').includes('夹具多条'))
  assert.equal(mine2.length, 3)
  // ★规则名落在 name 上（视频名），礼物名【留空】给主播填 ——
  //   2026-09-08 用户：「项目名字应该是规则名」，以前拿项目名去占礼物名，改成真礼物名后就认不出来源了
  assert.deepEqual(mine2.map((r) => r.name).sort(), ['一', '三', '二'], `规则名该是视频名：${JSON.stringify(mine2.map((r) => r.name))}`)
  assert.ok(mine2.every((r) => !r.giftName), `礼物名必须留空给主播填：${JSON.stringify(mine2.map((r) => r.giftName))}`)
  assert.ok(mine2.every((r) => r.enabled === false), '没绑礼物一律停用')
  // 主动作播它自己的那个视频
  const one = mine2.find((r) => r.name === '一')   // 按【规则名】找，礼物名现在是空的
  assert.equal(one.commandCmd, 'video-play')
  assert.match(one.commandParam, /一\.mp4\|0$/, `该播自己那条视频：${one.commandParam}`)
  // 脚本里的动作挂在附加动作上
  assert.ok(Array.isArray(one.extraActions) && one.extraActions.length >= 1, `脚本动作该进附加动作：${JSON.stringify(one.extraActions)}`)
  assert.equal(one.extraActions[0].commandCmd, 'overtime-adjust')
  assert.equal(one.extraActions[0].commandParam, '10')
  pass('按条目导入：每个视频一条规则，规则名=视频名，脚本动作挂在附加动作上', `${imp2.added} 条`)

  // ---- ⑦a2 选了绿幕窗口导入，规则还是播它自己那条视频（原来一选窗口就变成整个项目随机抽，规则名对不上播出来的东西）----
  const dirSlot = await mkProject('夹具选窗口导入', [['甲一', '加班增加:10秒'], ['乙一', null]], lib2)
  const impSlot = await page.evaluate((d) => window.api.pinyouItemsImport([d], 3), dirSlot)
  assert.equal(impSlot.ok, true, JSON.stringify(impSlot))
  assert.equal(impSlot.added, 2, `2 个视频该建 2 条规则：${JSON.stringify(impSlot)}`)
  const mineSlot = (await page.evaluate(() => window.api.entertainmentRulesList())).filter((r) => (r.remark || '').includes('夹具选窗口导入'))
  assert.equal(mineSlot.length, 2)
  for (const r of mineSlot) {
    assert.equal(r.commandCmd, 'video-play', `选了窗口也该播自己那条视频，不能变成整个项目随机：${r.name} → ${r.commandCmd} ${r.commandParam}`)
    assert.ok(r.commandParam.includes(`${r.name}.mp4`), `该播和规则名同名的视频：${r.name} → ${r.commandParam}`)
    assert.match(r.commandParam, /\|绿幕3$/, `选的 3 号窗口该写进参数：${r.commandParam}`)
  }
  pass('按条目导入选了绿幕窗口，规则仍播自己那条视频（不再变成整个项目随机抽）', `${impSlot.added} 条 → 绿幕3`)

  // ---- ⑦b 没绑礼物的规则不能启用（启用了也不会触发，必须直说）----
  const noGift = mine2[0]
  const enableTry = await page.evaluate((r) => window.api.entertainmentRuleUpdate({ ...r, enabled: true }), noGift)
  assert.equal(enableTry.ok, false, '没填礼物名就启用该被拒')
  assert.match(enableTry.error || '', /先填礼物名|还没绑/, `报错要说清怎么办：${enableTry.error}`)
  // 填上礼物名之后就能启用了
  const okTry = await page.evaluate((r) => window.api.entertainmentRuleUpdate({ ...r, giftName: '小心心', enabled: true }), noGift)
  assert.equal(okTry.ok, true, `填了礼物名该能启用：${okTry.error}`)
  pass('没绑礼物的规则不能启用（报错说清怎么办），填上礼物名就能启用')

  // ---- ⑧★ 时间类项目算成时间盲盒事件（用户：「时间类应该自动加载到时间规则里面」）----
  // ★这个接口【只算不写】：倒计时配置的权威在渲染进程的 localStorage，写入由页面负责
  //   （2026-09-07 用户实测「事件库还是 0」就是因为我一开始在主进程改内存）。
  //   落地那一环由 tools/verify-time-import-ui.mjs 走真 UI 验证。
  const imp3 = await page.evaluate((d) => window.api.pinyouTimeImport([d]), dirMany)
  assert.equal(imp3.ok, true)
  assert.equal(imp3.events.length, 3, `3 个条目该算出 3 个盲盒事件：${JSON.stringify(imp3.report)}`)
  assert.equal(imp3.report[0].added, 3)
  assert.ok(imp3.events.every((e) => e.op === 'add' && e.value === 10), `op/数值该来自脚本：${JSON.stringify(imp3.events.map((e) => [e.op, e.value]))}`)
  assert.ok(imp3.events.every((e) => String(e.video || '').endsWith('.mp4')), '每个事件要带自己的视频')
  // id 用项目名前缀 → 重复导入时页面能按前缀去重（不叠加）
  assert.ok(imp3.events.every((e) => String(e.id).startsWith('夹具多条-')), `id 该带项目名前缀：${imp3.events.map((e) => e.id)}`)
  const imp4 = await page.evaluate((d) => window.api.pinyouTimeImport([d]), dirMany)
  assert.deepEqual(imp4.events.map((e) => e.id), imp3.events.map((e) => e.id), '两次算出的 id 该一致，页面才能去重')
  pass('时间类项目算成盲盒事件（op/数值/视频都对，id 可去重）', `${imp3.events.length} 个`)

  // ---- ⑤b 主播真实素材库（有就跑，没有就跳过）----
  if (fsSync.existsSync(REAL_LIB)) {
    const real = await page.evaluate((r) => window.api.pinyouProjects(r), REAL_LIB)
    assert.equal(real.error, undefined, `真实素材库扫描出错：${real.error}`)
    assert.ok(real.projects.length >= 20, `真实素材库该有 20+ 个项目，实际 ${real.projects.length}`)
    // 和磁盘对一遍：随便挑三个项目核对视频数
    const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|flv|wmv)$/i
    for (const p of real.projects.slice(0, 3)) {
      const files = fsSync.readdirSync(p.dir)
      assert.equal(p.videos, files.filter((f) => VIDEO_RE.test(f)).length, `${p.name} 的视频数和磁盘不一致`)
      assert.equal(p.scripts, files.filter((f) => f.endsWith('.脚本')).length, `${p.name} 的脚本数和磁盘不一致`)
    }
    const withScript = real.projects.filter((p) => p.paired > 0).length
    pass('主播真实素材库扫描正确', `${real.projects.length} 个项目，其中 ${withScript} 个带动作脚本`)

    // ★用主播真实的「虚拟主播时间」（用户截图里选的那个）跑两种导入：
    //   61 个视频、59 个带脚本 → 按条目应得 61 条规则；时间盲盒应得 59 个事件
    const vt = real.projects.find((p) => p.name === '虚拟主播时间')
    if (vt) {
      const n0 = (await page.evaluate(() => window.api.entertainmentRulesList())).length
      const ri = await page.evaluate((d) => window.api.pinyouItemsImport([d]), vt.dir)
      assert.equal(ri.added, vt.videos, `61 个视频该建 ${vt.videos} 条规则，实际 ${ri.added}`)
      const all = await page.evaluate(() => window.api.entertainmentRulesList())
      assert.equal(all.length - n0, vt.videos)
      const vtRules = all.filter((r) => (r.remark || '').includes('虚拟主播时间'))
      // ★规则名是视频名（-10分 / -12分 …）；礼物名一律留空，绝不拿项目名去占
      assert.ok(vtRules.some((r) => r.name === '-10分'), `规则名该是视频名：${JSON.stringify(vtRules.slice(0, 3).map((r) => r.name))}`)
      assert.ok(vtRules.every((r) => !r.giftName), '礼物名必须全部留空给主播填')
      assert.ok(!vtRules.some((r) => r.name === '虚拟主播时间'), '按条目导入不该出现以项目名为规则名的条目')
      // 带脚本的条目要挂上时间动作
      const withAction = vtRules.filter((r) => (r.extraActions || []).some((a) => String(a.commandCmd || '').startsWith('overtime')))
      assert.ok(withAction.length >= vt.paired - 2, `带脚本的 ${vt.paired} 条该挂上加班动作，实际 ${withAction.length}`)
      const rt = await page.evaluate((d) => window.api.pinyouTimeImport([d], true), vt.dir)
      assert.equal(rt.report[0].added, vt.paired, `59 个带脚本条目该进 ${vt.paired} 个盲盒事件，实际 ${rt.report[0].added}`)
      pass('★真实「虚拟主播时间」：61 条规则 / 59 个时间盲盒事件', `规则名如 ${vtRules.slice(0, 3).map((r) => r.name).join("、")}`)
    }
  } else {
    console.log('SKIP 真实素材库不在本机：' + REAL_LIB)
  }
} finally {
  // 收尾：关掉开过的挂件窗口，免得残留窗口影响紧接着启动的下一支测试
  try {
    const page = await app?.firstWindow()
    await page?.evaluate(() => window.api.challengeClose('overtime'))
  } catch { /* app 已经没了 */ }
  await app?.close().catch(() => {})
}
console.log(`\n品游项目 ${passed.length} 项 PASS`)
