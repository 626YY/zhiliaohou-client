import { useEffect, useMemo, useState } from 'react'
import { Bell, BellOff, CheckCheck, Inbox, MailCheck, RefreshCw } from 'lucide-react'
import type { AppNotification } from '@shared/types'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/ui'
import { useNotify } from '../stores/notify'
import { Btn, EmptyState, Loading, PageHeader, Pill } from '../components/ui'

const typeIcon: Record<string, { cls: string; ic: string }> = {
  unbind: { cls: 'bg-[var(--danger-soft)] text-[var(--danger)]', ic: '解绑' },
  replace: { cls: 'bg-[var(--warn-soft)] text-[var(--warn)]', ic: '换绑' },
  purchase: { cls: 'bg-[var(--ok-soft)] text-[var(--ok)]', ic: '购买' },
  approve: { cls: 'bg-[var(--info-soft)] text-[var(--info)]', ic: '审批' },
  grant: { cls: 'bg-[var(--accent-soft)] text-[var(--accent-2)]', ic: '授权' }
}

function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Notifications() {
  const user = useAuth((s) => s.user)
  const toast = useToast((s) => s.toast)
  const setUnread = useNotify((s) => s.setUnread)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const email = user?.email

  const load = async () => {
    if (!email) {
      setLoading(false)
      return
    }
    setLoading(true)
    const res = await window.api.emailNotifyList(email)
    setLoading(false)
    if (!res.ok || !res.list) {
      toast(res.error ?? '通知拉取失败，请检查网络后重试。', 'error')
      return
    }
    setItems(res.list)
    setUnread(res.list.filter((n) => !n.read).length)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email])

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.ts - a.ts),
    [items]
  )
  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const readOne = async (n: AppNotification) => {
    if (n.read) return
    await window.api.emailNotifyRead(email!, n.id)
    const next = items.map((x) => (x.id === n.id ? { ...x, read: 1 } : x))
    setItems(next)
    setUnread(next.filter((x) => !x.read).length)
  }

  const readAll = async () => {
    await window.api.emailNotifyReadAll(email!)
    const next = items.map((x) => ({ ...x, read: 1 }))
    setItems(next)
    setUnread(0)
    toast('已全部标记为已读', 'success')
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader
        icon={<Bell size={20} className="text-[var(--accent-2)]" />}
        title="消息通知"
        desc="解绑、换绑、购买和授权的结果都推到这里。"
        actions={
          <>
            {unreadCount > 0 && (
              <Pill tone="accent" dot>
                <span className="tnum">{unreadCount}</span> 条未读
              </Pill>
            )}
            <Btn variant="secondary" size="sm" onClick={load} aria-label="刷新通知">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              onClick={readAll}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={13} /> 全部已读
            </Btn>
          </>
        }
      />

      <div className="mt-5">
        {!email ? (
          <EmptyState
            icon={<BellOff size={36} />}
            title="登录后查看通知"
            desc="还没登录邮箱账号。登录后消息会推到这里。"
          />
        ) : loading && items.length === 0 ? (
          <Loading text="正在拉取通知…" />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<Inbox size={36} />}
            title="暂无通知"
            desc="授权审批和购买结果会通知你。"
          />
        ) : (
          <div className="space-y-2">
            {sorted.map((n) => {
              const t =
                typeIcon[n.type] ?? {
                  cls: 'bg-[var(--bg-elev)] text-[var(--text-3)]',
                  ic: '通知'
                }
              return (
                <button
                  key={n.id}
                  onClick={() => readOne(n)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition duration-150 hover:-translate-y-0.5 ${
                    n.read
                      ? 'border-[var(--line)] bg-[var(--bg-card)] hover:border-[var(--line-strong)]'
                      : 'border-[var(--accent-soft-2)] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft-2)]'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${t.cls}`}
                  >
                    {t.ic}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text)]">{n.text}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-[var(--text-3)]">
                      <MailCheck size={12} className="text-[var(--text-4)]" />
                      <span className="tnum">{fmtTime(n.ts)}</span>
                    </span>
                  </span>
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
