// 登录页沿用原来的 GTA 式多层炫光；加载时叠加模糊封面。
// 动画只移动背景，裁切由独立容器负责，不参与表单的滚动尺寸。
export function AuthBackdrop({ cover }: { cover?: string }) {
  return (
    <div className="auth-backdrop" aria-hidden>
      <div className="auth-backdrop-glow" />
      {cover && <img className="auth-backdrop-cover" src={cover} alt="" />}
      <div className="auth-backdrop-shade" />
    </div>
  )
}
