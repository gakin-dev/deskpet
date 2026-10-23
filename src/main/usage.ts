// AI 사용량 기록 (~/.deskpet/usage.json) — 날짜별로 펫이 AI를 몇 번 불렀고 토큰을 얼마나 썼는지.
// 대화 창 위쪽과 우클릭 메뉴에 오늘 사용량을 보여준다. (최근 60일만 남김)

import fs from "node:fs";

/** 무엇 때문에 불렀는지: 내가 건 말 / 펫 혼자 반응 / 대화 정리 / 스튜디오·연결 테스트 */
export type UsageKind = "chat" | "situation" | "compact" | "test";

export interface DayUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  byKind: Partial<Record<UsageKind, number>>;
}

const today = () => new Date().toLocaleDateString("sv-SE");  // 2026-10-23

export class Usage {
  constructor(private file: string) {}

  private read(): Record<string, DayUsage> {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return {}; }
  }

  add(kind: UsageKind, tokensIn: number, tokensOut: number): void {
    const all = this.read();
    const d = all[today()] ?? { calls: 0, tokensIn: 0, tokensOut: 0, byKind: {} };
    d.calls++;
    d.tokensIn += tokensIn;
    d.tokensOut += tokensOut;
    d.byKind[kind] = (d.byKind[kind] ?? 0) + 1;
    all[today()] = d;
    const keep = Object.keys(all).sort().slice(-60);
    try { fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]])), null, 2) + "\n"); } catch { /* 기록 실패는 무시 */ }
  }

  today(): DayUsage {
    return this.read()[today()] ?? { calls: 0, tokensIn: 0, tokensOut: 0, byKind: {} };
  }

  /** "오늘 AI 12번 · 48.3만 토큰" */
  summary(): string {
    const d = this.today();
    const t = d.tokensIn + d.tokensOut;
    const amount = t >= 10_000 ? `${(t / 10_000).toFixed(1)}만` : `${t.toLocaleString()}`;
    return `오늘 AI ${d.calls}번 · ${amount} 토큰`;
  }
}
