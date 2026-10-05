import type { TimeWidgetConfig } from './types'
import { PET_REFERENCE_ART } from './petReferenceArt'

// 生图角色与可伸缩的时间/礼物面板分离；这里的尺寸、颜色和样式由编辑预览与真实输出共用。
export const PET_FRAME_W = 392
export const PET_ART_H = 124
export const PET_CLOCK_H = 103
export const PET_INSET = 32
export const PET_BORDER = 3
export const PET_BOTTOM = 16
const ATLAS_SIZE = 1254
const PET_GEOMETRY = { frameW:PET_FRAME_W,artH:PET_ART_H,clockH:PET_CLOCK_H,inset:PET_INSET,border:PET_BORDER,bottom:PET_BOTTOM,giftNameScale:1.375,giftTextScale:1.5 }

interface PetSkin {
  id: string; name: string; atlas: string; crop: readonly [number, number, number, number]
  side: 'left' | 'right'; mascotWidth: number; charm: 'bone' | 'flower' | 'fish' | 'moon' | 'berry' | 'bread' | 'orange' | 'planet'
  ink: string; fill: string; menu: string; line: string; accent: string; text: string; muted: string
  add: string; sub: string; box: string; dark?: boolean
  // 倒计时冒号圆点色 / 标题两侧小短线色（按设计稿取色）
  colon: string; deco: string
  material?: string
  original?: string // 已认可原稿，用于静态缩略图；运行时拆成独立图层。
  paintClock?: readonly [number,number] // 原画时间区顶部/菜单衔接线的纵坐标
  titleRightInset?: number // 角色伸进标题区时，在右侧保留的宽度比例
}

// 有设计稿的四款（奶油/双狗/桃猫/晚安猫）效果字、冒号、装饰色按设计稿像素取色；其余四款按自身主色配。
export const PET_COUNTDOWN_SKINS: readonly PetSkin[] = [
  { id:'pet_cream',name:'奶油小狗',atlas:'pets-classic.png',material:'frame-cream.png',crop:[40,211,542,339],side:'left',mascotWidth:190,charm:'bone',
    ink:'#39291f',fill:'#fffaf0',menu:'#fff1d8',line:'#ecd2a4',accent:'#edaa7c',text:'#2c1f17',muted:'#87654f',add:'#e5585e',sub:'#2f9ea6',box:'#9b66ea',colon:'#f9a3a3',deco:'#f78584' },
  { id:'pet_duo',name:'薄荷双狗',atlas:'pets-classic.png',material:'frame-duo.png',paintClock:[350,680],crop:[613,191,622,360],side:'right',mascotWidth:208,charm:'flower',
    ink:'#392b22',fill:'#fffdf1',menu:'#eaf7e4',line:'#bedbc2',accent:'#82b890',text:'#2b1f18',muted:'#5f7c65',add:'#e8565e',sub:'#23a0a6',box:'#8f61ec',colon:'#f68b95',deco:'#f56f88' },
  { id:'pet_peach',name:'桃桃小猫',atlas:'pets-classic.png',material:'frame-peach.png',paintClock:[410,720],crop:[56,785,523,338],side:'right',mascotWidth:177,charm:'fish',
    ink:'#482e2d',fill:'#fff9f2',menu:'#ffeae3',line:'#efbeb7',accent:'#e997ab',text:'#3a2423',muted:'#a16c73',add:'#e24e66',sub:'#2f9fa8',box:'#8f5ce6',colon:'#f798a0',deco:'#f77a7f' },
  { id:'pet_night',name:'晚安猫咪',atlas:'pets-classic.png',material:'frame-night.png',paintClock:[427,720],crop:[623,842,588,286],side:'left',mascotWidth:211,charm:'moon',
    ink:'#fff2d5',fill:'#343b55',menu:'#515573',line:'#7d79a0',accent:'#c2acee',text:'#fff8e4',muted:'#d3c8ed',add:'#f67375',sub:'#80dee8',box:'#c7a9ff',dark:true,colon:'#c9b6f5',deco:'#b9a8ea' },
  { id:'pet_berry',name:'草莓兔兔',atlas:'pets-stories.png',material:'frame-berry.png',paintClock:[369,693],titleRightInset:.4,crop:[43,205,569,388],side:'right',mascotWidth:169,charm:'berry',
    ink:'#492b2b',fill:'#fff9f4',menu:'#ffe9ec',line:'#f0b9c4',accent:'#dc7991',text:'#492b2b',muted:'#a66576',add:'#cf4f68',sub:'#2d8488',box:'#9062b2',colon:'#f095a6',deco:'#ec7f93' },
  { id:'pet_bakery',name:'面包仓鼠',atlas:'pets-stories.png',material:'frame-bakery.png',paintClock:[404,718],crop:[693,207,489,365],side:'left',mascotWidth:155,charm:'bread',
    ink:'#4a2d1b',fill:'#fff9ea',menu:'#f9ebd2',line:'#dfc092',accent:'#cf9455',text:'#4a2d1b',muted:'#937349',add:'#c66a4b',sub:'#37848a',box:'#8c69a6',colon:'#f2a48a',deco:'#ec8f72' },
  { id:'pet_onsen',name:'水豚温泉',atlas:'pets-stories.png',material:'frame-onsen.png',paintClock:[399,719],crop:[45,731,544,404],side:'right',mascotWidth:156,charm:'orange',
    ink:'#644631',fill:'#fffbee',menu:'#e2f4e9',line:'#abd1bb',accent:'#7fb797',text:'#533d30',muted:'#638976',add:'#d66b55',sub:'#247f84',box:'#8b65a7',colon:'#f19aa0',deco:'#ee8c93' },
  { id:'pet_space',name:'星际小猫',atlas:'pets-stories.png',material:'frame-space.png',paintClock:[399,720],crop:[665,731,563,411],side:'left',mascotWidth:158,charm:'planet',
    ink:'#c7bcf4',fill:'#2d3155',menu:'#525381',line:'#8982b7',accent:'#bdacf1',text:'#fff7e3',muted:'#d0c5ef',add:'#ffafb7',sub:'#9de5ec',box:'#e3c1ff',dark:true,colon:'#c9b6f5',deco:'#bfaaf2' }
]

export function petSkin(id: unknown): PetSkin | undefined {
  return PET_COUNTDOWN_SKINS.find(skin => skin.id === id)
}

function referenceArt(id:unknown) {
  return PET_REFERENCE_ART[id as keyof typeof PET_REFERENCE_ART]
}

// 四份已认可的原稿直接作为图层来源，保留其动物、尾巴、吊饰与小装饰的形状。
for(const skin of PET_COUNTDOWN_SKINS){
  const ref=referenceArt(skin.id)
  if(ref){skin.material=`reference-${ref.key}.svg`;skin.original=`reference-${ref.key}.png`;skin.paintClock=ref.clock}
}

function petGeometry(id:unknown) {
  const skin=petSkin(id)
  const ref=referenceArt(id)
  // 挂件所在一侧的原画外沿（相对裁切边界）；连接点沿着原画一起缩放。
  const charmEdges:Record<string,number>={pet_cream:28,pet_duo:32,pet_peach:33,pet_night:31,pet_berry:25,pet_bakery:31,pet_onsen:21,pet_space:23}
  return {...PET_GEOMETRY,reference:!!ref,painted:!!skin?.material,paintClock:skin?.paintClock||[405,720],paintBounds:ref?[128,64,1008,1000,1165]:[32,24,1190,1030,1204],menuInset:ref?52:60,
    charmEdge:ref?(ref.side==='left'?ref.anchor[0]-128:1136-ref.anchor[0]):charmEdges[skin?.id||'']||0,charmSide:ref?.side||(skin?.side==='left'?'right':'left'),
    charmBounds:ref?[...ref.charm.bounds]:[0,0,52,80],charmAnchor:ref?[...ref.anchor]:[26,11],giftNameScale:ref?1.5:PET_GEOMETRY.giftNameScale,giftTextScale:ref?1.625:PET_GEOMETRY.giftTextScale}
}

export function petWidgetMetrics(cfg: Partial<TimeWidgetConfig>, geometry = petGeometry(cfg.theme)) {
  const { frameW:PET_FRAME_W,artH:PET_ART_H,clockH:PET_CLOCK_H,inset:PET_INSET,border:PET_BORDER,bottom:PET_BOTTOM } = geometry
  const list = (cfg.gifts || []).filter(gift => gift?.name?.trim() && gift.showOnPanel !== false)
  const columns = [1,2,3].includes(Number(cfg.giftColumns)) ? Number(cfg.giftColumns) : 2
  const rows = cfg.giftPanel === false || !list.length ? 0 : Math.ceil(list.length / columns)
  const icon = Math.max(16, Math.min(96, Number(cfg.giftIconSize) || 42))*(geometry.reference?60:50)/42
  // 手写字体的可见字面偏小：保留现有字号设置，用皮肤字号比例补足可读性。
  const giftNameSize=Math.max(8,Math.min(40,Number(cfg.giftNameSize)||16))*geometry.giftNameScale
  const giftTextSize=Math.max(8,Math.min(40,Number(cfg.giftTextSize)||16))*geometry.giftTextScale
  const contentCellH = Math.ceil(Math.max(72, icon + 16, giftNameSize*(geometry.reference?1.3:1.1)+giftTextSize*(geometry.reference?1.32:1.2)+20))
  // 按放大后的文字预留宽度，不能先画窄格子再把礼物名缩回小字。
  const textW=Math.ceil(Math.max(72,...list.map(gift=>Math.max(
    Math.min(10,Array.from(gift.name).length)*giftNameSize,
    Math.min(10,gift.text?Array.from(gift.text).length:gift.mode==='blindbox'||gift.op==='清零'?2:
      Math.max(String(gift.seconds??30).length,String(gift.seconds2??'').length)*.65+(gift.seconds2!=null?4:2))*giftTextSize
  )+6)))
  const painted=geometry.painted
  const [paintCropX,paintCropY,paintWidth,paintFooterStart,paintBottom]=geometry.paintBounds
  const rawCharm = Number(cfg.charmScale)
  const charmScale = Number.isFinite(rawCharm) && rawCharm > 0 ? Math.max(.2, Math.min(2, rawCharm)) : .7
  // 32px覆盖扣环两侧最宽的半幅与倾角；扣除原画描边已留的空间。
  const charmInward=geometry.charmSide==='left'?geometry.charmBounds[2]-geometry.charmAnchor[0]:geometry.charmAnchor[0]-geometry.charmBounds[0]
  const charmReserveRatio=geometry.reference?Math.max(0,(charmInward*charmScale/.7+geometry.charmEdge-geometry.menuInset)/paintWidth):Math.max(20/(PET_FRAME_W-2*PET_INSET),32*charmScale/(PET_FRAME_W-2*PET_INSET)-(55-geometry.charmEdge)/paintWidth)
  // 描边和吊饰占位跟着原画，先扣除占位再求内容宽度，避免加宽/大吊饰压住第一列。
  const contentW=columns*(icon+16+10+textW)+columns-1
  const minimum = rows ? (painted?contentW/(1-2*geometry.menuInset/paintWidth-charmReserveRatio):contentW+20)+2*PET_INSET : PET_FRAME_W
  const widen = rows ? Math.max(1, Math.min(2.5, Number(cfg.giftPanelWidth) || 1)) : 1
  const headW = Math.ceil(Math.max(PET_FRAME_W * widen, minimum))-2*PET_INSET
  const paintSX=headW/paintWidth
  const frameScale=headW/(PET_FRAME_W-2*PET_INSET)
  // 原稿双列菜单每行约占框宽的19.5%；加宽后行高也跟随，避免四格菜单被压成横条。
  const cellH=Math.ceil(Math.max(contentCellH,painted?headW*.39/Math.max(2,columns):0))
  const giftH = rows ? rows * cellH + (rows - 1)*(geometry.reference?Math.max(1,6*paintSX):1) + 2 : 0
  const artH=painted?(geometry.paintClock[0]-paintCropY)*paintSX:PET_ART_H
  const clockSourceH=painted?(geometry.paintClock[1]-geometry.paintClock[0])*paintSX:PET_CLOCK_H
  // 计时区按认可原稿约占框宽32%。只延长空白直边，动物、圆角和底部装饰线保持等比。
  const clockH=painted&&!geometry.reference?Math.max(clockSourceH,headW*.32):clockSourceH
  const clockExtraH=clockH-clockSourceH
  const paintClockCut=(geometry.paintClock[0]+geometry.paintClock[1])/2
  // 圆角所在的底片保持与头片相同的缩放；仅中间直边随礼物行数伸缩。
  const footerH=painted?(paintBottom-paintFooterStart)*paintSX:0
  const menuH=giftH+(cfg.giftTicker?30:0)
  // 底角是贴底的背景，不是内容之外的一整块空白；最后一行进入底片中央。
  const menuOuterH=painted?Math.max(footerH,menuH+(menuH?14:0)):menuH
  const menuTop=!rows&&menuH?Math.max(0,menuOuterH-menuH-14):0
  const menuBottom=menuOuterH-menuH-menuTop
  const paintMiddleH=Math.max(0,menuOuterH-footerH)
  const frameHeight = artH+clockH+menuOuterH+(painted?0:PET_BORDER*2)+PET_BOTTOM
  const scale = Math.max(.4, Math.min(4, Number(cfg.scale) || 1))
  // 吊饰与原画用同一缩放基准；设置值仍是用户可调的相对倍率。
  // 沿用已有配置的0.70默认值作为原稿尺寸；旧测试包用户无需重调滑块。
  const charmRenderScale=geometry.reference?charmScale/.7:charmScale*(painted?frameScale:1)
  const charmW=geometry.reference?(geometry.charmBounds[2]-geometry.charmBounds[0])*paintSX:52
  const charmH=geometry.reference?(geometry.charmBounds[3]-geometry.charmBounds[1])*paintSX:80
  const charmAnchorTop=geometry.reference?(geometry.charmAnchor[1]-paintCropY)*paintSX:Math.min(artH+clockH-10,frameHeight-72)
  const height=Math.max(frameHeight,charmAnchorTop+charmH*charmRenderScale+4)
  // 最大吊饰和摆动也留在采集窗口里。空白外边距不参与框体/礼物的尺寸计算。
  const charmOutward=geometry.charmSide==='left'?geometry.charmAnchor[0]-geometry.charmBounds[0]:geometry.charmBounds[2]-geometry.charmAnchor[0]
  const charmPad=Math.ceil(geometry.reference?Math.max(20,(charmOutward*charmRenderScale-geometry.charmEdge)*paintSX+charmH*charmRenderScale*.06+4):Math.max(44,46*charmRenderScale-(geometry.charmEdge+5)*paintSX+4))
  const panelW=headW+20+charmPad
  return { w:Math.ceil(panelW * scale),h:Math.ceil(height * scale),rows,cellH,giftIconSize:icon,giftNameSize,giftTextSize,scale,panelW,headW:headW-(painted?0:2*PET_BORDER),height,artH,clockH,clockSourceH,clockExtraH,paintClockCut,footerH,menuH,menuOuterH,menuTop,menuBottom,paintMiddleH,paintSX,painted,reference:geometry.reference,paintCropX,paintCropY,paintWidth,paintFooterStart,menuInset:geometry.menuInset,paintHeaderEnd:geometry.paintClock[1],charmSide:geometry.charmSide,charmPad,charmW,charmH,charmLoopX:geometry.reference?(geometry.charmAnchor[0]-geometry.charmBounds[0])*paintSX:0,charmLoopY:geometry.reference?(geometry.charmAnchor[1]-geometry.charmBounds[1])*paintSX:0,charmReserve:headW*charmReserveRatio,charmAnchorTop,charmAnchorInset:painted?charmPad+(geometry.charmEdge+(geometry.reference?0:5))*paintSX:charmPad,charmScale:charmRenderScale }
}

// 传入完整几何参数，避免窗口脚本依赖打包器重命名后的模块闭包变量。
export function petWidgetMetricsSource(): string {
  const geometries=Object.fromEntries(PET_COUNTDOWN_SKINS.map(skin=>[skin.id,petGeometry(skin.id)]))
  return `(function(cfg){return (${petWidgetMetrics.toString()})(cfg,(${JSON.stringify(geometries)})[cfg.theme]||${JSON.stringify(petGeometry(''))})})`
}

export function petLayoutVariables(metrics:ReturnType<typeof petWidgetMetrics>):Record<string,string> {
  const sx=metrics.paintSX,sy=Math.max(.001,metrics.paintMiddleH/(metrics.paintFooterStart-metrics.paintHeaderEnd)),by=metrics.paintSX
  const left=metrics.menuInset*sx+(metrics.charmSide==='left'?metrics.charmReserve:0),right=metrics.menuInset*sx+(metrics.charmSide==='right'?metrics.charmReserve:0)
  const overlap=Math.max(1,1/metrics.scale)
  const clockFillSY=Math.max(.001,metrics.clockExtraH/32)
  return {'--pet-art-h':metrics.artH+'px','--pet-clock-h':metrics.clockH+'px','--pet-menu-h':metrics.menuH+'px','--pet-menu-outer-h':metrics.menuOuterH+'px','--pet-menu-bottom':metrics.menuBottom+'px','--pet-paint-mid-h':metrics.paintMiddleH+'px','--pet-footer-h':metrics.footerH+'px','--pet-cell-h':metrics.cellH+'px','--pet-charm-anchor-top':metrics.charmAnchorTop+'px','--pet-charm-anchor-inset':metrics.charmAnchorInset+'px','--pet-charm-scale':String(metrics.charmScale),
    '--pet-pad-left':(metrics.charmSide==='left'?metrics.charmPad:20)+'px','--pet-pad-right':(metrics.charmSide==='right'?metrics.charmPad:20)+'px',
    '--pet-menu-top':metrics.menuTop+'px',
    '--pet-charm-w':metrics.charmW+'px','--pet-charm-h':metrics.charmH+'px',...(metrics.reference?{'--pet-ref-loop-x':metrics.charmLoopX+'px','--pet-ref-loop-y':metrics.charmLoopY+'px'}:{}),
    '--pet-title-top':metrics.clockH*.11+'px','--pet-title-h':metrics.clockH*.25+'px','--pet-title-size':metrics.clockH*(metrics.reference?.20:.225)+'px',
    '--pet-time-top':metrics.clockH*(metrics.reference?.43:.415)+'px','--pet-time-h':metrics.clockH*(metrics.reference?.39:.46)+'px',
    '--pet-time-inset':metrics.reference?'10%':'12px','--pet-grid-width':metrics.reference?Math.max(1,6*sx)+'px':'1px',
    '--pet-clock-cut-h':metrics.artH+metrics.clockSourceH/2+'px','--pet-clock-fill-h':metrics.clockExtraH+'px','--pet-clock-end-h':metrics.clockSourceH/2+'px',
    '--pet-clock-fill-display':metrics.clockExtraH>0?'block':'none',
    '--pet-clock-fill-size':`${1254*sx}px ${1254*clockFillSY}px`,'--pet-clock-fill-pos':`${-metrics.paintCropX*sx}px ${overlap-metrics.paintClockCut*clockFillSY}px`,
    '--pet-clock-end-pos':`${-metrics.paintCropX*sx}px ${overlap-metrics.paintClockCut*sx}px`,
    '--pet-gift-name-size':metrics.giftNameSize+'px','--pet-gift-text-size':metrics.giftTextSize+'px',
    '--pet-menu-left':left+'px','--pet-menu-right':right+'px',
    '--pet-seam-overlap':overlap+'px',
    '--pet-menu-mask-bottom-pos':`${-metrics.paintCropX*sx}px ${metrics.paintMiddleH-metrics.paintFooterStart*sx}px`,
    '--pet-motion-left':-metrics.paintCropX*sx+'px','--pet-motion-top':-metrics.paintCropY*sx+'px','--pet-motion-size':1254*sx+'px',
    '--pet-paint-top-size':`${1254*sx}px ${1254*sx}px`,'--pet-paint-top-pos':`${-metrics.paintCropX*sx}px ${-metrics.paintCropY*sx}px`,
    '--pet-paint-mid-size':`${1254*sx}px ${1254*sy}px`,'--pet-paint-mid-pos':`${-metrics.paintCropX*sx}px ${overlap-metrics.paintHeaderEnd*sy}px`,
    '--pet-paint-bottom-size':`${1254*sx}px ${1254*by}px`,'--pet-paint-bottom-pos':`${-metrics.paintCropX*sx}px ${overlap-metrics.paintFooterStart*by}px`}
}

export function petDisplayTime(value:string):string {
  return value.replace(/^(-?)(\d{2}:\d{2})$/,(_all,sign,digits)=>sign+'00:'+digits)
}

export function petGiftText(gift:{text?:string;mode?:string;op?:string}, value:string):string {
  return !gift.text&&gift.mode!=='blindbox'&&(!gift.op||gift.op==='加减'||gift.op==='范围')?value+'秒':value
}

export function petFontCss(baseUrl:string):string {
  return `@font-face{font-family:PetDigits;src:url("${baseUrl}/fredoka-clock.ttf");font-weight:700 900;font-display:swap}@font-face{font-family:PetRounded;src:url("${baseUrl}/nunito-clock.ttf");font-weight:900;font-display:swap}@font-face{font-family:PetCjk;src:url("${baseUrl}/pet-round-cjk.woff2");font-weight:850;font-display:swap;ascent-override:100%;descent-override:20%;line-gap-override:0%}@font-face{font-family:PetTitle;src:url("${baseUrl}/zcool-title.ttf");font-weight:400;font-display:swap}`
}

// 标题两侧的三道放射小短线（设计稿「距离下播」两边的粉色短线）；颜色烘进 SVG（url() 里读不到 CSS 变量）。
function petTitleDeco(color: string): string {
  const c = encodeURIComponent(color)
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 26'%3E%3Cg stroke='${c}' stroke-width='3.4' stroke-linecap='round' fill='none'%3E%3Cpath d='M16 6.5 8 2.6'/%3E%3Cpath d='M16 13H6'/%3E%3Cpath d='M16 19.5 8 23.4'/%3E%3C/g%3E%3C/svg%3E")`
}

export function petSkinVariables(skin: PetSkin,materialUrl?:string): Record<string,string> {
  return {'--pet-ink':skin.ink,'--pet-fill':skin.fill,'--pet-menu':skin.menu,'--pet-line':skin.line,
    '--pet-accent':skin.accent,'--pet-text':skin.text,'--pet-muted':skin.muted,
    '--pet-colon':skin.colon,'--pet-title-deco':petTitleDeco(skin.deco),
    '--pet-title-stroke':referenceArt(skin.id)?'0px':'.55px','--pet-name-stroke':referenceArt(skin.id)?'0px':'.4px',
    '--pet-label-family':referenceArt(skin.id)?'PetCjk':'PetTitle','--pet-label-weight':referenceArt(skin.id)?'850':'400','--pet-name-line':referenceArt(skin.id)?'1.3':'1.1',
    '--pet-digit-family':referenceArt(skin.id)?'PetRounded':'PetDigits','--pet-digit-weight':'900',
    '--pet-title-spacing':referenceArt(skin.id)?'.04em':'0','--pet-title-deco-h':referenceArt(skin.id)?'1.05em':'.8em','--pet-title-deco-gap':referenceArt(skin.id)?'.5em':'.34em',
    '--pet-effect-line':referenceArt(skin.id)?'1.32':'1.2',
    '--pet-title-left':'8%','--pet-title-right':skin.titleRightInset?skin.titleRightInset*100+'%':'8%',
    '--pet-content-mask':materialUrl?`url("${materialUrl.replace(/\.(png|svg)$/,'.inner.svg')}")`:'none',
    '--pet-mascot-width':skin.mascotWidth+'px','--pet-mascot-ratio':skin.crop[2]+'/'+skin.crop[3],
    '--pet-pad-left':skin.side==='left'?'20px':'44px','--pet-pad-right':skin.side==='left'?'44px':'20px'}
}

const escapeAttribute = (value: string) => value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')

export function petMascotHtml(skin: PetSkin, atlasUrl: string, materialUrl?:string): string {
  if(skin.material&&materialUrl){
    const ref=referenceArt(skin.id)
    const motion=ref?`<div class="pet-reference-motion">${ref.layers.map((layer,index)=>{
      const clip=`pet-motion-${skin.id}-${index}`
      const [x,y,right,bottom]=layer.bounds,w=right-x,h=bottom-y
      return `<div class="pet-${layer.kind}" style="left:${x/1254*100}%;top:${y/1254*100}%;width:${w/1254*100}%;height:${h/1254*100}%;transform-origin:${(layer.pivot[0]-x)/w*100}% ${(layer.pivot[1]-y)/h*100}%;animation-delay:-${layer.delay}s"><svg viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="${clip}"><path d="${layer.path}"/></clipPath></defs><image clip-path="url(#${clip})" href="${escapeAttribute(materialUrl.replace(/\.svg$/,'.png'))}" width="1254" height="1254"/></svg></div>`
    }).join('')}</div>`:''
    return `<div class="pet-paint" data-pet-side="${skin.side}" ${ref?'data-pet-reference="'+ref.key+'"':''} style="--pet-paint:url(&quot;${escapeAttribute(materialUrl)}&quot;);--pet-paint-mask:url(&quot;${escapeAttribute(materialUrl.replace(/\.(png|svg)$/,'.mask.svg'))}&quot;)" aria-hidden="true">${motion}<div class="pet-paint-pet"></div><div class="pet-paint-head"></div><div class="pet-paint-clock-fill"></div><div class="pet-paint-clock-end"></div><div class="pet-paint-menu"></div><div class="pet-paint-foot"></div></div>`
  }
  const [x,y,w,h] = skin.crop
  return `<div class="pet-mascot" data-pet-side="${skin.side}" aria-hidden="true"><svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" overflow="hidden"><image href="${escapeAttribute(atlasUrl)}" x="${-x}" y="${-y}" width="${ATLAS_SIZE}" height="${ATLAS_SIZE}"/></svg></div>`
}

export function petCharmHtml(skin: PetSkin, atlasUrl?:string): string {
  const ref=referenceArt(skin.id)
  if(ref&&atlasUrl){
    const [x,y,right,bottom]=ref.charm.bounds,clip='pet-charm-reference-'+skin.id
    return `<div class="pet-charm-mount" data-pet-side="${ref.side}" data-pet-reference="${ref.key}" style="--pet-charm-loop-x:var(--pet-ref-loop-x);--pet-charm-loop-y:var(--pet-ref-loop-y)" aria-hidden="true"><span class="pet-charm-anchor"></span><svg class="pet-charm" data-charm="${skin.charm}" viewBox="${x} ${y} ${right-x} ${bottom-y}" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="${clip}"><path d="${ref.charm.path}"/></clipPath></defs><image clip-path="url(#${clip})" href="${escapeAttribute(atlasUrl.replace(/charms\.png$/,`reference-${ref.key}.png`))}" width="1254" height="1254"/></svg></div>`
  }
  const side=skin.side==='left'?'right':'left'
  const mount=(svg:string,loopX=26,loopY=11)=>`<div class="pet-charm-mount" data-pet-side="${side}" style="--pet-charm-loop-x:${loopX}px;--pet-charm-loop-y:${loopY}px" aria-hidden="true"><span class="pet-charm-anchor"></span>${svg}</div>`
  if(atlasUrl){
    const crops:Record<PetSkin['charm'],readonly [number,number,number,number]>={bone:[132,17,253,339],flower:[624,17,275,357],fish:[130,392,282,356],moon:[624,392,260,339],berry:[180,794,188,330],bread:[629,772,266,350],orange:[171,1156,205,338],planet:[587,1156,305,338]}
    const [x,y,w,h]=crops[skin.charm]
    const clipId='pet-charm-clip-'+skin.id
    const loops:Record<PetSkin['charm'],readonly [number,number]>={bone:[138,24],flower:[134,24],fish:[144,22],moon:[132,24],berry:[106,30],bread:[129,26],orange:[107,22],planet:[168,22]}
    const ratio=Math.min(52/w,80/h),[lx,ly]=loops[skin.charm]
    return mount(`<svg class="pet-charm" data-charm="${skin.charm}" data-pet-side="${side}" viewBox="0 0 ${w} ${h}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="${clipId}"><rect width="${w}" height="${h}"/></clipPath></defs><image clip-path="url(#${clipId})" href="${escapeAttribute(atlasUrl)}" x="${-x}" y="${-y}" width="1024" height="1536"/></svg>`,(52-w*ratio)/2+lx*ratio,(80-h*ratio)/2+ly*ratio)
  }
  const art: Record<PetSkin['charm'],string> = {
    bone:'<path d="M8 35C1 28 0 40 5 41C0 47 8 52 11 45L22 49C25 56 33 50 28 46C35 43 29 34 24 41L13 38Z" fill="var(--pet-menu)"/><path d="m15 64 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="var(--pet-charm-yellow)"/>',
    flower:'<path d="M13 40C1 28-4 47 8 47C-3 57 13 64 15 53C22 65 34 52 24 48C36 42 24 28 20 40C25 25 10 27 13 40Z" fill="var(--pet-charm-white)"/><circle cx="17" cy="46" r="5" fill="var(--pet-charm-yellow)"/>',
    fish:'<path d="M8 43Q6 29 17 29Q28 29 26 43L29 47H5Z" fill="var(--pet-charm-yellow)"/><path d="M14 51Q17 55 20 51" fill="none"/><path d="M10 69 3 65v12l7-5h15m-9-7v13m6-13v13" fill="none"/><circle cx="29" cy="70" r="5" fill="var(--pet-charm-white)"/>',
    moon:'<path d="M21 31C4 25-4 43 7 53C17 63 32 54 33 46C20 51 13 40 21 31Z" fill="var(--pet-charm-yellow)"/><path d="m14 67 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="var(--pet-charm-yellow)"/>',
    berry:'<path d="M17 37C-7 27-3 52 17 64C37 51 39 29 17 37Z" fill="var(--pet-charm-pink)"/><path d="M17 40 8 31l9 3 5-7 1 9 9-1-9 7Z" fill="var(--pet-charm-green)"/><path d="M9 45v2m8 4v2m9-9v2m-9 10v2" stroke="var(--pet-charm-white)"/>',
    bread:'<path d="M6 63V44C-6 33 7 26 17 30C30 24 43 36 31 45v18Z" fill="var(--pet-charm-yellow)"/><path d="M11 42h14v16H11Z" fill="var(--pet-charm-white)" stroke="none"/><path d="M14 48v1m9-1v1m-8 5q3 3 6 0" fill="none"/>',
    orange:'<path d="M17 35C-3 28-6 56 17 61C40 57 37 31 17 35Z" fill="var(--pet-charm-orange)"/><path d="M17 36Q19 22 30 29Q26 38 17 36Z" fill="var(--pet-charm-green)"/><path d="m9 43 1 1m3 10 1 1m10-7 1 1" stroke="var(--pet-charm-yellow)"/>',
    planet:'<circle cx="18" cy="46" r="13" fill="var(--pet-accent)"/><ellipse cx="18" cy="46" rx="24" ry="6" transform="rotate(25 18 46)" fill="none" stroke="var(--pet-charm-yellow)" stroke-width="4"/><path d="m16 70 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="var(--pet-charm-yellow)"/>'
  }
  return mount(`<svg class="pet-charm" data-pet-side="${side}" viewBox="-8 0 50 96" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g stroke="var(--pet-charm-ink)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M17 12V32" fill="none"/><path d="M17 13C-1-1-5 22 17 15C39 26 38-1 17 13Z" fill="var(--pet-accent)"/>${art[skin.charm]}</g></svg>`)
}

export const PET_COUNTDOWN_CSS = `
[data-pet-skin^="pet_"]{--pet-charm-white:#fffbed;--pet-charm-yellow:#ffe59b;--pet-charm-pink:#ed879a;--pet-charm-green:#80b987;--pet-charm-orange:#f3b45f;--pet-charm-ink:#473123;font-family:"Microsoft YaHei","Arial Rounded MT Bold",sans-serif}
[data-pet-skin^="pet_"] .pet-panel{position:relative;box-sizing:border-box;padding:0 var(--pet-pad-right,${PET_INSET}px) ${PET_BOTTOM}px var(--pet-pad-left,${PET_INSET}px);isolation:isolate}
[data-pet-skin^="pet_"] .pet-art{position:relative;height:var(--pet-art-h,${PET_ART_H}px);z-index:2;pointer-events:none}
[data-pet-skin^="pet_"] .pet-mascot{position:absolute;bottom:-9px;width:var(--pet-mascot-width);max-width:78%;aspect-ratio:var(--pet-mascot-ratio);transform-origin:50% 100%;animation:pet-breathe 5.8s ease-in-out infinite}
[data-pet-skin^="pet_"] .pet-mascot[data-pet-side="left"]{left:4px}
[data-pet-skin^="pet_"] .pet-mascot[data-pet-side="right"]{right:2px;animation-delay:-1.7s}
[data-pet-skin^="pet_"] .pet-mascot svg{display:block;width:100%;height:100%;overflow:hidden}
[data-pet-skin^="pet_"] .pet-surface{position:relative;overflow:hidden;box-sizing:border-box;border:${PET_BORDER}px solid var(--pet-ink);border-radius:29px 34px 30px 35px;background:var(--pet-menu);color:var(--pet-text)}
[data-pet-skin^="pet_"] .pet-clock{position:relative!important;width:100%!important;height:var(--pet-clock-h,${PET_CLOCK_H}px)!important;background:var(--pet-fill);border-radius:25px 29px 0 0;margin:0!important;overflow:hidden}
[data-pet-skin^="pet_"] .pet-clock::after{content:'';position:absolute;left:18px;right:18px;bottom:7px;height:2px;border-radius:99px;background:var(--pet-accent);opacity:.55;pointer-events:none}
[data-pet-skin^="pet_"] .pet-title{position:absolute;inset:10px var(--pet-title-right,12px) auto var(--pet-title-left,12px)!important;height:27px!important;display:block!important;text-align:center;font-family:var(--pet-label-family,PetTitle),"Microsoft YaHei",sans-serif;font-size:var(--pet-title-size,20px);line-height:var(--pet-title-h,27px);font-weight:var(--pet-label-weight,400);letter-spacing:var(--pet-title-spacing,0);text-shadow:none!important;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
[data-pet-skin^="pet_"] .pet-time{position:absolute;inset:39px var(--pet-time-inset,12px) auto!important;height:54px!important;display:flex;align-items:center;justify-content:center;font-family:var(--pet-digit-family,PetDigits),PetTitle,"Microsoft YaHei",sans-serif;font-weight:var(--pet-digit-weight,900);line-height:1;letter-spacing:1px;text-shadow:none!important;font-variant-numeric:tabular-nums;font-synthesis:none;overflow:hidden;white-space:nowrap}
[data-pet-skin^="pet_"] .pet-gifts{display:grid;border-top:2px solid var(--pet-line);box-sizing:content-box}
[data-pet-skin^="pet_"] .gift-cell{display:flex;align-items:center;box-sizing:border-box;gap:10px;padding:8px;min-width:0;height:var(--pet-cell-h,72px);border:0}
[data-pet-skin^="pet_"] .gift-icon{flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden}
[data-pet-skin^="pet_"] .gift-icon img{width:100%;height:100%;object-fit:contain}
[data-pet-skin^="pet_"] .gift-text{flex:1;min-width:0;display:grid;gap:4px}
[data-pet-skin^="pet_"] :is(.gift-name,.gift-effect){line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-shadow:none!important;font-synthesis:none}
[data-pet-skin^="pet_"] .gift-name{font-family:var(--pet-label-family,PetTitle),"Microsoft YaHei",sans-serif;font-weight:var(--pet-label-weight,400);line-height:var(--pet-name-line,1.1)}
[data-pet-skin^="pet_"] .pet-colon{color:var(--pet-colon,var(--pet-accent));padding:0 2px}
[data-pet-skin^="pet_"] .pet-time{line-height:.82!important;font-weight:var(--pet-digit-weight,900)!important}
[data-pet-skin^="pet_"] .pet-title{font-weight:var(--pet-label-weight,400)!important;-webkit-text-stroke:var(--pet-title-stroke,.55px) currentColor;paint-order:stroke fill;font-synthesis:none}
[data-pet-skin^="pet_"] .pet-title::before,[data-pet-skin^="pet_"] .pet-title::after{content:'';display:inline-block;width:.6em;height:var(--pet-title-deco-h,.8em);vertical-align:-.08em;background:var(--pet-title-deco) no-repeat center/contain}
[data-pet-skin^="pet_"] .pet-title::before{margin-right:var(--pet-title-deco-gap,.34em)}
[data-pet-skin^="pet_"] .pet-title::after{margin-left:var(--pet-title-deco-gap,.34em);transform:scaleX(-1)}
[data-pet-skin^="pet_"] .pet-title:empty::before,[data-pet-skin^="pet_"] .pet-title:empty::after{display:none}
[data-pet-skin^="pet_"] .gift-name{-webkit-text-stroke:var(--pet-name-stroke,.4px) currentColor;paint-order:stroke fill}
[data-pet-skin^="pet_"] .gift-effect{font-family:var(--pet-digit-family,PetDigits),var(--pet-label-family,PetTitle),"Microsoft YaHei",sans-serif;font-weight:var(--pet-digit-weight,700);line-height:var(--pet-effect-line,1.2)}
[data-pet-skin^="pet_"] .gift-divider{display:none}
[data-pet-skin^="pet_"] .pet-charm-mount{position:absolute;z-index:3;top:calc(var(--pet-charm-anchor-top) - var(--pet-charm-loop-y));width:var(--pet-charm-w,52px);height:var(--pet-charm-h,80px);pointer-events:none;transform:scale(var(--pet-charm-scale,1)) rotate(var(--pet-charm-tilt,0deg));transform-origin:var(--pet-charm-loop-x) var(--pet-charm-loop-y)}
[data-pet-skin^="pet_"] .pet-charm-mount[data-pet-side="left"]{--pet-charm-tilt:13deg}
[data-pet-skin^="pet_"] .pet-charm-mount[data-pet-side="right"]{--pet-charm-tilt:-13deg}
[data-pet-skin^="pet_"] .pet-charm-mount[data-pet-side="left"]{left:calc(var(--pet-charm-anchor-inset) - var(--pet-charm-loop-x))}
[data-pet-skin^="pet_"] .pet-charm-mount[data-pet-side="right"]{right:calc(var(--pet-charm-anchor-inset) - var(--pet-charm-w,52px) + var(--pet-charm-loop-x))}
[data-pet-skin^="pet_"] .pet-charm-anchor{position:absolute;left:var(--pet-charm-loop-x);top:var(--pet-charm-loop-y);width:0;height:0}
[data-pet-skin^="pet_"] .pet-charm{position:absolute;top:0;width:var(--pet-charm-w,52px);height:var(--pet-charm-h,80px);overflow:hidden;pointer-events:none;transform-origin:var(--pet-charm-loop-x) var(--pet-charm-loop-y);animation:pet-charm-sway 4.8s ease-in-out infinite}
[data-pet-skin^="pet_"] .pet-charm[data-pet-side="left"]{left:0}
[data-pet-skin^="pet_"] .pet-charm[data-pet-side="right"]{right:0}
[data-pet-skin^="pet_"] #ticker{box-sizing:border-box}
[data-pet-motion="off"] :is(.pet-mascot,.pet-paint-pet,.pet-charm,.pet-tail,.pet-heart,.pet-tail-lines){animation:none!important;transform:none!important}
.pet-thumbnail :is(.pet-mascot,.pet-paint-pet,.pet-charm){animation:none!important;transform:none!important}
[data-pet-material="painted"] .pet-art{z-index:0}
[data-pet-material="painted"] .pet-paint{position:absolute;inset:0 0 auto;pointer-events:none}
[data-pet-material="painted"] .pet-paint>div{background-image:var(--pet-paint);background-repeat:no-repeat;width:100%;mask-image:var(--pet-paint-mask);mask-repeat:no-repeat}
[data-pet-material="painted"] .pet-paint-pet{position:absolute;inset:0 0 auto;height:calc(var(--pet-art-h) + var(--pet-seam-overlap));background-size:var(--pet-paint-top-size);background-position:var(--pet-paint-top-pos);mask-size:var(--pet-paint-top-size);mask-position:var(--pet-paint-top-pos);transform-origin:50% 100%;animation:pet-painted-breathe 5.8s ease-in-out infinite}
[data-pet-reference]>.pet-paint-pet{animation:none!important;transform:none!important}
[data-pet-reference]>.pet-reference-motion{position:absolute;left:var(--pet-motion-left);top:var(--pet-motion-top);width:var(--pet-motion-size)!important;height:var(--pet-motion-size);background:none!important;mask:none!important;overflow:visible;z-index:0;pointer-events:none}
[data-pet-reference]>.pet-reference-motion>div{position:absolute;overflow:visible;will-change:transform}
[data-pet-reference]>.pet-reference-motion>div>svg{display:block;width:100%;height:100%;overflow:visible}
[data-pet-reference]>.pet-paint-pet,[data-pet-reference]>.pet-paint-head{z-index:1}
.pet-charm-mount[data-pet-reference]{--pet-charm-tilt:0deg!important}
.pet-tail{animation:pet-tail-wag 2.4s ease-in-out infinite;transform-box:view-box}
.pet-heart{animation:pet-heart-beat 2.4s ease-in-out infinite;transform-box:view-box}
.pet-tail-lines{animation:pet-tail-lines 2.4s ease-in-out infinite;transform-box:view-box}
[data-pet-material="painted"] .pet-paint-head{height:var(--pet-clock-cut-h);background-size:var(--pet-paint-top-size);background-position:var(--pet-paint-top-pos);clip-path:inset(var(--pet-art-h) 0 0)}
[data-pet-material="painted"] .pet-paint-clock-fill{display:var(--pet-clock-fill-display,block);margin-top:calc(-1*var(--pet-seam-overlap));height:calc(var(--pet-clock-fill-h) + var(--pet-seam-overlap));background-size:var(--pet-clock-fill-size);background-position:var(--pet-clock-fill-pos);mask-size:var(--pet-clock-fill-size);mask-position:var(--pet-clock-fill-pos)}
[data-pet-material="painted"] .pet-paint-clock-end{margin-top:calc(-1*var(--pet-seam-overlap));height:calc(var(--pet-clock-end-h) + var(--pet-seam-overlap));background-size:var(--pet-paint-top-size);background-position:var(--pet-clock-end-pos);mask-size:var(--pet-paint-top-size);mask-position:var(--pet-clock-end-pos)}
[data-pet-material="painted"] .pet-paint-menu{margin-top:calc(-1*var(--pet-seam-overlap));height:calc(var(--pet-paint-mid-h) + var(--pet-seam-overlap));background-size:var(--pet-paint-mid-size);background-position:var(--pet-paint-mid-pos)}
[data-pet-material="painted"] .pet-paint-foot{margin-top:calc(-1*var(--pet-seam-overlap));height:calc(var(--pet-footer-h) + var(--pet-seam-overlap));background-size:var(--pet-paint-bottom-size);background-position:var(--pet-paint-bottom-pos)}
[data-pet-material="painted"] .pet-paint-head{mask-size:var(--pet-paint-top-size);mask-position:var(--pet-paint-top-pos)}
[data-pet-material="painted"] .pet-paint-menu{mask-size:var(--pet-paint-mid-size);mask-position:var(--pet-paint-mid-pos)}
[data-pet-material="painted"] .pet-paint-foot{mask-size:var(--pet-paint-bottom-size);mask-position:var(--pet-paint-bottom-pos)}
.pet-menu-content{display:contents}
[data-pet-material="painted"] .pet-surface{z-index:1;background:transparent;border:0;border-radius:0;padding-bottom:0;overflow:visible}
[data-pet-material="painted"] .pet-menu-content{display:block;box-sizing:border-box;height:var(--pet-menu-outer-h);padding-top:var(--pet-menu-top,0px);padding-bottom:var(--pet-menu-bottom);mask-image:linear-gradient(white,white),var(--pet-content-mask);mask-repeat:no-repeat;mask-size:calc(100% - var(--pet-menu-left) - var(--pet-menu-right)) var(--pet-paint-mid-h),var(--pet-paint-bottom-size);mask-position:var(--pet-menu-left) 0,var(--pet-menu-mask-bottom-pos);mask-composite:add}
[data-pet-material="painted"] .pet-clock{background:transparent;border-radius:0}
[data-pet-material="painted"] .pet-clock::after{display:none}
[data-pet-material="painted"] .pet-title{top:var(--pet-title-top)!important;height:var(--pet-title-h)!important}
[data-pet-material="painted"] .pet-time{top:var(--pet-time-top)!important;height:var(--pet-time-h)!important}
[data-pet-material="painted"] .pet-gifts{padding:0 var(--pet-menu-right) 0 var(--pet-menu-left);border-top-color:transparent;box-sizing:border-box;background:transparent!important;clip-path:inset(0 var(--pet-menu-right) 0 var(--pet-menu-left))}
[data-pet-material="painted"] :is(#ticker,.pet-ticker){margin-left:var(--pet-menu-left);margin-right:var(--pet-menu-right);width:calc(100% - var(--pet-menu-left) - var(--pet-menu-right));border-radius:0}
[data-pet-material="painted"] .pet-gifts{gap:var(--pet-grid-width,1px)!important}
[data-pet-material="painted"] .gift-cell{--pet-h-line:var(--pet-line);--pet-v-line:var(--pet-line);box-shadow:var(--pet-grid-width,1px) 0 var(--pet-v-line),0 var(--pet-grid-width,1px) var(--pet-h-line)}
[data-pet-material="painted"] .gift-cell[data-last-row="true"]{--pet-h-line:transparent}
[data-pet-material="painted"] [data-columns="1"] .gift-cell,[data-pet-material="painted"] [data-columns="2"] .gift-cell:nth-child(2n),[data-pet-material="painted"] [data-columns="3"] .gift-cell:nth-child(3n){--pet-v-line:transparent}
[data-pet-menu-art="on"] .gift-cell{background:transparent!important}
@keyframes pet-breathe{0%,100%{transform:translateY(0) scaleY(1)}50%{transform:translateY(-1px) scaleY(1.015)}}
@keyframes pet-painted-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.014)}}
@keyframes pet-charm-sway{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}
@keyframes pet-tail-wag{0%,50%,100%{transform:rotate(0)}25%{transform:rotate(6deg)}75%{transform:rotate(-6deg)}}
/* 绿幕采集保持图形不透明，只做位移/缩放，避免粉色和描边混入绿色底。 */
@keyframes pet-heart-beat{0%,40%,100%{transform:scale(1)}20%{transform:scale(1.12)}65%{transform:scale(.98)}}
@keyframes pet-tail-lines{0%,50%,100%{transform:scale(.96)}25%,75%{transform:scale(1.04)}}
`
