// 倒计时挂件的面板美术（矢量版）。
// 原来用的是从参考软件 exe 里扒出来的 252×103 位图，放大到直播用的尺寸就糊，
// 而且标题条和时间条是连体直角的，跟参考图那种「分离 + 圆角 + 亮描边」差得远。
// 这里改成按参考图逐段重画的 SVG：任意缩放都清晰，配色还能整套换。

import { ADDITIONAL_WIDGET_SKINS, pluginSkinDecorationCss } from './widgetSkins'
import { PET_COUNTDOWN_SKINS } from './countdownPets'

export type CountdownFrameVariant = 'classic' | 'arena' | 'theatre' | 'arcade' | 'paper' | 'abyss' | 'aurora' | 'sakura' | 'ticket' | 'terminal' | typeof ADDITIONAL_WIDGET_SKINS[number]['id']

export const COUNTDOWN_DECORATION_CSS = pluginSkinDecorationCss(id => `:is(.countdown-motion-head[data-countdown-theme="${id}"],body[data-theme="${id}"] #head)`)

export interface CountdownFrameStyle {
  variant?: CountdownFrameVariant // 缺省保留旧版面板结构
  stroke: string // 描边色（主题主色）
  fill: string // 条内填充色
  fillAlpha: number // 填充透明度
  strokeWidth: number
  glow: boolean // 描边发光
}

export interface CountdownTheme {
  id: string
  name: string
  style: CountdownFrameStyle
  titleColor: string
  timeColor: string
  // 礼物栏配色跟着主题走，用户仍可单独覆盖
  giftNameColor: string
  addColor: string
  subColor: string
  boxColor: string
  cellBg: string
  cellBorder: string
}

// 面板基准尺寸：标题条 + 时间条，按参考图的比例定的（原图 252×103：标题梯形 y9-50 高42、时间条 y51-98 高48）
export const FRAME_W = 252
export const FRAME_H = 103

const TITLE_TOP = 9
const TITLE_H = 42
// 时间牌顶 = 标题牌底：连体无缝（用户定版：中间不要透明区域）
const TIME_TOP = TITLE_TOP + TITLE_H
// 时间牌一直顶到面板最底（用户定版：下面礼物板要整块无缝，不留透明条）
const TIME_H = FRAME_H - TIME_TOP

function rgba(hex: string, alpha: number): string {
  const value = String(hex || '#333333').replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return `rgba(51,51,51,${alpha})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 面板美术：上面一条直角梯形标题牌，下面一条直角时间牌（用户定版：不要圆角）。 */
export function countdownFrameSvg(style: CountdownFrameStyle): string {
  const variant = variantFrameSvg(style)
  if (variant) return variant
  const sw = Math.max(1, style.strokeWidth)
  const fill = rgba(style.fill, style.fillAlpha)
  const half = sw / 2
  // 直角梯形：上边窄、下边宽，斜边是直线（照原图实测：上内缩 39/42，下内缩 25/27）
  const topLeft = 39
  const topRight = FRAME_W - 42
  const bottomLeft = 25
  const bottomRight = FRAME_W - 27
  const title = [
    `M ${topLeft} ${TITLE_TOP + half}`,
    `H ${topRight}`,
    `L ${bottomRight} ${TITLE_TOP + TITLE_H}`,
    `H ${bottomLeft}`,
    'Z'
  ].join(' ')
  // 时间牌顶满到面板底：底部描边完整留在画面内，作为时间区与礼物区的分界线
  const plateH = FRAME_H - TIME_TOP - half
  const glow = style.glow
    ? `<filter id="cdglow" x="-30%" y="-30%" width="160%" height="160%">
<feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : ''
  const filter = style.glow ? ' filter="url(#cdglow)"' : ''
  return `<svg viewBox="0 0 ${FRAME_W} ${FRAME_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
<defs>${glow}</defs>
<g${filter}>
<rect x="${half + 2}" y="${TIME_TOP}" width="${FRAME_W - sw - 4}" height="${plateH}" fill="${fill}" stroke="${style.stroke}" stroke-width="${sw}"/>
<path d="${title}" fill="${fill}" stroke="${style.stroke}" stroke-width="${sw}" stroke-linejoin="miter"/>
</g>
</svg>`
}

// 新结构只装饰文字安全区外侧，标题/数字位置与旧主题共用 FRAME_LAYOUT。
// 各面板底色一直铺到 y=103，接礼物板时不会出现透明横缝。
function variantFrameSvg(style: CountdownFrameStyle): string | undefined {
  const variant = style.variant
  if (!variant || variant === 'classic') return undefined
  const color = (value: string, fallback: string) => /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value : fallback
  const accent = color(style.stroke, '#c9a96e')
  const base = color(style.fill, '#14171e')
  const alpha = Number.isFinite(style.fillAlpha) ? Math.min(1, Math.max(0, style.fillAlpha)) : 1
  const fill = rgba(base, alpha)
  const sw = Number.isFinite(style.strokeWidth) ? Math.min(3, Math.max(0.75, style.strokeWidth)) : 1
  let artwork = ''
  switch (variant) {
    case 'nebula':
      artwork = `<defs><linearGradient id="star-rim"><stop stop-color="${accent}"/><stop offset=".5" stop-color="#91dce8"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
<path d="M22 9H252V81L230 103H0V31Z" fill="${fill}"/><path d="M22 10H251V81L230 102H1V31Z" fill="none" stroke="url(#star-rim)"/>
<path d="M27 14H210M42 50H210M12 98H222" stroke="url(#star-rim)" stroke-opacity=".65"/>
<ellipse cx="23" cy="31" rx="14" ry="6" transform="rotate(-40 23 31)" fill="none" stroke="${accent}"/><circle cx="23" cy="31" r="3" fill="${accent}"/>
<path d="M228 21L231 28L238 31L231 34L228 41L225 34L218 31L225 28Z" fill="${accent}" fill-opacity=".55"/>
<path d="M6 55V84M246 54V77" stroke="${accent}" stroke-opacity=".4"/>`
      break
    case 'sunset':
      artwork = `<path d="M24 9H228Q252 9 252 33V103H0V33Q0 9 24 9Z" fill="${fill}"/>
<path d="M1 103V33Q1 10 24 10H228Q251 10 251 33V103" stroke="${accent}" fill="none"/>
<path d="M14 36A11 11 0 0 1 36 36Z" fill="${accent}" fill-opacity=".65"/><path d="M13 40H37M17 44H33M216 22H236M220 26H240M224 30H244" stroke="${accent}" stroke-opacity=".55"/>
<path d="M12 50H240M0 99H252M0 102H252" stroke="${accent}" stroke-opacity=".45"/>
<path d="M5 67Q9 71 5 75T5 91M247 67Q243 71 247 75T247 91" fill="none" stroke="${accent}" stroke-opacity=".4"/>`
      break
    case 'gilded':
      artwork = `<defs><linearGradient id="gilded-rim" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset=".5" stop-color="#fff3d1"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
<path d="M0 9H230L252 31V103H22L0 81Z" fill="${fill}"/><path d="M1 10H230L251 31V102H22L1 81Z" fill="none" stroke="url(#gilded-rim)" stroke-width="1.5"/>
<path d="M6 14H224L246 36M246 98H28L6 76M20 50H232" fill="none" stroke="${accent}" stroke-opacity=".55"/>
<path d="M17 22L27 31L17 40L22 31ZM233 22L223 31L233 40L228 31Z" fill="url(#gilded-rim)"/>
<path d="M40 12H110M142 12H214M8 60V70M244 61V82" stroke="${accent}" stroke-opacity=".4"/>`
      break
    case 'glacier':
      artwork = `<path d="M16 9H232L252 29V103H0V25Z" fill="${fill}"/><path d="M16 10H232L251 29V102H1V25Z" stroke="${accent}" stroke-opacity=".6" fill="none"/>
<path d="M232 9V29H252M0 25L16 9V25ZM0 87L16 103H0Z" fill="${accent}" fill-opacity=".12"/>
<path d="M22 21L30 29L22 37L14 29ZM221 31L229 39L237 31" stroke="${accent}" stroke-opacity=".55" fill="none"/>
<path d="M14 50H238M0 99H252" stroke="${accent}" stroke-opacity=".35"/><path d="M6 58V85M246 58V93" stroke="${accent}" stroke-opacity=".2"/>`
      break
    case 'graphite':
      artwork = `<path d="M6 9H246Q252 9 252 15V103H0V15Q0 9 6 9Z" fill="${fill}"/><path d="M1 103V15Q1 10 6 10H246Q251 10 251 15V103M1 50H251" fill="none" stroke="${accent}" stroke-opacity=".55"/>
<path d="M16 23V37M22 19V41M28 23V37M224 23V37M230 19V41M236 23V37" stroke="${accent}" stroke-width="2" stroke-opacity=".75"/>
<path d="M10 14H42M210 14H242M5 59V93M247 59V93" stroke="${accent}" stroke-opacity=".35"/>
<path d="M10 99H58M194 99H242" stroke="${accent}" stroke-dasharray="2 4" stroke-width="2"/>`
      break
    case 'aurora':
      artwork = `<defs><linearGradient id="aurora-band"><stop stop-color="${accent}"/><stop offset="1" stop-color="#b3b4f7"/></linearGradient></defs>
<path d="M20 9H252V83L232 103H0V29Z" fill="${fill}"/><path d="M20 10H251V83L232 102H1V29Z" fill="none" stroke="${accent}"/>
<path d="M23 13H231M20 50H232M6 98H220" stroke="url(#aurora-band)" stroke-width="2"/>
<path d="M8 26L15 19M8 32L21 19M231 93L243 81M237 93L243 87" stroke="${accent}" stroke-width="1.5"/>
<circle cx="237" cy="27" r="6" fill="none" stroke="${accent}"/><circle cx="237" cy="27" r="2" fill="${accent}"/>`
      break
    case 'sakura': {
      const flower = (x:number,y:number) => `<g transform="translate(${x} ${y})" fill="${accent}" fill-opacity=".24"><ellipse cy="-4" rx="2.5" ry="4"/><ellipse cy="-4" rx="2.5" ry="4" transform="rotate(72)"/><ellipse cy="-4" rx="2.5" ry="4" transform="rotate(144)"/><ellipse cy="-4" rx="2.5" ry="4" transform="rotate(216)"/><ellipse cy="-4" rx="2.5" ry="4" transform="rotate(288)"/></g>`
      artwork = `<path d="M18 9H234Q252 9 252 27V103H0V27Q0 9 18 9Z" fill="${fill}"/>
<path d="M2 103V27Q2 11 18 11H234Q250 11 250 27V103" fill="none" stroke="${accent}" stroke-dasharray="2 3"/>
<path d="M24 50H112L126 55L140 50H228" fill="none" stroke="${accent}" stroke-opacity=".5"/>
${flower(20,28)}${flower(232,28)}<path d="M8 99H244" stroke="${accent}" stroke-opacity=".35"/>`
      break
    }
    case 'ticket':
      artwork = `<path d="M0 9H252V45Q244 45 244 51Q244 57 252 57V103H0V57Q8 57 8 51Q8 45 0 45Z" fill="${fill}"/>
<path d="M1 10H251M1 102H251M12 51H240" stroke="${accent}" stroke-dasharray="3 3"/>
<path d="M13 16V38M17 16V38M22 16V38M27 16V38M230 16V38M235 16V38M239 16V38" stroke="${accent}" stroke-width="1.3" opacity=".5"/>
<path d="M14 94H42M210 94H238" stroke="${accent}" stroke-width="2"/>`
      break
    case 'terminal':
      artwork = `<rect y="9" width="252" height="94" fill="${fill}"/><path d="M1 103V10H251V103M1 50H251" fill="none" stroke="${accent}" stroke-width="1"/>
<path d="M14 24L20 30L14 36M24 37H32M223 37H237" stroke="${accent}" stroke-width="2" fill="none"/>
<path d="M8 61V94H15M244 61V94H237" stroke="${accent}" stroke-opacity=".45" fill="none"/>
<path d="M8 13H42M210 13H244M0 102H252" stroke="${accent}" stroke-width="2"/>`
      break
    case 'arena': {
      const ticks = [60, 68, 76, 84, 92].map((y, i) => `<path d="M3 ${y}h${i % 2 ? 3 : 5}M249 ${y}h-${i % 2 ? 3 : 5}"/>`).join('')
      artwork = `<path d="M12 9H240L252 21V103H0V21Z" fill="${fill}"/>
<path d="M14 10H238L250 22V102H2V22Z" fill="none" stroke="${accent}" stroke-width="${sw}"/>
<path d="M28 10H224L220 14H32Z" fill="${accent}"/>
<path d="M0 47H20L24 51H228L232 47H252" fill="none" stroke="${accent}" stroke-width="1.5"/>
<path d="M16 24L21 29L16 34M23 24L28 29L23 34M236 24L231 29L236 34M229 24L224 29L229 34" fill="none" stroke="${accent}" stroke-width="2"/>
<g fill="none" stroke="${accent}" stroke-width="1" opacity=".6">${ticks}</g>
<path d="M0 100H22L25 103H0ZM252 100H230L227 103H252Z" fill="${accent}"/>`
      break
    }
    case 'theatre':
      artwork = `<defs><linearGradient id="cd-metal" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset=".45" stop-color="#fff1cf"/><stop offset=".7" stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity=".55"/></linearGradient></defs>
<rect y="9" width="252" height="94" fill="${fill}"/>
<path d="M1 103V10H251V103M6 103V15H246V103" fill="none" stroke="url(#cd-metal)" stroke-width="${sw}"/>
<path d="M10 12V27L30 12M16 12V20L26 12M242 12V27L222 12M236 12V20L226 12" fill="none" stroke="${accent}" stroke-width=".8"/>
<path d="M108 12H120L126 16L132 12H144M7 50H118L126 47L134 50H245" fill="none" stroke="${accent}" stroke-width="1"/>
<path d="M7 53H245" stroke="${accent}" stroke-opacity=".25"/>
<path d="M10 63V91M242 63V91" stroke="${accent}" stroke-width=".6" stroke-opacity=".55"/>
<path d="M0 102H252" stroke="url(#cd-metal)" stroke-width="2"/>`
      break
    case 'arcade':
      artwork = `<path d="M12 9H240V15H246V21H252V103H0V21H6V15H12Z" fill="${fill}"/>
<path d="M13 11H239V17H245V23H250V102H2V23H7V17H13Z" fill="none" stroke="${accent}" stroke-width="2" shape-rendering="crispEdges"/>
<path d="M19 13H233V16H19ZM3 47H33V50H219V47H249V53H3Z" fill="${accent}" shape-rendering="crispEdges"/>
<path d="M19 23H25V29H31V35H25V41H19V35H13V29H19ZM226 25H232V31H238V37H232V31H226V37H220V31H226Z" fill="${accent}"/>
<path d="M5 62H8V68H5ZM5 75H8V81H5ZM5 88H8V94H5ZM244 62H247V68H244ZM244 75H247V81H244ZM244 88H247V94H244Z" fill="${accent}" opacity=".45"/>
<path d="M0 101H252V103H0Z" fill="${accent}"/>`
      break
    case 'paper':
      artwork = `<path d="M0 9H234L252 27V103H0Z" fill="${fill}"/>
<path d="M234 9V27H252" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-width=".65"/>
<path d="M.5 103V9.5H233.5L251.5 27.5V103" fill="none" stroke="${accent}" stroke-opacity=".35" stroke-width="1"/>
<path d="M18 15V21M30 15V21M222 15V21" stroke="${accent}" stroke-width="2"/>
<path d="M14 27H31M14 31H26M224 35H239M224 39H234" stroke="${accent}" stroke-width="1" stroke-opacity=".45"/>
<path d="M12 50H240" stroke="${accent}" stroke-width="1"/>
<path d="M12 53H240M0 102.5H252" stroke="${accent}" stroke-width=".5" stroke-opacity=".3"/>
<path d="M7 59V96M245 59V96" stroke="${accent}" stroke-width=".65" stroke-dasharray="1 4" stroke-opacity=".3"/>`
      break
    case 'abyss': {
      const marks = [16, 22, 28, 34, 40].map((y, i) => `<path d="M${10 + (i % 2) * 3} ${y}H23M229 ${y}H${242 - (i % 2) * 3}"/>`).join('')
      artwork = `<path d="M18 9H234Q252 9 252 27V103H0V27Q0 9 18 9Z" fill="${fill}"/>
<path d="M1 103V28Q1 10 19 10H233Q251 10 251 28V103M5 103V28Q5 14 19 14H233Q247 14 247 28V103" fill="none" stroke="${accent}" stroke-width="${sw}" stroke-opacity=".7"/>
<g stroke="${accent}" stroke-width=".75" stroke-opacity=".5">${marks}</g>
<path d="M29 10V16M223 10V16M32 49H108L114 52H138L144 49H220" fill="none" stroke="${accent}" stroke-width="1"/>
<circle cx="126" cy="12" r="2" fill="${accent}"/>
<path d="M0 52H3L7 58V93L3 99H0M252 52H249L245 58V93L249 99H252" fill="none" stroke="${accent}" stroke-width=".6" stroke-opacity=".25"/>
<path d="M0 102H252" stroke="${accent}" stroke-width="2"/>
<path d="M8 66V87M244 66V87" stroke="${accent}" stroke-width="2"/>`
      break
    }
  }
  if (!artwork) return undefined
  return `<svg viewBox="0 0 ${FRAME_W} ${FRAME_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${artwork}</svg>`
}

export function frameDataUri(style: CountdownFrameStyle): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(countdownFrameSvg(style))
}

/** 面板底色（CSS 颜色）：抽时间记录窗口这类要跟倒计时皮肤联动的地方直接用这一份。 */
export function frameFillCss(style: CountdownFrameStyle): string {
  return rgba(style.fill, style.fillAlpha)
}

/** 标题/时间文字在面板里的位置（百分比），两端共用，保证预览和挂件一模一样。 */
export const FRAME_LAYOUT = {
  titleTop: (TITLE_TOP / FRAME_H) * 100,
  titleHeight: (TITLE_H / FRAME_H) * 100,
  timeTop: (TIME_TOP / FRAME_H) * 100,
  timeHeight: (TIME_H / FRAME_H) * 100,
  // 归零中文的字形比数字更满；留出装饰横线与描边的安全距离，不改原数字区。
  zeroTimeTop: ((TIME_TOP + 2) / FRAME_H) * 100,
  zeroTimeHeight: ((TIME_H - 10) / FRAME_H) * 100
}

// 主题：一套配色一个主题，礼物栏颜色跟着走。
// 0.3.60 去掉了最基础的「青蓝」（id '1'）：老配置里选着它的自动落到默认主题（DEFAULT_COUNTDOWN_THEME）。
export const COUNTDOWN_THEMES: CountdownTheme[] = [
  {
    id: '2',
    name: '橙金',
    style: { stroke: '#ffa726', fill: '#2f2a22', fillAlpha: 0.96, strokeWidth: 3, glow: true },
    titleColor: '#ffe0b2',
    timeColor: '#ffffff',
    giftNameColor: '#ffe9c9',
    addColor: '#ffd54f',
    subColor: '#4dd0e1',
    boxColor: '#ff8a65',
    cellBg: '#2a241d',
    cellBorder: '#4a3d2c'
  },
  {
    id: '3',
    name: '粉萌',
    style: { stroke: '#ff77c8', fill: '#3a2836', fillAlpha: 0.96, strokeWidth: 3, glow: true },
    titleColor: '#ffe4f4',
    timeColor: '#ffffff',
    giftNameColor: '#ffe4f4',
    addColor: '#ffb3de',
    subColor: '#8fe3ff',
    boxColor: '#ffd166',
    cellBg: '#2e2130',
    cellBorder: '#4a3350'
  },
  {
    id: '4',
    name: '紫电',
    style: { stroke: '#a97bff', fill: '#2a2440', fillAlpha: 0.96, strokeWidth: 3, glow: true },
    titleColor: '#e9deff',
    timeColor: '#ffffff',
    giftNameColor: '#e9deff',
    addColor: '#c9a4ff',
    subColor: '#7ee8fa',
    boxColor: '#ffd166',
    cellBg: '#241f38',
    cellBorder: '#3d3560'
  },
  {
    id: '5',
    name: '荧绿',
    style: { stroke: '#4be08a', fill: '#22322a', fillAlpha: 0.96, strokeWidth: 3, glow: true },
    titleColor: '#dcffe9',
    timeColor: '#ffffff',
    giftNameColor: '#dcffe9',
    addColor: '#9cff9c',
    subColor: '#5ad1ff',
    boxColor: '#ffe066',
    cellBg: '#1f2b24',
    cellBorder: '#33513f'
  },
  {
    id: '6',
    name: '烈焰红',
    style: { stroke: '#ff5252', fill: '#3a2323', fillAlpha: 0.96, strokeWidth: 3, glow: true },
    titleColor: '#ffdede',
    timeColor: '#ffffff',
    giftNameColor: '#ffdede',
    addColor: '#ff8a80',
    subColor: '#4dd0e1',
    boxColor: '#ffd54f',
    cellBg: '#2c1f1f',
    cellBorder: '#4d3030'
  },
  {
    id: '7',
    name: '极简白',
    style: { stroke: '#ffffff', fill: '#101014', fillAlpha: 0.9, strokeWidth: 2, glow: false },
    titleColor: '#ffffff',
    timeColor: '#ffffff',
    giftNameColor: '#ffffff',
    addColor: '#ffd166',
    subColor: '#8fe3ff',
    boxColor: '#ffffff',
    cellBg: '#17171c',
    cellBorder: '#2e2e36'
  },
  {
    id: '8',
    name: '纯透明',
    style: { stroke: '#ffffff', fill: '#000000', fillAlpha: 0, strokeWidth: 0, glow: false },
    titleColor: '#ffffff',
    timeColor: '#ffffff',
    giftNameColor: '#ffffff',
    addColor: '#ff9a3c',
    subColor: '#3fe0d0',
    boxColor: '#f5c542',
    cellBg: '#000000',
    cellBorder: '#000000'
  },
  {
    id: 'arena', name: '赛场计时',
    style: { variant: 'arena', stroke: '#fa7751', fill: '#171b24', fillAlpha: 1, strokeWidth: 1.5, glow: false },
    titleColor: '#ffe6d8', timeColor: '#ffffff', giftNameColor: '#edf1f7',
    addColor: '#ffad74', subColor: '#72d2df', boxColor: '#ffd38a', cellBg: '#171b24', cellBorder: '#4b342e'
  },
  {
    id: 'theatre', name: '黑金剧场',
    style: { variant: 'theatre', stroke: '#b99a61', fill: '#171716', fillAlpha: 1, strokeWidth: 0.9, glow: false },
    titleColor: '#dcc39a', timeColor: '#fff3d9', giftNameColor: '#e7dcc7',
    addColor: '#e9c774', subColor: '#91c7c7', boxColor: '#e6bba2', cellBg: '#171716', cellBorder: '#524834'
  },
  {
    id: 'arcade', name: '像素街机',
    style: { variant: 'arcade', stroke: '#b7a0ff', fill: '#201b35', fillAlpha: 1, strokeWidth: 2, glow: false },
    titleColor: '#ded0ff', timeColor: '#ffffff', giftNameColor: '#e8e0ff',
    addColor: '#ffd278', subColor: '#79e0ce', boxColor: '#f8a2ca', cellBg: '#201b35', cellBorder: '#665482'
  },
  {
    id: 'paper', name: '白纸日程',
    style: { variant: 'paper', stroke: '#475768', fill: '#f6f3eb', fillAlpha: 1, strokeWidth: 1, glow: false },
    titleColor: '#151515', timeColor: '#151515', giftNameColor: '#151515',
    addColor: '#8b4c2d', subColor: '#2f6571', boxColor: '#695278', cellBg: '#f6f3eb', cellBorder: '#c8c9c5'
  },
  {
    id: 'abyss', name: '深海仪表',
    style: { variant: 'abyss', stroke: '#73b8bd', fill: '#10292f', fillAlpha: 1, strokeWidth: 0.8, glow: false },
    titleColor: '#b6e0dc', timeColor: '#edfcf3', giftNameColor: '#d5eeeb',
    addColor: '#e7ce8b', subColor: '#94d2ea', boxColor: '#d8b2d6', cellBg: '#10292f', cellBorder: '#38626a'
  },
  { id:'aurora',name:'极光航站',style:{variant:'aurora',stroke:'#87ddea',fill:'#102b35',fillAlpha:1,strokeWidth:1,glow:false},titleColor:'#bfeaf0',timeColor:'#edfaff',giftNameColor:'#edfaff',addColor:'#e7ce8b',subColor:'#87ddea',boxColor:'#d0bafa',cellBg:'#102b35',cellBorder:'#477783' },
  { id:'sakura',name:'樱花来信',style:{variant:'sakura',stroke:'#a73e67',fill:'#fff3f5',fillAlpha:1,strokeWidth:1,glow:false},titleColor:'#52283d',timeColor:'#52283d',giftNameColor:'#52283d',addColor:'#a73e67',subColor:'#366772',boxColor:'#76518a',cellBg:'#fff3f5',cellBorder:'#c486a0' },
  { id:'ticket',name:'午夜车票',style:{variant:'ticket',stroke:'#ac8152',fill:'#f5eddb',fillAlpha:1,strokeWidth:1,glow:false},titleColor:'#493828',timeColor:'#493828',giftNameColor:'#493828',addColor:'#8d4830',subColor:'#386672',boxColor:'#715084',cellBg:'#f5eddb',cellBorder:'#b7a38a' },
  { id:'terminal',name:'复古终端',style:{variant:'terminal',stroke:'#b1d58d',fill:'#1d2a21',fillAlpha:1,strokeWidth:1,glow:false},titleColor:'#cce6b8',timeColor:'#f0f9e7',giftNameColor:'#e0ebd7',addColor:'#e6ce84',subColor:'#99c6cf',boxColor:'#d5b4d3',cellBg:'#1d2a21',cellBorder:'#56734e' },
  ...PET_COUNTDOWN_SKINS.map((skin): CountdownTheme => ({
    id:skin.id,name:skin.name,
    style:{variant:'paper',stroke:skin.ink,fill:skin.fill,fillAlpha:1,strokeWidth:2,glow:false},
    titleColor:skin.dark?skin.accent:skin.text,timeColor:skin.text,giftNameColor:skin.text,
    addColor:skin.add,subColor:skin.sub,boxColor:skin.box,cellBg:skin.menu,cellBorder:skin.line
  })),
  ...ADDITIONAL_WIDGET_SKINS.map((skin): CountdownTheme => ({
    id: skin.id, name: skin.name,
    style: { variant: skin.id, stroke: skin.accent, fill: skin.bg, fillAlpha: 1, strokeWidth: 1, glow: false },
    titleColor: skin.accent, timeColor: skin.text, giftNameColor: skin.text,
    addColor: skin.accent, subColor: skin.muted, boxColor: skin.accent, cellBg: skin.bg, cellBorder: skin.line
  }))

]

/** 默认 / 兜底主题：黑金剧场（画廊第一款） */
export const DEFAULT_COUNTDOWN_THEME = 'theatre'
export function themeById(id: string | undefined): CountdownTheme {
  return COUNTDOWN_THEMES.find((theme) => theme.id === String(id)) || COUNTDOWN_THEMES.find((theme) => theme.id === DEFAULT_COUNTDOWN_THEME) || COUNTDOWN_THEMES[0]
}
