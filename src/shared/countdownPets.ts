import type { TimeWidgetConfig } from './types'

// 生图角色与可伸缩的时间/礼物面板分离；这里的尺寸、颜色和样式由编辑预览与真实输出共用。
export const PET_FRAME_W = 392
export const PET_ART_H = 124
export const PET_CLOCK_H = 103
export const PET_INSET = 32
export const PET_BORDER = 3
export const PET_BOTTOM = 16
const ATLAS_SIZE = 1254
const PET_GEOMETRY = { frameW:PET_FRAME_W,artH:PET_ART_H,clockH:PET_CLOCK_H,inset:PET_INSET,border:PET_BORDER,bottom:PET_BOTTOM }

interface PetSkin {
  id: string; name: string; atlas: string; crop: readonly [number, number, number, number]
  side: 'left' | 'right'; mascotWidth: number; charm: 'bone' | 'flower' | 'fish' | 'moon' | 'berry' | 'bread' | 'orange' | 'planet'
  ink: string; fill: string; menu: string; line: string; accent: string; text: string; muted: string
  add: string; sub: string; box: string; dark?: boolean
  material?: string
  paintClock?: readonly [number,number] // 原画时间区顶部/菜单衔接线的纵坐标
}

export const PET_COUNTDOWN_SKINS: readonly PetSkin[] = [
  { id:'pet_cream',name:'奶油小狗',atlas:'pets-classic.png',material:'frame-cream.png',crop:[40,211,542,339],side:'left',mascotWidth:190,charm:'bone',
    ink:'#39291f',fill:'#fffaf0',menu:'#fff1d8',line:'#ecd2a4',accent:'#edaa7c',text:'#39291f',muted:'#87654f',add:'#d95c64',sub:'#287f87',box:'#8261b4' },
  { id:'pet_duo',name:'薄荷双狗',atlas:'pets-classic.png',material:'frame-duo.png',paintClock:[350,680],crop:[613,191,622,360],side:'right',mascotWidth:208,charm:'flower',
    ink:'#392b22',fill:'#fffdf1',menu:'#eaf7e4',line:'#bedbc2',accent:'#82b890',text:'#392b22',muted:'#5f7c65',add:'#cf626c',sub:'#247c82',box:'#8060ad' },
  { id:'pet_peach',name:'桃桃小猫',atlas:'pets-classic.png',material:'frame-peach.png',paintClock:[410,720],crop:[56,785,523,338],side:'right',mascotWidth:177,charm:'fish',
    ink:'#482e2d',fill:'#fff9f2',menu:'#ffeae3',line:'#efbeb7',accent:'#e997ab',text:'#482e2d',muted:'#a16c73',add:'#d65069',sub:'#277f8c',box:'#9461b6' },
  { id:'pet_night',name:'晚安猫咪',atlas:'pets-classic.png',material:'frame-night.png',paintClock:[427,720],crop:[623,842,588,286],side:'left',mascotWidth:211,charm:'moon',
    ink:'#fff2d5',fill:'#343b55',menu:'#515573',line:'#7d79a0',accent:'#c2acee',text:'#fff8e4',muted:'#d3c8ed',add:'#ffaaaa',sub:'#a1e4e3',box:'#dbbaff',dark:true },
  { id:'pet_berry',name:'草莓兔兔',atlas:'pets-stories.png',material:'frame-berry.png',paintClock:[369,693],crop:[43,205,569,388],side:'right',mascotWidth:169,charm:'berry',
    ink:'#492b2b',fill:'#fff9f4',menu:'#ffe9ec',line:'#f0b9c4',accent:'#dc7991',text:'#492b2b',muted:'#a66576',add:'#cf4f68',sub:'#2d8488',box:'#9062b2' },
  { id:'pet_bakery',name:'面包仓鼠',atlas:'pets-stories.png',material:'frame-bakery.png',paintClock:[404,718],crop:[693,207,489,365],side:'left',mascotWidth:155,charm:'bread',
    ink:'#4a2d1b',fill:'#fff9ea',menu:'#f9ebd2',line:'#dfc092',accent:'#cf9455',text:'#4a2d1b',muted:'#937349',add:'#c66a4b',sub:'#37848a',box:'#8c69a6' },
  { id:'pet_onsen',name:'水豚温泉',atlas:'pets-stories.png',material:'frame-onsen.png',paintClock:[399,719],crop:[45,731,544,404],side:'right',mascotWidth:156,charm:'orange',
    ink:'#644631',fill:'#fffbee',menu:'#e2f4e9',line:'#abd1bb',accent:'#7fb797',text:'#533d30',muted:'#638976',add:'#d66b55',sub:'#247f84',box:'#8b65a7' },
  { id:'pet_space',name:'星际小猫',atlas:'pets-stories.png',material:'frame-space.png',paintClock:[399,720],crop:[665,731,563,411],side:'left',mascotWidth:158,charm:'planet',
    ink:'#c7bcf4',fill:'#2d3155',menu:'#525381',line:'#8982b7',accent:'#bdacf1',text:'#fff7e3',muted:'#d0c5ef',add:'#ffafb7',sub:'#9de5ec',box:'#e3c1ff',dark:true }
]

export function petSkin(id: unknown): PetSkin | undefined {
  return PET_COUNTDOWN_SKINS.find(skin => skin.id === id)
}

function petGeometry(id:unknown) { const skin=petSkin(id);return {...PET_GEOMETRY,painted:!!skin?.material,paintClock:skin?.paintClock||[405,720]} }

export function petWidgetMetrics(cfg: Partial<TimeWidgetConfig>, geometry = petGeometry(cfg.theme)) {
  const { frameW:PET_FRAME_W,artH:PET_ART_H,clockH:PET_CLOCK_H,inset:PET_INSET,border:PET_BORDER,bottom:PET_BOTTOM } = geometry
  const list = (cfg.gifts || []).filter(gift => gift?.name?.trim() && gift.showOnPanel !== false)
  const columns = [1,2,3].includes(Number(cfg.giftColumns)) ? Number(cfg.giftColumns) : 2
  const rows = cfg.giftPanel === false || !list.length ? 0 : Math.ceil(list.length / columns)
  const icon = Math.max(16, Math.min(96, Number(cfg.giftIconSize) || 42))
  const cellH = Math.max(58, icon + 16, Math.max(Number(cfg.giftNameSize) || 16, Number(cfg.giftTextSize) || 16) * 2.5 + 16)
  // 大图标/三列时同步扩宽整块时间牌，保证名称至少留 4 个小字号汉字的位置。
  const minimum = rows ? columns * (icon + 16 + 8 + 44) + 2 * (PET_INSET + PET_BORDER) : PET_FRAME_W
  const widen = rows ? Math.max(1, Math.min(2.5, Number(cfg.giftPanelWidth) || 1)) : 1
  const panelW = Math.ceil(Math.max(PET_FRAME_W * widen, minimum))
  const giftH = rows ? rows * cellH + rows - 1 + 2 : 0
  const painted=geometry.painted
  const paintSX=(panelW-2*PET_INSET)/1190
  const artH=painted?(geometry.paintClock[0]-24)*paintSX:PET_ART_H
  const clockH=painted?(geometry.paintClock[1]-geometry.paintClock[0])*paintSX:PET_CLOCK_H
  const footerH=painted?26:0
  const menuH=giftH+(cfg.giftTicker?30:0)
  const height = artH+clockH+menuH+(painted?footerH:PET_BORDER*2)+PET_BOTTOM
  const scale = Math.max(.4, Math.min(4, Number(cfg.scale) || 1))
  return { w:Math.ceil(panelW * scale),h:Math.ceil(height * scale),rows,cellH,scale,panelW,headW:panelW-2*PET_INSET-(painted?0:2*PET_BORDER),height,artH,clockH,footerH,menuH,paintSX,painted,paintHeaderEnd:geometry.paintClock[1] }
}

// 传入完整几何参数，避免窗口脚本依赖打包器重命名后的模块闭包变量。
export function petWidgetMetricsSource(): string {
  const geometries=Object.fromEntries(PET_COUNTDOWN_SKINS.map(skin=>[skin.id,petGeometry(skin.id)]))
  return `(function(cfg){return (${petWidgetMetrics.toString()})(cfg,(${JSON.stringify(geometries)})[cfg.theme]||${JSON.stringify(petGeometry(''))})})`
}

export function petLayoutVariables(metrics:ReturnType<typeof petWidgetMetrics>):Record<string,string> {
  const sx=metrics.paintSX,sy=Math.max(.001,metrics.menuH/(1030-metrics.paintHeaderEnd)),by=26/174
  return {'--pet-art-h':metrics.artH+'px','--pet-clock-h':metrics.clockH+'px','--pet-menu-h':metrics.menuH+'px','--pet-footer-h':metrics.footerH+'px','--pet-cell-h':metrics.cellH+'px','--pet-charm-top':Math.min(metrics.artH+metrics.clockH-30,metrics.height-87)+'px',
    '--pet-paint-top-size':`${1254*sx}px ${1254*sx}px`,'--pet-paint-top-pos':`${-32*sx}px ${-24*sx}px`,
    '--pet-paint-mid-size':`${1254*sx}px ${1254*sy}px`,'--pet-paint-mid-pos':`${-32*sx}px ${-metrics.paintHeaderEnd*sy}px`,
    '--pet-paint-bottom-size':`${1254*sx}px ${1254*by}px`,'--pet-paint-bottom-pos':`${-32*sx}px ${-1030*by}px`}
}

export function petDisplayTime(value:string):string {
  return value.replace(/^(-?)(\d{2}:\d{2})$/,(_all,sign,digits)=>sign+'00:'+digits)
}

export function petGiftText(gift:{text?:string;mode?:string;op?:string}, value:string):string {
  return !gift.text&&gift.mode!=='blindbox'&&(!gift.op||gift.op==='加减'||gift.op==='范围')?value+'秒':value
}

export function petFontCss(baseUrl:string):string {
  return `@font-face{font-family:PetDigits;src:url("${baseUrl}/fredoka-clock.ttf");font-weight:700 900;font-display:swap}@font-face{font-family:PetTitle;src:url("${baseUrl}/zcool-title.ttf");font-weight:400;font-display:swap}`
}

export function petSkinVariables(skin: PetSkin): Record<string,string> {
  return {'--pet-ink':skin.ink,'--pet-fill':skin.fill,'--pet-menu':skin.menu,'--pet-line':skin.line,
    '--pet-accent':skin.accent,'--pet-text':skin.text,'--pet-muted':skin.muted,
    '--pet-mascot-width':skin.mascotWidth+'px','--pet-mascot-ratio':skin.crop[2]+'/'+skin.crop[3],
    '--pet-pad-left':skin.side==='left'?'20px':'44px','--pet-pad-right':skin.side==='left'?'44px':'20px'}
}

const escapeAttribute = (value: string) => value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')

export function petMascotHtml(skin: PetSkin, atlasUrl: string, materialUrl?:string): string {
  if(skin.material&&materialUrl)return `<div class="pet-paint" data-pet-side="${skin.side}" style="--pet-paint:url(&quot;${escapeAttribute(materialUrl)}&quot;);--pet-paint-mask:url(&quot;${escapeAttribute(materialUrl.replace(/\.png$/,'.mask.svg'))}&quot;)" aria-hidden="true"><div class="pet-paint-head"></div><div class="pet-paint-menu"></div><div class="pet-paint-foot"></div></div>`
  const [x,y,w,h] = skin.crop
  return `<div class="pet-mascot" data-pet-side="${skin.side}" aria-hidden="true"><svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" overflow="hidden"><image href="${escapeAttribute(atlasUrl)}" x="${-x}" y="${-y}" width="${ATLAS_SIZE}" height="${ATLAS_SIZE}"/></svg></div>`
}

export function petCharmHtml(skin: PetSkin, atlasUrl?:string): string {
  if(atlasUrl){
    const crops:Record<PetSkin['charm'],readonly [number,number,number,number]>={bone:[132,17,253,339],flower:[624,17,275,357],fish:[130,392,282,356],moon:[624,392,260,339],berry:[180,794,188,330],bread:[629,772,266,350],orange:[171,1156,205,338],planet:[587,1156,305,338]}
    const [x,y,w,h]=crops[skin.charm]
    return `<svg class="pet-charm" data-charm="${skin.charm}" data-pet-side="${skin.side==='left'?'right':'left'}" viewBox="0 0 ${w} ${h}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><image href="${escapeAttribute(atlasUrl)}" x="${-x}" y="${-y}" width="1024" height="1536"/></svg>`
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
  return `<svg class="pet-charm" data-pet-side="${skin.side === 'left' ? 'right' : 'left'}" viewBox="-8 0 50 96" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g stroke="var(--pet-charm-ink)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M17 12V32" fill="none"/><path d="M17 13C-1-1-5 22 17 15C39 26 38-1 17 13Z" fill="var(--pet-accent)"/>${art[skin.charm]}</g></svg>`
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
[data-pet-skin^="pet_"] .pet-title{position:absolute;inset:10px 12px auto!important;height:27px!important;display:flex;align-items:center;justify-content:center;font-family:PetTitle,"Microsoft YaHei",sans-serif;font-size:21px!important;line-height:1.25;font-weight:400;text-shadow:none!important;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
[data-pet-skin^="pet_"] .pet-time{position:absolute;inset:39px 12px auto!important;height:54px!important;display:flex;align-items:center;justify-content:center;font-family:PetDigits,PetTitle,"Microsoft YaHei",sans-serif;font-weight:900;line-height:1;letter-spacing:1px;text-shadow:none!important;font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap}
[data-pet-skin^="pet_"] .pet-gifts{display:grid;border-top:2px solid var(--pet-line);box-sizing:content-box}
[data-pet-skin^="pet_"] .gift-cell{display:flex;align-items:center;box-sizing:border-box;gap:8px;padding:8px;min-width:0;height:var(--pet-cell-h,58px);border:0}
[data-pet-skin^="pet_"] .gift-icon{flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden}
[data-pet-skin^="pet_"] .gift-icon img{width:100%;height:100%;object-fit:contain}
[data-pet-skin^="pet_"] .gift-text{flex:1;min-width:0}
[data-pet-skin^="pet_"] :is(.gift-name,.gift-effect){font-weight:800;line-height:1.25;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-shadow:none!important}
[data-pet-skin^="pet_"] .gift-name{font-family:PetTitle,"Microsoft YaHei",sans-serif;font-weight:400}
[data-pet-skin^="pet_"] .pet-colon{color:var(--pet-accent);padding:0 2px}
[data-pet-skin^="pet_"] .pet-time{line-height:.82!important;font-weight:900!important}
[data-pet-skin^="pet_"] .pet-title{font-weight:400!important}
[data-pet-skin^="pet_"] .gift-effect{font-family:PetDigits,PetTitle,"Microsoft YaHei",sans-serif;font-weight:900}
[data-pet-skin^="pet_"] .gift-divider{height:3px;opacity:0;margin:0}
[data-pet-skin^="pet_"] .pet-charm{position:absolute;z-index:3;top:var(--pet-charm-top,190px);width:52px;height:80px;overflow:hidden;pointer-events:none;transform-origin:50% 8%;animation:pet-charm-sway 4.8s ease-in-out infinite}
[data-pet-skin^="pet_"] .pet-charm[data-pet-side="left"]{left:5px}
[data-pet-skin^="pet_"] .pet-charm[data-pet-side="right"]{right:5px}
[data-pet-skin^="pet_"] #ticker{box-sizing:border-box}
[data-pet-motion="off"] :is(.pet-mascot,.pet-charm){animation:none!important;transform:none!important}
.pet-thumbnail .pet-mascot,.pet-thumbnail .pet-charm{animation:none!important}
[data-pet-material="painted"] .pet-art{z-index:0}
[data-pet-material="painted"] .pet-paint{position:absolute;inset:0 0 auto;pointer-events:none}
[data-pet-material="painted"] .pet-paint>div{background-image:var(--pet-paint);background-repeat:no-repeat;width:100%;mask-image:var(--pet-paint-mask);mask-repeat:no-repeat}
[data-pet-material="painted"] .pet-paint-head{height:calc(var(--pet-art-h) + var(--pet-clock-h));background-size:var(--pet-paint-top-size);background-position:var(--pet-paint-top-pos)}
[data-pet-material="painted"] .pet-paint-menu{height:var(--pet-menu-h);background-size:var(--pet-paint-mid-size);background-position:var(--pet-paint-mid-pos)}
[data-pet-material="painted"] .pet-paint-foot{height:var(--pet-footer-h);background-size:var(--pet-paint-bottom-size);background-position:var(--pet-paint-bottom-pos)}
[data-pet-material="painted"] .pet-paint-head{mask-size:var(--pet-paint-top-size);mask-position:var(--pet-paint-top-pos)}
[data-pet-material="painted"] .pet-paint-menu{mask-size:var(--pet-paint-mid-size);mask-position:var(--pet-paint-mid-pos)}
[data-pet-material="painted"] .pet-paint-foot{mask-size:var(--pet-paint-bottom-size);mask-position:var(--pet-paint-bottom-pos)}
[data-pet-material="painted"] .pet-surface{z-index:1;background:transparent;border:0;border-radius:0;padding-bottom:var(--pet-footer-h);overflow:visible}
[data-pet-material="painted"] .pet-clock{background:transparent;border-radius:0}
[data-pet-material="painted"] .pet-clock::after{display:none}
[data-pet-material="painted"] .pet-title{top:12px!important;height:26px!important}
[data-pet-material="painted"] .pet-time{top:33px!important;height:calc(var(--pet-clock-h) - 41px)!important}
[data-pet-material="painted"] .pet-gifts{padding:0 10px;border-top-color:transparent;box-sizing:border-box;background:transparent!important;clip-path:inset(0 9px)}
[data-pet-material="painted"] .gift-cell{--pet-h-line:var(--pet-line);--pet-v-line:var(--pet-line);box-shadow:1px 0 var(--pet-v-line),0 1px var(--pet-h-line)}
[data-pet-material="painted"] .gift-cell[data-last-row="true"]{--pet-h-line:transparent}
[data-pet-material="painted"] [data-columns="1"] .gift-cell,[data-pet-material="painted"] [data-columns="2"] .gift-cell:nth-child(2n),[data-pet-material="painted"] [data-columns="3"] .gift-cell:nth-child(3n){--pet-v-line:transparent}
[data-pet-menu-art="on"] .gift-cell{background:transparent!important}
@keyframes pet-breathe{0%,100%{transform:translateY(0) scaleY(1)}50%{transform:translateY(-1px) scaleY(1.015)}}
@keyframes pet-charm-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@media(prefers-reduced-motion:reduce){[data-pet-skin^="pet_"] :is(.pet-mascot,.pet-charm){animation:none!important}}
`
