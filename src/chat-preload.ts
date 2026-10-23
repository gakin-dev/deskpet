// 대화 창과 메인 프로세스 사이의 통로. window.chatwin 으로만 열어준다.

import { contextBridge, ipcRenderer } from "electron";

const bridge: ChatBridge = {
  state: () => ipcRenderer.invoke("chatwin:state"),
  onUpdate: (cb) => { ipcRenderer.on("chatwin:update", (_e, s) => cb(s)); },
  send: (text) => ipcRenderer.send("chatwin:send", text),
};

contextBridge.exposeInMainWorld("chatwin", bridge);
