// 特色整蛊卡片 / 详情页用到的美术与小工具（纯渲染层）。
// 卡片主图直接用玩法自己的素材（素材目录走 zlspecial://app/assets/），没有单张主图的玩法用生成好的缩略图（_thumbs/）。
import type { EntertainmentRule } from '@shared/types'
import { parseSpecialParam, type SpecialGameId } from '@shared/specialGames'
import { ruleActions } from '@shared/entertainmentActions'

// 第一张是主图（居中大图），后面的是点缀（左下、右下各一张小图，拼出「一屏都是」的感觉）
const ART: Record<SpecialGameId, string[]> = {
  chain_challenge: ['_thumbs/chain-neon.png'],
  tug_of_war: ['_thumbs/tug_of_war.png', 'tug_of_war/cake.png', 'tug_of_war/tomato.png'],
  bomb_defuse: ['_thumbs/bomb_defuse.png'],
  catch_duck: ['duck/duck_angle_1.png', 'duck/duck_angle_3.png', 'duck/duck_angle_5.png'],
  throw_poop: ['throw_poop/default.png'],
  throw_trash: ['throw_trash/burger.png', 'throw_trash/cola_plastic.png', 'throw_trash/old_shoe.png'],
  catch_bullet: ['catch_bullet/catch_bullet_default.png'],
  caterpillar: ['_thumbs/caterpillar.png'],
  fan_call: ['_thumbs/fan_call.png'],
  fan_video_call: ['_thumbs/fan_video_call.png'],
  talisman_seal: ['talisman_break/talisman_ivory.png', 'talisman_break/talisman_rose.png'],
  mosquito: ['mosquito/mosquito_pose_1.png', 'mosquito/mosquito_pose_3.png'],
  big_mosquito: ['big_mosquito/mosquito.png'],
  gesture_fly: ['gesture_fly/fly.png', 'gesture_fly/fly_crawl_1.png'],
  fruit_slice: ['fruit_slice/watermelon.png', 'fruit_slice/banana.png', 'fruit_slice/strawberry.png'],
  coin_bump: ['coin_bump/brick.png', 'coin_bump/coin.png'],
  leaf_pickup: ['leaf_pickup/leaf_sprite_03.png', 'leaf_pickup/leaf_sprite_06.png', 'leaf_pickup/leaf_sprite_01.png']
}

/** 卡片美术 URL（主图在前）；素材目录不在（开发机没拷素材）时返回空数组，卡片退回 emoji。 */
export function specialArtUrls(id: SpecialGameId, assetDir: string): string[] {
  return assetDir ? ART[id].map((rel) => `zlspecial://app/assets/${rel}`) : []
}

/** 预览舞台页面 */
export function specialPreviewUrl(id: SpecialGameId, version: number): string {
  return `zlspecial://app/preview/${id}.html?v=${version}`
}

/** 一条礼物规则里，触发某个玩法的动作（主动作或附加动作）；primary = 主动作就是它 */
export interface SpecialLink {
  rule: EntertainmentRule
  param: string
  primary: boolean
}

export function specialLinksOf(rules: EntertainmentRule[], id: SpecialGameId): SpecialLink[] {
  const out: SpecialLink[] = []
  for (const rule of rules) {
    const actions = ruleActions(rule)
    actions.forEach((a, i) => {
      if (a.actionType === 'command' && a.commandCmd === 'special-play' && parseSpecialParam(a.commandParam).id === id) {
        out.push({ rule, param: String(a.commandParam || ''), primary: i === 0 })
      }
    })
  }
  return out
}

/** 规则的触发描述：礼物名 / 关注 / 点赞 / 进场 / 弹幕「关键词」 */
export function triggerText(rule: EntertainmentRule): string {
  const t = rule.triggerType || 'gift'
  if (t === 'follow') return '关注'
  if (t === 'like') return '点赞'
  if (t === 'member') return '进场'
  if (t === 'comment') return rule.giftName ? `弹幕含「${rule.giftName}」` : '任意弹幕'
  return rule.giftName || '未填礼物'
}
