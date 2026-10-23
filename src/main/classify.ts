// 앱 분류 — 앱 이름 + 번들 ID(맥) / 프로세스 이름(윈도우) 키워드 매칭

export type Category = "work" | "play" | "browser" | "other";

export const workKeys = [
  "xcode", "vscode", "visual studio code", "cursor", "terminal", "iterm", "claude", "jetbrains",
  "intellij", "pycharm", "notion", "figma", "pages", "numbers", "keynote", "word", "excel",
  "powerpoint", "sublime", "zed", "obsidian", "android studio", "warp", "ghostty",
  // 윈도우 프로세스 이름
  "devenv", "windowsterminal", "powershell", "winword", "powerpnt", "hwp", "한글",
];
export const playKeys = [
  "discord", "kakaotalk", "카카오톡", "music", "spotify", "netflix", "steam", "youtube",
  "instagram", "tv", "chess", "game", "twitch", "melon", "멜론", "league of legends", "riot",
];
export const browserKeys = ["safari", "chrome", "arc", "firefox", "edge", "whale", "brave", "opera"];

/** 브라우저 창 제목에 이게 있으면 딴짓으로 본다 (창 제목은 윈도우에서만 읽힘) */
export const playSites = [
  "youtube", "netflix", "twitch", "instagram", "tiktok", "치지직", "chzzk", "soop", "아프리카tv",
  "reddit", "웨이브", "티빙", "tving", "쿠팡플레이", "웹툰", "webtoon", "x.com", "facebook",
];
/** 브라우저 창 제목에 이게 있으면 작업 중으로 본다 */
export const workSites = [
  "github", "stack overflow", "stackoverflow", "docs", "documentation", "notion", "claude",
  "google docs", "google 문서", "스프레드시트", "spreadsheets", "jira", "confluence", "figma", "mdn",
];

export function classify(name: string, id: string): Category {
  const s = `${name} ${id}`.toLowerCase();
  if (workKeys.some((k) => s.includes(k))) return "work";
  if (playKeys.some((k) => s.includes(k))) return "play";
  if (browserKeys.some((k) => s.includes(k))) return "browser";
  return "other";
}

/**
 * 브라우저 창 제목으로 지금 보는 사이트를 짐작한다.
 * 제목 전체는 밖으로 보내지 않고, 걸린 키워드(예: "youtube")만 돌려준다.
 */
export function classifyTitle(title: string): { category: Category; site: string } | null {
  const t = title.toLowerCase();
  const play = playSites.find((k) => t.includes(k));
  if (play) return { category: "play", site: play };
  const work = workSites.find((k) => t.includes(k));
  if (work) return { category: "work", site: work };
  return null;
}

export function icon(c: Category): string {
  return { work: "💻", play: "🎮", browser: "🌐", other: "📦" }[c];
}
