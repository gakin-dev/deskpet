// 대화 창 — 펫과 나눈 최근 대화(내 말·펫 말)를 보고, 여기서도 말을 걸 수 있는 작은 창.
// 긴 대답은 말풍선에선 앞부분만 보이고 "전체 보기"를 누르면 여기서 다 보여준다. 위쪽엔 오늘 AI 사용량.
// 화면: renderer/chat.html + src/renderer/chatwin.ts, 통로: src/chat-preload.ts (window.chatwin)

import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "node:path";

export interface ChatWinDeps {
  state(): { name: string; entries: TranscriptEntry[]; usage: string; busy: boolean };
  send(text: string): void;
}

let win: BrowserWindow | null = null;
let deps: ChatWinDeps;
let registered = false;

export function openChatWindow(d: ChatWinDeps): void {
  deps = d;
  if (!registered) {
    registered = true;
    ipcMain.handle("chatwin:state", () => deps.state());
    ipcMain.on("chatwin:send", (_e, text: unknown) => {
      if (typeof text === "string" && text.trim()) deps.send(text.trim().slice(0, 4000));
    });
  }
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 320,
    minHeight: 360,
    title: "대화",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1b1a" : "#f6f4f1",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "chat-preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (process.platform === "darwin") void app.dock?.show();
  win.loadFile(path.join(__dirname, "..", "..", "renderer", "chat.html"));
  win.once("ready-to-show", () => { win?.show(); app.focus({ steal: true }); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => {
    win = null;
    if (process.platform === "darwin" && BrowserWindow.getAllWindows().every((w) => !w.isVisible() || w.getTitle() === "DeskPet")) app.dock?.hide();
  });
}

/** 대화가 바뀌면 열려 있는 대화 창에 알려준다 */
export function updateChatWindow(): void {
  if (win && !win.isDestroyed()) win.webContents.send("chatwin:update", deps.state());
}
