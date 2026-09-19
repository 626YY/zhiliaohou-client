import { useEffect, useState, useRef } from 'react'
import { RefreshCw, Download, CheckCircle2 } from 'lucide-react'
import { Modal } from './Modal'
import { Btn } from './ui'
import { useToast } from '../stores/ui'
import type { UpdateStatusPayload } from '@shared/types'

// 自动更新弹窗：发现新版本问是否更新 → 下载进度条 → 下载完问是否重启安装。
// 状态来自主进程 updater.ts（electron-updater）推送的 UpdateStatus 事件。
export default function UpdateModal() {
  const toast = useToast((s) => s.toast)
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null)
  const [visible, setVisible] = useState(false)
  // 用 ref：订阅只建一次，闭包里的 state 永远是初始值，「稍后」点了下一条进度又把弹窗弹回来
  const snoozedRef = useRef(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return window.api.onUpdateStatus((p) => {
      setStatus(p)
      if (p.state === 'available') {
        snoozedRef.current = false
        setVisible(true)
      } else if (p.state === 'downloading') {
        if (!snoozedRef.current) setVisible(true)
      } else if (p.state === 'downloaded') {
        snoozedRef.current = false
        setVisible(true)
      } else if (p.state === 'not-available') {
        toast('当前已是最新版本', 'success')
      } else if (p.state === 'error') {
        toast('更新出错：' + (p.detail ?? '未知错误'), 'error')
      }
    })
  }, [toast])

  const dismiss = () => {
    setVisible(false)
    // 下载中关掉弹窗别让进度条反复弹回，等下载完再弹重启确认
    snoozedRef.current = true
  }

  const startDownload = async () => {
    setBusy(true)
    try {
      const res = await window.api.downloadUpdate()
      if (!res.ok) toast(res.error ?? '下载更新失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  // 「本次更新了什么」：从公告里找标题带这个版本号的那条，直接展示在弹窗里
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!visible || status?.state !== 'available' || !status.detail) return
    let alive = true
    const ver = String(status.detail)
    window.api.listNews().then((list) => {
      if (!alive) return
      const hit = list.find((n) => n.title.includes(ver))
      setNotes(hit?.content || '')
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [visible, status])

  if (!visible || !status) return null

  const pct = status.progress ?? 0
  const version = status.detail

  const footer =
    status.state === 'available' ? (
      <>
        <Btn variant="secondary" onClick={dismiss}>
          稍后
        </Btn>
        <Btn onClick={startDownload} disabled={busy}>
          {busy ? '开始下载…' : '立即更新'}
        </Btn>
      </>
    ) : status.state === 'downloaded' ? (
      <>
        <Btn variant="secondary" onClick={dismiss}>
          稍后重启
        </Btn>
        <Btn onClick={() => window.api.updateInstall()}>立即重启</Btn>
      </>
    ) : undefined

  return (
    <Modal open={visible} onClose={dismiss} title="软件更新" width={420} footer={footer}>
      {status.state === 'available' && (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-2)]">
            <Download size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--text)]">
              发现新版本
              {version && <span className="select-text tnum"> v{version}</span>}
            </div>
            <div className="mt-0.5 text-xs text-[var(--text-3)]">
              下载完要重启客户端。
            </div>
            {notes && (
              <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-xs leading-5 text-[var(--text-2)]">
                <div className="mb-1 font-medium text-[var(--text)]">本次更新</div>
                {notes}
              </div>
            )}
          </div>
        </div>
      )}

      {status.state === 'downloading' && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-2)]">
              <RefreshCw size={20} className="animate-spin" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--text)]">
                正在下载更新
              </div>
              <div className="tnum mt-0.5 text-xs text-[var(--text-3)]">
                已下载 {pct}%
              </div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-elev)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent-2)] to-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-4 text-right text-xs text-[var(--text-4)]">
            下载完成前请保持客户端开启。
          </div>
        </>
      )}

      {status.state === 'downloaded' && (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ok-soft)] text-[var(--ok)]">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--text)]">
              更新包已就绪
            </div>
            <div className="mt-0.5 text-xs text-[var(--text-3)]">
              重启客户端即可完成安装。
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
