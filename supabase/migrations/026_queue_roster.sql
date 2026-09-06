-- 026: 질문 대기열 '명단' 상태 (2026-09-06 사용자 요청 "여러 반을 불러와서 화면에 켜놓고 학생들이 질문 대기 버튼을
--      누르거나 교사가 설정할 수 있었으면")
-- 교사가 [반 전체 불러오기]→[명단으로 올리기]를 하면 그 반 학생들이 **'명단'** 상태로 들어간다 — 예약(클리닉 신청)과
-- 마찬가지로 순서에는 없고, 전자칠판·학생 페이지에서 학생이 자기 이름/[질문 대기]를 누르거나 교사가 [줄 세우기]를 하면
-- 그 시각으로 '대기'가 된다. 여러 반을 차례로 올려 둘 수 있다(같은 학생이 이미 예약/명단/대기/호출이면 안 넣음 — 화면이 거른다).
-- 상태 값은 이제 일곱: 예약 / 명단 / 대기 / 호출 / 완료 / 취소 / 건너뜀.
-- 여기서는 함수 셋만 넓힌다: qq_arrive(예약뿐 아니라 명단도 도착 처리), qq_submit(명단이 있으면 도착 처리로 합침),
-- clinic_queue_add_(명단이 있으면 예약을 따로 만들지 않음).

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
   where id = qid and student_id = sid and trim(name) = nm and status in ('예약','명단') and qdate = qq_today_();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n > 0, 'position', qq_position_(qid));
end $$;

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
     and status in ('예약','명단','대기','호출')
   order by case status when '예약' then 0 when '명단' then 0 else 1 end, id limit 1;
  if ex.id is not null and ex.status in ('예약','명단') then
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
  if exists (select 1 from question_queue q where q.qdate = qd and q.teacher = tch and q.status in ('예약','명단','대기','호출')
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

grant execute on function public.qq_arrive(jsonb) to anon, authenticated;
grant execute on function public.qq_submit(jsonb) to anon, authenticated;
