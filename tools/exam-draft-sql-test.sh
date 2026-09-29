#!/usr/bin/env bash
# 지필 리포트 자동 생성(036) 검증 — 로컬 PostgreSQL.
# 저장소(storage) 스키마는 흉내만 만들고 036 을 두 번 얹어(재실행 안전) 표·버킷·권한·상태 조건을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/exam-draft-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=exam_draft_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on all sequences in schema storage to anon, authenticated;
SQL
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/036_exam_drafts.sql >/dev/null; done

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$
declare n int; ok boolean;
begin
  -- 버킷: 비공개 · 20MB
  select count(*) into n from storage.buckets where id = 'exam-drafts' and public = false and file_size_limit = 20971520;
  assert n = 1, 'bucket';
end $$;

-- 선생님: 쓰고 읽고 고친다
set role authenticated;
insert into exam_drafts (title, period, school, grade, subject, files)
  values ('26-2-중간-화정고1-공통국어2', '26-2-중간', '화정고', '1', '공통국어2', '[{"path":"d1/a.pdf","kind":"시험지"}]');
update exam_drafts set status = '완료', draft = '{"questions":[]}'::jsonb, report_id = '26-2-중간-화정고1-공통국어2';
do $$ declare r record; begin
  select * into r from exam_drafts;
  assert r.status = '완료' and r.report_id <> '' and jsonb_array_length(r.files) = 1, 'teacher rw';
end $$;
insert into storage.objects (bucket_id, name) values ('exam-drafts', 'd1/a.pdf');
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'exam-drafts';
  assert n = 1, 'teacher storage';
end $$;
-- 상태는 세 가지만
do $$ begin
  begin update exam_drafts set status = '접수됨'; assert false, 'status check';
  exception when check_violation then null; end;
end $$;
reset role;

-- 공개 키(anon): 표도 저장소도 안 된다
set role anon;
do $$ begin
  begin perform 1 from exam_drafts; assert false, 'anon select';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'exam-drafts';
  assert n = 0, 'anon storage read';
end $$;
reset role;
SQL
echo "036 검증 통과"
