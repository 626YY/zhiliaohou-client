// 从隔离测试授权版逐页收集真实可见控件、文案和截图；不读用户资料、不启动直播或游戏。
import {_electron as electron} from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import {hiddenTestEntry} from '../../卡密系统/client-preview/test-hidden-entry.mjs'

const source=path.resolve(import.meta.dirname,'..')
const preview=path.resolve(source,'../卡密系统/client-preview')
const run=path.join(preview,'private','usability-'+Date.now())
const out=path.join(source,'output/usability/before')
await fs.mkdir(out,{recursive:true})
const env={...process.env,ZL_PREVIEW_PROFILE:path.join(run,'client'),ZL_PREVIEW_DATA:path.join(run,'service'),ZL_LICENSE_PLATFORM:'http://127.0.0.1:1'}
delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({args:[await hiddenTestEntry(preview,run)],cwd:preview,env,timeout:30000})
const page=await app.firstWindow()
page.setDefaultTimeout(15000)
const pages=[],errors=[]
page.on('pageerror',e=>errors.push(String(e)))

async function inspect(name){
  await page.waitForTimeout(900)
  await page.locator('main').evaluate(el=>{el.scrollTop=0})
  const info=await page.locator('main').evaluate(main=>{
    const visible=el=>el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})
    const text=el=>(el?.textContent||'').replace(/\s+/g,' ').trim()
    const label=el=>el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')||'').split(' ').map(id=>text(document.getElementById(id))).join(' ').trim()||text(el.labels?.[0])||text(el.closest('label'))||el.getAttribute('placeholder')||''
    const fields=[...main.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible).map(el=>({
      tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',label:label(el).slice(0,160),
      disabled:el.disabled,aboveFold:el.getBoundingClientRect().top<innerHeight,
      options:el.tagName==='SELECT'?[...el.options].map(o=>o.textContent):undefined
    }))
    const buttons=[...main.querySelectorAll('button')].filter(visible).map(el=>({label:(el.getAttribute('aria-label')||text(el)).slice(0,150),disabled:el.disabled,aboveFold:el.getBoundingClientRect().top<innerHeight}))
    return {headings:[...main.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(text),fields,buttons,
      details:[...main.querySelectorAll('details')].map(el=>({open:el.open,label:text(el.querySelector('summary'))})),
      help:[...main.querySelectorAll('p')].filter(visible).map(text).filter(Boolean).slice(0,30),
      scrollHeight:main.scrollHeight,viewportHeight:main.clientHeight}
  })
  const filename=String(pages.length+1).padStart(2,'0')+'-'+name.replace(/[^a-zA-Z0-9一-龥_-]/g,'_')+'.png'
  await page.screenshot({path:path.join(out,filename)})
  pages.push({name,...info,screenshot:filename})
  console.log(JSON.stringify({name,fields:info.fields.length,buttons:info.buttons.length,unlabelled:info.fields.filter(f=>!f.label).length,scrollScreens:Math.round(info.scrollHeight/info.viewportHeight*10)/10}))
  await fs.writeFile(path.join(out,'audit.json'),JSON.stringify({version:await app.evaluate(({app})=>app.getVersion()),pages,errors},null,2))
}

try{
  await page.locator('input[type="password"]').waitFor()
  await page.locator('form button[type="submit"]').click()
  await page.getByRole('heading',{name:'游戏库',exact:true}).waitFor()
  for(const name of ['游戏库','参数调整','整蛊遥控','启动游戏','直播统计','直播连接器','公告','通知','设置','娱乐助手']){
    await page.getByRole('link',{name,exact:true}).click();await inspect(name)
  }
  const text=await fs.readFile(path.join(preview,'upstream/src/renderer/src/pages/Entertainment.tsx'),'utf8')
  const modules=[...text.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map(m=>({id:m[1],label:m[2]}))
  for(const mod of modules){
    await page.getByRole('link',{name:'游戏库',exact:true}).click()
    await page.getByRole('link',{name:'娱乐助手',exact:true}).click()
    await page.locator('main button').filter({hasText:mod.label}).first().click()
    await inspect(mod.label)
  }
  console.log(`USABILITY AUDIT ${pages.length} pages, ${errors.length} errors`)
}finally{await app.close()}
