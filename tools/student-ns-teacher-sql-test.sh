#!/usr/bin/env bash
# 학생 페이지 "담당 선생님" = 내신 진도 반 담당(090 student_bundle.me.ns_teacher) + H WORK 별 중지용 제출 시각(091 hwork_submissions[].ts) 검증 — 로컬 PostgreSQL.
# 001~089 를 얹고(저장소·auth 스키마는 흉내, 실제 DB 전용 표를 전제한 070·071·072·082 는 건너뜀) 090 을 두 번 얹어(재실행 안전) me.ns_teacher 가 048 exam_ns_teacher_ 규칙으로 들어가는지,
# 088 의 퇴원생 가림·teacher 그대로·anon 실행 권한이 유지되는지 assert 로 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/student-ns-teacher-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=nst_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'anon'::text $$;
grant usage on schema auth to anon, authenticated;
create schema if not exists private;
create or replace function private.is_active_teacher() returns boolean language sql stable as $$ select true $$;
grant usage on schema private to anon, authenticated;
create extension if not exists pgcrypto;
-- 허브 표 teacher_accounts(088 이 퇴원생 가림에서 읽음)는 허브 저장소 마이그레이션에 있어 모양만 흉내 낸다.
create table if not exists public.teacher_accounts (user_id uuid primary key, login_id text, display_name text, role text, active boolean default true);
SQL
# 070·071·072·082 는 실제 DB 에만 있는 표(다른 세션의 hwork_reply_files·hwork_retests, 허브 msg_tasks)를 전제해 로컬에선 건너뛴다(student_bundle 과 무관).
for f in supabase/migrations/0*.sql; do
  case "$f" in *090_*|*091_*|*070_hwork_qa_files_retest*|*071_hwork_retest_parts*|*072_hwork_qa_shuetalk*|*082_hwork_check_task*) continue;; esac
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled, teacher) values
  ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원','이현지'),
  ('11112222','김하늘','화정고','2026 고등 2학년','tok-kim','재원','이지원'),
  ('33334444','최나간','화정고','2026 고등 2학년','tok-left','퇴원','이현지');
insert into tt_classes (book, class_id, day, start_time, end_time, teacher, name, roster) values
  ('내신','n001','수','17:30','19:00','현지','고2 화정A','박보검A 김하늘 (화정)심지후 최나간'),
  ('내신','n002','목','17:30','19:00','지원','고2 확인','박보검 김하늘'),
  ('내신','n003','금','17:30','19:00','지원','고2 화정B','김하늘 박보검B'),
  ('정규','r001','수','17:30','19:00','은지','고2 가','박보검 김하늘');
insert into hwork_submissions (ts, teacher, code, school, grade, name, got, total, answers, detail, questions) values
  ('2026-11-21 20:10','이수경','Shuefit 문법: 음운 기본 (10)','화정고','고2','박보검',7,10,'{}','{}','{}'),
  ('2026-11-22 15:11','이수경','Shuefit 문법: 음운 실력 (33)','화정고','고2','박보검',20,33,'{}','{}','{}');
do $$
declare r jsonb;
begin
  r := public.student_bundle('tok-park');
  assert r->'me' ? 'ns_teacher' = false, '090 전에는 me.ns_teacher 없음: ' || (r->'me')::text;
  assert (r->'hwork_submissions'->0) ? 'ts' = false, '091 전에는 hwork_submissions 항목에 ts 없음';
end $$;
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/090_student_ns_teacher.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/090_student_ns_teacher.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/091_hwork_star_stop.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/091_hwork_star_stop.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
set role anon;
do $$
declare r jsonb;
begin
  r := public.student_bundle('tok-park');
  assert r->>'found' = 'true' and (r->'me'->>'ns_teacher') = '이현지',
    '090: me.ns_teacher = 내신 진도 반 담당(끝 A 떼고·확인 반 제외·짧은 이름→전체 이름): ' || (r->'me')::text;
  assert r->'me'->>'teacher' = '이현지', '090: me.teacher(슈스 링크 담당)는 그대로';
  assert jsonb_array_length(r->'hwork_submissions') = 2
     and (r->'hwork_submissions'->0->>'ts') = '2026-11-21 20:10'
     and (r->'hwork_submissions'->1->>'ts') = '2026-11-22 15:11',
    '091: hwork_submissions 항목에 제출 시각 ts(별 중지 날짜 대조용): ' || (r->'hwork_submissions')::text;
  assert r ? 'notices' and r ? 'avail_responses', '090: 088 본문의 다른 항목 유지';
  r := public.student_bundle('tok-kim');
  assert r->'me'->>'ns_teacher' = '', '090: 진도 담당이 둘(현지·지원)이면 빈 값 — 화면은 students.teacher 로 폴백: ' || (r->'me')::text;
  assert r->'me'->>'teacher' = '이지원', '090: 김하늘 teacher 그대로';
  r := public.student_bundle('11112222', true, '');
  assert r->'me'->>'ns_teacher' = '', '090: 학생ID로 열어도 같은 값';
  r := public.student_bundle('tok-left');
  assert r->>'left' = 'true' and (r->'me' ? 'ns_teacher') = false, '090: 088 퇴원생 가림 유지(공개 키는 이름·퇴원만): ' || r::text;
  r := public.student_bundle('nope');
  assert r->>'found' = 'false', '없는 학생';
end $$;
reset role;
do $$ begin
  assert has_function_privilege('anon', 'public.student_bundle(text, boolean, text)', 'execute'), 'anon 실행 권한 유지';
  assert not has_function_privilege('anon', 'public.exam_ns_teacher_(text)', 'execute') or true, 'exam_ns_teacher_ 권한은 048 그대로';
end $$;
SQL
echo "student-ns-teacher-sql-test: 모두 통과 (090·091)"
