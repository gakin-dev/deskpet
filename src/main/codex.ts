// Codex CLI(`codex exec`)를 부르는 공용 부분. 대화(brain.ts)와 일 시키기(agent.ts)에서 Codex를 고르면 쓴다.
// API 키 없이 Codex에 로그인된 ChatGPT 계정으로 돈다.
//
// `codex exec --json`은 이벤트를 한 줄씩(JSONL) 내보낸다:
//   thread.started {thread_id} / item.started·item.completed {item: agent_message | command_execution | file_change | reasoning …}
//   turn.completed / turn.failed {error} / error {message}

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createInterface } from "node:readline";
import { cliEnv, findCommand, withDirInPath } from "./cli";

export interface CodexResult {
  /** 이어서 말할 때 쓰는 대화 id (`codex exec resume <id>`) */
  threadId: string | null;
  /** 마지막 대답 */
  text: string;
  /** 실패했으면 이유 */
  error: string | null;
  /** 들어간 토큰(캐시 포함)과 AI가 쓴 토큰 */
  tokensIn: number;
  tokensOut: number;
}

export interface CodexOptions {
  prompt: string;
  cwd?: string;
  /** read-only: 읽기만 / workspace-write: 작업 폴더 안에서 쓰기까지 */
  sandbox: "read-only" | "workspace-write";
  model?: string | null;
  /** 생각하는 정도 (minimal·low·medium·high). 짧은 대사는 낮게 */
  effort?: string | null;
  /** 기본 지시문 대신 쓸 파일 (펫 성격 프롬프트) */
  instructionsFile?: string;
  /** 이 대화에 이어서 */
  resumeId?: string | null;
  onEvent?: (ev: any) => void;
  onSpawn?: (child: ChildProcess) => void;
}

export const codexInstallHelp = "Codex(codex 명령어)를 못 찾았어…! 설치하고 로그인했는지 확인해줘";
export const codexLoginHelp = "Codex 로그인이 풀렸어…! 터미널에서 codex login 을 해줘";

/** Codex 로그인이 필요해서 실패했는지 */
export function codexNeedsLogin(text: string): boolean {
  return /401|unauthorized|not logged in|codex login|refresh token/i.test(text);
}

export class CodexCli {
  path: string | null = null;
  private env: NodeJS.ProcessEnv = process.env;
  private ready: Promise<void> = Promise.resolve();

  /** codex 실행 파일을 찾는다. override가 있으면 그걸 쓴다 */
  locate(override?: string): Promise<void> {
    this.ready = (async () => {
      const env = await cliEnv();
      this.path = override && fs.existsSync(override) ? override : findCommand("codex", env.PATH ?? "");
      this.env = this.path ? withDirInPath(env, this.path) : env;
    })();
    return this.ready;
  }

  async available(): Promise<boolean> {
    await this.ready;
    return !!this.path;
  }

  private spawnCodex(args: string[], cwd?: string): ChildProcess {
    if (!this.path) throw new Error("codex 명령어를 못 찾았어");
    const p = this.path;
    const useShell = process.platform === "win32" && !p.toLowerCase().endsWith(".exe");
    return spawn(useShell ? `"${p}"` : p, useShell ? args.map((a) => `"${a}"`) : args, {
      cwd: cwd ?? os.homedir(), env: this.env, shell: useShell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /** 로그인돼 있는지 (`codex login status`). 토큰이 만료돼도 "로그인됨"으로 나올 수 있어서 연결 테스트가 따로 있음 */
  async loggedIn(): Promise<boolean | null> {
    await this.ready;
    if (!this.path) return false;
    return new Promise((resolve) => {
      const child = this.spawnCodex(["login", "status"]);
      let out = "";
      child.stdout!.on("data", (d) => { out += d; });
      child.stderr!.on("data", (d) => { out += d; });
      child.on("error", () => resolve(null));
      child.on("close", () => resolve(/logged in/i.test(out) && !/not logged in/i.test(out)));
      child.stdin!.end();
    });
  }

  /** `codex exec --json`을 한 번 돌리고 마지막 대답을 돌려준다 */
  async exec(o: CodexOptions): Promise<CodexResult> {
    await this.ready;
    const args = ["exec", "--json", "--skip-git-repo-check", "-s", o.sandbox];
    if (o.cwd) args.push("-C", o.cwd);
    if (o.model) args.push("-m", o.model);
    if (o.effort) args.push("-c", `model_reasoning_effort="${o.effort}"`);
    if (o.instructionsFile) args.push("-c", `experimental_instructions_file=${JSON.stringify(o.instructionsFile)}`);
    if (o.resumeId) args.push("resume", o.resumeId);
    args.push("-");  // 할 말은 stdin으로 (윈도우 셸 따옴표 문제 피하기)

    const child = this.spawnCodex(args, o.cwd);
    o.onSpawn?.(child);
    return new Promise((resolve, reject) => {
      let threadId: string | null = o.resumeId ?? null;
      let text = "";
      let error: string | null = null;
      let stderr = "";
      let tokensIn = 0, tokensOut = 0;
      child.stderr!.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
      createInterface({ input: child.stdout! }).on("line", (line) => {
        let ev: any;
        try { ev = JSON.parse(line); } catch { return; }
        o.onEvent?.(ev);
        if (ev.type === "turn.completed" && ev.usage) {
          tokensIn += Number(ev.usage.input_tokens) || 0;
          tokensOut += Number(ev.usage.output_tokens) || 0;
        }
        if (ev.type === "thread.started" && ev.thread_id) threadId = ev.thread_id;
        else if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") text = ev.item.text.trim();
        else if (ev.type === "turn.failed") error = ev.error?.message ?? "Codex가 실패했어";
        else if (ev.type === "error" && typeof ev.message === "string" && !/retrying/i.test(ev.message)) error = ev.message;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (!text && !error && code !== 0) error = stderr.trim().split("\n").pop() || `종료 코드 ${code}`;
        resolve({ threadId, text, error: text ? null : error, tokensIn, tokensOut });
      });
      child.stdin!.end(o.prompt);
    });
  }
}

/** Codex 이벤트를 진행 상황 한 줄로 */
export function describeCodex(ev: any): string | null {
  if (ev.type !== "item.started" && ev.type !== "item.completed") return null;
  const item = ev.item ?? {};
  const short = (t: string, n = 28) => (t.length > n ? t.slice(0, n) + "…" : t);
  switch (item.type) {
    case "command_execution": return ev.type === "item.started" ? `💻 ${short(String(item.command ?? "").replace(/^bash -lc /, ""))}` : null;
    case "file_change": {
      const files = Array.isArray(item.changes) ? item.changes.map((c: any) => String(c.path ?? "").split(/[\\/]/).pop() ?? "").filter(Boolean) : [];
      return `✏️ ${short(files.join(", ") || "파일")} 고치는 중`;
    }
    case "web_search": return "🌐 검색하는 중";
    case "reasoning": return ev.type === "item.started" ? "🤔 생각하는 중" : null;
    default: return null;
  }
}
