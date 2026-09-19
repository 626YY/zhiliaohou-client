// 全局键鼠低级钩子的 PowerShell + C# 脚本（作为字符串常量导出）。
//
// 为什么把脚本放成 TS 字符串常量而不是独立 .ps1 文件：
//   electron-vite 会把 src/main 打成 out/main/index.js，__dirname 指向打包产物目录，
//   靠源码相对路径去找 .ps1 文件在打包后必然失效。把脚本内容内联进 TS，运行时再写到
//   app.getPath('userData')/keyboard-hook.ps1 用 -File 执行，路径就永远可控。
//   同时冒烟脚本（tools/keyboard-hook-smoke.mjs）也能用正则从本文件把脚本抠出来单跑，
//   不必拉起整个 Electron。
//
// 关键约束（改这段脚本时务必守住，否则会破坏 JS 模板字符串或冒烟提取）：
//   1) 脚本里【绝对不能出现反引号】——反引号会提前终止 JS 模板字符串；PowerShell 的
//      转义符也是反引号，所以脚本内一律不用 PowerShell 反引号续行/转义。
//   2) 脚本里【绝对不能出现 ${ 两字符连写】——会被 JS 当成模板插值。PowerShell 变量
//      一律写 $foo 而不是 ${foo}。
//   3) 用 String.raw 保证脚本原文与冒烟脚本用正则抠出来的原文逐字一致（反斜杠不被转义）。
//   4) C# 用单引号 here-string @'...'@ 包裹，PowerShell 不会展开其中的 $，所以 C# 里
//      即便出现 $ 也安全（本脚本 C# 未用到 $）。
//
// 协议（每行一条，立即 flush）：
//   ready                         钩子已装好、消息循环已起
//   k d <vk> <scanCode> <ext0|1>  键盘按下（ext=扩展键标志）
//   k u <vk> <scanCode> <ext0|1>  键盘抬起
//   m d <l|r|m|x1|x2>             鼠标按下
//   m u <l|r|m|x1|x2>             鼠标抬起
//   m w <delta>                   滚轮（正上负下，一般 ±120）
//   hb                            心跳（每 2 秒一条，供 TS 侧判活）
//   err <reason>                  致命错误（如钩子装不上）
export const KEYBOARD_HOOK_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public class ZlKeyHook
{
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    // 父进程（客户端主进程）PID：客户端被强杀时 stdin EOF 要几十秒才传到，靠心跳定时器顺手盯一眼父进程，没了就秒退
    public static int ParentPid = 0;

    public static bool ParentAlive()
    {
        if (ParentPid <= 0) return true;
        try { Process p = Process.GetProcessById(ParentPid); return !p.HasExited; }
        catch { return false; }
    }

    // 委托必须由静态字段长期持有，否则会被 GC 回收，导致底层钩子静默失效（本项目核心坑）
    public static HookProc KbDelegate;
    public static HookProc MsDelegate;
    public static IntPtr KbHook = IntPtr.Zero;
    public static IntPtr MsHook = IntPtr.Zero;
    public static uint LoopThreadId = 0;
    public static object Gate = new object();
    static object LockGate = new object();
    static Stopwatch Clock = Stopwatch.StartNew();
    static long LockUntil = 0;
    static bool LockAll = false;
    static HashSet<int> LockedKeys = new HashSet<int>();
    static HashSet<int> SuppressedDown = new HashSet<int>();
    static HashSet<int> PassedDown = new HashSet<int>();

    static void LockState(string id)
    {
        long remaining = Math.Max(0, LockUntil - Clock.ElapsedMilliseconds);
        if (remaining == 0) { LockUntil = 0; LockAll = false; LockedKeys.Clear(); }
        Emit("lock-state " + id + " " + remaining + " " + (LockAll ? "*" : string.Join(",", LockedKeys)));
    }

    // stdin 控制与钩子回调共用锁；到期用单调时钟，调系统时间不会延长锁定。
    static void LockCommand(string line)
    {
        string[] p = line.Trim().Split(' ');
        if (p.Length < 2) return;
        lock (LockGate)
        {
            long ms;
            if (p[0] == "unlock") LockUntil = 0;
            else if (p[0] == "adjust" && p.Length == 3 && long.TryParse(p[2], out ms))
            {
                long remaining = Math.Max(0, LockUntil - Clock.ElapsedMilliseconds);
                LockUntil = remaining == 0 ? 0 : Clock.ElapsedMilliseconds + Math.Max(0, remaining + ms);
            }
            else if (p[0] == "lock" && p.Length == 4 && long.TryParse(p[2], out ms) && ms > 0)
            {
                LockedKeys.Clear();
                LockAll = p[3] == "*";
                if (!LockAll) foreach (string key in p[3].Split(',')) LockedKeys.Add(int.Parse(key));
                LockUntil = Clock.ElapsedMilliseconds + ms;
            }
            else return;
            LockState(p[1]);
        }
    }

    public const int WH_KEYBOARD_LL = 13;
    public const int WH_MOUSE_LL = 14;
    public const int HC_ACTION = 0;

    public const int WM_QUIT = 0x0012;
    public const int WM_TIMER = 0x0113;

    public const int WM_KEYDOWN = 0x0100;
    public const int WM_KEYUP = 0x0101;
    public const int WM_SYSKEYDOWN = 0x0104;
    public const int WM_SYSKEYUP = 0x0105;

    public const int WM_LBUTTONDOWN = 0x0201;
    public const int WM_LBUTTONUP = 0x0202;
    public const int WM_RBUTTONDOWN = 0x0204;
    public const int WM_RBUTTONUP = 0x0205;
    public const int WM_MBUTTONDOWN = 0x0207;
    public const int WM_MBUTTONUP = 0x0208;
    public const int WM_MOUSEWHEEL = 0x020A;
    public const int WM_XBUTTONDOWN = 0x020B;
    public const int WM_XBUTTONUP = 0x020C;

    public const uint LLKHF_EXTENDED = 0x01;

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT
    {
        public int x;
        public int y;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")]
    public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    public static extern UIntPtr SetTimer(IntPtr hWnd, UIntPtr nIDEvent, uint uElapse, IntPtr lpTimerFunc);
    [DllImport("user32.dll")]
    public static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    // 每条事件立即写 stdout 并 flush；管道断了就吞异常，绝不让钩子进程崩
    public static void Emit(string s)
    {
        try
        {
            lock (Gate)
            {
                Console.Out.WriteLine(s);
                Console.Out.Flush();
            }
        }
        catch { }
    }

    public static IntPtr KbCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            long msg = wParam.ToInt64();
            bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            bool suppress = false;
            lock (LockGate)
            {
                // Esc 永不拦截，紧急解锁不依赖 Electron 事件循环。
                if (k.vkCode == 27 && down) { LockUntil = 0; LockState("0"); }
                if (LockUntil > 0 && Clock.ElapsedMilliseconds >= LockUntil) LockState("0");
                if (down && k.vkCode != 27 && LockUntil > 0 && (LockAll || LockedKeys.Contains((int)k.vkCode)))
                {
                    if (!PassedDown.Contains((int)k.vkCode)) SuppressedDown.Add((int)k.vkCode);
                    suppress = true;
                }
                // 锁定前已经按下的键仍放行 key-up，避免目标程序卡在按住状态。
                else if (up)
                {
                    suppress = SuppressedDown.Remove((int)k.vkCode);
                    if (PassedDown.Remove((int)k.vkCode)) suppress = false;
                }
                else if (down) { SuppressedDown.Remove((int)k.vkCode); PassedDown.Add((int)k.vkCode); }
            }
            int ext = ((k.flags & LLKHF_EXTENDED) != 0) ? 1 : 0;
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                Emit("k d " + k.vkCode + " " + k.scanCode + " " + ext);
            else if (msg == WM_KEYUP || msg == WM_SYSKEYUP)
                Emit("k u " + k.vkCode + " " + k.scanCode + " " + ext);
            if (suppress) return new IntPtr(1);
        }
        return CallNextHookEx(KbHook, nCode, wParam, lParam);
    }

    public static IntPtr MsCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            long msg = wParam.ToInt64();
            MSLLHOOKSTRUCT m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            if (msg == WM_LBUTTONDOWN) Emit("m d l");
            else if (msg == WM_LBUTTONUP) Emit("m u l");
            else if (msg == WM_RBUTTONDOWN) Emit("m d r");
            else if (msg == WM_RBUTTONUP) Emit("m u r");
            else if (msg == WM_MBUTTONDOWN) Emit("m d m");
            else if (msg == WM_MBUTTONUP) Emit("m u m");
            else if (msg == WM_XBUTTONDOWN)
            {
                int xb = (int)((m.mouseData >> 16) & 0xFFFF);
                Emit("m d " + (xb == 2 ? "x2" : "x1"));
            }
            else if (msg == WM_XBUTTONUP)
            {
                int xb = (int)((m.mouseData >> 16) & 0xFFFF);
                Emit("m u " + (xb == 2 ? "x2" : "x1"));
            }
            else if (msg == WM_MOUSEWHEEL)
            {
                short delta = (short)((m.mouseData >> 16) & 0xFFFF);
                Emit("m w " + delta);
            }
        }
        return CallNextHookEx(MsHook, nCode, wParam, lParam);
    }

    // 后台线程盯 stdin：收到 quit 行、或父进程关掉管道(ReadLine 返回 null)，都触发退出
    public static void StdinLoop()
    {
        try
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Trim() == "quit") break;
                LockCommand(line);
            }
        }
        catch { }
        Stop();
    }

    // 从任意线程唤醒消息循环退出：向循环线程投递 WM_QUIT，GetMessage 返回 0 后自然收尾
    public static void Stop()
    {
        if (LoopThreadId != 0)
            PostThreadMessage(LoopThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    public static void Install()
    {
        // 钩子启动时已经按住的键，其松开事件也必须送到原目标。
        for (int vk = 8; vk < 256; vk++) if ((GetAsyncKeyState(vk) & 0x8000) != 0) PassedDown.Add(vk);
        KbDelegate = new HookProc(KbCallback);
        MsDelegate = new HookProc(MsCallback);
        // 低级钩子(LL)的 hMod 传当前进程主模块句柄即可；GetModuleHandle(null) 返回 exe 基址
        IntPtr hMod = GetModuleHandle(null);
        KbHook = SetWindowsHookEx(WH_KEYBOARD_LL, KbDelegate, hMod, 0);
        MsHook = SetWindowsHookEx(WH_MOUSE_LL, MsDelegate, hMod, 0);
    }

    public static void Uninstall()
    {
        if (KbHook != IntPtr.Zero) { UnhookWindowsHookEx(KbHook); KbHook = IntPtr.Zero; }
        if (MsHook != IntPtr.Zero) { UnhookWindowsHookEx(MsHook); MsHook = IntPtr.Zero; }
    }

    // 装钩子 + 跑消息循环，全在同一线程（LL 钩子回调只会在装钩子的那个线程上被系统调用）
    public static void Run()
    {
        LoopThreadId = GetCurrentThreadId();
        Install();
        if (KbHook == IntPtr.Zero || MsHook == IntPtr.Zero)
        {
            Emit("err hook-failed");
            Uninstall();
            return;
        }
        Thread t = new Thread(new ThreadStart(StdinLoop));
        t.IsBackground = true;
        t.Start();
        // 每 50ms 检查到期，每 2 秒检查父进程并发心跳。
        SetTimer(IntPtr.Zero, UIntPtr.Zero, 50, IntPtr.Zero);
        long heartbeatAt = Clock.ElapsedMilliseconds;
        Emit("ready");
        MSG msg;
        int r;
        while ((r = GetMessage(out msg, IntPtr.Zero, 0, 0)) > 0)
        {
            if (msg.message == WM_TIMER)
            {
                lock (LockGate)
                {
                    if (LockUntil > 0 && Clock.ElapsedMilliseconds >= LockUntil) LockState("0");
                }
                if (Clock.ElapsedMilliseconds - heartbeatAt >= 2000)
                {
                    if (!ParentAlive()) break;
                    Emit("hb");
                    heartbeatAt = Clock.ElapsedMilliseconds;
                }
            }
            else
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
        }
        Uninstall();
    }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
$parentPid = 0
if ($env:ZL_PARENT_PID -match '^[0-9]+$') { $parentPid = [int]$env:ZL_PARENT_PID }
[ZlKeyHook]::ParentPid = $parentPid
[ZlKeyHook]::Run()
`
