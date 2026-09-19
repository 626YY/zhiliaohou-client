// 抖音礼物表解析（src/shared/douyinGiftList.ts）单测：用 tools/fixtures/douyin-gift-list-sample.json（真实响应裁剪）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { extractDouyinGifts, dedupeGiftsByName, giftImageUri, giftFileStem, giftNameKey, buildGiftListUrl } from '../src/shared/douyinGiftList.ts'

const fixture = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'douyin-gift-list-sample.json'), 'utf8'))
const gifts = extractDouyinGifts(fixture)
assert.equal(gifts.length, 6, 'data.gifts 6 条 + pages 里重复的 1 条 → 按 id 去重后 6 条')
assert.ok(gifts.some((g) => g.name === '5200') && gifts.some((g) => g.name === 'GG'), '新礼物 5200 / GG 在')
const first = gifts.find((g) => g.name === '梅园许愿')
assert.ok(first && first.urls.length >= 2 && first.urls.every((u) => u.startsWith('https://')), '候选 URL 全 https 且至少两条')
assert.equal(first.diamondCount, 999)
assert.equal(first.uri, 'webcast/c8e4bd11f270055d24022a044b3cdf8f.png', 'uri 去域名去 ~tplv 后缀')
assert.ok(gifts.every((g) => /^\d+$/.test(g.id)), 'id 是数字串')
console.log('PASS extract: 6 gifts, dedupe by id, https urls, uri')

const byName = dedupeGiftsByName([...gifts, { ...first, id: '1', onPanel: false }])
assert.equal(byName.filter((g) => g.name === '梅园许愿').length, 1, '同名只留一条')
assert.equal(byName.find((g) => g.name === '梅园许愿').id, first.id, '面板上的优先于隐藏的')
console.log('PASS dedupeGiftsByName')

assert.equal(giftImageUri('https://p3-webcast.douyinpic.com/img/webcast/abc.png~tplv-obj.png'), 'webcast/abc.png')
assert.equal(giftImageUri('https://p11-webcast.douyinpic.com/img/webcast/abc.png~tplv-obj.webp'), 'webcast/abc.png')
assert.equal(giftImageUri('webcast/abc.png'), 'webcast/abc.png')
assert.equal(giftImageUri(''), '')
console.log('PASS giftImageUri')

assert.equal(giftFileStem(' 小 心心 '), '小 心心', '折叠空白')
assert.equal(giftFileStem('a/b:c*d?e"f<g>h|i\\j'), 'abcdefghij', '去 Windows 非法字符（与连接器同规则）')
assert.equal(giftFileStem('x'.repeat(60)).length, 40, '最多 40 字')
assert.match(giftFileStem('///'), /^礼物-[0-9a-f]+$/, '全是非法字符时给稳定兜底名')
assert.equal(giftNameKey(' 小心心 '), '小心心')
console.log('PASS giftFileStem / giftNameKey')

const url = buildGiftListUrl('7383040000000000000')
assert.ok(url.startsWith('https://live.douyin.com/webcast/gift/list/?'))
assert.ok(url.includes('room_id=7383040000000000000') && url.includes('aid=6383') && url.includes('fetch_giftlist_from=2'))
assert.ok(buildGiftListUrl('').includes('room_id=0') && buildGiftListUrl('abc').includes('room_id=0'), '非数字房间号回落 0')
console.log('PASS buildGiftListUrl')

assert.deepEqual(extractDouyinGifts(null), [])
assert.deepEqual(extractDouyinGifts({ data: { gifts: [{ id: 1, name: '', image: { url_list: ['https://x/y.png'] } }] } }), [], '没名字的丢掉')
console.log('PASS edge cases')
console.log('douyin gift list regression passed')
