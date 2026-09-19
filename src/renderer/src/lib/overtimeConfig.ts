// 加班器配置：类型、默认值、存储键、以及转成计数挑战挂件配置的换算。
// 抽出来是为了让「挂件总控」能按加班器自己保存的配置把挂件开起来，和页面上点「开启」走同一套换算。
import type { CountChallengeConfig } from '@shared/types'

export const OVERTIME_LS = 'ent_overtime_cfg'

export interface OvertimeGift {
  name: string
  timeBefore: number // 操作随机区间起点（编辑框_计时_时间前N）
  timeAfter: number // 操作随机区间终点（编辑框_计时_时间后N）
  mode: '加减' | '乘以' | '除以' | '范围' | '清零'
  customText: string // 自定义文字（第2~6礼物）
  img: string
}

export interface OvertimeConfig {
  on: boolean
  plan: string // 插件配置加班
  title: string // 加班文字
  initial: number // 加班初始
  zeroText: string // 归零文字
  clockSpeed: number
  clockOn: boolean // 加班挑战(走秒)
  style: string // 加班挑战样式
  useCustomText: boolean // 是否自定文字
  showRecord: boolean // 选择框_加班显示记录
  showSeconds: boolean // 显示秒数
  showNegative: boolean // 显示负数
  giftShow: boolean // 显示礼物
  giftCount: number // 礼物数量 2/4/6
  gifts: OvertimeGift[]
  third: string // 面板第三行文字（原版可自填，老实现写死"我爱加班！我要996！"）
  posX: number
  posY: number
}

export const defaultOvertimeCfg: OvertimeConfig = {
  on: false,
  plan: '加班方案1',
  title: '我爱加班！我要996！',
  initial: 1800,
  zeroText: '30秒自动下播',
  clockSpeed: 1000,
  clockOn: true,
  style: '蓝黑梯形',
  useCustomText: false,
  showRecord: false,
  showSeconds: true,
  showNegative: false,
  giftShow: true,
  giftCount: 2,
  gifts: [
    { name: '头号神枪手', timeBefore: -1000, timeAfter: 1000, mode: '加减', customText: '盲盒', img: '' },
    { name: '苟住', timeBefore: 100, timeAfter: 300, mode: '加减', customText: '盲盒', img: '' },
    { name: '爱的纸鹤', timeBefore: 200, timeAfter: 2000, mode: '加减', customText: '盲盒', img: '' },
    { name: '比心兔兔', timeBefore: -500, timeAfter: 500, mode: '加减', customText: '盲盒', img: '' },
    { name: '礼花筒', timeBefore: -600, timeAfter: 600, mode: '加减', customText: '盲盒', img: '' },
    { name: '捏捏小脸', timeBefore: -1000, timeAfter: 6000, mode: '加减', customText: '盲盒', img: '' }
  ],
  third: '我爱加班！我要996！',
  posX: 200,
  posY: 30
}

export function readOvertimeCfg(): OvertimeConfig {
  try {
    const c = JSON.parse(localStorage.getItem(OVERTIME_LS) || '{}') as Partial<OvertimeConfig>
    return { ...defaultOvertimeCfg, ...c, gifts: Array.isArray(c.gifts) ? c.gifts : defaultOvertimeCfg.gifts }
  } catch {
    return defaultOvertimeCfg
  }
}

// 加班器复用计数挑战 H5；时间前/后是操作区间，不是两个相加的时段。
export function overtimeToChallengeCfg(cfg: OvertimeConfig): CountChallengeConfig {
  return {
    mode: 'timer',
    // 加班器占自己的挂件槽位，和计数挑战可以同时挂着，互不顶掉
    slot: 'overtime',
    style: cfg.style,
    on: cfg.on,
    title: cfg.title,
    initial: cfg.initial,
    zeroText: cfg.zeroText,
    clockSpeed: cfg.clockSpeed,
    clockOn: cfg.clockOn,
    countColor: 0,
    third: cfg.third,
    pauseText: '',
    showRecord: cfg.showRecord,
    gifts: cfg.gifts.slice(0, 6).map((g) => ({
      name: g.name,
      delta: '',
      img: g.img,
      op: g.mode,
      before: g.timeBefore,
      after: g.timeAfter,
      text: cfg.useCustomText ? g.customText : ''
    })),
    giftShow: cfg.giftShow,
    giftCount: [2, 4, 6].includes(cfg.giftCount) ? cfg.giftCount : 2,
    showLock: false,
    showNegative: cfg.showNegative,
    showSeconds: cfg.showSeconds,
    zeroHide: false,
    pauseAdjust: false,
    pauseGift: '',
    pauseTime: 0,
    hotkeys: [],
    mouseValue: 0,
    bgColor: '#000000',
    bgAlpha: 0.7,
    bgTransparent: cfg.style === '透明背景',
    posX: cfg.posX,
    posY: cfg.posY
  }
}
