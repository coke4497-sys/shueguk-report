-- 025: 클리닉 신청 → 그날 질문 대기열 '예약' 등록 + 도착 처리 (2026-09-06 사용자 결정 "모든 요청" + 사진 첨부)
-- 학생이 클리닉을 신청하면(clinic_submit) 그 클리닉 날짜의 담당 강사 대기열(question_queue)에 한 줄이
-- **'예약' 상태**로 들어간다 — 학생이 두 번 적지 않아도 되지만, **순서에는 아직 들어가지 않는다**
-- (사용자 조건 "클리닉 신청을 했지만 학원에 아직 도착하지 않았다면 먼저 온 친구가 질문 1번을 받아야 해요").
-- 학생이 학원에 와서 학생 페이지 [도착했어요](qq_arrive)를 누르거나 선생님이 [도착]을 누르면 그 순간
-- '대기'가 되고 ord = 도착 시각 → 먼저 온 친구가 앞. 당일 '질문하기'로 올리면(qq_submit) 예약이 있을 때
-- 새 줄을 만들지 않고 그 예약을 도착 처리한다.
--   · qdate  = 클리닉 만남 날짜(시간대 앞 요일 글자로 오늘 또는 다음 그 요일 — clinic_meet_date_)
--   · qtime  = 시간대 시작 시각 'HH:MM' (clinic_slot_hm_ — '목 저녁 5:30–7:00' → 17:30) — 도착하면 도착 시각으로 바뀐다
--   · ord    = 그날 그 시각의 epoch ms (표시용 — 도착 때 지금 시각 ms로 바뀐다)
--   · unit   = 요청 영역들(중복 제거, ', '), text = 요청마다 '· 유형 · 영역 — 내용 (개수)' 한 줄 + 메모
--   · photo  = 신청 폼의 사진(data URL, 선택) — clinic_requests에는 넣지 않는다
--   · clinic_id = 그 신청의 첫 clinic_requests 행 id (on delete cascade — 신청 행을 지우면 대기열 줄도 사라진다)
-- 같은 학생이 같은 선생님께 그 날짜에 이미 예약/대기/호출 중인 줄이 있으면 새로 넣지 않는다.
-- 상태 값은 024의 다섯 가지에 '예약'이 더해져 여섯: 예약 / 대기 / 호출 / 완료 / 취소 / 건너뜀.
-- 옛 경로 폴백(앱스스크립트 → mirror_clinic_requests)으로 들어온 신청은 대기열에 안 들어간다(드묾 — 당일 '질문하기'로 보완).

alter table question_queue add column if not exists clinic_id bigint references clinic_requests(id) on delete cascade;
create index if not exists question_queue_clinic_idx on question_queue (clinic_id);

-- 시간대 문구에서 시작 시각 → 'HH:MM'. 12시간 표기라 1~9시는 오후로(시간표 표기 규칙과 동일), '오전'이 있으면 그대로,
-- '밤'이 붙은 10·11·12시는 22·23·24시. 시각을 못 찾으면 null.
create or replace function public.clinic_slot_hm_(slot text)
returns text language plpgsql immutable set search_path = public as $$
declare m text[]; h int; mi int; s text := coalesce(slot,'');
begin
  m := regexp_match(s, '(\d{1,2}):(\d{2})');
  if m is null then return null; end if;
  h := m[1]::int; mi := m[2]::int;
  if h > 23 or mi > 59 then return null; end if;
  if s like '%오전%' then null;
  elsif s like '%밤%' and h in (10,11,12) then h := h + 12;
  elsif h between 1 and 9 then h := h + 12;
  end if;
  if h = 24 then h := 0; end if;
  return lpad(h::text, 2, '0') || ':' || lpad(mi::text, 2, '0');
end $$;

-- 시간대 앞 요일 글자로 실제 클리닉 날짜(신청일 당일 또는 그 뒤 가장 가까운 그 요일). 요일이 없으면 신청일.
create or replace function public.clinic_meet_date_(d date, slot text)
returns date language plpgsql immutable set search_path = public as $$
declare wd int := position(substring(trim(coalesce(slot,'')) from 1 for 1) in '일월화수목금토') - 1;
begin
  if d is null then return null; end if;
  if wd < 0 then return d; end if;
  return d + ((wd - extract(dow from d)::int + 7) % 7);
end $$;

-- 신청 한 건(요청 여러 장)을 대기열 한 줄로. 이미 그 날짜·선생님께 열린 줄이 있으면 넣지 않는다(null 반환).
create or replace function public.clinic_queue_add_(p jsonb, reqs jsonb, first_id bigint, v_slot text, gk text, today date)
returns bigint language plpgsql set search_path = public as $$
declare nm text := trim(coalesce(p->>'name',''));
        sid text := trim(coalesce(p->>'studentId',''));
        tch text := trim(coalesce(p->>'teacher',''));
        ph text := coalesce(p->>'photo','');
        qd date; qt text; v_ord bigint; un text; tx text; r jsonb; line text; nid bigint;
begin
  if tch = '' then return null; end if;
  qd := clinic_meet_date_(today, v_slot);
  qt := coalesce(clinic_slot_hm_(v_slot), to_char(now() at time zone 'Asia/Seoul', 'HH24:MI'));
  if exists (select 1 from question_queue q where q.qdate = qd and q.teacher = tch and q.status in ('예약','대기','호출')
                and ((sid <> '' and q.student_id = sid) or (sid = '' and trim(q.name) = nm and q.student_id = ''))) then
    return null;
  end if;
  select string_agg(distinct a, ', ') into un
    from (select trim(x->>'area') as a from jsonb_array_elements(reqs) x) s where a <> '';
  tx := '';
  for r in select * from jsonb_array_elements(reqs) loop
    line := concat_ws(' · ', nullif(trim(coalesce(r->>'type','')),''), nullif(trim(coalesce(r->>'area','')),''));
    if trim(coalesce(r->>'content','')) <> '' then
      line := line || case when line <> '' then ' — ' else '' end || trim(r->>'content');
    end if;
    if trim(coalesce(r->>'count','')) <> '' then line := line || ' (' || trim(r->>'count') || ')'; end if;
    if line <> '' then tx := tx || case when tx <> '' then E'\n' else '' end || '· ' || line; end if;
  end loop;
  if trim(coalesce(p->>'memo','')) <> '' then
    tx := tx || case when tx <> '' then E'\n' else '' end || '메모: ' || trim(p->>'memo');
  end if;
  if ph <> '' and (ph not like 'data:image/%' or length(ph) > 1200000) then ph := ''; end if;
  v_ord := (extract(epoch from ((qd::text || ' ' || qt)::timestamp at time zone 'Asia/Seoul')) * 1000)::bigint;
  insert into question_queue (qdate, ord, name, school, grade, student_id, teacher, qtime, unit, text, photo, clinic_id, status)
  values (qd, v_ord, nm, trim(coalesce(p->>'school','')), coalesce(gk,''), sid, tch, qt,
          left(coalesce(un,''), 100), left(tx, 1000), ph, first_id, '예약')
  returning id into nid;
  return nid;
end $$;

-- ── 제출 (019의 clinic_submit + 대기열 등록) ─────────────────────
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
        reqs jsonb; r jsonb; saved int := 0; first_id bigint; cur_id bigint; qid bigint;
begin
  perform pg_advisory_xact_lock(hashtext('clinic_submit'));
  per_teacher := jsonb_array_length(v_teachers) > 0;
  if not v_open then return jsonb_build_object('result','closed'); end if;
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
            coalesce(p->>'studentId',''), coalesce(p->>'teacher',''), coalesce(p->>'token',''), '')
    returning id into cur_id;
    if first_id is null then first_id := cur_id; end if;
    saved := saved + 1;
  end loop;
  -- 질문 대기열에도 한 줄 (실패해도 신청은 이미 저장됐으므로 삼킨다)
  begin
    qid := clinic_queue_add_(p, reqs, first_id, v_slot, gk, today);
  exception when others then qid := null; raise notice 'clinic_queue_add_ 실패: %', sqlerrm;
  end;
  return jsonb_build_object('result','success','saved',saved,'queueId',qid);
end $$;

-- 학생 화면용 JSON에 '클리닉 신청에서 온 줄' 표시를 더한다(024 재정의)
create or replace function public.qq_row_json_(r question_queue)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'teacher', r.teacher,
    'qtime', r.qtime,
    'unit', r.unit,
    'text', r.text,
    'hasPhoto', r.photo <> '',
    'status', r.status,
    'clinic', r.clinic_id is not null,
    'position', qq_position_(r.id),
    'time', to_char(r.created_at at time zone 'Asia/Seoul', 'HH24:MI'),
    'calledAt', case when r.called_at is null then null else to_char(r.called_at at time zone 'Asia/Seoul', 'HH24:MI') end,
    'doneAt', case when r.done_at is null then null else to_char(r.done_at at time zone 'Asia/Seoul', 'HH24:MI') end
  );
$$;

-- ── 도착 처리 (학생 페이지 [도착했어요]) ─────────────────────────
-- p: {id, name, student_id} → {ok:true, changed, position}  — '예약'인 내 줄을 '대기'로, ord·qtime = 지금
create or replace function public.qq_arrive(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p->>'name',''));
        sid text := trim(coalesce(p->>'student_id',''));
        qid bigint := nullif(p->>'id','')::bigint;
        n int;
begin
  if qid is null then return jsonb_build_object('ok', false, 'error', 'no_id'); end if;
  if not qq_student_ok_(nm, sid) then return jsonb_build_object('ok', false, 'error', 'unknown_student'); end if;
  update question_queue
     set status = '대기',
         ord = (extract(epoch from clock_timestamp()) * 1000)::bigint,
         qtime = to_char(now() at time zone 'Asia/Seoul', 'HH24:MI')
   where id = qid and student_id = sid and trim(name) = nm and status = '예약' and qdate = qq_today_();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n > 0, 'position', qq_position_(qid));
end $$;

-- ── 질문 올리기 (024 + 예약 도착 처리) ─────────────────────────
-- 그 선생님께 오늘 '예약'(클리닉 신청) 줄이 있으면 새 줄 대신 그 줄을 도착 처리한다:
-- 상태 대기, ord·qtime = 학생이 확인한 질문 타임, 새로 적은 글·단원·사진은 덧붙인다. 응답에 arrived:true.
create or replace function public.qq_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p->>'name',''));
        sid text := trim(coalesce(p->>'student_id',''));
        tc text := trim(coalesce(p->>'teacher',''));
        qt text := trim(coalesce(p->>'qtime',''));
        un text := trim(coalesce(p->>'unit',''));
        tx text := trim(coalesce(p->>'text',''));
        ph text := coalesce(p->>'photo','');
        ex question_queue; nid bigint; v_ord bigint;
begin
  if not qq_student_ok_(nm, sid) then return jsonb_build_object('ok', false, 'error', 'unknown_student'); end if;
  if tc = '' then return jsonb_build_object('ok', false, 'error', 'no_teacher'); end if;
  if qt = '' then qt := to_char(now() at time zone 'Asia/Seoul', 'HH24:MI'); end if;
  if qt !~ '^\d{1,2}:\d{2}$' or split_part(qt,':',1)::int > 23 or split_part(qt,':',2)::int > 59 then
    return jsonb_build_object('ok', false, 'error', 'bad_time');
  end if;
  qt := lpad(split_part(qt,':',1), 2, '0') || ':' || split_part(qt,':',2);
  if length(un) > 100 then un := left(un, 100); end if;
  if ph <> '' and (ph not like 'data:image/%' or length(ph) > 1200000) then
    return jsonb_build_object('ok', false, 'error', 'photo_too_big');
  end if;
  v_ord := (extract(epoch from ((qq_today_()::text || ' ' || qt)::timestamp at time zone 'Asia/Seoul')) * 1000)::bigint;

  select * into ex from question_queue
   where qdate = qq_today_() and teacher = tc and student_id = sid and trim(name) = nm
     and status in ('예약','대기','호출')
   order by case status when '예약' then 0 else 1 end, id limit 1;
  if ex.id is not null and ex.status = '예약' then
    update question_queue
       set status = '대기', ord = v_ord, qtime = qt,
           unit = case when un <> '' and position(un in unit) = 0 then left(concat_ws(', ', nullif(unit,''), un), 100) else unit end,
           text = case when tx <> '' then left(concat_ws(E'\n', nullif(text,''), tx), 1000) else text end,
           photo = case when ph <> '' then ph else photo end
     where id = ex.id;
    return jsonb_build_object('ok', true, 'id', ex.id, 'position', qq_position_(ex.id), 'status', '대기', 'arrived', true);
  end if;
  if ex.id is not null then
    return jsonb_build_object('ok', true, 'id', ex.id, 'position', qq_position_(ex.id), 'status', ex.status, 'dup', true);
  end if;
  if tx = '' and ph = '' then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  if length(tx) > 1000 then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;

  insert into question_queue (ord, name, school, grade, student_id, teacher, qtime, unit, text, photo)
  values (v_ord, nm, trim(coalesce(p->>'school','')), trim(coalesce(p->>'grade','')), sid, tc, qt, un, tx, ph)
  returning id into nid;

  update question_queue set photo = '' where photo <> '' and qdate < qq_today_() - 7;

  return jsonb_build_object('ok', true, 'id', nid, 'position', qq_position_(nid), 'status', '대기');
end $$;

grant execute on function public.qq_arrive(jsonb) to anon, authenticated;
revoke all on function public.clinic_slot_hm_(text) from public;
revoke all on function public.clinic_meet_date_(date, text) from public;
revoke all on function public.clinic_queue_add_(jsonb, jsonb, bigint, text, text, date) from public;
grant execute on function public.clinic_submit(jsonb) to anon, authenticated;
