// 메인 프로세스와 화면(렌더러)이 같이 쓰는 타입. 전역 선언이라 import 없이 쓴다.

/** 대화·일 시키기에 쓰는 AI */
type Engine = "claude" | "codex";

type Mood = "happy" | "focused" | "suspicious" | "sleepy" | "surprised" | "sad" | "angry" | "love";

/** 감정을 몸으로 표현하는 움직임 (이미지 한 장을 움직여서 표현) */
type MotionKind = "bounce" | "shiver" | "tilt" | "doze" | "jump" | "droop" | "tremble" | "heartbeat" | "still";

/** 감정 하나를 어떻게 표현할지 */
interface MoodStyle {
  /** 끄면 AI가 이 감정을 고르지 않고, 이 감정이 필요할 때는 다른 켜진 감정으로 대신한다 */
  enabled: boolean;
  motion: MotionKind;
  /** 머리 위 효과 글자 (♪ 💢 등). 비우면 없음 */
  effect: string;
  effectColor: string;
  /** 이 감정일 때 하는 말. 자유 대화면 말투 예시, 정해진 대사 방식이면 여기서만 골라 말함 */
  lines: string[];
}

/** 말하는 방식 */
interface SpeechStyle {
  /** free: 성격대로 자유롭게 말함 / lines: 감정별 대사 목록에서만 골라 말함 (의성어 캐릭터 등) */
  mode: "free" | "lines";
  politeness: "auto" | "banmal" | "jondaet";
  length: "short" | "normal" | "long";
  /** 말버릇 (자유롭게) */
  habits: string;
}

/** 화면을 돌아다니는 방식 */
interface Behavior {
  /** 돌아다니기 (끄면 제자리에만 있음) */
  roam: boolean;
  /** 걷는 속도 (px/초) */
  speed: number;
  /** 얼마나 자주 움직이는지 */
  activity: "low" | "normal" | "high";
  /** 할 수 있는 행동: 산책 / 모서리에 가서 구경 / 화면 가장자리에서 빼꼼 */
  walk: boolean;
  corner: boolean;
  cornerSide: "right" | "left" | "both";
  peek: boolean;
  /** 돌아다니는 범위: 바닥에서만(좌우) / 지금 화면 전체 / 모든 모니터 */
  area: "floor" | "screen" | "all";
  /** 움직이는 모습: 걷기 / 둥실둥실 날기 / 깡총깡총 뛰기 */
  gait: "walk" | "float" | "hop";
  /** 빼꼼할 때 캐릭터가 화면 밖으로 숨는 정도 (0.2 ~ 0.8) */
  peekDepth: number;
  /** 그림 속 캐릭터가 보는 방향 — 걷는 방향과 반대면 좌우를 뒤집는다 (정면이면 안 뒤집음) */
  facing: "front" | "left" | "right";
}

/** 언제 반응할지 (시간은 분) */
interface Reactions {
  /** 처음 나타날 때 인사 */
  greet: boolean;
  /** 앱을 바꿀 때 한마디 (AI 안 씀) */
  appSwitch: boolean;
  /** 놀이 앱을 nagAfter분 넘게 쓰면 nagEvery분마다 잔소리 */
  nag: boolean;
  nagAfter: number;
  nagEvery: number;
  /** restAfter분 연속으로 쓰면 쉬라고 챙겨줌 */
  rest: boolean;
  restAfter: number;
  /** awayAfter분 동안 입력이 없으면 졸고, 돌아오면 반겨줌 */
  away: boolean;
  awayAfter: number;
  /** chatterEvery분마다 먼저 말 걸기 */
  chatter: boolean;
  chatterEvery: number;
  /** 반응별 정해진 대사 ({앱} {분} {이름}이 실제 값으로 바뀜). 비어 있으면 기본 대사 */
  lines: Record<ReactionKind, string[]>;
  /** 반응별로 AI가 그때그때 말하게 할지 (기본 꺼짐 — 정해진 대사만, 사용량 안 씀) */
  ai: Record<ReactionKind, boolean>;
}

/** 대사를 정해둘 수 있는 반응 */
type ReactionKind = "greet" | "nag" | "rest" | "chatter";

/** 이미지 칸별 위치·크기 조절 (그림 안에서 캐릭터가 한쪽에 치우쳐 있을 때). x·y는 캐릭터 크기의 %, scale은 배율 */
interface ImageAdjust {
  x: number;
  y: number;
  scale: number;
  /** 빼꼼 그림: "화면 끝에 맞추기"로 x를 정했으면 true (깊이·크기를 바꾸면 스튜디오가 x를 다시 계산) */
  snap?: boolean;
}

/** 캐릭터 설정 — ~/.deskpet/characters/<id>/character.json */
interface CharacterProfile {
  name: string;
  /** 화면에 보이는 캐릭터 크기 (px) */
  size: number;
  speech: SpeechStyle;
  moods: Record<Mood, MoodStyle>;
  behavior: Behavior;
  reactions: Reactions;
  /** 평상시 기분 비율 (감정마다 0~100, 합으로 나눠서 씀). 조용할 때 이 비율대로 기분이 바뀜 */
  moodWeights: Record<Mood, number>;
  /** 이미지 칸별 프레임 재생 속도 (초당 장 수). 없으면 기본값 */
  frameRate: Partial<Record<ImageSlot, number>>;
  /** 이미지 칸별 위치·크기 조절. 없으면 그대로 */
  imageAdjust: Partial<Record<ImageSlot, ImageAdjust>>;
}

/** 펫 화면에 보내는 겉모습 */
interface Look {
  skin: SkinMap;
  size: number;
  moods: Record<Mood, MoodStyle>;
  facing: Behavior["facing"];
  gait: Behavior["gait"];
  frameRate: Partial<Record<ImageSlot, number>>;
  imageAdjust: Partial<Record<ImageSlot, ImageAdjust>>;
}

/** 쉬는 동안의 자세: 그냥 쉼 / 모서리에서 구경 / 가장자리에서 빼꼼 */
type Pose = "rest" | "watch" | "peek";

/** 펫이 지금 걷고 있는지, 어느 쪽을 보는지 (-1 왼쪽, 1 오른쪽, 0 정면), 쉬는 자세 */
interface WalkState {
  walking: boolean;
  dir: -1 | 0 | 1;
  pose: Pose;
  /** 캐릭터가 창 아래(말풍선 위) / 창 위(말풍선 아래, 화면 위쪽에 있을 때) */
  layout: "bottom" | "top";
}

/** 화면에 그릴 펫 상태 */
interface PetViewState {
  /** 지금 캐릭터 이름 */
  name: string;
  message: string | null;
  mood: Mood;
  thinking: boolean;
  /** 에이전트가 승인을 기다리는 질문 (승인 버튼과 함께 표시) */
  ask: string | null;
  /** 에이전트가 지금 하는 일 한 줄 (작업 중일 때만) */
  working: string | null;
}

/** 대화 창에 보여줄 한 줄 */
interface TranscriptEntry {
  who: "me" | "pet";
  /** 화면에 나간 말 (정해진 대사 캐릭터면 소리) */
  text: string;
  /** AI가 실제로 한 말이 화면에 나간 말과 다르면 (정해진 대사 캐릭터의 소리 뒤 원래 문장) */
  ai?: string;
  mood?: Mood;
  at: number;
}

/** 대화 창 (chat.html) 통로 */
interface ChatBridge {
  state(): Promise<{ name: string; entries: TranscriptEntry[]; usage: string; busy: boolean }>;
  onUpdate(cb: (s: { name: string; entries: TranscriptEntry[]; usage: string; busy: boolean }) => void): void;
  send(text: string): void;
}

/** 승인 질문에 대한 답: 이것만 / 안 함 / 이번 일은 전부 허용 */
type Approval = "yes" | "no" | "all" | "always";

/** 이미지 한 장 (프레임 하나) */
interface SkinFrame {
  /** 스킨 폴더 안 파일 이름 (happy-2.png 등) */
  file: string;
  url: string;
}

/** 이미지 칸 이름 → 프레임들 (한 장이면 정지 이미지, 여러 장이면 애니메이션) */
type SkinMap = Record<string, SkinFrame[]>;

/** preload가 window.pet으로 열어주는 통로 */
interface PetBridge {
  onState(cb: (s: PetViewState) => void): void;
  onLook(cb: (look: Look) => void): void;
  onWalk(cb: (walk: WalkState) => void): void;
  onOpenChat(cb: () => void): void;
  /** 단축키: 입력창이 닫혀 있으면 열고, 열려 있으면 닫는다 */
  onToggleChat(cb: () => void): void;
  chat(text: string): void;
  answer(choice: Approval): void;
  chatOpened(): void;
  chatClosed(): void;
  /** 대화 창 열기 (긴 대답 전체 보기) */
  openHistory(): void;
  showMenu(): void;
  setIgnoreMouse(ignore: boolean): void;
  dragStart(): void;
  dragMove(): void;
  dragEnd(): void;
}

// MARK: - 스튜디오 (캐릭터 편집 창)

/** 이미지 칸: 기본(대기), 눈 감은 모습, 행동별(걷기·구경하기·빼꼼), 감정별 */
type ImageSlot = "default" | "blink" | "walk" | "watch" | "peek" | Mood;

interface StudioSummary {
  id: string;
  name: string;
  /** 지금 펫으로 쓰는 캐릭터인지 */
  active: boolean;
  thumb: string | null;
}

interface StudioCharacter {
  id: string;
  active: boolean;
  profile: CharacterProfile;
  personality: string;
  /** rules.md — 캐릭터가 항상 따르는 규칙 */
  rules: string;
  skin: SkinMap;
  /** 캐릭터 전용 폴더 (~/Desktop-pet/<id>) */
  home: string;
}

/** 캐릭터 전용 스킬 (~/Desktop-pet/<id>/.claude/skills/<name>/SKILL.md) */
interface StudioSkill {
  name: string;
  description: string;
  body: string;
}

interface StudioMeta {
  moods: { id: Mood; label: string; sample: string }[];
  /** 대화 테스트에서 넣어볼 수 있는 상황 (펫이 실제로 쓰는 문장) */
  situations: { label: string; text: string }[];
}

/** 대화 테스트 한 턴 */
interface TestTurn {
  user: string;
  pet: string;
}

interface TestReply {
  /** AI가 한 말 (정해진 대사 방식이면 화면에는 감정별 대사가 대신 나감) */
  line: string;
  mood: Mood | null;
  /** 일 부탁으로 알아들었으면 난이도 */
  task: "easy" | "hard" | null;
  /** 정해진 대사 캐릭터도 글자로 보여줄 정보 대답인지 ([글자]) */
  showText?: boolean;
  error: string | null;
}

interface StudioBridge {
  meta(): Promise<StudioMeta>;
  list(): Promise<StudioSummary[]>;
  load(id: string): Promise<StudioCharacter>;
  save(id: string, profile: CharacterProfile, personality: string, rules: string): Promise<void>;
  /** 새 캐릭터에 넣는 기본 규칙 */
  defaultRules(id: string): Promise<string>;
  skills(id: string): Promise<StudioSkill[]>;
  /** 스킬을 저장한다 (oldName이 있으면 그 스킬을 고친 것) */
  saveSkill(id: string, skill: StudioSkill, oldName: string | null): Promise<StudioSkill[]>;
  deleteSkill(id: string, name: string): Promise<StudioSkill[]>;
  openSkillsFolder(id: string): void;
  create(): Promise<string>;
  duplicate(id: string): Promise<string>;
  remove(id: string): Promise<boolean>;
  activate(id: string): Promise<void>;
  /** 이미지 파일을 그 칸에 넣는다. replace면 칸을 비우고 넣고, 아니면 뒤에 프레임으로 붙인다 */
  addImages(id: string, slot: ImageSlot, files: { name: string; data: ArrayBuffer }[], replace: boolean): Promise<SkinMap>;
  /** 파일 선택 창으로 이미지를 고른다 (여러 장 가능). 취소하면 null */
  pickImages(id: string, slot: ImageSlot, replace: boolean): Promise<SkinMap | null>;
  /** file을 주면 그 프레임만, 안 주면 칸 전체를 지운다 */
  removeImage(id: string, slot: ImageSlot, file?: string): Promise<SkinMap>;
  /** 프레임 순서를 바꾼다 (files = 새 순서의 파일 이름들) */
  reorderFrames(id: string, slot: ImageSlot, files: string[]): Promise<SkinMap>;
  /** 이미지에서 그림이 실제로 있는 범위 (투명한 부분 빼고). 0~1 비율. 못 읽으면 null */
  imageBounds(id: string, file: string): Promise<{ w: number; h: number; left: number; top: number; right: number; bottom: number } | null>;
  /** 저장 전 설정으로 말을 걸어본다 (펫의 대화 기억에는 안 남음) */
  testChat(profile: CharacterProfile, personality: string, rules: string, text: string, history: TestTurn[]): Promise<TestReply>;
  /** 바탕화면 펫이 이 감정과 대사를 보여준다 */
  showOnPet(mood: Mood, line: string): void;
  openFolder(id: string): void;
}

// MARK: - AI 설정 창 (처음 켤 때)

interface EngineStatus {
  installed: boolean;
  /** 로그인돼 있는지. 못 알아내면 null (Codex는 토큰이 만료돼도 true로 나올 수 있어서 연결 테스트로 확인) */
  loggedIn: boolean | null;
  path: string | null;
}

interface SetupState {
  claude: EngineStatus;
  codex: EngineStatus;
  /** 지금 쓰는 AI (대화와 일 시키기 모두) */
  engine: Engine;
  /** Claude Code 모델 (sonnet / haiku / opus / default) */
  claudeModel: string;
  /** Codex 권한: 읽기만 / 작업 폴더 안에서 쓰기 */
  codexSandbox: "read-only" | "workspace-write";
  /** 처음 켜서 아직 고른 적이 없는지 */
  firstRun: boolean;
  /** 말풍선에서 [항상 허용]을 누른 동작들 (펫 전용) */
  allowRules: { tool: string; match: string; label: string }[];
}

interface SetupBridge {
  state(): Promise<SetupState>;
  /** 짧은 말 하나를 보내서 실제로 대답이 오는지 본다 */
  test(engine: Engine): Promise<{ ok: boolean; message: string; seconds: number }>;
  /** 터미널을 열어서 로그인한다 */
  login(engine: Engine): void;
  /** "항상 허용" 목록에서 하나를 지운다 */
  removeAllow(index: number): Promise<SetupState["allowRules"]>;
  /** 고른 AI를 대화와 일 시키기에 모두 쓴다 */
  save(engine: Engine, claudeModel: string, codexSandbox: "read-only" | "workspace-write"): Promise<void>;
}

interface Window {
  chatwin: ChatBridge;
  pet: PetBridge;
  studio: StudioBridge;
  setup: SetupBridge;
}
