#!/usr/bin/env bash
# 27 예상 반 신청(053) 검증 — 로컬 PostgreSQL.
# 학생이 나 반을 고르고·바꾸고·취소하고, 가 반을 옮길 때 정원·같은 날 시간 겹침·신청 닫힘·계획 밖 학생을 막는지,
# 바꾼 기록이 남는지, 공개 키는 표를 직접 못 읽는지 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/plan-signup-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=plansignup_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31,52,53}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/053_plan_signup.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values
  ('11110001','박보검','화정중','2026 중등 3학년','tok-park','재원'),
  ('11110002','양지우','화정중','2026 중등 3학년','tok-yang','재원'),
  ('11110003','김하늘','서정중','2026 중등 3학년','tok-kim','재원'),
  ('11110004','이바다','화정중','2026 중등 3학년','tok-lee','재원');
insert into tt_plan_students (plan, student, school, ga, na) values
  ('2027','박보검','화정중','토11:00-승연',''),
  ('2027','양지우A','화정중','토11:00-승연',''),
  ('2027','김하늘','화정중','토1:30-지원','');      -- 학교가 달라 서정중 김하늘과는 다른 학생
insert into tt_plan_students (plan, student, school, ga, na, excluded) values ('2027','이바다','화정중','',' ',true);
insert into tt_plan_students (plan, student, school, ga, na) select '2027', '채움' || g, '', '', '토1:30-승연' from generate_series(1,2) g;
insert into tt_plan_config (plan, open, cap, classes) values ('2027', false, 3, '[
  {"id":"토11:00-승연","day":"토","start":"11:00","end":"1:00","m":660,"teacher":"승연","tname":"이승연T","part":"가"},
  {"id":"토1:30-지원","day":"토","start":"1:30","end":"3:30","m":810,"teacher":"지원","tname":"김지원T","part":"가"},
  {"id":"토11:00-지원","day":"토","start":"11:00","end":"1:00","m":660,"teacher":"지원","tname":"김지원T","part":"나"},
  {"id":"토1:30-승연","day":"토","start":"1:30","end":"3:30","m":810,"teacher":"승연","tname":"이승연T","part":"나"},
  {"id":"일11:00-승연","day":"일","start":"11:00","end":"1:00","m":660,"teacher":"승연","tname":"이승연T","part":"나"}]');
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
set role anon;
do $$
declare r jsonb; c jsonb;
begin
  r := plan_view('{"key":"tok-park"}');
  assert (r->>'ok')::bool and (r->>'eligible')::bool, '계획에 있는 학생: ' || r::text;
  assert not (r->>'open')::bool, '처음엔 닫힘';
  assert r->>'ga' = '토11:00-승연' and r->>'na' = '', '내 배치: ' || r::text;
  select x into c from jsonb_array_elements(r->'classes') x where x->>'id' = '토11:00-승연';
  assert (c->>'cnt')::int = 2, '가 반 인원 2(박보검·양지우A): ' || c::text;
  select x into c from jsonb_array_elements(r->'classes') x where x->>'id' = '토1:30-승연';
  assert (c->>'cnt')::int = 2, '나 반 인원 2: ' || c::text;
  r := plan_pick('{"key":"tok-park","part":"나","cls":"일11:00-승연"}');
  assert r->>'error' = 'closed', '닫혀 있으면 거절: ' || r::text;
  r := plan_view('{"key":"tok-yang"}');
  assert (r->>'eligible')::bool and r->>'name' = '양지우A', '끝 A 붙여 찾기: ' || r::text;
  r := plan_view('{"key":"tok-kim"}');
  assert not (r->>'eligible')::bool, '학교가 다른 동명이인은 안 잡힘: ' || r::text;
  r := plan_view('{"key":"tok-lee"}');
  assert not (r->>'eligible')::bool, '계획에서 뺀 학생: ' || r::text;
  r := plan_view('{"key":"nobody"}');
  assert r->>'error' = 'no_student', '없는 학생';
end $$;
reset role;
update tt_plan_config set open = true where plan = '2027';
set role anon;
do $$
declare r jsonb; c jsonb;
begin
  r := plan_pick('{"key":"tok-park","part":"나","cls":"토11:00-지원"}');
  assert r->>'error' = 'clash', '가와 같은 날·같은 시간 나는 겹침: ' || r::text;
  r := plan_pick('{"key":"tok-park","part":"나","cls":"토1:30-승연"}');
  assert (r->>'ok')::bool and r->>'na' = '토1:30-승연', '나 고르기(정원 3 중 3번째): ' || r::text;
  r := plan_pick('{"key":"tok-yang","part":"나","cls":"토1:30-승연"}');
  assert r->>'error' = 'full', '꽉 찬 반은 거절: ' || r::text;
  r := plan_pick('{"key":"tok-park","part":"나","cls":"토1:30-승연"}');
  assert (r->>'ok')::bool, '이미 내 반이면 꽉 차도 그대로 통과';
  r := plan_pick('{"key":"tok-park","part":"가","cls":"토1:30-지원"}');
  assert r->>'error' = 'clash', '가를 나와 같은 시간으로 옮기면 겹침: ' || r::text;
  r := plan_pick('{"key":"tok-park","part":"나","cls":"일11:00-승연"}');
  assert (r->>'ok')::bool and r->>'na' = '일11:00-승연', '나 바꾸기: ' || r::text;
  r := plan_pick('{"key":"tok-park","part":"가","cls":"토1:30-지원"}');
  assert (r->>'ok')::bool and r->>'ga' = '토1:30-지원', '가 옮기기: ' || r::text;
  select x into c from jsonb_array_elements(r->'classes') x where x->>'id' = '토11:00-승연';
  assert (c->>'cnt')::int = 1, '옮긴 뒤 원래 가 반 인원 1: ' || c::text;
  r := plan_pick('{"key":"tok-park","part":"가","cls":""}');
  assert r->>'error' = 'ga_required', '가는 비울 수 없음';
  r := plan_pick('{"key":"tok-park","part":"가","cls":"일11:00-승연"}');
  assert r->>'error' = 'bad_class', '나 반을 가로 고르면 거절';
  r := plan_pick('{"key":"tok-park","part":"나","cls":"없는반"}');
  assert r->>'error' = 'bad_class', '없는 반';
  r := plan_pick('{"key":"tok-park","part":"다","cls":""}');
  assert r->>'error' = 'bad_part', '가·나 아닌 구분';
  r := plan_pick('{"key":"tok-park","part":"나","cls":""}');
  assert (r->>'ok')::bool and r->>'na' = '', '나 취소: ' || r::text;
  r := plan_pick('{"student":"11110002","part":"나","cls":"일11:00-승연"}');
  assert (r->>'ok')::bool and r->>'na' = '일11:00-승연', '학생ID로도: ' || r::text;
  r := plan_pick('{"key":"tok-lee","part":"나","cls":"일11:00-승연"}');
  assert r->>'error' = 'not_in_plan', '계획에서 뺀 학생은 신청 불가';
end $$;
reset role;
do $$ begin
  assert (select na from tt_plan_students where student = '양지우A') = '일11:00-승연', '저장값';
  assert (select author from tt_plan_students where student = '박보검') = '학생 신청', '작성자';
  assert (select count(*) from tt_plan_log where student = '박보검') = 4, '바꾼 기록 4줄(나 고르기·바꾸기·가 옮기기·나 취소): ' || (select count(*) from tt_plan_log where student = '박보검');
  assert (select count(*) from tt_plan_log where student = '박보검' and from_cls = to_cls) = 0, '그대로 통과는 기록 안 함';
end $$;
set role anon;
do $$ begin
  begin perform 1 from tt_plan_config; assert false, 'anon 설정 표 읽기 막힘'; exception when insufficient_privilege then null; end;
  begin perform 1 from tt_plan_log; assert false, 'anon 기록 표 읽기 막힘'; exception when insufficient_privilege then null; end;
  begin perform plan_row_('2027','박보검',''); assert false, 'anon 내부 함수 막힘'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from tt_plan_log;
  update tt_plan_config set open = false where plan = '2027';
  begin insert into tt_plan_log(plan, student, part) values ('2027','x','나'); assert false, '교사는 기록 쓰기 막힘'; exception when insufficient_privilege then null; end;
end $$;
SQL
echo "plan-signup-sql-test: 모두 통과"
