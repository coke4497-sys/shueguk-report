#!/usr/bin/env bash
# 수업 리포트(034) 검증 — 로컬 PostgreSQL.
# 001·003 뒤 034를 두 번 얹고(재실행 안전) class_report_list(주간 리포트)의 본인 확인·공개 여부·기간·정렬과
# 표 권한(공개 키는 표를 못 읽고 함수만)을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/class-report-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=creport_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,03}_*.sql supabase/migrations/034_class_reports.sql supabase/migrations/034_class_reports.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원'),
  ('87654321','김하늘','화정고','2026 고등 2학년','tok-kim','재원'),
  ('11112222','코드없음','화정고','2026 고등 2학년','','재원');
insert into class_notes (book, class_id, ymd, class_name, progress) values ('내신','n081', current_date, '고2 확인', '사미인곡');
-- 같은 수업·같은 학생은 하나(unique)
do $$ begin
  begin
    insert into class_notes (book, class_id, ymd) values ('내신','n081', current_date);
    raise exception 'dup note allowed';
  exception when unique_violation then null; end;
end $$;
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into class_reports (week, book, code, student_id, name, body, published) values
  (current_date,       '내신', 'tok-park','12345678','박보검', '{"parts":[{"part":"진도","summary":"오늘"}]}', true),
  (current_date - 7,   '내신', 'tok-park','12345678','박보검', '{"parts":[]}', true),
  (current_date - 14,  '내신', 'tok-park','12345678','박보검', '{}', false),
  (current_date - 200, '정규', 'tok-park','12345678','박보검', '{}', true),
  (current_date,       '내신', 'tok-kim','87654321','김하늘', '{"hw":{"pct":50}}', true);
do $$ begin
  begin
    insert into class_reports (week, code) values (current_date, 'tok-park');
    raise exception 'dup report allowed';
  exception when unique_violation then null; end;
end $$;
do $$
declare r jsonb;
begin
  r := class_report_list('{"key":"tok-park"}');
  assert (r->>'ok')::boolean, 'ok: ' || r::text;
  assert jsonb_array_length(r->'items') = 2, '공개·최근 16주만 2주: ' || r::text;
  assert (r->'items'->0->>'week')::date = current_date and (r->'items'->1->>'week')::date = current_date - 7, '최근 주 먼저: ' || r::text;
  assert r->'items'->0->'body'->'parts'->0->>'summary' = '오늘' and r->'items'->0->>'book' = '내신', 'body/book';
  r := class_report_list('{"student":"12345678"}');
  assert jsonb_array_length(r->'items') = 2, '학생ID로도';
  r := class_report_list('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 1 and (r->'items'->0->'body'->'hw'->>'pct')::int = 50, '다른 학생은 자기 것만';
  r := class_report_list('{"key":"nope"}');
  assert r->>'error' = 'no_student', '없는 키';
  r := class_report_list('{"student":"11112222"}');
  assert r->>'error' = 'no_student', '접근코드 없는 학생';
  r := class_report_list('{}');
  assert r->>'error' = 'no_student', '빈 요청';
end $$;
-- 권한: 공개 키는 함수만
set role anon;
do $$
declare r jsonb;
begin
  r := class_report_list('{"key":"tok-park"}');
  assert jsonb_array_length(r->'items') = 2, 'anon 함수 호출';
  begin perform 1 from class_reports limit 1; raise exception 'anon read class_reports'; exception when insufficient_privilege then null; end;
  begin perform 1 from class_notes limit 1; raise exception 'anon read class_notes'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  assert (select count(*) from class_notes) = 1, '교사는 표를 읽는다';
  update class_notes set report_status = '요청' where class_id = 'n081';
  assert (select report_status from class_notes where class_id = 'n081') = '요청', '교사는 쓴다';
end $$;
reset role;
SQL
echo "class-report-sql-test: 모두 통과"
