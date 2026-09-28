#!/usr/bin/env bash
# 숙제 검사 수업별 기록(035) 검증 — 로컬 PostgreSQL.
# 001~031 뒤 035를 두 번 얹고(재실행 안전) (주차·학생·반ID) 유일 조건, 옛 기록 보존, student_bundle 의 새 열을 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/hwcheck-class-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=hwclass_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
# 옛 기록(035 이전 — 주차·학생당 한 줄)
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원');
insert into hwcheck_records (week, token, name, pct, scores) values ('2026-09-16','tok-park','박보검',100,'{"숙제 수행":6}');
SQL
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/035_hwcheck_per_class.sql >/dev/null; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$
declare r jsonb; n int;
begin
  select count(*) into n from hwcheck_records where week='2026-09-16' and class_id='';
  assert n = 1, '옛 기록은 class_id 빈 값으로 남는다';
  -- 같은 주 가·나 수업 각각
  insert into hwcheck_records (week, token, class_id, part, class_name, pct) values
    ('2026-09-23','tok-park','r010','가','고2 가',100), ('2026-09-23','tok-park','r011','나','고2 나',100);
  -- 같은 수업은 한 줄 (on conflict 대상)
  insert into hwcheck_records (week, token, class_id, part, pct) values ('2026-09-23','tok-park','r010','가',50)
    on conflict (week, token, class_id) do update set pct = excluded.pct;
  select pct into n from hwcheck_records where week='2026-09-23' and class_id='r010';
  assert n = 50, '같은 수업은 덮어쓰기';
  begin
    insert into hwcheck_records (week, token, class_id) values ('2026-09-23','tok-park','r011');
    raise exception 'dup allowed';
  exception when unique_violation then null; end;
  select count(*) into n from pg_constraint where conrelid='public.hwcheck_records'::regclass and contype='u';
  assert n = 1, '유일 조건은 하나(옛 week,token 제거): ' || n;
  r := student_bundle('tok-park');
  assert jsonb_array_length(r->'hwcheck_records') = 3, 'bundle 3줄: ' || (r->'hwcheck_records')::text;
  assert r->'hwcheck_records'->1->>'class_id' = 'r010' and r->'hwcheck_records'->1->>'part' = '가'
     and r->'hwcheck_records'->2->>'class_name' = '고2 나', 'bundle 새 열: ' || (r->'hwcheck_records')::text;
  assert r->'hwcheck_records'->0->>'class_id' = '', '옛 기록 먼저(주차순)';
end $$;
SQL
echo "hwcheck-class-sql-test: 통과"
