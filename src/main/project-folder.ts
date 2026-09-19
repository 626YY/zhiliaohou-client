// 项目文件夹：导出成一个文件夹、从文件夹导入、新建项目（2026-09-08 用户：
//   「导出项目的时候应该导出的是一个文件夹」
//   「你还得做个新建项目…自动整合项目，自动整合规则，到一个文件夹里面，
//     然后之后点导入项目的时候，别人可以直接读取」）
//
// 为什么必须是文件夹：一个项目 = 一堆视频 + 同名 .脚本，光给一份规则 JSON，
// 对方机器上没有视频，导进去全是按不动的规则。所以导出 =
//   <目标目录>/<项目名>/          视频 + .脚本 原样复制
//                  项目规则.json  规则（素材路径写成 <项目> 占位符）
// 导入就是反过来：文件夹整个复制进本机素材目录，占位符换成本机路径。
//
// 占位符而不是相对路径：规则里的参数还带着 `|绿幕2`、`|3.5` 这类后缀，
// 用占位符替换最不容易出错，也一眼能看出这条规则指的是本项目内的素材。
import fs from 'fs'
import path from 'path'
import { assetRoots, listProjects, projectEntries } from './pinyou-project'

/** 项目内素材的占位符：导出时把项目目录换成它，导入时再换回本机目录 */
export const PROJECT_TOKEN = '<项目>'
export const PROJECT_MANIFEST = '项目规则.json'

const MEDIA_CMDS = new Set(['project-random', 'video-play', 'video-random', 'sound-random', 'video-gif'])
/** 项目文件夹里要带走的东西：视频、音效、动图，以及品游那套同名 .脚本 */
const KEEP_EXT = /\.(mp4|webm|mov|mkv|avi|flv|wmv|m4v|mp3|wav|ogg|m4a|aac|flac|gif|apng|webp|png|jpg|jpeg|脚本|txt|json)$/i

type Rule = Record<string, unknown>

function splitParam(raw: string): { head: string; tail: string } {
  const value = String(raw ?? '')
  const cut = value.lastIndexOf('|')
  // `C:\a\b.mp4|0` 才是「路径+后缀」；盘符那个冒号后面不会有 |，所以 cut>1 足够
  return cut > 1 ? { head: value.slice(0, cut), tail: value.slice(cut) } : { head: value, tail: '' }
}

/** 规则里每个动作的素材参数都过一遍 map */
function mapRuleParams(rule: Rule, map: (value: string) => string | null): Rule {
  const out: Rule = { ...rule }
  if (out.actionType === 'command' && MEDIA_CMDS.has(String(out.commandCmd))) {
    const next = map(String(out.commandParam ?? ''))
    if (next != null) out.commandParam = next
  }
  if (Array.isArray(out.extraActions)) {
    out.extraActions = (out.extraActions as Rule[]).map((action) => {
      if (!action || action.actionType !== 'command' || !MEDIA_CMDS.has(String(action.commandCmd))) return action
      const next = map(String(action.commandParam ?? ''))
      return next == null ? action : { ...action, commandParam: next }
    })
  }
  return out
}

function copyTree(from: string, to: string): { files: number; bytes: number } {
  fs.mkdirSync(to, { recursive: true })
  let files = 0
  let bytes = 0
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name)
    const dst = path.join(to, name)
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      const sub = copyTree(src, dst)
      files += sub.files
      bytes += sub.bytes
      continue
    }
    if (!KEEP_EXT.test(name)) continue
    fs.copyFileSync(src, dst)
    files += 1
    bytes += stat.size
  }
  return { files, bytes }
}

/** 从规则里猜这个项目的素材目录：优先本机素材库里的同名项目，其次规则参数里的路径 */
function guessProjectDir(project: string, rules: Rule[]): string {
  const known = listProjects().projects.find((p) => p.name === project)
  if (known && fs.existsSync(known.dir)) return known.dir
  for (const rule of rules) {
    const params: string[] = []
    if (rule.actionType === 'command' && MEDIA_CMDS.has(String(rule.commandCmd))) params.push(String(rule.commandParam ?? ''))
    for (const action of Array.isArray(rule.extraActions) ? (rule.extraActions as Rule[]) : []) {
      if (action?.actionType === 'command' && MEDIA_CMDS.has(String(action.commandCmd))) params.push(String(action.commandParam ?? ''))
    }
    for (const raw of params) {
      const { head } = splitParam(raw)
      if (!head) continue
      // 参数可能是项目目录本身，也可能是目录里的某个视频
      const asDir = fs.existsSync(head) && fs.statSync(head).isDirectory() ? head : path.dirname(head)
      if (asDir && fs.existsSync(asDir) && path.basename(asDir) === project) return asDir
    }
  }
  return ''
}

/**
 * 导出一个项目成文件夹：素材原样复制 + 规则写进 项目规则.json（素材路径换成占位符）。
 * 素材目录找不到也照样出文件夹（只有规则），并把这件事说清楚 —— 别让主播以为发过去就能用。
 */
export function exportProject(
  project: string,
  rules: unknown[],
  destRoot: string
): { ok: boolean; error?: string; dir?: string; files?: number; bytes?: number; withMedia?: boolean } {
  const name = String(project || '').trim()
  if (!name) return { ok: false, error: '项目名为空' }
  if (!destRoot || !fs.existsSync(destRoot)) return { ok: false, error: '导出位置不存在' }
  const list = (Array.isArray(rules) ? rules : []) as Rule[]
  const source = guessProjectDir(name, list)
  // 目标目录：同名就加序号，绝不覆盖别人的东西
  let dir = path.join(destRoot, name)
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(destRoot, `${name}(${i})`)

  let copied = { files: 0, bytes: 0 }
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (source) copied = copyTree(source, dir)
    const packed = list.map((rule) =>
      mapRuleParams(rule, (raw) => {
        const { head, tail } = splitParam(raw)
        if (!head || !source) return null
        // 项目目录本身 → 占位符；目录里的文件 → 占位符 + 文件名
        const rel = path.relative(source, head)
        if (rel === '') return PROJECT_TOKEN + tail
        if (rel.startsWith('..') || path.isAbsolute(rel)) return null
        return path.join(PROJECT_TOKEN, rel) + tail
      })
    )
    fs.writeFileSync(
      path.join(dir, PROJECT_MANIFEST),
      JSON.stringify(
        { kind: 'zhiliao-project', version: 1, project: name, exportedAt: new Date().toISOString(), rules: packed },
        null,
        2
      ),
      'utf8'
    )
  } catch (error) {
    return { ok: false, error: '导出失败：' + (error as Error).message }
  }
  return { ok: true, dir, files: copied.files, bytes: copied.bytes, withMedia: !!source }
}

/** 本机素材目录（没设过就用第一个候选根目录） */
function localAssetRoot(): string {
  const roots = assetRoots()
  return roots[0] || ''
}

/**
 * 从文件夹导入一个项目。
 * 带 项目规则.json 的（别人导出的）：整个文件夹复制进本机素材目录，规则里的占位符换成本机路径。
 * 不带的（普通视频文件夹）：按条目自动生成规则，和「导入项目」列表里的行为一致。
 */
export function importProjectFolder(dir: string): {
  ok: boolean
  error?: string
  project?: string
  dir?: string
  rules?: Rule[]
  copied?: number
  fromManifest?: boolean
} {
  const from = String(dir || '')
  if (!from || !fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
    return { ok: false, error: '选中的不是文件夹' }
  }
  const project = path.basename(from.replace(/[\\/]+$/, ''))
  const manifestPath = path.join(from, PROJECT_MANIFEST)
  const root = localAssetRoot()
  if (!root) return { ok: false, error: '还没设置素材目录，先在设置页选一个' }

  // 已经在本机素材目录里的就不复制（别把自己的项目复制一份）
  const inside = path.resolve(from).toLowerCase().startsWith(path.resolve(root).toLowerCase())
  let target = inside ? from : path.join(root, project)
  let copied = 0
  if (!inside) {
    try {
      for (let i = 2; fs.existsSync(target); i++) target = path.join(root, `${project}(${i})`)
      copied = copyTree(from, target).files
    } catch (error) {
      return { ok: false, error: '复制素材失败：' + (error as Error).message }
    }
  }
  const projectName = path.basename(target)

  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { project?: string; rules?: Rule[] }
      const rules = (Array.isArray(manifest.rules) ? manifest.rules : []).map((rule) => {
        const fixed = mapRuleParams(rule, (raw) => {
          if (!raw.includes(PROJECT_TOKEN)) return null
          return raw.split(PROJECT_TOKEN).join(target)
        })
        // 分组一律用本机的项目名（同名冲突加了序号时也对得上）
        return { ...fixed, group: projectName, id: '' }
      })
      return { ok: true, project: projectName, dir: target, rules, copied, fromManifest: true }
    } catch (error) {
      return { ok: false, error: '项目规则.json 读不出来：' + (error as Error).message }
    }
  }
  // 没有清单：按条目建规则
  return { ok: true, project: projectName, dir: target, rules: projectRuleTemplates(target, projectName), copied, fromManifest: false }
}

/**
 * 一个项目文件夹 → 一批规则（每个视频一条：播它自己那条视频 + 跑同名脚本里的动作）。
 * 「导入项目 / 新建项目 / 从文件夹导入」三处共用，免得三份实现慢慢跑偏。
 */
export function projectRuleTemplates(dir: string, project: string, slot = 0): Rule[] {
  const out: Rule[] = []
  for (const entry of projectEntries(dir)) {
    const main =
      slot >= 1 && slot <= 4
        ? { actionType: 'command', commandCmd: 'project-random', commandParam: `${dir}|绿幕${slot}` }
        : { actionType: 'command', commandCmd: 'video-play', commandParam: `${entry.video}|0` }
    const extras: Rule[] = []
    let pending = 0
    for (const command of entry.commands) {
      if (command.cmd === 'delay') {
        pending += Number(command.param) || 0
        continue
      }
      extras.push({ actionType: 'command', commandCmd: command.cmd, commandParam: command.param, delayMs: pending })
      pending = 0
    }
    out.push({
      id: '',
      name: entry.name,
      giftName: '',
      enabled: false,
      triggerType: 'gift',
      group: project,
      remark: `项目 ${project}`,
      ...main,
      extraActions: extras
    })
  }
  return out
}

/**
 * 新建项目：在本机素材目录里建一个文件夹，把选中的视频复制进去，并按条目生成规则。
 * 主播自己攒的素材也能变成「项目」，导出给别人 / 用盲盒随机抽都走同一套。
 */
export function createProject(
  name: string,
  files: string[]
): { ok: boolean; error?: string; dir?: string; copied?: number; rules?: Rule[] } {
  const project = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '')
  if (!project) return { ok: false, error: '项目名不能为空，也不能带 \\ / : * ? " < > |' }
  const root = localAssetRoot()
  if (!root) return { ok: false, error: '还没设置素材目录，先在设置页选一个' }
  const dir = path.join(root, project)
  if (fs.existsSync(dir)) return { ok: false, error: `素材目录里已经有「${project}」了，换个名字` }
  let copied = 0
  try {
    fs.mkdirSync(dir, { recursive: true })
    for (const file of Array.isArray(files) ? files : []) {
      if (!file || !fs.existsSync(file)) continue
      fs.copyFileSync(file, path.join(dir, path.basename(file)))
      copied += 1
      // 视频旁边有同名 .脚本 就一起带过来（品游那套素材就是成对的）
      const base = file.slice(0, file.length - path.extname(file).length)
      for (const ext of ['.脚本', '.txt']) {
        if (fs.existsSync(base + ext)) fs.copyFileSync(base + ext, path.join(dir, path.basename(base) + ext))
      }
    }
  } catch (error) {
    return { ok: false, error: '建项目失败：' + (error as Error).message }
  }
  return { ok: true, dir, copied, rules: projectRuleTemplates(dir, project) }
}
