#!/usr/bin/env bash
# 질문 대기열(024_question_queue.sql) 왕복 검증 — 로컬 PostgreSQL에 마이그레이션을 적용하고
# 학생 함수(qq_submit/qq_mine/qq_cancel/qq_teachers)와 교사 쪽 갱신(호출·완료·맨 뒤로)을
# 실제로 돌려 순번·중복·권한 규칙을 assert 로 확인한다.
#
# 사용:  PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/qq-sql-test.sh
# (수파베이스 원격에는 절대 돌리지 말 것 — 표를 만들고 지운다.)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=qq_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres' EXIT

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
-- 수파베이스에 있는 역할·표 흉내
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create table students (
  id bigint generated always as identity primary key,
  student_id text not null default '', name text not null default '', school text not null default '',
  grade text not null default '', teacher text not null default '', enrolled text not null default ''
);
insert into students (student_id,name,school,grade,teacher,enrolled) values
 ('12345678','김철수','화정고','2026 고등 1학년','이수경','재원'),
 ('23456789','이영희','능곡고','2026 고등 2학년','김지원','재원'),
 ('34567890','박민수','서정중','2026 중등 3학년','이수경','재원'),
 ('45678901','퇴원생','화정고','2026 고등 1학년','박선주','아웃'),
 ('56789012','최유진','화수고','2026 고등 3학년','이수경',''),
 ('67890123','노담당','화수고','2026 고등 3학년','','재원');
SQL

psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/024_question_queue.sql

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
\set ON_ERROR_STOP on
do $$
declare r jsonb; a jsonb; b jsonb; c jsonb; l jsonb; n int; ida bigint; idb bigint; idc bigint; t jsonb;
begin
  -- 선생님 목록: 재원('' 포함) 담당T만, 학생 수 많은 순 → 이수경(3) 김지원(1). 박선주(아웃만)·빈값 제외
  t := qq_teachers();
  assert t = '["이수경","김지원"]'::jsonb, '선생님 목록: ' || t::text;

  -- 명단에 없는 학생은 거절
  r := qq_submit('{"name":"아무개","student_id":"00000000","teacher":"이수경","text":"q"}');
  assert r->>'error' = 'unknown_student', 'unknown_student: ' || r::text;
  -- 학생ID가 틀리면 거절
  r := qq_submit('{"name":"김철수","student_id":"99999999","teacher":"이수경","text":"q"}');
  assert r->>'error' = 'unknown_student', 'wrong sid: ' || r::text;
  -- 선생님 없음 / 내용 없음 / 사진 형식
  r := qq_submit('{"name":"김철수","student_id":"12345678","teacher":"","text":"q"}');
  assert r->>'error' = 'no_teacher', r::text;
  r := qq_submit('{"name":"김철수","student_id":"12345678","teacher":"이수경","text":"  ","photo":""}');
  assert r->>'error' = 'empty', r::text;
  r := qq_submit('{"name":"김철수","student_id":"12345678","teacher":"이수경","text":"","photo":"http://x"}');
  assert r->>'error' = 'photo_too_big', r::text;

  -- 질문 타임 형식 검사
  r := qq_submit('{"name":"김철수","student_id":"12345678","teacher":"이수경","qtime":"25:00","text":"q"}');
  assert r->>'error' = 'bad_time', 'bad_time: ' || r::text;
  r := qq_submit('{"name":"김철수","student_id":"12345678","teacher":"이수경","qtime":"5시","text":"q"}');
  assert r->>'error' = 'bad_time', 'bad_time2: ' || r::text;

  -- 정상 등록 3건(이수경T): 질문 타임 순 — 철수 5:30 → 민수 5:30(뒤에 올림) → 유진 6:00, 순번 1·2·3
  a := qq_submit('{"name":"김철수","student_id":"12345678","school":"화정고","grade":"고1","teacher":"이수경","qtime":"5:30","unit":"독서","text":"독서 3번 질문"}');
  assert (a->>'ok')::boolean and (a->>'position')::int = 1, 'a: ' || a::text;
  ida := (a->>'id')::bigint;
  assert (select qtime from question_queue where id = ida) = '05:30', '시각 표기 05:30 정규화';
  assert (select unit from question_queue where id = ida) = '독서', '단원 저장';
  c := qq_submit('{"name":"최유진","student_id":"56789012","teacher":"이수경","qtime":"06:00","text":"문학 12번"}');
  assert (c->>'position')::int = 2, 'c: ' || c::text;
  idc := (c->>'id')::bigint;
  b := qq_submit('{"name":"박민수","student_id":"34567890","teacher":"이수경","qtime":"5:30","text":"","photo":"data:image/jpeg;base64,AAAA"}');
  assert (b->>'position')::int = 2, '같은 타임은 먼저 올린 쪽이 앞 / 이른 타임은 늦게 올려도 앞: ' || b::text;
  idb := (b->>'id')::bigint;
  assert qq_position_(idc) = 3, '유진(6:00)은 3번';
  -- 타임을 안 주면 지금 시각으로 들어간다
  r := qq_submit('{"name":"노담당","student_id":"67890123","teacher":"김지원","text":"t"}');
  assert (select qtime from question_queue where id = (r->>'id')::bigint) ~ '^\d\d:\d\d$', 'qtime 기본값';
  update question_queue set status = '취소' where id = (r->>'id')::bigint;

  -- 다른 선생님 대기열은 따로 센다
  r := qq_submit('{"name":"이영희","student_id":"23456789","teacher":"김지원","text":"화작"}');
  assert (r->>'position')::int = 1, 'other teacher: ' || r::text;

  -- 같은 선생님께 다시 올리면 새로 넣지 않고 기존 건(dup)
  r := qq_submit('{"name":"김철수","student_id":"12345678","teacher":"이수경","text":"또 질문"}');
  assert (r->>'dup')::boolean and (r->>'id')::bigint = ida and (r->>'position')::int = 1, 'dup: ' || r::text;
  select count(*) into n from question_queue where student_id='12345678'; assert n = 1, 'dup inserted';

  -- 내 질문 조회
  r := qq_mine('{"name":"박민수","student_id":"34567890"}');
  l := r->'list';
  assert jsonb_array_length(l) = 1 and (l->0->>'hasPhoto')::boolean and l->0->>'status' = '대기'
     and (l->0->>'position')::int = 2 and l->0->>'time' ~ '^\d\d:\d\d$' and l->0->>'qtime' = '05:30', 'mine: ' || r::text;
  assert l->0->'photo' is null, '사진 본문은 내려주지 않는다';

  -- 교사: 철수 호출 → 민수 1번, 유진 2번
  update question_queue set status='호출', called_at=now() where id = ida;
  assert qq_position_(ida) is null, 'called has no position';
  assert qq_position_(idb) = 1 and qq_position_(idc) = 2, 'after call';

  -- 교사: 민수 맨 뒤로(ord = 오늘 최대 + 1) → 유진 1번, 민수 2번
  update question_queue set ord = (select max(ord) from question_queue where qdate = qq_today_()) + 1 where id = idb;
  assert qq_position_(idc) = 1 and qq_position_(idb) = 2, 'to back';

  -- 학생 취소: 호출된 건은 취소 안 됨, 대기 건만
  r := qq_cancel(jsonb_build_object('id', ida, 'name','김철수','student_id','12345678'));
  assert (r->>'ok')::boolean and not (r->>'changed')::boolean, 'cancel called: ' || r::text;
  r := qq_cancel(jsonb_build_object('id', idc, 'name','박민수','student_id','34567890'));
  assert not (r->>'changed')::boolean, '남의 질문 취소 불가';
  r := qq_cancel(jsonb_build_object('id', idc, 'name','최유진','student_id','56789012'));
  assert (r->>'changed')::boolean, 'cancel own: ' || r::text;
  assert (select status from question_queue where id = idc) = '취소';
  assert qq_position_(idb) = 1, 'after cancel';

  -- 취소한 뒤 다시 올리면 새 건으로 들어간다(dup 아님)
  r := qq_submit('{"name":"최유진","student_id":"56789012","teacher":"이수경","qtime":"23:59","text":"다시"}');
  assert r->'dup' is null and (r->>'position')::int = 2, 'resubmit: ' || r::text;

  -- 교사: 완료
  update question_queue set status='완료', done_at=now() where id = ida;
  r := qq_mine('{"name":"김철수","student_id":"12345678"}');
  assert r->'list'->0->>'status' = '완료' and r->'list'->0->>'doneAt' is not null, 'done: ' || r::text;

  -- 오래된 사진 비우기: 8일 전 건의 사진은 다음 등록 때 비워지고, 어제 건은 남는다
  insert into question_queue (qdate, name, student_id, teacher, text, photo, status)
   values (qq_today_() - 8, '옛날', '00000001', '이수경', 'old', 'data:image/jpeg;base64,OLD', '완료'),
          (qq_today_() - 1, '어제', '00000002', '이수경', 'y', 'data:image/jpeg;base64,YDAY', '완료');
  r := qq_submit('{"name":"이영희","student_id":"23456789","teacher":"이수경","text":"새 질문"}');
  assert (select photo from question_queue where name='옛날') = '', 'old photo purged';
  assert (select photo from question_queue where name='어제') <> '', 'recent photo kept';
  assert (select text from question_queue where name='옛날') = 'old', 'old text kept';

  -- 어제 건은 오늘 순번·내 질문에 안 잡힌다
  r := qq_mine('{"name":"이영희","student_id":"23456789"}');
  assert jsonb_array_length(r->'list') = 2, 'mine today only: ' || r::text;

  raise notice 'OK — 질문 대기열 함수 왕복 검증 통과';
end $$;

-- 권한: anon 은 표를 못 읽고 함수는 부를 수 있다
set role anon;
do $$ begin
  begin
    perform count(*) from question_queue;
    raise exception 'anon이 표를 읽었다';
  exception when insufficient_privilege then null;
  end;
end $$;
select (qq_teachers() @> '["이수경"]'::jsonb) as anon_can_call_fn \gset
reset role;
\if :anon_can_call_fn
\echo OK — anon: 표 접근 차단 · 함수 호출 허용
\else
\echo FAIL — anon 함수 호출
\quit 1
\endif
SQL
echo "ALL OK"
