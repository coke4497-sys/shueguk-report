#!/usr/bin/env bash
# 별 선물 사유 다듬기(056) 검증 — 로컬 PostgreSQL.
# 050 위에 056을 두 번 얹어(재실행 안전) 옛 기록은 원문이 reason_nice 로 채워지고, 새 기록은 빈 값(다듬기 전)으로
# 들어가며, student_bundle 의 star_bonus 항목에 reason_nice 가 담기는지 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/star-reason-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=sreason_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31,35,43}_*.sql supabase/migrations/048_report_teacher.sql supabase/migrations/050_star_bonus_giver.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled, teacher) values ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원','이현지');
insert into star_bonus (at, student_id, name, school, stars, reason, grade, giver) values ('2026-10-01 10:00+09','','박보검','화정고',1,'옛 사유','고2','김현지');
insert into star_bonus (at, student_id, name, school, stars, reason, grade) values ('2026-10-02 10:00+09','','박보검','화정고',1,'','고2');
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/056_star_reason_nice.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into star_bonus (at, student_id, name, school, stars, reason, grade, giver) values ('2026-10-19 10:00+09','','박보검','화정고',2,'모고 잘함','고2','김덕기');
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/056_star_reason_nice.sql >/dev/null   # 재실행 — 다듬기 전 줄을 원문으로 채우면 안 됨
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$
declare r jsonb; a jsonb;
begin
  r := student_bundle('tok-park');
  a := r->'star_bonus';
  if jsonb_array_length(a) <> 3 then raise exception '별 기록 3건이어야 함: %', a; end if;
  if a->0->>'reason_nice' <> '옛 사유' then raise exception '옛 기록은 원문으로 채움: %', a->0; end if;
  if a->1->>'reason_nice' <> '' then raise exception '사유 없는 옛 기록은 빈 값: %', a->1; end if;
  if a->2->>'reason_nice' <> '' then raise exception '새 기록은 다듬기 전(빈 값) — 재실행이 채우면 안 됨: %', a->2; end if;
  if a->2->>'reason' <> '모고 잘함' or a->2->>'giver' <> '김덕기' then raise exception '다른 칸 유지: %', a->2; end if;
  update star_bonus set reason_nice = '모의고사를 끝까지 성실하게 잘 풀었습니다.' where reason = '모고 잘함';
  if student_bundle('tok-park')->'star_bonus'->2->>'reason_nice' <> '모의고사를 끝까지 성실하게 잘 풀었습니다.' then raise exception '다듬은 문장 반영'; end if;
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
echo "통과: 056 별 사유 다듬기 (열·옛 기록 채움·재실행 안전·bundle reason_nice·anon 차단)"
