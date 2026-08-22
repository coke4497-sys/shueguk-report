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
