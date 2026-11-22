#!/usr/bin/env bash
# 지필 복기 고치기(051) 검증 — 로컬 PostgreSQL.
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/submission-edit-sql-test.sh   (원격에는 절대 돌리지 말 것)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=subedit_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
SQL
for f in supabase/migrations/0{01,02,03,04,05,06,07,08,09,10,11,12,27,28,29,31,35}_*.sql supabase/migrations/043_*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
insert into submissions (submitted_at, exam, school, grade, name, wrong_count, wrong_text, vow, teacher_note, score, parent_phone, sent_at) values
  ('2026-10-10 10:00+09','26-2-중간-화정고2-문학','화정고','2학년','박보검A','1','[3번 · 문학 · 상] 옛 글\n  → 옛 반성','옛 다짐','비밀 한 마디','96','12345678', null),
  ('2026-10-11 10:00+09','26-2-중간-화정고2-독서','화정고','2학년','박보검','0','','','보낸 한 마디','100','12345678', now()),
  ('2026-10-11 11:00+09','26-2-중간-화정고2-문학','화정고','2학년','김다른','0','','','','100','87654321', null);
SQL
# 두 번 얹어도 안전
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/051_submission_edit.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/051_submission_edit.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
set role anon;
do $$
declare r jsonb; v_id bigint;
begin
  -- 이름 끝 알파벳은 떼고 대조, 시험은 제목으로
  r := submission_mine('{"title":"26-2-중간-화정고2-문학","exam_id":"x1","name":"박보검","phone":"12345678"}');
  assert (r->>'found')::boolean and r->>'vow' = '옛 다짐' and not (r->>'sent')::boolean, '내 제출 찾기: ' || r::text;
  assert not (r ? 'teacher_note'), '한 마디는 돌려주지 않음';
  v_id := (r->>'id')::bigint;
  r := submission_mine('{"title":"26-2-중간-화정고2-문학","name":"박보검","phone":"11112222"}');
  assert not (r->>'found')::boolean, '번호가 다르면 못 찾음';
  r := submission_mine('{"title":"","name":"박보검","phone":"12345678"}');
  assert not (r->>'found')::boolean, '시험이 비면 못 찾음';
  r := submission_mine('{"title":"26-2-중간-화정고2-독서","name":"박보검","phone":"12345678"}');
  assert (r->>'found')::boolean and (r->>'sent')::boolean, '보낸 제출은 sent: ' || r::text;
  -- 고치기
  r := submission_update(jsonb_build_object('id', v_id, 'name','박보검A','phone','12345678',
        'wrong_count','2','wrong_text','[3번 · 문학 · 상] 새 글\n  → 새 반성','vow','새 다짐','score','92'));
  assert (r->>'ok')::boolean, '고치기 성공: ' || r::text;
  r := submission_update(jsonb_build_object('id', v_id, 'name','박보검','phone','99999999','vow','남이 고침'));
  assert r->>'reason' = 'not_found', '번호가 다르면 거절';
  r := submission_update(jsonb_build_object('id', (select 0), 'name','박보검','phone','12345678'));
  assert r->>'reason' = 'not_found', '없는 id 거절';
end $$;
reset role;
do $$
declare v_sent bigint;
begin
  assert (select vow = '새 다짐' and score = '92' and wrong_count = '2' and edited_by = '학생' and edited_at is not null
            and teacher_note = '비밀 한 마디' and submitted_at = '2026-10-10 10:00+09'
          from submissions where name = '박보검A'), '고친 값·처음 제출 시각·한 마디 유지';
  select id into v_sent from submissions where exam like '%독서';
  set role anon;
  assert (submission_update(jsonb_build_object('id', v_sent, 'name','박보검','phone','12345678','vow','늦은 수정'))->>'reason') = 'sent',
    '보낸 뒤에는 거절';
  reset role;
  assert (select vow = '' from submissions where id = v_sent), '보낸 제출은 그대로';
end $$;
-- 공개 키는 표를 직접 못 고친다
set role anon;
do $$ begin
  begin update submissions set vow = 'x'; raise exception 'anon 직접 수정 허용됨';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
SQL
echo "submission-edit-sql-test: 모두 통과"
