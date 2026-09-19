// 远端 mod 清单纯逻辑单测（src/shared/modsCatalog.ts）：不连网、秒级。
// 这层是「上新 mod 不用发客户端」的闸门，写松了主播会被导去别处下东西或者装到一个下不动的地址，
// 所以白名单、sha256、版本闸门都要锁死。
import assert from 'node:assert/strict'
import { compareVersion, groupPranks, installBlockedReason, modStatusOf, overlayCatalog, parseRemoteCatalog, parseSchemaBundle, SCHEMA_BUNDLE_MAX_BYTES } from '../src/shared/modsCatalog.ts'

const OK_URL = 'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/mods/zhiliao-dontscream-v0.2.12.zip'
const SHA = 'a'.repeat(64)
const dl = (url = OK_URL, size = 7629828, sha256 = SHA) => ({ url, size, sha256, filename: 'x.zip' })
const bundled = [
  { id: 'zhiliao-dontscream', version: '0.2.11', download: { url: 'bundled', size: 1, sha256: SHA }, cover: 'c1', installedMarker: 'm1' },
  { id: 'darkmage-librarian', version: '0.8.4', download: { url: 'bundled', size: 1, sha256: SHA }, cover: 'c2', installedMarker: 'm2' }
]

// ---- 版本比较 ----
assert.equal(compareVersion('0.2.12', '0.2.11'), 1)
assert.equal(compareVersion('1.0', '1.0.0'), 0, '缺的段当 0')
assert.equal(compareVersion('0.2.9', '0.2.10'), -1, '按数字比不是按字典序')
assert.equal(compareVersion('', '0.0.1'), -1)
console.log('PASS 版本比较')

// ---- 解析与清洗 ----
assert.equal(parseRemoteCatalog(null), null)
assert.equal(parseRemoteCatalog([]), null, '数组不算清单')
assert.equal(parseRemoteCatalog({ mods: {} }), null, '一条都不合格就当没有')
assert.equal(parseRemoteCatalog({ mods: { x: { version: '不是版本' } } }), null, '版本号格式不对丢掉')
assert.equal(
  parseRemoteCatalog({ mods: { 'a/../b': { version: '1.0' } } }),
  null,
  'id 带路径符号丢掉'
)
const good = parseRemoteCatalog({ generatedAt: '2026-09-07', mods: { 'zhiliao-dontscream': { version: '0.2.12', download: dl() } } })
assert.ok(good && good.mods['zhiliao-dontscream'].download.url === OK_URL)
assert.equal(good.generatedAt, '2026-09-07')
console.log('PASS 解析与清洗')

// ---- download 三件套缺一不可 ----
for (const [name, bad] of [
  ['站外地址', dl('https://evil.example.com/x.zip')],
  ['http 明文', dl('http://zhiliaohou.oss-cn-beijing.aliyuncs.com/x.zip')],
  ['域名前缀骗过白名单', dl('https://zhiliaohou.oss-cn-beijing.aliyuncs.com.evil.com/x.zip')],
  ['大小为 0', dl(OK_URL, 0)],
  ['sha256 位数不对', dl(OK_URL, 100, 'abc')]
]) {
  const c = parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { version: '0.2.12', download: bad } } })
  assert.ok(c, `${name}：版本还在，清单不该整份作废`)
  assert.equal(c.mods['zhiliao-dontscream'].download, undefined, `${name} 应该被剔掉`)
}
console.log('PASS download 白名单 / 大小 / sha256')

// ---- 覆盖：只在更新时覆盖，且只覆盖三个字段 ----
assert.deepEqual(overlayCatalog(bundled, null), bundled, '没有远端清单就原样返回')
const newer = overlayCatalog(bundled, parseRemoteCatalog({
  mods: { 'zhiliao-dontscream': { version: '0.2.12', download: dl(), changelog: [{ version: '0.2.12' }] } }
}))
assert.equal(newer[0].version, '0.2.12')
assert.equal(newer[0].download.url, OK_URL)
assert.equal(newer[0].changelog[0].version, '0.2.12')
assert.equal(newer[0].cover, 'c1', '封面这类字段不许被远端改')
assert.equal(newer[0].installedMarker, 'm1', 'installedMarker 不许被远端改')
assert.equal(newer[1].version, '0.8.4', '没提到的 mod 不动')
assert.equal(bundled[0].version, '0.2.11', '原数组不许被改')
console.log('PASS 覆盖只动三个字段')

for (const [name, ver] of [['平级', '0.2.11'], ['更旧', '0.2.10']]) {
  const same = overlayCatalog(bundled, parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { version: ver, download: dl() } } }))
  assert.equal(same[0].version, '0.2.11', `${name}版本不该覆盖（不能把主播降级）`)
  assert.equal(same[0].download.url, 'bundled', `${name}版本连 download 也不该换`)
}
console.log('PASS 平级/更旧不覆盖')

// 只给版本不给 download：版本升上去，下载地址继续用自带的（内置 zip 兜底）
const verOnly = overlayCatalog(bundled, parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { version: '0.2.12' } } }))
assert.equal(verOnly[0].version, '0.2.12')
assert.equal(verOnly[0].download.url, 'bundled', '没给合格 download 就沿用自带的')
console.log('PASS 只升版本时沿用自带下载地址')

console.log('远端 mod 清单回归通过：6 组')

// ---- 上架状态（0.3.47）：与版本解耦；非法值丢；只带状态的条目也要活下来 ----
{
  const only = parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { status: 'coming_soon' } } })
  assert.ok(only, '只带 status 的条目要活下来（后台改状态时版本号通常不变）')
  const out = overlayCatalog(bundled, only)
  assert.equal(out[0].status, 'coming_soon')
  assert.equal(out[0].version, '0.2.11', '状态不动版本')
  assert.equal(modStatusOf(out[1]), 'listed', '没给状态 = 在售')
  const bad = parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { version: '0.2.12', status: 'soldout' } } })
  assert.equal(bad.mods['zhiliao-dontscream'].status, undefined, '非法状态当没给，不许猜成下架')
  const older = overlayCatalog(bundled, parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { version: '0.1.0', status: 'unlisted' } } }))
  assert.equal(older[0].version, '0.2.11', '更旧的版本不覆盖')
  assert.equal(older[0].status, 'unlisted', '但状态照样生效')
  assert.equal(installBlockedReason({ status: 'coming_soon' }, false), '该 Mod 尚未发售，敬请期待')
  assert.equal(installBlockedReason({ status: 'unlisted' }, false), '该 Mod 已下架')
  assert.equal(installBlockedReason({ status: 'unlisted' }, true), '', '已装的放行修复/重装/卸载')
  assert.equal(installBlockedReason({}, false), '', '缺省在售不拦')
  console.log('PASS 上架状态')
}

// ---- 定义包（2026-09-14）：清单里的 schema 三件套、bundle 结构清洗、按 cat 分组、回归同源放行 ----
{
  const SCHEMA_URL = 'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/updates/schemas/dontscream-abcdef12.json'
  const sc = (url = SCHEMA_URL, size = 12345, sha256 = SHA) => ({ url, size, sha256 })
  const only = parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { schema: sc() } } })
  assert.ok(only, '只带 schema 的条目也要活下来（菜单更新时 mod 版本往往没变）')
  assert.deepEqual(only.mods['zhiliao-dontscream'].schema, { url: SCHEMA_URL, size: 12345, sha256: SHA })
  for (const [name, bad] of [
    ['站外地址', sc('https://evil.example.com/x.json')],
    ['大小为 0', sc(SCHEMA_URL, 0)],
    ['大得离谱', sc(SCHEMA_URL, SCHEMA_BUNDLE_MAX_BYTES + 1)],
    ['sha256 位数不对', sc(SCHEMA_URL, 100, 'abc')]
  ]) {
    const c = parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { version: '0.2.12', schema: bad } } })
    assert.ok(c && c.mods['zhiliao-dontscream'].version === '0.2.12', `${name}：版本还在`)
    assert.equal(c.mods['zhiliao-dontscream'].schema, undefined, `${name} 的 schema 应该被剔掉`)
  }
  // 回归把清单指到本地夹具服务器：同源的 schema / download 放行，别的照样拒
  const local = parseRemoteCatalog({ mods: { 'zhiliao-dontscream': { schema: sc('http://127.0.0.1:4567/s.json'), download: dl('http://127.0.0.1:4567/x.zip') } } }, 'http://127.0.0.1:4567')
  assert.ok(local?.mods['zhiliao-dontscream'].schema && local.mods['zhiliao-dontscream'].download, '同源放行')
  assert.equal(parseRemoteCatalog({ mods: { x: { schema: sc('http://127.0.0.1:4567/s.json') } } }), null, '没给 allowOrigin 时本地地址照拒')
  assert.equal(parseRemoteCatalog({ mods: { x: { schema: sc('http://127.0.0.1:9999/s.json') } } }, 'http://127.0.0.1:4567'), null, '端口不同不算同源')
  // 覆盖：schema 不参与版本比较，也不改清单字段（它由 schema-store 单独消费）
  const over = overlayCatalog(bundled, only)
  assert.equal(over[0].version, '0.2.11')
  assert.equal(over[0].download.url, 'bundled')
  console.log('PASS 清单 schema 三件套')

  const raw = {
    gameId: 'dontscream', version: '0.2.15',
    pranks: [
      { id: 'lunge', name: '突脸暴击', cat: '贴脸暴击' },
      { id: 'lunge', name: '重复的', cat: '贴脸暴击' },
      { id: 'bad id!', name: 'x', cat: 'y' },
      { id: 'noname', name: '', cat: 'y' },
      { id: 'boom', name: ' 炸毁游戏\n', cat: '危险', danger: true, desc: '毁局' },
      { id: 'nocat', name: '没分组' },
      'garbage', null
    ],
    config: { version: '1.0.0', groups: [{ id: 'a', name: 'A' }, { bad: 1 }], fields: [{ key: 'K', label: 'k', type: 'number' }, { nokey: 1 }] },
    binds: { menu: 'F2', binds: { lunge: 'Q', 'bad id!': 'W', boom: 7 } }
  }
  const b = parseSchemaBundle(raw, 'dontscream')
  assert.ok(b)
  assert.deepEqual(b.pranks.map((p) => p.id), ['lunge', 'boom', 'nocat'], 'id 非法 / 重复 / 没名字的丢掉')
  assert.equal(b.pranks[1].name, '炸毁游戏', '名字去首尾空白和换行')
  assert.equal(b.pranks[1].danger, true)
  assert.equal(b.pranks[1].desc, '毁局')
  assert.equal(b.pranks[2].cat, '其他', '没分组归到「其他」')
  assert.equal(b.version, '0.2.15')
  assert.equal(b.config.groups.length, 1, '坏分组丢掉')
  assert.equal(b.config.fields.length, 1, '坏字段丢掉')
  assert.deepEqual(b.binds, { menu: 'F2', leaderboard: 'BackQuote', binds: { lunge: 'Q' } }, '键位只留合法 id + 字符串')
  assert.equal(parseSchemaBundle(raw, 'librarian'), null, '游戏对不上整包不要（防发错文件把 A 的菜单盖到 B 上）')
  assert.equal(parseSchemaBundle({ gameId: 'dontscream', pranks: [] }), null, '一条整蛊都没有不算数')
  assert.equal(parseSchemaBundle({ gameId: 'dontscream', pranks: [{ id: 'a', name: 'A', cat: 'c' }], config: { groups: [], fields: [] } }).config, undefined, '空 config 当没给（沿用自带）')
  const groups = groupPranks(b.pranks)
  assert.deepEqual(groups.map((g) => [g.name, g.items.length]), [['贴脸暴击', 1], ['危险', 1], ['其他', 1]], '按 cat 分组、顺序 = 首次出现')
  console.log('PASS 定义包清洗与分组')
}
