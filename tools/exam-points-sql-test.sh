#!/usr/bin/env bash
# 문항 배점(046) 검증 — 로컬 PostgreSQL. exam_questions.pts 열·exam_bundle 이 배점을 돌려주는지, 재실행 안전·권한.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/exam-points-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=expts_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,13,14,15}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into exams (report_id, title) values ('T1','T1');
insert into exam_questions (report_id, seq, no, area, qtype, lv, txt) values ('T1',1,'1','문학','객관식','중','a'),('T1',2,'2','문학','객관식','중','b');
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/046_exam_points.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/046_exam_points.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$
declare b jsonb;
begin
  assert (select count(*) from exam_questions where pts = 0) = 2, '옛 문항은 배점 0(미지정)';
  update exam_questions set pts = 3.5 where no = '1';
  update exam_questions set pts = 96.5 where no = '2';
  set local role anon;
  b := public.exam_bundle('T1');
  reset role;
  assert b->>'found' = 'true', 'exam_bundle found';
  assert (b->'questions'->0->>'pts')::numeric = 3.5, '배점 3.5';
  assert (b->'questions'->1->>'pts')::numeric = 96.5, '배점 96.5';
  assert (b->'questions'->0->>'no') = '1', '순서 seq';
  assert (select coalesce(sum(pts),0) from exam_questions where report_id='T1') = 100, '합 100';
  begin
    set local role anon;
    perform * from exam_questions;
    reset role;
    raise exception '공개 키가 표를 직접 읽으면 안 된다';
  exception when insufficient_privilege then reset role;
  end;
  raise notice '046 검증 통과';
end $$;
SQL
echo "exam-points-sql-test: OK"
