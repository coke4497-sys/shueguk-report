#!/usr/bin/env bash
# 공지 첨부 파일(055) 왕복 검증 — 로컬 PostgreSQL.
# 001~012 + 019·022·027~029·031 뒤 055를 얹고 공지 대상 학생만 목록·내려받기 창을 받는지,
# 숨김 공지·대상 밖 학생 거절, 창이 열린 경로만 notice_file_ok, 공개 키 표 차단을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/notice-files-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=notice_files_test_$$
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
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,19,22,27,28,29,31}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/055_notice_files.sql >/dev/null; done

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','김철수','화정고','2026 고등 3학년','tok-kim','재원'),
  ('87654321','이영희','화정고','2026 고등 1학년','tok-lee','재원');
insert into notices (seq, date, type, target, title, body, hidden) values
  (2, '2026-10-18', '학년', '고3', 'OX 정답과 해설', '', false),
  (3, '2026-10-18', '학년', '고3', '숨긴 공지', '', true);
insert into notice_files (notice_key, path, name, size, mime) values
  ('2026-10-18|OX 정답과 해설', 'n/aaa.pdf', 'OX 정답과 해설.pdf', 1000, 'application/pdf'),
  ('2026-10-18|숨긴 공지', 'n/bbb.pdf', '숨김.pdf', 10, 'application/pdf');
do $$
declare r jsonb;
begin
  r := notice_files_mine('{"key":"tok-kim"}');
  assert (r->>'ok')::boolean and jsonb_array_length(r->'files') = 1, 'kim list: ' || r::text;
  assert r->'files'->0->>'key' = '2026-10-18|OX 정답과 해설' and r->'files'->0->>'name' = 'OX 정답과 해설.pdf', 'kim item';
  assert not (r->'files'->0 ? 'path'), '목록에 경로를 싣지 않는다';
  r := notice_files_mine('{"student":"12345678"}');
  assert jsonb_array_length(r->'files') = 1, 'by student id';
  r := notice_files_mine('{"key":"tok-lee"}');
  assert jsonb_array_length(r->'files') = 0, 'lee(고1) 목록 비어야';
  r := notice_files_mine('{"key":"없음"}');
  assert r->>'error' = 'no_student', 'no student';
  -- 창 열기 전에는 공개 키 읽기 판정 거짓
  assert not notice_file_ok('n/aaa.pdf'), 'closed';
  r := notice_file_url('{"key":"tok-lee","file":"1"}');
  assert r->>'error' = 'not_visible', 'lee 거절';
  assert not notice_file_ok('n/aaa.pdf'), 'lee 거절 뒤에도 닫힘';
  r := notice_file_url('{"key":"tok-kim","file":"2"}');
  assert r->>'error' = 'not_visible', '숨김 공지 거절';
  r := notice_file_url('{"key":"tok-kim","file":"abc"}');
  assert r->>'error' = 'not_visible', '잘못된 번호';
  r := notice_file_url('{"key":"tok-kim","file":"1"}');
  assert (r->>'ok')::boolean and r->>'bucket' = 'notice-files' and r->>'path' = 'n/aaa.pdf', 'kim url: ' || r::text;
  assert notice_file_ok('n/aaa.pdf'), '창 열림';
  assert not notice_file_ok('n/bbb.pdf'), '다른 파일은 닫힘';
end $$;
SQL
# 권한: 공개 키(anon)는 표를 못 읽고 함수만
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
set role anon;
do $$ begin
  begin perform 1 from notice_files; raise exception 'anon 이 표를 읽었다';
  exception when insufficient_privilege then null; end;
end $$;
select notice_files_mine('{"key":"tok-kim"}') is not null;
reset role;
select 1 from storage.buckets where id = 'notice-files' and public = false;
SQL
echo "notice-files-sql-test: OK"
