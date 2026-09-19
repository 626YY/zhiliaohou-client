/// <reference lib="dom" />
// 浏览器执行的共享函数；主进程仅把函数源码嵌入输出页，不在 Node 环境调用。
// 用字体真实字形的高度适配萌宠数字，避免字体的行框留白让倒计时被错误缩小。
// 主进程输出页与 React 预览共用；只在时间/尺寸变化时测量和更新 SVG 文字，不重画皮肤。
export function drawPetTimeText(element:HTMLElement,value:string,base:number,context:CanvasRenderingContext2D,force=false):void {
  const width=element.clientWidth,height=element.clientHeight
  if(width<=0||height<=0)return
  const style=getComputedStyle(element)
  const key=[value,base,width,height,style.fontFamily,style.fontWeight].join('|')
  if(!force&&element.dataset.petTextKey===key&&element.querySelector('svg'))return
  element.dataset.petTextKey=key
  const family=style.fontFamily
  const measure=(size:number)=>{context.font=`${style.fontWeight} ${size}px ${family}`;return context.measureText(value)}
  const initial=measure(base)
  // 固定数字占位，分钟秒数改变时保持相同的宽度。
  const pattern=value.replace(/[0-9]/g,'8')
  const reserve=context.measureText(pattern).width
  const inkH=initial.actualBoundingBoxAscent+initial.actualBoundingBoxDescent
  const size=Math.max(10,Math.floor(base*Math.min(1,(width-8)/Math.max(1,reserve),(height-3)/Math.max(1,inkH))*10)/10)
  const measured=measure(size)
  const textWidth=context.measureText(pattern).width
  const baseline=(height+measured.actualBoundingBoxAscent-measured.actualBoundingBoxDescent)/2
  const ns='http://www.w3.org/2000/svg'
  const svg=document.createElementNS(ns,'svg')
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`)
  svg.setAttribute('width','100%');svg.setAttribute('height','100%')
  const text=document.createElementNS(ns,'text')
  text.setAttribute('x',String(width/2));text.setAttribute('y',String(baseline));text.setAttribute('text-anchor','middle')
  text.setAttribute('textLength',String(textWidth));text.setAttribute('lengthAdjust','spacingAndGlyphs')
  text.style.fontFamily=family;text.style.fontWeight=style.fontWeight;text.style.fontSize=size+'px';text.style.fill='currentColor'
  value.split(/(:)/).forEach(part=>{
    if(part===':'){const colon=document.createElementNS(ns,'tspan');colon.textContent=part;colon.style.fill='var(--pet-accent)';text.appendChild(colon)}
    else text.appendChild(document.createTextNode(part))
  })
  svg.appendChild(text);element.replaceChildren(svg);element.dataset.petFontSize=String(size)
}
