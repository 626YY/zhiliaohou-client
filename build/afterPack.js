// electron-builder afterPack 钩子：本机 electron-builder 自带的 winCodeSign/rcedit 步骤在中文路径下会失败，
// 所以打包时关掉 signAndEditExecutable，再在这里用 rcedit 自己把图标和版本信息写进 exe。
// 不这么做的话，安装出来的桌面图标是 Electron 默认图标（2026-08-09 踩过）。
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  // rcedit 不同版本导出形态不一样：函数 / { default } / { rcedit }，三种都兜住
  const rceditModule = require('rcedit')
  const rcedit = typeof rceditModule === 'function'
    ? rceditModule
    : (rceditModule.default || rceditModule.rcedit)
  if (typeof rcedit !== 'function') throw new Error('rcedit 模块没有可调用的导出：' + Object.keys(rceditModule).join(','))
  const pkg = require(path.join(context.packager.projectDir, 'package.json'))
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico')
  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] 找不到 exe，跳过 rcedit：', exePath)
    return
  }
  await rcedit(exePath, {
    icon,
    'file-version': pkg.version,
    'product-version': pkg.version,
    'version-string': {
      ProductName: context.packager.appInfo.productName,
      FileDescription: context.packager.appInfo.productName,
      CompanyName: '知了猴工作室',
      LegalCopyright: 'Copyright © 2026 知了猴工作室',
      OriginalFilename: exeName
    }
  })
  console.log('[afterPack] rcedit 已写入图标与版本信息：', exePath)
  flipFuses(exePath)
}

// Electron fuses（2026-09-14，防破解第一道门槛）：直接改 exe 里的 fuse 线（@electron/fuses 同款格式，本机 electron-builder 25 还没有 electronFuses 配置项）。
//   关 RunAsNode（ELECTRON_RUN_AS_NODE=1 把整蛊台当 node 跑、随便加载自己的脚本）、关 NODE_OPTIONS 环境变量注入、
//   开 OnlyLoadAppFromAsar（不认 resources/app 散目录，改 JS 得重打 asar）。
//   ★不关 EnableNodeCliInspectArguments：打包后公网烟测（Playwright）靠 --inspect 连主进程，关了发版流程就断；也不开 asar 完整性校验
//   （Windows 上要把哈希写进 exe 资源，本机 electron-builder 的 rcedit 步骤在中文路径下本来就是关掉的，装不上会直接起不来）。
const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
const FUSE = { RunAsNode: 0, EnableCookieEncryption: 1, EnableNodeOptionsEnvironmentVariable: 2, EnableNodeCliInspectArguments: 3, EnableEmbeddedAsarIntegrityValidation: 4, OnlyLoadAppFromAsar: 5, LoadBrowserProcessSpecificV8Snapshot: 6, GrantFileProtocolExtraPrivileges: 7 }
function flipFuses(exePath) {
  const buf = fs.readFileSync(exePath)
  const idx = buf.indexOf(SENTINEL, 0, 'latin1')
  if (idx < 0) throw new Error('[afterPack] exe 里找不到 fuse 线，Electron 版本变了？')
  const pos = idx + SENTINEL.length
  const version = buf[pos]
  const length = buf[pos + 1]
  if (version !== 1 || length < 8) throw new Error(`[afterPack] fuse 线版本 / 长度不对：v${version} len${length}`)
  const before = buf.subarray(pos + 2, pos + 2 + length).toString('latin1')
  const set = (name, on) => { buf[pos + 2 + FUSE[name]] = on ? 0x31 : 0x30 }
  set('RunAsNode', false)
  set('EnableNodeOptionsEnvironmentVariable', false)
  set('OnlyLoadAppFromAsar', true)
  const after = buf.subarray(pos + 2, pos + 2 + length).toString('latin1')
  fs.writeFileSync(exePath, buf)
  console.log(`[afterPack] fuses ${before} → ${after}（RunAsNode 关 / NODE_OPTIONS 关 / OnlyLoadAppFromAsar 开）`)
}
