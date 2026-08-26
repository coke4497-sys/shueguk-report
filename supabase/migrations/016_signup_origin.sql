-- ============================================================
-- 016 (2026-08-26): 주말 모의고사 신청 — 수파베이스가 원본이 된다
--
-- 지금까지 signup_entries 는 신청 시트의 읽기 미러였다(005). 이제 학생 제출·
-- 교사 삭제가 여기에 먼저 기록되고, 시트는 페이지가 뒤에서 이중 기록하는
-- 사본이 된다(명단 tt_classes 전환과 같은 방향). 새 표는 없고 함수만 만든다.
--
-- 학생 페이지(signup.html·s.html)는 공개 키(anon)라 표를 직접 읽고 쓸 수 없다
-- (015 잠금). 그래서 신청 백엔드(signup_code.gs)의 판정 로직을 그대로 옮긴
-- SECURITY DEFINER 함수 3개를 만들어 anon 에 연다:
--   · signup_days()   — 폼 첫 화면: 정원·요일별 인원·응시 날짜·신청받기·가능 학년
--   · signup_submit() — 신청 제출: 열림/요일/학년/정원 판정 후 기록 (원자적)
--   · signup_mine()   — 학생 개별 페이지: 이번 주 본인 신청 내역
-- 판정 규칙·응답 모양은 signup_code.gs 의 days/handleSubmit_/mySignups_ 와 1:1.
--
-- 상수는 백엔드와 동일: 요일 토·일, 정원 37, 주차는 화요일 시작(KST),
-- 토=화+4일·일=화+5일. 설정(open/grades)은 signup_settings 미러를 읽는다
-- (원본은 여전히 신청 백엔드 Script Properties — 교사 페이지가 저장 때 양쪽에 쓴다).
-- ============================================================

-- 제출시각 텍스트('yyyy-MM-dd HH:mm')에서 화요일 시작 주차 키를 만든다 (weekKey_)
create or replace function public.signup_week_key(p_ts text)
returns date
language sql immutable
as $$
  select case
    when coalesce(p_ts, '') ~ '^\d{4}-\d{2}-\d{2}' then
      substring(p_ts from 1 for 10)::date
        - ((extract(dow from substring(p_ts from 1 for 10)::date)::int - 2 + 7) % 7)
    else null
  end
$$;

-- 오늘(KST)이 속한 화요일 시작 주차
create or replace function public.signup_week_today()
returns date
language sql stable
as $$
  select d - ((extract(dow from d)::int - 2 + 7) % 7)
  from (select (now() at time zone 'Asia/Seoul')::date as d) t
$$;

-- 주차 + 요일 → 응시 날짜 'M월 D일' (examDateLabel_ — 앞자리 0 없음)
create or replace function public.signup_day_label(p_week date, p_day text)
returns text
language sql immutable
as $$
  select case when p_week is null or p_day not in ('토요일','일요일') then ''
    else extract(month from p_week + case when p_day = '토요일' then 4 else 5 end)::int || '월 '
      || extract(day   from p_week + case when p_day = '토요일' then 4 else 5 end)::int || '일'
  end
$$;

-- 신청받기 여부 — signup_settings 미러(key='open'), 없으면 열림 (isOpen_ 기본값과 동일)
create or replace function public.signup_is_open()
returns boolean
language sql stable
as $$
  select coalesce((select (value #>> '{}') in ('true','1') from signup_settings where key = 'open'), true)
$$;

-- 신청 가능 학년 — signup_settings 미러(key='grades'), 없거나 비면 고3만 (getActiveGrades_)
create or replace function public.signup_active_grades()
returns text[]
language plpgsql stable
as $$
declare v text[];
begin
  begin
    select array(select t from jsonb_array_elements_text(value) t where t in ('1','2','3'))
      into v from signup_settings where key = 'grades' and jsonb_typeof(value) = 'array';
  exception when others then v := null;
  end;
  if v is null or cardinality(v) = 0 then v := array['3']; end if;
  return v;
end $$;

-- 학교 이름 느슨 비교 (schoolMatch_ — 리포트·OMR 백엔드와 동일 규칙)
create or replace function public.signup_school_match(a text, b text)
returns boolean
language plpgsql immutable
as $$
declare
  aa text := regexp_replace(coalesce(a, ''), '\s+', '', 'g');
  bb text := regexp_replace(coalesce(b, ''), '\s+', '', 'g');
  na text; nb text;
begin
  if aa = '' or bb = '' then return false; end if;
  if aa = bb then return true; end if;
  na := regexp_replace(aa, '(등학교|고등학교|중학교|학교|고|중)$', '');
  nb := regexp_replace(bb, '(등학교|고등학교|중학교|학교|고|중)$', '');
  if na <> '' and nb <> '' and na = nb then return true; end if;
  return position(bb in aa) > 0 or position(aa in bb) > 0;
end $$;

-- ── 폼 첫 화면 (doGet action=days 와 같은 응답 모양) ─────────────────
create or replace function public.signup_days()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_week date := signup_week_today();
  v_counts jsonb;
begin
  select jsonb_object_agg(d.day, coalesce(c.n, 0)) into v_counts
  from (values ('토요일'), ('일요일')) d(day)
  left join (
    select day, count(distinct name || '|' || school || '|' || student_id) as n
    from signup_entries
    where day in ('토요일','일요일') and signup_week_key(ts) = v_week
    group by day
  ) c using (day);
  return jsonb_build_object(
    'result', 'success',
    'cap', 37,
    'days', jsonb_build_array('토요일','일요일'),
    'counts', v_counts,
    'open', signup_is_open(),
    'dates', jsonb_build_object(
      '토요일', jsonb_build_object('label', signup_day_label(v_week, '토요일'), 'iso', to_char(v_week + 4, 'YYYY-MM-DD')),
      '일요일', jsonb_build_object('label', signup_day_label(v_week, '일요일'), 'iso', to_char(v_week + 5, 'YYYY-MM-DD'))),
    'week', to_char(v_week, 'YYYY-MM-DD'),
    'grades', to_jsonb(signup_active_grades()));
end $$;

-- ── 신청 제출 (handleSubmit_ 와 같은 판정·응답) ──────────────────────
-- p = {name, school, grade, id, subject, day}
-- 정원 판정은 조언 잠금으로 직렬화 — 동시 제출이 몰려도 37명을 넘지 않는다.
create or replace function public.signup_submit(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name    text := trim(coalesce(p->>'name', ''));
  v_school  text := trim(coalesce(p->>'school', ''));
  v_grade   text := trim(coalesce(p->>'grade', ''));
  v_id      text := trim(coalesce(p->>'id', ''));
  v_subject text := trim(coalesce(p->>'subject', ''));
  v_day     text := trim(coalesce(p->>'day', ''));
  v_week    date;
  v_me      text;
  v_count   int;
  v_have    boolean;
begin
  perform pg_advisory_xact_lock(hashtext('signup_submit'));
  if not signup_is_open() then
    return jsonb_build_object('result', 'closed');
  end if;
  if v_day not in ('토요일','일요일') then
    return jsonb_build_object('result', 'error', 'message', 'invalid_day');
  end if;
  if not (v_grade = any(signup_active_grades())) then
    return jsonb_build_object('result', 'grade_closed');
  end if;
  v_week := signup_week_today();
  v_me := v_name || '|' || v_school || '|' || v_id;
  select count(distinct name || '|' || school || '|' || student_id),
         coalesce(bool_or(name || '|' || school || '|' || student_id = v_me), false)
    into v_count, v_have
    from signup_entries
   where day = v_day and signup_week_key(ts) = v_week;
  if not v_have and v_count >= 37 then
    return jsonb_build_object('result', 'full', 'day', v_day, 'cap', 37);
  end if;
  insert into signup_entries (ts, name, school, grade, student_id, subject, day, exam_date)
  values (to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
          v_name, v_school, v_grade, v_id, v_subject, v_day, signup_day_label(v_week, v_day));
  return jsonb_build_object('result', 'success', 'week', to_char(v_week, 'YYYY-MM-DD'));
end $$;

-- ── 학생 개별 페이지: 이번 주 본인 신청 내역 (mySignups_ 와 동일 규칙) ──
-- p = {name, school, id, uniq} — uniq='1'이면(그 이름이 명단에 1명뿐) 학생ID 대조 생략
create or replace function public.signup_mine(p jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_name   text := trim(coalesce(p->>'name', ''));
  v_school text := trim(coalesce(p->>'school', ''));
  v_id     text := trim(coalesce(p->>'id', ''));
  v_uniq   boolean := coalesce(p->>'uniq', '') = '1';
  v_week   date := signup_week_today();
  v_out    jsonb;
begin
  if v_name = '' then
    return jsonb_build_object('result', 'success', 'signups', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'date', signup_day_label(v_week, day)) order by first_id), '[]'::jsonb)
    into v_out
  from (
    select day, min(id) as first_id
    from signup_entries
    where trim(name) = v_name
      and (v_school = '' or trim(school) = '' or signup_school_match(school, v_school))
      and (v_uniq or trim(regexp_replace(student_id, '^''', '')) = '' or v_id = ''
           or trim(regexp_replace(student_id, '^''', '')) = v_id)
      and day in ('토요일','일요일')
      and signup_week_key(ts) = v_week
    group by day
  ) t;
  return jsonb_build_object('result', 'success', 'week', to_char(v_week, 'YYYY-MM-DD'), 'signups', v_out);
end $$;

-- 학생 화면(공개 키)이 부를 수 있게 — 015 잠금과 같은 방식의 명시 허용
grant execute on function public.signup_days()        to anon, authenticated;
grant execute on function public.signup_submit(jsonb) to anon, authenticated;
grant execute on function public.signup_mine(jsonb)   to anon, authenticated;
