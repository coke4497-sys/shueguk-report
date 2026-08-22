# 수파베이스 이전 (2026-08-22 시작)

스프레드시트+Apps Script → Supabase 이전 작업 기록. (장기 계획 항목 — 사용자 지시로 시작)

## 프로젝트 정보
- 프로젝트: `shueguk` (무료 요금제)
- URL: `https://bangdbhqpphqqdwcledg.supabase.co`
- Publishable 키(페이지에 넣어도 되는 공개 키): `sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT`
- Secret 키: **저장소에 절대 넣지 않는다.** 필요할 때 사용자가 세션에서 직접 전달
  (대시보드 → Settings → API Keys). Personal Access Token(sbp_…)도 동일 —
  세션마다 받아서 쓰고 저장하지 않는다(클래스프 토큰과 같은 방침).
- 관리 API(`api.supabase.com`)·프로젝트 API(`*.supabase.co`) 모두 이 원격 환경에서 접속 확인됨(2026-08-22).
  `supabase.com` 웹사이트 자체는 프록시 정책상 차단이지만 작업에는 지장 없음.

## 이전 순서 (사용자 확인 대기 중 — 1단계 추천안)
1. **시간표·출석 시스템** (timetable.html 도메인) ← `001_timetable_attendance.sql`
   - 정규/내신 시간표, 출석기록, 이동기록, 시간표메모, 기간설정, 지필일정
   - 이유: 조교들이 하루 종일 쓰는 페이지 + 동시 출석 체크(동시 수정)가 가장 잦음
     — 수파베이스의 이점(0.1~0.3초 응답, 동시 쓰기 안전)이 가장 크게 나타나는 곳.
   - 주의: 영구 이동 시 '학생정보' 정규가/나 동기화는 당분간 기존 Apps Script 액션을
     함께 호출해 유지(이중 기록). 학생정보가 3단계에서 넘어오면 제거.
2. **숙제검사(hwcheck) + 내신기록(naeshin)**
3. **학생정보·성적/리포트** (s.html, m.html, t.html, analyses, stats)
4. **별도 스크립트 프로젝트들** (공지, 슈퍼스타, 클리닉, H WORK, 어휘, OMR, 주말 신청)

## 방식 (사용자 확정 조건 반영)
- 페이지↔백엔드가 액션 단위 API로 분리돼 있으므로 **연결부만 교체** — 페이지의 데이터
  구조(반ID, 명단 공백 구분 문자열, 괄호 특이사항)는 그대로 유지.
- 각 단계마다: ① 테이블 생성 → ② 기존 데이터 자동 이전 → ③ 페이지 연결부 교체
  → ④ **DB→시트 일일 자동 백업**(사용자가 시트로 계속 볼 수 있게) 설정 → ⑤ 확인 후 다음 단계.
- 백업은 Apps Script 시간 트리거 + UrlFetchApp으로 수파베이스에서 읽어 백업 탭에 쓰는 방식
  (UrlFetchApp 권한은 소유자가 편집기에서 한 번 승인 필요 — 2026-08-19 메모 참고).
- 이전 기간 동안 원본 시트는 지우지 않는다 — 문제가 생기면 페이지 연결부만 되돌리면 복구.

## 진행 현황
- [x] 연결 확인 (2026-08-22)
- [x] 1단계 스키마 설계 (`migrations/001_timetable_attendance.sql`)
- [x] 1단계 테이블 생성 (2026-08-22, 관리 API로 SQL 실행)
- [x] 1단계 데이터 이전 (2026-08-22): tt_classes 220 · attendance 665 · tt_log 85
      · tt_memo 3 · tt_period 9 · exam_sched 20 — 시트 건수와 전부 일치, 표본 대조 OK.
      **주의: 페이지 교체 전까지 시트에 기록이 계속 쌓이므로, 교체 직전에 재이전(재동기화) 필수.**
      재이전 방법: 백엔드 시트(드라이브 「shueguk 지필고사 분석지 제작(26-1-기말)」,
      id 1_TyraMnur7AhiuB0nVMcDXq2YU2IBeju3lSTkV3Njos)를 xlsx로 받아 파싱 → 테이블 truncate 후 재삽입.
- [x] timetable.html 연결부 교체 (2026-08-22, 사용자 승인 "지금이 가장 안정") — 아래 '전환 방식'
- [x] 전환 직전 델타 재동기화 (2026-08-22 21:30 KST 기록까지 반영)
- [ ] 일일 백업 설정 (이중 기록이 있는 동안은 시트가 거의 최신 — 급하지 않음)

## 2단계: 숙제 검사 + 내신 피드백 (2026-08-22)
- [x] `migrations/002_hwcheck_naeshin.sql` — hwcheck_records(주차+접근코드 유일)·naeshin_records(기간+반+구분+주차+학생 유일)
- [x] 데이터 이전: 숙제검사 128건(중복 키는 뒤 행 우선, 날짜로 변환된 문구는 hwcheckTextStr_ 규칙으로 복원)·내신기록 8건
- [x] naeshin.html 어댑터: 시간표(내신)·기간·내신기록 읽기+naeshinSet 쓰기 수파베이스(시트 이중 기록 —
      m.html 지필 리포트의 시험범위 연동은 시트를 읽으므로 유지)
- [x] hwcheck.html 어댑터: hwcheckBoot는 기존 백엔드(명단·항목)와 수파베이스(검사 기록·시간표·주간
      출석·1회 이동)를 **동시에** 불러 병합 — 출석 배지가 수파베이스 원본 기준이 됨. hwcheckSave·
      hwcheckPlanDone·hwcheckPlans는 수파베이스 우선 + 시트 이중 기록(슈퍼스타 별 집계·s.html 숙제
      이력이 시트를 읽으므로). hwcheckItems(설정 탭)는 기존 백엔드 그대로.
- 주의: hwcheck_records가 이제 검사 기록의 원본 — 시트에서 수파베이스로 덮어쓰는 재동기화 금지
  (attendance와 동일). plan_done(N열 완료)은 hwcheckSave 재저장 시 유지된다(열을 안 보냄).

## 3단계: 지필 리포트·성적 + 학생정보 미러 (2026-08-22)
- [x] `migrations/003_reports_students.sql` — exams·exam_questions·submissions·students
- [x] 데이터 이전: 시험 16·문항 378·제출 295·학생 496 (어댑터 응답을 기존 백엔드 실응답과 전수 대조 —
      차이는 앞뒤 공백 정리뿐, 내용 동일 확인)
- [x] m/t/r/analyses/stats 5페이지 공용 어댑터: ?list(목록)·?id(시험 정의)·?results(제출 결과) 읽기와
      m.html의 timetableList·naeshinGet은 수파베이스. **학생 제출(r.html)·시험 등록/삭제는 기존 백엔드
      먼저**(학생 페이지 성적·별 집계가 시트를 읽음) **+ 수파베이스 미러**. 선생님 한마디는 수파베이스
      id 기반 + 시트 같은 행 최선 미러. 분석지 배정(배정 탭)·roster·getStudent는 기존 백엔드 그대로.
- **students는 시트가 원본인 읽기 미러** — 제출 결과 화면의 학생 매칭(개별 페이지 링크)용.
  신입 등록·표기 수정(슈퍼스타=기존 백엔드) 후엔 미러가 뒤처질 수 있음(새 학생 제출에 링크만 빠짐).
  4단계(슈퍼스타 전환) 또는 일일 백업 잡에서 해소 예정. 제출 시각 표기는 기기 시간대와 무관하게 +9 고정.
- 남은 것(다음 회차): s.html(학생 페이지) 완전 전환 — 별·공지(4단계)와 함께.

## 4단계(a): 공지·공지확인·별 + 학생정보 미러 연동 (2026-08-22)
- [x] `migrations/004_notices_stars.sql` — notices·notice_reads·star_bonus (셋 다 **시트가 원본**)
- [x] 데이터 이전: 공지 4 · 공지확인 408 · 별 보너스 14
- [x] superstar.html·notice.html '수파베이스 미러 연결부': 화면·저장은 기존 백엔드 그대로,
      저장 성공 시 미러 갱신 — 신입 등록/수정/표기 변경/퇴원 정리 → students,
      공지 등록/게시/삭제 → notices(noticeList로 통째 재동기화), 별 보너스 → star_bonus.
      **3단계의 students 미러 신선도 문제 해소** (신입 등록 즉시 제출결과 링크 살아남).
- 공지 확인(checkNotice, s.html)의 '공지확인' 적립은 기존 백엔드만 기록 → 일일 점검이 미러를 맞춘다.
- 남은 것: s.html 완전 전환(다음 회차), 별도 프로젝트(클리닉·H WORK·어휘·주말 — 각자 별도 이전).

## 주말 실전 모의고사 (2026-08-23)
- [x] `migrations/005_weekend_omr.sql` — omr_exams·omr_responses·signup_entries (셋 다 시트/신청 백엔드가 원본)
- [x] 데이터 이전: 회차 8 · OMR 응답 291 · 신청 313
- **OMR 학생/교사 화면은 Apps Script 내부(iframe·google.script.run)라 페이지 미러 불가** —
  응답 미러는 일일 점검이 OMR 시트(파일 id 1hd1huZpppBue5rlBVMZc2-wAbZ91PitFiBGT12Cq7YQ)로 동기화.
  실시간 미러가 필요해지면 omr_code.gs에 UrlFetchApp 이중 기록 추가(클래스프 배포+소유자 권한 승인 필요).
- 출제(hub answer_key.html): 저장/삭제 성공 시 omr_exams 즉시 미러.
- 신청(signup.html): 신청 성공 시 signup_entries에 한 줄 미러. 교사 화면(signup_teacher.html)이
  목록을 읽을 때마다 신청 백엔드 원본으로 통째 재동기화(삭제·정리 반영). 일일 점검은
  신청 백엔드 API(action=data)로 대조(--signup).
- s.html의 모의고사 성적(studentReports)·신청 게이트는 기존 OMR/신청 백엔드 그대로.

## 클리닉 (2026-08-23)
- [x] `migrations/006_clinic.sql` — clinic_requests(신청 '응답' 시트 미러)·clinic_settings(Script Properties
      설정 미러: open/slots/allSlots/teachers/target — 둘 다 **클리닉 시트·백엔드가 원본**)
- [x] 데이터 이전 (2026-08-22): 신청 103건·설정 5키 — API(action=data) 기준 전수 대조 일치,
      publishable 키 쓰기 왕복(기록→되읽기→삭제) 확인.
- 정원(강사별 9명/시간대·주차)·대상 판정이 서버(Apps Script)에 있으므로 **쓰기는 전부 기존 백엔드 그대로**:
  - 학생 폼(index.html, JSONP): 신청 성공 시 clinic_requests에 요청 건수만큼 미러 삽입
    (학년은 백엔드 gradeKey_ 규칙과 동일하게 '중2'/'고3' 형태로 정규화).
  - 신청 확인(teacher.html): 목록(action=data)을 읽을 때마다 clinic_requests 통째 재동기화
    (클리어·삭제 반영) + clinic_settings 갱신. 클리어 처리 성공 시에도 재동기화.
  - 배정(clinic_assign.html): 설정/현황 로드(action=data) 시 동일 재동기화,
    setTeacherSlots·setTarget 저장 성공 시 teachers 설정 미러 갱신.
- s.html의 클리닉 카드(amITarget)·학생 폼의 시간대 조회(slots)는 기존 백엔드 그대로
  (설정·정원 판정이 Script Properties에 있어서 — 완전 전환 때 함께).
- 일일 점검 `--clinic`: 클리닉 API(action=data)로 신청·설정을 받아 대조·복구.
- 제출시각·클리어는 시트가 날짜로 자동 변환 → API가 ISO UTC로 반환하므로 KST 'yyyy-MM-dd HH:mm'로
  정규화해 저장(페이지 훅·점검 도구 동일 규칙).

## H WORK (2026-08-23)
- [x] `migrations/007_hwork.sql` — hwork_homeworks(HWORK목록: 과제 JSON+마감일, teacher+code 유일)·
      hwork_submissions(제출기록) — 둘 다 **H WORK 시트가 원본**
- [x] 데이터 이전 (2026-08-22): 과제 8건 · 제출 534건 — 시트 xlsx 기준 전수 대조 일치,
      쓰기 왕복(업서트 due 유지·PATCH·삭제) 확인.
- 채점(정답 대조)·마감 판정이 서버(Apps Script)에 있으므로 **쓰기는 전부 기존 백엔드 그대로**:
  - 학생 제출(hwork.html): 채점 성공 시 hwork_submissions에 미러 삽입(ts는 클라이언트 KST 분 단위 —
    시트 기록과 초 단위가 달라도 일일 점검이 시트 기준으로 맞춘다).
  - 출제 저장(homework_key.html): 저장 성공 시 hwork_homeworks 업서트(due 미포함 — 기존 마감일 유지).
  - 과제 관리(hwork_assign.html): 마감일 저장 성공 시 미러 PATCH, 과제 삭제 성공 시
    미러의 과제+제출 함께 삭제.
- 어휘 출제(shueguk-voca paper.html)의 saveHomework는 아직 미러 훅 없음 — 일일 점검이 맞춘다
  (어휘 이전 회차에서 추가 예정).
- 일일 점검 `--hwork <xlsx>`: H WORK 시트(파일 id 1nFZ2HVAnCyCv_NOoAPXhA1VC_T7BBqwUWNWBta4-qFE)를
  내려받아 두 표를 시트 기준으로 대조·복구.
- 주의: hwork_homeworks.data에는 정답이 들어 있다 — 현 공개 수준은 기존과 동일
  (제출 응답의 정오(JSON)·getReport로 정답이 이미 노출되는 구조).

## 일일 자동 점검·복구 (2026-08-22 설정)
- **매일 새벽 3:30(KST) CCR 루틴**: 백엔드 시트 xlsx 다운로드(구글 드라이브,
  파일 id 1_TyraMnur7AhiuB0nVMcDXq2YU2IBeju3lSTkV3Njos) → `tools/audit_heal.py <xlsx> --omr <OMRxlsx> --signup --clinic --heal`.
- 루틴은 2026-08-22에 클리닉 세션(session_015eDefdq8GuGq697xnyEUA7)으로 이전됨
  (trig_015MGEd2Ug72RWde7PRoNBmH — 옛 세션 바인딩 루틴은 프롬프트 수정이 불가해 삭제 후 재생성,
  --clinic 추가). 다시 옮기려면 같은 방법(delete_trigger 후 create_trigger).
- 도구가 14개 표를 전수 대조하고 안전한 방향으로만 복구한다(파일 상단 주석 참고):
  시트-원본 표는 시트에 맞추고, 수파베이스-원본 표는 시트에만 있는 행 추가만.
  DB에만 있는 행(이중 기록 실패 의심)은 보고만 — 반복되면 사용자에게 알림.
- DB→시트 백업 조건은 페이지의 **이중 기록**이 사실상 담당(출석·숙제검사·내신·제출 전부 시트에도 기록).
  예외: 지필일정 편집·1회 이동 취소/수정은 시트 미반영(수파베이스가 원본) — 시트로 볼 때 이 두 가지만 유의.

## 전환 방식 (timetable.html 안의 '수파베이스 연결부' 스크립트)
기존 액션 API fetch를 가로채는 어댑터 — 호출부 코드는 그대로. 실패 시 자동으로 기존 백엔드 폴백.
- **읽기 전부 수파베이스**: ttBoot·timetableList·timetableWeek·ttPeriodList·ttMemoList·examSched·
  attendStudent·attendWarnList·attendAbsentList·timetableLog (미이전 roster 등은 기존 백엔드).
  1,000행 응답 한도는 어댑터가 자동 페이징.
- **출석·메모 쓰기 = 수파베이스 먼저 + 시트 이중 기록**(백그라운드 1회 재시도): attendSet·attendSetBulk·
  attendMakeupSet·ttMemoSet — hwcheck 배지·시트 열람은 이중 기록 덕에 그대로 정확.
- **반·명단 구조 변경 = 기존 백엔드 먼저 + 수파베이스 미러**: timetableMove(영구/1회)·Add·Remove·
  RenameStudent·AddClass·DeleteClass·MoveClass·ttPeriodSet — 학생정보 정규가/나 연동·검증 로직은
  기존 백엔드가 계속 담당. 미러 후 timetableList 재동기화(resyncClasses)로 자기 치유.
  1회 이동의 결석 보충 자동 완료(mkAutoComplete)는 같은 규칙을 수파베이스에도 재적용.
- **수파베이스가 원본(행 번호→id)**: examSchedSet(지필일정 편집), timetableOnceEdit/Cancel(1회 이동
  수정·취소). **시트 '지필일정' 탭은 더 이상 갱신 안 됨**; 1회 이동 취소·수정은 시트에서 같은 행을
  찾아 최선 노력 미러(실패해도 무방 — hwcheck 배지 표시용).
- 검증: node 스모크 테스트로 전 GET 핸들러 응답 모양·쓰기 왕복(기록→되읽기→삭제)·검증 오류 경로 확인.

## 재동기화(델타) 방법
시트가 원본인 데이터가 수파베이스와 어긋났을 때: 백엔드 시트 xlsx 다운로드 →
`tools/extract_from_xlsx.py`로 추출 → 키 기준 비교(출석 date+book+반+이름, 시간표 book+반ID,
이동기록 at(절대시간)+kind+학생+from+to — **at은 UTC/KST 차이가 있으니 epoch로 비교**) → 차이만 upsert/insert.
지필일정은 전환 후 수파베이스가 원본이므로 시트로 덮어쓰지 말 것.

## SQL 실행 방법 (테이블 생성·변경)
Personal Access Token(sbp_…)이 있으면 관리 API로 직접 실행:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/bangdbhqpphqqdwcledg/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d @<(python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' migrations/001_timetable_attendance.sql)
```
토큰이 없으면: 사용자에게 대시보드 → SQL Editor에 파일 내용 붙여넣고 Run 요청(차선책).
