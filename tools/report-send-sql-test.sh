#!/usr/bin/env bash
# 지필고사 리포트 보내기(043) 검증 — 로컬 PostgreSQL.
# 001~035 위에 '한 마디 있는 제출 / 없는 제출'을 넣고 043을 두 번 얹어(재실행 안전) — 채우기는 한 번만, 보내기 취소가
# 다시 실행에 되살아나지 않는지, student_bundle 이 sent_at 을 보내고 보내기 전 teacher_note 를 숨기는지 확인한다.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/report-send-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=rsend_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31,35}_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values ('12345678','박보검','화정고','2026 고등 2학년','tok-park','재원');
insert into submissions (submitted_at, exam, school, grade, name, wrong_count, wrong_text, vow, teacher_note, score, parent_phone) values
  ('2026-09-23 10:00+09','26-2-중간-화정고2-문학','화정고','2학년','박보검',2,'','','잘했어요',90,'12345678'),
  ('2026-09-24 10:00+09','26-2-중간-화정고2-독서','화정고','2학년','박보검',3,'','','',80,'12345678');
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/043_report_send.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$
declare r jsonb; s jsonb;
begin
  assert (select sent_at is not null from submissions where exam like '%문학'), '한 마디 있던 제출은 보낸 것으로';
  assert (select sent_at is null from submissions where exam like '%독서'), '한 마디 없던 제출은 숨김';
  -- 선생님이 독서에 한 마디만 적고 아직 안 보냄 · 문학은 보내기 취소
  update submissions set teacher_note = '아직 비공개' where exam like '%독서';
  update submissions set sent_at = null where exam like '%문학';
end $$;
SQL
# 다시 실행해도 취소한 것을 되살리지 않는다
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/043_report_send.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$
declare r jsonb; s jsonb;
begin
  assert (select count(*) from submissions where sent_at is not null) = 0, '다시 실행해도 채우기 없음';
  update submissions set sent_at = now() where exam like '%독서';
end $$;
set role anon;
do $$
declare r jsonb; s jsonb;
begin
  r := student_bundle('tok-park');
  for s in select * from jsonb_array_elements(r->'submissions') loop
    if s->>'exam' like '%독서' then
      assert s->>'sent_at' is not null and s->>'teacher_note' = '아직 비공개', '보낸 제출: 한 마디·sent_at: ' || s::text;
    else
      assert s->'sent_at' = 'null'::jsonb and s->>'teacher_note' = '', '안 보낸 제출: 한 마디 숨김: ' || s::text;
    end if;
  end loop;
  assert jsonb_array_length(r->'submissions') = 2, '제출은 둘 다 온다(별 집계용)';
end $$;
reset role;
SQL
echo "report-send-sql-test: 모두 통과"
