// 지금 맨 앞에 있는 앱(과 창 제목)을 알아내는 부분 — 운영체제마다 방법이 다르다.
//  - macOS: `lsappinfo` (권한 필요 없음). 창 제목은 화면 기록 권한이 있어야 해서 읽지 않는다.
//  - Windows: PowerShell 하나를 계속 띄워두고 user32 API로 앞 창의 프로세스와 제목을 1초마다 읽는다.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export interface ActiveWindow {
  name: string;   // 사람이 읽는 앱 이름 (예: "Google Chrome", "Visual Studio Code")
  id: string;     // 번들 ID(맥) 또는 프로세스 이름(윈도우)
  title: string;  // 창 제목 (맥은 항상 "")
  pid: number;
}

type Listener = (w: ActiveWindow) => void;

/** 앞 창이 바뀔 때마다(창 제목이 바뀌어도) listener를 부른다. 멈추는 함수를 돌려준다. */
export function watchActiveWindow(listener: Listener): () => void {
  if (process.platform === "darwin") return watchMac(listener);
  if (process.platform === "win32") return watchWindows(listener);
  console.warn("[activity] 이 운영체제는 아직 앱 감지를 지원하지 않아요:", process.platform);
  return () => {};
}

// MARK: macOS

function watchMac(listener: Listener): () => void {
  let last = "";
  let running = false;
  const poll = () => {
    if (running) return;
    running = true;
    execFile("/bin/sh", ["-c", 'lsappinfo info -only name -only bundleid -only pid "$(lsappinfo front)"'],
      { timeout: 3000 }, (err, stdout) => {
        running = false;
        if (err) return;
        const w = parseLsappinfo(stdout);
        if (!w) return;
        const key = `${w.pid}|${w.name}`;
        if (key !== last) { last = key; listener(w); }
      });
  };
  poll();
  const timer = setInterval(poll, 1000);
  return () => clearInterval(timer);
}

export function parseLsappinfo(out: string): ActiveWindow | null {
  const get = (k: string) => out.match(new RegExp(`"${k}"\\s*=\\s*"?([^"\\n]*)"?`))?.[1]?.trim() ?? "";
  const name = get("LSDisplayName");
  if (!name) return null;
  return { name, id: get("CFBundleIdentifier"), title: "", pid: Number(get("pid")) || 0 };
}

// MARK: Windows

const windowsScript = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DeskPetFG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$last = ''
while ($true) {
  $h = [DeskPetFG]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][DeskPetFG]::GetWindowText($h, $sb, 512)
    $procId = [uint32]0
    [void][DeskPetFG]::GetWindowThreadProcessId($h, [ref]$procId)
    $p = Get-Process -Id $procId
    $id = if ($p) { $p.ProcessName } else { '' }
    $name = if ($p -and $p.Description) { $p.Description } else { $id }
    $line = @{ name = $name; id = $id; title = $sb.ToString(); pid = [int]$procId } | ConvertTo-Json -Compress
    if ($line -ne $last) {
      [Console]::Out.WriteLine($line)
      [Console]::Out.Flush()
      $last = $line
    }
  }
  Start-Sleep -Milliseconds 1000
}
`;

function watchWindows(listener: Listener): () => void {
  let child: ChildProcess | null = null;
  let stopped = false;

  const start = () => {
    const encoded = Buffer.from(windowsScript, "utf16le").toString("base64");
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout!.setEncoding("utf8");
    createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        const w = JSON.parse(line) as ActiveWindow;
        if (w.name) listener({ name: w.name, id: w.id ?? "", title: w.title ?? "", pid: w.pid ?? 0 });
      } catch { /* 이상한 줄은 무시 */ }
    });
    child.on("exit", () => {
      child = null;
      if (!stopped) setTimeout(start, 3000);  // 죽으면 다시 띄운다
    });
  };
  start();
  return () => { stopped = true; child?.kill(); };
}
