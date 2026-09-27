#!/usr/bin/env bash
# 복습 영상(031) + 자료 파일(032) 왕복 검증 — 로컬 PostgreSQL.
# 001~012 + 027~029(student_bundle 선행) 뒤 031을 얹고 review_list/open/save·90% 판정·first·상한·
# 배정 안 된 학생 거절·student_bundle 'review_done'·권한을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/review-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=review_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
# 두 번 적용해도 되는지(재실행 안전)
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/031_review_videos.sql >/dev/null
# 032 는 수파베이스 저장소(storage) 스키마가 있어야 한다 — 로컬에는 흉내만 만든다(버킷·객체 표 + RLS)
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
SQL
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/032_review_files.sql >/dev/null; done

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','김철수','화정고','2026 고등 1학년','tok-kim','재원'),
  ('87654321','이영희','화정고','2026 고등 1학년','tok-lee','재원');
insert into review_videos (yt_id, title) values ('abcdefghijk', '9/27 복습');
insert into review_targets (video_id, code, student_id, name, class_name) values (1, 'tok-kim', '12345678', '김철수', '고1 가');
do $$
declare r jsonb; b jsonb;
begin
  -- 배정된 학생: 목록 1건, 진행 0
  r := review_list('{"key":"tok-kim"}');
  assert (r->>'ok')::boolean and jsonb_array_length(r->'items') = 1 and (r->'items'->0->>'pct')::int = 0, 'list: ' || r::text;
  assert (r->'items'->0->>'cls') = '고1 가', 'cls';
  -- 학생ID로도 찾는다
  r := review_list('{"student":"12345678"}');
  assert jsonb_array_length(r->'items') = 1, 'list by id';
  -- 배정 안 된 학생: 목록 비고, 열기·저장 거절
  r := review_list('{"key":"tok-lee"}');
  assert jsonb_array_length(r->'items') = 0, 'lee list';
  r := review_open('{"key":"tok-lee","video":1}');
  assert r->>'error' = 'not_assigned', 'lee open';
  r := review_save('{"key":"tok-lee","video":1,"duration":100,"ranges":[[0,100]]}');
  assert r->>'error' = 'not_assigned', 'lee save';
  r := review_list('{"key":"없음"}');
  assert r->>'error' = 'no_student', 'no student';
  -- 길이 없이 저장 → no_duration
  r := review_save('{"key":"tok-kim","video":1,"ranges":[[0,10]]}');
  assert r->>'error' = 'no_duration', 'no dur: ' || r::text;
  -- 첫 저장: 길이 채움 + 0~40초
  r := review_save('{"key":"tok-kim","video":1,"duration":100.4,"ranges":[[0,40]],"add_sec":40,"pos":40}');
  assert (r->>'pct')::int = 40 and not (r->>'done')::boolean and (r->>'sec')::int = 40, 'save1: ' || r::text;
  assert (select duration from review_videos where id=1) = 100, 'duration';
  -- 겹치는 구간은 한 번만: 30~60 → 60%
  r := review_save('{"key":"tok-kim","video":1,"duration":100,"ranges":[[30,60]],"add_sec":30,"pos":60}');
  assert (r->>'pct')::int = 60 and (r->>'sec')::int = 70, 'save2: ' || r::text;
  -- 한 번에 받는 시청 시간은 120초 상한, 범위 밖은 잘림
  r := review_save('{"key":"tok-kim","video":1,"ranges":[[-5,0],[200,300],[80,85]],"add_sec":999}');
  assert (r->>'pct')::int = 65 and (r->>'sec')::int = 190, 'cap: ' || r::text;
  -- 89% 는 완료 아님
  r := review_save('{"key":"tok-kim","video":1,"ranges":[[60,80],[85,89]]}');
  assert (r->>'pct')::int = 89 and not (r->>'done')::boolean, '89: ' || r::text;
  -- 90% 도달 → done·first
  r := review_save('{"key":"tok-kim","video":1,"ranges":[[89,90]]}');
  assert (r->>'pct')::int = 90 and (r->>'done')::boolean and (r->>'first')::boolean, '90: ' || r::text;
  -- 다시 저장 → done 이지만 first 아님
  r := review_save('{"key":"tok-kim","video":1,"ranges":[[90,100]]}');
  assert (r->>'pct')::int = 100 and (r->>'done')::boolean and not (r->>'first')::boolean, '100: ' || r::text;
  -- 열기: bits 길이·이어 볼 위치
  r := review_open('{"key":"tok-kim","video":1}');
  assert length(r->>'bits') = 100 and (r->>'done')::boolean and (r->>'yt') = 'abcdefghijk', 'open: ' || left(r::text, 200);
  -- 한 번에 300초 넘는 구간은 잘린다
  insert into review_videos (yt_id, title) values ('zzzzzzzzzzz', '긴 영상');
  insert into review_targets (video_id, code, name) values (2, 'tok-kim', '김철수');
  r := review_save('{"key":"tok-kim","video":2,"duration":1000,"ranges":[[0,1000]]}');
  assert (r->>'pct')::int = 30, 'cap300: ' || r::text;
  -- 숨긴 영상은 목록·열기에서 빠진다
  update review_videos set active = false where id = 2;
  r := review_list('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 1, 'inactive list';
  -- student_bundle: review_done 1건(김철수), 이영희 0건
  b := student_bundle('tok-kim', false, '');
  assert jsonb_array_length(b->'review_done') = 1 and (b->'review_done'->0->>'video_id')::int = 1, 'bundle: ' || (b->'review_done')::text;
  b := student_bundle('tok-lee', false, '');
  assert jsonb_array_length(b->'review_done') = 0, 'bundle lee';
  -- 영상을 지우면 배정·기록도 함께 사라진다
  delete from review_videos where id = 2;
  assert (select count(*) from review_watch where video_id = 2) = 0 and (select count(*) from review_targets where video_id = 2) = 0, 'cascade';
end $$;
-- ── 032 자료 파일 ──
insert into review_videos (yt_id, title) values ('bbbbbbbbbbb', '자료 영상');
insert into review_targets (video_id, code, name) select id, 'tok-kim', '김철수' from review_videos where title = '자료 영상';
insert into review_files (video_id, path, name, size, mime) select id, 'v' || id || '/abc.pdf', '9월 복습지.pdf', 1234, 'application/pdf' from review_videos where title = '자료 영상';
insert into storage.objects (bucket_id, name) select 'review-files', path from review_files;
insert into storage.objects (bucket_id, name) values ('other', 'x');
do $$
declare r jsonb; vid bigint; fid bigint;
begin
  select id into vid from review_videos where title = '자료 영상';
  select id into fid from review_files limit 1;
  assert (select public = false and file_size_limit = 20971520 from storage.buckets where id = 'review-files'), '버킷 비공개·20MB';
  r := review_open(jsonb_build_object('key', 'tok-kim', 'video', vid));
  assert jsonb_array_length(r->'files') = 1 and r->'files'->0->>'name' = '9월 복습지.pdf' and not (r->'files'->0 ? 'path'), 'open files(경로 없음): ' || (r->'files')::text;
  r := review_list('{"key":"tok-kim"}');
  assert (select (x->>'nfiles')::int from jsonb_array_elements(r->'items') x where (x->>'id')::bigint = vid) = 1, 'list nfiles';
  assert not review_file_ok((select path from review_files where id = fid)), '창 열기 전 닫힘';
  r := review_file_url(jsonb_build_object('key', 'tok-lee', 'file', fid));
  assert r->>'error' = 'not_assigned', '배정 안 된 학생 거절';
  assert not review_file_ok((select path from review_files where id = fid)), '거절 뒤에도 닫힘';
  r := review_file_url(jsonb_build_object('key', 'tok-kim', 'file', fid));
  assert (r->>'ok')::boolean and r->>'path' = 'v' || vid || '/abc.pdf' and r->>'bucket' = 'review-files' and r->>'name' = '9월 복습지.pdf', 'file_url: ' || r::text;
  assert review_file_ok(r->>'path'), '창 열림';
  update review_videos set active = false where id = vid;
  r := review_file_url(jsonb_build_object('key', 'tok-kim', 'file', fid));
  assert r->>'error' = 'not_assigned', '숨긴 영상 파일 거절';
  update review_videos set active = true where id = vid;
end $$;
-- anon 저장소 읽기: 창이 열린 파일만 보인다
set role anon;
do $$ begin
  assert (select count(*) from storage.objects) = 1, 'anon: 열린 파일 1개만 (' || (select count(*) from storage.objects) || ')';
end $$;
reset role;
update review_files set open_until = now() - interval '1 minute';
set role anon;
do $$ begin assert (select count(*) from storage.objects) = 0, 'anon: 창 닫히면 0'; end $$;
reset role;
set role authenticated;
do $$ begin assert (select count(*) from storage.objects where bucket_id = 'review-files') = 1, '선생님은 늘 보임'; end $$;
reset role;
-- 영상을 지우면 파일 목록도 사라진다
delete from review_videos where title = '자료 영상';
do $$ begin assert (select count(*) from review_files) = 0, 'cascade files'; end $$;

-- 권한: anon 은 표를 못 읽고 함수만
set role anon;
do $$ begin
  begin perform 1 from review_watch; raise exception 'anon read review_watch'; exception when insufficient_privilege then null; end;
  begin perform 1 from review_targets; raise exception 'anon read review_targets'; exception when insufficient_privilege then null; end;
  begin perform 1 from review_files; raise exception 'anon read review_files'; exception when insufficient_privilege then null; end;
  perform review_list('{"key":"tok-kim"}');
  begin perform review_me_('{"key":"tok-kim"}'); raise exception 'anon review_me_'; exception when insufficient_privilege then null; end;
end $$;
reset role;
SQL
echo "review-sql-test: 모두 통과"
