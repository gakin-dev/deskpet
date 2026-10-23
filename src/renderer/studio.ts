// 캐릭터 스튜디오 화면 — 캐릭터 목록, 편집 탭(기본·의사소통·감정 표현), 실시간 미리보기.
// import 없는 스크립트. 그리기·움직임은 actor.ts(먼저 읽힘), 메인과는 window.studio로만 통신.
// 펫 화면(renderer.ts)과 이름이 겹치지 않게 전체를 함수 하나로 감싼다.

(() => {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const studio = window.studio;

  /** 효과 빠른 선택 ("" = 없음) */
  const effectPicks = ["♪", "!", "?", "💢", "♥", "💧", "Z", "🔥", "✨", "💦", ""];
  const saveDelay = 700;

  let meta: StudioMeta = { moods: [], situations: [] };
  let list: StudioSummary[] = [];
  let cur: StudioCharacter | null = null;
  /** 편집 중인 설정 (입력하면 바로 바뀌고, 잠시 뒤 자동 저장) */
  let draft: CharacterProfile | null = null;
  let personality = "";
  /** rules.md 내용 */
  let rules = "";
  /** 이 캐릭터의 스킬들과 지금 편집 중인 스킬 (null이면 새 스킬) */
  let skills: StudioSkill[] = [];
  let selSkill: string | null = null;
  let tab = "basic";
  let selMood: Mood = "happy";
  let previewMood: Mood = "happy";
  let saveTimer: number | undefined;
  let saving: Promise<void> = Promise.resolve();
  /** 대화 테스트 기록 (AI가 실제로 한 말) */
  let testHistory: TestTurn[] = [];
  let testBusy = false;
  /** 이 시각까지는 미리보기 말풍선을 바꾸지 않는다 (테스트 대답을 보여주는 중) */
  let bubbleHold = 0;
  /** 위치·크기 조절 창이 열린 이미지 칸. 열려 있는 동안 미리보기는 그 칸을 그 자세로 보여준다 */
  let adjustOpen: ImageSlot | null = null;
  /** 잠깐 미리보기로 보여줄 칸 (빼꼼 깊이를 바꾸는 동안 등) */
  let focusSlot: ImageSlot | null = null;
  let focusTimer: number | undefined;
  /** 끌고 있는 프레임 (순서 바꾸기) */
  let dragFrame: { slot: ImageSlot; file: string } | null = null;

  const moodLabel = (m: Mood) => meta.moods.find((x) => x.id === m)?.label ?? m;
  const slotNames: Partial<Record<ImageSlot, string>> = { default: "기본", blink: "눈 감은 모습", walk: "걷기", watch: "구경하기", peek: "빼꼼" };
  const slotLabel = (s: ImageSlot) => slotNames[s] ?? moodLabel(s as Mood);
  const fpsChoices = [2, 4, 6, 8, 10, 12, 15, 20, 24];

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  let toastTimer: number | undefined;
  function toast(text: string): void {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { t.hidden = true; }, 2600);
  }

  const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

  // MARK: - 저장 (입력이 멈추면 자동 저장)

  function setStatus(s: "saving" | "saved" | "error", detail = ""): void {
    const e = $("save-status");
    e.className = "save-status" + (s === "saved" ? " saved" : s === "error" ? " error" : "");
    e.textContent = s === "saving" ? "저장 중…"
      : s === "error" ? `저장 못 했어요: ${detail}`
      : cur?.active ? "✓ 저장됨 · 펫에 반영됨" : "✓ 저장됨";
  }

  function changed(): void {
    setStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveTimer = undefined; void save(); }, saveDelay);
  }

  function save(): Promise<void> {
    if (!cur || !draft) return saving;
    const id = cur.id, profile = structuredClone(draft), text = personality, rulesText = rules;
    saving = saving.then(async () => {
      try {
        await studio.save(id, profile, text, rulesText);
        const item = list.find((c) => c.id === id);
        if (item && item.name !== profile.name) { item.name = profile.name; renderList(); }
        if (cur?.id === id) setStatus("saved");
      } catch (e) {
        setStatus("error", errText(e));
      }
    });
    return saving;
  }

  /** 기다리는 저장이 있으면 바로 저장한다 (캐릭터를 바꾸기 전 등) */
  async function flush(): Promise<void> {
    if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined; void save(); }
    await saving;
  }

  // MARK: - 캐릭터 목록

  async function refreshList(): Promise<void> {
    list = await studio.list();
    renderList();
  }

  function thumb(src: string | null): HTMLElement {
    const box = el("span", "char-thumb");
    if (src) {
      const img = el("img");
      img.src = src;
      img.alt = "";
      box.append(img);
    } else {
      box.innerHTML = `<svg viewBox="0 0 100 100">${creatureSvg("happy", false)}</svg>`;
    }
    return box;
  }

  function renderList(): void {
    const ul = $("char-list");
    ul.replaceChildren(...list.map((c) => {
      const li = el("li");
      const b = el("button", "char-item" + (c.id === cur?.id ? " selected" : ""));
      b.type = "button";
      const metaBox = el("span", "char-meta");
      metaBox.append(el("span", "char-name", c.name), el("span", "char-sub" + (c.active ? " on" : ""), c.active ? "● 펫으로 쓰는 중" : c.id));
      b.append(thumb(c.thumb), metaBox);
      b.addEventListener("click", () => { if (c.id !== cur?.id) void select(c.id); });
      li.append(b);
      return li;
    }));
    $<HTMLButtonElement>("del-btn").disabled = list.length <= 1;
  }

  async function select(id: string): Promise<void> {
    await flush();
    try {
      cur = await studio.load(id);
    } catch (e) {
      toast(errText(e));
      return;
    }
    draft = structuredClone(cur.profile);
    personality = cur.personality;
    rules = cur.rules;
    adjustOpen = null;
    clearTest();
    if (!draft.moods[selMood].enabled) selMood = firstEnabled();
    previewMood = selMood;
    fillAll();
    renderList();
    setStatus("saved");
  }

  function firstEnabled(): Mood {
    return meta.moods.find((m) => draft?.moods[m.id].enabled)?.id ?? "happy";
  }

  function renderTitle(): void {
    if (!cur || !draft) return;
    $("title-name").textContent = draft.name || "(이름 없음)";
    $("title-active").hidden = !cur.active;
    $("use-btn").hidden = cur.active;
    const onPet = $<HTMLButtonElement>("p-on-pet");
    onPet.disabled = !cur.active;
    $("p-on-pet-hint").textContent = cur.active ? "" : "펫으로 쓰는 캐릭터만 바탕화면에서 볼 수 있어요";
  }

  // MARK: - 탭

  function setTab(t: string): void {
    tab = t;
    if (adjustOpen) { adjustOpen = null; document.querySelectorAll<HTMLElement>(".slot[data-slot]").forEach(renderSlot); }
    document.querySelectorAll<HTMLElement>(".tab").forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll<HTMLElement>(".panel").forEach((p) => { p.hidden = p.dataset.panel !== t; });
    // 숨어 있을 때 그려진 대사 칸은 높이를 못 재서, 보일 때 다시 맞춘다
    document.querySelectorAll<HTMLTextAreaElement>(`.panel[data-panel="${t}"] .line-item textarea`).forEach(fitHeight);
    if (t === "moods") setPreviewMood(selMood);
    demo.x = 0; demo.y = 0; demo.tx = 0; demo.ty = 0; demo.dir = 1; demo.restUntil = 0;
  }

  function fillAll(): void {
    if (!draft) return;
    renderTitle();
    // 기본
    $<HTMLInputElement>("f-name").value = draft.name;
    $<HTMLInputElement>("f-size").value = String(draft.size);
    $("f-size-value").textContent = `${draft.size}px`;
    document.querySelectorAll<HTMLElement>(".slot[data-slot]").forEach(renderSlot);
    // 의사소통
    fillSpeech();
    $<HTMLInputElement>("f-habits").value = draft.speech.habits;
    $<HTMLTextAreaElement>("f-personality").value = personality;
    // 규칙·스킬
    $<HTMLTextAreaElement>("f-rules").value = rules;
    $("rules-path").textContent = `파일: ~/.deskpet/characters/${cur!.id}/rules.md`;
    void loadSkills();
    // 행동·반응
    fillBehavior();
    renderReactions();
    // 감정 표현
    renderWeights();
    renderMoodList();
    fillMoodEditor();
    renderPreviewMoods();
    updatePreview(true);
  }

  // MARK: - 이미지 칸 (끌어다 놓기 / 눌러서 고르기). 큰 칸 = 바꾸기, + 칸 = 프레임 붙이기

  function renderSlot(box: HTMLElement): void {
    if (!cur || !draft) return;
    const slot = box.dataset.slot as ImageSlot;
    const frames = cur.skin[slot] ?? [];
    const area = el("div", "slot-img");
    area.dataset.act = "replace";
    area.title = frames.length ? "눌러서 바꾸거나 이미지를 끌어다 놓기" : "눌러서 고르거나 이미지를 끌어다 놓기 (여러 장 = 애니메이션)";
    if (frames.length) {
      const img = el("img");
      img.src = frames[0].url;
      img.alt = slotLabel(slot);
      if (frames.length > 1) img.dataset.anim = slot;  // tick에서 프레임을 넘긴다
      area.append(img);
    } else {
      area.append(el("div", "slot-empty", "이미지를 끌어다 놓거나\n눌러서 고르기"));
    }
    const parts: HTMLElement[] = [area];

    if (frames.length) {
      const strip = el("div", "frames");
      for (const f of frames) {
        const fr = el("div", "frame");
        fr.draggable = true;
        fr.dataset.file = f.file;
        fr.title = "끌어서 순서 바꾸기";
        const img = el("img");
        img.src = f.url;
        img.alt = "";
        const x = el("button", "frame-x", "×");
        x.type = "button";
        x.title = "이 프레임 지우기";
        x.dataset.act = "remove-frame";
        x.dataset.file = f.file;
        fr.append(img, x);
        strip.append(fr);
      }
      const add = el("button", "frame-add", "+");
      add.type = "button";
      add.title = "프레임 더 넣기 (끌어다 놓아도 돼요)";
      add.dataset.act = "append";
      strip.append(add);
      parts.push(strip);
    }

    const foot = el("div", "slot-foot");
    foot.append(el("span", "", slotLabel(slot)), el("span", "grow"));
    if (frames.length > 1) {
      const sel = el("select", "fps");
      sel.title = "1초에 몇 장 넘길지";
      const now = draft.frameRate[slot] ?? defaultFps(slot);
      for (const n of fpsChoices.includes(now) ? fpsChoices : [...fpsChoices, now].sort((a, b) => a - b)) {
        const o = el("option", "", `${n}장/초`);
        o.value = String(n);
        o.selected = n === now;
        sel.append(o);
      }
      sel.addEventListener("change", () => { draft!.frameRate[slot] = Number(sel.value); changed(); });
      foot.append(sel);
    }
    if (frames.length) {
      const adj = el("button", adjustOpen === slot ? "on" : "", "조절");
      adj.type = "button";
      adj.title = "그림 위치·크기 맞추기";
      adj.dataset.act = "adjust";
      const rm = el("button", "", "지우기");
      rm.type = "button";
      rm.dataset.act = "clear";
      foot.append(adj, rm);
    }
    parts.push(foot);
    if (frames.length && adjustOpen === slot) parts.push(adjustPanel(slot));
    box.classList.toggle("adjusting", adjustOpen === slot && frames.length > 0);
    box.replaceChildren(...parts);
  }

  /** 그림 안에서 캐릭터가 치우쳐 있을 때 위치·크기를 맞추는 슬라이더 */
  function adjustPanel(slot: ImageSlot): HTMLElement {
    const box = el("div", "adjust");
    const get = (): ImageAdjust => draft!.imageAdjust[slot] ?? { x: 0, y: 0, scale: 1 };
    const set = (a: ImageAdjust) => {
      if (a.x === 0 && a.y === 0 && a.scale === 1 && !a.snap) delete draft!.imageAdjust[slot];
      else draft!.imageAdjust[slot] = a;
      changed();
    };
    const rows: { label: string; min: number; max: number; step: number; read: (a: ImageAdjust) => number; write: (a: ImageAdjust, v: number) => ImageAdjust; show: (v: number) => string }[] = [
      // 가로를 손으로 바꾸면 "화면 끝에 맞추기"는 풀린다
      { label: "가로", min: -100, max: 100, step: 1, read: (a) => a.x, write: (a, v) => (v === a.x ? a : { ...a, x: v, snap: false }), show: (v) => `${v > 0 ? "+" : ""}${v}%` },
      { label: "세로", min: -100, max: 100, step: 1, read: (a) => a.y, write: (a, v) => ({ ...a, y: v }), show: (v) => `${v > 0 ? "+" : ""}${v}%` },
      { label: "크기", min: 30, max: 300, step: 5, read: (a) => Math.round(a.scale * 100), write: (a, v) => ({ ...a, scale: v / 100 }), show: (v) => `${v}%` },
    ];
    const inputs: HTMLInputElement[] = [];
    for (const row of rows) {
      const line = el("label", "adjust-row");
      const input = el("input");
      input.type = "range";
      input.min = String(row.min);
      input.max = String(row.max);
      input.step = String(row.step);
      input.value = String(row.read(get()));
      const v = el("span", "v", row.show(Number(input.value)));
      input.addEventListener("input", () => {
        v.textContent = row.show(Number(input.value));
        set(row.write(get(), Number(input.value)));
        if (slot === "peek" && row.label === "크기") void resnapPeek();
      });
      inputs.push(input);
      line.append(el("span", "", row.label), input, v);
      box.append(line);
    }
    const foot = el("div", "adjust-foot");
    if (slot === "peek") {
      const snap = el("button", "", "화면 끝에 딱 맞추기");
      snap.type = "button";
      snap.title = "그림의 오른쪽 끝(투명한 부분 빼고)을 화면 끝에 맞춰요";
      snap.addEventListener("click", async () => {
        const x = await snapPeekX();
        if (x === null) { toast("그림 범위를 못 읽었어요"); return; }
        inputs[0].value = String(x);
        inputs[0].dispatchEvent(new Event("input"));
        set({ ...get(), x, snap: true });
        toast("화면 끝에 맞췄어요. 깊이나 크기를 바꾸면 다시 맞춰요");
      });
      box.append(snap);
    }
    const reset = el("button", "", "처음대로");
    reset.type = "button";
    reset.addEventListener("click", () => {
      set({ x: 0, y: 0, scale: 1 });
      rows.forEach((row, i) => { inputs[i].value = String(row.read(get())); inputs[i].dispatchEvent(new Event("input")); });
    });
    foot.append(el("span", "", slot === "peek" ? "오른쪽 미리보기의 화면 끝에 맞춰보세요" : "오른쪽 미리보기를 보며 맞춰보세요"), reset);
    box.append(foot);
    return box;
  }

  /** 빼꼼 그림의 오른쪽 끝이 화면 끝에 오도록 하는 가로 조절값(%).
   *  캐릭터 가운데 = 화면 끝 + size×(깊이-0.5). 그림은 size×size 상자에 contain으로 들어가고, 크기 조절은 아래 가운데 기준 */
  async function snapPeekX(): Promise<number | null> {
    if (!cur || !draft) return null;
    const frame = cur.skin["peek"]?.[0];
    if (!frame) return null;
    const b = await studio.imageBounds(cur.id, frame.file);
    if (!b) return null;
    const size = draft.size, k = draft.imageAdjust["peek"]?.scale ?? 1;
    const dw = b.w >= b.h ? size : size * (b.w / b.h);   // contain으로 보이는 가로 폭
    const right = (size - dw) / 2 + b.right * dw;         // 상자 왼쪽에서 그림 오른쪽 끝까지
    const ax = -size * (draft.behavior.peekDepth - 0.5) - k * (right - size / 2);
    return Math.round(Math.max(-100, Math.min(100, (ax / size) * 100)));
  }

  /** "화면 끝에 맞추기"를 쓴 빼꼼 그림이면 깊이·크기가 바뀔 때 x를 다시 맞춘다 */
  async function resnapPeek(): Promise<void> {
    if (!draft?.imageAdjust["peek"]?.snap) return;
    const x = await snapPeekX();
    const a = draft.imageAdjust["peek"];
    if (x === null || !a?.snap || a.x === x) return;
    draft.imageAdjust["peek"] = { ...a, x };
    changed();
    // 슬라이더를 끄는 중일 수 있으니 패널을 다시 그리지 않고 가로 값만 바꾼다
    const row = document.querySelector<HTMLElement>(".slot[data-slot=peek] .adjust .adjust-row");
    const input = row?.querySelector("input");
    if (row && input) { input.value = String(x); row.querySelector(".v")!.textContent = `${x > 0 ? "+" : ""}${x}%`; }
  }

  function toggleAdjust(slot: ImageSlot): void {
    adjustOpen = adjustOpen === slot ? null : slot;
    document.querySelectorAll<HTMLElement>(".slot[data-slot]").forEach(renderSlot);
    updatePreview(true);
  }

  /** 잠깐 이 칸을 그 자세로 미리보기 (빼꼼 깊이를 바꾸는 동안 등) */
  function flashFocus(slot: ImageSlot): void {
    focusSlot = slot;
    clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => { focusSlot = null; }, 2500);
  }

  function bindSlot(box: HTMLElement): void {
    const slot = () => box.dataset.slot as ImageSlot;
    box.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      switch (t?.dataset.act) {
        case "replace": void pickImages(slot(), true); break;
        case "append": void pickImages(slot(), false); break;
        case "remove-frame": void removeImage(slot(), t.dataset.file); break;
        case "clear": void removeImage(slot()); break;
        case "adjust": toggleAdjust(slot()); break;
      }
    });
    // 프레임을 끌어서 순서 바꾸기 (같은 칸 안에서만)
    box.addEventListener("dragstart", (e) => {
      const fr = (e.target as HTMLElement).closest<HTMLElement>(".frame");
      if (!fr || !e.dataTransfer) return;
      dragFrame = { slot: slot(), file: fr.dataset.file! };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", fr.dataset.file!);
      fr.classList.add("dragging");
    });
    box.addEventListener("dragend", () => {
      dragFrame = null;
      box.querySelectorAll(".frame").forEach((f) => f.classList.remove("dragging", "drop-before", "drop-after"));
    });
    const dropSpot = (e: DragEvent): { fr: HTMLElement; after: boolean } | null => {
      const fr = (e.target as HTMLElement).closest<HTMLElement>(".frame");
      if (!fr) return null;
      const r = fr.getBoundingClientRect();
      return { fr, after: e.clientX > r.left + r.width / 2 };
    };
    box.addEventListener("dragover", (e) => {
      if (dragFrame) {
        if (dragFrame.slot !== slot()) return;
        e.preventDefault();
        const spot = dropSpot(e);
        box.querySelectorAll(".frame").forEach((f) => {
          f.classList.toggle("drop-before", f === spot?.fr && !spot.after);
          f.classList.toggle("drop-after", f === spot?.fr && spot.after);
        });
        return;
      }
      e.preventDefault();
      box.classList.add("drag");
      box.querySelectorAll(".frame-add").forEach((a) => a.classList.toggle("drag", a === (e.target as HTMLElement).closest(".frame-add")));
    });
    box.addEventListener("dragleave", (e) => {
      if (!box.contains(e.relatedTarget as Node)) box.classList.remove("drag");
    });
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("drag");
      if (dragFrame) {
        const spot = dropSpot(e);
        const moving = dragFrame;
        dragFrame = null;
        if (spot && moving.slot === slot() && spot.fr.dataset.file !== moving.file) void moveFrame(moving.slot, moving.file, spot.fr.dataset.file!, spot.after);
        return;
      }
      const append = !!(e.target as HTMLElement).closest(".frame-add, .frames");
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void dropImages(slot(), files, !append);
    });
  }

  async function afterImage(skin: SkinMap): Promise<void> {
    if (!cur) return;
    cur.skin = skin;
    document.querySelectorAll<HTMLElement>(".slot[data-slot]").forEach(renderSlot);
    renderMoodList();
    updatePreview(true);
    await refreshList();
  }

  async function dropImages(slot: ImageSlot, files: File[], replace: boolean): Promise<void> {
    if (!cur) return;
    if (files.some((f) => !/\.(png|gif|jpe?g|webp)$/i.test(f.name))) { toast("png, gif, jpg, webp 이미지만 넣을 수 있어요"); return; }
    try {
      const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
      await afterImage(await studio.addImages(cur.id, slot, data, replace));
      toast(files.length > 1 ? `${slotLabel(slot)}에 ${files.length}장을 넣었어요` : `${slotLabel(slot)} 이미지를 넣었어요`);
    } catch (e) { toast(errText(e)); }
  }

  async function pickImages(slot: ImageSlot, replace: boolean): Promise<void> {
    if (!cur) return;
    try {
      const skin = await studio.pickImages(cur.id, slot, replace);
      if (skin) await afterImage(skin);
    } catch (e) { toast(errText(e)); }
  }

  async function moveFrame(slot: ImageSlot, file: string, target: string, after: boolean): Promise<void> {
    if (!cur) return;
    const order = (cur.skin[slot] ?? []).map((f) => f.file).filter((f) => f !== file);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, file);
    try { await afterImage(await studio.reorderFrames(cur.id, slot, order)); } catch (e) { toast(errText(e)); }
  }

  async function removeImage(slot: ImageSlot, file?: string): Promise<void> {
    if (!cur) return;
    try { await afterImage(await studio.removeImage(cur.id, slot, file)); } catch (e) { toast(errText(e)); }
  }

  // MARK: - 의사소통

  function fillSpeech(): void {
    if (!draft) return;
    const sp = draft.speech;
    const mark = (groupId: string, value: string) =>
      $(groupId).querySelectorAll<HTMLElement>("[data-value]").forEach((b) => b.classList.toggle("selected", b.dataset.value === value));
    mark("f-mode", sp.mode);
    mark("f-politeness", sp.politeness);
    mark("f-length", sp.length);
    document.querySelectorAll<HTMLElement>("[data-free-only]").forEach((s) => s.classList.toggle("off", sp.mode === "lines"));
  }

  function bindChoice(groupId: string, apply: (value: string) => void): void {
    $(groupId).querySelectorAll<HTMLElement>("[data-value]").forEach((b) => {
      b.addEventListener("click", () => {
        if (!draft) return;
        apply(b.dataset.value!);
        fillSpeech();
        fillMoodEditor();
        changed();
      });
    });
  }

  // MARK: - 행동

  function speedLabel(v: number): string {
    return `${v}px/초 · ${v < 40 ? "느릿느릿" : v < 90 ? "보통" : v < 160 ? "빠름" : "후다닥"}`;
  }

  function fillBehavior(): void {
    if (!draft) return;
    const b = draft.behavior;
    $<HTMLInputElement>("b-roam").checked = b.roam;
    $<HTMLInputElement>("b-speed").value = String(b.speed);
    $("b-speed-value").textContent = speedLabel(b.speed);
    $<HTMLInputElement>("b-walk").checked = b.walk;
    $<HTMLInputElement>("b-corner").checked = b.corner;
    $<HTMLInputElement>("b-peek").checked = b.peek;
    const mark = (groupId: string, value: string) =>
      $(groupId).querySelectorAll<HTMLElement>("[data-value]").forEach((x) => x.classList.toggle("selected", x.dataset.value === value));
    mark("b-activity", b.activity);
    mark("b-side", b.cornerSide);
    mark("b-facing", b.facing);
    mark("b-area", b.area);
    $<HTMLInputElement>("b-peek-depth").value = String(Math.round(b.peekDepth * 100));
    $("b-peek-depth-value").textContent = `${Math.round(b.peekDepth * 100)}%`;
    mark("b-gait", b.gait);
    document.querySelectorAll<HTMLElement>("[data-roam-only]").forEach((x) => x.classList.toggle("off", !b.roam));
  }

  function bindBehavior(): void {
    const set = (fn: (b: Behavior) => void) => { if (!draft) return; fn(draft.behavior); fillBehavior(); changed(); };
    $<HTMLInputElement>("b-roam").addEventListener("change", (e) => set((b) => { b.roam = (e.target as HTMLInputElement).checked; }));
    $<HTMLInputElement>("b-speed").addEventListener("input", (e) => set((b) => { b.speed = Number((e.target as HTMLInputElement).value); }));
    for (const key of ["walk", "corner", "peek"] as const) {
      $<HTMLInputElement>(`b-${key}`).addEventListener("change", (e) => {
        const box = e.target as HTMLInputElement;
        if (!draft) return;
        const others = (["walk", "corner", "peek"] as const).filter((k) => k !== key && draft!.behavior[k]).length;
        if (!box.checked && others === 0) { box.checked = true; toast("행동은 하나 이상 켜져 있어야 해요"); return; }
        set((b) => { b[key] = box.checked; });
      });
    }
    const choice = (groupId: string, apply: (b: Behavior, v: string) => void) =>
      $(groupId).querySelectorAll<HTMLElement>("[data-value]").forEach((x) =>
        x.addEventListener("click", () => set((b) => apply(b, x.dataset.value!))));
    choice("b-activity", (b, v) => { b.activity = v as Behavior["activity"]; });
    choice("b-side", (b, v) => { b.cornerSide = v as Behavior["cornerSide"]; });
    choice("b-facing", (b, v) => { b.facing = v as Behavior["facing"]; });
    choice("b-area", (b, v) => { b.area = v as Behavior["area"]; demo.x = 0; demo.y = 0; demo.restUntil = 0; });
    choice("b-gait", (b, v) => { b.gait = v as Behavior["gait"]; });
    $<HTMLInputElement>("b-peek-depth").addEventListener("input", (e) => {
      flashFocus("peek");
      set((b) => { b.peekDepth = Number((e.target as HTMLInputElement).value) / 100; });
      void resnapPeek();
    });
  }

  // MARK: - 스킬 (캐릭터 전용 Claude Code 스킬)

  async function loadSkills(): Promise<void> {
    if (!cur) return;
    skills = await studio.skills(cur.id);
    selSkill = skills[0]?.name ?? null;
    renderSkills();
  }

  function renderSkills(): void {
    $("skill-list").replaceChildren(...skills.map((k) => {
      const li = el("li");
      const b = el("button", "mood-item" + (k.name === selSkill ? " selected" : ""));
      b.type = "button";
      b.title = k.description;
      b.append(el("span", "mood-effect", "🧩"), el("span", "mood-name", k.name));
      b.addEventListener("click", () => { selSkill = k.name; renderSkills(); });
      li.append(b);
      return li;
    }));
    const k = skills.find((x) => x.name === selSkill);
    $<HTMLInputElement>("sk-name").value = k?.name ?? "";
    $<HTMLTextAreaElement>("sk-desc").value = k?.description ?? "";
    $<HTMLTextAreaElement>("sk-body").value = k?.body ?? "";
    $<HTMLButtonElement>("sk-delete").hidden = !k;
    $("sk-status").textContent = k ? `~/Desktop-pet/${cur?.id}/.claude/skills/${k.name}/SKILL.md` : "새 스킬";
  }

  function bindSkills(): void {
    $("skill-new").addEventListener("click", () => {
      selSkill = null;
      renderSkills();
      $<HTMLInputElement>("sk-name").focus();
    });
    $("sk-save").addEventListener("click", async () => {
      if (!cur) return;
      const skill: StudioSkill = {
        name: $<HTMLInputElement>("sk-name").value.trim().toLowerCase(),
        description: $<HTMLTextAreaElement>("sk-desc").value.trim(),
        body: $<HTMLTextAreaElement>("sk-body").value,
      };
      try {
        skills = await studio.saveSkill(cur.id, skill, selSkill);
        selSkill = skill.name;
        renderSkills();
        toast(cur.active ? "스킬을 저장했어요. 펫이 바로 알아요" : "스킬을 저장했어요");
      } catch (e) { toast(errText(e)); }
    });
    $("sk-delete").addEventListener("click", async () => {
      if (!cur || !selSkill || !confirm(`"${selSkill}" 스킬을 지울까요?`)) return;
      skills = await studio.deleteSkill(cur.id, selSkill);
      selSkill = skills[0]?.name ?? null;
      renderSkills();
      toast("스킬을 지웠어요");
    });
    $("sk-folder").addEventListener("click", () => { if (cur) studio.openSkillsFolder(cur.id); });
  }

  // MARK: - 반응 규칙

  type RuleNum = { key: keyof Reactions; min: number; max: number };
  const reactionRules: { key: keyof Reactions; title: string; desc: string; parts?: (string | RuleNum)[] }[] = [
    { key: "greet", title: "처음 인사", desc: "펫이 켜지거나 캐릭터를 바꿨을 때 인사해요." },
    { key: "appSwitch", title: "앱을 바꿀 때 한마디", desc: "자주 일어나서 AI 없이 미리 써둔 대사로 반응해요. 정해진 대사 방식이면 \"앱 이름 + 대사\"로 말해요." },
    {
      key: "nag", title: "딴짓 잔소리", desc: "게임·유튜브 같은 놀이 앱을 오래 쓰면 그만하라고 해요.",
      parts: ["놀이 앱을", { key: "nagAfter", min: 1, max: 120 }, "분 넘게 쓰면", { key: "nagEvery", min: 1, max: 60 }, "분마다"],
    },
    {
      key: "rest", title: "휴식 권유", desc: "쉬지 않고 오래 쓰면 물 마시고 쉬라고 챙겨줘요.",
      parts: [{ key: "restAfter", min: 10, max: 180 }, "분 동안 쉬지 않고 쓰면"],
    },
    {
      key: "away", title: "자리 비움 · 복귀", desc: "입력이 없으면 꾸벅꾸벅 졸고, 돌아오면 반겨줘요. AI 없이 졸림·놀람 대사로 말해요. 반응을 꺼도 이 시간이 지나면 돌아다니지 않아요.",
      parts: ["입력이", { key: "awayAfter", min: 1, max: 30 }, "분 동안 없으면"],
    },
    {
      key: "chatter", title: "먼저 말 걸기", desc: "조용할 때 가끔 먼저 한마디 해요.",
      parts: [{ key: "chatterEvery", min: 3, max: 120 }, "분마다"],
    },
  ];

  function renderReactions(): void {
    if (!draft) return;
    const d = draft;
    const rx = draft.reactions as unknown as Record<string, number | boolean>;
    $("r-list").replaceChildren(...reactionRules.map((rule) => {
      const card = el("div", "action-card rule-card" + (rx[rule.key] ? "" : " off"));
      const head = el("label", "toggle-card");
      const text = el("span");
      text.append(el("span", "card-title", rule.title), el("span", "card-desc", rule.desc));
      const sw = el("span", "switch");
      const box = el("input");
      box.type = "checkbox";
      box.checked = !!rx[rule.key];
      box.addEventListener("change", () => {
        rx[rule.key] = box.checked;
        card.classList.toggle("off", !box.checked);
        changed();
      });
      sw.append(box, el("span", "switch-track"));
      head.append(text, sw);
      card.append(head);
      if (rule.parts) {
        const detail = el("div", "rule-detail");
        for (const part of rule.parts) {
          if (typeof part === "string") { detail.append(el("span", "", part)); continue; }
          const n = el("input", "num");
          n.type = "number";
          n.min = String(part.min);
          n.max = String(part.max);
          n.value = String(rx[part.key]);
          n.addEventListener("input", () => {
            const v = Number(n.value);
            if (n.value !== "" && Number.isFinite(v) && v >= part.min && v <= part.max) { rx[part.key] = Math.round(v); changed(); }
          });
          n.addEventListener("change", () => {  // 범위 밖이면 맞춰줌
            const v = Math.round(Math.min(part.max, Math.max(part.min, Number(n.value) || part.min)));
            n.value = String(v);
            if (rx[part.key] !== v) { rx[part.key] = v; changed(); }
          });
          detail.append(n);
        }
        card.append(detail);
      }
      // 정해진 대사 + AI로 말하기 (인사·잔소리·휴식 권유·먼저 말 걸기)
      if (isReactionKind(rule.key)) card.append(reactionLines(d, rule.key));
      return card;
    }));
  }

  const isReactionKind = (k: string): k is ReactionKind => ["greet", "nag", "rest", "chatter"].includes(k);

  /** 반응 하나의 대사 칸들과 "AI로 말하기" 스위치 */
  function reactionLines(d: CharacterProfile, kind: ReactionKind): HTMLElement {
    const box = el("div", "rule-lines");
    const head = el("div", "rule-lines-head");
    head.append(el("span", "", "대사"), el("span", "count", "{앱} {분} {이름}은 실제 값으로 바뀌어요. 하나를 무작위로 골라요"));
    const list = el("div", "line-list");
    const read = () => {
      d.reactions.lines[kind] = [...list.querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean);
      changed();
    };
    const draw = (items: string[], focus = -1) => {
      list.replaceChildren(...items.map((text, i) => {
        const row = el("div", "line-item");
        const t = el("textarea", "input");
        t.rows = 1;
        t.value = text;
        t.placeholder = "대사";
        t.addEventListener("input", () => { fitHeight(t); read(); });
        const x = el("button", "line-x", "×");
        x.type = "button";
        x.addEventListener("click", () => {
          const all = [...list.querySelectorAll("textarea")].map((a) => a.value);
          all.splice(i, 1);
          draw(all.length ? all : [""], Math.min(i, all.length - 1));
          read();
        });
        row.append(el("span", "line-n", String(i + 1)), t, x);
        return row;
      }));
      list.querySelectorAll("textarea").forEach(fitHeight);
      if (focus >= 0) list.querySelectorAll("textarea")[focus]?.focus();
    };
    draw(d.reactions.lines[kind].length ? [...d.reactions.lines[kind]] : [""]);
    const add = el("button", "btn small line-add", "+ 대사 추가");
    add.type = "button";
    add.addEventListener("click", () => {
      const all = [...list.querySelectorAll("textarea")].map((a) => a.value);
      draw([...all, ""], all.length);
    });
    const ai = el("label", "check-row ai-row");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = d.reactions.ai[kind];
    cb.addEventListener("change", () => { d.reactions.ai[kind] = cb.checked; changed(); });
    const t = el("span");
    t.append(el("span", "card-title", "AI로 말하기"),
      el("span", "card-desc", "위 대사 대신 AI가 상황에 맞게 그때그때 말해요. 매번 달라지지만 한 번에 수만 토큰씩 구독 사용량을 써요."));
    ai.append(cb, t);
    box.append(head, list, add, ai);
    return box;
  }

  // MARK: - 감정 표현

  /** 평상시 기분 비율 막대 색 (감정 순서대로) */
  const weightColors = ["#f0587c", "#f59f45", "#8a7cf0", "#6aa6d8", "#f2c94c", "#5bb8b0", "#e0605a", "#d77fd0"];

  function renderWeights(): void {
    if (!draft) return;
    const d = draft;
    const total = () => meta.moods.reduce((s, m) => s + (d.moods[m.id].enabled ? d.moodWeights[m.id] : 0), 0);
    const pctText = (id: Mood) => {
      const t = total();
      return !d.moods[id].enabled ? "꺼짐" : t ? `${Math.round((d.moodWeights[id] / t) * 100)}%` : "0%";
    };
    const bar = () => {
      const t = total();
      $("w-bar").replaceChildren(...meta.moods.map((m, i) => {
        const seg = el("span");
        seg.style.width = t && d.moods[m.id].enabled ? `${(d.moodWeights[m.id] / t) * 100}%` : "0";
        seg.style.background = weightColors[i % weightColors.length];
        seg.title = `${m.label} ${pctText(m.id)}`;
        return seg;
      }));
    };
    const pcts: HTMLElement[] = [];
    $("w-list").replaceChildren(...meta.moods.map((m, i) => {
      const row = el("label", "w-row" + (d.moods[m.id].enabled ? "" : " off"));
      const dot = el("span", "w-dot");
      dot.style.background = weightColors[i % weightColors.length];
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.step = "5";
      input.value = String(d.moodWeights[m.id]);
      input.disabled = !d.moods[m.id].enabled;
      const pct = el("span", "w-pct", pctText(m.id));
      pcts.push(pct);
      input.addEventListener("input", () => {
        d.moodWeights[m.id] = Number(input.value);
        meta.moods.forEach((x, j) => { pcts[j].textContent = pctText(x.id); });  // 합이 바뀌니 전부 다시
        bar();
        changed();
      });
      row.append(dot, el("span", "", m.label), input, pct);
      return row;
    }));
    bar();
  }

  function renderMoodList(): void {
    if (!draft) return;
    const d = draft;
    $("mood-list").replaceChildren(...meta.moods.map((m) => {
      const st = d.moods[m.id];
      const li = el("li");
      const b = el("button", "mood-item" + (m.id === selMood ? " selected" : "") + (st.enabled ? "" : " disabled"));
      b.type = "button";
      const fx = el("span", "mood-effect", st.effect || "·");
      fx.style.color = st.effectColor;
      b.append(fx, el("span", "mood-name", m.label), el("span", "mood-n", st.lines.length ? `${st.lines.length}개` : ""));
      b.addEventListener("click", () => {
        selMood = m.id;
        if (adjustOpen && meta.moods.some((x) => x.id === adjustOpen)) adjustOpen = null;
        renderMoodList();
        fillMoodEditor();
        setPreviewMood(m.id);
      });
      li.append(b);
      return li;
    }));
  }

  function fillMoodEditor(): void {
    if (!draft) return;
    const st = draft.moods[selMood];
    $("m-title").textContent = moodLabel(selMood);
    $("m-sub").textContent = `AI가 고르는 감정 태그: [${selMood}]`;
    $<HTMLInputElement>("m-enabled").checked = st.enabled;
    const slotBox = $("m-slot");
    slotBox.dataset.slot = selMood;
    renderSlot(slotBox);

    $("m-motion").replaceChildren(...motionKinds.map((k) => {
      const c = el("button", "chip" + (k.id === st.motion ? " selected" : ""), k.label);
      c.type = "button";
      c.addEventListener("click", () => { st.motion = k.id; fillMoodEditor(); updatePreview(); changed(); });
      return c;
    }));

    $<HTMLInputElement>("m-effect").value = st.effect;
    $<HTMLInputElement>("m-color").value = st.effectColor;
    $("m-effect-picks").replaceChildren(...effectPicks.map((fx) => {
      const c = el("button", "chip small" + (fx === st.effect ? " selected" : ""), fx || "없음");
      c.type = "button";
      c.addEventListener("click", () => { st.effect = fx; fillMoodEditor(); renderMoodList(); changed(); });
      return c;
    }));

    // 대사 칸을 쓰는 중이면 다시 그리지 않는다 (입력이 끊기지 않게)
    if (!$("m-lines").contains(document.activeElement)) renderLineItems(st.lines.length ? [...st.lines] : [""]);
    $("m-count").textContent = st.lines.length ? `${st.lines.length}개` : "";
    $("m-lines-hint").textContent = draft.speech.mode === "lines"
      ? "이 감정일 때 여기서만 골라 말해요. 비어 있으면 다른 감정의 대사를 빌려 써요."
      : "AI에게 이 감정일 때의 말투 예시로 보여줘요. 비워둬도 돼요.";
  }

  // MARK: - 대사 칸 (대사 하나에 칸 하나)

  /** 칸 높이를 내용에 맞춘다 (칸 안에서 Enter로 줄바꿈하면 늘어남) */
  function fitHeight(t: HTMLTextAreaElement): void {
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 2}px`;
  }

  /** 지금 칸들의 내용을 그 감정의 대사로 (빈 칸은 빼고) */
  function readLineItems(): void {
    if (!draft) return;
    const st = draft.moods[selMood];
    st.lines = [...$("m-lines").querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean);
    $("m-count").textContent = st.lines.length ? `${st.lines.length}개` : "";
    renderMoodList();
    changed();
  }

  function renderLineItems(items: string[], focusIndex = -1): void {
    const list = $("m-lines");
    list.replaceChildren(...items.map((text, i) => {
      const row = el("div", "line-item");
      const t = el("textarea", "input");
      t.rows = 1;
      t.value = text;
      t.placeholder = "대사";
      t.spellcheck = false;
      t.addEventListener("input", () => { fitHeight(t); readLineItems(); });
      const x = el("button", "line-x", "×");
      x.type = "button";
      x.title = "이 대사 지우기";
      x.addEventListener("click", () => {
        const all = [...list.querySelectorAll("textarea")].map((a) => a.value);
        all.splice(i, 1);
        renderLineItems(all.length ? all : [""], Math.min(i, all.length - 1));
        readLineItems();
      });
      row.append(el("span", "line-n", String(i + 1)), t, x);
      return row;
    }));
    list.querySelectorAll("textarea").forEach(fitHeight);
    if (focusIndex >= 0) list.querySelectorAll("textarea")[focusIndex]?.focus();
  }

  function addLineItem(): void {
    const all = [...$("m-lines").querySelectorAll("textarea")].map((a) => a.value);
    // 마지막 칸이 비어 있으면 거기로 가고, 아니면 새 칸
    if (all.length && !all[all.length - 1].trim()) { renderLineItems(all, all.length - 1); return; }
    renderLineItems([...all, ""], all.length);
  }

  // MARK: - 미리보기

  let blink = false;
  let line = "";

  function renderPreviewMoods(): void {
    if (!draft) return;
    const d = draft;
    $("p-moods").replaceChildren(...meta.moods.map((m) => {
      const c = el("button", "chip" + (m.id === previewMood ? " selected" : "") + (d.moods[m.id].enabled ? "" : " off"), m.label);
      c.type = "button";
      c.addEventListener("click", () => {
        setPreviewMood(m.id);
        if (tab === "moods") { selMood = m.id; renderMoodList(); fillMoodEditor(); }
      });
      return c;
    }));
  }

  function setPreviewMood(m: Mood): void {
    previewMood = m;
    renderPreviewMoods();
    updatePreview(true);
  }

  /** 지금 감정에서 할 법한 대사 하나 (펫과 같은 규칙: 대사 → 다른 감정 대사(정해진 대사 방식) → 기본 예시) */
  function pickLine(): string {
    if (!draft) return "";
    const own = draft.moods[previewMood].lines;
    const pool = own.length ? own
      : draft.speech.mode === "lines" ? meta.moods.flatMap((m) => (draft!.moods[m.id].enabled ? draft!.moods[m.id].lines : []))
      : [];
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    return meta.moods.find((m) => m.id === previewMood)?.sample ?? "";
  }

  /** 행동 탭에서 무대 위를 왔다 갔다 하는 걷기 시범. 오른쪽 끝에선 구경하기, 왼쪽 끝에선 빼꼼 자세로 잠깐 쉰다 */
  const demo = { x: 0, y: 0, tx: 0, ty: 0, dir: 1 as -1 | 1, restUntil: 0, last: 0 };

  function demoPose(): Pose {
    if (tab !== "behavior" || !draft?.behavior.roam || demoWalking() || demo.x === 0) return "rest";
    if (draft.behavior.area !== "floor") return "rest";
    if (demo.x > 0) return draft.behavior.corner ? "watch" : "rest";
    return draft.behavior.peek ? "peek" : "rest";
  }

  function demoWalking(): boolean {
    if (adjustOpen || focusSlot) return false;
    return tab === "behavior" && !!draft?.behavior.roam && performance.now() >= demo.restUntil;
  }

  function updatePreview(newLine = false): void {
    if (!cur || !draft) return;
    $("p-pet").style.setProperty("--size", `${draft.size}px`);
    $("p-name").textContent = draft.name;
    drawPreview(performance.now() / 1000);
    if (newLine && Date.now() >= bubbleHold) showBubble(pickLine());
  }

  function showBubble(text: string): void {
    line = text;
    const b = $("p-bubble");
    b.textContent = text;
    b.style.animation = "none";
    void b.offsetWidth;  // 말풍선 튀어나오는 애니메이션 다시
    b.style.animation = "";
  }

  /** 미리보기에 지금 보이는 이미지 칸 (위치·크기 조절을 찾을 때) */
  let shownSlot: string | null = null;

  /** 미리보기 그림: 펫과 같은 규칙으로 프레임을 고른다. 조절 중인 칸이 있으면 그 칸 */
  function drawPreview(t: number): void {
    if (!cur || !draft) return;
    const focus = adjustOpen ?? focusSlot;
    const pick = focus && cur.skin[focus]?.length ? { slot: focus as string, frames: cur.skin[focus] }
      : pickFrames(cur.skin, previewMood, blink, demoWalking(), demoPose());
    shownSlot = pick?.slot ?? null;
    const img = $<HTMLImageElement>("p-skin");
    const svg = document.getElementById("p-creature") as unknown as SVGSVGElement;
    if (pick) {
      const src = frameAt(pick.frames, draft.frameRate[pick.slot as ImageSlot] ?? defaultFps(pick.slot), t).url;
      if (img.getAttribute("src") !== src) img.src = src;
      img.hidden = false;
      svg.setAttribute("hidden", "");
    } else {
      img.hidden = true;
      svg.removeAttribute("hidden");
      const face = previewMood + blink;
      if (svg.dataset.face !== face) { svg.dataset.face = face; svg.innerHTML = creatureSvg(previewMood, blink); }
    }
  }

  function tick(now: number): void {
    const t = now / 1000;
    if (draft && cur) {
      // 걷기 시범: 무대 끝까지 걸어가서 잠깐 쉬고 돌아선다
      const pet = $("p-pet");
      const walking = demoWalking();
      const focus = adjustOpen ?? focusSlot;
      const stageEl = pet.parentElement!;
      stageEl.classList.toggle("focus", focus === "peek" || focus === "watch");
      $("p-edge").hidden = focus !== "peek";
      let focusDir: -1 | 0 | 1 | null = null;
      if (focus === "peek") {
        // 무대 오른쪽 끝 = 화면 끝. 펫처럼 캐릭터 가운데를 끝에서 peekDepth만큼 밖으로
        demo.x = stageEl.clientWidth / 2 + draft.size * (draft.behavior.peekDepth - 0.5);
        demo.y = 0;
        focusDir = -1;  // 화면 안쪽을 봄
      } else if (focus === "watch") {
        demo.x = Math.max(0, (stageEl.clientWidth - pet.offsetWidth) / 2 - 8);
        demo.y = 0;
        focusDir = 1;
      } else if (tab === "behavior" && draft.behavior.roam) {
        const dt = demo.last ? Math.min(0.1, t - demo.last) : 0;
        const stage = stageEl;
        const limit = Math.max(0, (stage.clientWidth - pet.offsetWidth) / 2 - 8);
        if (draft.behavior.area === "floor") {
          // 바닥: 무대 끝까지 걸어가서 잠깐 쉬고 돌아선다
          demo.y = 0;
          if (walking) {
            demo.x += demo.dir * draft.behavior.speed * dt;
            if (Math.abs(demo.x) >= limit) {
              demo.x = Math.sign(demo.x) * limit;
              demo.dir = (demo.dir * -1) as -1 | 1;
              demo.restUntil = now + 1800;
            }
          }
        } else if (walking) {
          // 화면 전체: 무대 안 아무 데나 골라서 간다
          const up = Math.max(0, stage.clientHeight - pet.offsetHeight - 90);
          const dx = demo.tx - demo.x, dy = demo.ty - demo.y, dist = Math.hypot(dx, dy);
          const step = draft.behavior.speed * dt;
          if (dist <= step) {
            demo.x = demo.tx; demo.y = demo.ty;
            demo.tx = (Math.random() * 2 - 1) * limit;
            demo.ty = -Math.random() * up;
            demo.restUntil = now + 1200;
          } else {
            demo.x += (dx / dist) * step; demo.y += (dy / dist) * step;
          }
          if (Math.abs(demo.tx - demo.x) > 2) demo.dir = demo.tx > demo.x ? 1 : -1;
        }
      } else {
        demo.x = 0; demo.y = 0;
      }
      if (focus && focus !== "peek" && focus !== "watch") { demo.x = 0; demo.y = 0; }
      demo.last = t;
      pet.style.translate = `${demo.x}px ${demo.y}px`;
      (pet.previousElementSibling as HTMLElement).style.translate = `${demo.x}px ${demo.y}px`;  // 말풍선도 같이
      drawPreview(t);
      const img = $<HTMLImageElement>("p-skin");
      const target: HTMLElement | SVGElement = img.hidden ? (document.getElementById("p-creature") as unknown as SVGElement) : img;
      // 쉬는 동안에도 걸어온 쪽을 본다
      const floorTurn = draft.behavior.area === "floor" && !walking;  // 바닥 시범은 끝에서 이미 돌아섰으니 쉬는 동안은 걸어온 쪽
      const facingDir = focusDir ?? (tab === "behavior" && draft.behavior.roam ? (floorTurn ? -demo.dir : demo.dir) : 0) as -1 | 0 | 1;
      applyMotion(target, $("p-mark"), draft.moods[previewMood], t, {
        walking: walking && !focus, gait: draft.behavior.gait,
        flip: shownSlot === "peek" ? facingDir > 0 : shouldFlip(draft.behavior.facing, facingDir),
        adjust: shownSlot ? draft.imageAdjust[shownSlot as ImageSlot] : undefined, size: draft.size,
      });
      // 이미지 칸의 여러 장짜리 그림도 넘긴다
      document.querySelectorAll<HTMLImageElement>(".slot-img img[data-anim]").forEach((im) => {
        const slot = im.dataset.anim as ImageSlot;
        const frames = cur!.skin[slot];
        if (!frames?.length) return;
        const src = frameAt(frames, draft!.frameRate[slot] ?? defaultFps(slot), t).url;
        if (im.getAttribute("src") !== src) im.src = src;
      });
    }
    requestAnimationFrame(tick);
  }

  setInterval(() => {  // 눈 깜빡임
    if (previewMood === "sleepy") return;
    blink = true; updatePreview();
    setTimeout(() => { blink = false; updatePreview(); }, 150);
  }, 3500);
  setInterval(() => updatePreview(true), 3200);  // 대사 바꿔가며 보여주기

  // MARK: - 대화 테스트

  function clearTest(): void {
    testHistory = [];
    bubbleHold = 0;
    $("t-log").replaceChildren();
  }

  function logMsg(cls: string, text: string, metaText = ""): void {
    const m = el("div", `t-msg ${cls}`, text);
    if (metaText) m.append(el("span", "t-meta", metaText));
    const log = $("t-log");
    log.append(m);
    log.scrollTop = log.scrollHeight;
  }

  /** 펫과 같은 규칙: 꺼진 감정이면 기쁨 → 첫 번째 켜진 감정 */
  function fixMood(m: Mood): Mood {
    if (draft?.moods[m].enabled) return m;
    return draft?.moods.happy.enabled ? "happy" : firstEnabled();
  }

  /** 정해진 대사 방식이면 그 감정의 대사 중 하나 (없으면 다른 켜진 감정 대사) */
  function fixedLine(m: Mood): string | null {
    if (!draft || draft.speech.mode !== "lines") return null;
    const own = draft.moods[m].lines;
    const all = meta.moods.flatMap((x) => (draft!.moods[x.id].enabled ? draft!.moods[x.id].lines : []));
    const pool = own.length ? own : all;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  async function sendTest(text: string, situationLabel?: string): Promise<void> {
    if (!draft || testBusy || !text.trim()) return;
    testBusy = true;
    $<HTMLButtonElement>("t-send").disabled = true;
    if (situationLabel) logMsg("sit", `(상황) ${situationLabel}`); else logMsg("me", text);
    bubbleHold = Date.now() + 60_000;
    showBubble("…");
    try {
      const r = await studio.testChat(structuredClone(draft), personality, rules, text, testHistory);
      if (r.error) {
        logMsg("err", r.error);
        bubbleHold = 0;
        return;
      }
      testHistory = [...testHistory, { user: text, pet: r.line }].slice(-6);
      const mood = fixMood(r.mood ?? previewMood);
      const shown = r.showText ? r.line : (fixedLine(mood) ?? r.line);  // 펫과 똑같이: 정보 대답([글자])만 글자, 나머진 정해진 대사
      const notes = [`${moodLabel(mood)}`];
      if (r.task) notes.push(`일 부탁으로 알아들음 (${r.task === "easy" ? "쉬운 일" : "어려운 일"}) — 펫에서는 이 말을 일로 넘겨요`);
      else if (shown !== r.line) notes.push(`AI가 고른 감정으로 정해진 대사 중 하나를 말해요`);
      if (situationLabel && r.task) notes.push("상황 반응에 일 태그가 붙으면 펫은 미리 써둔 대사로 바꿔요");
      logMsg("pet", shown, notes.join(" · "));
      setPreviewMood(mood);
      if (tab === "moods") { selMood = mood; renderMoodList(); fillMoodEditor(); }
      bubbleHold = 0;
      showBubble(shown);
      bubbleHold = Date.now() + 6000;
    } catch (e) {
      logMsg("err", errText(e));
      bubbleHold = 0;
    } finally {
      testBusy = false;
      $<HTMLButtonElement>("t-send").disabled = false;
    }
  }

  function bindTest(): void {
    $("t-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>("t-input");
      const text = input.value.trim();
      if (!text || testBusy) return;
      input.value = "";
      void sendTest(text);
    });
    $("t-clear").addEventListener("click", () => clearTest());
    $("t-situations").replaceChildren(...meta.situations.map((sit) => {
      const c = el("button", "chip", sit.label);
      c.type = "button";
      c.title = sit.text;
      c.addEventListener("click", () => {
        const h = new Date().getHours();
        void sendTest(`${sit.text} 지금 시각 ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시.`, sit.label);
      });
      return c;
    }));
  }

  // MARK: - 입력 연결

  function bind(): void {
    document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab!)));

    $<HTMLInputElement>("f-name").addEventListener("input", (e) => {
      if (!draft) return;
      draft.name = (e.target as HTMLInputElement).value;
      renderTitle();
      updatePreview();
      changed();
    });
    $<HTMLInputElement>("f-size").addEventListener("input", (e) => {
      if (!draft) return;
      draft.size = Number((e.target as HTMLInputElement).value);
      void resnapPeek();
      $("f-size-value").textContent = `${draft.size}px`;
      updatePreview();
      changed();
    });
    document.querySelectorAll<HTMLElement>(".slot[data-slot]").forEach(bindSlot);
    bindSlot($("m-slot"));
    bindBehavior();
    bindSkills();
    $<HTMLTextAreaElement>("f-rules").addEventListener("input", (e) => {
      rules = (e.target as HTMLTextAreaElement).value;
      changed();
    });
    $("rules-reset").addEventListener("click", async () => {
      if (!cur || !confirm("규칙을 기본값으로 되돌릴까요? 지금 쓴 내용은 사라져요.")) return;
      rules = await studio.defaultRules(cur.id);
      $<HTMLTextAreaElement>("f-rules").value = rules;
      changed();
    });

    bindChoice("f-mode", (v) => { draft!.speech.mode = v as SpeechStyle["mode"]; });
    bindChoice("f-politeness", (v) => { draft!.speech.politeness = v as SpeechStyle["politeness"]; });
    bindChoice("f-length", (v) => { draft!.speech.length = v as SpeechStyle["length"]; });
    $<HTMLInputElement>("f-habits").addEventListener("input", (e) => {
      if (!draft) return;
      draft.speech.habits = (e.target as HTMLInputElement).value;
      changed();
    });
    $<HTMLTextAreaElement>("f-personality").addEventListener("input", (e) => {
      personality = (e.target as HTMLTextAreaElement).value;
      changed();
    });

    $<HTMLInputElement>("m-enabled").addEventListener("change", (e) => {
      if (!draft) return;
      const box = e.target as HTMLInputElement;
      const others = meta.moods.filter((m) => m.id !== selMood && draft!.moods[m.id].enabled).length;
      if (!box.checked && others === 0) {
        box.checked = true;
        toast("감정은 하나 이상 켜져 있어야 해요");
        return;
      }
      draft.moods[selMood].enabled = box.checked;
      renderWeights();
      renderMoodList();
      renderPreviewMoods();
      changed();
    });
    $<HTMLInputElement>("m-effect").addEventListener("input", (e) => {
      if (!draft) return;
      draft.moods[selMood].effect = (e.target as HTMLInputElement).value.trim();
      renderMoodList();
      $("m-effect-picks").querySelectorAll(".chip").forEach((c, i) => c.classList.toggle("selected", effectPicks[i] === draft!.moods[selMood].effect));
      changed();
    });
    $<HTMLInputElement>("m-color").addEventListener("input", (e) => {
      if (!draft) return;
      draft.moods[selMood].effectColor = (e.target as HTMLInputElement).value;
      renderMoodList();
      changed();
    });
    $("m-add-line").addEventListener("click", () => addLineItem());

    $("p-on-pet").addEventListener("click", async () => {
      await flush();
      studio.showOnPet(previewMood, line);
    });

    $("use-btn").addEventListener("click", async () => {
      if (!cur) return;
      await flush();
      await studio.activate(cur.id);
      cur.active = true;
      await refreshList();
      renderTitle();
      setStatus("saved");
      toast(`이제 ${draft?.name}(이)가 바탕화면에 나와요`);
    });

    $("new-btn").addEventListener("click", async () => {
      await flush();
      const id = await studio.create();
      await refreshList();
      await select(id);
      setTab("basic");
      $<HTMLInputElement>("f-name").select();
    });
    $("dup-btn").addEventListener("click", async () => {
      if (!cur) return;
      await flush();
      const id = await studio.duplicate(cur.id);
      await refreshList();
      await select(id);
      toast("복제했어요");
    });
    $("del-btn").addEventListener("click", async () => {
      if (!cur) return;
      await flush();
      if (!(await studio.remove(cur.id))) return;
      await refreshList();
      const next = list.find((c) => c.active) ?? list[0];
      if (next) await select(next.id);
    });
    $("folder-btn").addEventListener("click", () => { if (cur) studio.openFolder(cur.id); });

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush().then(() => toast("저장했어요"));
      }
    });
    // 이미지 칸 밖에 떨어뜨려도 창이 그 파일로 넘어가지 않게
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());
    window.addEventListener("beforeunload", () => { void flush(); });
  }

  async function init(): Promise<void> {
    bind();
    meta = await studio.meta();
    bindTest();
    await refreshList();
    const first = list.find((c) => c.active) ?? list[0];
    if (first) await select(first.id);
    setTab("basic");
    requestAnimationFrame(tick);
  }

  void init();
})();
