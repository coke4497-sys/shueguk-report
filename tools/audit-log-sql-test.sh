#!/usr/bin/env bash
# 090 '누가' 기록 검증 — 로컬 PostgreSQL. 원격에는 절대 돌리지 말 것.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/audit-log-sql-test.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=audit_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists private;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create table public.teacher_accounts (user_id uuid primary key, display_name text, active boolean default true, role text default 'teacher');
create or replace function private.activity_viewer() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.teacher_accounts t where t.user_id = auth.uid() and t.active and t.role = 'admin') $$;
create table public.tt_log (id bigserial primary key, kind text, student text, reason text, updated_at timestamptz default now());
create table public.notices (id bigserial primary key, title text, body text, photo text);
create table public.msg_reads (user_id uuid primary key, last_id bigint);
insert into teacher_accounts values ('11111111-1111-1111-1111-111111111111','김지원',true,'teacher'),
                                    ('22222222-2222-2222-2222-222222222222','이수경',true,'admin');
SQL
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/090_audit_log.sql >/dev/null; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
-- 개인 로그인
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111","email":"kjw@shueguk.internal"}', false);
insert into tt_log (kind, student, reason) values ('1회', '박보검', '병결');
update tt_log set reason = '병결(보충)' where student = '박보검';
update tt_log set reason = '병결(보충)', updated_at = now() where student = '박보검';  -- 바뀐 것 없음 → 기록 안 함
-- 공용 계정
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"99999999-9999-9999-9999-999999999999","email":"teachers@shueguk.internal"}', false);
insert into notices (title, body, photo) values ('공지', repeat('가', 500), 'data:image/png;base64,AAAA');
-- 학생 페이지(공개 키)
select set_config('request.jwt.claims', '{"role":"anon"}', false);
delete from tt_log where student = '박보검';
-- 관리자 SQL
select set_config('request.jwt.claims', '', false);
update notices set title = '공지2';
-- 제외 표
insert into msg_reads values ('11111111-1111-1111-1111-111111111111', 5);
do $$ declare r record; n int;
begin
  select count(*) into n from audit_log; assert n = 5, '기록 5줄 (지금 '||n||')';
  select * into r from audit_log where tbl='tt_log' and op='I'; assert r.who = '김지원' and r.uid = '11111111-1111-1111-1111-111111111111', '개인 이름';
  select * into r from audit_log where tbl='tt_log' and op='U'; assert r.changed = array['reason'] and r.old->>'reason' = '병결' and r.new->>'reason' = '병결(보충)', '바뀐 열만';
  select * into r from audit_log where tbl='notices' and op='I'; assert r.who = '공용 교사 계정', '공용 계정 표시';
  assert r.new->>'photo' = '(생략)' and length(r.new->>'body') = 301, '큰 열 생략·긴 글 자름';
  select * into r from audit_log where tbl='tt_log' and op='D'; assert r.who = '학생 페이지' and r.old->>'student' = '박보검', '공개 키';
  select * into r from audit_log where tbl='notices' and op='U'; assert r.who = '관리자 직접(SQL)' and r.via = 'sql', 'SQL';
  assert not exists (select 1 from audit_log where tbl='msg_reads'), '제외 표';
  assert not exists (select 1 from audit_log where tbl='audit_log'), '자기 자신 없음';
end $$;
-- 읽기 권한
grant usage on schema private to authenticated;
grant execute on function private.activity_viewer() to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}', false);
do $$ begin assert (select count(*) from audit_log) = 0, '선생님은 못 읽음'; end $$;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"22222222-2222-2222-2222-222222222222"}', false);
do $$ begin assert (select count(*) from audit_log) = 5, '원장님은 읽음'; end $$;
do $$ begin
  begin insert into audit_log (tbl, op) values ('x','I'); assert false, '직접 쓰기 막힘';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
SQL
echo "audit-log-sql-test 통과"
