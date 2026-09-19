// 导入「品游娱乐助手Pro」的礼物配置：弹文件框（默认打开本机的品游目录）→ 逐个文件解析（pinyou-file.ts）→ 交给页面预览确认。
// 主播机器上一般是 娱乐助手Pro 目录下的配置文件，或者它「导出配置」出来的「品游配置_xxx.py」；
// 只要文件里有那张 JSON 礼物表就能认，不挑后缀。转换规则见 src/shared/pinyou.ts。
import { BrowserWindow, dialog, type WebContents } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { PinyouImportResult, PinyouPlan } from '@shared/types'
import { PINYOU_ROOT_RULES, parsePinyouFileAsync } from './pinyou-file'

/** 本机找品游安装目录的候选位置（可调）：盘符 × 目录名，外加桌面 / 下载 / 文档 */
export const PINYOU_INSTALL_CANDIDATES = {
  drives: 'CDEFGHIJK'.split(''),
  dirNames: ['娱乐助手Pro', '品游娱乐助手Pro', '娱乐助手PRO', '品游', '娱乐助手', 'Program Files\\娱乐助手Pro', 'Program Files (x86)\\娱乐助手Pro'],
  userDirs: ['Desktop', 'Downloads', 'Documents', '桌面']
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 某个目录像不像品游：有品游主程序，或者 音效\ 视频\ 脚本\ 里至少两个 */
function looksLikePinyouDir(dir: string): boolean {
  let hasExe = false
  try {
    hasExe = fs.readdirSync(dir).some((name) => PINYOU_ROOT_RULES.exeName.test(name))
  } catch {
    return false
  }
  const markers = Object.values(PINYOU_ROOT_RULES.markers).filter((name) => isDir(path.join(dir, name))).length
  return hasExe || markers >= PINYOU_ROOT_RULES.minMarkersAbove
}

/** 在本机常见位置找品游安装目录；找不到返回 undefined（文件框就用系统默认位置） */
export function locatePinyouInstall(extraDirs: string[] = []): string | undefined {
  const { drives, dirNames, userDirs } = PINYOU_INSTALL_CANDIDATES
  const bases = [...extraDirs, ...drives.map((d) => `${d}:\\`), ...userDirs.map((u) => path.join(os.homedir(), u))]
  for (const base of bases) {
    if (!isDir(base)) continue
    if (looksLikePinyouDir(base)) return base
    for (const name of dirNames) {
      const dir = path.join(base, name)
      if (isDir(dir) && looksLikePinyouDir(dir)) return dir
    }
  }
  return undefined
}

let importing = false   // 主进程侧并发闸：别只靠页面按钮禁用（多窗口 / 连点都能绕过）

export async function importPinyouConfig(sender?: WebContents): Promise<PinyouImportResult> {
  if (importing) return { ok: false, error: '上一次导入还没结束，请先完成或取消它' }
  importing = true
  try {
    // 文件框挂在发起页面的窗口上（挂件窗口多的时候 getFocusedWindow 会猜错，模态框挂到别的窗口甚至变非模态）
    const win = (sender ? BrowserWindow.fromWebContents(sender) : null) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const installDir = locatePinyouInstall()
    const picked = await dialog.showOpenDialog(win, {
      title: installDir ? `选择要导入的配置文件（已找到目录：${installDir}）` : '选择要导入的配置文件',
      ...(installDir ? { defaultPath: installDir } : {}),
      filters: [
        { name: '配置文件（导出的 .py / 配置目录里的文件）', extensions: ['py', 'json', 'txt', 'ini', 'dat', 'cfg'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
    const plans: PinyouPlan[] = []
    let root: string | undefined
    const failed: string[] = []
    for (const file of picked.filePaths) {
      try {
        const r = await parsePinyouFileAsync(file)
        plans.push(...r.plans)
        if (!root && r.root) root = r.root
        if (r.plans.length === 0) failed.push(path.basename(file))
      } catch (e) {
        failed.push(`${path.basename(file)}（${(e as Error).message}）`)
      }
    }
    if (plans.length === 0) {
      return {
        ok: false,
        error:
          '没在文件里找到礼物配置。要导入的配置是一张「礼物名 → 动作 / 视频」的 JSON 表，' +
          '在原软件里点「导出配置」得到的那个 .py 文件就是，选它再来导入。' +
          (failed.length ? `没认出来的文件：${failed.join('、')}` : '')
      }
    }
    return { ok: true, plans, root }
  } catch (e) {
    return { ok: false, error: '导入失败：' + (e as Error).message }
  } finally {
    importing = false
  }
}
