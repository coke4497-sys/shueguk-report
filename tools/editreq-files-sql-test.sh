#!/usr/bin/env bash
# 수정 요청함 첨부 파일(060) 검증 — 로컬 PostgreSQL.
# 저장소(storage) 스키마는 흉내만 만들고 060 을 두 번 얹어(재실행 안전) 표·버킷·권한을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/editreq-files-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=editreq_files_test_$$
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
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/060_edit_req_files.sql >/dev/null; done

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ declare n int; begin
  select count(*) into n from storage.buckets where id = 'edit-req-files' and public = false and file_size_limit = 20971520;
  assert n = 1, 'bucket';
end $$;

-- 선생님: 줄을 넣고 읽는다(같은 열쇠로 여러 파일)
set role authenticated;
insert into edit_req_files (req_key, writer, path, name, size, mime) values
  ('rq_abc123def456', '김현지', 'r/rq_abc123def456/aaaa.png', '캡처_1026_153012.png', 2048, 'image/png'),
  ('rq_abc123def456', '김현지', 'r/rq_abc123def456/bbbb.pdf', '시험 범위 안내.pdf', 4096, 'application/pdf');
do $$ declare n int; begin
  select count(*) into n from edit_req_files where req_key = 'rq_abc123def456';
  assert n = 2, 'teacher rw';
end $$;
-- 같은 경로는 두 번 못 넣는다
do $$ begin
  begin insert into edit_req_files (req_key, path) values ('rq_x', 'r/rq_abc123def456/aaaa.png'); assert false, 'path unique';
  exception when unique_violation then null; end;
end $$;
insert into storage.objects (bucket_id, name) values ('edit-req-files', 'r/rq_abc123def456/aaaa.png');
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'edit-req-files';
  assert n = 1, 'teacher storage';
end $$;
reset role;

-- 공개 키(anon): 표도 저장소도 안 된다
set role anon;
do $$ begin
  begin perform 1 from edit_req_files; assert false, 'anon select';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'edit-req-files';
  assert n = 0, 'anon storage read';
end $$;
reset role;
SQL
echo "060 검증 통과"
