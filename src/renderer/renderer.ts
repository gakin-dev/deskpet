// 화면 쪽: 캐릭터, 말풍선, 입력창, 움직임. (import 없는 스크립트 — 메인과는 window.pet으로만 통신)
// 캐릭터 그리기·움직임은 actor.ts (먼저 읽힘)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const petEl = $("pet");
const skinEl = $<HTMLImageElement>("skin");
const creatureEl = document.getElementById("creature") as unknown as SVGSVGElement;
const markEl = $("mark");
const bubbleEl = $("bubble");
const thinkingEl = $("thinking");
const chatEl = $<HTMLInputElement>("chat");
const askEl = $("ask");
const askTextEl = $("ask-text");
const workingEl = $("working");

let view: PetViewState = { name: "모찌", message: null, mood: "happy", thinking: false, ask: null, working: null };
let look: Look = { skin: {}, size: 120, moods: {} as Record<Mood, MoodStyle>, facing: "front", gait: "walk", frameRate: {}, imageAdjust: {} };
/** 지금 보여주는 이미지 칸 (위치·크기 조절을 찾을 때) */
let shownSlot: string | null = null;
let walk: WalkState = { walking: false, dir: 0, pose: "rest", layout: "bottom" };
let blink = false;
let chatOpen = false;

// MARK: - 그리기

function render(): void {
  // 우선순위: 입력창 > 승인 질문 > 생각 중 > 말풍선 > 작업 중 한 줄
  chatEl.hidden = !chatOpen;
  const showAsk = !chatOpen && !!view.ask;
  if (showAsk && askTextEl.textContent !== view.ask) askTextEl.textContent = view.ask;
  askEl.hidden = !showAsk;
  thinkingEl.hidden = chatOpen || showAsk || !view.thinking;
  const showBubble = !chatOpen && !showAsk && !view.thinking && !!view.message;
  if (showBubble && bubbleEl.dataset.full !== view.message) {
    setBubbleText(view.message!);
    bubbleEl.style.animation = "none";
    void bubbleEl.offsetWidth;  // 애니메이션 다시 시작
    bubbleEl.style.animation = "";
  }
  bubbleEl.hidden = !showBubble;
  const showWorking = !chatOpen && !showAsk && !view.thinking && !showBubble && !!view.working;
  if (showWorking) workingEl.textContent = view.working;
  workingEl.hidden = !showWorking;

  drawCharacter(performance.now() / 1000);
}

/** 캐릭터 그림: 스킨 프레임(여러 장이면 시간에 따라 넘김) 또는 기본 캐릭터 */
function drawCharacter(t: number): void {
  const pick = pickFrames(look.skin, view.mood, blink, walk.walking, walk.pose);
  shownSlot = pick?.slot ?? null;
  if (pick) {
    const src = frameAt(pick.frames, look.frameRate[pick.slot as ImageSlot] ?? defaultFps(pick.slot), t).url;
    if (skinEl.getAttribute("src") !== src) skinEl.src = src;
    skinEl.hidden = false;
    creatureEl.setAttribute("hidden", "");
  } else if (skinEl.hidden === false || creatureEl.hasAttribute("hidden") || creatureEl.dataset.face !== view.mood + blink) {
    skinEl.hidden = true;
    creatureEl.removeAttribute("hidden");
    creatureEl.dataset.face = view.mood + blink;
    creatureEl.innerHTML = creatureSvg(view.mood, blink);
  }
}

/** 긴 말은 말풍선엔 앞부분만 보이고 "전체 보기"를 누르면 대화 창에서 다 보여준다 */
const bubbleMax = 110;
function setBubbleText(text: string): void {
  bubbleEl.dataset.full = text;
  if (text.length <= bubbleMax) { bubbleEl.textContent = text; return; }
  bubbleEl.textContent = text.slice(0, bubbleMax - 10).trimEnd() + "… ";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "more";
  more.textContent = "전체 보기";
  more.addEventListener("click", () => window.pet.openHistory());
  bubbleEl.append(more);
}

// MARK: - 감정에 따라 움직인다 (그림은 그대로, 움직임과 효과만 — actor.ts). 걸을 땐 걷는 몸짓 + 방향 뒤집기

function animate(now: number): void {
  const t = now / 1000;
  drawCharacter(t);
  applyMotion(skinEl.hidden ? creatureEl : skinEl, markEl, look.moods?.[view.mood], t,
    {
      walking: walk.walking, gait: look.gait,
      // 빼꼼 그림은 오른쪽 끝용으로 그린다고 보고, 왼쪽 끝(안쪽=오른쪽을 봄)에선 뒤집는다
      flip: shownSlot === "peek" ? walk.dir > 0 : shouldFlip(look.facing, walk.dir),
      adjust: shownSlot ? look.imageAdjust[shownSlot as ImageSlot] : undefined, size: look.size,
    });
  requestAnimationFrame(animate);
}

// MARK: - 눈 깜빡임

setInterval(() => {
  if (view.mood === "sleepy") return;
  blink = true; render();
  setTimeout(() => { blink = false; render(); }, 150);
}, 3500);

// MARK: - 대화 입력창

function openChat(): void {
  chatEl.placeholder = `${view.name}에게 말 걸거나 일 시키기…`;
  chatOpen = true;
  render();
  window.pet.chatOpened();
  setTimeout(() => chatEl.focus(), 30);
}

function closeChat(): void {
  if (chatOpen) window.pet.chatClosed();
  chatOpen = false;
  chatEl.value = "";
  render();
}

chatEl.addEventListener("keydown", (e) => {
  if (e.isComposing) return;  // 한글 조합 중인 Enter는 무시
  if (e.key === "Enter") {
    const t = chatEl.value.trim();
    closeChat();
    if (t) window.pet.chat(t);
  } else if (e.key === "Escape") {
    closeChat();
  }
});
chatEl.addEventListener("blur", () => { if (chatOpen) closeChat(); });

// MARK: - 마우스: 캐릭터 위에서만 클릭을 받고, 나머지는 뒤 창으로 통과

let mouseIgnored = true;
let pointer: { x: number; y: number; moved: boolean; wasChatOpen: boolean } | null = null;

function setIgnore(ignore: boolean): void {
  if (ignore === mouseIgnored) return;
  mouseIgnored = ignore;
  window.pet.setIgnoreMouse(ignore);
}

document.addEventListener("mousemove", (e) => {
  if (pointer) return;
  const hit = (e.target as Element | null)?.closest?.(".hit");
  setIgnore(!hit && !chatOpen);
});
document.addEventListener("mouseleave", () => { if (!pointer && !chatOpen) setIgnore(true); });

petEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  petEl.setPointerCapture(e.pointerId);
  pointer = { x: e.screenX, y: e.screenY, moved: false, wasChatOpen: chatOpen };  // blur보다 먼저 기록
});
petEl.addEventListener("pointermove", (e) => {
  if (!pointer) return;
  if (!pointer.moved && Math.hypot(e.screenX - pointer.x, e.screenY - pointer.y) > 3) {
    pointer.moved = true;
    window.pet.dragStart();
  }
  if (pointer.moved) window.pet.dragMove();
});
petEl.addEventListener("pointerup", (e) => {
  if (!pointer) return;
  petEl.releasePointerCapture(e.pointerId);
  const { moved, wasChatOpen } = pointer;
  pointer = null;
  if (moved) window.pet.dragEnd();
  else if (wasChatOpen) closeChat();
  else openChat();
});
petEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.pet.showMenu();
});

// MARK: - 메인 프로세스에서 오는 소식

window.pet.onState((s) => {
  view = s;
  render();
});
window.pet.onLook((l) => {
  look = l;
  document.documentElement.style.setProperty("--size", `${l.size}px`);
  render();
});
window.pet.onWalk((w) => {
  walk = w;
  // 화면 위쪽에선 캐릭터가 창 맨 위, 말풍선·입력창은 아래로
  document.body.classList.toggle("top", w.layout === "top");
});
window.pet.onOpenChat(() => openChat());
window.pet.onToggleChat(() => { if (chatOpen) closeChat(); else openChat(); });

$("yes").addEventListener("click", () => window.pet.answer("yes"));
$("no").addEventListener("click", () => window.pet.answer("no"));
$("all").addEventListener("click", () => window.pet.answer("all"));
$("always").addEventListener("click", () => window.pet.answer("always"));

render();
requestAnimationFrame(animate);
