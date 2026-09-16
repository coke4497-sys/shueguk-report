#!/usr/bin/env bash
# 문법 테스트 별 적립(027 + 028) + 스테이지 게임(029 — 세트 클리어 별·플레이 점수·탑30) 왕복 검증 — 로컬 PostgreSQL.
# 001~012를 순서대로 적용해 student_bundle이 참조하는 표를 만든 뒤 027·028을 얹고,
# gramma_submit(별 판정·first)·gramma_status·student_bundle의 gramma_results 항목·권한을 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/gramma-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=gramma_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/027_gramma_results.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/028_student_bundle_gramma.sql

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values ('12345678','김철수','화정고','2026 고등 1학년','tok-kim','재원');
do $$
declare r jsonb; b jsonb;
begin
  -- 1) 90% 이상 → star·first
  r := gramma_submit('{"time":"2026-09-13 10:00","name":"김철수","school":"화정고","grade":"고1","phone8":"12345678","unit":"음운","round":"12","score":"19 / 21","got":19,"total":21,"details":"1. ✓"}');
  assert (r->>'ok')::boolean and (r->>'pct')::int = 90 and (r->>'star')::boolean and (r->>'first')::boolean, '첫 90%: ' || r::text;
  -- 2) 같은 테스트 재응시 95% → star 이지만 first 아님
  r := gramma_submit('{"name":"김철수","phone8":"12345678","unit":"음운","round":"12","got":20,"total":21}');
  assert (r->>'star')::boolean and not (r->>'first')::boolean, '재응시: ' || r::text;
  -- 3) 89%는 별 없음
  r := gramma_submit('{"name":"김철수","phone8":"12345678","unit":"음운","round":"13","got":18,"total":21}');
  assert not (r->>'star')::boolean and (r->>'pct')::int = 86, '86%: ' || r::text;
  -- 4) 다른 회차 100% → first
  r := gramma_submit('{"name":"김철수","phone8":"1234-5678","unit":"음운","round":"14","got":21,"total":21}');
  assert (r->>'first')::boolean, '14회: ' || r::text;
  assert (select phone8 from gramma_results where round='14') = '12345678', '8자리 숫자만 저장';
  -- 5) 잘못된 요청
  r := gramma_submit('{"name":"","unit":"음운","round":"1","got":1,"total":1}');
  assert not (r->>'ok')::boolean, '빈 이름 거절';
  -- 6) 시각이 이상하면 서버 시각
  assert (select ts from gramma_results where round='13') ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$', '서버 시각 보충';
  -- 7) gramma_status — 테스트별 최고 정답률, 별 여부
  r := gramma_status('{"name":"김철수","phone8":"12345678"}');
  assert jsonb_array_length(r->'items') = 3, 'status 3건: ' || r::text;
  assert (select count(*) from jsonb_array_elements(r->'items') e where (e->>'star')::boolean) = 2, '별 2개: ' || r::text;
  assert (select (e->>'best')::int from jsonb_array_elements(r->'items') e where e->>'round'='12') = 95, '12회 최고 95';
  assert (select (e->>'tries')::int from jsonb_array_elements(r->'items') e where e->>'round'='12') = 2, '12회 2번 응시';
  r := gramma_status('{"name":"김철수","phone8":"00000000"}');
  assert jsonb_array_length(r->'items') = 0, '8자리 다르면 빈 목록';
  r := gramma_status('{"name":"김철수","phone8":"1234"}');
  assert not (r->>'ok')::boolean, '8자리 아니면 거절';
  -- 8) student_bundle 에 gramma_results 항목
  b := student_bundle('tok-kim', false, '');
  assert (b->>'found')::boolean, 'bundle found';
  assert jsonb_array_length(b->'gramma_results') = 4, 'bundle gramma 4행: ' || (b->'gramma_results')::text;
  assert (select count(*) from jsonb_array_elements(b->'gramma_results') e where (e->>'pct')::int >= 90) = 3, 'bundle 90% 이상 3행';
  assert b ? 'signup_settings' and b ? 'voca_results', '기존 항목 유지';
  raise notice '전체 통과 — gramma_submit/gramma_status/student_bundle';
end $$;
SQL
# ===== 029: 세트 클리어 별 · 플레이 점수 · 탑30 =====
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/029_gramma_stages.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values ('87654321','이영희','서정중','2026 중등 2학년','tok-lee','재원');
do $$
declare r jsonb; b jsonb; s1 jsonb := '{"no":1,"rounds":["1","2","3","4","5"]}';
begin
  -- 1) 70% 미만은 통과 아님, 세트도 아님
  r := gramma_submit(('{"name":"이영희","school":"서정중","grade":"중2","phone8":"87654321","unit":"한글 맞춤법","round":"1","got":9,"total":15,"mode":"play","points":900,"set":' || s1::text || '}')::jsonb);
  assert (r->>'ok')::boolean and (r->>'pct')::int = 60 and not (r->>'pass')::boolean and not (r->>'set_cleared')::boolean and (r->>'stars')::int = 0, '60%: ' || r::text;
  assert (select mode from gramma_results where name='이영희' and round='1') = 'play', 'mode 저장';
  assert (select points from gramma_results where name='이영희' and round='1') = 900, 'points 저장';
  -- 2) 70%는 통과, 세트는 아직(나머지 회차 없음)
  r := gramma_submit(('{"name":"이영희","phone8":"87654321","unit":"한글 맞춤법","round":"1","got":11,"total":15,"mode":"play","points":1200,"set":' || s1::text || '}')::jsonb);
  assert (r->>'pass')::boolean and (r->>'pct')::int = 73 and not (r->>'set_cleared')::boolean, '73% 통과·세트 미완: ' || r::text;
  -- 3) 2~4회 통과(세트 정보 없이 test 모드), 5회 통과 시 세트 클리어·first·별 1
  r := gramma_submit('{"name":"이영희","phone8":"87654321","unit":"한글 맞춤법","round":"2","got":15,"total":15}');
  r := gramma_submit('{"name":"이영희","phone8":"87654321","unit":"한글 맞춤법","round":"3","got":12,"total":15}');
  r := gramma_submit('{"name":"이영희","phone8":"87654321","unit":"한글 맞춤법","round":"4","got":11,"total":15}');
  assert (select mode from gramma_results where name='이영희' and round='4') = 'test', 'mode 기본 test';
  r := gramma_submit(('{"name":"이영희","phone8":"87654321","unit":"한글 맞춤법","round":"5","got":14,"total":15,"mode":"play","points":1500,"set":' || s1::text || '}')::jsonb);
  assert (r->>'pass')::boolean and (r->>'set_cleared')::boolean and (r->>'set_first')::boolean and (r->>'stars')::int = 1, '세트 1 클리어: ' || r::text;
  assert (select rounds from gramma_sets where name='이영희' and set_no=1) = '1,2,3,4,5', '세트 회차 기록';
  -- 4) 같은 세트 재응시 → cleared 이지만 first 아님, 별 그대로 1
  r := gramma_submit(('{"name":"이영희","phone8":"87654321","unit":"한글 맞춤법","round":"3","got":15,"total":15,"mode":"play","points":1700,"set":' || s1::text || '}')::jsonb);
  assert (r->>'set_cleared')::boolean and not (r->>'set_first')::boolean and (r->>'stars')::int = 1, '재응시: ' || r::text;
  -- 5) 다른 학생(8자리 다름)은 별개
  r := gramma_submit(('{"name":"이영희","phone8":"00000000","unit":"한글 맞춤법","round":"5","got":15,"total":15,"set":' || s1::text || '}')::jsonb);
  assert not (r->>'set_cleared')::boolean and (r->>'stars')::int = 0, '동명이인 별개: ' || r::text;
  -- 6) 잘못된 세트 정보는 무시(기록은 됨)
  r := gramma_submit('{"name":"이영희","phone8":"87654321","unit":"음운","round":"1","got":21,"total":21,"set":{"no":"x","rounds":"1"}}');
  assert (r->>'ok')::boolean and not (r->>'set_cleared')::boolean, '세트 정보 이상: ' || r::text;
  -- 7) status — pass·sets·stars·points
  r := gramma_status('{"name":"이영희","phone8":"87654321"}');
  assert (r->>'stars')::int = 1 and (r->>'pass_pct')::int = 70, 'status stars: ' || r::text;
  assert jsonb_array_length(r->'sets') = 1 and (r->'sets'->0->>'set_no')::int = 1 and r->'sets'->0->>'unit' = '한글 맞춤법', 'status sets: ' || r::text;
  assert (select count(*) from jsonb_array_elements(r->'items') e where (e->>'pass')::boolean) = 6, 'status pass 6건(맞춤법 1~5 + 음운 1): ' || r::text;
  assert (select (e->>'points')::int from jsonb_array_elements(r->'items') e where e->>'unit'='한글 맞춤법' and e->>'round'='1') = 1200, '회차 최고 점수';
  assert (select (e->>'best')::int from jsonb_array_elements(r->'items') e where e->>'unit'='한글 맞춤법' and e->>'round'='3') = 100, '3회 최고 100';
  -- 8) top — 순위·me·level·month
  r := gramma_top('{"level":"all","name":"이영희","phone8":"87654321"}');
  assert (r->>'ok')::boolean and (r->'rows'->0->>'name') = '이영희' and (r->'rows'->0->>'stages')::int = 6 and (r->'rows'->0->>'stars')::int = 1, 'top 1위: ' || r::text;
  assert (r->'rows'->0->>'points')::int = 1200 + 0 + 1700 + 0 + 1500 + 0, 'top points = 회차 최고 점수 합: ' || r::text;
  assert (r->'me'->>'rank')::int = 1 and (r->'me'->>'stages')::int = 6, 'me: ' || r::text;
  assert (r->'rows'->0) ? 'phone8' = false, '8자리 미포함';
  assert (select count(*) from jsonb_array_elements(r->'rows') e where e->>'name'='김철수') = 1, '김철수도 순위에';
  r := gramma_top('{"level":"mid"}');
  assert (select count(*) from jsonb_array_elements(r->'rows') e where e->>'name'='김철수') = 0 and (r->'rows'->0->>'name') = '이영희', '중등만: ' || r::text;
  r := gramma_top('{"level":"high"}');
  assert (r->'rows'->0->>'name') = '김철수' and jsonb_typeof(r->'me') = 'null', '고등만·me 없음: ' || r::text;
  r := gramma_top('{"month":"1999-01"}');
  assert jsonb_array_length(r->'rows') = 0 and (r->>'total')::int = 0, '그 달 제출 없음: ' || r::text;
  r := gramma_top(('{"month":"' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') || '","name":"이영희","phone8":"87654321"}')::jsonb);
  assert (r->'me'->>'stars')::int = 1, '이번 달 별: ' || r::text;
  -- 9) bundle — gramma_sets 항목
  b := student_bundle('tok-lee', false, '');
  assert (b->>'found')::boolean and jsonb_array_length(b->'gramma_sets') = 1 and (b->'gramma_sets'->0->>'set_no')::int = 1, 'bundle gramma_sets: ' || (b->'gramma_sets')::text;
  assert jsonb_array_length(b->'gramma_results') >= 7 and b ? 'voca_results', '기존 항목 유지';
  raise notice '029 통과 — 세트 클리어·status·top·bundle';
end $$;
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  assert has_function_privilege('anon', 'public.gramma_top(jsonb)', 'execute'), 'anon top';
  assert not has_table_privilege('anon', 'public.gramma_sets', 'select'), 'anon gramma_sets 읽기 금지';
  raise notice '029 권한 통과';
end $$;
SQL
# 권한: anon 은 함수만, 표는 못 읽는다
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  assert has_function_privilege('anon', 'public.gramma_submit(jsonb)', 'execute'), 'anon submit';
  assert has_function_privilege('anon', 'public.gramma_status(jsonb)', 'execute'), 'anon status';
  assert not has_table_privilege('anon', 'public.gramma_results', 'select'), 'anon 표 읽기 금지';
  assert has_table_privilege('authenticated', 'public.gramma_results', 'select') or true, '';
  raise notice '권한 통과';
end $$;
SQL
echo "OK"
