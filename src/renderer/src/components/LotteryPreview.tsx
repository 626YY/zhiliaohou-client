import { useEffect, useRef } from 'react'
import type { LotteryEvent, LotteryItem } from '@shared/types'
import './LotteryPreview.css'

export function lotteryImageSrc(src: string): string {
  if (/^(https?:|file:|data:)/i.test(src)) return src
  const normalized = src.replace(/\\/g, '/')
  const url = new URL('file:///')
  if (normalized.startsWith('//')) {
    const [host, ...parts] = normalized.slice(2).split('/')
    url.hostname = host
    url.pathname = '/' + parts.join('/')
  } else url.pathname = normalized.startsWith('/') ? normalized : '/' + normalized
  return url.href
}

export default function LotteryPreview({ items, event, centerImg, skin = 'classic' }: { items: LotteryItem[]; event?: LotteryEvent; centerImg?: string; skin?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const entries = event?.phase === 'started' || event?.phase === 'result' || event?.phase === 'error' ? event.items : items
    const arc = Math.PI * 2 / Math.max(1, entries.length), radius = 298
    let raf = 0, stopped = false
    const images = entries.map(it => { if(!it.img)return null;const im=new Image();im.onload=()=>{if(!stopped)draw()};im.src=lotteryImageSrc(it.img);return im })
    function draw() {
      if(!ctx || !el)return
      cancelAnimationFrame(raf)
      const phase=event?.phase, t=event?.phase==='started'?Math.min(1,Math.max(0,(Date.now()-event.startedAt)/event.duration)):1
      const norm=(x:number)=>(x%(Math.PI*2)+Math.PI*2)%(Math.PI*2)
      const end=event&&event.index>=0?norm(-(event.index+.5)*arc):0
      const rotation=phase==='started'?(Math.PI*2*5+end)*(1-Math.pow(1-t,3)):end
      ctx.clearRect(0,0,600,600)
      entries.forEach((it,i)=>{
        const angle=i*arc+rotation
        ctx.beginPath();ctx.moveTo(300,300);ctx.arc(300,300,radius,angle,angle+arc);ctx.closePath();ctx.fillStyle=it.color||getComputedStyle(el).getPropertyValue('--bg-elev');ctx.fill()
        ctx.save();ctx.clip();ctx.translate(300,300);ctx.rotate(angle+arc/2)
        const im=images[i]
        if(im?.complete&&im.naturalWidth){const scale=Math.min(60/im.naturalWidth,60/im.naturalHeight);ctx.save();ctx.translate(radius*.78,0);ctx.rotate(-angle-arc/2);ctx.drawImage(im,-im.naturalWidth*scale/2,-im.naturalHeight*scale/2,im.naturalWidth*scale,im.naturalHeight*scale);ctx.restore()}
        const hex=/^#([a-f0-9]{6})$/i.exec(it.color), n=hex?parseInt(hex[1],16):0
        ctx.fillStyle=hex&&((n>>16)*.299+((n>>8)&255)*.587+(n&255)*.114)>155?'#252525':'#ffffff'
        ctx.font='bold 20px "Microsoft YaHei"';ctx.textAlign='center';let label=it.name
        const textR=radius*(im?.52:.64), max=entries.length>2?Math.min(im?106:155,2*textR*Math.sin(arc/2)*.94):155
        while(ctx.measureText(label).width>max&&label.length>1)label=label.slice(0,-2)+'…'
        ctx.translate(textR,0);ctx.rotate(-angle-arc/2);ctx.fillText(label,0,7);ctx.restore()
      })
      if(phase==='started'&&t<1)raf=requestAnimationFrame(draw)
    }
    draw()
    return ()=>{stopped=true;cancelAnimationFrame(raf)}
  },[items,event])
  return <div data-widget-skin={skin} className="lottery-premium-preview" style={{backgroundImage:`url(${JSON.stringify(new URL('./entertainment-assets/wheel-premium-bg.png',location.href).href)})`}}>
    <canvas aria-label="转盘预览" ref={canvas} width={600} height={600} />
    {Array.from({length:16},(_,i)=><i key={i} className="lottery-light" style={{left:`${49.2+Math.cos(i/8*Math.PI)*47}%`,top:`${49.2+Math.sin(i/8*Math.PI)*47}%`,animationDelay:`${i%2*.5}s`}} />)}
    <div className="lottery-premium-center">{centerImg?<img src={lotteryImageSrc(centerImg)} alt="中心图"/>:'开始'}</div>
    <div className="lottery-premium-pointer"/>
  </div>
}
