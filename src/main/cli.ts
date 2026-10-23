// AI CLI(Claude Code, Codex)를 찾고 띄울 때 같이 쓰는 부분: 환경 변수 정리, 셸 PATH 빌려오기, 실행 파일 찾기

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 펫을 터미널(Orca, Claude Code 세션 등)에서 켜면 그 터미널의 세션 변수가 따라와서
 * 펫이 부르는 claude·codex가 그 터미널의 작업으로 잡힌다. 그런 변수는 빼고 넘긴다.
 * Orca가 넣은 CODEX_HOME(Orca 전용 Codex 폴더)도 빼서 사용자의 ~/.codex 로그인을 쓰게 한다.
 */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(ORCA_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/.test(k)) continue;
    if (k === "CODEX_HOME" && env.ORCA_CODEX_HOME && v === env.ORCA_CODEX_HOME) continue;
    out[k] = v;
  }
  return out;
}

let shellPath: Promise<string | null> | null = null;

/**
 * 앱을 Finder/시작 메뉴에서 켜면 PATH가 짧아서 claude·codex를 못 찾으니 사용자 셸의 PATH를 빌려온다.
 * nvm처럼 .zshrc에서 PATH를 잡는 경우가 많아서 인터랙티브 로그인 셸(-ilc)로 읽는다. (한 번만)
 */
export function userShellPath(): Promise<string | null> {
  if (process.platform === "win32") return Promise.resolve(null);
  shellPath ??= new Promise((resolve) => {
    execFile(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'], { timeout: 8000 },
      (err, out) => resolve(err ? null : (out.match(/__PATH__(.*)__PATH__/)?.[1] ?? null)));
  });
  return shellPath;
}

/** 깨끗한 환경 + 사용자 셸 PATH */
export async function cliEnv(): Promise<NodeJS.ProcessEnv> {
  const env = cleanEnv(process.env);
  const p = await userShellPath();
  return p ? { ...env, PATH: p } : env;
}

/** PATH와 흔히 설치되는 폴더에서 실행 파일을 찾는다 */
export function findCommand(name: string, envPath: string): string | null {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  const home = os.homedir();
  let extra: string[] = [];
  if (process.platform !== "win32") {
    const nvm = path.join(home, ".nvm", "versions", "node");
    let nvmBins: string[] = [];
    try { nvmBins = fs.readdirSync(nvm).sort().reverse().map((v) => path.join(nvm, v, "bin")); } catch { /* nvm 없음 */ }
    extra = [path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin", ...nvmBins];
  }
  for (const dir of [...envPath.split(path.delimiter), ...extra]) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** 찾은 실행 파일의 폴더를 PATH 앞에 넣는다 (codex처럼 `#!/usr/bin/env node`인 스크립트가 같은 폴더의 node를 찾게) */
export function withDirInPath(env: NodeJS.ProcessEnv, file: string): NodeJS.ProcessEnv {
  return { ...env, PATH: [path.dirname(file), env.PATH ?? ""].join(path.delimiter) };
}

/** 터미널 창을 열어서 명령을 실행한다 (로그인, 기록 보기 등). 맥은 Terminal.app, 윈도우는 PowerShell */
export function openTerminal(command: { mac: string; windows: string }): void {
  if (process.platform === "darwin") {
    execFile("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(command.mac)}`, "-e", 'tell application "Terminal" to activate']);
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "powershell", "-NoExit", "-Command", command.windows], { detached: true, windowsHide: false });
  }
}
