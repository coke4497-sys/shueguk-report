#!/usr/bin/env bash
# 출석·지각 내역(041) 검증 — 로컬 PostgreSQL.
# 001·002·003 뒤 039(ch_who_)·041을 두 번씩 얹어(재실행 안전) attendance_history 가 내 출석만 · 괄호/A/동명이인 규칙 ·
# 날짜 내림차순 · before · 120개+more · 상태별 건수 · 메모 미포함 · 권한(공개 키는 함수만)을 지키는지 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/attendance-history-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=ahist_test_$$
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
alter table hwcheck_records add column if not exists class_id text not null default '';
SQL
for f in supabase/migrations/039_class_history.sql supabase/migrations/041_attendance_history.sql \
         supabase/migrations/041_attendance_history.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원'),
  ('87654321','김하늘','화정고','2026 고등 2학년','tok-kim','재원'),
  ('22223333','이소율','능곡고','2026 고등 1학년','tok-lee-n','재원'),
  ('33334444','이소율','화정고','2026 고등 1학년','tok-lee-h','재원');
insert into tt_classes (book, class_id, day, start_time, end_time, teacher, name) values
  ('정규','r010','수','5:30','7:00','은지','고2 가'),
  ('정규','r011','토','2:00','3:30','현지','고2 나'),
  ('내신','n050','토','4:00','6:00','지원','고2 확인'),
  ('정규','r020','금','5:30','7:00','은지','고1 가');
insert into attendance (date, book, class_id, student, status, memo, makeup_plan, makeup_done) values
  ('2026-09-30','정규','r010','박보검','출석','',''   ,''),
  ('2026-09-26','정규','r011','박보검(8/23부터)','지각','늦잠, 15분 늦음','',''),
  ('2026-09-26','내신','n050','박보검A','결석','가족 여행','영상보충: 9/30','완료'),
  ('2026-09-19','정규','r011','박보검','결석','감기','',''),
  ('2026-09-12','정규','w260912a','박보검','출석','',''   ,''),
  ('2026-09-30','정규','r010','김하늘','지각','',''   ,''),
  ('2026-09-25','정규','r020','(화정)이소율','출석','',''   ,''),
  ('2026-09-25','정규','r020','이소율','결석','',''   ,'');
do $$
declare r jsonb; it jsonb;
begin
  r := attendance_history('{"key":"tok-park"}');
  assert (r->>'ok')::boolean, 'ok: ' || r::text;
  assert jsonb_array_length(r->'items') = 5, '내 출석 5건(괄호·A 포함): ' || r::text;
  assert r->'items'->0->>'ymd' = '2026-09-30' and r->'items'->4->>'ymd' = '2026-09-12', '날짜 내림차순';
  assert r->'items'->1->>'cls' = '고2 확인' and r->'items'->1->>'time' = '4:00' and r->'items'->2->>'cls' = '고2 나', '같은 날은 늦은 시간 먼저: ' || r::text;
  it := r->'items'->0;
  assert it->>'cls' = '고2 가' and it->>'day' = '수' and it->>'time' = '5:30' and it->>'status' = '출석' and it->>'book' = '정규', '수업 정보: ' || it::text;
  assert (r->'items'->1->>'makeup')::boolean and not (r->'items'->3->>'makeup')::boolean and r->'items'->0->'makeup' = 'null'::jsonb, '결석만 보충 완료 여부';
  assert r->'items'->4->>'cls' = '', '없는 반은 빈 이름';
  assert r::text not like '%늦잠%' and r::text not like '%가족 여행%' and r::text not like '%영상보충%', '메모·보충 계획 미포함';
  assert (r->'counts'->>'출석')::int = 2 and (r->'counts'->>'지각')::int = 1 and (r->'counts'->>'결석')::int = 2, '건수: ' || (r->'counts')::text;
  r := attendance_history('{"key":"tok-park","before":"2026-09-26"}');
  assert jsonb_array_length(r->'items') = 2 and r->'items'->0->>'ymd' = '2026-09-19', 'before';
  assert (r->'counts'->>'결석')::int = 2, '건수는 전체 기간';
  r := attendance_history('{"student":"87654321"}');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'status' = '지각', '학생ID·자기 것만';
  r := attendance_history('{"key":"tok-lee-h"}');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'status' = '출석', '동명이인 — 앞 괄호 학교로: ' || r::text;
  r := attendance_history('{"key":"tok-lee-n"}');
  assert jsonb_array_length(r->'items') = 0, '못 가린 동명이인은 안 씀';
  assert (attendance_history('{"key":"nope"}'))->>'error' = 'no_student', '없는 키';
end $$;
insert into attendance (date, book, class_id, student, status)
  select date '2025-01-01' + g, '정규', 'r010', '김하늘', '출석' from generate_series(1,130) g;
do $$
declare r jsonb;
begin
  r := attendance_history('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 120 and (r->>'more')::boolean, '120개 + more';
  r := attendance_history(jsonb_build_object('key','tok-kim','before', r->'items'->119->>'ymd'));
  assert jsonb_array_length(r->'items') = 11 and not (r->>'more')::boolean, '나머지 11개: ' || jsonb_array_length(r->'items');
end $$;
set role anon;
do $$
declare r jsonb;
begin
  r := attendance_history('{"key":"tok-park"}');
  assert jsonb_array_length(r->'items') = 5, 'anon 함수 호출';
  begin perform 1 from attendance limit 1; raise exception 'anon read attendance'; exception when insufficient_privilege then null; end;
end $$;
reset role;
SQL
echo "attendance-history-sql-test: 모두 통과"
