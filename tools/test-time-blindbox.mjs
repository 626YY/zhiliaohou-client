import assert from 'node:assert/strict'
import { normalizeTimeBlindBoxEvents, validateTimeBlindBoxEvent, resolveTimeBlindBoxPool, pickTimeBlindBoxValue, applyTimeBlindBoxValue } from '../src/shared/timeBlindBox.ts'
const checks = []
const test = (name, fn) => { fn(); checks.push(name); console.log('PASS ' + name) }
const event = (op = 'multiply', value = 3, patch = {}) => ({ id: 'one', name: '时间事件', op, value, ...patch })
test('four operations round final seconds', () => {
  for (const [op, value, expected] of [['add', 30, 130], ['subtract', 30, 70], ['multiply', 3, 300], ['divide', 2, 50]]) {
    assert.equal(applyTimeBlindBoxValue(100, event(op, value), value), expected)
  }
})
test('zero multiplication and decimal factors stay exact', () => {
  assert.equal(applyTimeBlindBoxValue(100, event('multiply', 0), 0), 0)
  assert.equal(applyTimeBlindBoxValue(100, event('multiply', 1.5), 1.5), 150)
  assert.equal(applyTimeBlindBoxValue(101, event('divide', 2), 2), 51)
})
test('divide zero and invalid values are rejected', () => {
  for (const value of [0, -1, NaN, Infinity]) assert.ok(validateTimeBlindBoxEvent(event('divide', value)))
  assert.throws(() => applyTimeBlindBoxValue(100, event('divide', 0), 0), /大于 0/)
  assert.ok(validateTimeBlindBoxEvent(event('divide', 1, { value2: 0 })))
})
test('integer ranges include endpoints in either order', () => {
  assert.equal(pickTimeBlindBoxValue(event('add', 2, { value2: 4 }), () => 0), 2)
  assert.equal(pickTimeBlindBoxValue(event('add', 4, { value2: 2 }), () => 0.99999), 4)
})
test('decimal intervals are not truncated and tiny divisors remain positive', () => {
  assert.equal(pickTimeBlindBoxValue(event('multiply', 1.5, { value2: 2.5 }), () => 0.25), 1.75)
  assert.ok(pickTimeBlindBoxValue(event('divide', 1e-8, { value2: 2e-8 }), () => 0) > 0)
})
test('negative visibility and overflow checks', () => {
  assert.equal(applyTimeBlindBoxValue(10, event('subtract', 30), 30), 0)
  assert.equal(applyTimeBlindBoxValue(10, event('subtract', 30), 30, true), -20)
  assert.throws(() => applyTimeBlindBoxValue(Number.MAX_SAFE_INTEGER, event(), 3), /过大/)
  assert.throws(() => pickTimeBlindBoxValue(event('add', 0, { value2: Number.MAX_SAFE_INTEGER })), /范围过大/)
})
test('empty, missing and duplicate event references never fall back', () => {
  assert.equal(resolveTimeBlindBoxPool([event()], []).ok, false)
  assert.equal(resolveTimeBlindBoxPool([event()], ['deleted']).ok, false)
  assert.equal(resolveTimeBlindBoxPool([event(), event()], ['one']).ok, false)
  assert.equal(resolveTimeBlindBoxPool([event()], ['one', 'one']).events.length, 1)
})
test('pool is a value snapshot and library has no six-item limit', () => {
  const library = normalizeTimeBlindBoxEvents(Array.from({ length: 17 }, (_, i) => event('multiply', i, { id: String(i) })))
  assert.equal(library.length, 17)
  const snapshot = resolveTimeBlindBoxPool(library, ['3']).events
  library[3].value = 99
  assert.equal(snapshot[0].value, 3)
})
test('all optional media and action fields survive normalization', () => {
  const input = event('multiply', 1.5, { value2: 3.5, video: 'C:\\视频 # &.webm', videoSeconds: 0.25, sound: 'C:\\音效.wav', soundVolume: 0, action: 'prank', actionParam: 'librarian|blackhole' })
  // group/enabled 是项目分组开关加的字段：没写就是「未分组 + 启用」
  assert.deepEqual(normalizeTimeBlindBoxEvents([input])[0], { ...input, group: '', enabled: true })
  assert.ok(validateTimeBlindBoxEvent(normalizeTimeBlindBoxEvents([event('multiply', null)])[0]))
})
test('project group and enabled flag survive normalization', () => {
  const rows = normalizeTimeBlindBoxEvents([
    event('add', 60, { id: 'a', group: '虚拟主播时间' }),
    event('add', 60, { id: 'b', group: '翻牌子时间', enabled: false })
  ])
  assert.deepEqual([rows[0].group, rows[0].enabled], ['虚拟主播时间', true])
  assert.deepEqual([rows[1].group, rows[1].enabled], ['翻牌子时间', false])
})
console.log(`Time blind box regression: ${checks.length}/${checks.length} PASS`)
