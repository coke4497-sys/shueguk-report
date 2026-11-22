#!/usr/bin/env bash
# 예비 고1 학교 분석(061) 왕복 검증 — 로컬 PostgreSQL.
# 001~061 을 얹고 pre1_list(학생 확인·보이는 것만·순서)·표 권한(anon 직접 못 읽음)·재실행 안전을 assert 로 본다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/pre1-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=pre1_test_$$
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
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/061_pre1_schools.sql >/dev/null   # 재실행 안전

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','김철수','화정중','2026 중등 3학년','tok-kim','재원'),
  ('87654321','이영희','화정고','2026 고등 1학년','tok-lee','재원');
insert into pre1_schools (key, ord, school, exam, data, visible) values
  ('b-26-1m', 20, '나고', '2026학년도 1학기 중간고사', '{"short":"나"}', true),
  ('a-26-1m', 10, '가고', '2026학년도 1학기 중간고사', '{"short":"가"}', true),
  ('c-26-1m', 30, '다고', '2026학년도 1학기 중간고사', '{"short":"다"}', false);

do $$
declare r jsonb;
begin
  r := public.pre1_list('{"key":"nope"}');
  assert r->>'ok' = 'false' and r->>'error' = 'no_student', '없는 학생 거절';
  r := public.pre1_list('{}');
  assert r->>'ok' = 'false', '빈 요청 거절';
  r := public.pre1_list('{"key":"tok-kim"}');
  assert r->>'ok' = 'true', '중3 학생';
  assert jsonb_array_length(r->'items') = 2, '숨긴 학교 빼고 둘';
  assert r->'items'->0->>'key' = 'a-26-1m' and r->'items'->1->>'key' = 'b-26-1m', 'ord 순서';
  assert r->'items'->0->'data'->>'short' = '가', 'data 그대로';
  r := public.pre1_list('{"student":"87654321"}');
  assert r->>'ok' = 'true' and jsonb_array_length(r->'items') = 2, '고1(재원생 모두)·학생ID로도';
end $$;

-- 권한: anon 은 표를 직접 못 읽고 함수만, authenticated(교사)는 쓰기 가능
do $$
begin
  assert not has_table_privilege('anon', 'public.pre1_schools', 'select'), 'anon select 없음';
  assert has_table_privilege('authenticated', 'public.pre1_schools', 'insert'), '교사 insert';
  assert not has_table_privilege('authenticated', 'public.pre1_schools', 'truncate'), '교사 truncate 없음';
  assert has_function_privilege('anon', 'public.pre1_list(jsonb)', 'execute'), 'anon 함수 실행';
end $$;
set role anon;
do $$ begin
  begin perform 1 from public.pre1_schools; raise exception 'anon 이 표를 읽음';
  exception when insufficient_privilege then null; end;
  assert (public.pre1_list('{"key":"tok-kim"}')->>'ok') = 'true', 'anon 으로 함수';
end $$;
reset role;
select 'pre1 SQL 검증 통과' as result;
SQL
