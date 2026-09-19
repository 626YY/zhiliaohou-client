// 游戏 exe 路径规则单测（纯逻辑、秒级、不碰文件系统）。
//   用例全部取自 2026-09-07 真机抓到的实际路径：
//     · 用户 settings.json 里轮椅一直指着测试夹具 C:\Temp\zhiliao-backend-audit-fixture\4WheelChallenge.exe（0 字节）
//     · 轮椅真实文件名是「4Wheel Challenge.exe」——带空格
//     · DON'T SCREAM 根目录那个 Dont_Scream.exe 是启动器，真正要的在 DontScream/Binaries/Win64/
// 用法：node tools/test-game-paths.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const out = await build({
  entryPoints: [path.join(root, 'src/shared/gamePaths.ts')],
  bundle: true, write: false, platform: 'neutral', format: 'esm'
})
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { checkGamePath, searchRootFor, baseName, gamePathSample } = mod

let n = 0
const fails = []
const eq = (name, got, want) => {
  n++
  try {
    assert.deepEqual(got, want)
    console.log('PASS ' + name)
  } catch {
    console.log(`FAIL ${name}\n     实际 ${JSON.stringify(got)}\n     期望 ${JSON.stringify(want)}`)
    fails.push(name)
  }
}
const real = { exists: true, size: 1024 }

// ── ① 合格的真实路径 ────────────────────────────────────────────────
const WHEEL_OK = 'F:\\SteamLibrary\\steamapps\\common\\4WheelChallenge\\4Wheel Challenge.exe'
const DS_OK = "F:\\SteamLibrary\\steamapps\\common\\DON'T SCREAM\\DontScream\\Binaries\\Win64\\DontScream-Win64-Shipping.exe"
const LIB_OK =
  'F:\\SteamLibrary\\steamapps\\common\\Librarian Tidy Up the Arcane Library!\\Librarian\\Binaries\\Win64\\Librarian-Win64-Shipping.exe'
eq('轮椅真实路径（文件名带空格）合格', checkGamePath('4wheel-challenge', WHEEL_OK, real).ok, true)
eq('DS 真实 Shipping exe 合格', checkGamePath('dontscream', DS_OK, real).ok, true)
eq('图书馆真实 Shipping exe 合格', checkGamePath('librarian', LIB_OK, real).ok, true)
// 没空格的写法也得认（有人手敲）
eq('轮椅不带空格也认', checkGamePath('4wheel-challenge', 'D:\\Games\\4WheelChallenge\\4WheelChallenge.exe', real).ok, true)

// ── ② 夹具：0 字节 + 在 Temp 里，两道都要拦住 ───────────────────────
const FIXTURE = 'C:\\Temp\\zhiliao-backend-audit-fixture\\4WheelChallenge.exe'
eq('夹具 0 字节被拦', checkGamePath('4wheel-challenge', FIXTURE, { exists: true, size: 0 }).code, 'zero')
eq('夹具即使非空也因在 Temp 被拦', checkGamePath('4wheel-challenge', FIXTURE, real).code, 'temp')
eq(
  'AppData\\Local\\Temp 里的也拦',
  checkGamePath('dontscream', 'C:\\Users\\a\\AppData\\Local\\Temp\\x\\DontScream-Win64-Shipping.exe', real).code,
  'temp'
)

// ── ③ 选错 exe：启动器 / 崩溃处理器 / 卸载程序 ──────────────────────
eq(
  'DS 根目录启动器 Dont_Scream.exe 被拒',
  checkGamePath('dontscream', "F:\\SteamLibrary\\steamapps\\common\\DON'T SCREAM\\Dont_Scream.exe", real).code,
  'wrong-exe'
)
eq(
  '轮椅同目录的 UnityCrashHandler64.exe 被拒',
  checkGamePath('4wheel-challenge', 'F:\\SteamLibrary\\steamapps\\common\\4WheelChallenge\\UnityCrashHandler64.exe', real).code,
  'wrong-exe'
)
eq(
  '轮椅同目录的 unins000.exe 被拒',
  checkGamePath('4wheel-challenge', 'F:\\SteamLibrary\\steamapps\\common\\4WheelChallenge\\unins000.exe', real).code,
  'wrong-exe'
)
eq(
  '拒绝时告诉主播该选哪个',
  checkGamePath('dontscream', "F:\\x\\common\\DON'T SCREAM\\Dont_Scream.exe", real).reason,
  '选的不是游戏本体，应该选 DontScream-Win64-Shipping.exe'
)
// 别把 DS 的 exe 认成图书馆的
eq('串游戏的 exe 被拒', checkGamePath('librarian', DS_OK, real).code, 'wrong-exe')

// ── ④ 空 / 不存在 ──────────────────────────────────────────────────
eq('没填', checkGamePath('4wheel-challenge', '', { exists: false, size: -1 }).code, 'empty')
eq('文件不在了', checkGamePath('4wheel-challenge', WHEEL_OK, { exists: false, size: -1 }).code, 'missing')
// 大小探不到（-1）不能当成 0 字节误杀
eq('大小探不到不误杀', checkGamePath('4wheel-challenge', WHEEL_OK, { exists: true, size: -1 }).ok, true)

// ── ⑤ 没规则的新游戏：只判存在，不拦（以后加游戏不至于全瘫） ────────
eq('未知游戏只判存在', checkGamePath('some-new-game', 'D:\\X\\y.exe', real).code, 'no-rule')
eq('未知游戏文件不在照样拦', checkGamePath('some-new-game', 'D:\\X\\y.exe', { exists: false, size: -1 }).code, 'missing')

// ── ⑥ 从选错的路径往哪找：Steam common 的下一层就是游戏根 ───────────
const DS_ROOT = "F:\\SteamLibrary\\steamapps\\common\\DON'T SCREAM"
eq('从 DS 启动器往上定位到游戏根', searchRootFor('dontscream', DS_ROOT + '\\Dont_Scream.exe'), DS_ROOT)
eq('从 DS 正确 exe 也定位到游戏根', searchRootFor('dontscream', DS_OK), DS_ROOT)
eq(
  '轮椅定位到游戏根',
  searchRootFor('4wheel-challenge', WHEEL_OK),
  'F:\\SteamLibrary\\steamapps\\common\\4WheelChallenge'
)
// 非 Steam 安装：退回按目录名匹配
eq(
  '非 Steam 安装按目录名定位',
  searchRootFor('dontscream', 'D:\\Games\\DontScream\\Binaries\\Win64\\DontScream-Win64-Shipping.exe'),
  'D:\\Games\\DontScream'
)
// 谁都不匹配：至少退回 exe 所在目录，不返回空
eq(
  '认不出就退回 exe 所在目录',
  searchRootFor('4wheel-challenge', FIXTURE),
  'C:\\Temp\\zhiliao-backend-audit-fixture'
)
eq('空路径返回空', searchRootFor('dontscream', ''), '')
// 正斜杠路径也要认
eq(
  '正斜杠路径同样定位',
  searchRootFor('librarian', 'F:/SteamLibrary/steamapps/common/Librarian X/Librarian/Binaries/Win64/Librarian-Win64-Shipping.exe'),
  'F:/SteamLibrary/steamapps/common/Librarian X'
)

// ── ⑦ 小工具 ──────────────────────────────────────────────────────
eq('baseName 认反斜杠', baseName(DS_OK), 'DontScream-Win64-Shipping.exe')
eq('baseName 认正斜杠', baseName('a/b/c.exe'), 'c.exe')
eq('三款游戏都有正确样例', ['4wheel-challenge', 'dontscream', 'librarian'].every((g) => gamePathSample(g).length > 10), true)

console.log(`\n游戏路径规则：${n - fails.length}/${n} PASS`)
if (fails.length) process.exitCode = 1
