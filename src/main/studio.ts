// 캐릭터 스튜디오 — 캐릭터 이름·크기·말투·감정 표현·이미지를 화면에서 편집하는 창
// 화면: renderer/studio.html + src/renderer/studio.ts, 통로: src/studio-preload.ts (window.studio)

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { situations, type Brain } from "./brain";
import { defaultRules, imageSlots, moods, normalizeProfile, type Character } from "./characters";

export interface StudioDeps {
  brain: Brain;
  /** 펫으로 쓸 캐릭터를 바꾼다 */
  useCharacter(id: string): void;
  /** 지금 펫의 성격·설정·이미지를 다시 읽어 펫에 반영한다 */
  reloadCharacter(): void;
  /** 바탕화면 펫이 이 감정과 대사를 보여준다 */
  showOnPet(mood: Mood, line: string): void;
  /** 지금 펫의 스킬이 바뀌었다 (세션을 다시 열어야 새 스킬을 앎) */
  skillsChanged(): void;
}

const maxImageBytes = 15 * 1024 * 1024;

let win: BrowserWindow | null = null;
let deps: StudioDeps;
let registered = false;

export function openStudio(d: StudioDeps): void {
  deps = d;
  register();
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: "DeskPet 스튜디오",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1b1a" : "#f6f4f1",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "studio-preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // 펫만 떠 있을 때는 독을 숨겨두지만, 스튜디오는 보통 창이라 열려 있는 동안 독에 보이게
  if (process.platform === "darwin") void app.dock?.show();
  win.loadFile(path.join(__dirname, "..", "..", "renderer", "studio.html"));
  win.once("ready-to-show", () => { win?.show(); app.focus({ steal: true }); });
  win.webContents.on("before-input-event", (e, input) => editShortcut(e, input));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => {
    win = null;
    if (process.platform === "darwin") app.dock?.hide();
  });
}

/** 메뉴 막대가 없는 앱이라 복사·붙여넣기 단축키를 직접 처리한다 */
function editShortcut(e: Electron.Event, input: Electron.Input): void {
  if (input.type !== "keyDown" || !win) return;
  const mod = process.platform === "darwin" ? input.meta : input.control;
  if (!mod || input.alt) return;
  const wc = win.webContents;
  const actions: Record<string, () => void> = {
    c: () => wc.copy(), v: () => wc.paste(), x: () => wc.cut(), a: () => wc.selectAll(),
    z: () => (input.shift ? wc.redo() : wc.undo()),
  };
  const act = actions[input.key.toLowerCase()];
  if (act) { e.preventDefault(); act(); }
}

function find(id: unknown): Character {
  const c = deps.brain.characters.list().find((x) => x.id === id);
  if (!c) throw new Error("그 캐릭터를 못 찾았어");
  return c;
}

function slot(s: unknown): ImageSlot {
  if (!imageSlots.includes(s as ImageSlot)) throw new Error("잘못된 이미지 칸");
  return s as ImageSlot;
}

const isActive = (c: Character) => c.id === deps.brain.character.id;

/** 지금 펫이 이 캐릭터면 바로 반영한다 */
function refresh(c: Character): void {
  if (isActive(c)) deps.reloadCharacter();
}

function summary(c: Character): StudioSummary {
  const ch = deps.brain.characters;
  const skin = ch.loadSkin(c);
  return {
    id: c.id,
    name: ch.loadProfile(c).name,
    active: isActive(c),
    thumb: (skin["default"] ?? skin["happy"] ?? Object.values(skin)[0])?.[0]?.url ?? null,
  };
}

function putImages(c: Character, s: ImageSlot, files: { name: string; data: Buffer }[], replace: boolean): SkinMap {
  if (files.some((f) => f.data.byteLength > maxImageBytes)) throw new Error("이미지가 너무 커 (한 장에 15MB까지)");
  // 여러 장이면 파일 이름 순서대로 (walk1.png, walk2.png … 처럼 번호 붙은 그림)
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  deps.brain.characters.addImages(c, s, sorted.map((f) => ({ ext: path.extname(f.name), data: f.data })), replace);
  refresh(c);
  return deps.brain.characters.loadSkin(c);
}

function toBuffer(data: unknown): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new Error("이미지를 못 읽었어");
}

function register(): void {
  if (registered) return;
  registered = true;
  const ch = () => deps.brain.characters;

  ipcMain.handle("studio:meta", (): StudioMeta => ({
    moods: moods.map((m) => ({ id: m.id, label: m.label, sample: m.sample })),
    // 펫이 실제로 보내는 상황 문장 + 예시 값
    situations: [
      { label: "처음 인사", text: situations.greet() },
      { label: "유튜브 15분째", text: situations.nag("YouTube", 15) },
      { label: "50분 연속 사용", text: situations.rest(50) },
      { label: "먼저 말 걸기", text: situations.chatter("Visual Studio Code", 20) },
    ],
  }));

  ipcMain.handle("studio:list", () => ch().list().map(summary));

  ipcMain.handle("studio:load", (_e, id: unknown): StudioCharacter => {
    const c = find(id);
    return {
      id: c.id,
      active: isActive(c),
      profile: ch().loadProfile(c),
      personality: ch().readPersonality(c),
      rules: ch().readRules(c),
      skin: ch().loadSkin(c),
      home: c.home,
    };
  });

  ipcMain.handle("studio:save", (_e, id: unknown, profile: unknown, personality: unknown, rules: unknown) => {
    const c = find(id);
    ch().saveProfile(c, profile as CharacterProfile);
    if (typeof personality === "string") ch().writePersonality(c, personality.slice(0, 20_000));
    if (typeof rules === "string") ch().writeRules(c, rules.slice(0, 20_000));
    refresh(c);
  });

  ipcMain.handle("studio:default-rules", (_e, id: unknown) => defaultRules(ch().loadProfile(find(id)).name));

  ipcMain.handle("studio:skills", (_e, id: unknown) => ch().listSkills(find(id)));

  ipcMain.handle("studio:save-skill", (_e, id: unknown, skill: unknown, oldName: unknown) => {
    const c = find(id);
    const k = (skill && typeof skill === "object" ? skill : {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    ch().saveSkill(c, { name: str(k.name, 41).trim(), description: str(k.description, 500), body: str(k.body, 50_000) },
      typeof oldName === "string" ? oldName : undefined);
    if (isActive(c)) deps.skillsChanged();
    return ch().listSkills(c);
  });

  ipcMain.handle("studio:delete-skill", (_e, id: unknown, name: unknown) => {
    const c = find(id);
    if (typeof name === "string") ch().deleteSkill(c, name);
    if (isActive(c)) deps.skillsChanged();
    return ch().listSkills(c);
  });

  ipcMain.on("studio:open-skills", (_e, id: unknown) => {
    const dir = path.join(find(id).home, ".claude", "skills");
    fs.mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  });

  ipcMain.handle("studio:create", () => ch().create().id);
  ipcMain.handle("studio:duplicate", (_e, id: unknown) => ch().duplicate(find(id)).id);

  ipcMain.handle("studio:remove", async (_e, id: unknown) => {
    const c = find(id);
    const all = ch().list();
    if (all.length <= 1) {
      await dialog.showMessageBox(win!, { type: "info", message: "캐릭터가 하나뿐이라 지울 수 없어요." });
      return false;
    }
    const name = ch().loadProfile(c).name;
    const r = await dialog.showMessageBox(win!, {
      type: "warning",
      message: `"${name}"을(를) 지울까요?`,
      detail: "캐릭터 폴더(성격, 설정, 이미지)가 휴지통으로 가요. 휴지통에서 되살릴 수 있어요.",
      buttons: ["휴지통으로 보내기", "취소"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return false;
    if (isActive(c)) deps.useCharacter(all.find((x) => x.id !== c.id)!.id);
    await shell.trashItem(c.dir);
    return true;
  });

  ipcMain.handle("studio:activate", (_e, id: unknown) => deps.useCharacter(find(id).id));

  ipcMain.handle("studio:add-images", (_e, id: unknown, s: unknown, files: unknown, replace: unknown) => {
    if (!Array.isArray(files) || files.length === 0) throw new Error("이미지를 못 읽었어");
    const list = files.map((f) => {
      if (!f || typeof f.name !== "string") throw new Error("이미지를 못 읽었어");
      return { name: f.name as string, data: toBuffer(f.data) };
    });
    return putImages(find(id), slot(s), list, replace === true);
  });

  ipcMain.handle("studio:pick-images", async (_e, id: unknown, s: unknown, replace: unknown) => {
    const c = find(id);
    const r = await dialog.showOpenDialog(win!, {
      title: "이미지 고르기 (여러 장 고르면 애니메이션)",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "이미지", extensions: ["png", "gif", "jpg", "jpeg", "webp"] }],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return putImages(c, slot(s), r.filePaths.map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) })), replace === true);
  });

  ipcMain.handle("studio:remove-image", (_e, id: unknown, s: unknown, file: unknown) => {
    const c = find(id);
    ch().removeImage(c, slot(s), typeof file === "string" ? file : undefined);
    refresh(c);
    return ch().loadSkin(c);
  });

  ipcMain.handle("studio:reorder-frames", (_e, id: unknown, s: unknown, files: unknown) => {
    const c = find(id);
    if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) throw new Error("잘못된 프레임 목록");
    ch().reorderFrames(c, slot(s), files as string[]);
    refresh(c);
    return ch().loadSkin(c);
  });

  ipcMain.handle("studio:image-bounds", (_e, id: unknown, file: unknown) => {
    const c = find(id);
    if (typeof file !== "string" || path.basename(file) !== file) return null;
    const img = nativeImage.createFromPath(path.join(c.skinDir, file));
    if (img.isEmpty()) return null;
    const { width: w, height: h } = img.getSize();
    const px = img.toBitmap();  // BGRA
    let left = w, top = h, right = -1, bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 16) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < 0) return null;
    return { w, h, left: left / w, top: top / h, right: (right + 1) / w, bottom: (bottom + 1) / h };
  });

  ipcMain.handle("studio:test-chat", (_e, profile: unknown, personality: unknown, rules: unknown, text: unknown, history: unknown) => {
    if (typeof text !== "string" || !text.trim()) return { line: "", mood: null, task: null, error: "할 말이 비었어" };
    const turns = Array.isArray(history)
      ? history.filter((h) => h && typeof h.user === "string" && typeof h.pet === "string").slice(-6) as TestTurn[]
      : [];
    const p = normalizeProfile(profile, "테스트");
    return deps.brain.testAsk(p, typeof personality === "string" ? personality.slice(0, 20_000) : "",
      typeof rules === "string" ? rules.slice(0, 20_000) : "", text.slice(0, 2000), turns);
  });

  ipcMain.on("studio:show-on-pet", (_e, mood: unknown, line: unknown) => {
    if (!moods.some((m) => m.id === mood)) return;
    deps.showOnPet(mood as Mood, typeof line === "string" ? line.slice(0, 200) : "");
  });

  ipcMain.handle("studio:export", async (_e, id: unknown) => {
    const c = find(id);
    const name = ch().loadProfile(c).name.replace(/[\\/:*?"<>|]/g, "_");
    const r = await dialog.showSaveDialog(win!, {
      title: "캐릭터 내보내기",
      defaultPath: path.join(app.getPath("desktop"), `${name}.deskpet`),
      filters: [{ name: "DeskPet 캐릭터", extensions: ["deskpet"] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, ch().exportCharacter(c));
    return r.filePath;
  });

  ipcMain.handle("studio:import", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "캐릭터 가져오기",
      properties: ["openFile"],
      filters: [{ name: "DeskPet 캐릭터", extensions: ["deskpet"] }],
    });
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    if (fs.statSync(file).size > 200 * 1024 * 1024) throw new Error("파일이 너무 커");
    return ch().importCharacter(fs.readFileSync(file, "utf8")).id;
  });

  ipcMain.on("studio:open-folder", (_e, id: unknown) => { void shell.openPath(find(id).dir); });
}
