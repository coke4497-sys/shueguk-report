#!/usr/bin/env bash
# 별 선물 — 별을 준 선생님 이름(050) 검증 — 로컬 PostgreSQL.
# 048 위에 050을 두 번 얹어(재실행 안전) star_bonus.giver 열이 생기고, student_bundle 의 star_bonus 항목에 giver 가 담기는지,
# 옛 기록은 빈 값인지, 공개 키로 표를 직접 못 읽는지 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/star-giver-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=sgiver_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31,35,43}_*.sql supabase/migrations/048_report_teacher.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled, teacher) values ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원','이현지');
insert into star_bonus (at, student_id, name, school, stars, reason, grade) values ('2026-10-01 10:00+09','','박보검','화정고',1,'옛 기록','고2');
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/050_star_bonus_giver.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/050_star_bonus_giver.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into star_bonus (at, student_id, name, school, stars, reason, grade, giver) values ('2026-10-14 10:00+09','','박보검','화정고',2,'수업 태도','고2','김현지');
do $$
declare r jsonb; a jsonb;
begin
  r := student_bundle('tok-park');
  a := r->'star_bonus';
  if jsonb_array_length(a) <> 2 then raise exception '별 기록 2건이어야 함: %', a; end if;
  if a->0->>'giver' <> '' then raise exception '옛 기록 giver 는 빈 값: %', a->0; end if;
  if a->1->>'giver' <> '김현지' then raise exception '새 기록 giver: %', a->1; end if;
  if a->1->>'reason' <> '수업 태도' or (a->1->>'stars')::int <> 2 then raise exception '다른 칸 유지: %', a->1; end if;
  if r->'submissions' is null then raise exception 'bundle 다른 항목 유지'; end if;
end $$;
set role anon;
do $$ begin
  begin perform 1 from public.star_bonus limit 1; raise exception 'anon 이 표를 읽으면 안 됨';
  exception when insufficient_privilege then null; end;
  perform public.student_bundle('tok-park');
end $$;
reset role;
SQL
echo "통과: 050 별을 준 선생님 (열·재실행·bundle giver·옛 기록 빈 값·anon 차단)"
