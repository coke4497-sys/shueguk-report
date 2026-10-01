-- ============================================================
-- 039: 학생 페이지 '학습 이력' — 선생님이 [수업 기록] 창에 적은 기록을 수업마다 쌓아 보여 준다
--      (2026-10-01 사용자 요청 "오늘 수업의 내용과 과제 수행 그리고 수업 태도 등을 교사가 작성한 수업 기록에서
--       받아서 그 누적 기록을 보여주고 싶습니다" → 결정: 태도 = 3단계 알약(매우 좋음/좋음/노력 필요),
--       공개 시점 = [리포트 생성]을 누른 수업만(requested_at 있음 — 저장만 한 수업은 안 보인다))
--
--   · 과제마다 미제출(2026-10-01 같은 날 사용자 "과제를 부여하면 미제출 기록 기능이 과제마다 있어야 함"):
--     hwcheck_records.missing_items = 미제출로 표시한 과제 이름 목록. 그 과제의 학습량·깊이는 0점으로 저장되고,
--     missing(옛 '미제출 = 0%')은 **모든 과제가 미제출**일 때만 참 — 일부만 빠지면 %는 남은 과제 점수로 센다.
--   · 전체 미제출인데 코멘트가 비면 comment = '<이름> 친구는 과제 제출을 하지 않았습니다!!!!'(사용자 지정 문구, 저장값에는 안 넣음).
--   · 수업 태도는 새 열 없이 class_notes.comments 의 예약 키 '__태도' = {학생이름(괄호 뗀 것): 단계} 로 둔다
--     ('__검사과제'와 같은 방식 — 마이그레이션 전에도 선생님 창 저장이 깨지지 않게).
--   · class_history(p {key|student, before?}) — 공개 키 허용. 그 학생이 들은 수업(출석 기록 또는 그 수업 과제 검사 기록)
--     최근 60개(before 날짜보다 앞)를 날짜 내림차순으로. 비공개 메모(priv)·미제출 대책(plan)·출석 메모는 내보내지 않는다.
--   · 출석 이름 대조는 class_report.py find_student 와 같은 규칙(앞뒤 괄호 떼고 정확히 → 끝의 A 떼고 → A 붙여서,
--     동명이인은 앞 괄호 학교로). 한 사람으로 못 가리면 그 출석 기록은 쓰지 않는다.
-- ============================================================

alter table public.hwcheck_records add column if not exists missing_items jsonb not null default '[]'::jsonb;

create or replace function public.ch_plain_(s text)
returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(s,''), '^\s*\([^)]*\)\s*', ''), '\(.*\)\s*$', ''))
$$;

-- 시간표·출석 이름 하나 → 재원생 id(못 가리면 null)
create or replace function public.ch_who_(tok text)
returns bigint language plpgsql stable set search_path = public as $$
declare p text := public.ch_plain_(tok);
        sch text := coalesce(substring(coalesce(tok,'') from '^\s*\(([^)]*)\)'), '');
        ids bigint[];
begin
  if p = '' then return null; end if;
  select array_agg(id) into ids from public.students s
   where s.name = p and btrim(coalesce(s.enrolled,'')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';
  if ids is null and right(p, 1) = 'A' then
    select array_agg(id) into ids from public.students s
     where s.name = left(p, -1) and btrim(coalesce(s.enrolled,'')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';
  end if;
  if ids is null then
    select array_agg(id) into ids from public.students s
     where s.name = p || 'A' and btrim(coalesce(s.enrolled,'')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';
  end if;
  if ids is null then return null; end if;
  if array_length(ids, 1) > 1 and sch <> '' then
    select coalesce(array_agg(id), ids) into ids from public.students s
     where s.id = any(ids) and s.school like sch || '%';
  end if;
  if array_length(ids, 1) = 1 then return ids[1]; end if;
  return null;
end $$;

create or replace function public.class_history(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        v_key text := btrim(coalesce(p->>'key',''));
        v_sid text := btrim(coalesce(p->>'student',''));
        v_before date;
        v_names text[];
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
  v_names := array[me.name, me.name || 'A', case when right(me.name,1) = 'A' then left(me.name,-1) else me.name end];

  with notes as (
    select n.* from public.class_notes n
     where n.requested_at is not null
       and (v_before is null or n.ymd < v_before)
  ), att as (     -- 그 수업에 내 출석 기록
    select distinct on (n.id) n.id as nid, a.status, a.student
      from notes n
      join public.attendance a on a.book = n.book and a.class_id = n.class_id and a.date = n.ymd
     where public.ch_plain_(a.student) = any(v_names) and public.ch_who_(a.student) = me.id
     order by n.id, a.updated_at desc
  ), hw as (      -- 그 수업 과제 검사(주차 = 가장 최근 수요일)
    select distinct on (n.id) n.id as nid, h.scores, h.max, h.pct, h.missing, h.pub, h.missing_items
      from notes n
      join public.hwcheck_records h on h.token = me.code and h.class_id = n.class_id
                                   and h.week = n.ymd - ((extract(dow from n.ymd)::int + 4) % 7)
     order by n.id, h.at desc
  ), mine as (
    select n.*, att.status as att_status, att.student as att_name,
           hw.scores, hw.max as hw_max, hw.pct as hw_pct, hw.missing as hw_missing, hw.pub as hw_pub, hw.missing_items as hw_miss_items,
           (hw.nid is not null) as has_hw
      from notes n
      left join att on att.nid = n.id
      left join hw on hw.nid = n.id
     where att.nid is not null or hw.nid is not null
     order by n.ymd desc, n.class_time desc
     limit 61
  )
  select coalesce(jsonb_agg(x.j order by x.ymd desc, x.class_time desc) filter (where x.rn <= 60), '[]'::jsonb),
         count(*) > 60
    into v_items, v_more
    from (
      select m.ymd, m.class_time, row_number() over (order by m.ymd desc, m.class_time desc) as rn,
        jsonb_build_object(
          'ymd', m.ymd, 'book', m.book, 'part', m.part, 'cls', m.class_name, 'teacher', m.teacher, 'time', m.class_time,
          'progress', m.progress, 'units', coalesce(m.units, '[]'::jsonb), 'homework', m.homework,
          'attend', coalesce(m.att_status, ''),
          -- 전체 미제출(missing 참)인데 코멘트가 비면 정해 둔 문장(2026-10-01 사용자 지정 — timetable crMissComment·class_report.py 와 같은 문장)
          'comment', coalesce(nullif(m.comments->>public.ch_plain_(m.att_name), ''), nullif(m.comments->>me.name, ''),
                              nullif(m.comments->>(me.name || 'A'), ''),
                              case when coalesce(m.hw_missing, false)
                                   then regexp_replace(me.name, '[A-Z]$', '') || ' 친구는 과제 제출을 하지 않았습니다!!!!' end, ''),
          'attitude', coalesce(nullif(m.comments->'__태도'->>public.ch_plain_(m.att_name), ''), nullif(m.comments->'__태도'->>me.name, ''),
                               nullif(m.comments->'__태도'->>(me.name || 'A'), ''), ''),
          'hw', case when m.has_hw then jsonb_build_object('scores', m.scores, 'max', m.hw_max, 'pct', m.hw_pct,
                                                           'missing', m.hw_missing, 'missing_items', coalesce(m.hw_miss_items, '[]'::jsonb),
                                                           'text', m.hw_pub) end
        ) as j
      from mine m
    ) x;

  return jsonb_build_object('ok', true, 'items', v_items, 'more', coalesce(v_more, false));
end $$;

revoke all on function public.class_history(jsonb) from public;
grant execute on function public.class_history(jsonb) to anon, authenticated;
revoke all on function public.ch_who_(text) from public;
revoke all on function public.ch_plain_(text) from public;
grant execute on function public.ch_plain_(text) to authenticated;
