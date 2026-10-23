// 화면(렌더러)과 메인 프로세스 사이의 좁은 통로. window.pet 으로만 열어준다.

import { contextBridge, ipcRenderer } from "electron";

const bridge: PetBridge = {
  onState: (cb) => { ipcRenderer.on("state", (_e, s: PetViewState) => cb(s)); },
  onLook: (cb) => { ipcRenderer.on("look", (_e, look: Look) => cb(look)); },
  onWalk: (cb) => { ipcRenderer.on("walk", (_e, w: WalkState) => cb(w)); },
  onOpenChat: (cb) => { ipcRenderer.on("open-chat", () => cb()); },
  onToggleChat: (cb) => { ipcRenderer.on("toggle-chat", () => cb()); },
  chat: (text) => ipcRenderer.send("chat", text),
  answer: (choice) => ipcRenderer.send("answer", choice),
  chatOpened: () => ipcRenderer.send("chat-opened"),
  chatClosed: () => ipcRenderer.send("chat-closed"),
  openHistory: () => ipcRenderer.send("open-history"),
  showMenu: () => ipcRenderer.send("menu"),
  setIgnoreMouse: (ignore) => ipcRenderer.send("ignore-mouse", ignore),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragMove: () => ipcRenderer.send("drag-move"),
  dragEnd: () => ipcRenderer.send("drag-end"),
};

contextBridge.exposeInMainWorld("pet", bridge);
