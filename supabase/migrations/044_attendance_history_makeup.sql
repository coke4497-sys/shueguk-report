-- ============================================================
-- 044: 학생 출석 기록의 '보충 완료' 판정 고침 (2026-10-06 원장님 "고1 박소율 친구의 보충은 진행된 것이 반영되지 않은 것 같아요")
--
--   041 은 attendance.makeup_done 이 '완료'일 때만 보충 완료로 봤는데, 시간표 페이지(결석자 관리)는
--   완료를 '1' 로 저장한다(timetable.html — makeup_done === '1'). 실제 데이터도 결석 151건 중 완료 124건이 전부 '1',
--   '완료'는 0건이라 학생 페이지에서 모든 결석이 '보충 전'으로 보였다. 판정을 '1'·'완료'·TRUE·Y 로 넓힌다.
--   그 밖의 본문은 041 그대로(함수를 통째로 다시 만든다).
-- ============================================================

create or replace function public.attendance_history(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        v_key text := btrim(coalesce(p->>'key',''));
        v_sid text := btrim(coalesce(p->>'student',''));
        v_before date;
        v_names text[];
        v_items jsonb;
        v_more boolean;
        v_counts jsonb;
begin
  if v_key <> '' then
    select * into me from public.students where code = v_key order by seq, id limit 1;
  elsif v_sid <> '' then
    select * into me from public.students where student_id = v_sid order by seq, id limit 1;
  end if;
  if me.id is null or btrim(coalesce(me.code,'')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  begin v_before := nullif(p->>'before','')::date; exception when others then v_before := null; end;
  v_names := array[me.name, me.name || 'A', case when right(me.name,1) = 'A' then left(me.name,-1) else me.name end];

  with mine as (
    select a.id, a.date, a.book, a.class_id, a.status, a.makeup_done
      from public.attendance a
     where public.ch_plain_(a.student) = any(v_names) and public.ch_who_(a.student) = me.id
  ), cnt as (
    select jsonb_build_object('출석', count(*) filter (where status = '출석'),
                              '지각', count(*) filter (where status = '지각'),
                              '결석', count(*) filter (where status = '결석')) as j
      from mine
  ), pg as (
    select m.*, c.name as cls, c.day, c.start_time,
           row_number() over (order by m.date desc, c.start_time desc nulls last, m.id desc) as rn
      from mine m
      left join public.tt_classes c on c.book = m.book and c.class_id = m.class_id
     where v_before is null or m.date < v_before
     order by m.date desc, c.start_time desc nulls last, m.id desc
     limit 121
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
           'ymd', g.date, 'book', g.book, 'class_id', g.class_id, 'cls', coalesce(g.cls, ''),
           'day', coalesce(g.day, ''), 'time', coalesce(g.start_time, ''), 'status', g.status,
           'makeup', case when g.status = '결석' then btrim(coalesce(g.makeup_done,'')) in ('1','완료','TRUE','true','Y','y') end)
           order by g.rn) from pg g where g.rn <= 120), '[]'::jsonb),
         (select count(*) > 120 from pg),
         (select j from cnt)
    into v_items, v_more, v_counts;

  return jsonb_build_object('ok', true, 'items', v_items, 'more', coalesce(v_more, false), 'counts', v_counts);
end $$;

revoke all on function public.attendance_history(jsonb) from public;
grant execute on function public.attendance_history(jsonb) to anon, authenticated;
