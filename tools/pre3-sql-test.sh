#!/usr/bin/env bash
# 예비 고3 인서울 15개 대학(095) · 셀프 체크리스트 서버 저장(096) 왕복 검증 — 로컬 PostgreSQL.
# 001~096 을 얹고 pre3_list(학생 확인·보이는 것만·순서)·pre3_check_save/mine(학생 확인·덮어쓰기·모양 검사)·표 권한(anon 직접 못 읽음)·재실행 안전을 assert 로 본다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/pre3-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=pre3_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'anon'::text $$;
grant usage on schema auth to anon, authenticated;
create schema if not exists private;
create or replace function private.is_active_teacher() returns boolean language sql stable as $$ select true $$;
grant usage on schema private to anon, authenticated;
create extension if not exists pgcrypto;
-- 허브 표 teacher_accounts(088 이 퇴원생 가림에서 읽음)는 허브 저장소 마이그레이션에 있어 모양만 흉내 낸다.
create table if not exists public.teacher_accounts (user_id uuid primary key, login_id text, display_name text, role text, active boolean default true);
SQL
# 070·071·072·082·090_audit_log 는 실제 DB 에만 있는 표·함수(다른 세션의 hwork_reply_files·hwork_retests, 허브 msg_tasks·activity_viewer)를 전제해 로컬에선 건너뛴다(pre3 와 무관 — 095 는 audit_attach 가 없으면 건너뛴다).
for f in supabase/migrations/0*.sql; do
  case "$f" in *070_hwork_qa_files_retest*|*071_hwork_retest_parts*|*072_hwork_qa_shuetalk*|*082_hwork_check_task*|*090_audit_log*) continue;; esac
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/095_pre3_univs.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/096_pre3_checks.sql >/dev/null  # 재실행 안전

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','김철수','화정중','2026 중등 3학년','tok-kim','재원'),
  ('87654321','이영희','화정고','2026 고등 1학년','tok-lee','재원');
insert into pre3_univs (key, ord, kind, name, data, visible) values
  ('common', 0, 'common', '공통', '{"schedule":[{"k":"수시 원서접수","v":"9/20~23"}]}', true),
  ('bb', 20, 'univ', '나대학교', '{"short":"나대"}', true),
  ('aa', 10, 'univ', '가대학교', '{"short":"가대"}', true),
  ('cc', 30, 'univ', '다대학교', '{"short":"다대"}', false);

do $$
declare r jsonb;
begin
  r := public.pre3_list('{"key":"nope"}');
  assert r->>'ok' = 'false' and r->>'error' = 'no_student', '없는 학생 거절';
  r := public.pre3_list('{}');
  assert r->>'ok' = 'false', '빈 요청 거절';
  r := public.pre3_list('{"key":"tok-kim"}');
  assert r->>'ok' = 'true', '중3 학생(재원생 모두)';
  assert jsonb_array_length(r->'items') = 3, '숨긴 대학 빼고 공통 + 둘';
  assert r->'items'->0->>'key' = 'common' and r->'items'->0->>'kind' = 'common', '공통 줄이 맨 앞(ord 0)';
  assert r->'items'->1->>'key' = 'aa' and r->'items'->2->>'key' = 'bb', 'ord 순서';
  assert r->'items'->1->'data'->>'short' = '가대' and r->'items'->1->>'year' = '2028', 'data·year 그대로';
  r := public.pre3_list('{"student":"87654321"}');
  assert r->>'ok' = 'true' and jsonb_array_length(r->'items') = 3, '고1·학생ID로도';
  begin
    insert into pre3_univs (key, kind, name) values ('zz', 'other', '엉뚱'); raise exception 'kind 제약이 없음';
  exception when check_violation then null; end;
end $$;

-- 권한: anon 은 표를 직접 못 읽고 함수만, authenticated(교사)는 쓰기 가능
do $$
begin
  assert not has_table_privilege('anon', 'public.pre3_univs', 'select'), 'anon select 없음';
  assert has_table_privilege('authenticated', 'public.pre3_univs', 'insert'), '교사 insert';
  assert not has_table_privilege('authenticated', 'public.pre3_univs', 'truncate'), '교사 truncate 없음';
  assert has_function_privilege('anon', 'public.pre3_list(jsonb)', 'execute'), 'anon 함수 실행';
end $$;
set role anon;
do $$ begin
  begin perform 1 from public.pre3_univs; raise exception 'anon 이 표를 읽음';
  exception when insufficient_privilege then null; end;
  assert (public.pre3_list('{"key":"tok-kim"}')->>'ok') = 'true', 'anon 으로 함수';
end $$;
reset role;
-- 096 체크리스트 저장 — 학생 확인·덮어쓰기·표시 수·모양 검사·내 것 읽기
do $$
declare r jsonb; sid bigint;
begin
  r := public.pre3_check_save('{"key":"nope","data":{"m":{}}}');
  assert r->>'ok' = 'false' and r->>'error' = 'no_student', '없는 학생 저장 거절';
  r := public.pre3_check_save('{"key":"tok-kim"}');
  assert r->>'ok' = 'false' and r->>'error' = 'bad_data', 'data 없음 거절';
  r := public.pre3_check_save('{"key":"tok-kim","data":[1,2]}');
  assert r->>'ok' = 'false' and r->>'error' = 'bad_data', '객체 아님 거절';
  r := public.pre3_check_save(jsonb_build_object('key','tok-kim','data', jsonb_build_object('f', jsonb_build_object('x', repeat('가', 20001)))));
  assert r->>'ok' = 'false' and r->>'error' = 'too_long', '20,000자 넘김 거절';
  r := public.pre3_check_mine('{"key":"tok-kim"}');
  assert r->>'ok' = 'true' and r->'data' = 'null'::jsonb, '저장 전 내 것 = null';
  r := public.pre3_check_save('{"key":"tok-kim","data":{"m":{"1":"o","7":"t","22":"x","9":"zz"},"f":{"f3w":"자습 전"},"at":1}}');
  assert r->>'ok' = 'true' and (r->>'at') is not null, '저장';
  select id into sid from students where code = 'tok-kim';
  assert (select count(*) from pre3_checks) = 1, '한 줄';
  assert (select marks from pre3_checks where student_id = sid) = 3, '표시 수 3(엉뚱한 값 zz 는 안 셈)';
  assert (select name || '|' || school || '|' || grade from pre3_checks where student_id = sid) = '김철수|화정중|2026 중등 3학년', '이름·학교·학년 스냅숏';
  r := public.pre3_check_mine('{"key":"tok-kim"}');
  assert r->'data'->'f'->>'f3w' = '자습 전' and (r->>'at') is not null, '내 것 읽기';
  r := public.pre3_check_save('{"student":"12345678","data":{"m":{"1":"o"},"f":{},"at":2}}');
  assert r->>'ok' = 'true', '학생ID로 저장(덮어쓰기)';
  assert (select count(*) from pre3_checks) = 1 and (select marks from pre3_checks where student_id = sid) = 1, '같은 학생은 한 줄로 덮어씀';
  r := public.pre3_check_mine('{"key":"tok-lee"}');
  assert r->>'ok' = 'true' and r->'data' = 'null'::jsonb, '다른 학생 것은 안 보임';
  delete from students where code = 'tok-kim';
  assert (select count(*) from pre3_checks) = 0, '학생을 지우면 체크리스트도(cascade)';
end $$;
do $$
begin
  assert not has_table_privilege('anon', 'public.pre3_checks', 'select'), 'anon select 없음(체크리스트)';
  assert has_table_privilege('authenticated', 'public.pre3_checks', 'select'), '교사 select';
  assert not has_table_privilege('authenticated', 'public.pre3_checks', 'insert'), '교사 insert 없음(함수로만)';
  assert not has_table_privilege('authenticated', 'public.pre3_checks', 'update'), '교사 update 없음';
  assert has_function_privilege('anon', 'public.pre3_check_save(jsonb)', 'execute'), 'anon 저장 함수';
  assert has_function_privilege('anon', 'public.pre3_check_mine(jsonb)', 'execute'), 'anon 읽기 함수';
end $$;
set role anon;
do $$ begin
  begin perform 1 from public.pre3_checks; raise exception 'anon 이 체크리스트 표를 읽음';
  exception when insufficient_privilege then null; end;
  assert (public.pre3_check_save('{"key":"tok-lee","data":{"m":{"2":"t"},"f":{}}}')->>'ok') = 'true', 'anon 으로 저장 함수';
  assert (public.pre3_check_mine('{"key":"tok-lee"}')->'data'->'m'->>'2') = 't', 'anon 으로 읽기 함수';
end $$;
reset role;
select 'pre3 SQL 검증 통과' as result;
SQL
