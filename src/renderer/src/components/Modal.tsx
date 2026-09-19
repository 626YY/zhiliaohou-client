import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: number
  /** 底部操作区（右对齐按钮组） */
  footer?: ReactNode
  closeDisabled?: boolean
  /** 点遮罩要不要关：表单类弹窗传 false（填了一半误点外面全没了），X / 取消 / Esc 不受影响 */
  closeOnBackdrop?: boolean
  /** 长向导只滚动内容，始终保留下一步/保存按钮。 */
  fixedFooter?: boolean
}

export function Modal({ open, onClose, title, children, width = 480, footer, closeDisabled = false, closeOnBackdrop = true, fixedFooter = false }: ModalProps) {
  const panel=useRef<HTMLDivElement>(null)
  const titleId=useId()
  const latest=useRef({onClose,closeDisabled})
  latest.current={onClose,closeDisabled}
  // 只处理最上层弹窗，Tab 不落到背后的页面；关闭后回到原来的操作入口。
  useEffect(() => {
    if (!open) return
    const previous=document.activeElement as HTMLElement|null
    const topmost=()=>Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1)===panel.current
    const focusables=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[]).filter(el=>el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))
    const focusFirst=()=>{if(topmost())(focusables()[0]||panel.current)?.focus()}
    const frame=requestAnimationFrame(()=>{if(!panel.current?.contains(document.activeElement))focusFirst()})
    const fn = (e: KeyboardEvent) => {
      if(!topmost())return
      if (e.key === 'Escape'&&!latest.current.closeDisabled) {e.preventDefault();e.stopImmediatePropagation();latest.current.onClose()}
      if(e.key==='Tab'){
        const nodes=focusables(),first=nodes[0],last=nodes.at(-1)
        if(!first){e.preventDefault();panel.current?.focus()}
        else if(e.shiftKey&&(document.activeElement===first||!panel.current?.contains(document.activeElement))){e.preventDefault();last?.focus()}
        else if(!e.shiftKey&&(document.activeElement===last||!panel.current?.contains(document.activeElement))){e.preventDefault();first.focus()}
      }
    }
    window.addEventListener('keydown', fn)
    return () => {cancelAnimationFrame(frame);window.removeEventListener('keydown', fn);if(previous?.isConnected)previous.focus()}
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="zl-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={closeDisabled || !closeOnBackdrop ? undefined : onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`zl-pop max-h-[88vh] rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] p-5 ${fixedFooter?'flex flex-col overflow-hidden':'overflow-y-auto'}`}
        style={{ width, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-[var(--text)]">{title}</h2>
          <button
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="关闭"
            className="rounded-md p-1 text-[var(--text-4)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        {fixedFooter?<div data-modal-scroll className="min-h-0 overflow-y-auto pr-1">{children}</div>:children}
        {footer && <div className="mt-5 flex shrink-0 justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
