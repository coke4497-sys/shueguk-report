#!/usr/bin/env bash
# 질문 대기열(024_question_queue.sql + 025_clinic_to_queue.sql) 왕복 검증 — 로컬 PostgreSQL에
# 클리닉(006·019)과 대기열 마이그레이션을 적용하고 학생 함수(qq_submit/qq_mine/qq_cancel/qq_arrive/
# qq_teachers)·클리닉 신청(clinic_submit → '예약' 줄)·교사 쪽 갱신(호출·완료·맨 뒤로·도착)을
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

psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/006_clinic.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/019_clinic_origin.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/024_question_queue.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/025_clinic_to_queue.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/026_queue_roster.sql

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

-- ── 025: 클리닉 신청 → 예약 줄 → 도착 ─────────────────────────
insert into clinic_settings (key, value) values ('target', '{"type":"전체","target":""}') on conflict (key) do update set value = excluded.value;
update question_queue set status = '완료' where status in ('대기','호출');   -- 앞 블록의 열린 줄 정리(같은 학생·선생님 중복 방지 규칙과 겹치지 않게)
do $$
declare r jsonb; qid bigint; qid2 bigint; cid bigint; row question_queue; today date := qq_today_(); n int;
        slot text; qd date;
begin
  -- 시간대 해석
  assert clinic_slot_hm_('목 저녁 5:30–7:00') = '17:30', 'slot 17:30';
  assert clinic_slot_hm_('토 3:30–5:00') = '15:30', 'slot 15:30';
  assert clinic_slot_hm_('토 오전 10:00–11:30') = '10:00', 'slot 오전';
  assert clinic_slot_hm_('금 밤 10:00–11:00') = '22:00', 'slot 밤';
  assert clinic_slot_hm_('시간 미정') is null, 'slot none';
  assert clinic_meet_date_('2026-09-06'::date, '목 저녁 5:30–7:00') = '2026-09-10'::date, 'meet 다음 목요일';
  assert clinic_meet_date_('2026-09-10'::date, '목 저녁 5:30–7:00') = '2026-09-10'::date, 'meet 당일';
  assert clinic_meet_date_('2026-09-06'::date, '') = '2026-09-06'::date, 'meet 요일 없음';

  -- 오늘 요일의 시간대로 신청 → 오늘 날짜 '예약' 줄 (요청 2장 → 한 줄, 영역 합침, 사진 포함, clinic_id)
  slot := substring('일월화수목금토' from extract(dow from today)::int + 1 for 1) || ' 저녁 5:30–7:00';
  r := clinic_submit(jsonb_build_object('name','이영희','school','능곡고','phone','1234','time',slot,'grade','고2',
        'studentId','23456789','teacher','김지원','memo','잘 부탁드려요','photo','data:image/jpeg;base64,CLINIC',
        'requests', jsonb_build_array(
          jsonb_build_object('type','질문','area','독서 · 인문','content','비문학 3번','count','1~2개'),
          jsonb_build_object('type','개념 설명','area','문법 (언어와 매체)','content','음운 변동','count',''))));
  assert r->>'result' = 'success' and (r->>'saved')::int = 2 and (r->>'queueId') is not null, 'clinic_submit: ' || r::text;
  qid := (r->>'queueId')::bigint;
  select * into row from question_queue where id = qid;
  assert row.status = '예약' and row.qdate = today and row.qtime = '17:30' and row.teacher = '김지원'
     and row.student_id = '23456789' and row.grade = '고2' and row.photo = 'data:image/jpeg;base64,CLINIC', '예약 줄: ' || row::text;
  assert row.unit = '독서 · 인문, 문법 (언어와 매체)', 'unit: ' || row.unit;
  assert row.text = E'· 질문 · 독서 · 인문 — 비문학 3번 (1~2개)\n· 개념 설명 · 문법 (언어와 매체) — 음운 변동\n메모: 잘 부탁드려요', 'text: ' || row.text;
  select min(id) into cid from clinic_requests where student_id = '23456789';
  assert row.clinic_id = cid, 'clinic_id = 첫 신청 행';
  assert qq_position_(qid) is null, '예약은 순번 없음';

  -- 같은 학생이 같은 날 같은 선생님께 다시 신청 → 새 줄 없음(queueId null), 신청 자체는 저장
  r := clinic_submit(jsonb_build_object('name','이영희','school','능곡고','phone','1234','time',slot,'grade','고2',
        'studentId','23456789','teacher','김지원','requests', jsonb_build_array(jsonb_build_object('type','질문','area','문학 · 현대시','content','x','count',''))));
  assert r->>'result' = 'success' and (r->>'queueId') is null, 'dup clinic: ' || r::text;
  select count(*) into n from question_queue where student_id = '23456789' and qdate = today and status = '예약'; assert n = 1, '예약 중복 없음';

  -- 내 질문에 예약이 clinic:true 로 보인다
  r := qq_mine('{"name":"이영희","student_id":"23456789"}');
  assert (select count(*) from jsonb_array_elements(r->'list') x where x->>'status' = '예약' and (x->>'clinic')::boolean) = 1, 'mine 예약: ' || r::text;

  -- 먼저 온 다른 친구(현장 등록)가 1번, 예약은 순서에 없음
  r := qq_submit('{"name":"노담당","student_id":"67890123","teacher":"김지원","qtime":"17:40","text":"먼저 왔어요"}');
  qid2 := (r->>'id')::bigint;
  assert (r->>'position')::int = 1, '먼저 온 친구 1번: ' || r::text;

  -- 도착 처리(qq_arrive) → 대기, ord = 지금(17:40 예약보다 뒤/앞은 실제 시각에 따르므로 위치는 1 또는 2), qtime 갱신
  r := qq_arrive(jsonb_build_object('id', qid, 'name','이영희','student_id','23456789'));
  assert (r->>'ok')::boolean and (r->>'changed')::boolean, 'arrive: ' || r::text;
  select * into row from question_queue where id = qid;
  assert row.status = '대기' and row.qtime ~ '^\d\d:\d\d$' and row.qtime <> '17:30', 'arrived row: ' || row::text;
  assert (select count(*) from question_queue where qdate = today and teacher = '김지원' and status = '대기') = 2, '대기 2명';
  -- 두 번 도착은 변화 없음, 남의 예약 도착 불가
  r := qq_arrive(jsonb_build_object('id', qid, 'name','이영희','student_id','23456789'));
  assert not (r->>'changed')::boolean, 'arrive twice';

  -- 예약이 있는 학생이 당일 '질문하기'로 올리면 새 줄 대신 예약을 도착 처리(글·단원·사진 덧붙임)
  update question_queue set status = '예약', qtime = '17:30', photo = '' where id = qid;
  r := qq_submit('{"name":"이영희","student_id":"23456789","teacher":"김지원","qtime":"18:05","unit":"문학","text":"현장에서 추가 질문","photo":"data:image/jpeg;base64,NEW"}');
  assert (r->>'arrived')::boolean and (r->>'id')::bigint = qid, 'submit→arrive: ' || r::text;
  select * into row from question_queue where id = qid;
  assert row.status = '대기' and row.qtime = '18:05' and row.unit like '%문학' and row.text like E'%\n현장에서 추가 질문' and row.photo = 'data:image/jpeg;base64,NEW', 'merged: ' || row::text;
  select count(*) into n from question_queue where student_id = '23456789' and qdate = today and status in ('예약','대기','호출'); assert n = 1, '새 줄 안 생김';
  -- 이미 대기 중이면 종전대로 dup
  r := qq_submit('{"name":"이영희","student_id":"23456789","teacher":"김지원","text":"또"}');
  assert (r->>'dup')::boolean, 'dup after arrive';

  -- 신청 행을 지우면 대기열 줄도 사라진다(cascade)
  delete from clinic_requests where id = cid;
  assert not exists (select 1 from question_queue where id = qid), 'cascade delete';

  -- 다음 목요일 시간대로 신청 → 그 날짜의 예약(오늘 목록엔 안 보임)
  r := clinic_submit(jsonb_build_object('name','김철수','school','화정고','phone','5678','time','목 저녁 7:00–8:30','grade','고1',
        'studentId','12345678','teacher','이수경','requests', jsonb_build_array(jsonb_build_object('type','추가 문제','area','문학 · 고전시가','content','정과정','count',''))));
  qd := clinic_meet_date_(today, '목 저녁 7:00–8:30');
  select * into row from question_queue where id = (r->>'queueId')::bigint;
  assert row.qdate = qd and row.qtime = '19:00' and row.status = '예약', '미래 예약: ' || row::text;
  if qd <> today then
    r := qq_mine('{"name":"김철수","student_id":"12345678"}');
    assert (select count(*) from jsonb_array_elements(r->'list') x where (x->>'clinic')::boolean) = 0, '미래 예약은 오늘 목록에 없음';
    r := qq_arrive(jsonb_build_object('id', row.id, 'name','김철수','student_id','12345678'));
    assert not (r->>'changed')::boolean, '미래 예약은 오늘 도착 불가';
  end if;

  raise notice 'OK — 클리닉 신청 → 예약 → 도착 검증 통과';
end $$;

-- ── 026: 반 명단('명단') → 학생/교사가 줄 세우기 ─────────────────
do $$
declare r jsonb; qid bigint; row question_queue; today date := qq_today_(); n int;
begin
  update question_queue set status = '완료' where status in ('예약','대기','호출');
  -- 교사가 명단으로 올린 줄(교사 화면은 authenticated로 직접 INSERT — 여기선 같은 모양으로 넣는다)
  insert into question_queue (name, school, grade, student_id, teacher, qtime, unit, status, note)
   values ('박민수','서정중','중3','34567890','이수경','17:00','정리정독 중3','명단','반 명단: 정리정독 중3') returning id into qid;
  assert qq_position_(qid) is null, '명단은 순번 없음';
  -- 학생 페이지 [질문 대기] = qq_arrive → 대기, 지금 시각
  r := qq_arrive(jsonb_build_object('id', qid, 'name','박민수','student_id','34567890'));
  assert (r->>'ok')::boolean and (r->>'changed')::boolean and (r->>'position')::int = 1, 'roster arrive: ' || r::text;
  select * into row from question_queue where id = qid; assert row.status = '대기' and row.qtime <> '17:00', 'roster arrived row';
  -- 명단이 있는 학생이 '질문하기'로 올리면 그 줄을 도착 처리(새 줄 없음)
  update question_queue set status = '명단' where id = qid;
  r := qq_submit('{"name":"박민수","student_id":"34567890","teacher":"이수경","qtime":"18:10","text":"명단에서 질문"}');
  assert (r->>'arrived')::boolean and (r->>'id')::bigint = qid, 'submit→roster arrive: ' || r::text;
  select count(*) into n from question_queue where student_id='34567890' and qdate = today and status in ('명단','대기','호출'); assert n = 1, '명단 중복 없음';
  -- 명단이 있는 학생의 클리닉 신청은 예약을 따로 만들지 않는다
  update question_queue set status = '명단' where id = qid;
  r := clinic_submit(jsonb_build_object('name','박민수','school','서정중','phone','1111','time', substring('일월화수목금토' from extract(dow from today)::int + 1 for 1) || ' 저녁 5:30–7:00','grade','중3',
        'studentId','34567890','teacher','이수경','requests', jsonb_build_array(jsonb_build_object('type','질문','area','문학 · 현대시','content','x','count',''))));
  assert r->>'result' = 'success' and (r->>'queueId') is null, '명단 있으면 예약 안 만듦: ' || r::text;
  raise notice 'OK — 반 명단 → 줄 세우기 검증 통과';
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
select (qq_teachers() @> '["이수경"]'::jsonb) and (qq_arrive('{"id":"1","name":"x","student_id":"0"}')->>'error' = 'unknown_student') as anon_can_call_fn \gset
reset role;
\if :anon_can_call_fn
\echo OK — anon: 표 접근 차단 · 함수 호출 허용
\else
\echo FAIL — anon 함수 호출
\quit 1
\endif
SQL
echo "ALL OK"
