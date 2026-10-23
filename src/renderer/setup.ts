// AI 설정 창 화면 — Claude Code / Codex 상태를 보여주고, 대화·일 시키기에 쓸 AI를 고른다.
// import 없는 스크립트. 펫·스튜디오 스크립트와 이름이 겹치지 않게 함수 하나로 감싼다.

(() => {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const setup = window.setup;
  const names: Record<Engine, string> = { claude: "Claude Code", codex: "Codex" };
  let state: SetupState | null = null;
  let engine: Engine = "claude";
  /** 연결 테스트 결과 (로그인 상태 확인보다 정확해서 있으면 이걸 믿는다 — Codex는 토큰이 만료돼도 "로그인됨"으로 나옴) */
  const tested: Partial<Record<Engine, boolean>> = {};
  const loggedIn = (e: Engine) => tested[e] ?? state?.[e].loggedIn ?? null;

  const card = (e: Engine) => document.querySelector<HTMLElement>(`.engine[data-engine="${e}"]`)!;

  function renderStatus(): void {
    if (!state) return;
    for (const e of ["claude", "codex"] as Engine[]) {
      const st = state[e];
      const badge = card(e).querySelector<HTMLElement>("[data-status]")!;
      const [cls, text] = !st.installed ? ["bad", "설치 안 됨"]
        : loggedIn(e) === false ? ["warn", "로그인 필요"]
        : loggedIn(e) === true ? ["ok", tested[e] ? "연결됨" : "준비됨"] : ["warn", "확인 필요"];
      badge.className = `status ${cls}`;
      badge.textContent = text;
      badge.title = st.path ?? "";
      card(e).querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => { b.disabled = !st.installed; });
    }
  }

  function renderAllow(rules: SetupState["allowRules"]): void {
    $("allow-list").replaceChildren(...rules.map((r, i) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = r.label;
      span.title = r.match ? `${r.tool}: ${r.match}` : r.tool;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "지우기";
      x.addEventListener("click", async () => renderAllow(await setup.removeAllow(i)));
      li.append(span, x);
      return li;
    }));
  }

  function renderChoice(): void {
    for (const e of ["claude", "codex"] as Engine[]) {
      card(e).classList.toggle("selected", e === engine);
      card(e).setAttribute("aria-checked", String(e === engine));
    }
    // 고른 AI가 설치 안 됐거나 로그인이 필요하면 알려준다
    const bad = state && (!state[engine].installed || loggedIn(engine) === false);
    const warn = $("warn");
    warn.hidden = !bad;
    if (bad) warn.textContent = `${names[engine]}이(가) ${state![engine].installed ? "로그인이 안 돼 있어요. '로그인하기'를 눌러주세요." : "설치돼 있지 않아요."}`;
  }

  async function load(): Promise<void> {
    state = await setup.state();
    if (!state.firstRun) {
      $("title").textContent = "AI 설정";
      $("save").textContent = "저장";
    }
    engine = state.engine;
    renderAllow(state.allowRules);
    $<HTMLSelectElement>("claude-model").value = state.claudeModel;
    $<HTMLSelectElement>("codex-sandbox").value = state.codexSandbox;
    renderStatus();
    renderChoice();
  }

  for (const e of ["claude", "codex"] as Engine[]) {
    card(e).querySelector("[data-act=test]")!.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      const out = card(e).querySelector<HTMLElement>("[data-result]")!;
      btn.disabled = true;
      out.className = "test-result";
      out.textContent = "물어보는 중…";
      const r = await setup.test(e);
      out.className = `test-result ${r.ok ? "ok" : "bad"}`;
      out.textContent = r.ok ? `✓ ${r.seconds}초 만에 대답: ${r.message}` : `✗ ${r.message}`;
      if (r.ok) tested[e] = true; else if (/로그인/.test(r.message)) tested[e] = false;
      renderStatus();
      renderChoice();
      btn.disabled = false;
    });
    card(e).querySelector("[data-act=login]")!.addEventListener("click", () => {
      setup.login(e);
      delete tested[e];  // 로그인하고 나면 다시 테스트
      const out = card(e).querySelector<HTMLElement>("[data-result]")!;
      out.className = "test-result";
      out.textContent = "터미널에서 로그인한 뒤 '연결 테스트'를 눌러주세요";
    });
  }
  // 카드를 누르면 그 AI를 고른다 (안의 버튼은 따로)
  for (const e of ["claude", "codex"] as Engine[]) {
    const pick = () => { engine = e; renderChoice(); };
    card(e).addEventListener("click", (ev) => { if (!(ev.target as HTMLElement).closest("button")) pick(); });
    card(e).addEventListener("keydown", (ev) => { if (ev.key === " " || ev.key === "Enter") { ev.preventDefault(); pick(); } });
  }
  $("save").addEventListener("click", async () => {
    $<HTMLButtonElement>("save").disabled = true;
    await setup.save(engine, $<HTMLSelectElement>("claude-model").value,
      $<HTMLSelectElement>("codex-sandbox").value === "read-only" ? "read-only" : "workspace-write");
  });
  // 창을 다시 보면 (터미널에서 로그인하고 돌아오면) 상태를 다시 읽는다
  window.addEventListener("focus", () => { void setup.state().then((s) => { state = s; renderStatus(); renderChoice(); }); });

  // MARK: - 설정 / 사용 가이드 탭

  function setView(view: string): void {
    document.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === view);
      t.setAttribute("aria-selected", String(t.dataset.view === view));
    });
    document.querySelectorAll<HTMLElement>("[data-view-panel]").forEach((p) => { p.hidden = p.dataset.viewPanel !== view; });
    document.querySelectorAll<HTMLElement>("[data-only]").forEach((p) => { p.hidden = p.dataset.only !== view; });
  }
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view!)));

  /** 가이드 맨 위: 지금 쓰는 AI */
  function renderNow(): void {
    if (!state) return;
    const st = state[state.engine];
    const box = $("now");
    box.replaceChildren();
    const item = (label: string, value: string) => {
      const span = document.createElement("span");
      const b = document.createElement("b");
      b.textContent = value;
      span.append(`${label} `, b);
      return span;
    };
    box.append(
      item("지금 쓰는 AI:", names[state.engine]),
      item("상태:", !st.installed ? "설치 안 됨" : loggedIn(state.engine) === false ? "로그인 필요" : "준비됨"),
      item("위치:", st.path ?? "-"),
    );
  }

  // 우클릭 → AI 사용 가이드로 열면 가이드부터
  setView(new URLSearchParams(location.search).get("view") === "guide" ? "guide" : "settings");
  void load().then(renderNow);
})();
