// 펫 전용 "항상 허용" 목록 (~/.deskpet/allow.json). 말풍선에서 [항상 허용]을 누른 동작은 다음부터 안 묻는다.
// 사용자의 평소 Claude Code 권한 설정(~/.claude/settings.json)은 건드리지 않고 펫에게만 적용된다.
//   터미널 명령 → 그 명령 그대로 / 웹 접속 → 그 사이트 / 파일 수정·읽기 → 그 파일 / 그 밖의 도구(스킬, MCP 등) → 그 도구

import fs from "node:fs";

export interface AllowRule {
  tool: string;
  /** 명령·사이트·파일. 비어 있으면 그 도구 전체 */
  match: string;
  /** 사람이 읽는 설명 */
  label: string;
}

/** 권한 요청 하나를 "항상 허용" 규칙으로 */
export function ruleOf(tool: string, input: Record<string, unknown>, label: string): AllowRule {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (tool) {
    case "Bash": case "PowerShell": return { tool, match: s("command"), label };
    case "WebFetch": {
      let host = "";
      try { host = new URL(s("url")).hostname; } catch { /* 주소가 이상하면 도구 전체로 두지 않고 그 주소 그대로 */ }
      return { tool, match: host || s("url"), label: host ? `웹 접속: ${host}` : label };
    }
    case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": case "Read":
      return { tool, match: s("file_path") || s("notebook_path"), label };
    default: return { tool, match: "", label };
  }
}

function matches(rule: AllowRule, tool: string, input: Record<string, unknown>): boolean {
  if (rule.tool !== tool) return false;
  if (!rule.match) return true;
  return ruleOf(tool, input, "").match === rule.match;
}

export class AllowList {
  constructor(private file: string) {}

  list(): AllowRule[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.filter((r) => r && typeof r.tool === "string" && typeof r.match === "string") : [];
    } catch { return []; }
  }

  allows(tool: string, input: Record<string, unknown>): boolean {
    return this.list().some((r) => matches(r, tool, input));
  }

  add(rule: AllowRule): void {
    const all = this.list().filter((r) => !(r.tool === rule.tool && r.match === rule.match));
    fs.writeFileSync(this.file, JSON.stringify([...all, rule], null, 2) + "\n");
  }

  remove(index: number): void {
    const all = this.list();
    all.splice(index, 1);
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2) + "\n");
  }
}
