// 连接器组件同步判定单测：版本标记比较 / 老包无标记的完整连接器要换 / 薄连接器与自改脚本不动 / 缺失补齐规则
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { shouldReplaceModule, moduleVersionOf, isOurFullConnector } from '../src/shared/connectorSync.ts'

const root = path.resolve(import.meta.dirname, '..')
const want = fs.readFileSync(path.join(root, 'connector-assets/connector.py'), 'utf8')
const wantVer = moduleVersionOf(want)
assert.match(wantVer, /^\d{4}-\d{2}-\d{2}/, '客户端自带 connector.py 必须有 CONNECTOR_VERSION：' + wantVer)
// 老包里的完整连接器：去掉版本标记行模拟 0.2.12 及更早的包
const oldFull = want.replace(/^CONNECTOR_VERSION\s*=.*$/m, '')
assert.equal(moduleVersionOf(oldFull), '')
assert.ok(isOurFullConnector(oldFull))
assert.equal(shouldReplaceModule('connector.py', oldFull, want).replace, true, '老包无标记的完整连接器应被换掉')
// 薄连接器（图书管理员）：前缀不同、没有单实例互斥
const thin = 'import sys\ndef log(msg: str) -> None:\n    print("[darkmage-connector] " + msg, flush=True)\n'
assert.equal(isOurFullConnector(thin), false)
assert.equal(shouldReplaceModule('connector.py', thin, want).replace, false, '薄连接器不能被覆盖')
// 主播自改脚本（无标记、无我们的签名）
assert.equal(shouldReplaceModule('connector.py', 'print("hello")', want).replace, false)
// 版本比较
assert.equal(shouldReplaceModule('connector.py', want.replace(wantVer, '2026-01-01'), want).replace, true)
assert.equal(shouldReplaceModule('connector.py', want, want).replace, false)
assert.equal(shouldReplaceModule('connector.py', want.replace(wantVer, '2099-01-01'), want).replace, false, '更新的不回退')
// 缺失：connector.py 不补（可能是薄连接器），douyin_room.py 补
assert.equal(shouldReplaceModule('connector.py', null, want).replace, false)
const dr = fs.readFileSync(path.join(root, 'connector-assets/douyin_room.py'), 'utf8')
assert.equal(shouldReplaceModule('douyin_room.py', null, dr).replace, true)
assert.equal(shouldReplaceModule('douyin_room.py', 'x = 1', dr).replace, true, '无标记的 douyin_room.py 换掉')
console.log('PASS connector sync 判定：老包完整连接器换 / 薄连接器不动 / 版本比较 / 缺失规则（自带版本 ' + wantVer + '）')
