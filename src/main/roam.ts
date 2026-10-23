// Roamer — 펫 창을 화면에서 돌아다니게 한다.
// 행동: 산책(아무 데나 감), 모서리에서 구경(모서리까지 가서 오래 쉼), 빼꼼(화면 가장자리에 반쯤 숨음)
// 범위: 바닥에서만(지금 높이에서 좌우로) / 화면 전체 / 모든 모니터
//
// 위치는 "캐릭터 상자"(창 안의 #pet, 가로는 창 가운데) 기준으로 계산하고 창 위치로 바꿔서 옮긴다.
// macOS는 창을 메뉴 막대 위로 못 올리니까, 캐릭터가 화면 위쪽에 가면 창 안 배치를 뒤집어서
// (layout "top": 캐릭터가 창 맨 위, 말풍선은 아래) 화면 맨 위까지 갈 수 있게 한다.

import { screen, type BrowserWindow } from "electron";

/** 걷기를 잠깐 멈추는 이유: 마우스를 올림 / 입력창 / 승인 질문 / 드래그 / 자리 비움 */
export type Hold = "hover" | "chat" | "ask" | "drag" | "away";

type Mode = "rest" | "walk";
type Layout = WalkState["layout"];
type Rect = Electron.Rectangle;

/** 활동량별 쉬는 시간 (초) */
const restSeconds = { low: [20, 45], normal: [8, 20], high: [3, 8] } as const;
const peekSeconds = [10, 25] as const;
const tickMs = 33;
/** 위쪽 배치일 때 캐릭터 위 여백 (뛰는 몸짓·효과가 창 밖으로 잘리지 않게 — style.css의 body.top #stage와 같게) */
const topPad = 32;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Roamer {
  private behavior: Behavior | null = null;
  /** 캐릭터 크기 (렌더러의 #pet 상자 = 가로 size+20, 세로 size+15) */
  private size = 120;
  private holds = new Set<Hold>();
  private mode: Mode = "rest";
  /** 걸어가는 목표 (창 x, 캐릭터 상자 위쪽 y) */
  private target = { x: 0, y: 0 };
  private then: Pose = "rest";
  private pose: Pose = "rest";
  private until = Date.now() + 5000;
  /** 소수점까지 들고 있는 위치 (창 x, 캐릭터 위쪽 y) */
  private x = 0;
  private y = 0;
  private layout: Layout = "bottom";
  private dir: -1 | 0 | 1 = 0;
  private walking = false;
  private last = Date.now();

  constructor(private win: BrowserWindow, private notify: (w: WalkState) => void) {
    setInterval(() => this.tick(), tickMs);
  }

  configure(b: Behavior, size: number): void {
    this.behavior = b;
    this.size = size;
    if (!b.roam) {
      this.stop();
      if (this.outsideX()) this.moveTo(this.visibleX(this.x), this.y);  // 빼꼼 중이었으면 화면 안으로
    }
  }

  hold(h: Hold, on: boolean): void {
    if (on) { this.holds.add(h); this.stop(); } else this.holds.delete(h);
  }

  /** 말할 때: 화면 옆으로 삐져나가 있으면 말풍선이 잘리니까 화면 안으로 나온다 */
  onSpeak(): void {
    this.sync();
    if (this.outsideX()) this.walkTo(this.visibleX(this.x), this.y, "rest");
  }

  // MARK: - 좌표

  private alive(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible();
  }

  private bounds(): Rect { return this.win.getBounds(); }
  private petH(): number { return this.size + 15; }
  /** 창 위쪽에서 캐릭터 상자 위쪽까지 거리 */
  private offset(layout: Layout): number { return layout === "bottom" ? this.bounds().height - this.petH() : topPad; }
  /** 캐릭터가 화면 끝에 닿도록 창이 화면 밖으로 나가도 되는 만큼 */
  private slack(): number { return Math.max(0, (this.bounds().width - this.size) / 2 - 4); }

  private area(): Rect {
    const b = this.bounds();
    return screen.getDisplayMatching({ ...b, y: this.y, height: this.petH() }).workArea;
  }

  /** 지금 창 위치에서 캐릭터 위치를 다시 읽는다 (드래그 등으로 옮겨졌을 수 있음) */
  private sync(): void {
    const [x, y] = this.win.getPosition();
    this.x = x;
    this.y = y + this.offset(this.layout);
  }

  /** 말풍선까지 다 보이는 창 x */
  private visibleX(x: number): number {
    const a = this.area();
    return Math.min(a.x + a.width - this.bounds().width, Math.max(a.x, x));
  }

  private outsideX(): boolean {
    return Math.abs(this.visibleX(this.x) - this.x) > 1;
  }

  /** 캐릭터 위치에 맞는 배치: 창이 메뉴 막대 위로 못 올라가면 캐릭터를 창 위쪽에 둔다 */
  private layoutFor(y: number): Layout {
    return y - this.offset("bottom") >= this.area().y ? "bottom" : "top";
  }

  private moveTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    const layout = this.layoutFor(y);
    if (layout !== this.layout) { this.layout = layout; this.send(); }
    this.win.setPosition(Math.round(x), Math.round(y - this.offset(layout)));
  }

  private send(): void {
    this.notify({ walking: this.walking, dir: this.dir, pose: this.walking ? "rest" : this.pose, layout: this.layout });
  }

  // MARK: - 행동

  private stop(): void {
    if (this.mode === "walk") { this.mode = "rest"; this.until = Date.now() + 1500; }
    if (this.walking) { this.walking = false; this.send(); }
  }

  private walkTo(x: number, y: number, then: Pose): void {
    this.target = { x, y };
    this.then = then;
    this.pose = "rest";
    this.mode = "walk";
    if (Math.abs(x - this.x) > 2) this.dir = x > this.x ? 1 : -1;
    this.walking = true;
    this.send();
  }

  private arrive(): void {
    const b = this.behavior!;
    this.walking = false;
    this.pose = this.then;
    this.mode = "rest";
    const [lo, hi] = this.pose === "peek" ? peekSeconds : restSeconds[b.activity];
    this.until = Date.now() + rand(lo, hi) * 1000 * (this.pose === "watch" ? 2 : 1);  // 구경은 오래
    if (this.pose === "peek") {
      // 숨은 쪽 반대(화면 안쪽)를 본다
      const a = this.area();
      this.dir = this.x + this.bounds().width / 2 > a.x + a.width / 2 ? -1 : 1;
    }
    this.send();
  }

  /** 다음 목적지를 고를 화면: 모든 모니터면 아무 모니터나 */
  private pickArea(): Rect {
    if (this.behavior?.area === "all") {
      const all = screen.getAllDisplays();
      return all[Math.floor(Math.random() * all.length)].workArea;
    }
    return this.area();
  }

  /** 다음에 할 행동을 고른다 */
  private decide(): void {
    const b = this.behavior!;
    if (this.outsideX()) { this.walkTo(this.visibleX(this.x), this.y, "rest"); return; }  // 빼꼼하고 나면 다시 나옴

    const choices: ["walk" | "corner" | "peek", number][] = [];
    if (b.walk) choices.push(["walk", 3]);
    if (b.corner) choices.push(["corner", 1.5]);
    if (b.peek) choices.push(["peek", 1]);
    let r = Math.random() * choices.reduce((s, c) => s + c[1], 0);
    const pick = choices.find((c) => (r -= c[1]) < 0)?.[0] ?? "walk";

    const floor = b.area === "floor";
    const a = floor ? this.area() : this.pickArea();
    const w = this.bounds().width;
    const slack = floor ? 0 : this.slack();
    const minX = a.x - slack, maxX = a.x + a.width - w + slack;
    const minY = a.y + topPad, maxY = a.y + a.height - this.petH();
    const anyY = () => (floor ? this.y : rand(minY, maxY));
    const right = () => (b.cornerSide === "both" ? Math.random() < 0.5 : b.cornerSide === "right");

    if (pick === "walk") {
      let t = { x: rand(minX, maxX), y: anyY() };
      for (let i = 0; i < 5 && Math.hypot(t.x - this.x, t.y - this.y) < 80; i++) t = { x: rand(minX, maxX), y: anyY() };  // 너무 가까우면 다시
      this.walkTo(t.x, t.y, "rest");
    } else if (pick === "corner") {
      // 바닥 범위면 지금 높이의 양 끝, 화면 범위면 네 모서리 중 하나
      const y = floor ? this.y : Math.random() < 0.5 ? minY : maxY;
      this.walkTo(right() ? maxX : minX, y, "watch");
    } else {
      // 캐릭터 몸이 peekDepth만큼 화면 밖으로 나가게 (창 가운데 = 캐릭터 가운데)
      const out = this.size * (b.peekDepth - 0.5);
      this.walkTo(right() ? a.x + a.width - w / 2 + out : a.x - w / 2 - out, anyY(), "peek");
    }
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const b = this.behavior;
    if (!b || !this.alive()) return;
    if (!this.walking) {
      this.sync();
      // 드래그로 옮긴 뒤 배치가 안 맞으면 (위쪽 배치인데 아래 배치로도 들어감 등) 캐릭터 자리 그대로 맞춰준다
      if (this.holds.size === 0 && this.layoutFor(this.y) !== this.layout) this.moveTo(this.x, this.y);
    }
    if (this.holds.size > 0 || (!b.roam && !this.walking)) return;

    if (this.mode === "walk") {
      const step = b.speed * dt;
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= step) {
        this.moveTo(this.target.x, this.target.y);
        this.arrive();
      } else {
        this.moveTo(this.x + (dx / dist) * step, this.y + (dy / dist) * step);
      }
    } else if (now >= this.until) {
      this.decide();
    }
  }
}
