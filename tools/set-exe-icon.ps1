# Replaces the icon of an .exe with an .ico using the Win32 resource API (no extra tools needed).
#   powershell -File tools\set-exe-icon.ps1 -Exe runtime\Basalt.exe -Ico branding\icon.ico
param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string]$Ico)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class IconPatch {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string f, bool del);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint cb);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint fl);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr h);
  delegate bool EnumProc(IntPtr m, IntPtr type, IntPtr name, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EnumResourceNames(IntPtr m, IntPtr type, EnumProc cb, IntPtr p);
  static void Check(bool ok, string what) { if (!ok) throw new Exception(what + " failed: " + Marshal.GetLastWin32Error()); }
  public static void Run(string exe, string ico) {
    var groups = new List<IntPtr>();
    IntPtr m = LoadLibraryEx(exe, IntPtr.Zero, 2);
    EnumResourceNames(m, (IntPtr)14, (mm, t, n, p) => { groups.Add(n); return true; }, IntPtr.Zero);
    FreeLibrary(m);
    byte[] d = File.ReadAllBytes(ico);
    int count = BitConverter.ToUInt16(d, 4);
    IntPtr h = BeginUpdateResource(exe, false);
    if (h == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
    var grp = new MemoryStream(); var w = new BinaryWriter(grp);
    w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
    for (int i = 0; i < count; i++) {
      int o = 6 + i * 16; uint size = BitConverter.ToUInt32(d, o + 8), off = BitConverter.ToUInt32(d, o + 12);
      var img = new byte[size]; Array.Copy(d, off, img, 0, size);
      Check(UpdateResource(h, (IntPtr)3, (IntPtr)(i + 1), 1033, img, size), "icon image");
      w.Write(d[o]); w.Write(d[o+1]); w.Write(d[o+2]); w.Write(d[o+3]); w.Write(BitConverter.ToUInt16(d, o+4)); w.Write(BitConverter.ToUInt16(d, o+6)); w.Write(size); w.Write((ushort)(i + 1));
    }
    var gb = grp.ToArray();
    IntPtr first = groups.Count > 0 ? groups[0] : (IntPtr)1; // overwrite the existing group (keeps its id/name)
    Check(UpdateResource(h, (IntPtr)14, first, 1033, gb, (uint)gb.Length), "icon group");
    Check(EndUpdateResource(h, false), "EndUpdateResource");
  }
}
'@
[IconPatch]::Run((Resolve-Path $Exe).Path, (Resolve-Path $Ico).Path)
