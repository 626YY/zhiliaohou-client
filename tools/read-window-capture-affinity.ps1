param(
  [Parameter(Mandatory=$true)][long]$WindowHandle,
  [Parameter(Mandatory=$true)][int]$ExpectedProcessId
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZlCaptureAffinity {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
}
'@
[uint32]$owner = 0
[void][ZlCaptureAffinity]::GetWindowThreadProcessId([IntPtr]$WindowHandle, [ref]$owner)
if ($owner -ne $ExpectedProcessId) { throw 'Window does not belong to the test process' }
[uint32]$affinity = 0
if (-not [ZlCaptureAffinity]::GetWindowDisplayAffinity([IntPtr]$WindowHandle, [ref]$affinity)) { throw 'GetWindowDisplayAffinity failed' }
[pscustomobject]@{ affinity = $affinity; processId = $owner } | ConvertTo-Json -Compress
