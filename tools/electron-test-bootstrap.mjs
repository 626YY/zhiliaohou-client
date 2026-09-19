// 测试专用：加载真实构建前隐藏本实例所有窗口，不修改产品代码或其他进程。
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

async function assertTemporaryTestProfile(root, userData) {
  const testRoot = await fs.realpath(path.join(root, 'output', 'playwright'))
  const profile = await fs.realpath(userData)
  const relative = path.relative(testRoot, profile)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      !/^(?:session|userdata|electron-userdata)-[a-zA-Z0-9]{6}$/.test(path.basename(profile))) {
    throw new Error('Refusing to modify a non-temporary test profile')
  }
  return profile
}

// 仅用于 mkdtemp 创建的独立回归目录；已有配置拒绝覆盖，必须在启动应用前调用。
// 空文件只满足游戏路径探测的 existsSync 条件，绝不能执行这些 .exe 占位文件。
export async function prepareIsolatedGameProfile(root, userData) {
  const profile = await assertTemporaryTestProfile(root, userData)
  const dataDir = path.join(profile, 'data')
  const settingsPath = path.join(dataDir, 'settings.json')
  const dataInfo = await fs.lstat(dataDir).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (dataInfo && (!dataInfo.isDirectory() || dataInfo.isSymbolicLink())) {
    throw new Error('Refusing to use a redirected test data directory')
  }
  if (await fs.lstat(settingsPath).then(() => true, error => {
    if (error.code === 'ENOENT') return false
    throw error
  })) throw new Error('Refusing to overwrite existing test settings; prepare isolation before configuring the profile')

  // 与实际游戏清单一致；聚焦回归会对照 GamesList 检查新增游戏没有漏隔离。
  const gameIds = ['4wheel-challenge', 'dontscream', 'librarian']
  const fixtures = await fs.mkdtemp(path.join(profile, 'game-fixtures-'))
  const unique = randomUUID().replaceAll('-', '').slice(0, 12)
  const gamePaths = {}
  for (const [index, id] of gameIds.entries()) {
    // tasklist 的显示名可能截断到 25 字符，唯一段和序号都放在截断之前。
    const filename = path.join(fixtures, `zltest-${unique}-${index}.exe`)
    await fs.writeFile(filename, '', { flag: 'wx' })
    gamePaths[id] = filename
  }
  await fs.mkdir(dataDir, { recursive: true })
  const settings = {
    assetGuideSeen: true,
    currentGameId: gameIds[0], gamePaths,
    gamePath: gamePaths[gameIds[0]], gameExeName: path.basename(gamePaths[gameIds[0]])
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), { flag: 'wx' })
  return settings
}

// outDir：electron-vite 的产物目录（默认 out）；想验证未进 out/ 的改动时可以 `electron-vite build --outDir <别的目录>` 再指过来。
export async function writeHiddenElectronBootstrap(root, userData, { isolateGames = true, outDir = 'out', offscreen = false, visible = false } = {}) {
  // ZL_TEST_OUT_DIR：不覆盖 out/ 时把回归指向别的构建目录（例如 output/fable-formal-auth-build）
  if (outDir === 'out' && process.env.ZL_TEST_OUT_DIR) outDir = process.env.ZL_TEST_OUT_DIR
  await assertTemporaryTestProfile(root, userData)
  // 真游戏验收可显式 isolateGames:false，但仍只能使用独立测试 profile。
  if (isolateGames) await prepareIsolatedGameProfile(root, userData)
  const bootstrap = path.join(userData, 'hidden-bootstrap.cjs')
  await fs.writeFile(bootstrap, `
const electron = require('electron');
try {
  electron.app.setPath('userData', ${JSON.stringify(userData)});
  electron.app.setAppPath(${JSON.stringify(root)});
  // 连启动异常对话框也不能抢桌面；文件选择由具体测试提供结果。
  electron.dialog.showErrorBox = (title, content) => process.stderr.write(title + ': ' + content + '\\n');
  electron.dialog.showMessageBox = async (...args) => ({ response: args.find(arg => arg && typeof arg === 'object' && 'message' in arg)?.cancelId ?? -1, checkboxChecked: false });
  electron.dialog.showMessageBoxSync = (...args) => args.find(arg => arg && typeof arg === 'object' && 'message' in arg)?.cancelId ?? -1;
  electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  electron.dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  const NativeWindow = electron.BrowserWindow;
  // 只有原生窗口采集回归显式 visible:true；其余回归继续隐藏，避免抢用户桌面。
  for (const method of ${visible ? '[]' : "['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']"}) {
    NativeWindow.prototype[method] = function () {};
  }
  electron.app.focus = () => {};
  const HiddenWindow = new Proxy(NativeWindow, {
    construct(Target, args) {
      ${visible ? 'return Reflect.construct(Target, args, Target);' : ''}
      return Reflect.construct(Target, [{ ...(args[0] || {}), show: false, focusable: false, webPreferences: { ...(args[0]?.webPreferences || {}), backgroundThrottling: false, paintWhenInitiallyHidden: true, ${offscreen ? 'offscreen: true,' : ''} } }], Target);
    }
  });
  // Electron 的 BrowserWindow 导出不可重定义；仅让本测试加载产品模块时拿到构造器代理。
  const Module = require('node:module');
  const originalLoad = Module._load;
  const facade = { ...electron, BrowserWindow: HiddenWindow };
  Module._load = function (request, parent, isMain) {
    return request === 'electron' ? facade : originalLoad.apply(this, arguments);
  };
  global.__zhiliaoHiddenTest = ${!visible};
  require(${JSON.stringify(path.resolve(root, outDir, 'main/index.js'))});
} catch (error) {
  process.stderr.write(String(error.stack || error) + '\\n');
  electron.app.exit(1);
}
`, 'utf8')
  return bootstrap
}
