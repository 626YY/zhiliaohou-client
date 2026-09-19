// 把挂件真实产出的 HTML 抽出来落盘，用无头浏览器截图核对面板视觉。
// electron / fs / path 都用桩替掉，只跑纯字符串拼装那部分。
import { build } from 'esbuild'
import fs from 'fs'

const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `
        export const BrowserWindow = class { static getAllWindows(){return []} }
        export const app = { on(){}, getPath(){ return 'C:/tmp' } }
        export const globalShortcut = { register(){return false}, unregister(){} }
        export const dialog = {}
        export const clipboard = {}
        export default {}
      `,
      loader: 'js'
    }))
  }
}

const out = await build({
  entryPoints: ['src/main/challenge-widget.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
  external: ['fs', 'path'],
  plugins: [stub],
  alias: { '@shared': './src/shared' },
  // 把内部的 page() 暴露出来
  footer: { js: '' }
})
let code = out.outputFiles[0].text
// 源码里 page/runtimeConfig 不是导出项，这里在打包产物尾部补一句导出
const sym = (code.match(/function (page\d*)\(cfg, localImgs\)/) || [])[1]
if (!sym) throw new Error('没找到挂件页函数')
console.log('挂件页函数符号:', sym)
code += '\nexport { ' + sym + ' as __page }\n'
fs.writeFileSync('C:/kbshot/widget_bundle.mjs', code, 'utf8')
console.log('bundle bytes:', code.length)
