// DeskPet — 화면 위에 떠서 지금 쓰는 앱을 지켜보는 작은 친구 (Electron 메인 프로세스)
// 실행: npm start

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, powerMonitor, screen, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { watchActiveWindow, type ActiveWindow } from "./activity";
import { Brain, defaultChatHotkey, situations } from "./brain";
import { defaultReactionLines, moods, pickIdleMood, type Lines } from "./characters";
import { Roamer } from "./roam";
import { openStudio } from "./studio";
import { ClaudeCode } from "./claude";
import { openTerminal } from "./cli";
import { openChatWindow, updateChatWindow } from "./chatwin";
import { CodexCli } from "./codex";
import { needsSetup, openSetup } from "./setup";
import { classify, classifyTitle, icon, type Category } from "./classify";

const WIN_W = 300;
const WIN_H = 420;

// MARK: - 상태

class PetState {
  view: PetViewState = { name: "모찌", message: null, mood: "happy", thinking: false, ask: null, working: null };
  usage = new Map<string, { seconds: number; category: Category }>();
  currentLabel = "";
  currentCategory: Category = "other";
  appSince = Date.now();
  activeStreak = 0;
  lastNag = 0;
  lastSpoke = 0;
  isIdle = false;
  /** 화면이 잠겼거나 잠자기 중 (자리 비움으로 본다) */
  locked = false;
  /** 최근 대화 (대화 창에 보여줌, 메모리에만 최근 100개) */
  transcript: TranscriptEntry[] = [];
  onTranscript: (() => void) | null = null;

  record(e: Omit<TranscriptEntry, "at">): void {
    this.transcript.push({ ...e, at: Date.now() });
    if (this.transcript.length > 100) this.transcript.splice(0, this.transcript.length - 100);
    this.onTranscript?.();
  }

  /** 마지막으로 앞에 있던 다른 앱 (입력창을 닫으면 키보드를 돌려준다). 맥은 번들 ID */
  lastApp: ActiveWindow | null = null;
  /** 맨 앞이 잠금 화면·화면 보호기 (잠금 이벤트가 안 와도 이걸로 알아챔) */
  onSystemScreen = false;
  /** 이 시각이 지나고 조용하면 평상시 기분 비율대로 기분을 바꾼다 */
  nextIdleMood = Date.now() + 20_000;
  /** 화면을 걸어다니게 하는 부분 (창을 만든 뒤에 생김) */
  roamer: Roamer | null = null;
  /** 정해진 대사만 말하는 캐릭터의 감정별 대사. 있으면 말풍선은 전부 여기서 뽑는다 */
  lines: Lines | null = null;
  /** 켜져 있는 감정 (스튜디오에서 끈 감정은 대신 다른 감정으로 보여준다) */
  enabled: Mood[] = moods.map((m) => m.id);
  private hideTimer: NodeJS.Timeout | null = null;
  private pendingAnswer: ((choice: Approval) => void) | null = null;

  constructor(private push: (v: PetViewState) => void) {}

  /** 꺼진 감정이면 켜진 감정으로 바꾼다 (기쁨 → 첫 번째 켜진 감정 순) */
  fix(mood: Mood): Mood {
    if (this.enabled.includes(mood)) return mood;
    return this.enabled.includes("happy") ? "happy" : this.enabled[0] ?? "happy";
  }

  /** about: 무엇에 대한 말인지 (앱 이름 등). 소리만 내는 캐릭터도 이건 앞에 붙여 말한다 ("Finder 우랴!") */
  /** verbatim: 정해진 대사만 말하는 캐릭터도 글자 그대로 보여준다 (오늘 요약처럼 정보를 보여줄 때) */
  say(text: string, mood?: Mood, seconds = 4, force = false, about?: string, verbatim = false): void {
    if (!text) return;
    const original = text;
    if (mood) mood = this.fix(mood);
    if (this.lines && !verbatim) {
      const sound = pick(this.lines[mood ?? this.view.mood] ?? Object.values(this.lines).flat());
      text = about ? `${about} ${sound}` : sound;
    }
    // 가벼운 말(앱 전환 등)은 다른 말풍선이 떠 있는 동안 끼어들지 않는다 (대답·퀴즈가 덮이지 않게)
    if (!force && (Date.now() - this.lastSpoke < 6000 || this.view.message !== null)) return;
    this.lastSpoke = Date.now();
    this.roamer?.onSpeak();
    this.view.message = text;
    // 정해진 대사 캐릭터는 소리만 나가니까 원래 하려던 말도 같이 남긴다
    this.record({ who: "pet", text, mood: mood ?? this.view.mood, ...(original !== text && !about ? { ai: original } : {}) });
    if (mood) this.view.mood = mood;
    this.push(this.view);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.view.message = null;
      this.push(this.view);
      this.nextIdleMood = Date.now() + 8000;  // 말이 끝나고 조금 있다가 평상시 기분으로
    }, seconds * 1000);
  }

  setMood(mood: Mood): void { this.view.mood = this.fix(mood); this.push(this.view); }
  setThinking(on: boolean): void { this.view.thinking = on; this.push(this.view); }
  clearMessage(): void { this.view.message = null; this.push(this.view); }
  setWorking(text: string | null): void { this.view.working = text; this.push(this.view); }

  /** 말풍선에 승인 버튼을 띄우고 답을 기다린다 */
  askUser(question: string): Promise<Approval> {
    this.pendingAnswer?.("no");
    this.view.ask = question;
    this.view.mood = this.fix("suspicious");
    this.push(this.view);
    this.roamer?.hold("ask", true);
    return new Promise((resolve) => { this.pendingAnswer = resolve; });
  }

  answer(choice: Approval): void {
    const r = this.pendingAnswer;
    this.roamer?.hold("ask", false);
    this.pendingAnswer = null;
    this.view.ask = null;
    this.view.mood = this.fix(choice === "no" ? "happy" : "focused");
    this.push(this.view);
    r?.(choice);
  }

  summary(): string {
    const top = [...this.usage.entries()].sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 4);
    if (top.length === 0) return "아직 기록이 없어!";
    const lines = top.map(([name, { seconds, category }]) => `${icon(category)} ${name}  ${formatDuration(seconds)}`);
    return "오늘 이만큼 했어!\n" + lines.join("\n");
  }

  /** AI에게 넘겨줄 지금 상황 요약 */
  context(): string {
    const now = new Date();
    const h = now.getHours();
    const time = `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시 ${now.getMinutes()}분`;
    const top = [...this.usage.entries()].sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 3)
      .map(([name, u]) => `${name} ${Math.floor(u.seconds / 60)}분`).join(", ");
    return `지금 시각 ${time}. 오늘 많이 쓴 앱: ${top || "아직 없음"}.`;
  }
}

function formatDuration(t: number): string {
  const m = Math.floor(t / 60);
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return m > 0 ? `${m}분` : `${Math.floor(t)}초`;
}

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** 잠금 화면·화면 보호기 같은 시스템 화면 (맥 loginwindow, ScreenSaverEngine / 윈도우 LockApp) */
const systemScreens = /^(loginwindow|ScreenSaverEngine|LockApp|LogonUI)$/i;

// MARK: - 감시 로직

class Watcher {
  readonly claude = new ClaudeCode();
  readonly codex = new CodexCli();
  readonly brain = new Brain(this.claude, this.codex);
  private lastChatter = Date.now();
  private first = true;

  constructor(private s: PetState) {
    watchActiveWindow((w) => this.switched(w));
    setInterval(() => this.tick(), 1000);
  }

  switched(w: ActiveWindow): void {
    if (w.pid === process.pid) return;  // 내 창은 무시
    // 잠금 화면·화면 보호기는 앱으로 안 치고 자리 비움으로 본다
    this.s.onSystemScreen = systemScreens.test(w.name);
    if (this.s.onSystemScreen || this.s.locked) return;
    this.s.lastApp = w;

    let category = classify(w.name, w.id);
    let site: string | null = null;
    if (category === "browser" && w.title) {
      const hit = classifyTitle(w.title);
      if (hit) { category = hit.category; site = hit.site; }
    }
    const label = site ? `${site} (${w.name})` : w.name;
    if (label === this.s.currentLabel) return;  // 같은 앱 안에서 제목만 바뀐 경우

    this.s.currentLabel = label;
    this.s.currentCategory = category;
    this.s.appSince = Date.now();
    if (this.first) { this.first = false; return; }
    if (!this.brain.profile.reactions.appSwitch) return;

    // 앱 전환은 자주 일어나서 AI를 부르지 않고 미리 써둔 대사로만 반응한다 (구독 사용량 절약)
    const name = site ?? w.name;
    const lines: Record<Category, [string[], Mood]> = {
      work: [[`오 ${name}! 열공 모드 👀`, "집중 집중~!", "좋아 좋아, 일하는 중이구나!", "할 수 있어…!", `${name}다…! 나도 옆에서 응원할게`], "focused"],
      play: [[`앗… ${name}? 🤨`, "지금 놀 시간이야…?", "잠깐만 하는 거지…?", "히잉… 일은 다 했어…?", `${name}… 딱 10분만이야…!`], "suspicious"],
      browser: [["웹서핑…? 공부하는 거 맞지? 👀", "검색하는 거지? 그치?", "뭐 찾아…? 금방 돌아올 거지…?"], "suspicious"],
      other: [[`${name} 켰구나!`, `오, ${name}…!`, "뭐 하는 거야…? 궁금해…!"], pickIdleMood(this.brain.profile) ?? "happy"],
    };
    const [options, mood] = lines[category];
    this.s.say(pick(options), mood, 5, false, name);
  }

  /**
   * AI가 켜져 있으면 성격대로 반응하고, 아니면 미리 써둔 대사를 쓴다.
   * important가 아니면 AI 호출은 15초에 한 번까지만 (사용량 절약).
   */
  react(situation: string, fallback: string, mood: Mood, important = false, seconds = 5): void {
    const b = this.brain;
    if (!b.enabled) { this.s.say(fallback, mood, seconds, important); return; }
    if (b.busy || (!important && Date.now() - b.lastCall < 15_000)) return;
    this.s.setMood(mood);
    void b.ask(situation).then((r) => {
      if (r) this.s.say(r.line, r.mood ?? mood, Math.max(seconds, 5), true);
      else if (important) this.s.say(fallback, mood, seconds, true);
    });
  }

  /**
   * 상황 반응: 기본은 스튜디오 반응 탭에 써둔 대사 중 하나 (AI 안 씀, {앱} {분} {이름}을 채움).
   * 그 반응의 "AI로 말하기"를 켰으면 AI가 그때그때 말한다.
   */
  reactTo(kind: ReactionKind, situation: string, mood: Mood, vars: { app?: string; mins?: number }, important = true, seconds = 6): void {
    const rx = this.brain.profile.reactions;
    const lines = rx.lines[kind]?.length ? rx.lines[kind] : defaultReactionLines[kind];
    const line = pick(lines)
      .replaceAll("{이름}", this.brain.profile.name)
      .replaceAll("{앱}", vars.app ?? "")
      .replaceAll("{분}", vars.mins !== undefined ? String(vars.mins) : "");
    if (rx.ai[kind] && this.brain.enabled) { this.react(situation, line, mood, important, seconds); return; }
    // 정해진 대사 캐릭터면 잔소리는 "앱 이름 + 소리"로 (앱 전환 반응처럼)
    this.s.say(line, mood, seconds, important, kind === "nag" ? vars.app : undefined);
  }

  /** AI 없이 할 말: 캐릭터에 그 감정의 대사가 있으면 그중 하나, 없으면 기본 대사 */
  canned(mood: Mood, fallback: string): string {
    const lines = this.brain.profile.moods[mood].lines;
    return lines.length ? pick(lines) : fallback;
  }

  /** 처음 나타났을 때 / 캐릭터를 바꿨을 때 인사 */
  async greet(): Promise<void> {
    await this.brain.whenReady();
    if (!this.brain.profile.reactions.greet) return;
    this.reactTo("greet", `${situations.greet()} ${this.s.context()}`, "surprised", {}, true, 5);
  }

  /**
   * 말을 걸면 대답하고, 일을 부탁하면 같은 세션에서 도구를 써서 한다 (사용자의 Claude Code / Codex 그대로).
   * 진행 상황은 말풍선 아래 한 줄로, 설정에 없는 권한은 말풍선으로 묻는다.
   */
  chat(text: string): void {
    const b = this.brain;
    if (!b.enabled) {
      this.s.say(b.lastError ?? "아직 준비 중이야…!", "sleepy", 6, true, undefined, true);
      return;
    }
    if (b.busy) {
      this.s.say("지금 하던 거 하는 중이야…! 끝나면 말해줘", "suspicious", 4, true);
      return;
    }
    this.s.record({ who: "me", text });
    this.s.setThinking(true);
    void b.ask(`${text}\n\n[참고: ${this.s.context()} 지금 쓰는 앱: ${this.s.currentLabel}]`, {
      progress: (t) => { if (t) this.s.setThinking(false); this.s.setWorking(t); },
      ask: (q) => { this.s.setThinking(false); return this.s.askUser(q); },
    }).then((r) => {
      this.s.setThinking(false);
      this.s.setWorking(null);
      if (!r) {
        this.s.say(`히잉… ${b.lastError ?? "머리가 안 돌아가…"}`, "sad", 8, true, undefined, true);
        return;
      }
      // 일 결과나 정보를 알려주는 대답이면 정해진 대사 캐릭터도 글자로 보여준다
      this.s.say(r.line, r.mood ?? "happy", r.showText ? 12 : 8, true, undefined, r.showText);
    });
    this.s.onTranscript?.();  // 대화 창에 "생각 중" 표시
  }

  /** 1초마다: 자리 비움, 사용 시간 기록, 잔소리·휴식 권유·먼저 말 걸기 (캐릭터의 반응 규칙대로) */
  tick(): void {
    const s = this.s;
    const rx = this.brain.profile.reactions;
    const idle = powerMonitor.getSystemIdleTime();
    // 화면 잠금·화면 보호기도 자리 비움 (잠긴 동안 입력이 없다고 안 잡히는 경우가 있어서 따로 본다)
    const away = s.locked || s.onSystemScreen || idle > rx.awayAfter * 60;

    if (away) {
      if (!s.isIdle) {
        s.isIdle = true;
        s.roamer?.hold("away", true);  // 자리를 비우면 졸려서 안 돌아다님
        s.activeStreak = 0;
        // 자리 비움·복귀는 자주 일어나서 AI 없이 미리 써둔 대사로 (구독 사용량 절약)
        if (rx.away) this.s.say(this.canned("sleepy", "어디 갔어…? zzZ"), "sleepy", 6, true);
      }
      return;
    }
    if (s.isIdle) {
      s.isIdle = false;
      s.roamer?.hold("away", false);
      if (rx.away) this.s.say(this.canned("surprised", "왔다! 다시 시작하자 ✨"), "surprised", 5, true);
    }

    // 조용할 때 평상시 기분 비율대로 가끔 기분을 바꾼다 (말하는 중·생각 중·승인 질문·일하는 중엔 그대로)
    const v = s.view;
    if (Date.now() > s.nextIdleMood && !v.message && !v.thinking && !v.ask && !v.working) {
      s.nextIdleMood = Date.now() + (25 + Math.random() * 35) * 1000;
      const m = pickIdleMood(this.brain.profile);
      if (m && m !== v.mood) s.setMood(m);
    }

    if (!s.currentLabel) return;
    const u = s.usage.get(s.currentLabel) ?? { seconds: 0, category: s.currentCategory };
    u.seconds += 1;
    u.category = s.currentCategory;
    s.usage.set(s.currentLabel, u);
    s.activeStreak += 1;

    const inApp = (Date.now() - s.appSince) / 1000;
    const sinceNag = (Date.now() - s.lastNag) / 1000;
    const mins = Math.floor(inApp / 60);

    if (rx.nag && s.currentCategory === "play" && inApp > rx.nagAfter * 60 && sinceNag > rx.nagEvery * 60) {
      s.lastNag = Date.now();
      this.reactTo("nag", `${situations.nag(s.currentLabel, mins)} ${s.context()}`, "suspicious", { app: s.currentLabel, mins }, true, 6);
    } else if (s.activeStreak > rx.restAfter * 60) {
      s.activeStreak = 0;
      if (rx.rest) {
        this.reactTo("rest", `${situations.rest(rx.restAfter)} ${s.context()}`, "happy", { app: s.currentLabel, mins: rx.restAfter }, true, 7);
      }
    } else if (rx.chatter && Date.now() - this.lastChatter > rx.chatterEvery * 60_000 && s.view.message === null) {
      // 가끔 먼저 말 걸기 (평상시 기분 비율로 표정)
      this.lastChatter = Date.now();
      this.reactTo("chatter", `${situations.chatter(s.currentLabel, mins)} ${s.context()}`,
        pickIdleMood(this.brain.profile) ?? "happy", { app: s.currentLabel, mins }, false, 6);
    }
  }
}

// MARK: - 창 & 실행

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

const state = new PetState((v) => send("state", v));
let watcher: Watcher;

function createWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const w = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: area.x + area.width - WIN_W - 20,
    y: area.y + area.height - WIN_H - 10,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    // 맥: 앱을 앞으로 끌어오지 않고 떠 있는 패널 창
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  w.setAlwaysOnTop(true, "floating");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 캐릭터가 없는 투명한 부분은 클릭이 뒤 창으로 지나가게 (렌더러가 캐릭터 위에서만 끈다)
  w.setIgnoreMouseEvents(true, { forward: true });
  w.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  w.once("ready-to-show", () => w.showInactive());
  w.webContents.on("did-finish-load", () => {
    sendCharacter();
    send("state", state.view);
  });
  return w;
}

/** 지금 캐릭터의 이름과 겉모습을 화면에 보낸다 */
function sendCharacter(): void {
  const b = watcher.brain;
  const p = b.profile;
  state.view.name = p.name;
  state.lines = b.lines;
  state.enabled = moods.filter((m) => p.moods[m.id].enabled).map((m) => m.id);
  state.view.mood = state.fix(state.view.mood);
  const look: Look = {
    skin: b.characters.loadSkin(b.character), size: p.size, moods: p.moods,
    facing: p.behavior.facing, gait: p.behavior.gait, frameRate: p.frameRate, imageAdjust: p.imageAdjust,
  };
  state.roamer?.configure(p.behavior, p.size);
  send("look", look);
  send("state", state.view);
}

/** 펫으로 쓸 캐릭터를 바꾼다 (성격·대화 기억이 새로 시작됨) */
function useCharacter(id: string): void {
  const b = watcher.brain;
  if (id === b.character.id) return;
  b.switchCharacter(id);
  sendCharacter();
  void watcher.greet();
}

/** 감정 미리보기 대사: 캐릭터에 써둔 대사 중 하나, 없으면 기본 예시 */
function sampleLine(mood: Mood): string {
  const lines = watcher.brain.profile.moods[mood].lines;
  return lines.length ? lines[Math.floor(Math.random() * lines.length)] : moods.find((m) => m.id === mood)!.sample;
}

function showStudio(): void {
  openStudio({
    brain: watcher.brain,
    useCharacter,
    reloadCharacter: () => { watcher.brain.refreshCharacter(); sendCharacter(); },
    showOnPet: (mood, line) => state.say(line || sampleLine(mood), mood, 4, true),
    skillsChanged: () => watcher.brain.skillsChanged(),
  });
}

function showMenu(): void {
  const b = watcher.brain;
  Menu.buildFromTemplate([
    {
      label: "말 걸기 · 일 시키기", click: () => { state.clearMessage(); send("open-chat"); },
      ...(chatHotkey ? { accelerator: chatHotkey, registerAccelerator: false } : {}),
    },
    ...(b.busy ? [{ label: "하던 일 멈추기", click: () => b.cancel() }] : []),
    { type: "separator" },
    {
      label: `캐릭터: ${b.character.name}`,
      submenu: b.characters.list().map((c) => ({
        label: b.characters.loadProfile(c).name,
        type: "radio" as const,
        checked: c.id === b.character.id,
        click: () => useCharacter(c.id),
      })),
    },
    {
      label: "감정 미리보기",
      submenu: moods.filter((m) => b.profile.moods[m.id].enabled).map((m) => ({
        label: `${m.label} ${b.profile.moods[m.id].effect}`,
        click: () => state.say(sampleLine(m.id), m.id, 4, true),
      })),
    },
    { label: "캐릭터 스튜디오 열기…", click: () => showStudio() },
    { type: "separator" },
    { label: "대화 창 열기", click: () => showChatWindow() },
    { label: "오늘 요약 보기", click: () => state.say(state.summary(), "happy", 8, true, undefined, true) },
    { label: `작업 폴더: ${path.basename(b.cwd) || b.cwd} (바꾸기…)`, click: () => void chooseAgentDir() },
    {
      label: `${b.character.name}와(과) 대화 새로 시작`,
      click: () => { b.forget(); state.say("새로 시작하자…!", "happy", 4, true); },
    },
    { label: "대화 기록 보기 (터미널)", click: () => openLogInTerminal(b.chatLogFile) },
    {
      label: "작업 기록 보기",
      click: () => {
        const f = b.workLogFile;
        if (!fs.existsSync(f)) fs.writeFileSync(f, "# 작업 기록\n\n");
        void shell.openPath(f);
      },
    },
    { type: "separator" },
    { label: "AI 설정 (Claude Code / Codex)…", click: () => showSetup() },
    { label: b.usage.summary(), enabled: false },
    { label: "AI 사용 가이드", click: () => showSetup("guide") },
    {
      label: `${b.engine === "codex" ? "Codex" : "Claude Code"}: ${b.enabled ? `연결됨 (${b.model})` : "못 찾음"}`,
      enabled: false,
    },
    { label: "잘 있어~ (종료)", click: () => app.quit() },
  ]).popup({ window: win ?? undefined });
}

/** 대화 기록 파일을 터미널에서 실시간으로 본다 (tail -f) */
function openLogInTerminal(file: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  if (process.platform !== "darwin" && process.platform !== "win32") { void shell.openPath(file); return; }
  openTerminal({
    mac: `clear; echo '${path.basename(file)} — 펫이 AI와 주고받는 말 (창을 닫아도 펫은 그대로예요)'; tail -n 60 -f '${file.replace(/'/g, "'\\''")}'`,
    windows: `Get-Content -Path '${file}' -Tail 60 -Wait -Encoding UTF8`,
  });
}

// MARK: - 단축키

/** 입력창 열기·닫기 단축키 (어느 앱에서든). config.json의 chat_hotkey로 바꾸고 "off"면 끔 */
let chatHotkey: string | null = null;

function registerChatHotkey(): void {
  if (chatHotkey) globalShortcut.unregister(chatHotkey);
  chatHotkey = null;
  const c = watcher.brain.config.chat_hotkey;
  const key = typeof c === "string" && c ? c : defaultChatHotkey;
  if (key === "off") return;
  try {
    if (globalShortcut.register(key, toggleChatFromHotkey)) chatHotkey = key;
  } catch { /* 잘못된 키 이름 */ }
  if (!chatHotkey) state.say(`단축키 ${key}를 못 썼어… 다른 앱이 쓰는 중인가 봐`, "sad", 6, true, undefined, true);
}

/** 단축키를 누르면 펫 창으로 키보드를 가져와서 입력창을 열거나 닫는다 */
function toggleChatFromHotkey(): void {
  if (!win || win.isDestroyed()) return;
  const open = () => {
    state.clearMessage();
    app.focus({ steal: true });
    win?.focus();
    send("toggle-chat");
  };
  if (process.platform !== "darwin" || win.isFocused()) { open(); return; }
  // 앱 감지는 1초마다라 방금 바꾼 앱을 아직 모를 수 있어서, 키보드를 가져오기 전에 지금 맨 앞 앱을 바로 읽어둔다 (닫을 때 돌려줌)
  execFile("/bin/sh", ["-c", 'lsappinfo info -only name -only bundleid -only pid "$(lsappinfo front)"'], { timeout: 1000 }, (err, out) => {
    const get = (k: string) => out?.match(new RegExp(`"${k}"="([^"]*)"`))?.[1] ?? out?.match(new RegExp(`"${k}"=(\\d+)`))?.[1] ?? "";
    const id = get("CFBundleIdentifier"), pid = Number(get("pid"));
    if (!err && id && pid !== process.pid) state.lastApp = { name: get("LSDisplayName") || id, id, title: "", pid };
    open();
  });
}

/** 대화 창 (최근 대화 전체 보기 + 여기서도 말 걸기) */
function showChatWindow(): void {
  openChatWindow({
    state: () => ({ name: watcher.brain.profile.name, entries: state.transcript, usage: watcher.brain.usage.summary(), busy: watcher.brain.busy }),
    send: (text) => watcher.chat(text),
  });
}

/** AI 설정 창 (처음 켤 때 자동으로 뜸) */
function showSetup(view: "settings" | "guide" = "settings"): void {
  openSetup({
    brain: watcher.brain,
    claude: watcher.claude,
    codex: watcher.codex,
    apply: () => {
      watcher.brain.reload();
      sendCharacter();
      registerChatHotkey();
      void watcher.brain.whenReady().then(() => {
        const b = watcher.brain;
        state.say(b.enabled ? `${b.engine === "codex" ? "Codex" : "Claude Code"}랑 연결됐어!` : (b.lastError ?? "AI 없이 지낼게…"), "surprised", 5, true, undefined, true);
      });
    },
  }, view);
}

async function chooseAgentDir(): Promise<void> {
  const r = await dialog.showOpenDialog({
    title: "모찌가 일할 폴더",
    defaultPath: watcher.brain.cwd,
    properties: ["openDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return;
  watcher.brain.saveConfig("agent_dir", r.filePaths[0]);
  watcher.brain.reload();  // 같은 세션으로 이어가되 새 폴더를 쓸 수 있게 다시 연다
  sendCharacter();
  state.say(`이제 ${path.basename(r.filePaths[0])} 폴더에서 일할게!`, "happy", 4, true);
}

let dragOffset: { x: number; y: number } | null = null;

ipcMain.on("chat", (_e, text: string) => watcher.chat(String(text)));
ipcMain.on("answer", (_e, choice: Approval) => state.answer(["yes", "all", "always"].includes(choice) ? choice : "no"));
ipcMain.on("chat-opened", () => { state.clearMessage(); state.roamer?.hold("chat", true); win?.focus(); });
ipcMain.on("open-history", () => showChatWindow());
ipcMain.on("chat-closed", () => {
  state.roamer?.hold("chat", false);
  returnFocus();
});

/** 입력창을 닫으면 쓰던 앱으로 키보드를 돌려준다 (펫이 앞에 있을 때만, 맥은 번들 ID로 다시 앞으로) */
function returnFocus(): void {
  const prev = state.lastApp;
  if (!prev || !win || win.isDestroyed() || !win.isFocused()) return;
  if (process.platform === "darwin" && prev.id) {
    execFile("open", ["-b", prev.id], () => { /* 못 찾으면 그냥 둠 */ });
  } else {
    win.blur();  // 윈도우: 포커스를 놓으면 직전 창으로 돌아감
  }
}
ipcMain.on("menu", () => showMenu());
ipcMain.on("ignore-mouse", (_e, ignore: boolean) => {
  win?.setIgnoreMouseEvents(!!ignore, { forward: true });
  state.roamer?.hold("hover", !ignore);  // 클릭하려는데 도망가지 않게
});
ipcMain.on("drag-start", () => {
  if (!win) return;
  state.roamer?.hold("drag", true);
  const c = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragOffset = { x: c.x - x, y: c.y - y };
});
ipcMain.on("drag-move", () => {
  if (!win || !dragOffset) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(Math.round(c.x - dragOffset.x), Math.round(c.y - dragOffset.y));
});
ipcMain.on("drag-end", () => {
  state.roamer?.hold("drag", false);
  dragOffset = null;
  state.say("여기 좋다~", "happy", 2);
});

app.whenReady().then(() => {
  // 화면이 잠기면 자리 비움으로 (AI 반응·먼저 말 걸기·돌아다니기 멈춤), 풀리면 다음 tick에서 복귀 (powerMonitor는 ready 뒤에만 씀)
  powerMonitor.on("lock-screen", () => { state.locked = true; });
  powerMonitor.on("unlock-screen", () => { state.locked = false; });
  powerMonitor.on("suspend", () => { state.locked = true; });
  powerMonitor.on("resume", () => { state.locked = false; });
  if (process.platform === "darwin") app.dock?.hide();
  watcher = new Watcher(state);
  win = createWindow();
  state.roamer = new Roamer(win, (w) => send("walk", w));
  state.onTranscript = updateChatWindow;
  registerChatHotkey();
  win.webContents.once("did-finish-load", () => void watcher.greet());
  if (process.argv.includes("--studio")) showStudio();  // 개발용: 켜자마자 스튜디오 열기
  if (needsSetup(watcher.brain) || process.argv.includes("--setup")) showSetup();  // 처음 켤 때 AI 고르기
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("before-quit", () => {
  watcher?.brain.shutdown();
});
