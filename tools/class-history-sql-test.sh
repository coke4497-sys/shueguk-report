#!/usr/bin/env bash
# 학습 이력(039) 검증 — 로컬 PostgreSQL.
# 001·002·003·034 뒤 035의 열만 흉내 내고 039를 두 번 얹어(재실행 안전) class_history의
# 공개 조건(리포트 생성한 수업만)·이름 대조(괄호·A·동명이인)·과제 검사 주차·비공개 값 제외·권한을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/class-history-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=chist_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03}_*.sql supabase/migrations/034_class_reports.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
-- 035 의 열만(student_bundle 재정의는 이 검사와 무관)
alter table hwcheck_records add column if not exists class_id text not null default '';
alter table hwcheck_records add column if not exists part text not null default '';
alter table hwcheck_records add column if not exists class_name text not null default '';
alter table hwcheck_records drop constraint if exists hwcheck_records_week_token_key;
alter table hwcheck_records add constraint hwcheck_records_week_token_class_key unique (week, token, class_id);
SQL
for f in supabase/migrations/039_class_history.sql supabase/migrations/039_class_history.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원'),
  ('87654321','김하늘','화정고','2026 고등 2학년','tok-kim','재원'),
  ('22223333','이소율A','능곡고','2026 고등 1학년','tok-lee','재원'),
  ('33334444','양지우','화정고','2026 고등 1학년','tok-y1','재원'),
  ('44445555','양지우','능곡고','2026 고등 1학년','tok-y2','재원'),
  ('55556666','퇴원생','화정고','2026 고등 1학년','tok-out','퇴원');
-- 수업 기록: 9/30(수) 가 수업(리포트 생성) · 9/28(월) 나 수업(생성) · 9/27 저장만(안 보임)
insert into class_notes (book, class_id, ymd, class_name, teacher, class_time, part, progress, units, homework, comments, requested_at, report_status) values
  ('정규','r010','2026-09-30','고2 화정 가','은지','수 5:30~7:00','가','사미인곡 정리','[]','학습지 1장
오답 정리',
   '{"박보검":"집중이 좋았어요","김하늘":"필기 성실","__태도":{"박보검":"매우 좋음","김하늘":"좋음"},"__검사과제":"데일리"}', now(), '요청'),
  ('정규','r011','2026-09-28','고2 화정 나','은지','월 5:30~7:00','나','속미인곡','[]','', '{"__태도":{"박보검":"노력 필요"}}', now(), '공개'),
  ('정규','r010','2026-09-27','고2 화정 가','은지','일 5:30~7:00','가','저장만 한 수업','[]','', '{}', null, ''),
  ('내신','n050','2026-09-26','고1 확인','지원','토 2:00~4:00','확인','서술형 점검','["1단원"]','', '{"이소율":"좋아요","양지우":"둘 중 하나","__태도":{"이소율":"좋음"}}', now(), '공개'),
  ('정규','r012','2026-09-25','고2 단일','은지','금 5:30~7:00','','과제 검사만 있는 수업','[]','', '{}', now(), '공개');
insert into attendance (date, book, class_id, student, status, memo) values
  ('2026-09-30','정규','r010','박보검','출석',''),
  ('2026-09-30','정규','r010','김하늘','지각','비밀 메모'),
  ('2026-09-28','정규','r011','박보검(9/28부터)','결석','가족 여행'),
  ('2026-09-27','정규','r010','박보검','출석',''),
  ('2026-09-26','내신','n050','(능곡)이소율','출석',''),
  ('2026-09-26','내신','n050','양지우','출석',''),
  ('2026-09-26','내신','n050','퇴원생','출석','');
insert into hwcheck_records (week, token, name, scores, max, pct, pub, priv, missing, plan, class_id, part) values
  ('2026-09-30','tok-park','박보검','{"학습지 (학습량)":5,"학습지 (깊이)":4}', 10, 90, '잘 했어요', '비공개 메모', false, '', 'r010','가'),
  ('2026-09-23','tok-park','박보검','{}', 10, 0, '', '', true, '재검사 약속', 'r011','나'),
  ('2026-09-23','tok-park','박보검','{"숙제 수행":6}', 6, 100, '', '', false, '', 'r012','');
do $$
declare r jsonb; it jsonb;
begin
  r := class_history('{"key":"tok-park"}');
  assert (r->>'ok')::boolean, 'ok: ' || r::text;
  assert jsonb_array_length(r->'items') = 3, '생성한 수업만 3개(저장만 한 9/27 제외): ' || r::text;
  assert r->'items'->0->>'ymd' = '2026-09-30' and r->'items'->1->>'ymd' = '2026-09-28' and r->'items'->2->>'ymd' = '2026-09-25', '날짜 내림차순';
  it := r->'items'->0;
  assert it->>'attend' = '출석' and it->>'comment' = '집중이 좋았어요' and it->>'attitude' = '매우 좋음', '9/30 출석·코멘트·태도: ' || it::text;
  assert it->>'homework' like '학습지 1장%' and it->>'progress' = '사미인곡 정리' and it->>'part' = '가' and it->>'teacher' = '은지', '진도·과제';
  assert (it->'hw'->>'pct')::int = 90 and it->'hw'->>'text' = '잘 했어요' and (it->'hw'->>'max')::int = 10, '과제 검사';
  assert it::text not like '%비공개 메모%' and it::text not like '%__검사과제%' and it::text not like '%priv%', '비공개 값 없음';
  it := r->'items'->1;
  assert it->>'attend' = '결석' and it->>'attitude' = '노력 필요' and (it->'hw'->>'missing')::boolean, '9/28 괄호 이름·월요일 주차(9/23) 과제 검사: ' || it::text;
  assert it::text not like '%가족 여행%' and it::text not like '%재검사 약속%', '출석 메모·대책 제외';
  it := r->'items'->2;
  assert it->>'attend' = '' and (it->'hw'->>'pct')::int = 100, '출석 없이 과제 검사만 있는 수업도';
  r := class_history('{"key":"tok-park","before":"2026-09-28"}');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'ymd' = '2026-09-25', 'before 로 더 보기';
  r := class_history('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'attend' = '지각' and r->'items'->0->>'attitude' = '좋음'
     and r->'items'->0->>'comment' = '필기 성실' and r->'items'->0->'hw' = 'null'::jsonb, '다른 학생은 자기 것만: ' || r::text;
  assert r::text not like '%비밀 메모%', '지각 메모 제외';
  r := class_history('{"key":"tok-lee"}');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'comment' = '좋아요' and r->'items'->0->>'attitude' = '좋음'
     and r->'items'->0->'units'->>0 = '1단원', '앞 괄호 학교·이름 끝 A 대조: ' || r::text;
  r := class_history('{"key":"tok-y1"}');
  assert jsonb_array_length(r->'items') = 0, '동명이인(학교 표시 없음)은 쓰지 않음: ' || r::text;
  r := class_history('{"student":"12345678"}');
  assert jsonb_array_length(r->'items') = 3, '학생ID로도';
  r := class_history('{"key":"tok-out"}');
  assert jsonb_array_length(r->'items') = 0, '퇴원생 이름은 대조 안 함';
  r := class_history('{"key":"nope"}');
  assert r->>'error' = 'no_student', '없는 키';
  r := class_history('{}');
  assert r->>'error' = 'no_student', '빈 요청';
end $$;
set role anon;
do $$
declare r jsonb;
begin
  r := class_history('{"key":"tok-park"}');
  assert jsonb_array_length(r->'items') = 3, 'anon 함수 호출';
  begin perform 1 from class_notes limit 1; raise exception 'anon read class_notes'; exception when insufficient_privilege then null; end;
  begin perform ch_who_('박보검'); raise exception 'anon ch_who_'; exception when insufficient_privilege then null; end;
end $$;
reset role;
SQL
echo "class-history-sql-test: 모두 통과"
