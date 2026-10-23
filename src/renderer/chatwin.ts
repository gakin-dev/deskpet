// 대화 창 화면 — 최근 대화를 말풍선 목록으로 보여주고 아래 입력창으로 말을 건다.
// import 없는 스크립트. 다른 화면 스크립트와 이름이 겹치지 않게 함수 하나로 감싼다.

(() => {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let shown = 0;

  function render(s: { name: string; entries: TranscriptEntry[]; usage: string; busy: boolean }): void {
    $("name").textContent = s.name;
    $("usage").textContent = s.usage;
    document.querySelector(".dot")!.classList.toggle("busy", s.busy);
    const log = $("log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren();
    let last = 0;
    for (const e of s.entries) {
      if (e.at - last > 5 * 60_000) {  // 5분 넘게 떨어지면 시각 표시
        const t = document.createElement("div");
        t.className = "time";
        t.textContent = new Date(e.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
        log.append(t);
      }
      last = e.at;
      const m = document.createElement("div");
      m.className = `msg ${e.who}`;
      m.textContent = e.text;
      if (e.ai) {
        const ai = document.createElement("span");
        ai.className = "ai";
        ai.textContent = e.ai;
        m.append(ai);
      }
      log.append(m);
    }
    // 새 말이 오면 맨 아래로 (위로 올려서 보고 있으면 그대로)
    if (atBottom || s.entries.length !== shown) log.scrollTop = log.scrollHeight;
    shown = s.entries.length;
    $<HTMLButtonElement>("send").disabled = s.busy;
  }

  const input = $<HTMLTextAreaElement>("input");
  const fit = () => { input.style.height = "auto"; input.style.height = `${Math.min(120, input.scrollHeight)}px`; };
  input.addEventListener("input", fit);
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;  // 한글 조합 중인 Enter는 무시
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $<HTMLFormElement>("form").requestSubmit(); }
  });
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || $<HTMLButtonElement>("send").disabled) return;
    window.chatwin.send(text);
    input.value = "";
    fit();
  });

  window.chatwin.onUpdate(render);
  void window.chatwin.state().then(render);
  input.focus();
})();
