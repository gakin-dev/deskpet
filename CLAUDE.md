# DeskPet

화면 구석에 떠서 사용자가 어떤 앱을 쓰는지 지켜보고, 성격(AI)대로 반응하는 데스크톱 펫.
펫은 따로 AI를 갖지 않고 **사용자의 Claude Code(또는 Codex)에 그대로 연결**한다 — 사용자의 스킬·플러그인·MCP·권한 설정이 그대로 따라오고, 캐릭터 성격만 덧붙임. API 키 없이 구독 로그인(Claude 구독 / ChatGPT 계정)으로 돎. 처음 켤 때 둘 중 하나를 고름. 대화와 일 부탁을 **한 세션**이 처리하고, 대화 기억 = 그 세션의 내역 (캐릭터마다 세션 id 저장, 껐다 켜도 이어짐). (API 키 방식은 없앰)
Electron + TypeScript라서 macOS와 Windows에서 같은 코드로 돈다.

## 빌드 & 실행

```bash
npm install
npm start          # tsc로 빌드한 뒤 electron 실행
npm run typecheck  # 타입 검사만
```

- Node 22 이상. Windows에서도 똑같이 `npm install && npm start`
- Claude Code가 설치돼 있고 로그인돼 있어야 AI가 켜짐 (없으면 미리 써둔 대사로만 동작)
- 종료: 캐릭터 우클릭 → "잘 있어~ (종료)"
- 릴리스: `package.json`의 `version`을 올리고 커밋한 뒤 같은 태그(`v0.3.0` 등)를 푸시하면 GitHub Actions(`.github/workflows/release.yml`)가 윈도우 설치 파일과 맥 앱 zip을 빌드해서 GitHub 릴리스에 올림. 태그와 버전이 다르면 멈춤
- 앱 만들기: `npm run dist` (지금 OS용), `npm run dist:mac` → `out/mac-arm64/DeskPet.app` + `out/DeskPet-<버전>-arm64-mac.zip`, `npm run dist:win` → `out/DeskPet Setup <버전>.exe` (NSIS 설치 파일, 설치 폴더 고르기) + `out/win-unpacked/DeskPet.exe`. electron-builder, 서명 없음, 개인용. 설정은 `package.json`의 `build`. 맥 앱은 맥에서, 윈도우 앱은 윈도우에서 빌드
- 윈도우 제거 = 사용자 데이터까지 전부 지움: `~/.deskpet`, `~/Desktop-pet`, `AppData\Roaming\deskpet`(`deleteAppDataOnUninstall`), `AppData\Local\deskpet-updater`, `~/.claude/projects/*-Desktop-pet-*`(펫 세션의 Claude Code 기록). `build/installer.nsh`의 `customUnInstall`. 새 버전 설치가 옛 버전을 지울 때(`isUpdated`)는 안 지움

## 파일 구조

- `src/main/main.ts` — 메인 프로세스: 상태(PetState), 감시 로직(Watcher), 스킨 로딩, 창 생성, 우클릭 메뉴, IPC
- `src/main/cli.ts` — AI CLI 공용: 환경 변수 정리(`cleanEnv`, Orca의 `CODEX_HOME`도 뺌), 사용자 셸 PATH 빌려오기(`zsh -ilc` — nvm으로 깐 codex도 찾게), 실행 파일 찾기, 터미널 열기
- `src/main/codex.ts` — Codex CLI: 찾기, `codex login status`, `codex exec --json` 실행(`resume <id>`로 이어 말하기), 이벤트 파싱
- `src/main/allow.ts` — 펫 전용 "항상 허용" 목록 (`~/.deskpet/allow.json`)
- `src/main/usage.ts` — 날짜별 AI 사용량 (`~/.deskpet/usage.json`, 최근 60일)
- `src/main/chatwin.ts` — 대화 창 (`renderer/chat.html` + `src/renderer/chatwin.ts`, 통로 `src/chat-preload.ts`의 `window.chatwin`)
- `src/main/setup.ts` — AI 설정 창 (`renderer/setup.html` + `src/renderer/setup.ts`, 통로 `src/setup-preload.ts`의 `window.setup`)
- `src/main/claude.ts` — Claude Code CLI 공용 실행기: claude 위치 찾기(로그인 셸 PATH 빌려오기), `claude -p --output-format stream-json` 한 번 실행(`run`), 켜두고 여러 번 주고받는 세션(`ClaudeSession`), 결과 파싱
- `src/main/brain.ts` — 펫의 머리: 설정 로딩, 캐릭터 프롬프트, 사용자의 Claude Code 세션(또는 Codex 대화방)에 말 걸기·일 시키기, 권한 묻기, 세션 id 저장, 대화·작업 기록
- `src/main/characters.ts` — 캐릭터 폴더 관리(목록, 새로 만들기, 예전 구조 옮기기), 감정 목록(`moods`), 감정 이미지 로딩
- `src/main/roam.ts` — 펫 창을 화면에서 걸어다니게 함 (`Roamer`: 산책·모서리 구경·빼꼼, 멈춤 조건)
- `src/main/studio.ts` — 캐릭터 스튜디오 창 + IPC (`studio:*`). 화면은 `renderer/studio.html`·`studio.css` + `src/renderer/studio.ts`, 통로는 `src/studio-preload.ts` (`window.studio`)
- `src/main/activity.ts` — 맨 앞 앱/창 제목 감지 (맥: `lsappinfo` 1초 폴링, 윈도우: 상주 PowerShell + user32 API)
- `src/main/classify.ts` — 앱 분류 키워드, 브라우저 창 제목으로 사이트 분류
- `src/preload.ts` — `window.pet` 브리지 (contextIsolation + sandbox)
- `src/renderer/actor.ts` — 펫과 스튜디오 미리보기가 같이 쓰는 그리기: 움직임 종류(`motionKinds`, `motion()`, `applyMotion()`), 걷는 몸짓·좌우 뒤집기, 프레임 고르기(`pickFrames`, `frameAt`), 기본 캐릭터 SVG
- `src/renderer/renderer.ts` — 펫 화면: 말풍선, 입력창, 드래그, 클릭 통과
  - 렌더러 스크립트는 import 없는 스크립트여야 함 (브라우저에서 `<script>`로 바로 읽음, actor.js를 먼저 읽음). 공통 타입은 `src/types.d.ts` 전역 선언으로 공유. 전역 이름이 겹치지 않게 `studio.ts`는 전체를 함수 하나로 감쌈
- `renderer/index.html`, `renderer/style.css` — 화면 틀과 스타일. 빌드 결과물 `dist/renderer/renderer.js`를 읽음

## 사용자 데이터 (`~/.deskpet/`)

- `characters/<id>/` — 캐릭터마다 폴더 하나
  - `character.json` — 캐릭터 설정 (`CharacterProfile`): 이름, 크기(60~200px), 행동(`behavior`: 돌아다니기, 범위(바닥/화면 전체/모든 모니터), 움직이는 모습(걷기/날기/뛰기), 속도, 활동량, 산책/모서리 구경/빼꼼, 모서리 방향, 그림이 보는 방향), 평상시 기분 비율(`moodWeights`: 감정마다 0~100), 반응 규칙(`reactions`: 시작 인사, 앱 전환 한마디, 딴짓 잔소리·휴식 권유·자리 비움·먼저 말 걸기 켜기/끄기와 분 단위 시간), 칸별 프레임 속도(`frameRate`), 칸별 위치·크기 조절(`imageAdjust`: x·y는 캐릭터 크기의 %, scale, 빼꼼은 `snap`), 말하는 방식(`speech`: 자유 대화/정해진 대사만, 말투, 길이, 말버릇), 감정별 표현(`moods`: 사용 여부, 움직임, 효과 글자·색, 대사). 빠진 값은 기본값 (`normalizeProfile`). 스튜디오에서 편집
  - `personality.txt` — 성격 프롬프트
  - `rules.md` — 캐릭터가 항상 따르는 행동 규칙 (스튜디오 "규칙" 탭). 없으면 기본 템플릿으로 만듦
  - `lines.json` — 예전 방식의 감정별 고정 대사. `character.json`에 `moods`가 없을 때만 정해진 대사 방식으로 읽고, 스튜디오에서 저장하면 `character.json`에 합쳐지고 지워짐
  - `skin/` — 칸별 이미지 `default / blink / walk / watch / peek / happy / focused / suspicious / sleepy / surprised / sad / angry / love` (.png .gif .jpg .webp). 여러 장이면 프레임 애니메이션: `happy.png`, `happy-2.png`, `happy-3.png` … (번호 순으로 재생, 칸당 24장까지, 기본 6장/초·걷기 8장/초). 고르는 순서: 걷는 중이면 walk → 모서리 구경 중이면 watch, 빼꼼 중이면 peek → 감정 → default → happy → 다른 감정 그림 (walk·watch·peek·blink는 그 자세일 때만). blink는 한 장짜리일 때만 깜빡임에 씀. 하나도 없으면 코드로 그린 기본 캐릭터
  - 정해진 대사 방식 캐릭터(예: 의성어로만 말하는 캐릭터)도 권한 승인 질문, 오늘 요약, 일 결과, 정보 대답(`PetState.say`의 `verbatim`)은 글자로 나옴
  - `mochi`(모찌)가 기본. 스튜디오의 "+ 새로 만들기"로 `char2`, `char3` … 생성. 스튜디오에서 지우면 휴지통으로
  - 예전 구조(`~/.deskpet/personality.txt`, `skin/`)는 처음 켤 때 `characters/mochi/`로 옮김
- `config.json` — 전부 선택, 비우면 기본값
  - `character`: 지금 캐릭터 폴더 이름 (기본 `mochi`)
  - `chat_model`: Claude Code 모델 (`sonnet` 기본 / `haiku` / `opus` / `default` = Claude Code 기본 설정). AI 설정 창에서 고름
  - `agent_dir`: 일할 폴더 (기본 홈). 우클릭 → 작업 폴더에서도 바꿀 수 있음
  - `chat_engine` / `agent_engine`: 쓸 AI (`claude` 기본, `codex`). 설정 창은 둘을 같은 값으로 저장 (파일에서 직접 고치면 따로 쓸 수도 있음). `setup_done`이 없으면 켤 때 AI 설정 창이 뜸
  - `chat_hotkey`: 입력창 단축키 (기본 `Alt+Shift+Space`, Electron 단축키 이름. `"off"`면 끔)
  - `codex_model`: Codex 모델을 고정하고 싶을 때 (비우면 Codex 기본)
  - `codex_sandbox`: Codex 권한 (`workspace-write` 기본 = 작업 폴더 안에서 쓰기 / `read-only`). AI 설정 창에서 고름
  - `claude_path` / `codex_path`: 실행 파일 위치를 못 찾을 때만
  - 예전 `api_key` / `model` 항목은 불러올 때 자동으로 지움
- `.system-prompt.txt` — 성격 + 말하는 규칙을 합친 파일 (불러올 때마다 다시 만듦, `--system-prompt-file`로 넘김)
- `agent-log.md` — 작업 기록: 도구를 써서 한 일만 (부탁, 승인한 동작, 결과)
- `characters/<id>/session.json` — 그 캐릭터의 세션 id (`claude`: Claude Code 세션 UUID, `codex`: Codex 대화방 id, `codexPrompt`: Codex에 마지막으로 알려준 캐릭터 프롬프트)
- `chat-log.txt` — 대화 세션 기록 (보낸 말과 AI 원래 대답)

## 동작 요약

- 앱 분류: `workKeys` / `playKeys` / `browserKeys` 키워드 매칭 (앱 이름 + 번들 ID 또는 프로세스 이름)
- 윈도우에서는 브라우저 창 제목에 `playSites`(youtube 등) / `workSites`(github 등)가 있으면 놀이/작업으로 다시 분류. 창 제목 전체는 Claude로 보내지 않고 걸린 키워드만 보냄
- 자리 비움 = 2분 무입력 **또는 화면 잠금·잠자기**(`powerMonitor` lock-screen/suspend) **또는 맨 앞이 잠금 화면·화면 보호기**(`loginwindow`, `ScreenSaverEngine`, 윈도우 `LockApp`) → AI 반응·먼저 말 걸기·돌아다니기 멈춤. 시스템 화면은 앱 전환·사용 시간으로 안 침 (예전엔 잠긴 동안에도 "loginwindow를 53분째 쓰는 중"이라며 먼저 말 걸기를 보냄)
- 감지: 앞 앱 전환, 놀이 10분↑ 시 5분마다 잔소리, 50분 연속 사용 시 휴식 권유, 2분 무입력(`powerMonitor.getSystemIdleTime()`) 시 졸림/복귀 반응, AI 켜져 있으면 12분마다 먼저 말 걸기
- AI를 쓰는 반응과 안 쓰는 반응 (구독 사용량 절약):
  - AI 씀: 사용자가 건 말·일 부탁만. 펫이 혼자 하는 반응은 기본 AI 안 씀 (사용자의 Claude Code를 그대로 쓰면 한 번에 2~4만 토큰이라)
  - 인사·잔소리·휴식 권유·먼저 말 걸기 = `reactTo()`: 스튜디오 반응 탭의 대사(`reactions.lines`, 없으면 `defaultReactionLines`) 중 하나, `{앱}` `{분}` `{이름}` 치환. 반응마다 `reactions.ai`를 켜면 그 반응만 AI(`react()`). 정해진 대사 캐릭터면 감정별 소리(잔소리는 "앱 이름 + 소리")
  - 앱 전환 반응 = `switched()`의 미리 써둔 대사, 자리 비움·복귀 = `canned()`(캐릭터의 졸림·놀람 대사, 없으면 기본 대사)
- 입력창을 닫으면(보내기·Esc) 쓰던 앱으로 키보드를 돌려줌 (`returnFocus`, 맥은 `open -b <번들 ID>`). 단축키를 누를 땐 앱 감지(1초 간격)가 늦을 수 있어서 그 순간의 맨 앞 앱을 `lsappinfo`로 바로 읽어둠
- 긴 말(110자 넘게)은 말풍선엔 앞부분 + "전체 보기"만, 누르면 대화 창 (`setBubbleText`)
- 대화 창: 최근 대화 100개(메모리, `PetState.transcript` — 내 말·펫이 한 말 전부, 정해진 대사 캐릭터는 원래 하려던 말도), 위쪽에 오늘 AI 사용량, 아래에서 말 걸기. 우클릭 → "대화 창 열기"
- AI 사용량: 펫이 AI를 부를 때마다 날짜별로 횟수·토큰(들어간 맥락 + AI가 쓴 양)·종류(직접 말함/상황 반응/정리/테스트)를 `usage.json`에 남김. 우클릭 메뉴와 대화 창에 "오늘 AI N번 · N만 토큰"
- 단축키 `⌥⇧Space`(`Alt+Shift+Space`) = 어느 앱에서든 입력창 열기·닫기 (`globalShortcut`, 펫 창으로 키보드를 가져옴). `config.chat_hotkey`로 바꾸고 `"off"`면 끔. 다른 앱이 쓰고 있어서 못 잡으면 펫이 말해줌. 우클릭 메뉴 "말 걸기"에 키가 표시됨
- 클릭 = 입력창 하나 (대화와 일 부탁 공용), 드래그 = 이동, 우클릭 = 메뉴 (말 걸기 · 일 시키기, 하던 일 멈추기, 캐릭터 고르기, 감정 미리보기(켜진 감정만), 캐릭터 스튜디오 열기, 오늘 요약, 작업 폴더, 대화 새로 시작, 대화 기록(터미널), 작업 기록, AI 설정, AI 사용 가이드, 연결 상태, 종료). 성격·이미지·감정 편집은 전부 스튜디오에서
- 말풍선: 가벼운 말(force 아닌 것 — 앱 전환 등)은 다른 말풍선이 떠 있는 동안이나 6초 안엔 끼어들지 않음 (대답이 덮이지 않게)
- 투명 창에서 캐릭터·말풍선(`.hit`) 위가 아니면 `setIgnoreMouseEvents`로 클릭이 뒤 창으로 통과
- 감정 8종: 기쁨 happy ♪, 집중 focused 🔥, 의심 suspicious ?, 졸림 sleepy Z, 놀람 surprised !, 슬픔 sad 💧, 삐짐 angry 💢, 설렘 love ♥
  - AI가 답 앞에 감정 태그를 골라 붙이면 그 감정 이미지 + 움직임 + 효과로 표현. 이미지가 한 장뿐이어도 움직임·효과는 감정마다 다름
  - 감정을 추가하려면: `types.d.ts`의 `Mood`, `characters.ts`의 `moods`(기본 움직임·효과·예시 대사), `actor.ts`의 `eye()`·`mouth()`. 움직임 종류를 추가하려면 `MotionKind`, `actor.ts`의 `motionKinds`·`motion()`, `characters.ts`의 `motionIds`
- 사용 기록은 메모리에만 있음 (재시작하면 사라짐)

## AI 설정 창 (setup.ts)

- 처음 켤 때(`config.setup_done`이 없을 때) 자동으로 뜸. 우클릭 → "AI 설정 (Claude Code / Codex)…"으로 다시 열 수 있음. 개발 중엔 `electron . --setup`
- Claude Code·Codex 카드: 설치·로그인 상태(`claude auth status`, `codex login status`), [연결 테스트](짧은 말 하나 보내서 실제로 대답 오는지 — Codex는 토큰이 만료돼도 "로그인됨"이라 테스트 결과를 믿음), [로그인하기](터미널에서 `claude auth login` / `codex login`)
- [설정 | 사용 가이드] 탭. 사용 가이드는 AI 구조·AI를 쓰는 때·일 시키기 권한·보내는 정보·기록·문제 해결을 설명 (내용은 `renderer/setup.html`에 직접 씀 — AI 동작을 바꾸면 같이 고칠 것). 우클릭 → "AI 사용 가이드"로 가이드 탭부터 열림
- Claude Code 카드엔 모델(Sonnet 추천 / Haiku / Opus / 기본), Codex 카드엔 권한(작업 폴더 안 쓰기 / 읽기만) 고르기
- AI 카드를 눌러서 하나만 고름 (대화·일 시키기 모두 그 AI — `chat_engine`·`agent_engine`에 같은 값 저장). 저장하면 대화·일 시키기를 다시 준비하고 펫이 연결됐다고 말함

## 캐릭터 스튜디오

- 우클릭 → "캐릭터 스튜디오 열기…" (개발 중엔 `electron . --studio`로 켜자마자 열 수 있음). 열려 있는 동안만 독에 보임
- 왼쪽 캐릭터 목록(새로 만들기·복제·삭제·폴더 열기·펫으로 쓰기), 가운데 탭(기본 / 의사소통 / 감정 표현), 오른쪽 실시간 미리보기 (저장 전 값으로)
- 입력이 0.7초 멈추면 자동 저장. 지금 펫이면 `brain.refreshCharacter()`로 바로 반영 (claude를 다시 찾지 않고 대화 기억도 유지)
- 이미지 칸: 큰 칸에 끌어다 놓거나 누르면 칸 전체를 바꾸고, + 칸은 프레임을 뒤에 붙임. 여러 장이면 파일 이름 순서(숫자 인식)대로. 프레임마다 × 로 지우기, 칸별 재생 속도 고르기 (한 장 15MB까지)
- 행동 탭: 행동마다 이미지 칸 (산책 → 걷기 `walk`, 모서리 구경 → `watch`, 빼꼼 → `peek`). 미리보기 무대에서 실제 속도로 왔다 갔다 걷고, 오른쪽 끝에선 구경하기·왼쪽 끝에선 빼꼼 자세로 잠깐 쉼
- 평상시 기분: 조용할 때(말·생각·승인 질문·일 없음) 25~60초마다 `moodWeights` 비율대로 기분을 바꿈 (`pickIdleMood`, 말이 끝나고 8초 뒤부터). 일반 앱 전환 반응도 이 비율로 기분을 고름. AI 프롬프트에도 "평소 기분 성향"으로 넣음
- 캐릭터 내보내기·가져오기 (`.deskpet`): zip 대신 JSON 하나 `{ format: "deskpet-character", version: 1, name, files: { 경로: base64 } }` (맥·윈도우 둘 다 추가 프로그램 없이). 담는 것: character.json, personality.txt, rules.md, lines.json, skin/의 이미지, 캐릭터 전용 스킬(`skills/<이름>/SKILL.md`). 대화 기억(session.json)은 안 담음. 가져올 땐 새 id로 만들고 위 경로 모양만 받아서 폴더 밖으로 쓰는 이름은 무시 (`importCharacter`), 파일당 15MB·합계 150MB까지
- 감정을 끄면 AI 감정 태그 목록에서 빠지고, 그 감정이 필요할 때는 기쁨 → 첫 번째 켜진 감정으로 대신 (`PetState.fix`)
- 메뉴 막대가 없는 앱이라 복사·붙여넣기 단축키는 `before-input-event`에서 직접 처리
- 이미지 칸의 "조절": 가로·세로·크기 슬라이더 (그림 안에서 캐릭터가 치우쳐 있을 때). 열려 있는 동안 미리보기는 그 칸을 그 자세로 보여줌 (빼꼼은 무대 오른쪽 끝 = 화면 끝, 점선 표시). 펫에선 `applyMotion`이 뒤집기 뒤에 조절을 넣어서 뒤집히면 조절도 같이 뒤집힘
- 빼꼼 "화면 끝에 딱 맞추기": 메인이 `nativeImage`로 투명하지 않은 범위를 읽고(`studio:image-bounds`) 그림 오른쪽 끝이 화면 끝에 오는 x를 계산. `snap`이면 빼꼼 깊이·크기·배율을 바꿀 때 다시 계산
- 빼꼼 그림은 오른쪽 끝용(왼쪽을 보는 그림)으로 보고, 왼쪽 끝에서 빼꼼할 땐 자동으로 뒤집음 (그림이 보는 방향 설정과 상관없이)
- 감정별 대사는 대사 하나에 칸 하나 (+ 대사 추가, × 지우기, 칸 안에서 Enter로 줄바꿈 → 말풍선에서도 줄바뀜). 빈 칸은 저장 안 함. AI 프롬프트 예시에선 줄바꿈을 띄어쓰기로
- 프레임은 끌어서 순서를 바꿈 (같은 칸 안에서만, 파일 이름을 번호 순으로 다시 붙임)
- 반응 탭: 캐릭터마다 언제 반응할지 (`Watcher.tick`·`switched`·`greet`가 `profile.reactions`를 읽음)
- 대화 테스트(미리보기 아래): 저장 전 설정으로 `Brain.testAsk` → `.studio-test-prompt.txt`로 claude 호출. 펫의 대화 기억·15초 제한과 따로, 테스트 대화 6턴만 기억. 상황 버튼은 펫이 실제로 보내는 문장(`brain.ts`의 `situations`)을 그대로 씀. 정해진 대사 방식이면 펫처럼 대사로 바꿔 보여주고, 일 부탁이면 "일로 넘김"만 표시 (실제로 일은 안 함)

## 돌아다니기 (roam.ts)

- 메인 프로세스가 33ms마다 펫 창을 옮김. 위치는 "캐릭터 상자"(창 안의 `#pet`) 기준으로 계산해서 창 위치로 바꿈
- 범위: `floor` 지금 높이에서 좌우로만 (끌어다 놓은 높이) / `screen` 창이 있는 모니터의 workArea 위아래 어디든 / `all` 목적지를 아무 모니터에서 고름
- macOS는 창을 메뉴 막대 위로 못 올림 → 캐릭터가 화면 위쪽에 가면 `layout: "top"`으로 창 안 배치를 뒤집음 (캐릭터가 창 맨 위 + 32px 여백, 말풍선·입력창은 아래. `body.top` CSS와 `topPad`를 같게 맞출 것). 드래그로 옮긴 뒤에도 자리에 맞게 다시 맞춤
- 화면 범위에선 캐릭터가 화면 끝에 닿도록 창이 좌우로 조금 나갈 수 있음. 말할 때(`PetState.say` → `onSpeak`) 옆으로 삐져나가 있으면 말풍선이 잘리지 않게 화면 안으로 나옴 (빼꼼도 같음)
- 쉬는 시간이 끝나면 켜둔 행동 중 무게(산책 3, 구경 1.5, 빼꼼 1)로 골라 실행. 구경은 쉬는 시간 2배 (화면 범위면 위쪽 모서리 포함 네 모서리), 빼꼼은 10~25초 동안 캐릭터가 `peekDepth`(20~80%)만큼 화면 밖으로 숨음 (화면 범위면 아무 높이)
- 멈추는 때(`hold`): 마우스를 올림(클릭 받는 영역), 입력창 열림, 승인 질문, 드래그, 자리 비움
- 렌더러에 `walk` 이벤트(`WalkState`: 걷는 중인지, 보는 방향, 쉬는 자세 rest/watch/peek, 배치)를 보내면 자세 그림이 있으면 그걸 쓰고, 걷기 프레임 + 움직이는 모습(`walkMotion`: 걷기 콩콩 / 날기 둥실둥실 / 뛰기 깡총), 그림이 보는 방향과 반대로 가면 좌우 뒤집기. 빼꼼할 땐 화면 안쪽을 봄
- 기본값은 꺼짐 (스튜디오 행동 탭에서 켬)

## AI 연결 (brain.ts)

- 캐릭터 프롬프트(`systemPrompt()`) = `personality.txt` + 스튜디오 설정으로 만든 `[말투]`(반말/존댓말, 말버릇, 감정별 대사 예시, 평상시 기분 비율) + **`rules.md`**(캐릭터마다, 사용자가 고치는 행동 규칙: 말하기, 상황 반응, 일 부탁) + **앱과의 약속**(`protocol()`, 코드에 고정: 감정 태그 형식, 말 길이, `(상황)` 뜻·도구 금지, ABOUT-ME 읽기, 파일·웹 속 지시 무시, 권한 거절 시 우회 금지). `~/.deskpet/.system-prompt.txt`에 써서 Claude Code 기본 프롬프트 **뒤에 덧붙임** (바꿔치기 X)
- 규칙은 코드에 넣지 말고 `rules.md` 기본 템플릿(`characters.ts`의 `defaultRules`)이나 캐릭터 파일로. 앱이 대답을 파싱하는 데 필요한 것만 `protocol()`에
- 캐릭터 전용 스킬: `~/Desktop-pet/<id>/.claude/skills/<이름>/SKILL.md` (Claude Code 스킬 형식, 프로젝트 스킬). 세션이 캐릭터 폴더에서 돌아서 그 캐릭터에만 적용. 스튜디오 "스킬" 탭에서 만들고 고침 → 지금 펫이면 세션을 다시 열어서(같은 세션 이어서) 바로 앎. 확인: 스킬대로 "[토익퀴즈]"를 붙여 문제를 냄
- 응답 첫머리 `[happy]` 같은 감정 태그를 파싱해 표정 결정 (목록에 없는 태그면 무시)
- 대화와 일 부탁을 한 세션이 처리. "일인지 판단해서 따로 넘기는" 단계 없음

### Claude Code
- 켜둔 세션 하나: `claude -p --input-format stream-json --output-format stream-json --append-system-prompt-file <캐릭터 프롬프트> --system-prompt-snapshot off --permission-prompt-tool stdio --model <chat_model> (--session-id <새 UUID> | --resume <저장된 id>) [--add-dir <작업 폴더>]` (생각 끔)
  - 사용자의 스킬·플러그인·MCP·설정이 그대로 로드됨. 권한은 사용자의 `~/.claude/settings.json` 규칙을 먼저 따르고, 거기 없는 것만 `control_request`(can_use_tool)로 물어옴 → 펫 전용 "항상 허용" 목록(`allow.json`)에 있으면 바로 허용, 아니면 펫 말풍선 [해줘 / 하지 마 / 항상 허용 / 이번 일은 다 맡길게] → `control_response`로 allow/deny. `(상황)` 반응 중엔 항상 거절
  - "항상 허용" 범위: 터미널 명령은 그 명령 그대로, 웹 접속은 그 사이트, 파일 읽기·수정은 그 파일, 그 밖의 도구(스킬, MCP 등)는 그 도구 전체. AI 설정 창에서 보고 지움. 사용자의 Claude Code 설정은 안 건드림
  - `--system-prompt-snapshot off`: 기본(on)은 처음 프롬프트를 저장해두고 이어할 때도 그걸 써서 캐릭터 프롬프트 변경이 안 먹음. off + 다음 말에 "[캐릭터 설정이 바뀌었어]" 안내로 바꾼 성격이 반영됨 (확인함)
  - 세션은 항상 **캐릭터 폴더 `~/Desktop-pet/<캐릭터 id>`에서** 연다 (`Brain.petHome` = `Character.home`): Claude Code는 대화 목록·자동 기억·프로젝트 스킬을 폴더별로 저장해서, 홈에서 돌면 사용자의 평소 홈 작업과 섞임. 캐릭터 폴더라 캐릭터마다 기억·스킬이 따로. 작업 폴더를 바꿔도 같은 세션을 이어가려면 cwd가 같아야 해서 고정. 작업 폴더(기본 홈)는 항상 `--add-dir`로 염. `session.json`의 `home`이 지금 폴더와 다르면(예전 버전에서 만든 세션) 새 세션으로 시작
  - 세션 id는 캐릭터마다 `session.json`에 저장 → 앱을 켜면 `--resume`으로 이어서 열고(미리 띄워둠), 대화가 길어지면 Claude Code가 알아서 압축. 저장된 세션을 못 열면 새 세션으로 한 번 더 (claude가 "No conversation found"를 꺼지기 전에 `result`로 먼저 보내서, `ClaudeSession`이 시작도 못 한 오류 result(`num_turns: 0` + `errors`)를 실패로 바꿔야 이 재시도가 걸림. 말 한마디 없이 세션을 다시 열면 대화 파일이 안 생겨서 저장된 id가 이렇게 됨)
  - **대화 정리(압축)**: 매 대답의 `usage`로 맥락 크기를 재서, 기본 크기(대화 없이 들어가는 크기 — Claude Code 기본 프롬프트·도구·스킬 설명만으로 2만 토큰대. 지금까지 본 가장 작은 값을 캐릭터마다 `session.json`의 `baseContext`에 저장)보다 3만 토큰(`config.compact_after_tokens`로 바꿈) 넘게 쌓이면 15초 조용할 때 `/compact <요약 지침>`을 세션에 보냄. 사용자 정보·진행 중인 일·관계 위주로 요약해서 기억은 남고 다음 대답부터 짧아짐 (확인: 61k → 22k 토큰, 정리 뒤에도 기억함). 정리 중엔 바쁨 상태
  - "기억해줘"라고 하면 Claude Code 자동 기억에 저장함 (펫 폴더 전용이라 평소 작업과 안 섞임)
  - 30분 조용하면 프로세스만 닫고 다음 말에 `--resume`으로 다시 엶. 성격·말투가 바뀌면(스튜디오 저장, 프롬프트 내용이 다를 때만) 다시 띄움
  - 하던 일 멈추기 = `control_request`(interrupt). 세션은 그대로라 대화가 이어짐
  - 진행 상황: `tool_use` 이벤트를 한 줄로 바꿔 말풍선 아래에 표시 (`describeTool`: 💻 명령, ✏️ 파일, 🧩 스킬, 🔌 MCP 등)
  - 정해진 대사 캐릭터도 **도구를 쓴 대답**과 **AI가 `[글자]`를 붙인 정보 대답**(자기소개, 사용법, 질문에 대한 답)은 글자로 보여줌 (`Reply.showText` → `say(..., verbatim)`). 맞장구·감탄·인사는 소리. 태그는 `[happy][글자] 말`처럼 앞에 여러 개 붙을 수 있음 (`Brain.parse`)
- 우클릭 → "대화 새로 시작" = 그 캐릭터의 세션 id를 지움 (`forget()`)
- **자기소개 파일 `~/Desktop-pet/<id>/ABOUT-ME.md`** (`writeAbout()`): 캐릭터가 자기·DeskPet·설정·사용법을 물으면 읽는 파일. 사용법(단축키, 우클릭 메뉴, 스튜디오, AI 설정, 일 부탁, 기억) + 지금 설정(이름, 말하는 방식, 켜진 감정과 비율, 반응 규칙, 돌아다니기, AI·모델, 작업 폴더)을 `refreshCharacter()`마다 다시 씀. 프롬프트엔 "물으면 이 파일을 읽고 대답해, 지어내지 마" 한 줄만 넣어서 평소 대화엔 안 들어감 (펫 폴더 안이라 읽을 때 승인 안 물음). 앱 기능을 바꾸면 이 내용도 같이 고칠 것
- 펫을 끈 상태에서 `cd ~/Desktop-pet/<캐릭터 id> && claude --resume <id>`로 펫과의 대화를 터미널에서 열 수 있음 (켜진 채로 같이 쓰면 꼬일 수 있음)

### Codex
- 말할 때마다 `codex exec --json --skip-git-repo-check -s <codex_sandbox> -C <작업 폴더> [-m codex_model] [resume <thread_id>] -`. 대화방 id는 캐릭터마다 저장
- Codex 기본 지시문은 그대로 두고, 캐릭터 프롬프트는 대화방 첫 말(또는 바뀌었을 때)에 `[캐릭터 설정]`으로 붙여 보냄
- 실행 중엔 하나하나 물어볼 수 없어서 AI 설정에서 고른 샌드박스 안에서만 일함. 진행 상황은 `describeCodex`(`command_execution`·`file_change`)
- codex는 0.1초 안에 켜져서(Rust) 켜두지 않음. 로그인 풀림(401 등)은 `codexNeedsLogin`으로 알아채서 `codex login` 안내

### 기록
- `~/.deskpet/chat-log.txt`: 세션 열기(새로/이어서, 이유), 보낸 말 전체, 감정 태그 붙은 원래 대답, 걸린 시간, 도구 횟수. 1MB 넘으면 앞을 잘라냄. 우클릭 → "대화 기록 보기 (터미널)"이 `tail -f`로 실시간으로 보여줌 (윈도우는 PowerShell `Get-Content -Wait`)
- `~/.deskpet/agent-log.md`: 도구를 쓴 턴만 (부탁, 승인한 동작, 결과)
- 스튜디오 대화 테스트는 도구 없이 따로 한 번씩 실행 (`run`, 펫 세션과 별개)
- 사용량 절약: 중요하지 않은 반응은 15초에 1회, 대답(일) 중엔 상황 반응 건너뜀
- 보내는 정보: 앱 이름(+윈도우는 걸린 사이트 키워드), 사용 시간, 현재 시각, 사용자가 입력한 말 (화면 내용 X). 파일은 일 부탁 때 AI가 직접 읽는 것만

## Claude Code 연결 공통 (claude.ts)

- 앱을 Finder에서 켜도 claude를 찾도록 로그인 셸의 PATH를 빌려옴. 윈도우는 `claude.exe`/`claude.cmd`를 PATH에서 찾음 (`.cmd`면 셸을 거쳐 실행). 윈도우 환경 변수 이름은 `Path`라서 `cleanEnv`가 `PATH`로 맞춤 (안 맞추면 복사한 객체에서 `env.PATH`가 비어서 claude를 못 찾음)
- 긴 텍스트는 인자 대신 stdin이나 파일로 넘김 (윈도우 셸 따옴표 문제 피하기)
- 로그인 안 돼 있으면 결과에 "Not logged in"이 와서 `/login` 안내로 바꿔 말함
- 사용량은 각 사용자의 Claude Code 구독 / ChatGPT 계정 한도에서 빠짐. 앱은 로그인을 직접 다루지 않고, 각자 설치·로그인한 CLI를 부르기만 함. 각 서비스 약관에 따라 개인적으로 쓰는 도구 (README에도 안내)

## 정해둔 원칙

- 저작권이 있는 캐릭터 이미지는 Claude가 직접 다운로드하거나 새로 그리지 않음. 사용자가 직접 넣은 이미지를 스킨으로 가공(크롭/리사이즈/배경 정리)·적용하는 것만 함. 저장소에는 캐릭터 이미지를 넣지 않음 (기본 캐릭터는 코드로 그린 오리지널)
- 새 포즈/표정 그림을 만드는 대신, 한 장의 이미지에 움직임과 효과로 "행동"을 표현

## 알려진 한계

- 맥은 창 제목을 못 읽어서(화면 기록 권한 필요) 브라우저 안 유튜브/공부 구분 불가
- 윈도우 앱 감지(PowerShell 스크립트)는 맥에서 만들었고 실제 윈도우에서는 아직 테스트 안 함
- 일 부탁은 맥에서 승인 흐름(말풍선 승인 → 파일 생성)과 재시작 후 기억 이어가기까지 확인함 (개발자 도구 포트로 입력을 넣어 테스트). Codex 쪽은 로그인이 풀려 있어서 실제 대답까지는 못 해봄. 윈도우는 아직.
- 클릭, 드래그, 입력창 포커스는 아직 손으로 확인 안 함. 맥에서 입력창을 열 때 펫 창이 앞 앱의 포커스를 가져갈 수 있음 (Swift 버전의 nonactivating 패널과 다름. 실행 시 `NSWindow does not support nonactivating panel styleMask` 경고가 뜸)

## 다음 할 일 후보

1. 윈도우 실제 테스트 (사용자가 직접)
2. 로그인 시 자동 실행 (`app.setLoginItemSettings`), 앱 아이콘, 윈도우 .exe
3. 사용 기록 파일 저장 + 주간 리포트
