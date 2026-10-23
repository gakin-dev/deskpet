// 캐릭터 그리기와 움직임 — 펫 화면(renderer.ts)과 스튜디오 미리보기(studio.ts)가 같이 쓴다.
// import 없는 스크립트라서 여기 선언한 것들은 같은 페이지의 다른 스크립트에서 그대로 보인다.

/** 움직임 종류와 이름 (스튜디오에서 고르는 목록) */
const motionKinds: { id: MotionKind; label: string }[] = [
  { id: "bounce", label: "통통 뛰기" },
  { id: "shiver", label: "바들바들" },
  { id: "tilt", label: "갸우뚱" },
  { id: "doze", label: "꾸벅꾸벅" },
  { id: "jump", label: "펄쩍" },
  { id: "droop", label: "축 처짐" },
  { id: "tremble", label: "부들부들" },
  { id: "heartbeat", label: "두근두근" },
  { id: "still", label: "가만히" },
];

/** 이미지 한 장을 움직이는 값 + 머리 위 효과의 위치 */
interface Motion {
  dx: number; dy: number; rot: number; sx: number; sy: number;
  markDx: number; markDy: number; markOpacity: number;
}

function motion(kind: MotionKind, t: number): Motion {
  const m: Motion = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, markDx: 0, markDy: -10, markOpacity: 1 };
  switch (kind) {
    case "bounce": {   // 통통 뛰기 + 숨쉬기
      const p = t % 2.4;
      if (p < 0.5) m.dy = -Math.sin((p / 0.5) * Math.PI) * 14;
      if (p >= 0.5 && p < 0.65) { m.sy = 0.92; m.sx = 1.06; }  // 착지할 때 찌부
      else { m.sy = 1 + 0.025 * Math.sin(t * 3); m.sx = 1 - 0.025 * Math.sin(t * 3); }
      m.markDy = -10 - 6 * Math.sin(t * 2); m.markDx = 4 * Math.sin(t * 1.3);
      break;
    }
    case "shiver":     // 열심히 바들바들
      m.rot = Math.sin(t * 18) * 1.5;
      m.sy = 1 + 0.02 * Math.sin(t * 9);
      m.markDy = -8 - 2 * Math.abs(Math.sin(t * 6));
      break;
    case "tilt":       // 갸우뚱 기울이며 살금살금
      m.rot = 10 + Math.sin(t * 1.5) * 3;
      m.dx = Math.sin(t * 0.8) * 6;
      m.markDy = -10 - 4 * Math.abs(Math.sin(t * 3));
      break;
    case "doze": {     // 꾸벅꾸벅 + 효과가 위로 떠오름
      m.rot = Math.sin(t * 1.2) * 6;
      m.sy = 0.97 + 0.03 * Math.sin(t * 2); m.sx = 1.01;
      const z = (t % 2.5) / 2.5;
      m.markDy = -z * 28; m.markDx = z * 10; m.markOpacity = 1 - z;
      break;
    }
    case "jump": {     // 깜짝! 펄쩍 + 부들부들
      const p = t % 3;
      if (p < 0.6) { m.dx = Math.sin(t * 45) * 2.5; m.sy = 1.06; m.sx = 0.96; m.dy = -4; }
      m.markDy = p < 0.6 ? -14 : -10;
      break;
    }
    case "droop": {    // 축 처져서 천천히 흔들 + 효과가 뺨을 타고 떨어짐
      m.sy = 0.95; m.sx = 1.03; m.dy = 3;
      m.rot = Math.sin(t * 0.9) * 3;
      const d = (t % 1.8) / 1.8;
      m.markDx = -60; m.markDy = 30 + d * 22; m.markOpacity = 1 - d;
      break;
    }
    case "tremble":    // 부들부들 + 효과 깜빡깜빡
      m.dx = Math.sin(t * 38) * 2;
      m.sy = 1 + 0.03 * Math.abs(Math.sin(t * 6)); m.sx = 1.02;
      m.markOpacity = 0.55 + 0.45 * Math.abs(Math.sin(t * 5));
      break;
    case "heartbeat": { // 두근두근 + 효과가 떠오름
      const beat = Math.max(0, Math.sin(t * 7)) ** 6;
      m.sx = 1 + 0.05 * beat; m.sy = 1 + 0.05 * beat;
      m.rot = Math.sin(t * 1.5) * 4;
      const h = (t % 2.2) / 2.2;
      m.markDy = -6 - h * 26; m.markDx = 6 * Math.sin(t * 2); m.markOpacity = 1 - h * 0.8;
      break;
    }
    case "still":
      break;
  }
  return m;
}

/** 움직이는 동안의 몸짓: 걷기(콩콩 뒤뚱) / 날기(둥실둥실) / 뛰기(깡총깡총, 착지할 때 찌부) */
function walkMotion(t: number, gait: Behavior["gait"] = "walk"): Pick<Motion, "dx" | "dy" | "rot" | "sx" | "sy"> {
  if (gait === "float") {
    return { dx: 0, dy: -8 + Math.sin(t * 2.4) * 6, rot: Math.sin(t * 1.3) * 6, sx: 1 + 0.02 * Math.sin(t * 2.4), sy: 1 - 0.02 * Math.sin(t * 2.4) };
  }
  if (gait === "hop") {
    const p = (t * 2.2) % 1;
    const land = p > 0.85;
    return { dx: 0, dy: land ? 0 : -Math.sin((p / 0.85) * Math.PI) * 22, rot: land ? 0 : Math.sin(p * Math.PI * 2) * 4, sx: land ? 1.08 : 0.97, sy: land ? 0.9 : 1.04 };
  }
  const step = t * 7;
  return { dx: 0, dy: -Math.abs(Math.sin(step)) * 5, rot: Math.sin(step) * 3, sx: 1, sy: 1 - 0.02 * Math.abs(Math.cos(step)) };
}

interface MotionOptions {
  /** 좌우 뒤집기 (걷는 방향과 그림이 보는 방향이 반대일 때) */
  flip?: boolean;
  walking?: boolean;
  gait?: Behavior["gait"];
  /** 이 이미지 칸의 위치·크기 조절과 캐릭터 크기 (px로 바꿀 때) */
  adjust?: ImageAdjust;
  size?: number;
}

/** 이미지와 효과 요소에 지금 움직임을 적용한다 */
function applyMotion(img: HTMLElement | SVGElement, mark: HTMLElement, style: MoodStyle | undefined, t: number, o: MotionOptions = {}): void {
  const m = motion(style?.motion ?? "still", t);
  const body = o.walking ? walkMotion(t, o.gait) : m;
  // 조절값은 뒤집기 뒤에 넣어서, 그림이 뒤집히면 조절도 같이 뒤집히게
  const k = o.adjust?.scale ?? 1;
  const ax = ((o.adjust?.x ?? 0) / 100) * (o.size ?? 120) / k, ay = ((o.adjust?.y ?? 0) / 100) * (o.size ?? 120) / k;
  img.style.transform = `translate(${body.dx}px, ${body.dy}px) rotate(${body.rot}deg) scale(${(o.flip ? -body.sx : body.sx) * k}, ${body.sy * k}) translate(${ax}px, ${ay}px)`;
  const effect = style?.effect ?? "";
  mark.hidden = !effect;
  if (!effect) return;
  if (mark.textContent !== effect) mark.textContent = effect;
  mark.style.color = style?.effectColor || "#404040";
  mark.style.opacity = String(m.markOpacity);
  mark.style.transform = `translate(${m.markDx}px, ${m.markDy}px)`;
}

/** 지금 보여줄 이미지 칸과 프레임들. 스킨이 없으면 null
 *  걷는 중 → 걷기 / 구경·빼꼼 중 → 그 자세 / 깜빡임(한 장짜리일 때만) → 눈 감은 모습 / 감정 → 기본 → 기쁨 순 */
function pickFrames(skin: SkinMap, mood: Mood, blink: boolean, walking: boolean, pose: Pose = "rest"): { slot: string; frames: SkinFrame[] } | null {
  const has = (s: string) => (skin[s]?.length ?? 0) > 0;
  if (walking && has("walk")) return { slot: "walk", frames: skin["walk"] };
  if (!walking && pose !== "rest" && has(pose)) return { slot: pose, frames: skin[pose] };
  // 마지막엔 아무 감정 그림이나. 걷기·구경·빼꼼·눈 감은 그림은 그 자세일 때만 쓴다
  const poseSlots = ["walk", "watch", "peek", "blink"];
  const base = [mood, "default", "happy", ...Object.keys(skin).filter((k) => !poseSlots.includes(k))].find(has);
  if (!base) return null;
  if (blink && mood !== "sleepy" && skin[base].length === 1 && has("blink")) return { slot: "blink", frames: skin["blink"] };
  return { slot: base, frames: skin[base] };
}

/** 칸별 기본 재생 속도 (초당 장 수) */
const defaultFps = (slot: string) => (slot === "walk" ? 8 : 6);

/** 지금 시각에 보여줄 프레임 */
function frameAt(frames: SkinFrame[], fps: number, t: number): SkinFrame {
  return frames[Math.floor(t * fps) % frames.length];
}

/** 그림이 보는 방향과 걷는 방향이 반대면 뒤집는다 */
function shouldFlip(facing: Behavior["facing"], dir: -1 | 0 | 1): boolean {
  return (facing === "right" && dir < 0) || (facing === "left" && dir > 0);
}

// MARK: - 기본 캐릭터 그림 (오리지널 하얀 찹쌀떡 친구)

const INK = "#403333";

function creatureSvg(mood: Mood, closed: boolean): string {
  const ears = [-1, 1].map((side) => {
    const x = 50 + side * 24;
    return `<g transform="rotate(${side * 22} ${x} 18)">
      <ellipse cx="${x}" cy="18" rx="10" ry="14" fill="#fff" stroke="${INK}" stroke-width="2"/>
      <ellipse cx="${x}" cy="18" rx="5" ry="9" fill="#ffc0cb" fill-opacity="0.35"/>
    </g>`;
  }).join("");
  const body = `<ellipse cx="50" cy="50" rx="46" ry="37" fill="#fff" stroke="${INK}" stroke-width="2.2"/>`;
  const cheeks = [-1, 1].map((side) =>
    `<ellipse cx="${50 + side * 26}" cy="58" rx="7" ry="4" fill="#ffc0cb" fill-opacity="0.45"/>`).join("");
  const eyes = eye(33, 46, mood, closed) + eye(67, 46, mood, closed);
  return ears + body + cheeks + eyes + mouth(mood);
}

function eye(cx: number, cy: number, mood: Mood, closed: boolean): string {
  if (closed || mood === "sleepy") {
    return `<rect x="${cx - 5}" y="${cy - 1.25}" width="10" height="2.5" rx="1.25" fill="${INK}"/>`;
  }
  const shine = (dx: number, dy: number, r: number) => `<circle cx="${cx + dx}" cy="${cy + dy}" r="${r}" fill="#fff"/>`;
  switch (mood) {
    case "suspicious":
      return `<ellipse cx="${cx}" cy="${cy}" rx="4.5" ry="5.5" fill="${INK}"/>
        <rect x="${cx - 6}" y="${cy - 5.5}" width="12" height="5" fill="#fff"/>
        <rect x="${cx - 6}" y="${cy - 1.5}" width="12" height="2" fill="${INK}"/>`;
    case "surprised":
      return `<circle cx="${cx}" cy="${cy}" r="6" fill="${INK}"/>` + shine(2, -2, 2);
    case "focused":
      return `<ellipse cx="${cx}" cy="${cy}" rx="4" ry="6" fill="${INK}"/>` + shine(1.5, -3, 1.5);
    case "sad": {     // 처진 눈썹 + 촉촉한 눈
      const out = cx < 50 ? -1 : 1;
      return `<path d="M${cx - 5 * out} ${cy - 9} L${cx + 5 * out} ${cy - 6}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
        <ellipse cx="${cx}" cy="${cy + 1}" rx="4" ry="4.5" fill="${INK}"/>` + shine(1.5, -1, 1.8);
    }
    case "angry": {   // 치켜든 눈썹 + 반쯤 감은 눈
      const out = cx < 50 ? -1 : 1;
      return `<path d="M${cx + 5 * out} ${cy - 9} L${cx - 5 * out} ${cy - 5}" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
        <ellipse cx="${cx}" cy="${cy + 1}" rx="4" ry="3.5" fill="${INK}"/>`;
    }
    case "love":      // 하트 눈
      return `<path d="M${cx} ${cy + 4} C${cx - 7} ${cy - 1} ${cx - 4} ${cy - 7} ${cx} ${cy - 3}
        C${cx + 4} ${cy - 7} ${cx + 7} ${cy - 1} ${cx} ${cy + 4} Z" fill="#ff5f8f"/>`;
    default:
      return `<ellipse cx="${cx}" cy="${cy}" rx="4" ry="5" fill="${INK}"/>` + shine(1.5, -2, 1.5);
  }
}

function mouth(mood: Mood): string {
  switch (mood) {
    case "surprised":
      return `<ellipse cx="50" cy="60" rx="3.5" ry="4" fill="none" stroke="${INK}" stroke-width="1.8"/>`;
    case "suspicious":
      return `<rect x="46" y="59.1" width="8" height="1.8" rx="0.9" fill="${INK}"/>`;
    case "sad":
      return `<path d="M45 61 Q50 57 55 61" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`;
    case "angry":
      return `<path d="M45 61 Q47.5 58.5 50 61 Q52.5 58.5 55 61" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`;
    default:
      return `<path d="M45 58 Q47.5 62 50 58 Q52.5 62 55 58" fill="none" stroke="${INK}"
        stroke-width="1.8" stroke-linecap="round"/>`;
  }
}
