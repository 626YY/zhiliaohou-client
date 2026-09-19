import {useCardStore} from '../lib/useCardAccess'
import { Lock } from 'lucide-react'
import { Btn } from './ui'

/**
 * 未授权门禁面板：游戏未授权时替换整个功能区展示。
 * 用法：<GatePanel gameName="xxx" feature="遥控整蛊" onGo={() => navigate('/launch')} />
 */
export function GatePanel({
  gameName,
  gameId,
  feature,
  onGo
}: {
  gameName: string
  gameId?: string
  /** 被锁住的功能名，如「修改参数」「遥控整蛊」 */
  feature: string
  onGo: () => void
}) {
  const cardMode=useCardStore(s=>!!s.snapshot?.enabled)
  const activate=useCardStore(s=>s.openPrompt)
  return (
    <div className="zl-card flex flex-col items-center justify-center gap-4 rounded-2xl p-16">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)]"
        style={{ boxShadow: '0 0 40px var(--accent-glow)' }}
      >
        <Lock size={28} className="text-[var(--accent)]" />
      </div>
      <p className="max-w-md text-center text-sm leading-6 text-[var(--text-3)]">
        {cardMode?`「${gameName}」尚未激活，暂时无法${feature}。激活对应游戏卡密后即可使用。`:`「${gameName}」尚未授权，暂时无法${feature}。前往「启动游戏」页申请授权，审核通过后即可使用。`}
      </p>
      <Btn size="lg" onClick={cardMode?()=>activate(gameId?'game:'+gameId:'platform:assistant'):onGo}>
        {cardMode?'激活卡密':'去申请授权'}
      </Btn>
    </div>
  )
}
