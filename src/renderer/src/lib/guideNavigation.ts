/**
 * 基础模式引导的「带我找到」定位：只在功能页内容区里找真实控件，只滚动/高亮/聚焦，
 * 允许展开可折叠区（details / AdvancedSection），绝不点按钮、不改业务配置、不切高级。
 */
/** focus:false 只高亮不聚焦（清零这类按钮，别让一下回车就执行） */
export type GuideLocator={kind:'button'|'field'|'text';match:string;focus?:boolean}
export type GuideTarget=GuideLocator|{any:GuideLocator[]}|{route:string}
export type GuideMatch={
  /** 命中的元素（表单组 / 按钮 / 文字所在元素） */
  element:HTMLElement
  /** 高亮框套在哪个元素上：通常就是 element，文字命中时可能是它所在的整行 */
  highlight:HTMLElement
  /** 要聚焦的控件（没有就不聚焦） */
  control:HTMLElement|null
}

const CONTROL='input,select,textarea,button'
const SELECTOR:Record<GuideLocator['kind'],string>={button:'button',field:'input,select,textarea,[role="group"]',text:'label,h2,h3,span,div,p'}

const squash=(value:string|null|undefined)=>(value||'').replace(/\s+/g,' ').trim()

/** 控件的可读名称：aria-label → aria-labelledby → 所在 label / placeholder → 自身文字 */
export function accessibleName(el:Element):string{
  const label=el.getAttribute('aria-label')
  if(label)return squash(label)
  const byIds=(el.getAttribute('aria-labelledby')||'').split(' ').filter(Boolean).map(id=>el.ownerDocument.getElementById(id)?.textContent||'').join(' ')
  if(squash(byIds))return squash(byIds)
  if(el.matches('input,select,textarea'))return squash(el.closest('label')?.textContent||el.getAttribute('placeholder'))
  return squash(el.closest('label')?.textContent||el.textContent)
}

export function isVisible(el:Element):boolean{
  const probe=el as Element&{checkVisibility?:()=>boolean}
  if(typeof probe.checkVisibility==='function')return probe.checkVisibility()
  return (el as HTMLElement).offsetParent!==null
}

/** 基础模式下永远显示不出来的区域（切高级才可见），引导不能假装找到了。 */
export function isConcealedInBasic(el:Element):boolean{
  const advancedField=el.closest('[data-advanced-field],[data-advanced-fields]')
  if(!advancedField)return false
  // AdvancedSection 里的高级字段展开后就能看到，不算隐藏
  return !advancedField.closest('[data-advanced-section]')
}

// 同一行里顺带聚焦的只认开关和输入框；普通按钮（清零/删除之类）不能因为挨着文字就被聚焦
const SIBLING_CONTROL='input,select,textarea,[role="switch"]'

function resolveControl(element:HTMLElement,focus:boolean):{highlight:HTMLElement;control:HTMLElement|null}{
  if(element.matches(CONTROL))return {highlight:element,control:focus?element:null}
  const inside=element.querySelector<HTMLElement>(CONTROL)
  if(inside)return {highlight:element,control:focus?inside:null}
  // 文字和开关是兄弟节点时（如「保护时跳过当前整蛊」一行），往上找那一整行，行里只有一个开关/输入框才认
  let parent=element.parentElement
  for(let depth=0;parent&&depth<3;depth++,parent=parent.parentElement){
    if(parent.querySelectorAll(CONTROL).length>1)break
    const controls=Array.from(parent.querySelectorAll<HTMLElement>(SIBLING_CONTROL))
    if(controls.length===1)return {highlight:parent,control:focus?controls[0]:null}
  }
  return {highlight:element,control:null}
}

function findOne(scope:ParentNode,locator:GuideLocator):GuideMatch|null{
  const pattern=new RegExp(locator.match)
  const choices=Array.from(scope.querySelectorAll<HTMLElement>(SELECTOR[locator.kind]))
    .filter(el=>!el.closest('[data-testid="basic-feature-guide"]')&&!isConcealedInBasic(el)&&pattern.test(accessibleName(el)))
  choices.sort((a,b)=>Number(isVisible(b))-Number(isVisible(a))||(locator.kind==='text'?(a.textContent?.length||0)-(b.textContent?.length||0):0))
  const element=choices[0]
  if(!element)return null
  return {element,...resolveControl(element,locator.focus!==false)}
}

/** 按候选顺序找第一个命中的目标；route 类目标由调用方导航，这里返回 null。 */
export function findGuideTarget(scope:ParentNode,target:GuideTarget):GuideMatch|null{
  if('route' in target)return null
  const locators='any' in target?target.any:[target]
  for(const locator of locators){const found=findOne(scope,locator);if(found)return found}
  return null
}

/** 把目标所在的折叠区展开：原生 details 直接 open，AdvancedSection 监听 zl-guide-reveal 自己展开。 */
export function revealGuideTarget(match:GuideMatch):void{
  for(let parent:HTMLElement|null=match.highlight.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true
  window.dispatchEvent(new CustomEvent('zl-guide-reveal',{detail:match.element}))
}
