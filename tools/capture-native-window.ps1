param(
  [Parameter(Mandatory=$true)][long]$WindowHandle,
  [Parameter(Mandatory=$true)][int]$ExpectedProcessId,
  [Parameter(Mandatory=$true)][string]$Path,
  [ValidateSet('print', 'bitblt')][string]$Method = 'print'
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class ZlWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint op);
  public static void Save(IntPtr window, uint expectedProcess, string path, string method) {
    uint process; GetWindowThreadProcessId(window, out process);
    if (!IsWindow(window) || process != expectedProcess) throw new Exception("Window owner " + process + " does not match test process " + expectedProcess);
    RECT rect;
    if (!GetClientRect(window, out rect) || rect.Right <= 0 || rect.Bottom <= 0) throw new Exception("Invalid window bounds");
    using (var bitmap = new Bitmap(rect.Right, rect.Bottom, PixelFormat.Format24bppRgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        var dc = graphics.GetHdc();
        try {
          if (method == "bitblt") {
            var source = GetDC(window);
            try { if (source == IntPtr.Zero || !BitBlt(dc, 0, 0, rect.Right, rect.Bottom, source, 0, 0, 0x40CC0020)) throw new Exception("BitBlt failed"); }
            finally { if (source != IntPtr.Zero) ReleaseDC(window, source); }
          } else if (!PrintWindow(window, dc, 2)) throw new Exception("PrintWindow failed");
        }
        finally { graphics.ReleaseHdc(dc); }
      }
      bitmap.Save(path, ImageFormat.Png);
    }
  }
}
'@ -ReferencedAssemblies System.Drawing
[ZlWindowCapture]::Save([IntPtr]$WindowHandle, [uint32]$ExpectedProcessId, $Path, $Method)
Write-Output $Path
