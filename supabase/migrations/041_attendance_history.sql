-- ============================================================
-- 041: 학생 페이지 '수업 리포트'에 출석·지각 내역 (2026-10-01 사용자 "학습이력에 출석 지각 내역도 기록하고 싶어요")
--
--   · attendance_history(p {key|student, before?}) — 공개 키 허용. 그 학생의 출석 기록(attendance)을
--     날짜 내림차순 120개씩(before 날짜보다 앞). 리포트가 공개되지 않은 수업의 출석도 모두 나온다.
--     내보내는 것: 날짜·시간표·반ID·반이름·요일·시작 시간·상태(출석/지각/결석)·결석 보충 완료 여부.
--     **출석 메모·보충 계획·보충 메모는 내보내지 않는다**(039 와 같은 방침 — 선생님 메모가 그대로 학생에게 가지 않게).
--   · counts = 전체 기간 상태별 건수 {출석, 지각, 결석} — 요약 칸용(페이지를 넘겨도 같은 값).
--   · 이름 대조는 class_history(039)와 같은 ch_plain_/ch_who_ 규칙(앞뒤 괄호 떼고 → 끝의 A → A 붙여서, 동명이인은 앞 괄호 학교).
--   · 반이름은 tt_classes 에서(지워진 '이 주만' 반은 빈 값 — 화면이 '수업'으로 적는다).
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
           'makeup', case when g.status = '결석' then btrim(coalesce(g.makeup_done,'')) = '완료' end)
           order by g.rn) from pg g where g.rn <= 120), '[]'::jsonb),
         (select count(*) > 120 from pg),
         (select j from cnt)
    into v_items, v_more, v_counts;

  return jsonb_build_object('ok', true, 'items', v_items, 'more', coalesce(v_more, false), 'counts', v_counts);
end $$;

revoke all on function public.attendance_history(jsonb) from public;
grant execute on function public.attendance_history(jsonb) to anon, authenticated;
