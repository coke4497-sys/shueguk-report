-- 024: 질문 대기열 (2026-09-06)
-- 학생이 학생 페이지(s.html)에서 선생님께 질문(글+사진)을 올리면 선생님별 대기열에 쌓이고,
-- 선생님은 티쳐스 '질문 대기열'(hub question.html)에서 순서대로 호출·완료 처리한다.
-- 호출 여부는 강의실 디스플레이(hub question_board.html)가 크게 보여 준다.
--
-- 원본은 이 표 하나(question_queue) — 시트 사본 없음(그날 쓰고 끝나는 기록).
--   · 학생 화면은 표를 직접 읽지 않고 아래 함수만 부른다(015 잠금 방침):
--       qq_teachers()  — 선생님 목록(students의 담당T)
--       qq_submit(p)   — 질문 올리기 {name,school,grade,student_id,teacher,text,photo}
--       qq_mine(p)     — 내 오늘 질문·순번 {name,student_id}
--       qq_cancel(p)   — 대기 중인 내 질문 취소 {id,name,student_id}
--   · 교사 화면(question.html·question_board.html)은 조용한 인증(authenticated)으로 표를 직접 읽고 쓴다.
-- 사진은 저장소(Storage)를 따로 두지 않고 페이지가 1280px·JPEG로 줄인 data URL을 photo 열에 담는다
-- (보통 100~300KB). 7일 지난 사진은 qq_submit이 지나가며 비운다(글·기록은 남긴다).

create table if not exists question_queue (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  qdate date not null default (now() at time zone 'Asia/Seoul')::date,   -- 한국 날짜(하루 단위 대기열)
  ord bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,  -- 순서(맨 뒤로 보내기용)
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  student_id text not null default '',   -- 학생ID(부모님 전화 8자리) — students와 대조
  teacher text not null default '',      -- 질문할 선생님(담당T 표기 그대로)
  text text not null default '',
  photo text not null default '',        -- data:image/jpeg;base64,…  (빈값 = 사진 없음)
  status text not null default '대기',   -- 대기 / 호출 / 완료 / 취소 / 건너뜀
  called_at timestamptz,
  done_at timestamptz,
  note text not null default ''          -- 선생님 메모
);
create index if not exists question_queue_day_idx on question_queue (qdate, teacher, status);
create index if not exists question_queue_stu_idx on question_queue (student_id, name);

-- 015 잠금과 같은 권한: 공개 키(anon)는 표를 못 보고, 교사 신분만 읽고 쓴다.
alter table question_queue enable row level security;
drop policy if exists teacher_all on question_queue;
create policy teacher_all on question_queue for all to authenticated using (true) with check (true);
revoke all on question_queue from anon;
grant all on question_queue to authenticated;

-- ── 도우미 ──────────────────────────────────────────────────
create or replace function public.qq_today_()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

-- 이 학생이 재원 명단에 있는가 (이름 + 학생ID 8자리 일치)
create or replace function public.qq_student_ok_(p_name text, p_sid text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from students
    where trim(name) = trim(coalesce(p_name,'')) and trim(student_id) = trim(coalesce(p_sid,''))
      and trim(coalesce(p_sid,'')) <> ''
  );
$$;

-- 대기 순번: 같은 선생님·같은 날 '대기' 중 내 앞에 몇 명인지 + 1 (대기가 아니면 null)
create or replace function public.qq_position_(p_id bigint)
returns int language plpgsql stable set search_path = public as $$
declare r question_queue; n int;
begin
  select * into r from question_queue where id = p_id;
  if r.id is null or r.status <> '대기' then return null; end if;
  select count(*) into n from question_queue q
   where q.qdate = r.qdate and q.teacher = r.teacher and q.status = '대기'
     and (q.ord < r.ord or (q.ord = r.ord and q.id < r.id));
  return n + 1;
end $$;

-- 한 줄을 학생 화면용 JSON으로
create or replace function public.qq_row_json_(r question_queue)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'teacher', r.teacher,
    'text', r.text,
    'hasPhoto', r.photo <> '',
    'status', r.status,
    'position', qq_position_(r.id),
    'time', to_char(r.created_at at time zone 'Asia/Seoul', 'HH24:MI'),
    'calledAt', case when r.called_at is null then null else to_char(r.called_at at time zone 'Asia/Seoul', 'HH24:MI') end,
    'doneAt', case when r.done_at is null then null else to_char(r.done_at at time zone 'Asia/Seoul', 'HH24:MI') end
  );
$$;

-- ── 선생님 목록 ─────────────────────────────────────────────
-- 재원생의 담당T를 학생 수 많은 순으로 (표기는 학생정보 그대로, 예 '이수경')
create or replace function public.qq_teachers()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by n desc, t), '[]'::jsonb)
  from (
    select trim(teacher) as t, count(*) as n
    from students
    where trim(coalesce(teacher,'')) <> '' and (trim(coalesce(enrolled,'')) in ('', '재원'))
    group by trim(teacher)
  ) x;
$$;

-- ── 질문 올리기 ─────────────────────────────────────────────
-- p: {name, school, grade, student_id, teacher, text, photo}
-- 응답: {ok:true, id, position, dup?}  /  {ok:false, error}
--   error: unknown_student(명단에 없음) · no_teacher · empty(글·사진 둘 다 없음) · too_long · photo_too_big
-- 같은 선생님께 이미 대기/호출 중인 질문이 있으면 새로 넣지 않고 그 건을 돌려준다(dup:true).
create or replace function public.qq_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p->>'name',''));
        sid text := trim(coalesce(p->>'student_id',''));
        tc text := trim(coalesce(p->>'teacher',''));
        tx text := trim(coalesce(p->>'text',''));
        ph text := coalesce(p->>'photo','');
        ex question_queue; nid bigint;
begin
  if not qq_student_ok_(nm, sid) then return jsonb_build_object('ok', false, 'error', 'unknown_student'); end if;
  if tc = '' then return jsonb_build_object('ok', false, 'error', 'no_teacher'); end if;
  if tx = '' and ph = '' then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  if length(tx) > 1000 then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;
  if ph <> '' and (ph not like 'data:image/%' or length(ph) > 1200000) then
    return jsonb_build_object('ok', false, 'error', 'photo_too_big');
  end if;

  select * into ex from question_queue
   where qdate = qq_today_() and teacher = tc and student_id = sid and trim(name) = nm
     and status in ('대기','호출')
   order by id limit 1;
  if ex.id is not null then
    return jsonb_build_object('ok', true, 'id', ex.id, 'position', qq_position_(ex.id), 'status', ex.status, 'dup', true);
  end if;

  insert into question_queue (name, school, grade, student_id, teacher, text, photo)
  values (nm, trim(coalesce(p->>'school','')), trim(coalesce(p->>'grade','')), sid, tc, tx, ph)
  returning id into nid;

  -- 오래된 사진 비우기(글·기록은 남긴다) — 표가 사진으로 불어나지 않게
  update question_queue set photo = '' where photo <> '' and qdate < qq_today_() - 7;

  return jsonb_build_object('ok', true, 'id', nid, 'position', qq_position_(nid), 'status', '대기');
end $$;

-- ── 내 오늘 질문 ────────────────────────────────────────────
-- p: {name, student_id} → {ok:true, list:[{id,teacher,text,hasPhoto,status,position,time,calledAt,doneAt}]}
create or replace function public.qq_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare nm text := trim(coalesce(p->>'name',''));
        sid text := trim(coalesce(p->>'student_id',''));
        out_j jsonb;
begin
  if not qq_student_ok_(nm, sid) then return jsonb_build_object('ok', false, 'error', 'unknown_student'); end if;
  select coalesce(jsonb_agg(qq_row_json_(q) order by q.id), '[]'::jsonb) into out_j
    from question_queue q
   where q.qdate = qq_today_() and q.student_id = sid and trim(q.name) = nm;
  return jsonb_build_object('ok', true, 'list', out_j);
end $$;

-- ── 내 질문 취소 (대기 중일 때만) ─────────────────────────────
-- p: {id, name, student_id} → {ok:true, changed:boolean}
create or replace function public.qq_cancel(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p->>'name',''));
        sid text := trim(coalesce(p->>'student_id',''));
        qid bigint := nullif(p->>'id','')::bigint;
        n int;
begin
  if qid is null then return jsonb_build_object('ok', false, 'error', 'no_id'); end if;
  if not qq_student_ok_(nm, sid) then return jsonb_build_object('ok', false, 'error', 'unknown_student'); end if;
  update question_queue set status = '취소', done_at = now()
   where id = qid and student_id = sid and trim(name) = nm and status = '대기';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n > 0);
end $$;

grant execute on function public.qq_teachers()      to anon, authenticated;
grant execute on function public.qq_submit(jsonb)   to anon, authenticated;
grant execute on function public.qq_mine(jsonb)     to anon, authenticated;
grant execute on function public.qq_cancel(jsonb)   to anon, authenticated;
