// 从现有原画的矢量外轮廓生成内轮廓；仅裁UI叠层，不修改原画PNG。
import fs from 'node:fs/promises'
import path from 'node:path'

const root=path.resolve(import.meta.dirname,'../src/renderer/public/pet-skins')
for(const name of ['cream','duo','peach','night','berry','bakery','onsen','space']){
  const original=await fs.readFile(path.join(root,`frame-${name}.mask.svg`),'utf8')
  const contour=original.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1]
  if(!contour)throw new Error('Missing pet outline: '+name)
  const inner=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254" preserveAspectRatio="none"><defs><filter id="inside" filterUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254"><feMorphology operator="erode" radius="32"/></filter></defs><path d="${contour}" fill="white" filter="url(#inside)"/></svg>\n`
  await fs.writeFile(path.join(root,`frame-${name}.inner.svg`),inner)
}
console.log('PET CONTENT MASKS: 8 generated from existing vector outlines')
