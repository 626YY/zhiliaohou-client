# -*- coding: utf-8 -*-
"""界面：去掉「品游」字样、去掉多出来的那个行内开关、导出项目改成导出文件夹、
从文件夹导入项目、新建项目。
用户 2026-09-08：「就叫导入项目就行了」「品游俩字可以不要出现了」
                「项目规则的开关你做了俩。做多了」
                「导出项目的时候应该导出的是一个文件夹」
                「你还得做个新建项目…自动整合项目/规则到一个文件夹，别人点导入项目直接读取」
用法：python tools/patch-ui-project.py"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES = os.path.join(ROOT, 'src', 'renderer', 'src', 'pages', 'EntertainmentGiftRules.tsx')
SETTINGS = os.path.join(ROOT, 'src', 'renderer', 'src', 'pages', 'Settings.tsx')

# ---- ① 界面文案里的「品游」全部换掉（注释里保留，方便以后知道来源）----
TEXT_SWAP = [
    ("<FolderInput size={14} /> 导入品游项目", "<FolderInput size={14} /> 导入项目"),
    ("<FileInput size={14} /> 导入品游配置", "<FileInput size={14} /> 导入旧软件配置"),
    ('title="导入品游配置"', 'title="导入旧软件配置"'),
    ('title="导入品游项目"', 'title="导入项目"'),
    ("label: '品游脚本', hint: '导入品游 .脚本 后自动生成", "label: '脚本序列', hint: '导入 .脚本 后自动生成"),
    ("toast(r.error || '没认出品游配置', 'error')", "toast(r.error || '没认出这个配置文件', 'error')"),
    ("toast(`读取品游配置失败：${(e as Error).message}`, 'error')", "toast(`读取配置失败：${(e as Error).message}`, 'error')"),
    ("已认出品游目录：{result.root}", "已认出素材目录：{result.root}"),
    ("没找到品游的安装目录（音效 / 视频只带了文件名）", "没找到对应的素材目录（音效 / 视频只带了文件名）"),
    ("，品游里空着的礼物 {plan.empty} 个", "，原配置里空着的礼物 {plan.empty} 个"),
    ("'还没设置品游素材目录，点「换素材目录」选一次", "'还没设置素材目录，点「换素材目录」选一次"),
    ("品游素材直接选就行", "素材文件夹直接选就行"),
    ("品游就是这么用的，各绑不同礼物", "一个视频一条规则，各绑不同礼物"),
    ("礼物名留给你填——品游就是这么用的", "礼物名留给你填"),
    ("读娱乐助手Pro（品游）的礼物配置文件，转成这里的规则", "读旧软件（娱乐助手Pro）的礼物配置文件，转成这里的规则"),
    ("把素材目录里的项目（一个文件夹一个项目）批量建成规则", "把素材目录里的项目（一个文件夹一个项目）批量建成规则"),
]
SETTINGS_SWAP = [
    ("<span>品游素材目录</span>", "<span>素材目录</span>"),
    ('aria-label="浏览选择品游素材目录"', 'aria-label="浏览选择素材目录"'),
]

EDITS = [
    # ---- ② 去掉行内那个多出来的开关（项目标题上的组开关才是要的）----
    ('', """                {/* 开关也搬出来：原来开停一条规则得进弹窗 */}
                <Toggle
                  value={r.enabled !== false}
                  disabled={!String(r.giftName || '').trim()}
                  onChange={(on) => void toggleRule(r, on)}
                />
""", ""),
    # 行左边的「未绑礼物」也去掉：右边那个空的红框输入框已经说明了，组标题也报了条数
    ('', """                  {!String(r.giftName || '').trim() && <Pill tone="warn">未绑礼物</Pill>}
""", ""),

    # ---- ③ 导出项目：改成导出【文件夹】（素材 + 项目规则.json）----
    ('projectExport(', """  // 单个项目导出：别的主播想要这个项目，直接把这个文件发给他。
  // ★只带规则，不带视频——素材得另外发（对方把同名文件夹放进自己的素材目录即可）
  const exportGroup = (group: string) => {
    const rows = rules.filter((r) => String(r.group || '').trim() === group)
    if (!rows.length) return toast('这个项目下没有规则', 'error')
    downloadJson(
      { kind: 'zhiliao-ent-rules', version: 1, project: group, exportedAt: new Date().toISOString(), rules: rows },
      `项目_${group}_${today()}.json`
    )
    toast(`已导出项目「${group}」${rows.length} 条规则。视频素材要另外发给对方，让他把同名文件夹放进自己的品游素材目录`, 'success')
  }""",
     """  // 单个项目导出成【一个文件夹】：视频 + 同名脚本 + 项目规则.json，
  // 别的主播拿到整个文件夹，点「导入项目」就能直接用（2026-09-08 用户要求）
  const exportGroup = async (group: string) => {
    const rows = rules.filter((r) => String(r.group || '').trim() === group)
    if (!rows.length) return toast('这个项目下没有规则', 'error')
    const r = await window.api.projectExport(group, rows)
    if (r.canceled) return
    if (!r.ok) return toast(r.error || '导出失败', 'error')
    const size = r.bytes ? `，素材 ${(r.bytes / 1024 / 1024).toFixed(1)} MB` : ''
    toast(
      r.withMedia
        ? `项目「${group}」已导出到 ${r.dir}：${rows.length} 条规则、${r.files} 个文件${size}。整个文件夹发给对方，他点「导入项目」就能用`
        : `项目「${group}」已导出到 ${r.dir}，但没找到它的素材文件夹，只带了规则——对方还需要你把视频发给他`,
      r.withMedia ? 'success' : 'info'
    )
  }"""),

    # ---- ④ 新建项目 + 从文件夹导入项目 ----
    ('const [newProject, setNewProject]', """  const [presetName, setPresetName] = useState('')""",
     """  const [presetName, setPresetName] = useState('')
  const [newProject, setNewProject] = useState(false)"""),

    ('const importFolder', """  const remove = async (id: string) => {""",
     """  // 从文件夹导入项目：别人发来的项目文件夹（带 项目规则.json）或者任意装着视频的文件夹
  const importFolder = async () => {
    const r = await window.api.projectImportFolder()
    if (r.canceled) return
    if (!r.ok) return toast(r.error || '导入失败', 'error')
    await load()
    const how = r.fromManifest ? '按对方的规则' : '按里面的视频'
    const copy = r.copied ? `，素材复制了 ${r.copied} 个文件` : ''
    toast(`项目「${r.project}」已导入：${how}建了 ${r.added} 条规则${copy}。填上礼物名再打开项目开关`, 'success')
  }

  const remove = async (id: string) => {"""),

    # 工具栏加「新建项目」
    ('新建项目', """          <Btn onClick={() => openEdit()}>
            <Plus size={14} /> 新增规则
          </Btn>""",
     """          <Btn variant="secondary" onClick={() => setNewProject(true)} title="在素材目录里建一个新项目：挑一批视频进去，自动建好规则">
            <FolderPlus size={14} /> 新建项目
          </Btn>
          <Btn onClick={() => openEdit()}>
            <Plus size={14} /> 新增规则
          </Btn>"""),

    ('NewProjectModal', """      <ProjectImportModal
        open={projectImport}
        onClose={() => setProjectImport(false)}
        onDone={(msg) => { void load(); toast(msg, 'success') }}
      />""",
     """      <ProjectImportModal
        open={projectImport}
        onClose={() => setProjectImport(false)}
        onDone={(msg) => { void load(); toast(msg, 'success') }}
        onImportFolder={() => { setProjectImport(false); void importFolder() }}
      />

      <NewProjectModal
        open={newProject}
        onClose={() => setNewProject(false)}
        onDone={(msg) => { void load(); toast(msg, 'success') }}
      />"""),

    # 图标
    ('FolderPlus', "ChevronUp, ChevronDown, FolderInput, Save, Layers } from 'lucide-react'",
     "ChevronUp, ChevronDown, FolderInput, FolderPlus, Save, Layers } from 'lucide-react'"),

    # ---- ⑤ 导入弹窗：加「从文件夹导入」入口 ----
    ('onImportFolder', """function ProjectImportModal({
  open,
  onClose,
  onDone
}: {
  open: boolean
  onClose: () => void
  onDone: (msg: string) => void
}): React.JSX.Element {""",
     """function ProjectImportModal({
  open,
  onClose,
  onDone,
  onImportFolder
}: {
  open: boolean
  onClose: () => void
  onDone: (msg: string) => void
  onImportFolder: () => void
}): React.JSX.Element {"""),

    ('选文件夹导入', """        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
          <span>素材目录：{root || '未设置'}</span>""",
     """        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
          <span>素材目录：{root || '未设置'}</span>
          <Btn variant="secondary" size="sm" onClick={onImportFolder} title="选一个文件夹导入（别人发来的项目文件夹，或任意装着视频的文件夹）">
            选文件夹导入
          </Btn>"""),
]

NEW_PROJECT_MODAL = '''
// 新建项目：在素材目录里建一个文件夹，挑一批视频复制进去，自动按条目建好规则。
// 这样主播自己攒的素材也是「项目」——能整组开关、能导出给别人（2026-09-08 用户要求）。
function NewProjectModal({
  open,
  onClose,
  onDone
}: {
  open: boolean
  onClose: () => void
  onDone: (msg: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pick = async () => {
    const r = await window.api.selectFile({
      title: '选择要放进这个项目的视频（可多选）',
      filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (!r.ok) return
    const picked = r.paths?.length ? r.paths : r.path ? [r.path] : []
    setFiles((prev) => [...new Set([...prev, ...picked])])
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建项目"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-4)]">选了 {files.length} 个视频</span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>取消</Btn>
            <Btn
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true)
                setErr('')
                try {
                  const r = await window.api.projectCreate(name.trim(), files)
                  if (!r.ok) {
                    setErr(r.error || '建不了')
                    return
                  }
                  onClose()
                  setName('')
                  setFiles([])
                  onDone(
                    `项目「${name.trim()}」已建好：复制了 ${r.copied || 0} 个视频，自动建了 ${r.added || 0} 条规则。填上礼物名再打开项目开关`
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? '建立中…' : '建立项目'}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="项目名" hint="就是素材目录里那个文件夹的名字，比如「翻牌子时间」">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="项目名" />
        </Field>
        <Field label="视频" hint="复制进项目文件夹；视频旁边有同名 .脚本 会一起带过来">
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => void pick()}>选视频</Btn>
            {files.length > 0 && (
              <Btn variant="ghost" size="sm" onClick={() => setFiles([])}>清空</Btn>
            )}
          </div>
          {files.length > 0 && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded border border-[var(--line)] bg-[var(--bg-input)] p-1">
              {files.map((f) => (
                <div key={f} className="truncate px-2 py-1 text-xs text-[var(--text-3)]" title={f}>
                  {f.split(/[\\\\/]/).pop()}
                </div>
              ))}
            </div>
          )}
        </Field>
        <p className="text-[11px] leading-4 text-[var(--text-4)]">
          建好后每个视频一条规则（规则名 = 视频名，默认停用）。之后可以在项目标题右边把整个项目导出成一个文件夹发给别人。
        </p>
        {err && <p role="alert" className="text-sm text-[var(--danger)]">{err}</p>}
      </div>
    </Modal>
  )
}

'''


def main() -> int:
    src = io.open(RULES, encoding='utf-8').read()
    out = src
    bad = []
    for old, new in TEXT_SWAP:
        if old in out:
            out = out.replace(old, new)
        elif new not in out:
            bad.append('文案：' + old[:50])
    for marker, old, new in EDITS:
        if marker and marker in out:
            print('  已有 %s，跳过' % marker[:36])
            continue
        if old not in out:
            bad.append(old.strip().splitlines()[0][:66])
            continue
        out = out.replace(old, new, 1)
    # 新建项目弹窗组件：插在 ProjectImportModal 定义之前
    if 'function NewProjectModal' not in out:
        anchor = '// 批量导入'
        idx = out.find(anchor)
        if idx < 0:
            m = re.search(r'^function ProjectImportModal\(', out, re.M)
            idx = m.start() if m else -1
        if idx < 0:
            bad.append('找不到插 NewProjectModal 的位置')
        else:
            out = out[:idx] + NEW_PROJECT_MODAL + out[idx:]
    for b in bad:
        print('！锚点没对上：%s' % b)
    if bad:
        return 2
    if out != src:
        io.open(RULES, 'w', encoding='utf-8', newline='').write(out)
        print('EntertainmentGiftRules.tsx %d → %d' % (len(src), len(out)))

    s = io.open(SETTINGS, encoding='utf-8').read()
    o = s
    for old, new in SETTINGS_SWAP:
        o = o.replace(old, new)
    if o != s:
        io.open(SETTINGS, 'w', encoding='utf-8', newline='').write(o)
        print('Settings.tsx 已改（品游素材目录 → 素材目录）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
