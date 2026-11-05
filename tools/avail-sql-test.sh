#!/usr/bin/env bash
# 시간표 조사(062) 왕복 검증 — 로컬 PostgreSQL.
# 001~062 를 모두 얹고 avail_mine/avail_submit·대상·열림·마감·칸 id·덮어쓰기·first·
# student_bundle 'avail_responses'·권한을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/avail-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=avail_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema if not exists private;
create or replace function private.is_active_teacher() returns boolean language sql stable as $$ select true $$;
grant usage on schema private to anon, authenticated;
SQL
for f in supabase/migrations/0*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/062_avail_survey.sql >/dev/null   # 재실행 안전

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','김철수','화정고','2026 고등 1학년','tok-kim','재원'),
  ('87654321','이영희','화정고','2026 고등 1학년','tok-lee','재원'),
  ('11112222','박중등','화정중','2026 중등 3학년','tok-mid','재원');
insert into avail_surveys (id, title, memo, slots, due, open) values
  (1, '화정고1 새 시간표', '안 되는 시간을 골라 주세요',
   '[{"id":"수-5:30","day":"수","start":"5:30","end":"7:30"},{"id":"목-5:30","day":"목","start":"5:30","end":"7:30"},{"id":"토-11:00","day":"토","start":"11:00","end":"1:00"}]', null, true),
  (2, '마감 지난 조사', '', '[{"id":"수-5:30","day":"수","start":"5:30","end":"7:30"}]', current_date - 3, true),
  (3, '닫힌 조사', '', '[{"id":"수-5:30","day":"수","start":"5:30","end":"7:30"}]', null, false);
insert into avail_targets (survey_id, code, name) values (1,'tok-kim','김철수'),(2,'tok-kim','김철수'),(3,'tok-kim','김철수'),(1,'tok-lee','이영희');

do $$
declare r jsonb;
begin
  r := public.avail_mine('{"key":"nope"}');
  assert r->>'ok' = 'false', 'no student';
  r := public.avail_mine('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 2, 'open 조사만 (닫힌 3 제외) ' || r::text;
  assert (select count(*) from jsonb_array_elements(r->'items') e where (e->>'closed')::boolean) = 1, '마감 지남 표시';
  assert r->'items'->1->'response' = 'null'::jsonb, '응답 없음';
  r := public.avail_mine('{"key":"tok-mid"}');
  assert jsonb_array_length(r->'items') = 0, '대상 아님 → 안 보임';

  -- 제출 거절
  r := public.avail_submit('{"key":"tok-mid","survey":1,"who":"학생","no":[]}');
  assert r->>'error' = 'not_target', 'not_target';
  r := public.avail_submit('{"key":"tok-kim","survey":3,"who":"학생","no":[]}');
  assert r->>'error' = 'closed', 'closed';
  r := public.avail_submit('{"key":"tok-kim","survey":2,"who":"학생","no":[]}');
  assert r->>'error' = 'past_due', 'past_due';
  r := public.avail_submit('{"key":"tok-kim","survey":1,"who":"엄마","no":[]}');
  assert r->>'error' = 'no_who', 'no_who';
  r := public.avail_submit('{"key":"tok-kim","survey":1,"who":"학생","no":["일-9:00"]}');
  assert r->>'error' = 'bad_slot', 'bad_slot';
  r := public.avail_submit('{"key":"tok-kim","survey":99,"who":"학생","no":[]}');
  assert r->>'error' = 'no_survey', 'no_survey';
  r := public.avail_submit('{"key":"tok-kim","survey":"x","who":"학생","no":[]}');
  assert r->>'error' = 'no_survey', 'no_survey 글자';

  -- 처음 제출 — 칸 순서대로 정리·중복 제거
  r := public.avail_submit('{"key":"tok-kim","survey":1,"who":"학생","no":["토-11:00","수-5:30","토-11:00"],"memo":"토 오전 학원"}');
  assert r->>'ok' = 'true' and (r->>'first')::boolean, 'first ' || r::text;
  assert r->'no' = '["수-5:30","토-11:00"]'::jsonb, '정리 ' || (r->'no')::text;
  -- 학부모님이 고침 — first 아님, 한 줄 그대로
  r := public.avail_submit('{"student":"12345678","survey":1,"who":"학부모님","no":[]}');
  assert r->>'ok' = 'true' and not (r->>'first')::boolean, 'second';
  assert (select count(*) from avail_responses where survey_id = 1 and code = 'tok-kim') = 1, '한 줄';
  assert (select last_by from avail_responses where code = 'tok-kim') = '학부모님', 'last_by';
  assert (select no from avail_responses where code = 'tok-kim') = '[]'::jsonb, '모두 가능';
  assert (select submitted_at < updated_at or submitted_at = updated_at from avail_responses where code='tok-kim'), 'times';
  r := public.avail_mine('{"key":"tok-kim"}');
  assert (select e->'response'->>'last_by' from jsonb_array_elements(r->'items') e where (e->>'id')::int = 1) = '학부모님', 'mine response';

  -- bundle
  r := public.student_bundle('tok-kim');
  assert jsonb_array_length(r->'avail_responses') = 1 and (r->'avail_responses'->0->>'survey')::int = 1, 'bundle';
  r := public.student_bundle('tok-lee');
  assert jsonb_array_length(r->'avail_responses') = 0, 'bundle 0';
  assert jsonb_array_length(r->'smock_entries') = 0, 'bundle 057 항목 유지';

  -- 조사를 지우면 대상·응답도
  delete from avail_surveys where id = 3;
  assert not exists (select 1 from avail_targets where survey_id = 3), 'cascade';
end $$;
SQL

# 권한: anon 은 표 직접 못 읽고 함수만
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
set role anon;
do $$ begin
  begin perform 1 from public.avail_responses; raise exception 'anon read'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.avail_surveys; raise exception 'anon read surveys'; exception when insufficient_privilege then null; end;
  perform public.avail_mine('{"key":"tok-kim"}');
end $$;
reset role;
SQL
echo "avail-sql-test: 모두 통과"
