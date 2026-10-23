// 스튜디오 창과 메인 프로세스 사이의 통로. window.studio 로만 열어준다.

import { contextBridge, ipcRenderer } from "electron";

const bridge: StudioBridge = {
  meta: () => ipcRenderer.invoke("studio:meta"),
  list: () => ipcRenderer.invoke("studio:list"),
  load: (id) => ipcRenderer.invoke("studio:load", id),
  save: (id, profile, personality, rules) => ipcRenderer.invoke("studio:save", id, profile, personality, rules),
  defaultRules: (id) => ipcRenderer.invoke("studio:default-rules", id),
  skills: (id) => ipcRenderer.invoke("studio:skills", id),
  saveSkill: (id, skill, oldName) => ipcRenderer.invoke("studio:save-skill", id, skill, oldName),
  deleteSkill: (id, name) => ipcRenderer.invoke("studio:delete-skill", id, name),
  openSkillsFolder: (id) => ipcRenderer.send("studio:open-skills", id),
  create: () => ipcRenderer.invoke("studio:create"),
  duplicate: (id) => ipcRenderer.invoke("studio:duplicate", id),
  remove: (id) => ipcRenderer.invoke("studio:remove", id),
  activate: (id) => ipcRenderer.invoke("studio:activate", id),
  addImages: (id, slot, files, replace) => ipcRenderer.invoke("studio:add-images", id, slot, files, replace),
  pickImages: (id, slot, replace) => ipcRenderer.invoke("studio:pick-images", id, slot, replace),
  removeImage: (id, slot, file) => ipcRenderer.invoke("studio:remove-image", id, slot, file),
  reorderFrames: (id, slot, files) => ipcRenderer.invoke("studio:reorder-frames", id, slot, files),
  imageBounds: (id, file) => ipcRenderer.invoke("studio:image-bounds", id, file),
  testChat: (profile, personality, rules, text, history) => ipcRenderer.invoke("studio:test-chat", profile, personality, rules, text, history),
  showOnPet: (mood, line) => ipcRenderer.send("studio:show-on-pet", mood, line),
  openFolder: (id) => ipcRenderer.send("studio:open-folder", id),
};

contextBridge.exposeInMainWorld("studio", bridge);
