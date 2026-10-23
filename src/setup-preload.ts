// AI 설정 창과 메인 프로세스 사이의 통로. window.setup 으로만 열어준다.

import { contextBridge, ipcRenderer } from "electron";

const bridge: SetupBridge = {
  state: () => ipcRenderer.invoke("setup:state"),
  test: (engine) => ipcRenderer.invoke("setup:test", engine),
  login: (engine) => ipcRenderer.send("setup:login", engine),
  removeAllow: (index) => ipcRenderer.invoke("setup:remove-allow", index),
  save: (engine, claudeModel, codexSandbox) => ipcRenderer.invoke("setup:save", engine, claudeModel, codexSandbox),
};

contextBridge.exposeInMainWorld("setup", bridge);
