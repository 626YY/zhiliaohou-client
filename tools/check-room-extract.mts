// 直播间号识别的纯函数回归（0.3.51 起房号可带字母）：npx tsx tools/check-room-extract.mts
import { extractRoomId, ROOM_ID_RE } from '../src/renderer/src/components/room/roomApi'

const cases: [string, string | undefined][] = [
  ['577117602', '577117602'],
  ['Live_abc-2026', 'Live_abc-2026'],
  ['abc', 'abc'],
  ['https://live.douyin.com/abc123?enter_from=x', 'abc123'],
  ['live.douyin.com/Room_9', 'Room_9'],
  ['https://www.douyin.com/user/xx/live/hlx2023', 'hlx2023'],
  ['https://live.douyin.com/search', undefined],
  ['https://live.douyin.com/follow', undefined],
  ['ab c', undefined],
  ['a.b', undefined],
  ['https://v.douyin.com/abc/', undefined],
  ['1'.repeat(64), '1'.repeat(64)],
  ['1'.repeat(65), undefined],
  ['live', undefined],
  ['www', undefined]
]
let bad = 0
for (const [input, want] of cases) {
  const got = extractRoomId(input).room
  const ok = got === want
  if (!ok) bad++
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(input), '->', got, ok ? '' : '(want ' + want + ')')
}
console.log('ROOM_ID_RE', String(ROOM_ID_RE), 'failures', bad)
process.exit(bad ? 1 : 0)
