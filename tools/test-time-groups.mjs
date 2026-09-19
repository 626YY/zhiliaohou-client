// 时间插件「项目分组开关」的纯逻辑单测（2026-09-08 用户：「时间插件也要做项目规划预设开关规划」）。
//
// 钉三件事：
//   ① 停用的事件真触发时抽不到（项目开关关了就是不抽），但「测试」按钮还能试
//   ② 整组都停用时给的是「都停用了」而不是「奖池为空」——两种原因主播的处理完全不同
//   ③ 重复导入同一个项目不会把主播关掉的项目悄悄打开
// 用法：node tools/test-time-groups.mjs
import assert from 'node:assert/strict'
import { blindBoxGroups, mergeImportedBlindBoxEvents, resolveTimeBlindBoxPool } from '../src/shared/timeBlindBox.ts'
import { planTimeProject } from '../src/shared/pinyouTime.ts'
import { parsePinyouScript } from '../src/shared/pinyou.ts'

const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

const ev = (id, group, enabled = true) => ({
  id, name: id, group, enabled, op: 'add', value: 60, value2: null,
  video: '', videoSeconds: 0, sound: '', soundVolume: 100, action: 'none', actionParam: ''
})

// ---- ① 真触发跳过停用的，测试按钮不跳过 ----
{
  const events = [ev('a', '甲'), ev('b', '甲', false), ev('c', '乙')]
  const live = resolveTimeBlindBoxPool(events, ['a', 'b', 'c'], { skipDisabled: true })
  assert.equal(live.ok, true, live.error)
  assert.deepEqual(live.events.map((e) => e.id), ['a', 'c'], '停用的 b 不该进抽奖池')

  const test = resolveTimeBlindBoxPool(events, ['b'])
  assert.equal(test.ok, true, '「测试」按钮要能试停用的事件：' + test.error)
  pass('★停用的事件真触发抽不到，测试按钮仍可试', 'a,c / b')
}

// ---- ② 整组停用时的错误话术 ----
{
  const events = [ev('a', '甲', false), ev('b', '甲', false)]
  const r = resolveTimeBlindBoxPool(events, ['a', 'b'], { skipDisabled: true })
  assert.equal(r.ok, false)
  assert.match(r.error, /停用/, '要说清是「停用」而不是「奖池为空」：' + r.error)
  assert.match(r.error, /项目开关/, '要告诉主播去哪开：' + r.error)
  // 真的没选才说「奖池为空」
  const empty = resolveTimeBlindBoxPool(events, [], { skipDisabled: true })
  assert.match(empty.error, /奖池为空/)
  pass('整组停用报「都停用了」，没选才报「奖池为空」')
}

// ---- ③ 分组统计 ----
{
  const rows = blindBoxGroups([ev('a', '甲'), ev('b', '甲', false), ev('c', ''), ev('d', '乙')])
  const by = Object.fromEntries(rows.map((r) => [r.group, r]))
  assert.deepEqual([by['甲'].total, by['甲'].enabled], [2, 1])
  assert.deepEqual([by['乙'].total, by['乙'].enabled], [1, 1])
  assert.ok(by['未分组'], '没填 group 的归到「未分组」')
  pass('分组统计（每组几条 / 开着几条）', rows.map((r) => `${r.group} ${r.enabled}/${r.total}`).join('、'))
}

// ---- ④ 品游导入的事件带项目名，且默认启用 ----
{
  const entry = (name, script) => ({ name, video: `D:\\素材\\${name}.mp4`, commands: parsePinyouScript(script).commands })
  const plan = planTimeProject([entry('加1分', '加班增加:60秒'), entry('减1分', '加班减少:60秒')], '虚拟主播时间')
  assert.deepEqual([...new Set(plan.events.map((e) => e.group))], ['虚拟主播时间'], '分组要等于项目名')
  assert.deepEqual([...new Set(plan.events.map((e) => e.enabled))], [true], '导入的默认启用')
  pass('品游导入的事件带项目名（= 分组），默认启用')
}

// ---- ⑤ 重复导入不把主播关掉的项目悄悄打开 ----
{
  const incoming = [ev('虚拟主播时间-1', '虚拟主播时间'), ev('虚拟主播时间-2', '虚拟主播时间')]
  // 主播把这个项目整组关了
  const existing = [
    { ...ev('虚拟主播时间-1', '虚拟主播时间', false) },
    { ...ev('虚拟主播时间-2', '虚拟主播时间', false) },
    ev('别的-1', '别的')
  ]
  const merged = mergeImportedBlindBoxEvents(existing, incoming)
  assert.equal(merged.length, 3, '同项目重复导入不叠加：' + merged.map((e) => e.id).join(','))
  const again = merged.filter((e) => e.group === '虚拟主播时间')
  assert.deepEqual(again.map((e) => e.enabled), [false, false], '★原来整组关着，重新导入不该悄悄打开')
  assert.equal(merged.find((e) => e.id === '别的-1').enabled, true, '别的项目不受影响')

  // 原来是开着的：重新导入保持开着
  const on = mergeImportedBlindBoxEvents([ev('虚拟主播时间-1', '虚拟主播时间'), ev('虚拟主播时间-2', '虚拟主播时间')], incoming)
  assert.deepEqual(on.filter((e) => e.group === '虚拟主播时间').map((e) => e.enabled), [true, true])
  pass('★重复导入保留整组停用状态，开着的保持开着')
}

console.log(`\n时间插件项目分组 ${passed.length} 项 PASS`)
