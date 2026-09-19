import { useState } from 'react'
import { KeyRound, Plus, QrCode, RefreshCw, Repeat2, X } from 'lucide-react'
import { Modal } from './Modal'
import { Btn, Input, Pill } from './ui'
import { useToast } from '../stores/ui'
import { useAuth } from '../stores/auth'
import { useRoomQuota } from './room/useRoomQuota'
import { RoomBindWizard, RoomCardPanel, type CardKind, type WizardMode } from './room/RoomBindWizard'
import { orderedBindings, preflight, quotaSummary } from './room/roomApi'

// 卡密模式的直播间管理（基础）：清楚列出已绑的直播间、已用 / 可用名额、剩余改绑次数；
// 「添加另一个直播间」和「更换这个直播间」是两件事，绝不偷偷替换；解绑说清后果、不清任何视频配置。
// 旧的邮箱授权 / 申请审批流程（legacy 模式）不经过这里。

interface Props {
  /** 直播连接器里的紧凑版（弹窗内） */
  compact?: boolean
  /** 绑定 / 改绑成功后通知外层（连接器据此自动选中） */
  onBound?: (room: string) => void
}

type WizardOpen = { key: number; mode: WizardMode; initialCard: CardKind | null; initialInput?: string; scanFirst?: boolean }

export default function RoomManager({ compact = false, onBound }: Props) {
  const toast = useToast((s) => s.toast)
  const user = useAuth((s) => s.user)
  const { api, quota, loaded, error, refresh, apply } = useRoomQuota()
  const fallbackRooms = user?.boundRooms ?? []
  const summary = quotaSummary(quota, fallbackRooms)
  const bindings = orderedBindings(quota, fallbackRooms)
  const [wizard, setWizard] = useState<WizardOpen | null>(null)
  const [cardModal, setCardModal] = useState<CardKind | null>(null)
  const [unbindTarget, setUnbindTarget] = useState<string | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [text, setText] = useState('')
  // 本次运行里解绑过的直播间：空出来的名额再绑别的会算 1 次改绑，向导确认页据此提前说明
  const [recentUnbound, setRecentUnbound] = useState<string[]>([])

  const ready = !!api
  const notReady = () => toast('直播间绑定接口还没就绪，请更新客户端后再试', 'error')

  const openWizard = (mode: WizardMode, opts: { initialInput?: string; scanFirst?: boolean } = {}) => {
    if (!api) return notReady()
    const need = preflight(quota, mode.action)
    setWizard({ key: Date.now(), mode, initialCard: need === 'room_slot' || need === 'room_change' ? need : null, ...opts })
  }

  const doUnbind = async () => {
    if (!unbindTarget || !api) return
    const room = unbindTarget
    setUnbinding(true)
    try {
      const res = await api.unbindRoom(room)
      if (res.ok) {
        apply(undefined, res.boundRooms)
        setUnbindTarget(null)
        setRecentUnbound((l) => (l.includes(room) ? l : [...l, room]))
        toast(`已解绑直播间 ${room}`, 'success')
        void refresh()
      } else {
        toast(res.error || '解绑失败，请重试', 'error')
      }
    } catch (e) {
      toast('解绑失败：' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setUnbinding(false)
    }
  }

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      const q = await refresh()
      if (!q) toast(error || '暂时读不到直播间名额', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const addTitle = bindings.length ? '添加另一个直播间' : '绑定直播间'
  const addBlocked = ready && !!quota && summary.available <= 0

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'} data-testid="room-manager" data-ready={ready ? '1' : '0'}>
      {/* 名额一眼看清 */}
      <div className="flex flex-wrap items-center gap-2" data-testid="room-quota">
        <Pill tone={summary.bound > 0 ? 'ok' : 'muted'} dot>
          {summary.free ? `已绑定 ${summary.bound} 个` : `已绑定 ${summary.bound} / ${summary.capacity} 个`}
        </Pill>
        {summary.free ? (
          <Pill tone="info">数量不限 · 改绑不限</Pill>
        ) : (
          <>
            <Pill tone={summary.available > 0 ? 'info' : 'muted'}>可添加 {summary.available} 个</Pill>
            <Pill tone={summary.changesLeft > 0 ? 'accent' : 'warn'}>剩余改绑 {summary.changesLeft} 次</Pill>
          </>
        )}
        <Btn variant="ghost" size="sm" onClick={doRefresh} disabled={refreshing || !ready} aria-label="刷新直播间名额" className="ml-auto">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </Btn>
      </div>
      {!ready ? (
        <p className="text-xs leading-5 text-[var(--warn)]" data-testid="room-not-ready">
          直播间绑定接口还没就绪。请更新客户端；已绑定的直播间仍可在连接器里使用。
        </p>
      ) : error && !quota ? (
        <p className="text-xs leading-5 text-[var(--danger)]" role="alert">
          {error}。已绑定的直播间仍按本机记录显示。
        </p>
      ) : !loaded ? (
        <p className="text-xs text-[var(--text-3)]">正在读取直播间名额…</p>
      ) : null}

      {/* 已绑列表 */}
      <div className="space-y-2" data-testid="room-list">
        {bindings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--line-strong)] px-4 py-3 text-xs leading-5 text-[var(--text-3)]">
            还没有绑定直播间。默认可以绑 1 个：输入直播间号或直播链接，用抖音扫一次码就好。
          </div>
        ) : null}
        {bindings.map((b, i) => (
          <div
            key={b.room}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2"
            data-testid="room-row"
            data-room={b.room}
          >
            <span className="text-xs text-[var(--text-4)]">直播间 {i + 1}</span>
            <span className="select-text font-mono text-sm text-[var(--text)]">{b.room}</span>
            <Pill tone="ok" dot>已绑定</Pill>
            <div className="ml-auto flex items-center gap-1">
              <Btn variant="ghost" size="sm" onClick={() => openWizard({ action: 'replace', previous: b.room })} disabled={!ready} data-testid="room-replace-btn">
                <Repeat2 size={13} />
                更换这个直播间
              </Btn>
              <Btn variant="ghost" size="sm" onClick={() => setUnbindTarget(b.room)} disabled={!ready} className="hover:!text-[var(--danger)]" data-testid="room-unbind-btn">
                <X size={13} />
                解绑
              </Btn>
            </div>
          </div>
        ))}
      </div>

      {/* 添加 / 绑定：输入房号或链接 → 扫码；也可以先扫码 */}
      <div className="space-y-2 rounded-xl border border-[var(--line)] p-3" data-testid="room-add">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--text)]">{addTitle}</span>
          {addBlocked ? <span className="text-xs text-[var(--warn)]">名额已用完，添加需要名额卡</span> : null}
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="抖音直播间号或直播链接"
            placeholder="直播间号，或粘贴直播链接"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openWizard({ action: 'bind' }, { initialInput: text.trim() || undefined })
            }}
            autoComplete="off"
            spellCheck={false}
            data-testid="room-add-input"
          />
          <Btn variant="secondary" className="shrink-0" onClick={() => openWizard({ action: 'bind' }, { initialInput: text.trim() || undefined })} data-testid="room-add-btn">
            <Plus size={14} />
            绑定
          </Btn>
          {summary.free ? null : (
            <Btn variant="secondary" className="shrink-0" onClick={() => openWizard({ action: 'bind' }, { scanFirst: true })} title="不知道直播间号也没关系，扫完再补一次链接" data-testid="room-scan-btn">
              <QrCode size={14} />
              先扫码
            </Btn>
          )}
        </div>
        <p className="text-xs leading-5 text-[var(--text-4)]">
          {summary.free
            ? '输入直播间号或粘贴直播链接就能绑定，数量和改绑次数都不限；第一次连接直播时扫码登录抖音，登录状态保存在本机。'
            : '绑定会打开浏览器用抖音扫码，确认直播间是你本人的；扫码时的登录状态保存在本机，连接直播直接用。'}
        </p>
      </div>

      {/* 卡密：名额卡 / 改绑卡（免检时没有名额概念，整段不显示） */}
      {summary.free ? null : (
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
        <Btn variant="ghost" size="sm" onClick={() => setCardModal('room_slot')} data-testid="room-slot-card-btn">
          <KeyRound size={13} />
          用名额卡加名额
        </Btn>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => setCardModal('room_change')}
          disabled={ready && !!quota && summary.changesLeft >= 3}
          title={ready && !!quota && summary.changesLeft >= 3 ? '改绑次数已满 3 次，暂时不需要' : undefined}
          data-testid="room-change-card-btn"
        >
          <KeyRound size={13} />
          用改绑卡补次数
        </Btn>
        <span className="ml-auto">名额卡：长期 +1 个直播间；改绑卡：改绑次数 +3（可累加）</span>
      </div>
      )}

      {wizard && api ? (
        <RoomBindWizard
          key={wizard.key}
          open
          mode={wizard.mode}
          api={api}
          quota={quota}
          initialCard={wizard.initialCard}
          initialInput={wizard.initialInput}
          scanFirst={wizard.scanFirst}
          recentUnbound={wizard.mode.action === 'bind' ? recentUnbound : []}
          onClose={() => setWizard(null)}
          onRefreshQuota={refresh}
          onApply={(q, rooms) => {
            apply(q, rooms)
            // 空位被占掉了就不再提醒
            if (q && (Number(q.available) || 0) <= 0) setRecentUnbound([])
          }}
          onBound={(room) => {
            setText('')
            setRecentUnbound((l) => l.filter((r) => r !== room))
            onBound?.(room)
          }}
        />
      ) : null}

      <Modal
        open={!!cardModal}
        onClose={() => setCardModal(null)}
        title={cardModal === 'room_change' ? '用改绑卡补次数' : '用名额卡加名额'}
        width={480}
        closeOnBackdrop={false}
        footer={<Btn variant="secondary" onClick={() => setCardModal(null)}>关闭</Btn>}
      >
        {cardModal ? (
          <div data-testid="room-card-modal" data-kind={cardModal}>
            <p className="mb-3 text-sm leading-6 text-[var(--text-2)]">
              {cardModal === 'room_change'
                ? `当前剩余改绑 ${summary.changesLeft} 次。每张改绑卡增加 3 次改绑机会，可以累加。`
                : `当前名额 ${summary.capacity} 个，已绑 ${summary.bound} 个。每张名额卡长期增加 1 个直播间名额。`}
            </p>
            <RoomCardPanel
              kind={cardModal}
              quota={quota}
              onDone={async () => {
                await refresh()
                setCardModal(null)
                toast('卡密已激活，名额已刷新', 'success')
              }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!unbindTarget}
        onClose={() => (unbinding ? undefined : setUnbindTarget(null))}
        title="解绑直播间"
        width={440}
        closeDisabled={unbinding}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setUnbindTarget(null)} disabled={unbinding}>
              取消
            </Btn>
            <Btn variant="danger" onClick={() => void doUnbind()} disabled={unbinding} data-testid="room-unbind-confirm">
              {unbinding ? '正在解绑…' : '确认解绑'}
            </Btn>
          </>
        }
      >
        <div data-testid="room-unbind-dialog">
          <p className="text-sm leading-6 text-[var(--text-2)]">
            解绑直播间 <span className="select-text font-mono text-[var(--text)]">{unbindTarget}</span>？
          </p>
          <ul className="mt-3 space-y-1.5 text-xs leading-5 text-[var(--text-3)]">
            {summary.free ? <li>随时可以再绑回来，没有数量和次数限制。</li> : <li>解绑后这个名额空出来：可添加 {summary.available} 个 → {summary.available + 1} 个。</li>}
            {summary.free ? null : (
                <li>解绑本身不消耗改绑次数（剩 {summary.changesLeft} 次）；之后用这个旧名额绑定别的直播间会算 1 次改绑，绑回同一个不算。新增加且没用过的名额首次绑定免费。</li>
            )}
            <li>视频、规则、盲盒等配置都不会被清除。</li>
          </ul>
        </div>
      </Modal>
    </div>
  )
}
