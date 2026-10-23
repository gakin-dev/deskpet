// Claude Code CLI(`claude -p`)를 부르는 공용 부분. 대화(brain.ts)와 일 시키기(agent.ts)가 같이 쓴다.
// API 키 없이 Claude Code에 로그인된 구독으로 돈다.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createInterface } from "node:readline";
import { cleanEnv, cliEnv, findCommand, withDirInPath } from "./cli";

export interface Denial {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ClaudeResult {
  sessionId: string | null;
  result: string;
  isError: boolean;
  denials: Denial[];
  /** 이번 요청에 들어간 맥락 크기 (토큰, 캐시 포함) — 대화가 얼마나 쌓였는지 볼 때 */
  contextTokens: number;
  /** AI가 쓴 토큰 */
  outputTokens: number;
}

export interface RunOptions {
  args: string[];
  input: string;
  cwd?: string;
  /** 생각(thinking) 없이 바로 대답하게 한다. 짧은 대사용 — 생각을 켜두면 "안녕" 한마디에도 몇 초씩 생각함 */
  noThinking?: boolean;
  /** stream-json으로 받은 이벤트 하나하나 (진행 상황 표시용) */
  onEvent?: (ev: any) => void;
  /** 실행 중인 프로세스를 받아서 멈출 때 쓴다 */
  onSpawn?: (child: ChildProcess) => void;
}

export class ClaudeCode {
  path: string | null = null;
  private env: NodeJS.ProcessEnv = cleanEnv(process.env);
  private ready: Promise<void> = Promise.resolve();

  /** claude 실행 파일을 찾는다. override가 있으면 그걸 쓴다 (앱을 Finder에서 켜도 찾도록 사용자 셸의 PATH를 빌려옴) */
  locate(override?: string): Promise<void> {
    this.ready = (async () => {
      const env = await cliEnv();
      this.path = override && fs.existsSync(override) ? override : findCommand("claude", env.PATH ?? "");
      this.env = this.path ? withDirInPath(env, this.path) : env;
    })();
    return this.ready;
  }

  /** 로그인돼 있는지 (`claude auth status`). 못 알아내면 null */
  async loggedIn(): Promise<boolean | null> {
    await this.ready;
    if (!this.path) return false;
    return new Promise((resolve) => {
      const child = this.spawnClaude(["auth", "status"]);
      let out = "";
      child.stdout!.on("data", (d) => { out += d; });
      child.on("error", () => resolve(null));
      child.on("close", () => {
        try { resolve(!!JSON.parse(out).loggedIn); } catch { resolve(null); }
      });
      child.stdin!.end();
    });
  }

  async available(): Promise<boolean> {
    await this.ready;
    return !!this.path;
  }

  /** claude를 띄운다 (윈도우 .cmd는 셸을 거쳐서) */
  spawnClaude(args: string[], o: { cwd?: string; noThinking?: boolean } = {}): ChildProcess {
    if (!this.path) throw new Error("claude 명령어를 못 찾았어");
    const claude = this.path;
    // npm으로 깐 윈도우 claude.cmd는 셸을 거쳐야 실행된다 (인자는 경로나 짧은 값뿐이라 따옴표로 충분)
    const useShell = process.platform === "win32" && !claude.toLowerCase().endsWith(".exe");
    return spawn(useShell ? `"${claude}"` : claude, useShell ? args.map((a) => `"${a}"`) : args, {
      cwd: o.cwd ?? os.homedir(),
      env: o.noThinking ? { ...this.env, MAX_THINKING_TOKENS: "0" } : this.env,
      shell: useShell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /** `claude -p --output-format stream-json --verbose ...args`를 돌리고 마지막 result를 돌려준다 */
  async run(o: RunOptions): Promise<ClaudeResult> {
    await this.ready;
    const child = this.spawnClaude(["-p", "--output-format", "stream-json", "--verbose", ...o.args], o);
    o.onSpawn?.(child);

    return new Promise((resolve, reject) => {
      let result: ClaudeResult | null = null;
      let stderr = "";
      child.stderr!.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
      createInterface({ input: child.stdout! }).on("line", (line) => {
        let ev: any;
        try { ev = JSON.parse(line); } catch { return; }
        o.onEvent?.(ev);
        if (ev.type === "result") result = toResult(ev);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (result) resolve(result);
        else reject(new Error(stderr.trim().split("\n").pop() || `종료 코드 ${code}`));
      });
      child.stdin!.end(o.input);
    });
  }

  /** 계속 켜두고 말을 여러 번 주고받는 claude (`--input-format stream-json`) */
  async openSession(args: string[], o: { noThinking?: boolean; cwd?: string } = {}): Promise<ClaudeSession> {
    await this.ready;
    const child = this.spawnClaude(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...args], o);
    return new ClaudeSession(child);
  }
}

function toResult(ev: any): ClaudeResult {
  return {
    sessionId: ev.session_id ?? null,
    result: typeof ev.result === "string" ? ev.result.trim() : "",
    isError: !!ev.is_error,
    denials: Array.isArray(ev.permission_denials) ? ev.permission_denials : [],
    contextTokens: ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]
      .reduce((n, k) => n + (typeof ev.usage?.[k] === "number" ? ev.usage[k] : 0), 0),
    outputTokens: typeof ev.usage?.output_tokens === "number" ? ev.usage.output_tokens : 0,
  };
}

/** 도구를 쓰기 전에 claude가 묻는 권한 요청 (`--permission-prompt-tool stdio`) */
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
}

export type PermissionAnswer = { allow: true } | { allow: false; message: string };

/** 한 턴(말 하나에 대한 대답) 동안 받는 것들 */
export interface TurnHooks {
  /** stream-json 이벤트 하나하나 (진행 상황 표시용) */
  onEvent?: (ev: any) => void;
  /** 사용자 설정으로 허용 안 된 도구를 쓰려 할 때 */
  onPermission?: (req: PermissionRequest) => Promise<PermissionAnswer>;
}

/**
 * 켜둔 claude 하나와 차례로 말을 주고받는다. 한 번에 하나씩만 (앞의 대답이 끝나야 다음).
 * 켜는 시간이 안 들어서 빠르고, 대화가 이 세션 안에서 이어진다.
 * 도구를 쓸 때 사용자 설정에 없는 권한이면 control_request로 물어오고, 우리가 허락/거절을 돌려준다.
 */
export class ClaudeSession {
  /** 지금까지 주고받은 횟수 */
  turns = 0;
  /** claude가 알려준 세션 id (이어하기용) */
  sessionId: string | null = null;
  private waiting: { resolve: (r: ClaudeResult) => void; reject: (e: Error) => void; hooks: TurnHooks } | null = null;
  private stderr = "";
  private dead = false;

  constructor(private child: ChildProcess) {
    child.stderr!.on("data", (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    createInterface({ input: child.stdout! }).on("line", (line) => {
      let ev: any;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.session_id) this.sessionId = ev.session_id;
      if (ev.type === "control_request") { void this.answerControl(ev); return; }
      if (!this.waiting) return;
      this.waiting.hooks.onEvent?.(ev);
      if (ev.type !== "result") return;
      const w = this.waiting;
      this.waiting = null;
      w.resolve(toResult(ev));
    });
    const die = (why: string) => {
      this.dead = true;
      if (!this.waiting) return;
      const w = this.waiting;
      this.waiting = null;
      w.reject(new Error(this.stderr.trim().split("\n").pop() || why));
    };
    child.on("error", (e) => die(e.message));
    child.on("close", (code) => die(`claude가 꺼졌어 (종료 코드 ${code})`));
    child.stdin!.on("error", () => { /* 꺼진 뒤에 쓰면 나는 에러는 close에서 처리 */ });
  }

  get alive(): boolean {
    return !this.dead && this.child.exitCode === null;
  }

  get busy(): boolean {
    return this.waiting !== null;
  }

  private write(obj: unknown): void {
    if (this.alive) this.child.stdin!.write(JSON.stringify(obj) + "\n");
  }

  /** claude가 보낸 요청에 답한다. 지금은 도구 권한(can_use_tool)만 받고, 나머지는 모른다고 답함 */
  private async answerControl(ev: any): Promise<void> {
    const id = ev.request_id;
    const req = ev.request ?? {};
    if (req.subtype !== "can_use_tool") {
      this.write({ type: "control_response", response: { subtype: "error", request_id: id, error: `지원 안 함: ${req.subtype}` } });
      return;
    }
    const input = (req.input ?? {}) as Record<string, unknown>;
    const ask = this.waiting?.hooks.onPermission;
    const answer: PermissionAnswer = ask ? await ask({ toolName: String(req.tool_name ?? ""), input }) : { allow: false, message: "지금은 도구를 쓸 수 없어" };
    this.write({
      type: "control_response",
      response: {
        subtype: "success", request_id: id,
        response: answer.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: answer.message },
      },
    });
  }

  /** 말 하나를 보내고 대답(result)을 기다린다. 일을 하면 오래 걸릴 수 있어서 시간 제한은 두지 않고, 멈출 땐 interrupt() */
  send(text: string, hooks: TurnHooks = {}): Promise<ClaudeResult> {
    if (!this.alive) return Promise.reject(new Error("claude가 꺼져 있어"));
    if (this.waiting) return Promise.reject(new Error("아직 대답을 기다리는 중이야"));
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject, hooks };
      this.turns++;
      this.write({ type: "user", message: { role: "user", content: text } });
    });
  }

  /** 하던 대답(일)을 멈춘다. 세션은 그대로라 대화는 이어진다 */
  interrupt(): void {
    this.write({ type: "control_request", request_id: `stop-${Date.now()}`, request: { subtype: "interrupt" } });
  }

  close(): void {
    if (this.dead) return;
    this.dead = true;
    try { this.child.stdin!.end(); } catch { /* 이미 닫힘 */ }
    killTree(this.child);
  }
}

/** claude 도구 사용을 진행 상황 한 줄로 */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const short = (t: string, n = 28) => (t.length > n ? t.slice(0, n) + "…" : t);
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
  switch (name) {
    case "Read": return `📖 ${base(s("file_path"))} 읽는 중`;
    case "Glob": case "Grep": return "🔍 찾아보는 중";
    case "Bash": case "PowerShell": return `💻 ${short(s("command"))}`;
    case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": return `✏️ ${base(s("file_path") || s("notebook_path"))} 고치는 중`;
    case "WebSearch": return "🌐 검색하는 중";
    case "WebFetch": return "🌐 웹페이지 보는 중";
    case "TodoWrite": case "TaskCreate": case "TaskUpdate": return "📝 계획 세우는 중";
    case "Skill": return `🧩 스킬: ${s("skill") || s("name") || "사용 중"}`;
    case "Task": case "Agent": return "🤝 도우미한테 맡기는 중";
    default: return name.startsWith("mcp__") ? `🔌 ${short(name.split("__").slice(1).join(" · "))}` : `🔧 ${name}`;
  }
}

/** 권한을 물을 때 말풍선에 보여줄 설명 */
export function permissionLabel(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
  switch (name) {
    case "Bash": case "PowerShell": return `터미널: ${s("command") || "(명령)"}`;
    case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": return `파일 수정: ${base(s("file_path") || s("notebook_path")) || "(파일)"}`;
    case "Read": return `파일 읽기: ${s("file_path")}`;
    case "WebFetch": return `웹 접속: ${s("url")}`;
    case "Skill": return `스킬 쓰기: ${s("skill") || s("name")}`;
    default: return name.startsWith("mcp__") ? `연결된 도구: ${name.split("__").slice(1).join(" · ")}` : name;
  }
}

/** Claude Code가 로그인 안 돼 있을 때 나오는 결과인지 */
export function needsLogin(text: string): boolean {
  return /not logged in|\/login/i.test(text);
}

export const loginHelp = "Claude Code에 로그인이 안 돼 있어…! 터미널에서 claude 를 실행해서 /login 해줘";
export const installHelp = "Claude Code(claude 명령어)를 못 찾았어…! 설치하고 로그인했는지 확인해줘";

export function killTree(child: ChildProcess | null): void {
  if (!child?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  else child.kill("SIGTERM");
}


