import cicada from '../assets/cicada.png'

// 蝉剪影 + 科技感动画：缓慢悬浮 + 周期性扫描光 + 背后橙色光环脉动。
// 用于登录页右栏装饰、登录过渡屏中央。
export function CicadaMark({ size = 180 }: { size?: number }) {
  return (
    <div
      className="cicada-mark pointer-events-none relative select-none"
      style={{ width: size, height: size * 1.6 }}
    >
      {/* 静态居中也必须保留，动画未开始或被取消时光环不能向右下撑出滚动条。 */}
      <div
        className="cicada-glow absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: size * 1.4,
          height: size * 1.4,
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, var(--accent-soft-2) 0%, var(--accent-soft) 38%, transparent 68%)',
          animation: 'zl-pulse-glow 3.6s ease-in-out infinite'
        }}
      />
      {/* 剪影本体：悬浮 + 扫描光（mask 让光只落在蝉形上） */}
      <div
        className="cicada-body absolute inset-0"
        style={{ animation: 'zl-float 4.5s ease-in-out infinite' }}
      >
        <img
          src={cicada}
          alt=""
          aria-hidden
          className="h-full w-full object-contain opacity-90"
          style={{ filter: 'drop-shadow(0 8px 24px rgb(0 0 0 / 0.5))' }}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            WebkitMaskImage: `url(${cicada})`,
            maskImage: `url(${cicada})`,
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center'
          }}
        >
          {/* 扫描光（双层：宽柔光带 + 中央亮线核心），行程覆盖整个剪影（keyframes 见 zl-scan） */}
          <div
            className="cicada-scan absolute inset-x-0 top-0"
            style={{
              height: '18%',
              animation: 'zl-scan 3.2s cubic-bezier(0.45, 0, 0.3, 1) infinite'
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, transparent, rgb(255 176 58 / 0.55) 50%, transparent)',
                filter: 'blur(4px)'
              }}
            />
            <div
              className="absolute inset-x-0"
              style={{
                top: '42%',
                height: '16%',
                background:
                  'linear-gradient(180deg, transparent, rgb(255 226 170 / 0.95) 50%, transparent)',
                filter: 'blur(1px)'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
