// 使用真实文件系统故障注入；唯一替身是 Electron userData，绝不写主播配置。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiliao-pinyou-'))
const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
try {
  const bundled = path.join(temporary, 'pinyou.cjs')
  await build({
    stdin: { contents: "export * from './src/main/pinyou-rules'; export * from './src/main/pinyou-file'; export * from './src/main/pinyou-import'; export * from './src/main/db'", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundled,
    plugins: [{ name: 'isolated-userdata', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(temporary)} }; export const BrowserWindow = { getFocusedWindow: () => null, getAllWindows: () => [] }; export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }` }))
    } }]
  })
  const { applyPinyouRules, readJson, writeJson, filePath, parsePinyouFile, decodeText, findAssetRoots, locatePinyouInstall } = require(bundled)
  const old = [
    { id: 'old-gift', giftName: ' ＡＢＣ  ', actionType: 'key', keySeq: 'a' },
    { id: 'old-comment', giftName: 'abc', triggerType: 'comment', actionType: 'key', keySeq: 'b' },
    { id: 'unrelated', giftName: '火箭', actionType: 'key', keySeq: 'c' }
  ]
  const incoming = [{ id: '', giftName: 'abc', actionType: 'key', keySeq: 'm' }]
  writeJson('entertainment_rules', old)
  let result = applyPinyouRules(incoming, true)
  assert.equal(result.ok, true)
  assert.deepEqual(result.removedIds, ['old-gift'])
  assert.deepEqual(readJson('entertainment_rules', []).map(r => r.giftName), ['abc', '火箭', 'abc'])
  const after = fs.readFileSync(filePath('entertainment_rules'), 'utf8')
  const rename = fs.renameSync
  try {
    fs.renameSync = () => { throw new Error('模拟磁盘拒绝替换') }
    result = applyPinyouRules(incoming, true)
    assert.equal(result.ok, false)
    assert.match(result.error, /模拟磁盘拒绝替换.*原规则未改动/)
    assert.equal(fs.readFileSync(filePath('entertainment_rules'), 'utf8'), after)
    assert.equal(fs.readdirSync(path.join(temporary, 'data')).filter(p => p.endsWith('.tmp')).length, 0)
  } finally { fs.renameSync = rename }
  result = applyPinyouRules([...incoming, { ...incoming[0], giftName: '' }], true)
  assert.equal(result.ok, false)
  assert.equal(fs.readFileSync(filePath('entertainment_rules'), 'utf8'), after)
  const write = fs.writeFileSync
  try {
    fs.writeFileSync = (target, ...args) => {
      if (String(target).endsWith('.tmp')) { write(target, '{ partial'); throw new Error('模拟磁盘写满') }
      return write(target, ...args)
    }
    result = applyPinyouRules(incoming, true)
    assert.equal(result.ok, false)
    assert.equal(fs.readFileSync(filePath('entertainment_rules'), 'utf8'), after)
    assert.equal(fs.readdirSync(path.join(temporary, 'data')).filter(p => p.endsWith('.tmp')).length, 0)
  } finally { fs.writeFileSync = write }
  result = applyPinyouRules(Array.from({ length: 1000 }, () => incoming[0]), false)
  assert.equal(result.added, 1000)
  assert.equal(result.removed, 0)
  const appended = readJson('entertainment_rules', []).slice(3)
  assert.equal(new Set(appended.map(r => r.id)).size, 1000)
  assert.ok(appended.every(r => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(r.id)))
  fs.writeFileSync(filePath('entertainment_rules'), '{bad original')
  assert.equal(applyPinyouRules(incoming, true).ok, false)
  assert.equal(fs.readFileSync(filePath('entertainment_rules'), 'utf8'), '{bad original')
  const file = path.join(temporary, '品游配置_多方案.py')
  const table = { 小心心: { 动作: { 执行功能: '正常按键', 功能代码: 'M' } } }
  fs.writeFileSync(file, `残缺 { ${JSON.stringify({ 一: table, 二: table, 全局设置: { 视频: { 视频文件: '背景.mp4' } } })}`)
  const parsed = parsePinyouFile(file)
  assert.deepEqual(parsed.plans.map(p => p.name), ['多方案', '多方案（2）'])
  assert.ok(parsed.plans.every(p => p.rules.length === 1))
  // 单引号 Python 字面量写法（某些版本直接 print 出来的配置）：整段没有双引号时保守转成 JSON 再认
  const pyFile = path.join(temporary, '品游配置_单引号.py')
  fs.writeFileSync(pyFile, "礼物表 = {'小心心': {'动作': {'执行功能': '正常按键', '功能代码': 'M', '执行倍数': True}}, '设置': {'x': None}}")
  const pyParsed = parsePinyouFile(pyFile)
  assert.equal(pyParsed.plans.length, 1, '单引号 Python 字面量没认出来')
  assert.equal(pyParsed.plans[0].rules.length, 1)
  assert.equal(pyParsed.plans[0].rules[0].keySeq, 'm')
  console.log('PASS P0-2 storage: atomic replace / NFKC+case match / separate trigger / write+rename failure keeps originals / invalid rule+corrupt source rejected / append 1000 UUIDs / multi-plan file')

  // ===== 2026-09-06 二审：解码 / 认品游目录 / 三份真实内置方案（GBK + 尾部垃圾）=====
  const gbkBytes = Buffer.from([0xd0, 0xa1, 0xd0, 0xc4, 0xd0, 0xc4]) // 「小心心」的 GBK
  assert.equal(decodeText(gbkBytes), '小心心')
  assert.equal(decodeText(Buffer.from('合法 UTF-8 里本来就有 \uFFFD 替换字符', 'utf8')), '合法 UTF-8 里本来就有 \uFFFD 替换字符')
  assert.equal(decodeText(Buffer.from('{"无BOM":"UTF-16LE"}', 'utf16le')), '{"无BOM":"UTF-16LE"}')
  const be = Buffer.from('{"有BOM":"UTF-16BE"}', 'utf16le'); be.swap16()
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), '{"有BOM":"UTF-16BE"}')
  // 目录识别：安装目录（配置在子目录里，往上一层有 音效/视频/脚本）
  const install = path.join(temporary, '娱乐助手Pro')
  for (const d of ['音效', '视频\\绿幕', '视频\\盲盒', '脚本', '配置']) fs.mkdirSync(path.join(install, d), { recursive: true })
  fs.writeFileSync(path.join(install, '娱乐助手Pro9.71.exe'), '')
  const fixtures = path.join(root, 'tools', 'fixtures', 'pinyou')
  for (const name of fs.readdirSync(fixtures).filter(n => n.endsWith('.py'))) fs.copyFileSync(path.join(fixtures, name), path.join(install, '配置', name))
  fs.writeFileSync(path.join(install, '脚本', '木鱼狗.脚本'), Buffer.from(new TextDecoder().decode(Buffer.from('正常按键:F10,1次\r\n延迟时间:0.3秒\r\n键盘弹起:Shift\r\n')), 'utf8'))
  fs.writeFileSync(path.join(install, '音效', '小女孩挖呀挖.mp3'), '')
  fs.writeFileSync(path.join(install, '视频', '绿幕', '木鱼狗.mp4'), '')
  const wukong = parsePinyouFile(path.join(install, '配置', '品游配置_黑神话悟空2.py'))
  assert.equal(wukong.root, install)
  assert.equal(wukong.plans.length, 1)
  const plan = wukong.plans[0]
  assert.equal(plan.name, '黑神话悟空2')
  const byGift = (g) => plan.rules.filter(r => r.giftName === g)
  assert.equal(byGift('抖音')[0]?.soundPath, path.join(install, '音效', '小女孩挖呀挖.mp3'))
  assert.equal(byGift('加油鸭').find(r => r.commandCmd === 'video-play')?.commandParam, path.join(install, '视频', '绿幕', '木鱼狗.mp4') + '|0.9')
  assert.equal(byGift('加油鸭').find(r => r.commandCmd === 'script-sequence')?.commandParam, JSON.stringify([{ cmd: 'key-sequence', param: '{F10}' }, { cmd: 'delay', param: '300' }, { cmd: 'key-up', param: 'SHIFT' }]))
  assert.equal(byGift('你最好看').find(r => r.commandCmd === 'mobile')?.commandParam, 'back|3000')
  assert.equal(byGift('你最好看').find(r => r.commandCmd === 'video-random')?.commandParam, path.join(install, '视频', '平底锅'))
  const like = plan.rules.find(r => r.triggerType === 'like')
  assert.equal(like?.times, 1000)
  assert.equal(like?.commandCmd, 'script-sequence')
  assert.ok(plan.notes.some(n => n.gift === '你最好看' && /平底锅/.test(n.text)), '不存在的随机视频目录要提示')
  assert.ok(plan.notes.some(n => n.gift === '荧光棒' && /蹦迪\.MP3/.test(n.text)), '不存在的音效要提示')
  assert.ok(!plan.notes.some(n => n.gift === '抖音'), '存在的音效不该提示')
  assert.ok(plan.rules.every(r => !r.soundPath || r.soundPath.startsWith(install)), '所有音效都指向品游目录')
  const pubg = parsePinyouFile(path.join(install, '配置', '品游配置_和平精英远控1.py')).plans[0]
  assert.equal(pubg.empty, 3)
  assert.equal(pubg.rules.find(r => r.giftName === '比心兔兔')?.queueMode, 'jump')
  assert.equal(pubg.rules.find(r => r.giftName === '热气球')?.queueMode, 'jump')
  assert.equal(pubg.rules.find(r => r.giftName === '礼花筒')?.priority, 3)
  assert.equal(pubg.rules.find(r => r.giftName === '加油鸭' && r.commandCmd === 'mobile')?.commandParam, 'turn|1000')
  assert.ok(pubg.rules.some(r => r.giftName === '加油鸭' && r.actionType === 'sound'))
  const keys = parsePinyouFile(path.join(install, '配置', '品游配置_悟空按键.py')).plans[0]
  const follow = keys.rules.filter(r => r.triggerType === 'follow')
  assert.equal(follow.find(r => r.actionType === 'key')?.keySeq, 'm')
  assert.ok(follow.some(r => r.actionType === 'sound'))
  assert.equal(keys.rules.find(r => r.giftName === '加油鸭' && r.actionType === 'key')?.keySeq, '{F3}')
  assert.equal(keys.skipped.length, 0)
  // 导出配置旁边的「品游素材_<方案>」优先
  const exported = path.join(temporary, '导出')
  fs.mkdirSync(path.join(exported, '品游素材_黑神话悟空2', '音效'), { recursive: true })
  fs.mkdirSync(path.join(exported, '视频'), { recursive: true }) // 同级还有个无关的「视频」目录也不该抢
  fs.copyFileSync(path.join(fixtures, '品游配置_黑神话悟空2.py'), path.join(exported, '品游配置_黑神话悟空2.py'))
  assert.equal(parsePinyouFile(path.join(exported, '品游配置_黑神话悟空2.py')).root, path.join(exported, '品游素材_黑神话悟空2'))
  // 主播自己的 D:\视频\ 不能被当成品游：上层目录只有一个素材名目录 → 不认
  const streamer = path.join(temporary, '主播')
  fs.mkdirSync(path.join(streamer, '视频'), { recursive: true })
  fs.mkdirSync(path.join(streamer, '下载', '深'), { recursive: true })
  fs.copyFileSync(path.join(fixtures, '品游配置_悟空按键.py'), path.join(streamer, '下载', '深', '品游配置_悟空按键.py'))
  assert.equal(findAssetRoots(path.join(streamer, '下载', '深'), '品游配置_悟空按键.py').root, undefined)
  assert.equal(parsePinyouFile(path.join(streamer, '下载', '深', '品游配置_悟空按键.py')).plans[0].notes.length > 0, true, '找不到目录时音效要提示')
  // 配置文件自己所在目录有一个素材目录就算
  fs.mkdirSync(path.join(streamer, '下载', '深', '音效'))
  assert.equal(findAssetRoots(path.join(streamer, '下载', '深'), '品游配置_悟空按键.py').root, path.join(streamer, '下载', '深'))
  // 上层只有一个素材目录但有品游主程序 → 认
  const py = path.join(temporary, 'PY')
  fs.mkdirSync(path.join(py, '音效'), { recursive: true }); fs.mkdirSync(path.join(py, '配置'))
  fs.writeFileSync(path.join(py, '娱乐助手Pro9.71.exe'), '')
  assert.equal(findAssetRoots(path.join(py, '配置'), 'x.py').root, py)
  // 本机自动定位品游安装目录（只在给定的额外目录里找，不碰真实盘符之外的东西）
  assert.equal(locatePinyouInstall([temporary]), install)
  assert.equal(locatePinyouInstall([path.join(temporary, '主播')]) === install, false, '主播目录里没有品游，不能把临时目录里的安装目录当结果')
  console.log('PASS 2026-09-06 storage: decode (GBK / literal U+FFFD / UTF-16 no BOM / BE) / three real built-in plans / sibling 品游素材_ / streamer 视频 dir rejected / exe marker / locate install')
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
