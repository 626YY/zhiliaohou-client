import type { Settings } from '@shared/types'
import { Toggle } from './ui'

export default function CaptureBackgroundToggle({ mode, onChange, disabled }: {
  mode: Settings['outputCaptureMode']
  onChange: (mode: 'green' | 'transparent') => void
  disabled?: boolean
}) {
  return <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0">
      <div className="text-sm font-medium text-[var(--text)]">绿幕底总开关</div>
      <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">用直播伴侣请开启绿底，并在伴侣中开启绿幕抠像。透明底需要采集软件支持。</p>
    </div>
    <Toggle label="绿幕底总开关" value={(mode || 'green') === 'green'} disabled={disabled} onChange={on => onChange(on ? 'green' : 'transparent')} />
  </div>
}
