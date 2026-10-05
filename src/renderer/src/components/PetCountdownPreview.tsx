import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { TimeWidgetConfig, TimeWidgetGift } from '@shared/types'
import { drawPetTimeText, fitPetLabels } from '@shared/petTimeText'
import { PET_COUNTDOWN_CSS, petCharmHtml, petMascotHtml, petSkin, petSkinVariables, petLayoutVariables, petDisplayTime, petGiftText, petFontCss, petWidgetMetrics } from '@shared/countdownPets'

type Props = {
  config:TimeWidgetConfig; value:string; zeroed:boolean
  giftImage:(gift:TimeWidgetGift)=>string
  giftText:(gift:TimeWidgetGift)=>string
  giftColor:(gift:TimeWidgetGift)=>string
  background?:string
}

function atlasUrl(file:string):string {
  return new URL('pet-skins/'+file, document.baseURI).href
}

export function PetSkinThumbnail({ id }:{id:string}) {
  const skin=petSkin(id)
  if(!skin)return null
  const [x,y,w,h]=skin.crop
  const left=skin.side==='left'?20:130
  const [clockTop,clockEnd]=skin.paintClock||[405,720]
  const clockHeight=clockEnd-clockTop
  const metrics=petWidgetMetrics({theme:id})
  const titleX=skin.titleRightInset?32+metrics.headW*(.08+1-skin.titleRightInset)/2/metrics.paintSX:627
  if(skin.original)return <svg className="block w-full" viewBox="0 0 1254 765" aria-hidden="true"><image href={atlasUrl(skin.original)} width="1254" height="1254"/></svg>
  if(skin.material)return <svg className="block w-full" viewBox="0 0 1254 765" aria-hidden="true">
    <image href={atlasUrl(skin.material)} x="0" y="0" width="1254" height="1254"/>
    <text x={titleX} y={clockTop+clockHeight*.30} textAnchor="middle" fontFamily="PetTitle,Microsoft YaHei" fontSize={clockHeight*.19} fill={skin.text}>距离下播</text>
    <text x="627" y={clockTop+clockHeight*.86} textAnchor="middle" fontFamily="PetDigits,Microsoft YaHei" fontSize={clockHeight*.67} fontWeight="900" fill={skin.text}>00:25:36</text>
  </svg>
  return <svg className="block w-full" viewBox="0 0 360 235" aria-hidden="true">
    <rect x="15" y="104" width="330" height="116" rx="30" fill={skin.fill} stroke={skin.ink} strokeWidth="4"/>
    <path d="M35 210H325" stroke={skin.accent} strokeWidth="3"/>
    <svg x={left} y="0" width="210" height="122" viewBox={`0 0 ${w} ${h}`} overflow="hidden">
      <image href={atlasUrl(skin.atlas)} x={-x} y={-y} width="1254" height="1254"/>
    </svg>
    <text x="180" y="151" textAnchor="middle" fontSize="21" fontWeight="700" fill={skin.muted}>距离下播</text>
    <text x="180" y="193" textAnchor="middle" fontSize="39" fontWeight="800" fill={skin.text}>25:36</text>
  </svg>
}

export default function PetCountdownPreview({config,value,zeroed,giftImage,giftText,giftColor,background}:Props) {
  const skin=petSkin(config.theme)!
  const metrics=petWidgetMetrics(config)
  const host=useRef<HTMLDivElement>(null)
  const surface=useRef<HTMLDivElement>(null)
  const digits=useRef<HTMLDivElement>(null)
  const measureContext=useRef<CanvasRenderingContext2D|null>(null)
  const [scale,setScale]=useState(1)
  const gifts=(config.gifts||[]).filter(gift=>gift.name.trim()&&gift.showOnPanel!==false)
  const variables={...petSkinVariables(skin,skin.material?atlasUrl(skin.material):undefined),...petLayoutVariables(metrics),'--pet-line':config.cellBorder||skin.line} as CSSProperties
  const cellBackground=`color-mix(in srgb, ${config.cellBg||skin.menu} ${Math.round((config.cellAlpha??.92)*100)}%, transparent)`
  useLayoutEffect(()=>{
    if(!host.current)return
    const observer=new ResizeObserver(([entry])=>setScale(Math.min(1,entry.contentRect.width/metrics.panelW)))
    observer.observe(host.current)
    return ()=>observer.disconnect()
  },[metrics.panelW])
  useLayoutEffect(()=>{
    if(!surface.current)return
    let alive=true
    const fitAll=()=>{
      if(!alive||!surface.current)return
      measureContext.current??=document.createElement('canvas').getContext('2d')
      if(digits.current&&measureContext.current)drawPetTimeText(digits.current,zeroed||config.showSeconds?value:petDisplayTime(value),96,measureContext.current,true)
      fitPetLabels(surface.current,config.giftNameSize,config.giftTextSize)
    }
    fitAll();void document.fonts.ready.then(fitAll)
    return ()=>{alive=false}
  },[value,zeroed,config,metrics.panelW])
  return <div ref={host} className="mx-auto max-w-full" style={{width:metrics.panelW,height:Math.ceil(metrics.height*scale),position:'relative'}}>
    <style>{petFontCss(new URL('pet-skins',document.baseURI).href)+PET_COUNTDOWN_CSS}</style>
    <div ref={surface} data-pet-skin={skin.id} data-pet-motion={config.petMotion===false?'off':'on'} data-pet-material={skin.material?'painted':undefined} data-pet-menu-art={skin.material&&config.cellBg===skin.menu?'on':'off'}
      style={{...variables,width:metrics.panelW,transform:`scale(${scale})`,transformOrigin:'top left'}}>
      <div className="pet-panel">
        <div className="pet-art" dangerouslySetInnerHTML={{__html:petMascotHtml(skin,atlasUrl(skin.atlas),skin.material?atlasUrl(skin.material):undefined)}}/>
        <div className="pet-surface">
          <div className="pet-clock">
            {config.bgImage&&background&&<img src={background} alt="" className="absolute inset-0 h-full w-full object-fill"/>}
            <div className="pet-title" style={{color:config.titleColor}}>{config.title}</div>
            <div ref={digits} className="pet-time" data-testid="time-preview-value" data-zeroed={zeroed} style={{color:config.timeColor,fontSize:96}}/>
          </div>
          <div className="pet-menu-content">
          {config.giftPanel!==false&&gifts.length>0&&<div className="pet-gifts" data-columns={config.giftColumns||2} style={{gridTemplateColumns:`repeat(${config.giftColumns||2},1fr)`,gap:1,background:config.cellBorder||skin.line}}>
            {gifts.map((gift,index)=><div className="gift-cell" key={index} data-last-row={Math.floor(index/(config.giftColumns||2))===Math.floor((gifts.length-1)/(config.giftColumns||2))} style={{background:cellBackground}}>
              <div className="gift-icon" style={{width:metrics.giftIconSize,height:metrics.giftIconSize}}>{giftImage(gift)&&<img src={giftImage(gift)} alt=""/>}</div>
              <div className="gift-text">
                <div className="gift-name" style={{color:config.giftNameColor||skin.text,fontSize:metrics.giftNameSize}}>{gift.name}</div>
                <div className="gift-divider"/>
                <div className="gift-effect" style={{color:giftColor(gift),fontSize:metrics.giftTextSize}}>{petGiftText(gift,giftText(gift))}</div>
              </div>
            </div>)}
          </div>}
          {config.giftTicker&&<div className="pet-ticker" style={{height:30,borderTop:`1px solid ${config.cellBorder||skin.line}`,background:cellBackground}} aria-label="送礼滚动条预留位置"/>}
          </div>
        </div>
        <div dangerouslySetInnerHTML={{__html:petCharmHtml(skin,atlasUrl('charms.png'))}}/>
      </div>
    </div>
  </div>
}
