-- 019: 클리닉 신청 — 수파베이스가 원본 (2026-08-26)
-- 신청 판정 로직(shueguk-clinic Code.gs)을 1:1로 옮긴 SECURITY DEFINER 함수 둘을 anon에 연다
-- (016 주말 신청과 같은 방식). 설정(open/slots/teachers/target)의 원본은 여전히 클리닉 백엔드
-- Script Properties — 교사 페이지가 저장 시 clinic_settings 미러를 갱신하고, 여기 함수는 미러를 읽는다.
--   · clinic_form()    — 학생 폼 첫 화면 (action=slots 응답과 같은 모양)
--   · clinic_submit(p) — 제출: 중단/대상/강사 시간대/정원(9명) 판정 후 clinic_requests에 기록.
--                        조언 잠금으로 직렬화되어 동시 제출이 몰려도 정원을 넘지 않는다.
-- ※ 백엔드의 EXCLUDE(2026-06-16 주차 2건)는 옮기지 않았다 — 지나간 주차의 정원 보정이라
--    현재 주차 계산에는 영향이 없다.

-- ── 도우미 ──────────────────────────────────────────────────
-- 학년 문자열 → '중2'/'고3' 토큰 ('' = 학년 없음). 옛 숫자('2')는 고등.
create or replace function public.clinic_grade_token_(s text)
returns text language sql immutable set search_path = public as $$
  select case when d is null then ''
              else (case when coalesce(s,'') like '%중%' then '중' else '고' end) || d end
  from (select substring(regexp_replace(coalesce(s,''), '20\d\d', '', 'g') from '[1-3]') as d) x;
$$;

-- 학교 이름 느슨 비교 (백엔드 schoolLoose_와 동일)
create or replace function public.clinic_school_loose_(a text, b text)
returns boolean language plpgsql immutable set search_path = public as $$
declare a2 text := regexp_replace(coalesce(a,''), '\s+', '', 'g');
        b2 text := regexp_replace(coalesce(b,''), '\s+', '', 'g');
        na text; nb text;
begin
  if a2 = '' or b2 = '' then return false; end if;
  if a2 = b2 then return true; end if;
  na := regexp_replace(a2, '(등학교|고등학교|중학교|학교|고|중)$', '');
  nb := regexp_replace(b2, '(등학교|고등학교|중학교|학교|고|중)$', '');
  if na <> '' and nb <> '' and na = nb then return true; end if;
  return position(b2 in a2) > 0 or position(a2 in b2) > 0;
end $$;

-- 화요일 시작 주(화~월)의 화요일 날짜 (클리닉 정원 주차 키)
create or replace function public.clinic_week_key_(d date)
returns date language sql immutable set search_path = public as $$
  select d - (((extract(dow from d)::int - 2) + 7) % 7);
$$;

-- 신청이 향하는 '실제 클리닉 날짜'의 주차 — 시간대 앞 요일 글자로 당일 또는 다음 해당 요일
create or replace function public.clinic_meet_week_(d date, slot text)
returns date language plpgsql immutable set search_path = public as $$
declare wd int := position(substring(trim(coalesce(slot,'')) from 1 for 1) in '일월화수목금토') - 1;
begin
  if d is null then return null; end if;
  if wd < 0 then return clinic_week_key_(d); end if;
  return clinic_week_key_(d + ((wd - extract(dow from d)::int + 7) % 7));
end $$;

-- clinic_requests.ts('yyyy-MM-dd HH:mm' KST 텍스트) → 날짜
create or replace function public.clinic_ts_date_(ts text)
returns date language sql immutable set search_path = public as $$
  select case when coalesce(ts,'') ~ '^\d{4}-\d{2}-\d{2}' then substring(ts from 1 for 10)::date end;
$$;

-- 대상 설정에서 학년 토큰 목록 — 학년 대상이면 ["중2","고3"…], 아니면 null
create or replace function public.clinic_grade_tokens_(sel jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare toks text[] := array[]::text[]; t text; k text; out_j jsonb;
begin
  if sel is null or coalesce(sel->>'type','') not like '%학년%' then return null; end if;
  foreach t in array regexp_split_to_array(coalesce(sel->>'target',''), '\s*[,\n]\s*') loop
    if trim(t) = '' then continue; end if;
    k := clinic_grade_token_(t);
    if k <> '' and not (k = any(toks)) then toks := toks || k; end if;
  end loop;
  if array_length(toks,1) is null then return null; end if;
  select jsonb_agg(x order by x) into out_j from unnest(toks) x;
  return out_j;
end $$;

-- 이 학생이 신청 대상인가 (백엔드 eligibleForTarget_ 1:1)
create or replace function public.clinic_eligible_(sel jsonb, p_name text, p_school text, p_grade text)
returns boolean language plpgsql stable set search_path = public as $$
declare typ text := coalesce(sel->>'type',''); toks text[]; t text;
        nm text := trim(coalesce(p_name,'')); sc text := trim(coalesce(p_school,''));
        gk text := clinic_grade_token_(p_grade);
        parts text[]; tn text; ts2 text; tg text; tk text;
begin
  if sel is null or typ = '' or typ like '%전체%' then return true; end if;
  toks := array(select x from unnest(regexp_split_to_array(coalesce(sel->>'target',''), '\s*[,\n]\s*')) x
                where trim(x) <> '');
  if array_length(toks,1) is null then return true; end if;
  if typ like '%학년%' then
    if gk = '' then return false; end if;
    foreach t in array toks loop
      if clinic_grade_token_(t) = gk then return true; end if;
    end loop;
    return false;
  end if;
  -- 개인·일부: 이름 또는 '이름|학교|학년'
  foreach t in array toks loop
    if position('|' in t) > 0 then
      parts := string_to_array(t, '|');
      tn := trim(coalesce(parts[1],'')); ts2 := trim(coalesce(parts[2],'')); tg := trim(coalesce(parts[3],''));
      if tn = '' or tn <> nm then continue; end if;
      if ts2 <> '' and sc <> '' and not clinic_school_loose_(ts2, sc) then continue; end if;
      tk := clinic_grade_token_(tg);
      if tk <> '' and gk <> '' and tk <> gk then continue; end if;
      return true;
    elsif t = nm then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- 설정 읽기 (clinic_settings 미러)
create or replace function public.clinic_setting_(k text)
returns jsonb language sql stable set search_path = public as $$
  select value from clinic_settings where key = k;
$$;

-- ── 학생 폼 첫 화면 (action=slots와 같은 응답) ─────────────────
create or replace function public.clinic_form()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_open boolean := coalesce((clinic_setting_('open'))::text::boolean, true);
        v_slots jsonb := coalesce(clinic_setting_('slots'), '[]'::jsonb);
        v_teachers jsonb := coalesce(clinic_setting_('teachers'), '[]'::jsonb);
        v_target jsonb := coalesce(clinic_setting_('target'), '{"type":"학년","target":"고3"}'::jsonb);
        today date := (now() at time zone 'Asia/Seoul')::date;
        counts jsonb; tcounts jsonb; tlist jsonb; grades jsonb; gtoks jsonb;
begin
  -- 슬롯별 '이번에 신청하면 가게 될 주차'의 신청 인원 (학생 = 이름|학교|전화 묶음)
  with rows as (
    select slot, teacher, name || '|' || school || '|' || phone as k
    from clinic_requests
    where slot <> '' and clinic_meet_week_(clinic_ts_date_(ts), slot) = clinic_meet_week_(today, slot)
  ),
  per_slot as (select slot, count(distinct k) n from rows group by slot),
  per_ts as (select trim(teacher) || '|' || slot as k2, count(distinct k) n from rows where trim(teacher) <> '' group by 1)
  select coalesce((select jsonb_object_agg(slot, n) from per_slot), '{}'::jsonb),
         coalesce((select jsonb_object_agg(k2, n) from per_ts), '{}'::jsonb)
    into counts, tcounts;
  select coalesce(jsonb_agg(jsonb_build_object(
           'teacher', t->>'teacher',
           'open', coalesce((t->>'open')::boolean, true),
           'slots', coalesce(t->'slots','[]'::jsonb),
           'target', t->'target',
           'gradeTokens', clinic_grade_tokens_(case when coalesce(t->'target'->>'type','') <> '' then t->'target' else v_target end)
         )), '[]'::jsonb)
    into tlist from jsonb_array_elements(v_teachers) t;
  gtoks := clinic_grade_tokens_(v_target);
  select jsonb_agg(substring(x from 2 for 1) order by x) into grades
    from jsonb_array_elements_text(coalesce(gtoks,'[]'::jsonb)) x where x like '고%';
  return jsonb_build_object(
    'result','success', 'cap', 9, 'counts', counts, 'tcounts', tcounts,
    'open', v_open, 'slots', v_slots, 'teachers', tlist,
    'grades', grades, 'gradeTokens', gtoks, 'targetType', coalesce(v_target->>'type','전체'));
end $$;

-- ── 제출 (handleSubmit_ 1:1) ──────────────────────────────────
create or replace function public.clinic_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_open boolean := coalesce((clinic_setting_('open'))::text::boolean, true);
        v_teachers jsonb := coalesce(clinic_setting_('teachers'), '[]'::jsonb);
        v_target jsonb := coalesce(clinic_setting_('target'), '{"type":"학년","target":"고3"}'::jsonb);
        per_teacher boolean; t_entry jsonb; tgt jsonb;
        nm text := trim(coalesce(p->>'name','')); sc text := trim(coalesce(p->>'school',''));
        ph text := trim(coalesce(p->>'phone','')); v_slot text := coalesce(p->>'time','');
        tch text := trim(coalesce(p->>'teacher',''));
        gk text := clinic_grade_token_(p->>'grade');
        today date := (now() at time zone 'Asia/Seoul')::date;
        now_week date; me_key text; n_cnt int; me_in boolean;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
        reqs jsonb; r jsonb; saved int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('clinic_submit'));
  per_teacher := jsonb_array_length(v_teachers) > 0;
  if not v_open then return jsonb_build_object('result','closed'); end if;
  -- 강사별 대상이 있으면 그 대상, 없으면 공통 대상
  select t into t_entry from jsonb_array_elements(v_teachers) t where trim(t->>'teacher') = tch limit 1;
  tgt := case when t_entry is not null and coalesce(t_entry->'target'->>'type','') <> ''
              then t_entry->'target' else v_target end;
  if not clinic_eligible_(tgt, nm, sc, p->>'grade') then
    if coalesce(tgt->>'type','') like '%학년%' then
      return jsonb_build_object('result','grade_closed','grades', coalesce(clinic_grade_tokens_(tgt),'[]'::jsonb));
    end if;
    return jsonb_build_object('result','not_target');
  end if;
  if per_teacher then
    if t_entry is null then return jsonb_build_object('result','bad_slot','teacher',tch); end if;
    if coalesce((t_entry->>'open')::boolean, true) = false then
      return jsonb_build_object('result','teacher_closed','teacher',tch);
    end if;
    if v_slot <> '' and not (coalesce(t_entry->'slots','[]'::jsonb) ? v_slot) then
      return jsonb_build_object('result','bad_slot','teacher',tch);
    end if;
  end if;
  now_week := clinic_meet_week_(today, v_slot);
  if v_slot <> '' then
    me_key := nm || '|' || sc || '|' || ph;
    select count(distinct name || '|' || school || '|' || phone),
           coalesce(bool_or(name || '|' || school || '|' || phone = me_key), false)
      into n_cnt, me_in
      from clinic_requests c
     where c.slot = v_slot
       and clinic_meet_week_(clinic_ts_date_(c.ts), c.slot) = now_week
       and (not per_teacher or trim(c.teacher) = tch);
    if not me_in and n_cnt >= 9 then
      return jsonb_build_object('result','full','slot',v_slot,'cap',9);
    end if;
  end if;
  reqs := coalesce(p->'requests','[]'::jsonb);
  if jsonb_typeof(reqs) <> 'array' or jsonb_array_length(reqs) = 0 then
    reqs := '[{"type":"","area":"","content":"","count":""}]'::jsonb;
  end if;
  for r in select * from jsonb_array_elements(reqs) loop
    insert into clinic_requests (ts,name,school,phone,slot,rtype,area,content,qcount,memo,grade,student_id,teacher,token,clear)
    values (ts_now, nm, sc, ph, v_slot,
            coalesce(r->>'type',''), coalesce(r->>'area',''), coalesce(r->>'content',''),
            coalesce(r->>'count',''), coalesce(p->>'memo',''), gk,
            coalesce(p->>'studentId',''), coalesce(p->>'teacher',''), coalesce(p->>'token',''), '');
    saved := saved + 1;
  end loop;
  return jsonb_build_object('result','success','saved',saved);
end $$;

-- ── 권한: 학생 폼(공개 키)은 이 두 함수만 부를 수 있다 ─────────
revoke all on function public.clinic_form() from public;
revoke all on function public.clinic_submit(jsonb) from public;
revoke all on function public.clinic_grade_token_(text) from public;
revoke all on function public.clinic_school_loose_(text, text) from public;
revoke all on function public.clinic_week_key_(date) from public;
revoke all on function public.clinic_meet_week_(date, text) from public;
revoke all on function public.clinic_ts_date_(text) from public;
revoke all on function public.clinic_grade_tokens_(jsonb) from public;
revoke all on function public.clinic_eligible_(jsonb, text, text, text) from public;
revoke all on function public.clinic_setting_(text) from public;
grant execute on function public.clinic_form() to anon, authenticated;
grant execute on function public.clinic_submit(jsonb) to anon, authenticated;
