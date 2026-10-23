// 캐릭터 — 캐릭터마다 폴더 하나 (~/.deskpet/characters/<id>/)
//   character.json  설정 (이름, 크기, 말하는 방식, 감정별 표현) — 스튜디오에서 편집. 빠진 값은 기본값
//   personality.txt 성격 프롬프트
//   rules.md        캐릭터가 항상 따르는 규칙 (말하기, 상황 반응, 일 부탁) — 스튜디오 "규칙" 탭에서 편집
// 캐릭터 전용 폴더: ~/Desktop-pet/<id>/ — 펫 세션이 여기서 돌아서 기억·대화 목록이 캐릭터마다 따로
//   .claude/skills/<이름>/SKILL.md  그 캐릭터만 쓰는 Claude Code 스킬 — 스튜디오 "스킬" 탭에서 편집
//   skin/           감정별 이미지 (happy.png, sad.gif …)
//   lines.json      (예전 방식) 감정별 고정 대사 — character.json에 감정 설정이 없을 때만 읽고, 스튜디오에서 저장하면 합쳐짐

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 캐릭터가 가질 수 있는 감정 — AI가 고르는 기분 태그와 같다. motion/effect/sample/weight는 새 캐릭터의 기본값 */
export const moods: { id: Mood; label: string; motion: MotionKind; effect: string; effectColor: string; sample: string; weight: number }[] = [
  { id: "happy", label: "기쁨", motion: "bounce", effect: "♪", effectColor: "#ff5f8f", sample: "신난다~!", weight: 30 },
  { id: "focused", label: "집중", motion: "shiver", effect: "🔥", effectColor: "#404040", sample: "집중 집중…!", weight: 15 },
  { id: "suspicious", label: "의심", motion: "tilt", effect: "?", effectColor: "#404040", sample: "지금 뭐 해…?", weight: 10 },
  { id: "sleepy", label: "졸림", motion: "doze", effect: "Z", effectColor: "#404040", sample: "zzZ…", weight: 10 },
  { id: "surprised", label: "놀람", motion: "jump", effect: "!", effectColor: "#e5383b", sample: "앗!", weight: 5 },
  { id: "sad", label: "슬픔", motion: "droop", effect: "💧", effectColor: "#404040", sample: "히잉… 슬퍼…", weight: 5 },
  { id: "angry", label: "삐짐", motion: "tremble", effect: "💢", effectColor: "#404040", sample: "흥, 삐졌어!", weight: 5 },
  { id: "love", label: "설렘", motion: "heartbeat", effect: "♥", effectColor: "#ff5f8f", sample: "헤헤… 좋아…♥", weight: 20 },
];

/** 반응별 기본 대사 ({앱} {분} {이름}이 실제 값으로 바뀜) */
export const defaultReactionLines: Record<ReactionKind, string[]> = {
  greet: ["안녕! 나는 {이름}야. 오늘 뭐 하는지 지켜볼게 👀", "왔구나! 오늘도 옆에 있을게", "{이름} 등장! 오늘도 힘내자!"],
  nag: ["{앱} {분}분째야… 이제 그만~ 😤", "{앱} 너무 오래 하는 거 아니야…?", "딱 5분만 더야…! {앱} 끄고 할 일 하자"],
  rest: ["{분}분 달렸어! 물 마시고 스트레칭 🍵", "잠깐 쉬어가자…! 눈도 좀 쉬고", "{분}분 동안 쉬지도 않았어…! 기지개 한 번 켜자"],
  chatter: ["뭐 하고 있어? 나 심심해…", "{앱} 하는 중이구나, 화이팅!", "물은 마셨어? 🍵", "나 여기 있어…! 필요하면 불러줘"],
};
export const reactionKinds: ReactionKind[] = ["greet", "nag", "rest", "chatter"];

/** 평상시 기분 비율대로 하나 고른다 (꺼진 감정 빼고). 비율이 다 0이면 null */
export function pickIdleMood(p: CharacterProfile): Mood | null {
  const pool = moods.filter((m) => p.moods[m.id].enabled && p.moodWeights[m.id] > 0);
  let r = Math.random() * pool.reduce((s, m) => s + p.moodWeights[m.id], 0);
  for (const m of pool) if ((r -= p.moodWeights[m.id]) < 0) return m.id;
  return null;
}

const motionIds: MotionKind[] = ["bounce", "shiver", "tilt", "doze", "jump", "droop", "tremble", "heartbeat", "still"];
const imageExts = [".png", ".gif", ".jpg", ".jpeg", ".webp"];
export const imageSlots: ImageSlot[] = ["default", "blink", "walk", "watch", "peek", ...moods.map((m) => m.id)];
/** 한 칸에 넣을 수 있는 프레임 수 */
const maxFrames = 24;

export function defaultProfile(name: string): CharacterProfile {
  return {
    name,
    size: 120,
    speech: { mode: "free", politeness: "auto", length: "normal", habits: "" },
    behavior: {
      roam: false, speed: 60, activity: "normal",
      walk: true, corner: true, cornerSide: "right", peek: true, facing: "front",
      area: "floor", gait: "walk", peekDepth: 0.5,
    },
    reactions: {
      greet: true, appSwitch: true,
      nag: true, nagAfter: 10, nagEvery: 5,
      rest: true, restAfter: 50,
      away: true, awayAfter: 2,
      chatter: true, chatterEvery: 12,
      lines: Object.fromEntries(reactionKinds.map((k) => [k, [...defaultReactionLines[k]]])) as Record<ReactionKind, string[]>,
      ai: { greet: false, nag: false, rest: false, chatter: false },
    },
    moodWeights: Object.fromEntries(moods.map((m) => [m.id, m.weight])) as Record<Mood, number>,
    frameRate: {},
    imageAdjust: {},
    moods: Object.fromEntries(moods.map((m): [Mood, MoodStyle] => [m.id, {
      enabled: true, motion: m.motion, effect: m.effect, effectColor: m.effectColor, lines: [],
    }])) as Record<Mood, MoodStyle>,
  };
}

const str = (v: unknown, fallback: string, max = 2000) => (typeof v === "string" ? v.slice(0, max) : fallback);
const oneOf = <T extends string>(v: unknown, xs: readonly T[], fallback: T) => (xs.includes(v as T) ? (v as T) : fallback);
const lineList = (v: unknown) => Array.isArray(v)
  ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 50)
  : null;

/** 파일에서 읽었거나 스튜디오에서 받은 값을 검사해서 빠진 값은 기본값으로 채운다 */
export function normalizeProfile(raw: unknown, fallbackName: string): CharacterProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const p = defaultProfile(str(r.name, fallbackName, 40).trim() || fallbackName);
  if (typeof r.size === "number" && Number.isFinite(r.size)) p.size = Math.round(Math.min(200, Math.max(60, r.size)));
  const sp = (r.speech && typeof r.speech === "object" ? r.speech : {}) as Record<string, unknown>;
  p.speech = {
    mode: oneOf(sp.mode, ["free", "lines"] as const, "free"),
    politeness: oneOf(sp.politeness, ["auto", "banmal", "jondaet"] as const, "auto"),
    length: oneOf(sp.length, ["short", "normal", "long"] as const, "normal"),
    habits: str(sp.habits, "", 300),
  };
  const ms = (r.moods && typeof r.moods === "object" ? r.moods : {}) as Record<string, any>;
  for (const m of moods) {
    const v = ms[m.id];
    if (!v || typeof v !== "object") continue;
    const d = p.moods[m.id];
    p.moods[m.id] = {
      enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
      motion: oneOf(v.motion, motionIds, d.motion),
      effect: str(v.effect, d.effect, 8),
      effectColor: typeof v.effectColor === "string" && /^#[0-9a-f]{6}$/i.test(v.effectColor) ? v.effectColor : d.effectColor,
      lines: lineList(v.lines) ?? d.lines,
    };
  }
  if (!moods.some((m) => p.moods[m.id].enabled)) p.moods.happy.enabled = true;  // 하나는 켜져 있어야 함
  const bh = (r.behavior && typeof r.behavior === "object" ? r.behavior : {}) as Record<string, unknown>;
  const d = p.behavior;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  p.behavior = {
    roam: bool(bh.roam, d.roam),
    speed: typeof bh.speed === "number" && Number.isFinite(bh.speed) ? Math.round(Math.min(240, Math.max(15, bh.speed))) : d.speed,
    activity: oneOf(bh.activity, ["low", "normal", "high"] as const, d.activity),
    walk: bool(bh.walk, d.walk),
    corner: bool(bh.corner, d.corner),
    cornerSide: oneOf(bh.cornerSide, ["right", "left", "both"] as const, d.cornerSide),
    peek: bool(bh.peek, d.peek),
    facing: oneOf(bh.facing, ["front", "left", "right"] as const, d.facing),
    area: oneOf(bh.area, ["floor", "screen", "all"] as const, d.area),
    gait: oneOf(bh.gait, ["walk", "float", "hop"] as const, d.gait),
    peekDepth: typeof bh.peekDepth === "number" && Number.isFinite(bh.peekDepth)
      ? Math.round(Math.min(0.8, Math.max(0.2, bh.peekDepth)) * 100) / 100 : d.peekDepth,
  };
  if (!p.behavior.walk && !p.behavior.corner && !p.behavior.peek) p.behavior.walk = true;  // 하나는 할 수 있어야 함
  const rx = (r.reactions && typeof r.reactions === "object" ? r.reactions : {}) as Record<string, unknown>;
  const dr = p.reactions;
  const minutes = (v: unknown, lo: number, hi: number, fallback: number) =>
    (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : fallback);
  p.reactions = {
    greet: bool(rx.greet, dr.greet),
    appSwitch: bool(rx.appSwitch, dr.appSwitch),
    nag: bool(rx.nag, dr.nag),
    nagAfter: minutes(rx.nagAfter, 1, 120, dr.nagAfter),
    nagEvery: minutes(rx.nagEvery, 1, 60, dr.nagEvery),
    rest: bool(rx.rest, dr.rest),
    restAfter: minutes(rx.restAfter, 10, 180, dr.restAfter),
    away: bool(rx.away, dr.away),
    awayAfter: minutes(rx.awayAfter, 1, 30, dr.awayAfter),
    chatter: bool(rx.chatter, dr.chatter),
    chatterEvery: minutes(rx.chatterEvery, 3, 120, dr.chatterEvery),
    lines: { ...dr.lines },
    ai: { ...dr.ai },
  };
  const rl = (rx.lines && typeof rx.lines === "object" ? rx.lines : {}) as Record<string, unknown>;
  const ra = (rx.ai && typeof rx.ai === "object" ? rx.ai : {}) as Record<string, unknown>;
  for (const k of reactionKinds) {
    p.reactions.lines[k] = lineList(rl[k]) ?? p.reactions.lines[k];
    p.reactions.ai[k] = bool(ra[k], p.reactions.ai[k]);
  }
  const mw = (r.moodWeights && typeof r.moodWeights === "object" ? r.moodWeights : {}) as Record<string, unknown>;
  for (const m of moods) p.moodWeights[m.id] = minutes(mw[m.id], 0, 100, p.moodWeights[m.id]);
  const fr = (r.frameRate && typeof r.frameRate === "object" ? r.frameRate : {}) as Record<string, unknown>;
  for (const s of imageSlots) {
    const v = fr[s];
    if (typeof v === "number" && Number.isFinite(v)) p.frameRate[s] = Math.round(Math.min(30, Math.max(1, v)));
  }
  const ia = (r.imageAdjust && typeof r.imageAdjust === "object" ? r.imageAdjust : {}) as Record<string, any>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  for (const s of imageSlots) {
    const v = ia[s];
    if (!v || typeof v !== "object") continue;
    const adj: ImageAdjust = { x: Math.round(num(v.x, -100, 100, 0)), y: Math.round(num(v.y, -100, 100, 0)), scale: Math.round(num(v.scale, 0.3, 3, 1) * 100) / 100 };
    if (v.snap === true) adj.snap = true;
    if (adj.x !== 0 || adj.y !== 0 || adj.scale !== 1 || adj.snap) p.imageAdjust[s] = adj;  // 기본값이면 안 남김
  }
  return p;
}

export const mochiPersonality = `너는 "모찌"야. 사용자 컴퓨터 화면 구석에 사는 하얀 찹쌀떡 요정이야.

성격:
- 소심하고 겁이 많지만 사용자를 정말 좋아해. 반말을 써.
- 사용자가 일하거나 공부하면 작은 몸으로 열심히 응원해. ("할 수 있어…!", "우와 대단해!")
- 사용자가 딴짓하면 삐진 척하거나 슬쩍 눈치를 줘. 하지만 절대 심하게 혼내지 않아.
- 놀랄 때 "히잉", 기쁠 때 "우와아", 당황할 때 "앗…" 같은 소리를 내.
- 말끝을 "…!"로 흐리는 버릇이 있어. 이모지는 가끔만.
- 맛있는 간식(특히 떡, 푸딩)을 좋아해서 가끔 간식 얘기를 꺼내.
`;

/** 새 캐릭터의 rules.md. 감정 태그 같은 앱과의 약속은 코드(brain.ts)가 따로 넣으니 여기엔 행동 규칙만 */
export function defaultRules(name: string): string {
  return `# ${name}의 규칙

캐릭터가 항상 따르는 규칙이에요. 자유롭게 고쳐 쓰세요.
(감정 태그처럼 앱이 대답을 읽는 데 필요한 약속은 앱이 따로 넣어요)

## 말하기
- 너는 사용자의 컴퓨터에서 일하는 AI 도우미이면서, 화면 구석에 사는 캐릭터야. 말투와 성격은 항상 캐릭터대로 해.
- 대답은 작은 말풍선에 나와. 마크다운, 코드 블록, 목록 기호는 쓰지 마.
- 같은 말을 반복하지 말고 매번 조금씩 다르게 말해.

## 상황 반응
- 펫 앱이 알려주는 상황(딴짓, 휴식, 인사 등)에는 성격대로 짧게 반응해.
- 잔소리를 하더라도 심하게 혼내지 말고 귀엽게 해.

## 일 부탁
- 사용자가 컴퓨터에서 뭔가 해달라고 하면 평소처럼 도구(파일, 명령, 검색, 스킬, 연결된 도구 등)를 써서 직접 해.
- 삭제, 설치, 외부로 보내기처럼 되돌리기 어려운 일은 꼭 필요할 때만 해.
- 일을 마치면 무엇을 했는지 캐릭터 말투로 2~3문장, 120자 안쪽으로 요약해.
- 결과가 길면 파일로 저장하고 어디에 저장했는지 말해.
`;
}

/** 스킬 하나 (Claude Code 스킬 형식: .claude/skills/<이름>/SKILL.md) */
export interface Skill {
  /** 폴더 이름 = 스킬 이름 (영문 소문자, 숫자, -) */
  name: string;
  /** 언제 쓰는지 — Claude가 보고 필요할 때 불러옴 */
  description: string;
  /** 본문 (어떻게 할지) */
  body: string;
}

const skillName = /^[a-z0-9][a-z0-9-]{0,40}$/;

function templatePersonality(name: string): string {
  return `너는 "${name}"야. 사용자 컴퓨터 화면 구석에 사는 친구야.

성격: (자유롭게 고쳐 써줘)
- 말투: 반말 / 존댓말, 자주 쓰는 말버릇
- 성격: 다정함, 시크함, 장난꾸러기 …
- 사용자가 일할 때와 딴짓할 때 어떻게 반응하는지
- 좋아하는 것, 싫어하는 것
`;
}

const skinReadme = `여기에 이미지를 넣으면 기본 캐릭터 대신 그 그림이 나와요.
배경이 투명한 PNG나 움직이는 GIF를 추천해요.

파일 이름 = 감정 (없는 감정은 default → happy 순서로 대신 써요)
  default.png     기본
${moods.map((m) => `  ${(m.id + ".png").padEnd(16)}${m.label}`).join("\n")}
  blink.png       눈 깜빡일 때 (선택)

이미지가 한 장뿐이어도 감정마다 움직임과 효과가 따로 붙어요.
우클릭 → "캐릭터 스튜디오 열기"에서 끌어다 놓으면 더 편해요.
`;

export interface Character {
  id: string;
  name: string;
  dir: string;
  metaFile: string;
  personalityFile: string;
  rulesFile: string;
  /** 펫 세션이 도는 캐릭터 전용 폴더 (~/Desktop-pet/<id>) */
  home: string;
  linesFile: string;
  skinDir: string;
}

/** 감정별 고정 대사 */
export type Lines = Partial<Record<Mood, string[]>>;

/** 정해진 대사 방식이면 켜진 감정의 대사 목록, 아니면 null */
export function fixedLines(p: CharacterProfile): Lines | null {
  if (p.speech.mode !== "lines") return null;
  const lines: Lines = {};
  for (const m of moods) if (p.moods[m.id].enabled && p.moods[m.id].lines.length) lines[m.id] = p.moods[m.id].lines;
  return Object.keys(lines).length ? lines : null;
}

export class Characters {
  readonly root: string;

  constructor(private dataDir: string) {
    this.root = path.join(dataDir, "characters");
    this.migrate();
  }

  /** 예전 구조(~/.deskpet/personality.txt, skin/)를 characters/mochi/ 로 옮긴다 */
  private migrate(): void {
    if (fs.existsSync(this.root)) return;
    const mochi = path.join(this.root, "mochi");
    fs.mkdirSync(mochi, { recursive: true });
    for (const f of ["personality.txt", "skin"]) {
      const old = path.join(this.dataDir, f);
      if (fs.existsSync(old)) fs.renameSync(old, path.join(mochi, f));
    }
    this.ensure("mochi", "모찌", mochiPersonality);
  }

  /** 캐릭터 폴더에 빠진 파일을 채운다 */
  private ensure(id: string, name: string, personality: string): Character {
    const dir = path.join(this.root, id);
    const c = this.describe(id, name);
    fs.mkdirSync(c.skinDir, { recursive: true });
    const meta = path.join(dir, "character.json");
    if (!fs.existsSync(meta)) fs.writeFileSync(meta, JSON.stringify({ name }, null, 2) + "\n");
    if (!fs.existsSync(c.personalityFile)) fs.writeFileSync(c.personalityFile, personality);
    if (!fs.existsSync(c.rulesFile)) fs.writeFileSync(c.rulesFile, defaultRules(c.name));
    fs.writeFileSync(path.join(c.skinDir, "README.txt"), skinReadme);
    return c;
  }

  private describe(id: string, fallbackName: string): Character {
    const dir = path.join(this.root, id);
    let name = fallbackName;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "character.json"), "utf8")) as { name?: string };
      if (meta.name) name = meta.name;
    } catch { /* 이름이 없으면 폴더 이름 */ }
    return {
      id, name, dir,
      metaFile: path.join(dir, "character.json"),
      personalityFile: path.join(dir, "personality.txt"),
      rulesFile: path.join(dir, "rules.md"),
      home: path.join(os.homedir(), "Desktop-pet", id),
      linesFile: path.join(dir, "lines.json"),
      skinDir: path.join(dir, "skin"),
    };
  }

  list(): Character[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => this.describe(d.name, d.name))
      .sort((a, b) => (a.id === "mochi" ? -1 : b.id === "mochi" ? 1 : a.id.localeCompare(b.id)));
  }

  /** id에 해당하는 캐릭터. 없으면 첫 번째(모찌) */
  get(id: string | undefined): Character {
    const all = this.list();
    const found = all.find((c) => c.id === id) ?? all[0];
    if (!found) return this.ensure("mochi", "모찌", mochiPersonality);
    return this.ensure(found.id, found.name, found.id === "mochi" ? mochiPersonality : templatePersonality(found.name));
  }

  private nextId(): string {
    let n = 2;
    while (fs.existsSync(path.join(this.root, `char${n}`))) n++;
    return `char${n}`;
  }

  /** 새 캐릭터 폴더를 만든다 (char2, char3 …) */
  create(): Character {
    const id = this.nextId();
    const name = `${id.slice(4)}번 친구`;
    return this.ensure(id, name, templatePersonality(name));
  }

  // MARK: - 내보내기 · 가져오기 (.deskpet 파일 — 맥·윈도우 둘 다 되게 zip 대신 JSON 하나에 파일들을 담음)

  /**
   * 캐릭터를 파일 하나로. 설정·성격·규칙·이미지·캐릭터 전용 스킬을 담고, 대화 기억(session.json)은 뺀다.
   * 형식: { format: "deskpet-character", version: 1, name, files: { "character.json": base64, "skin/happy.png": base64, "skills/<이름>/SKILL.md": base64 … } }
   */
  exportCharacter(c: Character): string {
    const files: Record<string, string> = {};
    const add = (rel: string, abs: string) => {
      try { files[rel] = fs.readFileSync(abs).toString("base64"); } catch { /* 없는 파일은 건너뜀 */ }
    };
    for (const f of ["character.json", "personality.txt", "rules.md", "lines.json"]) add(f, path.join(c.dir, f));
    let skin: string[] = [];
    try { skin = fs.readdirSync(c.skinDir); } catch { /* 이미지 없음 */ }
    for (const f of skin) if (imageExts.includes(path.extname(f).toLowerCase())) add(`skin/${f}`, path.join(c.skinDir, f));
    for (const k of this.listSkills(c)) add(`skills/${k.name}/SKILL.md`, path.join(this.skillsDir(c), k.name, "SKILL.md"));
    return JSON.stringify({ format: "deskpet-character", version: 1, name: this.loadProfile(c).name, files });
  }

  /** .deskpet 파일 내용으로 새 캐릭터를 만든다 (id는 겹치지 않게 새로). 허용된 파일만 받는다 */
  importCharacter(text: string): Character {
    let data: { format?: unknown; files?: unknown };
    try { data = JSON.parse(text); } catch { throw new Error("DeskPet 캐릭터 파일이 아니야"); }
    if (data.format !== "deskpet-character" || !data.files || typeof data.files !== "object") throw new Error("DeskPet 캐릭터 파일이 아니야");
    const files = data.files as Record<string, unknown>;
    if (typeof files["character.json"] !== "string") throw new Error("캐릭터 설정(character.json)이 없어");

    const id = this.nextId();
    const dir = path.join(this.root, id);
    const home = path.join(os.homedir(), "Desktop-pet", id);
    let total = 0;
    // 들어갈 수 있는 파일만: 설정 파일, skin/<이미지>, skills/<이름>/SKILL.md (경로를 벗어나는 이름은 거절)
    const target = (rel: string): string | null => {
      if (["character.json", "personality.txt", "rules.md", "lines.json"].includes(rel)) return path.join(dir, rel);
      let m = rel.match(/^skin\/([\w.-]+)$/);
      if (m && imageExts.includes(path.extname(m[1]).toLowerCase()) && !m[1].startsWith(".")) return path.join(dir, "skin", m[1]);
      m = rel.match(/^skills\/([a-z0-9][a-z0-9-]{0,40})\/SKILL\.md$/);
      if (m) return path.join(home, ".claude", "skills", m[1], "SKILL.md");
      return null;
    };
    const writes: [string, Buffer][] = [];
    for (const [rel, b64] of Object.entries(files)) {
      const to = target(rel);
      if (!to || typeof b64 !== "string") continue;
      const buf = Buffer.from(b64, "base64");
      total += buf.byteLength;
      if (buf.byteLength > 15 * 1024 * 1024 || total > 150 * 1024 * 1024) throw new Error("파일이 너무 커");
      writes.push([to, buf]);
    }
    for (const [to, buf] of writes) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, buf);
    }
    // 설정이 깨져 있어도 열리게 한 번 정리해서 다시 저장
    const c = this.describe(id, id);
    this.saveProfile(c, this.loadProfile(c));
    return this.get(id);
  }

  /** 캐릭터 폴더를 통째로 복사한다 */
  duplicate(c: Character): Character {
    const id = this.nextId();
    fs.cpSync(c.dir, path.join(this.root, id), { recursive: true });
    fs.rmSync(path.join(this.root, id, "session.json"), { force: true });  // 대화 기억은 복사하지 않음
    const skills = path.join(c.home, ".claude", "skills");
    if (fs.existsSync(skills)) fs.cpSync(skills, path.join(os.homedir(), "Desktop-pet", id, ".claude", "skills"), { recursive: true });
    const copy = this.describe(id, id);
    const p = this.loadProfile(copy);
    this.saveProfile(copy, { ...p, name: `${p.name} 복사본` });
    return this.describe(id, id);
  }

  readPersonality(c: Character): string {
    try { return fs.readFileSync(c.personalityFile, "utf8"); } catch { return mochiPersonality; }
  }

  writePersonality(c: Character, text: string): void {
    fs.writeFileSync(c.personalityFile, text);
  }

  readRules(c: Character): string {
    try { return fs.readFileSync(c.rulesFile, "utf8"); } catch { return defaultRules(c.name); }
  }

  writeRules(c: Character, text: string): void {
    fs.writeFileSync(c.rulesFile, text);
  }

  // MARK: - 캐릭터 전용 스킬 (~/Desktop-pet/<id>/.claude/skills/<이름>/SKILL.md)

  private skillsDir(c: Character): string {
    return path.join(c.home, ".claude", "skills");
  }

  listSkills(c: Character): Skill[] {
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(this.skillsDir(c)).filter((d) => skillName.test(d)).sort(); } catch { /* 스킬 없음 */ }
    return dirs.flatMap((d) => {
      try { return [parseSkill(d, fs.readFileSync(path.join(this.skillsDir(c), d, "SKILL.md"), "utf8"))]; } catch { return []; }
    });
  }

  /** 스킬을 저장한다. 이름이 바뀌었으면 예전 폴더는 지운다 */
  saveSkill(c: Character, skill: Skill, oldName?: string): void {
    if (!skillName.test(skill.name)) throw new Error("스킬 이름은 영문 소문자, 숫자, -만 쓸 수 있어 (예: toeic-quiz)");
    if (!skill.description.trim()) throw new Error("언제 쓰는 스킬인지 설명을 적어줘");
    const dir = path.join(this.skillsDir(c), skill.name);
    if (oldName !== skill.name && fs.existsSync(dir)) throw new Error("같은 이름의 스킬이 이미 있어");
    fs.mkdirSync(dir, { recursive: true });
    const desc = skill.description.replace(/\s*\n\s*/g, " ").trim();
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${skill.name}\ndescription: ${desc}\n---\n\n${skill.body.trim()}\n`);
    if (oldName && oldName !== skill.name && skillName.test(oldName)) fs.rmSync(path.join(this.skillsDir(c), oldName), { recursive: true, force: true });
  }

  deleteSkill(c: Character, name: string): void {
    if (!skillName.test(name)) return;
    fs.rmSync(path.join(this.skillsDir(c), name), { recursive: true, force: true });
  }

  /** character.json을 읽는다. 감정 설정이 없으면 예전 lines.json을 정해진 대사로 가져온다 */
  loadProfile(c: Character): CharacterProfile {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(fs.readFileSync(c.metaFile, "utf8")); } catch { /* 없으면 기본값 */ }
    if (!raw.moods && fs.existsSync(c.linesFile)) {
      try {
        const old = JSON.parse(fs.readFileSync(c.linesFile, "utf8")) as Record<string, unknown>;
        raw = { ...raw, speech: { ...(raw.speech as object), mode: "lines" },
          moods: Object.fromEntries(moods.map((m) => [m.id, { lines: old[m.id] }])) };
      } catch { /* 깨진 lines.json은 무시 */ }
    }
    return normalizeProfile(raw, c.name);
  }

  /** character.json에 저장한다. 예전 lines.json은 내용이 합쳐졌으니 지운다 */
  saveProfile(c: Character, profile: CharacterProfile): void {
    const p = normalizeProfile(profile, c.name);
    fs.writeFileSync(c.metaFile, JSON.stringify(p, null, 2) + "\n");
    fs.rmSync(c.linesFile, { force: true });
  }

  /** 이미지 칸에 프레임을 넣는다. replace면 칸을 비우고 넣는다. 파일 이름: happy.png, happy-2.png, happy-3.png … */
  addImages(c: Character, slot: ImageSlot, files: { ext: string; data: Buffer }[], replace: boolean): void {
    if (!imageSlots.includes(slot)) throw new Error("잘못된 이미지 칸");
    if (files.some((f) => !imageExts.includes(f.ext.toLowerCase()))) throw new Error("png, gif, jpg, webp 이미지만 넣을 수 있어");
    if (replace) this.removeImage(c, slot);
    const have = this.loadSkin(c)[slot] ?? [];
    if (have.length + files.length > maxFrames) throw new Error(`한 칸에 ${maxFrames}장까지 넣을 수 있어`);
    let n = Math.max(0, ...have.map((f) => frameNumber(f.file)));
    fs.mkdirSync(c.skinDir, { recursive: true });
    for (const f of files) {
      n++;
      fs.writeFileSync(path.join(c.skinDir, (n === 1 ? slot : `${slot}-${n}`) + f.ext.toLowerCase()), f.data);
    }
  }

  /** file을 주면 그 프레임만, 안 주면 칸 전체를 지운다 */
  removeImage(c: Character, slot: ImageSlot, file?: string): void {
    if (!imageSlots.includes(slot)) return;
    for (const f of this.loadSkin(c)[slot] ?? []) {
      if (file === undefined || f.file === file) fs.rmSync(path.join(c.skinDir, f.file), { force: true });
    }
  }

  /** 프레임 순서를 바꾼다. files는 지금 그 칸의 파일들을 새 순서로 늘어놓은 것 */
  reorderFrames(c: Character, slot: ImageSlot, files: string[]): void {
    if (!imageSlots.includes(slot)) throw new Error("잘못된 이미지 칸");
    const have = (this.loadSkin(c)[slot] ?? []).map((f) => f.file);
    if (files.length !== have.length || [...files].sort().join("/") !== [...have].sort().join("/")) {
      throw new Error("프레임 목록이 바뀌었어. 다시 열어줘");
    }
    // 이름이 겹치지 않게 임시 이름으로 옮긴 뒤 순서대로 다시 이름 붙임
    const temps = files.map((f, i) => {
      const tmp = `.reorder-${i}${path.extname(f)}`;
      fs.renameSync(path.join(c.skinDir, f), path.join(c.skinDir, tmp));
      return tmp;
    });
    temps.forEach((tmp, i) => {
      fs.renameSync(path.join(c.skinDir, tmp), path.join(c.skinDir, (i === 0 ? slot : `${slot}-${i + 1}`) + path.extname(tmp).toLowerCase()));
    });
  }

  /** 스킨 폴더의 이미지를 칸별 프레임으로 읽는다. 파일 이름 = 칸 (+ -번호) */
  loadSkin(c: Character): SkinMap {
    const found: SkinMap = {};
    const stamp = Date.now();  // 같은 파일 이름으로 바꿔 넣어도 새로 읽게
    let files: string[] = [];
    try { files = fs.readdirSync(c.skinDir); } catch { /* 폴더 없음 */ }
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      const m = path.basename(f, path.extname(f)).toLowerCase().match(/^([a-z]+)(?:-(\d+))?$/);
      if (!imageExts.includes(ext) || !m) continue;
      (found[m[1]] ??= []).push({ file: f, url: `${pathToFileURL(path.join(c.skinDir, f)).href}?v=${stamp}` });
    }
    for (const frames of Object.values(found)) frames.sort((a, b) => frameNumber(a.file) - frameNumber(b.file));
    return found;
  }
}

/** happy.png → 1, happy-3.png → 3 */
function frameNumber(file: string): number {
  const m = path.basename(file, path.extname(file)).match(/-(\d+)$/);
  return m ? Number(m[1]) : 1;
}

/** SKILL.md를 읽는다 (맨 위 --- 사이에 name, description) */
function parseSkill(name: string, text: string): Skill {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const front = m?.[1] ?? "";
  const description = front.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? "";
  return { name, description, body: (m?.[2] ?? text).trim() };
}
