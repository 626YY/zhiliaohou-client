// 常用项仅控制编辑器显示；保存仍带全部参数，不改游戏里的默认值。
const BASIC_KEYS=new Set([
  'ShowHudMaster','ProtectStreamer','EasyMode','EasyLevel','SoundOn','SoundVolume','ShowVideoFx',
  'LikeBoxEnabled','LikeThreshold','LikeBoxThreshold','FollowBoxEnabled','FollowBoxEvery','BadgeBoxEnabled','BadgeBoxEvery',
  'WorkClockOn','WorkClockMinutes','Cooldown','ScareDuration','ScreenHints','HunterDuration','NukeQuits',
  'SlowSelfDur','HastenDur','FreezeDur','BossDur','ShelfGlow'
])
export function isBasicGameParameter(key:string){return BASIC_KEYS.has(key)}
