; 제거할 때 앱이 만든 사용자 데이터도 전부 지운다 (설정·캐릭터·기록·Claude Code 대화 기록)
; 업데이트 설치(새 버전이 옛 버전을 조용히 지움, --updated) 때는 지우지 않는다 — 안 그러면 업데이트마다 캐릭터가 날아감
; AppData\Roaming\deskpet 은 package.json 의 nsis.deleteAppDataOnUninstall 이 지움

!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$PROFILE\.deskpet"
    RMDir /r "$PROFILE\Desktop-pet"
    RMDir /r "$LOCALAPPDATA\deskpet-updater"

    ; 펫 세션의 Claude Code 대화 기록·기억 (~/.claude/projects/C--Users-<이름>-Desktop-pet-<id>)
    FindFirst $R0 $R1 "$PROFILE\.claude\projects\*-Desktop-pet-*"
    ${DoWhile} $R1 != ""
      RMDir /r "$PROFILE\.claude\projects\$R1"
      FindNext $R0 $R1
    ${Loop}
    FindClose $R0
  ${endIf}
!macroend
