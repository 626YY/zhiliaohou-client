param(
  [Parameter(Mandatory=$true)][string]$ProcessIds,
  [int]$Milliseconds = 1500
)
# 只测本次测试进程在 Windows 默认输出设备上的峰值，不录音、不改音量。
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDevices {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevices {
 int EnumAudioEndpoints(int flow,int mask,out IntPtr devices);
 int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
 int Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object result);
}
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessions {
 int GetAudioSessionControl(IntPtr guid,uint flags,out IntPtr control);
 int GetSimpleAudioVolume(IntPtr guid,uint flags,out IntPtr volume);
 int GetSessionEnumerator(out ISessions sessions);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISessions {
 int GetCount(out int count);
 int GetSession(int index,[MarshalAs(UnmanagedType.IUnknown)]out object control);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IControl {
 int GetState(out int state);
 int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);
 int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)]string name,ref Guid context);
 int GetIconPath([MarshalAs(UnmanagedType.LPWStr)]out string path);
 int SetIconPath([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid context);
 int GetGroupingParam(out Guid grouping);
 int SetGroupingParam(ref Guid grouping,ref Guid context);
 int RegisterAudioSessionNotification(IntPtr client);
 int UnregisterAudioSessionNotification(IntPtr client);
 int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string id);
 int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string id);
 int GetProcessId(out uint pid);
}
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMeter {
 int GetPeakValue(out float peak);
}
public class ZlAudioMeasurement {
 public int Sessions; public float Peak; public int Samples;
 public static ZlAudioMeasurement Measure(uint[] pids,int milliseconds) {
  var allowed=new HashSet<uint>(pids); var found=new List<IMeter>();
  var devices=(IDevices)new MMDevices(); IDevice device;
  Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(0,1,out device));
  Guid iid=typeof(IAudioSessions).GUID; object obj;
  Marshal.ThrowExceptionForHR(device.Activate(ref iid,23,IntPtr.Zero,out obj));
  ISessions sessions; Marshal.ThrowExceptionForHR(((IAudioSessions)obj).GetSessionEnumerator(out sessions));
  int count; sessions.GetCount(out count);
  for(int i=0;i<count;i++) { object control; sessions.GetSession(i,out control); uint pid; ((IControl)control).GetProcessId(out pid); if(allowed.Contains(pid))found.Add((IMeter)control); }
  var result=new ZlAudioMeasurement(); result.Sessions=found.Count;
  var until=DateTime.UtcNow.AddMilliseconds(milliseconds);
  while(DateTime.UtcNow<until) { foreach(var meter in found){float peak;Marshal.ThrowExceptionForHR(meter.GetPeakValue(out peak));result.Peak=Math.Max(result.Peak,peak);}result.Samples++;Thread.Sleep(25); }
  return result;
 }
}
'@
[uint32[]]$testProcessIds = $ProcessIds.Split(',') | ForEach-Object { [uint32]$_ }
if ($testProcessIds.Count -eq 0 -or $testProcessIds -contains 0) { throw 'Explicit nonzero test process IDs required' }
if ($Milliseconds -lt 100 -or $Milliseconds -gt 10000) { throw 'Sampling duration out of range' }
[ZlAudioMeasurement]::Measure($testProcessIds, $Milliseconds) | ConvertTo-Json -Compress
