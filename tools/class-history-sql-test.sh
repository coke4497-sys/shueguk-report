#!/usr/bin/env bash
# 수업 리포트(039·040) 검증 — 로컬 PostgreSQL.
# 001·002·003·034 뒤 035의 열만 흉내 내고 039·040을 두 번씩 얹어(재실행 안전) class_history 가
# 클로슈가 쓴 수업별 리포트(class_reports, 040)만 · 공개된 것만 · 내 것만 · 날짜 내림차순 · before 로 이어 받기 ·
# 권한(공개 키는 함수만)을 지키는지 assert 로 확인한다. 주간 리포트 함수(class_report_list)는 지워져야 한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/class-history-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=chist_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03}_*.sql supabase/migrations/034_class_reports.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
alter table hwcheck_records add column if not exists class_id text not null default '';
alter table hwcheck_records add column if not exists part text not null default '';
alter table hwcheck_records add column if not exists class_name text not null default '';
SQL
for f in supabase/migrations/039_class_history.sql supabase/migrations/040_class_reports_per_session.sql \
         supabase/migrations/039_class_history.sql supabase/migrations/040_class_reports_per_session.sql \
         supabase/migrations/042_class_reports_guard.sql supabase/migrations/042_class_reports_guard.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  assert to_regprocedure('public.class_report_list(jsonb)') is null, '주간 리포트 함수는 지워진다';
  assert exists(select 1 from information_schema.columns where table_name='hwcheck_records' and column_name='missing_items'), 'missing_items 열';
end $$;
insert into students (student_id, name, school, grade, code, enrolled) values
  ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원'),
  ('87654321','김하늘','화정고','2026 고등 2학년','tok-kim','재원'),
  ('11112222','코드없음','화정고','2026 고등 2학년','','재원');
insert into class_reports (week, book, code, student_id, name, class_id, ymd, part, class_name, teacher, class_time, body, published) values
  ('2026-09-30','정규','tok-park','12345678','박보검','r010','2026-09-30','가','고2 가','은지','수 5:30~7:00',
   '{"attend":"출석","attitude":"매우 좋음","summary":"「사미인곡」의 표현상 특징을 정리했습니다.","units":[],"homework":["비교 학습지 1장"],
     "hw":{"items":[{"name":"학습지 (학습량)","score":5,"max":5}],"pct":100,"missing":false,"missing_items":[],"text":"모두 해 왔습니다."},"comment":"집중이 좋았습니다."}', true),
  ('2026-09-23','정규','tok-park','12345678','박보검','r011','2026-09-28','나','고2 나','현지','월 5:30~7:00','{"attend":"결석"}', true),
  ('2026-09-23','정규','tok-park','12345678','박보검','r012','2026-09-27','','고2 단일','은지','일 5:30~7:00','{"attend":"출석"}', false),
  ('2026-09-23','내신','tok-park','12345678','박보검','n050','2026-09-26','확인','고2 확인','지원','토 2:00~4:00','{"attend":"지각"}', true),
  ('2026-09-30','정규','tok-kim','87654321','김하늘','r010','2026-09-30','가','고2 가','은지','수 5:30~7:00','{"attend":"지각"}', true);
-- 같은 수업·같은 학생은 한 줄
do $$ begin
  begin
    insert into class_reports (week, book, code, class_id, ymd) values ('2026-09-30','정규','tok-park','r010','2026-09-30');
    raise exception 'dup session allowed';
  exception when unique_violation then null; end;
end $$;
-- 주차가 같아도 다른 수업이면 따로 들어간다(옛 (week, code) 유일 조건이 없어졌는지)
insert into class_reports (week, book, code, class_id, ymd, part, body, published) values ('2026-09-30','정규','tok-park','r013','2026-10-01','나','{}', false);
do $$
declare r jsonb; it jsonb;
begin
  r := class_history('{"key":"tok-park"}');
  assert (r->>'ok')::boolean, 'ok: ' || r::text;
  assert jsonb_array_length(r->'items') = 3, '공개된 내 수업 3개(비공개 2개 제외): ' || r::text;
  assert r->'items'->0->>'ymd' = '2026-09-30' and r->'items'->1->>'ymd' = '2026-09-28' and r->'items'->2->>'ymd' = '2026-09-26', '날짜 내림차순';
  it := r->'items'->0;
  assert it->>'part' = '가' and it->>'cls' = '고2 가' and it->>'teacher' = '은지' and it->>'time' = '수 5:30~7:00', '수업 정보: ' || it::text;
  assert it->'body'->>'summary' like '「사미인곡」%' and it->'body'->>'attitude' = '매우 좋음' and (it->'body'->'hw'->>'pct')::int = 100, '클로슈가 쓴 본문 그대로';
  r := class_history('{"key":"tok-park","before":"2026-09-30"}');
  assert jsonb_array_length(r->'items') = 2 and r->'items'->0->>'ymd' = '2026-09-28', 'before 로 이어 받기';
  r := class_history('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->'body'->>'attend' = '지각', '다른 학생은 자기 것만';
  r := class_history('{"student":"12345678"}');
  assert jsonb_array_length(r->'items') = 3, '학생ID로도';
  assert (class_history('{"key":"nope"}'))->>'error' = 'no_student', '없는 키';
  assert (class_history('{"student":"11112222"}'))->>'error' = 'no_student', '접근코드 없는 학생';
  assert (class_history('{}'))->>'error' = 'no_student', '빈 요청';
end $$;
-- 60개씩: 70개 넣으면 첫 쪽 60 + more
insert into class_reports (week, book, code, class_id, ymd, body, published)
  select '2026-01-07','정규','tok-kim','x' || g, date '2026-01-01' + g, '{}', true from generate_series(1,70) g;
do $$
declare r jsonb;
begin
  r := class_history('{"key":"tok-kim"}');
  assert jsonb_array_length(r->'items') = 60 and (r->>'more')::boolean, '60개 + more: ' || jsonb_array_length(r->'items');
  r := class_history(jsonb_build_object('key','tok-kim','before', r->'items'->59->>'ymd'));
  assert jsonb_array_length(r->'items') = 11 and not (r->>'more')::boolean, '나머지 11개';
end $$;
set role anon;
do $$
declare r jsonb;
begin
  r := class_history('{"key":"tok-park"}');
  assert jsonb_array_length(r->'items') = 3, 'anon 함수 호출';
  begin perform 1 from class_reports limit 1; raise exception 'anon read class_reports'; exception when insufficient_privilege then null; end;
  begin perform 1 from class_notes limit 1; raise exception 'anon read class_notes'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- 042: 옛 주간 형식(반ID 빈 값·날짜 없음·body.parts)은 저장 거절
do $$ begin
  begin insert into class_reports (week, book, code, body, published) values ('2026-09-30','내신','tok-kim','{"parts":[]}', true);
        raise exception '반ID 없는 줄이 저장됨'; exception when check_violation then null; end;
  begin insert into class_reports (week, book, code, class_id, body, published) values ('2026-09-30','내신','tok-kim','n015','{}', true);
        raise exception '날짜 없는 줄이 저장됨'; exception when check_violation then null; end;
  begin insert into class_reports (week, book, code, class_id, ymd, body, published) values ('2026-09-30','내신','tok-kim','n015','2026-10-01','{"parts":[],"comments":[]}', true);
        raise exception 'parts 줄이 저장됨'; exception when check_violation then null; end;
  insert into class_reports (week, book, code, class_id, ymd, body, published) values ('2026-09-30','내신','tok-kim','n015','2026-10-01','{"attend":"출석"}', true);
end $$;
SQL
echo "class-history-sql-test: 모두 통과"
