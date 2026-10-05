/// <reference lib="dom" />
// 浏览器执行的共享函数；主进程仅把函数源码嵌入输出页，不在 Node 环境调用。
// 用字体真实字形的高度适配萌宠数字，避免字体的行框留白让倒计时被错误缩小。
// 主进程输出页与 React 预览共用；只在时间/尺寸变化时测量和更新 SVG 文字，不重画皮肤。
export function drawPetTimeText(element:HTMLElement,value:string,base:number,context:CanvasRenderingContext2D,force=false):void {
  const width=element.clientWidth,height=element.clientHeight
  if(width<=0||height<=0)return
  // 加宽菜单时计时牌同步变大，文字仍按可见区域适配，避免固定基准字号留下大空白。
  base=Math.max(base,height*1.6)
  const style=getComputedStyle(element)
  const key=[value,base,width,height,style.fontFamily,style.fontWeight,'dots'].join('|')
  if(!force&&element.dataset.petTextKey===key&&element.querySelector('svg'))return
  element.dataset.petTextKey=key
  const family=style.fontFamily
  const setFont=(size:number)=>{context.font=`${style.fontWeight} ${size}px ${family}`}
  // 设计稿的冒号是两颗圆点、数字组之间留出呼吸感：拆成「数字组 + 冒号槽」分别排。
  const parts=value.split(/(:)/).filter(part=>part!=='')
  const groups=parts.filter(part=>part!==':')
  const colons=parts.length-groups.length
  // 每组用「8」占位量宽（分钟秒数变化时宽度不变）；墨高用去掉冒号后的真实字形
  const digitsOnly=value.replace(/:/g,'')||value
  setFont(base)
  const inkBase=context.measureText(digitsOnly)
  const inkH=Math.max(1,inkBase.actualBoundingBoxAscent+inkBase.actualBoundingBoxDescent)
  const COLON_W=.5   // 冒号槽宽 ≈ 0.5 × 数字墨高（设计稿组间距）
  const groupBase=groups.map(group=>context.measureText(group.replace(/[0-9]/g,'8')).width)
  const totalBase=groupBase.reduce((sum,w)=>sum+w,0)+colons*COLON_W*inkH
  const size=Math.max(10,Math.floor(base*Math.min(1,(width-8)/Math.max(1,totalBase),(height-3)/inkH)*10)/10)
  setFont(size)
  const measured=context.measureText(digitsOnly)
  const asc=measured.actualBoundingBoxAscent,desc=measured.actualBoundingBoxDescent
  const baseline=(height+asc-desc)/2
  const capTop=baseline-asc,capH=asc+desc
  const groupW=groups.map(group=>context.measureText(group.replace(/[0-9]/g,'8')).width)
  const colonW=COLON_W*capH
  const used=groupW.reduce((sum,w)=>sum+w,0)+colons*colonW
  const ns='http://www.w3.org/2000/svg'
  const svg=document.createElementNS(ns,'svg')
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`)
  svg.setAttribute('width','100%');svg.setAttribute('height','100%')
  const dot=Math.max(1.5,capH*.11)   // 圆点半径 ≈ 0.11 × 数字墨高
  let x=(width-used)/2,index=0
  for(const part of parts){
    if(part===':'){
      const cx=x+colonW/2
      for(const fy of [.34,.7]){
        const circle=document.createElementNS(ns,'circle')
        circle.setAttribute('cx',String(cx));circle.setAttribute('cy',String(capTop+capH*fy));circle.setAttribute('r',String(dot))
        circle.setAttribute('class','pet-colon-dot');circle.style.fill='var(--pet-colon,var(--pet-accent))'
        svg.appendChild(circle)
      }
      // 输出页按 textContent 重新适配：放一个透明的「:」，保证重读仍是 00:25:36（圆点本身没有文字）
      const keep=document.createElementNS(ns,'text')
      keep.setAttribute('x',String(cx));keep.setAttribute('y',String(baseline));keep.setAttribute('aria-hidden','true')
      keep.style.fontSize='1px';keep.style.fill='transparent'
      keep.textContent=':'
      svg.appendChild(keep)
      x+=colonW
    }else{
      const w=groupW[index++]
      const text=document.createElementNS(ns,'text')
      text.setAttribute('x',String(x+w/2));text.setAttribute('y',String(baseline));text.setAttribute('text-anchor','middle')
      // 按占位宽度拉齐，只调字距不压字形
      text.setAttribute('textLength',String(w));text.setAttribute('lengthAdjust','spacing')
      text.style.fontFamily=family;text.style.fontWeight=style.fontWeight;text.style.fontSize=size+'px';text.style.letterSpacing='0';text.style.fill='currentColor'
      text.textContent=part
      svg.appendChild(text)
      x+=w
    }
  }
  element.replaceChildren(svg);element.dataset.petFontSize=String(size)
}

// 字体异步加载完成、换肤或改文案后都重新适配；预览与实际输出用同一规则。
export function fitPetLabels(root:HTMLElement,giftNameSize?:number,giftTextSize?:number):void {
  const fit=(element:HTMLElement,base:number,min=10)=>{
    let size=base
    element.style.fontSize=size+'px'
    while((element.scrollWidth>element.clientWidth||element.scrollHeight>element.clientHeight)&&size>min){
      size=Math.max(min,size-1);element.style.fontSize=size+'px'
    }
  }
  const title=root.querySelector<HTMLElement>('.pet-title')
  if(title)fit(title,parseFloat(getComputedStyle(title).getPropertyValue('--pet-title-size'))||20)
  // 礼物格已按实际字号计算尺寸，不能为塞进格子再把字号缩小。
  const style=getComputedStyle(root)
  const nameSize=parseFloat(style.getPropertyValue('--pet-gift-name-size'))||giftNameSize||16
  const textSize=parseFloat(style.getPropertyValue('--pet-gift-text-size'))||giftTextSize||16
  root.querySelectorAll<HTMLElement>('.gift-name').forEach(element=>{element.style.fontSize=nameSize+'px'})
  root.querySelectorAll<HTMLElement>('.gift-effect').forEach(element=>{element.style.fontSize=textSize+'px'})
}
