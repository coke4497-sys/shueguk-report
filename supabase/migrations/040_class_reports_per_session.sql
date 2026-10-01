-- ============================================================
-- 040: 주간 리포트 + 학습 이력 → '수업 리포트' 하나로 (2026-10-01 사용자 "주간 리포트 기능을 아직 생성하지 않았으니
--      수업 리포트 기능과 합쳐져야 해요" → 결정: 글은 클로슈가 다듬어 씀 · 수업마다 카드 한 장 · 기간 제한 없이 누적)
--
--   · class_reports 를 **학생 × 수업 한 번** 한 줄로 바꾼다(그전: 학생 × 주차 한 장). 2026-10-01 기준 0건이라 그대로 바꾼다.
--     유일 조건 (week, code) → (book, class_id, ymd, code). week 는 그 수업의 주차 수요일(표시·정렬용으로 남김).
--     body = { attend, attend_note, attitude, summary, units[], homework[], hw, comment }
--       hw = { items:[{name,score,max}], pct, missing, missing_items[], text } | { none:true, text } | null
--   · class_history(p {key|student, before?}) — 학생 페이지 '수업 리포트'. 공개(published)된 것만 날짜 내림차순 60개씩.
--     (039 의 '선생님 기록 그대로' 판은 이 정의로 바뀐다 — 클로슈가 쓴 글만 학생에게 간다)
--   · class_report_list(주간 리포트) 함수는 지운다(학생 페이지 카드도 없앴다).
-- ============================================================

alter table public.class_reports add column if not exists class_id   text not null default '';
alter table public.class_reports add column if not exists ymd        date;
alter table public.class_reports add column if not exists part       text not null default '';
alter table public.class_reports add column if not exists class_name text not null default '';
alter table public.class_reports add column if not exists teacher    text not null default '';
alter table public.class_reports add column if not exists class_time text not null default '';

do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con
           where con.conrelid = 'public.class_reports'::regclass and con.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                  where a.attrelid = con.conrelid and a.attnum = any(con.conkey)) = array['code','week']
  loop
    execute format('alter table public.class_reports drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'class_reports_session_key') then
    alter table public.class_reports add constraint class_reports_session_key unique (book, class_id, ymd, code);
  end if;
end $$;
create index if not exists class_reports_code_ymd_idx on public.class_reports (code, ymd desc);

drop function if exists public.class_report_list(jsonb);

create or replace function public.class_history(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        v_key text := btrim(coalesce(p->>'key',''));
        v_sid text := btrim(coalesce(p->>'student',''));
        v_before date;
        v_items jsonb;
        v_more boolean;
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

  with mine as (
    select r.* , row_number() over (order by r.ymd desc, r.class_time desc, r.id desc) as rn
      from public.class_reports r
     where r.code = me.code and r.published and r.ymd is not null and r.class_id <> ''
       and (v_before is null or r.ymd < v_before)
     order by r.ymd desc, r.class_time desc, r.id desc
     limit 61
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ymd', m.ymd, 'book', m.book, 'part', m.part, 'cls', m.class_name, 'teacher', m.teacher,
           'time', m.class_time, 'body', m.body, 'at', m.updated_at)
           order by m.rn) filter (where m.rn <= 60), '[]'::jsonb),
         count(*) > 60
    into v_items, v_more
    from mine m;

  return jsonb_build_object('ok', true, 'items', v_items, 'more', coalesce(v_more, false));
end $$;

revoke all on function public.class_history(jsonb) from public;
grant execute on function public.class_history(jsonb) to anon, authenticated;
