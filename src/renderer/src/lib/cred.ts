// 凭据存主进程文件（safeStorage 加密）。此前放 localStorage：多实例抢不到
// leveldb 锁时全程内存态、退出即丢，「记住密码」形同虚设。
export interface Cred {
  username: string
  password: string
}

export async function loadCred(): Promise<Cred | null> {
  const r = await window.api.credLoad()
  return r.last
}

export function saveCred(username: string, password: string): void {
  void window.api.credSave(username, password)
}

export function clearCred(): void {
  void window.api.credClearLast()
}

export async function loadUserCred(username: string): Promise<string | null> {
  const r = await window.api.credUser(username)
  return r.password
}

export function clearUserCred(username: string): void {
  void window.api.credClearUser(username)
}
