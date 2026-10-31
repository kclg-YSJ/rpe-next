$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Globalization;
public static class RpenGpuCounters {
 [DllImport("pdh.dll", CharSet=CharSet.Unicode)] static extern uint PdhOpenQueryW(string source, UIntPtr data, out IntPtr query);
 [DllImport("pdh.dll", CharSet=CharSet.Unicode)] static extern uint PdhAddEnglishCounterW(IntPtr query, string path, UIntPtr data, out IntPtr counter);
 [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
 [DllImport("pdh.dll", CharSet=CharSet.Unicode)] static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint size, out uint count, IntPtr buffer);
 [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
 [StructLayout(LayoutKind.Explicit)] struct Value { [FieldOffset(0)] public uint status; [FieldOffset(8)] public double value; }
 [StructLayout(LayoutKind.Sequential)] struct Item { public IntPtr name; public Value data; }
 static IntPtr query, engines, memory;
 public static bool Open() {
  if (PdhOpenQueryW(null, UIntPtr.Zero, out query) != 0) return false;
  PdhAddEnglishCounterW(query, @"\GPU Engine(*)\Utilization Percentage", UIntPtr.Zero, out engines);
  PdhAddEnglishCounterW(query, @"\GPU Adapter Memory(*)\Dedicated Usage", UIntPtr.Zero, out memory);
  return engines != IntPtr.Zero || memory != IntPtr.Zero;
 }
 static Dictionary<string,double> Read(IntPtr counter) {
  var result = new Dictionary<string,double>(); if(counter==IntPtr.Zero)return result;
  uint size=0,count; PdhGetFormattedCounterArrayW(counter, 0x200 | 0x8000, ref size, out count, IntPtr.Zero);
  if(size==0 || size>16*1024*1024)return result;
  IntPtr buffer=Marshal.AllocHGlobal((int)size);
  try {
   if(PdhGetFormattedCounterArrayW(counter,0x200 | 0x8000,ref size,out count,buffer)!=0)return result;
   int stride=Marshal.SizeOf(typeof(Item));
   for(int i=0;i<count;i++){var item=(Item)Marshal.PtrToStructure(IntPtr.Add(buffer,i*stride),typeof(Item));if(item.data.status<=1 && !Double.IsNaN(item.data.value))result[Marshal.PtrToStringUni(item.name)]=item.data.value;}
  }finally{Marshal.FreeHGlobal(buffer);}return result;
 }
 public static string Sample(){
  PdhCollectQueryData(query);var values=Read(engines);var sums=new Dictionary<string,double>();
  foreach(var pair in values){int start=pair.Key.IndexOf("luid_");if(start<0)continue;string key=pair.Key.Substring(start);double current;sums.TryGetValue(key,out current);sums[key]=current+pair.Value;}
  double highest=0;foreach(var value in sums.Values)highest=Math.Max(highest,value);
  var memories=Read(memory);double bytes=0;foreach(var value in memories.Values)bytes+=value;
  return "{\"gpu\":"+(values.Count==0?"null":Math.Min(100,highest).ToString(CultureInfo.InvariantCulture))+",\"gpuMemory\":"+(memories.Count==0?"null":bytes.ToString(CultureInfo.InvariantCulture))+"}";
 }
 public static void Close(){if(query!=IntPtr.Zero)PdhCloseQuery(query);}
}
'@
if ([RpenGpuCounters]::Open()) {
  while ($true) { [Console]::WriteLine([RpenGpuCounters]::Sample()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 1000 }
}
} catch {} finally { if ('RpenGpuCounters' -as [type]) { [RpenGpuCounters]::Close() } }
