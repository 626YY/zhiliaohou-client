// 品游时间类项目 → 时间盲盒奖池的映射单测（2026-09-07 用户：
// 「关于时间类的我觉得他就应该自动加载到时间规则里面」）。
// 手写样例锁语义，再拿主播真实素材库（F:\知了猴工作室\视频）对一遍分类结果。
// 用法：node tools/test-pinyou-time.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parsePinyouScript } from '../src/shared/pinyou.ts'
import { planTimeProject, isTimeProject } from '../src/shared/pinyouTime.ts'
import { validateTimeBlindBoxEvent, applyTimeBlindBoxValue } from '../src/shared/timeBlindBox.ts'

const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

const entry = (name, script) => ({
  name,
  video: `D:\\素材\\${name}.mp4`,
  commands: script ? parsePinyouScript(script).commands : []
})

// ---- ① 品游四种时间写法 → 四种 op ----
{
  const plan = planTimeProject([
    entry('加10分', '加班增加:600秒'),
    entry('减10分', '加班减少:600秒'),
    entry('翻倍', '加班乘以:2'),
    entry('减半', '加班除以:2')
  ], 't')
  assert.equal(plan.events.length, 4, JSON.stringify(plan))
  const by = Object.fromEntries(plan.events.map((e) => [e.name, e]))
  assert.deepEqual([by['加10分'].op, by['加10分'].value], ['add', 600])
  assert.deepEqual([by['减10分'].op, by['减10分'].value], ['subtract', 600], '品游用负数表示减少，要转成 subtract + 正值')
  assert.deepEqual([by['翻倍'].op, by['翻倍'].value], ['multiply', 2])
  assert.deepEqual([by['减半'].op, by['减半'].value], ['divide', 2])
  pass('品游四种时间写法映射正确', '加/减/乘/除')
}

// ---- ② 「加班加减:±N」这种带符号的写法 ----
{
  const plan = planTimeProject([entry('加35分', '加班加减:2100'), entry('减35分', '加班加减:-2100')], 't')
  const by = Object.fromEntries(plan.events.map((e) => [e.name, e]))
  assert.deepEqual([by['加35分'].op, by['加35分'].value], ['add', 2100])
  assert.deepEqual([by['减35分'].op, by['减35分'].value], ['subtract', 2100])
  pass('「加班加减:±N」按符号分到 add / subtract')
}

// ---- ③ 视频挂在事件上（这是「一个盲盒项目包含很多视频」的落点）----
{
  const plan = planTimeProject([entry('甲', '加班增加:60秒')], 't')
  assert.equal(plan.events[0].video, 'D:\\素材\\甲.mp4', '事件必须带上它自己的视频')
  assert.equal(plan.events[0].videoSeconds, 0, '0 = 播完为止')
  pass('每个事件带上自己的视频')
}

// ---- ④ 事件必须通过时间挂件自己的校验，并且算得出结果 ----
{
  const plan = planTimeProject([
    entry('加1分', '加班增加:60秒'), entry('减1分', '加班减少:60秒'),
    entry('翻倍', '加班乘以:2'), entry('减半', '加班除以:2')
  ], 't')
  for (const e of plan.events) {
    assert.equal(validateTimeBlindBoxEvent(e), null, `事件没通过时间挂件的校验：${JSON.stringify(e)}`)
  }
  const by = Object.fromEntries(plan.events.map((e) => [e.name, e]))
  assert.equal(applyTimeBlindBoxValue(600, by['加1分'], 60), 660)
  assert.equal(applyTimeBlindBoxValue(600, by['减1分'], 60), 540)
  assert.equal(applyTimeBlindBoxValue(600, by['翻倍'], 2), 1200)
  assert.equal(applyTimeBlindBoxValue(600, by['减半'], 2), 300)
  pass('生成的事件能通过时间挂件校验并算出正确结果', '600 → 660/540/1200/300')
}

// ---- ⑤ 进不了池子的条目要有原因，不能静默丢 ----
{
  const plan = planTimeProject([
    entry('纯视频', null),
    entry('清零', '加班清零'),
    entry('锁键盘', '键盘操作:锁定WSAD'),
    entry('除零', '加班除以:0'),
    entry('正常', '加班增加:30秒')
  ], 't')
  assert.equal(plan.events.length, 1)
  assert.equal(plan.skipped.length, 4, JSON.stringify(plan.skipped))
  const why = Object.fromEntries(plan.skipped.map((s) => [s.name, s.why]))
  assert.match(why['纯视频'], /纯视频/)
  assert.match(why['清零'], /清零/)
  assert.match(why['锁键盘'], /不是时间加减/)
  assert.match(why['除零'], /除数是 0/)
  pass('进不了池子的条目都带原因（不静默丢）', plan.skipped.map((s) => s.name).join('、'))
}

// ---- ⑥ 同一项目重复导入时 id 稳定 ----
{
  const items = [entry('甲', '加班增加:60秒'), entry('乙', '加班减少:60秒')]
  const a = planTimeProject(items, '虚拟主播时间')
  const b = planTimeProject(items, '虚拟主播时间')
  assert.deepEqual(a.events.map((e) => e.id), b.events.map((e) => e.id), '两次导入 id 应一致，否则会越导越多')
  assert.ok(a.events[0].id.startsWith('虚拟主播时间-'))
  pass('重复导入 id 稳定，不会越导越多')
}

// ---- ⑦ 分类判据：时间项目 vs 非时间项目 ----
{
  assert.equal(isTimeProject(planTimeProject([entry('甲', '加班增加:60秒'), entry('乙', '加班减少:60秒')], 't')), true)
  // 「哈喽体力转盘」那种：只有 1 个脚本且是播放视频 —— 不该被当成时间项目
  assert.equal(isTimeProject(planTimeProject([entry('甲', '播放视频:某目录\\随机播放[绿幕2]'), entry('乙', null)], 't')), false)
  // 只有 1 个时间条目也不算（样本太少，交给主播自己选）
  assert.equal(isTimeProject(planTimeProject([entry('甲', '加班增加:60秒')], 't')), false)
  pass('时间项目的判据：≥2 个时间条目且占有脚本条目的一半以上')
}

// ---- ⑧ 拿主播真实素材库对一遍 ----
const REAL = 'F:\\知了猴工作室\\视频'
if (fs.existsSync(REAL)) {
  const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|flv|wmv)$/i
  const decode = (buf) => {
    for (const enc of ['gbk', 'utf-8']) {
      try {
        const s = new TextDecoder(enc, { fatal: true }).decode(buf)
        if (s && !s.includes('\uFFFD')) return s
      } catch { /* 下一个编码 */ }
    }
    return new TextDecoder('utf-8').decode(buf)
  }
  const rows = []
  for (const name of fs.readdirSync(REAL)) {
    const dir = path.join(REAL, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const files = fs.readdirSync(dir)
    const entries = files.filter((f) => VIDEO_RE.test(f)).map((f) => {
      const base = f.slice(0, f.length - path.extname(f).length)
      const sp = path.join(dir, base + '.脚本')
      return {
        name: base,
        video: path.join(dir, f),
        commands: fs.existsSync(sp) ? parsePinyouScript(decode(fs.readFileSync(sp))).commands : []
      }
    })
    if (!entries.length) continue
    const plan = planTimeProject(entries, name)
    rows.push({ name, isTime: isTimeProject(plan), ...plan })
  }
  console.log('\n真实素材库分类：')
  for (const r of rows) {
    console.log('  %s %-16s 事件 %3d / 有脚本 %3d', r.isTime ? '⏱' : '  ', r.name, r.events.length, r.scriptItems)
  }
  const timeOnes = rows.filter((r) => r.isTime).map((r) => r.name)
  // 这三个是明确的时间类项目（脚本全是加班加减）
  for (const want of ['虚拟主播时间', '翻牌子时间', '加减播1-60分钟']) {
    assert.ok(timeOnes.includes(want), `「${want}」应被认成时间类项目，实际：${timeOnes.join('、')}`)
  }
  // 这些不该被认成时间类
  for (const no of ['刮刮乐作业', '抓鸭子', '绿幕']) {
    assert.ok(!timeOnes.includes(no), `「${no}」不该被认成时间类项目`)
  }
  // 所有生成的事件都要能过校验
  for (const r of rows) {
    for (const e of r.events) {
      assert.equal(validateTimeBlindBoxEvent(e), null, `${r.name}/${e.name} 没过校验：${JSON.stringify(e)}`)
    }
  }
  pass('真实素材库分类正确且全部事件合法', `时间类 ${timeOnes.length} 个：${timeOnes.join('、')}`)
} else {
  console.log('SKIP 真实素材库不在本机')
}

console.log(`\n品游时间项目 ${passed.length} 项 PASS`)
