# 수파베이스 이전 — 새 세션 인수인계 (2026-08-23 작성)

새 세션에서 이 문서를 읽고 남은 이전 작업을 이어받는다.
전체 이력·정책은 `supabase/README.md`, 프로젝트 전반 규칙은 저장소 루트 `CLAUDE.md` 참고.
**사용자는 비기술자다** — 보고는 짧고 쉬운 한국어로, 확인 요청은 "페이지 열어보고 잘 뜨는지" 수준으로.

## 지금까지 끝난 것 (2026-08-22 하루에 완료)
- 수파베이스 프로젝트 `shueguk` (`https://bangdbhqpphqqdwcledg.supabase.co`), 테이블 20개.
- **전환 완료**: 시간표·출석(timetable) → 숙제검사·내신(hwcheck·naeshin) → 지필 리포트·성적(m/t/r/analyses/stats)
  → 공지·별·학생정보 미러(notice·superstar) → 주말 모의고사(OMR·신청, 미러+일일 동기화).
- **일일 자동 점검**: 매일 새벽 3:30 KST, 옛 세션(session_01N4Vp6bGmn8nuYrPCoNu89S)에 바인딩된
  루틴(trig_01Eb61JVo4jJNit19ewHiSYr)이 `supabase/tools/audit_heal.py`로 전수 대조·복구.
  (그 루틴은 옛 세션에서 계속 돈다 — 새 세션이 손댈 필요 없음. 루틴을 옮기고 싶으면
  옛 것을 delete_trigger 하고 새로 만들 것.)

## 남은 작업 (권장 순서)
1. **클리닉** (shueguk-clinic 저장소, Code.gs + index/teacher/clinic_assign.html, 시트 「shueguk 클리닉 수업 신청」 id `1q-D_cGhSpVgX5epGKIVy-HH9P26ygj-TeT9yrMaHAO8`)
2. **H WORK** (shueguk-h-work, apps-script/Code.gs, 시트 「2026 Shueguk H WORK 채점」 id `1nFZ2HVAnCyCv_NOoAPXhA1VC_T7BBqwUWNWBta4-qFE`)
3. **어휘** (shueguk-voca, apps-script/Code.gs, 시트 「2026 어휘, 시작이 반이다(응답)」 id `1AVDyKpBj9kSW5hzSzOieVIZpV6FnIpcFMjsjUyuGAbE`)
4. **s.html(학생 페이지) 완전 전환** — 데이터는 전부 준비됨. getStudent가 서버에서 합치는 것들
   (학생정보·제출결과·별 집계·숙제 이력·공지·배정·외부 스냅샷)을 클라이언트에서 수파베이스로 재구성.
   별 집계 규칙(STAR_RULES)·공지 매칭(noticeMatches_)을 backend-createReport.gs에서 그대로 옮겨야 함.
   **가장 크고 리스크 높은 작업 — 따로 한 회차로.** mockGates·vocaTaken은 null 반환 시 페이지가
   직접 조회로 폴백하는 구조라 그걸 활용 가능.

## 검증된 작업 패턴 (그대로 따를 것)
1. 백엔드 .gs와 페이지에서 **탭 구조·액션·응답 모양을 먼저 정확히 파악** (추측 금지).
2. 마이그레이션 SQL 작성 → `supabase/migrations/00N_*.sql` 커밋 → 관리 API로 실행:
   `POST https://api.supabase.com/v1/projects/bangdbhqpphqqdwcledg/database/query` (sbp_ 토큰 필요 —
   **사용자에게 요청**: "supabase.com/dashboard/account/tokens → Generate new token → sbp_ 코드 복사").
   RLS는 기존과 동일하게 anon_all (티쳐스 페이지 공개 수준).
3. 데이터 이전: 구글 드라이브 도구로 해당 시트 xlsx 다운로드 → 파싱 → REST 일괄 삽입(secret 키도
   사용자에게 요청, 또는 anon_all이라 publishable 키로도 가능). 시트가 날짜로 자동 변환한
   문구는 원래 표기로 복원(audit_heal.py의 text_restore/ts_norm 참고).
4. 페이지 연결부: 상황별 3패턴 —
   - **읽기 전환**: window.fetch 가로채기 어댑터(기존 액션 → 수파베이스 쿼리, 응답 모양 완전 재현,
     실패 시 rawFetch 폴백). timetable.html의 '수파베이스 연결부' 스크립트가 표준 예시.
   - **쓰기(판정 로직이 서버에 있으면)**: 기존 백엔드 먼저 → 성공 시에만 미러 갱신.
   - **JSONP(script 태그) 페이지**: fetch 가로채기 불가 — 성공 콜백에 미러 훅 직접 삽입
     (shuegukweekendtest/signup.html 참고).
   - 시트 행 번호(rowIndex) 기반 수정/삭제는 수파베이스 id로 대체하거나 기존 백엔드에 남길 것.
5. 검증: node로 어댑터 응답을 **기존 백엔드 실응답과 전수 대조**(스모크 테스트), 쓰기는
   기록→되읽기→삭제 왕복. 페이지 스크립트는 node --check로 문법 확인.
6. 배포: 각 저장소 브랜치 커밋·푸시 → PR 생성 → **스쿼시 머지**(사용자가 이 흐름 승인함) →
   Pages 빌드 success 확인 → 필요 시 델타 재동기화. main에 직접 푸시는 차단됨.
7. `supabase/README.md` 진행 현황 갱신 + 필요 시 일일 점검 도구(audit_heal.py)에 새 표 추가,
   루틴 프롬프트 갱신(update_trigger).

## 원본/미러 방향 (혼동 금지)
- **수파베이스가 원본**: attendance, tt_memo, exam_sched, hwcheck_records, naeshin_records,
  submissions(선생님 한마디 포함), tt_log 일부(1회 취소/수정),
  **signup_entries(2026-08-26 전환 — 016, 함수 signup_days/submit/mine)**,
  **omr_exams·omr_responses(2026-08-26 전환 — 017, 함수 omr_exam_list/submit/student_reports/report_by_id,
  OMR 학생·교사 화면은 hub의 정적 페이지 omr.html·omr_teacher.html)** —
  시트로 덮어쓰지 말 것. 페이지가 시트에 이중 기록해서 시트도 거의 최신.
- **시트/기존 백엔드가 원본**: tt_classes, tt_period, students, notices, notice_reads, star_bonus,
  exams, exam_questions, **signup_settings(신청받기·가능 학년)** —
  미러는 페이지 훅+일일 점검이 유지.

## 키·비밀 취급 (절대 규칙)
- **Publishable 키**(공개 가능, 페이지·저장소에 있음): `sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT`
- **Secret 키·sbp_ 토큰은 저장소/문서에 절대 저장 금지** — 세션마다 사용자에게 새로 요청.
- 학생 접근코드·학생ID는 기존 공개 수준(티쳐스 페이지 무게이트)과 동일하게만 취급.

## 이미 밟은 함정들 (반복 금지)
- 시트 자동 날짜 변환: 문구·날짜 열은 읽을 때 Date 객체도 흡수해 원래 표기로 복원.
- PostgREST 응답은 1,000행 한도 — 어댑터·도구 모두 자동 페이징 구현돼 있음(sbGet 참고).
- 타임스탬프 비교는 UTC/KST 차이 때문에 epoch로. 표시는 기기 시간대 무관 +9 고정.
- 일괄 삽입은 모든 행의 JSON 키가 같아야 함(PGRST102).
- 이 원격 환경 프록시: supabase.com 웹은 차단이지만 api.supabase.com·*.supabase.co·script.google.com은 됨.
  node 스크립트는 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt 필요.
- 옛 페이지 캐시로 사용자가 이전 버전을 쓸 수 있음 — 일일 점검의 "시트에만 있는 행" 복구가 안전망.
- 병행 세션이 같은 저장소에서 작업 중일 수 있음 — 머지 충돌 나면 main을 병합해 해결(스쿼시 머지 뒤라
  add/add 충돌이 흔함; 어댑터 블록이 중복 삽입되지 않았는지 꼭 확인).

## 클리닉 이전을 위한 사전 정보 (다음 작업)
- 백엔드: shueguk-clinic/Code.gs, exec `AKfycbw8e-054e4VUfRRx-PadyuoXRb-jxsKRcdOaq04SJH1oJyFVS_VOh9GUN_pL5cHPPzKVA`
- 강사별 클리닉 운영(teacherSlots 스크립트 속성), 신청 정원 9명/강사, 학생 폼 index.html(s.html이 ?tc= 전달),
  배정 clinic_assign.html, 신청 확인 teacher.html. 자세한 동작은 shueguk-report/CLAUDE.md '클리닉' 절 참고.
- 정원·대상 판정이 서버에 있으므로 신청 쓰기는 기존 백엔드 우선 + 미러 패턴.
- 설정(teacherSlots)은 Script Properties에 있어 시트에 없음 — 미러 대상에서 제외하거나 API로 대조.
