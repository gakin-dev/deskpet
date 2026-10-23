// AI 설정 창 — 처음 켤 때(또는 우클릭 → AI 설정) 펫이 쓸 AI(Claude Code / Codex) 하나를 고른다 (대화·일 시키기 모두)
// 화면: renderer/setup.html + src/renderer/setup.ts, 통로: src/setup-preload.ts (window.setup)

import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Brain } from "./brain";
import { needsLogin, type ClaudeCode } from "./claude";
import { openTerminal } from "./cli";
import { codexNeedsLogin, type CodexCli } from "./codex";

export interface SetupDeps {
  brain: Brain;
  claude: ClaudeCode;
  codex: CodexCli;
  /** 고른 AI로 대화·일 시키기를 다시 준비한다 */
  apply(): void;
}

let win: BrowserWindow | null = null;
let deps: SetupDeps;
let registered = false;

/** 아직 AI를 고른 적이 없는지 */
export function needsSetup(brain: Brain): boolean {
  return brain.config.setup_done !== true;
}

export function openSetup(d: SetupDeps, view: "settings" | "guide" = "settings"): void {
  deps = d;
  register();
  if (win && !win.isDestroyed()) {
    void win.loadFile(path.join(__dirname, "..", "..", "renderer", "setup.html"), { query: { view } });
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 640,
    minHeight: 470,
    title: "DeskPet AI 설정",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1b1a" : "#f6f4f1",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "setup-preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (process.platform === "darwin") void app.dock?.show();
  win.loadFile(path.join(__dirname, "..", "..", "renderer", "setup.html"), { query: { view } });
  win.once("ready-to-show", () => { win?.show(); app.focus({ steal: true }); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => {
    win = null;
    if (process.platform === "darwin" && BrowserWindow.getAllWindows().every((w) => !w.isVisible() || w.getTitle() === "DeskPet")) app.dock?.hide();
  });
}

const engineOf = (v: unknown): Engine => (v === "codex" ? "codex" : "claude");

function register(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("setup:state", async (): Promise<SetupState> => {
    await deps.brain.whenReady();
    const [claudeIn, codexIn] = await Promise.all([deps.claude.loggedIn(), deps.codex.loggedIn()]);
    const c = deps.brain.config;
    return {
      claude: { installed: !!deps.claude.path, loggedIn: claudeIn, path: deps.claude.path },
      codex: { installed: !!deps.codex.path, loggedIn: codexIn, path: deps.codex.path },
      engine: engineOf(c.chat_engine),
      claudeModel: typeof c.chat_model === "string" && c.chat_model ? c.chat_model : "sonnet",
      codexSandbox: c.codex_sandbox === "read-only" ? "read-only" : "workspace-write",
      firstRun: c.setup_done !== true,
      allowRules: deps.brain.allow.list(),
    };
  });

  ipcMain.handle("setup:test", async (_e, engine: unknown) => {
    const t0 = Date.now();
    const done = (ok: boolean, message: string) => ({ ok, message, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    try {
      if (engineOf(engine) === "codex") {
        if (!deps.codex.path) return done(false, "codex 명령어를 못 찾았어요");
        const dir = deps.brain.scratchDir;
        fs.mkdirSync(dir, { recursive: true });
        const r = await deps.codex.exec({ prompt: "한 단어로만 대답해: 안녕", cwd: dir, sandbox: "read-only", effort: "low" });
        deps.brain.usage.add("test", r.tokensIn, r.tokensOut);
        if (r.error) return done(false, codexNeedsLogin(r.error) ? "로그인이 풀렸어요. '로그인하기'를 눌러주세요" : r.error);
        return done(true, r.text || "대답 받음");
      }
      if (!deps.claude.path) return done(false, "claude 명령어를 못 찾았어요");
      const r = await deps.claude.run({ args: ["--tools", "", "--no-session-persistence", "--model", "haiku"], input: "한 단어로만 대답해: 안녕", noThinking: true });
      deps.brain.usage.add("test", r.contextTokens, r.outputTokens);
      if (needsLogin(r.result)) return done(false, "로그인이 안 돼 있어요. '로그인하기'를 눌러주세요");
      if (r.isError || !r.result) return done(false, r.result || "빈 대답");
      return done(true, r.result);
    } catch (e) {
      return done(false, e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle("setup:remove-allow", (_e, index: unknown) => {
    if (typeof index === "number") deps.brain.allow.remove(index);
    return deps.brain.allow.list();
  });

  ipcMain.on("setup:login", (_e, engine: unknown) => {
    if (engineOf(engine) === "codex") openTerminal({ mac: "codex login", windows: "codex login" });
    else openTerminal({ mac: "claude auth login", windows: "claude auth login" });
  });

  ipcMain.handle("setup:save", (_e, engine: unknown, model: unknown, sandbox: unknown) => {
    const b = deps.brain;
    b.saveConfig("chat_engine", engineOf(engine));
    b.saveConfig("agent_engine", engineOf(engine));
    if (typeof model === "string" && ["sonnet", "haiku", "opus", "default"].includes(model)) b.saveConfig("chat_model", model);
    b.saveConfig("codex_sandbox", sandbox === "read-only" ? "read-only" : "workspace-write");
    b.saveConfig("setup_done", true);
    deps.apply();
    win?.close();
  });
}
