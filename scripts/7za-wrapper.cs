using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

// Transparent wrapper around the real 7za.exe (7za-real.exe).
// Adds "-y" (assume yes) and "-xr!darwin" (skip the darwin folder whose
// symlinks cannot be created without the SeCreateSymbolicLinkPrivilege)
// so electron-builder's winCodeSign extraction succeeds on non-admin Windows.
class SevenZaWrapper {
  static int Main(string[] args) {
    string selfDir = AppDomain.CurrentDomain.BaseDirectory;
    string real = Path.Combine(selfDir, "7za-real.exe");
    var newArgs = new List<string>();
    bool hasY = false;
    foreach (var a in args) {
      if (a == "-y") hasY = true;
      newArgs.Add(a);
    }
    if (!hasY) newArgs.Add("-y");
    newArgs.Add("-xr!darwin");

    var psi = new ProcessStartInfo(real);
    psi.Arguments = BuildCommandLine(newArgs);
    psi.UseShellExecute = false;
    psi.RedirectStandardOutput = false;
    psi.RedirectStandardError = false;
    psi.CreateNoWindow = true;

    int code;
    using (var p = Process.Start(psi)) {
      p.WaitForExit();
      code = p.ExitCode;
    }
    // If an extraction output dir was given and the archive carries the
    // darwin layout, leave placeholder dylibs so tooling that checks for
    // them is satisfied.
    try {
      string outDir = ExtractOutDir(args);
      if (outDir != null) {
        string lib = Path.Combine(outDir, "darwin", "10.12", "lib");
        string libParent = Path.GetDirectoryName(Path.GetDirectoryName(lib));
        if (Directory.Exists(libParent)) {
          Directory.CreateDirectory(lib);
          foreach (var f in new[] { "libcrypto.dylib", "libssl.dylib" }) {
            string fp = Path.Combine(lib, f);
            if (!File.Exists(fp)) File.WriteAllBytes(fp, new byte[0]);
          }
        }
      }
    } catch { }
    return code;
  }

  static string BuildCommandLine(List<string> args) {
    var sb = new System.Text.StringBuilder();
    foreach (var a in args) {
      if (sb.Length > 0) sb.Append(' ');
      sb.Append(Quote(a));
    }
    return sb.ToString();
  }

  static string Quote(string s) {
    if (string.IsNullOrEmpty(s)) return "\"\"";
    bool needsQuote = s.IndexOfAny(new[] { ' ', '\t', '"' }) >= 0;
    if (!needsQuote) return s;
    return "\"" + s.Replace("\"", "\\\"") + "\"";
  }

  static string ExtractOutDir(string[] args) {
    for (int i = 0; i < args.Length; i++) {
      string a = args[i];
      if (a != null && a.StartsWith("-o")) {
        if (a.Length > 2) return a.Substring(2);
        if (i + 1 < args.Length) return args[i + 1];
      }
    }
    return null;
  }
}
