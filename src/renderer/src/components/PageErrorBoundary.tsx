import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Btn } from './ui'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// 页面级错误边界：某个页面渲染炸了只影响那一块，不再整个客户端白屏（侧栏、顶栏都还在）。
// 错误同时打到 console.error，回归测试和主播截图都能看到具体原因。
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[页面出错]', error, info.componentStack)
    // 记进主进程日志（userData/logs/main.log），主播机器上事后也能查
    try {
      void window.api?.reportError?.({ message: String(error?.message || error), stack: String(error?.stack || '').slice(0, 4000), component: String(info.componentStack || '').slice(0, 2000), route: location.hash })
    } catch {
      /* 上报失败不影响页面 */
    }
  }

  componentDidUpdate(prev: Props): void {
    // 切到别的页面时清掉错误态，让新页面正常渲染
    if (this.state.error && prev.children !== this.props.children) this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const message = String(this.state.error?.message || this.state.error || '未知错误')
    return (
      <div className="p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
            <AlertTriangle size={16} /> 这个页面出错了
          </div>
          <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--bg)] p-3 text-[11px] leading-4 text-[var(--text-2)]">{message}</pre>
          <div className="flex items-center gap-2">
            <Btn size="sm" onClick={() => this.setState({ error: null })}><RotateCcw size={13} /> 重试</Btn>
            <Btn size="sm" variant="secondary" onClick={() => location.reload()}>重新加载客户端</Btn>
          </div>
        </div>
      </div>
    )
  }
}
