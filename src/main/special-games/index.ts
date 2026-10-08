// 特色玩法 Canvas 代码注册表：玩法 id → 页面内 JS 字符串。
// 只在主进程 import；渲染层只用 ../../shared/specialGames 的元数据。
// 还没实现的玩法不在表里，openSpecialGame 会用空代码（空白窗口），不影响其它玩法。
import type { SpecialGameId } from '../../shared/specialGames'
import { code as chainChallenge } from './chain_challenge'
import { code as tugOfWar } from './tug_of_war'
import { code as bombDefuse } from './bomb_defuse'
import { code as catchDuck } from './catch_duck'
import { code as throwPoop } from './throw_poop'
import { code as throwTrash } from './throw_trash'
import { code as catchBullet } from './catch_bullet'
import { code as caterpillar } from './caterpillar'
import { code as fanCall } from './fan_call'
import { code as fanVideoCall } from './fan_video_call'
import { code as talismanSeal } from './talisman_seal'
import { code as mosquito } from './mosquito'
import { code as bigMosquito } from './big_mosquito'
import { code as gestureFly } from './gesture_fly'
import { code as fruitSlice } from './fruit_slice'
import { code as coinBump } from './coin_bump'
import { code as leafPickup } from './leaf_pickup'

export const GAME_CODE: Partial<Record<SpecialGameId, string>> = {
  chain_challenge: chainChallenge,
  tug_of_war: tugOfWar,
  bomb_defuse: bombDefuse,
  catch_duck: catchDuck,
  throw_poop: throwPoop,
  throw_trash: throwTrash,
  catch_bullet: catchBullet,
  caterpillar,
  fan_call: fanCall,
  fan_video_call: fanVideoCall,
  talisman_seal: talismanSeal,
  mosquito,
  big_mosquito: bigMosquito,
  gesture_fly: gestureFly,
  fruit_slice: fruitSlice,
  coin_bump: coinBump,
  leaf_pickup: leafPickup
}
