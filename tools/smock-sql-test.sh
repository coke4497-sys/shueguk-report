#!/usr/bin/env bash
# 학력평가 성적(057) 왕복 검증 — 로컬 PostgreSQL.
# 001~057 을 모두 얹고(저장소·auth 스키마는 흉내) smock_mine/smock_submit·열린 회차·학년·
# 틀린 문항 범위·덮어쓰기·first·student_bundle 'smock_entries'·권한을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/smock-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=smock_test_$$
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
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/057_school_mock.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/058_school_mock_info.sql >/dev/null

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','김철수','화정고','2026 고등 1학년','tok-kim','재원'),
  ('87654321','이영희','화정고','2026 고등 3학년','tok-lee','재원'),
  ('11112222','박중등','화정중','2026 중등 3학년','tok-mid','재원');
insert into smock_exams (key, year, month, grade, layout, title, open) values
  ('2026-10-고1', 2026, 10, '고1', '통합', '2026년 10월 고1 학력평가', true),
  ('2026-09-고1', 2026, 9,  '고1', '통합', '2026년 9월 고1 모의평가', false),
  ('2026-10-고3', 2026, 10, '고3', '고3', '2026년 10월 고3 학력평가', true);

do $$
declare r jsonb;
begin
  -- 학년 풀이
  assert public.smock_grade_('2026 고등 1학년') = '고1', 'grade 고1';
  assert public.smock_grade_('2026 중등 3학년') = '', 'grade 중3 → 빈 값';
  assert public.smock_grade_('고2') = '고2', 'grade 고2';

  -- 학생 확인
  r := public.smock_mine('{"key":"nope"}');
  assert r->>'ok' = 'false', 'no student';
  r := public.smock_mine('{"key":"tok-kim"}');
  assert r->>'grade' = '고1', 'mine grade';
  assert jsonb_array_length(r->'open') = 1 and r->'open'->0->>'key' = '2026-10-고1', 'open 회차는 내 학년·열린 것만';
  assert jsonb_array_length(r->'entries') = 0, 'entries 0';
  r := public.smock_mine('{"student":"12345678"}');
  assert r->>'ok' = 'true', '학생ID로도 찾음';

  -- 제출 거절
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-09-고1","score":"80"}');
  assert r->>'error' = 'closed', 'closed';
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고3","score":"80"}');
  assert r->>'error' = 'wrong_grade', 'wrong grade';
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":""}');
  assert r->>'error' = 'no_score', 'no score';
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"120"}');
  assert r->>'error' = 'bad_score', 'bad score';
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"80","wrong":{"화법":[7]}}');
  assert r->>'error' = 'bad_wrong', '범위 밖 문항';
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"80","wrong":{"선택":[40]}}');
  assert r->>'error' = 'bad_wrong', '통합형에 선택 영역 없음';
  r := public.smock_submit('{"key":"tok-mid","exam":"2026-10-고1","score":"80"}');
  assert r->>'error' = 'wrong_grade', '중학생 거절';

  -- 정상 제출 → first, 다시 내면 덮어씀
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"84","feel":"중, 최상, 이상한값","wrong":{"독서":[13,12,12],"문학":[]},"review":"시간이 부족했어요"}');
  assert r->>'ok' = 'true' and r->>'first' = 'true', 'first';
  assert (select wrong from smock_entries where code='tok-kim') = '{"독서":[12,13]}'::jsonb, '정리된 틀린 문항';
  assert (select feel from smock_entries where code='tok-kim') = '최상, 중', '체감 난이도 정리';
  assert (select score from smock_entries where code='tok-kim') = 84, 'score';
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"미채점"}');
  assert r->>'first' = 'false', '두 번째는 first 아님';
  assert (select count(*) from smock_entries where code='tok-kim') = 1, '한 줄';
  assert (select score is null and score_text = '미채점' from smock_entries where code='tok-kim'), '숫자 아님 → null';

  -- 고3: 선택과목 필수
  r := public.smock_submit('{"key":"tok-lee","exam":"2026-10-고3","score":"88","wrong":{"선택":[40]}}');
  assert r->>'error' = 'no_subject', '선택과목 필요';
  r := public.smock_submit('{"key":"tok-lee","exam":"2026-10-고3","score":"88","subject":"언어와매체","wrong":{"선택":[40],"문학":[18]}}');
  assert r->>'ok' = 'true', '고3 정상';

  r := public.smock_mine('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'entries') = 1 and r->'entries'->0->>'exam' = '2026-10-고1', 'mine entries';

  -- student_bundle
  r := public.student_bundle('tok-kim', false, '');
  assert jsonb_array_length(r->'smock_entries') = 1, 'bundle smock_entries';
  r := public.student_bundle('87654321', true, '');
  assert jsonb_array_length(r->'smock_entries') = 1, 'bundle 학생ID로 연 경우도';
end $$;

-- 058: 배점이 있는 회차는 서버가 점수를 계산한다
update smock_exams set info = jsonb_build_object('points', (select jsonb_agg(case when i in (3,6,14,16,22,27,33,38,42,45) then 3 else 2 end order by i) from generate_series(1,45) i))
 where key = '2026-10-고1';
do $$
declare r jsonb;
begin
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"","wrong":{"독서":[14,15],"문학":[45]}}');
  assert r->>'ok' = 'true' and (r->>'score')::numeric = 92, '자동 점수 100-3-2-3=92: ' || r::text;
  r := public.smock_submit('{"key":"tok-kim","exam":"2026-10-고1","score":"10","wrong":{}}');
  assert (r->>'score')::numeric = 100, '화면 점수는 무시';
  assert (select score_text from smock_entries where code='tok-kim' and exam_key='2026-10-고1') = '100', 'score_text';
  r := public.smock_mine('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'open'->0->'info'->'points') = 45, 'mine 에 info';
end $$;

-- 권한: anon 은 표를 못 읽고 함수만
set role anon;
do $$ begin
  begin perform 1 from public.smock_entries; assert false, 'anon 표 읽기'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.smock_exams;   assert false, 'anon 회차 표 읽기'; exception when insufficient_privilege then null; end;
  perform public.smock_mine('{"key":"tok-kim"}');
end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.smock_entries;
  insert into public.smock_exams (key, year, month, grade) values ('2027-03-고1', 2027, 3, '고1');
  insert into public.smock_entries (exam_key, code, name, src) values ('2027-03-고1', 'tok-kim', '김철수', '설문');
end $$;
reset role;
SQL
echo "smock SQL 검증 통과"
