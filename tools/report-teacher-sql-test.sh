#!/usr/bin/env bash
# 지필고사 리포트 담당 선생님 이름(048) + 학생 페이지 담당 선생님(049) 검증 — 로컬 PostgreSQL.
# 043 위에 048을 두 번 얹어(재실행 안전) teacher_name 열이 생기고, student_bundle 이 보낸 제출에만 이름을 내보내는지,
# [보내기 취소]하면 이름도 감추는지 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/report-teacher-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=rteacher_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31,35,43}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled, teacher) values ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원','이현지');
insert into students (student_id, name, school, grade, code, enrolled, teacher) values ('11112222','김하늘','화정고','2026 고등 2학년','tok-kim','재원','이지원');
insert into tt_classes (book, class_id, day, start_time, end_time, teacher, name, roster) values
  ('내신','n001','수','17:30','19:00','현지','고2 화정A','박보검A 김하늘 (화정)심지후'),
  ('내신','n002','목','17:30','19:00','지원','고2 확인','박보검 김하늘'),
  ('내신','n003','금','17:30','19:00','지원','고2 화정B','김하늘 박보검B'),
  ('정규','r001','수','17:30','19:00','은지','고2 가','박보검 김하늘');
insert into submissions (submitted_at, exam, school, grade, name, wrong_count, wrong_text, vow, teacher_note, score, parent_phone, sent_at) values
  ('2026-09-23 10:00+09','26-2-중간-화정고2-문학','화정고','2학년','박보검',2,'','','잘했어요',90,'12345678','2026-10-02 14:30+09'),
  ('2026-09-24 10:00+09','26-2-중간-화정고2-독서','화정고','2학년','박보검',3,'','','아직 비공개',80,'12345678',null);
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/048_report_teacher.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/048_report_teacher.sql >/dev/null   # 재실행 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  assert (select count(*) from information_schema.columns where table_name='submissions' and column_name='teacher_name') = 1, 'teacher_name 열';
  assert exam_ns_teacher_('박보검') = '이현지', '진도 담당: 끝 A 떼고 대조·확인 반 제외·짧은 이름→전체 이름: ' || exam_ns_teacher_('박보검');
  assert exam_ns_teacher_('김하늘') = '', '진도 담당이 둘(현지·지원)이면 빈 값: ' || exam_ns_teacher_('김하늘');
  assert exam_ns_teacher_('없는학생') = '', '명단에 없으면 빈 값';
  assert exam_ns_teacher_('박보검B') = '이지원', 'B는 다른 학생 — 그 반 담당만: ' || exam_ns_teacher_('박보검B');
end $$;
set role anon;
do $$
declare r jsonb; s jsonb;
begin
  r := student_bundle('tok-park');
  for s in select * from jsonb_array_elements(r->'submissions') loop
    if s->>'exam' like '%문학' then
      assert s->>'teacher_name' = '이현지', '이름 없이 보낸 제출: 내신 진도 담당 선생님으로: ' || s::text;
    end if;
  end loop;
end $$;
reset role;
do $$ begin
  update submissions set teacher_name = '김현지' where exam like '%문학';
  update submissions set teacher_name = '김지원' where exam like '%독서';
end $$;
set role anon;
do $$
declare r jsonb; s jsonb;
begin
  r := student_bundle('tok-park');
  for s in select * from jsonb_array_elements(r->'submissions') loop
    if s->>'exam' like '%문학' then
      assert s->>'teacher_name' = '김현지' and s->>'teacher_note' = '잘했어요', '보낸 제출: 이름 포함: ' || s::text;
    else
      assert s->>'teacher_name' = '' and s->>'teacher_note' = '', '안 보낸 제출: 이름·한 마디 숨김: ' || s::text;
    end if;
  end loop;
end $$;
reset role;
update submissions set sent_at = null where exam like '%문학';   -- 보내기 취소
set role anon;
do $$
declare r jsonb;
begin
  r := student_bundle('tok-park');
  assert (select bool_and(s->>'teacher_name' = '') from jsonb_array_elements(r->'submissions') s), '취소하면 이름도 감춘다';
  assert r->'me'->>'ns_teacher' is null, '049 전에는 me.ns_teacher 없음';
end $$;
reset role;
SQL
# 049 — 학생 페이지 '담당 선생님' = 내신 진도 반 담당(me.ns_teacher). 두 번 얹어 재실행 안전.
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/049_student_ns_teacher.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/049_student_ns_teacher.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
set role anon;
do $$
declare r jsonb;
begin
  r := student_bundle('tok-park');
  assert r->'me'->>'ns_teacher' = '이현지', '049: me.ns_teacher = 내신 진도 반 담당(끝 A 떼고·확인 반 제외·전체 이름): ' || (r->'me')::text;
  assert r->'me'->>'teacher' = '이현지', '049: me.teacher(슈스 링크 담당)는 그대로';
  r := student_bundle('tok-kim');
  assert r->'me'->>'ns_teacher' = '', '049: 진도 담당이 둘이면 빈 값(화면은 students.teacher 로 폴백): ' || (r->'me')::text;
  assert r->'me'->>'teacher' = '이지원', '049: 김하늘 teacher 그대로';
  assert (select bool_and(s->>'teacher_name' = '') from jsonb_array_elements(student_bundle('tok-park')->'submissions') s), '049: 048 규칙(취소하면 이름 감춤) 유지';
end $$;
reset role;
SQL
echo "report-teacher-sql-test: 모두 통과 (048·049)"
