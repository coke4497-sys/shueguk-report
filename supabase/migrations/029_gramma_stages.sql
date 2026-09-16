-- ============================================================
-- 029: 문법 스테이지 게임 — 세트 클리어 별 · 플레이 점수 · 문법 슈스 탑30 (2026-09-16 사용자 결정)
--
-- 사용자 결정(2026-09-15~16): 스테이지(회차)는 정답률 70% 이상이면 통과, 스테이지 5개 = 세트 하나,
-- 세트 안 스테이지를 모두 통과하면 세트 클리어 → 슈퍼스타 별 +1. **회차마다 90% 이상 → 별 +1 규칙(027)은 폐지.**
-- 문법 슈스 탑30은 슈퍼스타 랭킹과 별개(클리어 스테이지 수 → 플레이 점수 순, 이름 그대로 표시).
--   · gramma_results  — mode('test' 전체 제출 / 'play' 플레이 모드)·points(플레이 점수) 열 추가
--   · gramma_sets     — 세트 클리어 기록(학생·카테고리·세트 번호 유일) = **별 집계의 원본**
--   · gramma_submit   — 결과 기록 + 통과 판정 + (세트 정보가 오면) 세트 클리어 판정·기록. 응답 {ok, pct, pass, set_cleared, set_first, stars}
--   · gramma_status   — 테스트별 최고 정답률(pass 포함) + 클리어한 세트 목록 + 별 수
--   · gramma_top      — 문법 슈스 탑30(전체/중등/고등, 이번 달) + 내 순위
--   · student_bundle  — 'gramma_sets' 항목 추가(학생 페이지 별 집계; 028 본문 그대로 + 한 항목)
-- 세트 구성(어느 회차가 몇 번 세트인지)은 페이지의 manifest(stage.js)가 정하고 요청에 실어 보낸다 —
-- 함수는 그 회차들의 최고 정답률이 전부 70% 이상인지만 확인한다. 공개 키는 함수만(015 규칙).
-- ============================================================

alter table public.gramma_results add column if not exists mode   text not null default 'test';
alter table public.gramma_results add column if not exists points int  not null default 0;

create table if not exists public.gramma_sets (
  id         bigint generated always as identity primary key,
  name       text not null default '',
  school     text not null default '',
  grade      text not null default '',
  phone8     text not null default '',
  unit       text not null default '',      -- 카테고리 라벨('한글 맞춤법')
  set_no     int  not null default 0,       -- 세트 번호(1부터)
  rounds     text not null default '',      -- 그 세트의 회차 목록('6,7,8,9,10') — 기록 당시 구성
  cleared_at timestamptz not null default now(),
  unique (name, phone8, unit, set_no)
);
create index if not exists gramma_sets_name_idx on public.gramma_sets (name);
alter table public.gramma_sets enable row level security;
drop policy if exists teacher_all on public.gramma_sets;
create policy teacher_all on public.gramma_sets for all to authenticated using (true) with check (true);
revoke all privileges on public.gramma_sets from anon;

-- 통과 기준(정답률 %) 한 곳
create or replace function public.gramma_pass_pct() returns int language sql immutable as $$ select 70 $$;

-- 결과 기록 + 통과 판정 + 세트 클리어 판정
--   p: time,name,school,grade,phone8,unit,round,score,got,total,details, mode('test'|'play'), points,
--      set: {"no": 2, "rounds": ["6","7","8","9","10"]}  (선택 — 있으면 이 회차들이 전부 통과됐는지 보고 세트 기록)
create or replace function public.gramma_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_got int := coalesce(nullif(trim(p->>'got'), '')::int, 0);
        v_total int := coalesce(nullif(trim(p->>'total'), '')::int, 0);
        v_pct int := 0;
        v_name text := trim(coalesce(p->>'name',''));
        v_phone text := regexp_replace(coalesce(p->>'phone8',''), '[^0-9]', '', 'g');
        v_unit text := trim(coalesce(p->>'unit',''));
        v_round text := trim(coalesce(p->>'round',''));
        v_ts text := coalesce(p->>'time','');
        v_mode text := case when coalesce(p->>'mode','') = 'play' then 'play' else 'test' end;
        v_points int := greatest(0, coalesce(nullif(trim(p->>'points'), '')::int, 0));
        v_set_no int := case when coalesce(p->'set'->>'no','') ~ '^\d+$' then (p->'set'->>'no')::int else null end;   -- 이상한 값은 세트 판정만 건너뜀
        v_rounds text[];
        v_missing int := 0;
        v_cleared boolean := false;
        v_first boolean := false;
        v_stars int := 0;
begin
  if v_name = '' or v_unit = '' or v_round = '' or v_total <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_pct := round(v_got::numeric * 100 / v_total);
  if v_ts !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}' then
    v_ts := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
  end if;
  insert into public.gramma_results (ts, name, school, grade, phone8, unit, round, score, got, total, pct, details, mode, points)
  values (v_ts, v_name, trim(coalesce(p->>'school','')), trim(coalesce(p->>'grade','')), v_phone,
          v_unit, v_round, coalesce(p->>'score', v_got || ' / ' || v_total), v_got, v_total, v_pct,
          left(coalesce(p->>'details',''), 20000), v_mode, v_points);

  -- 세트 판정: 요청에 실린 회차들이 전부(방금 것 포함) 최고 정답률 70% 이상이면 세트 클리어
  if v_set_no is not null and v_set_no >= 1 and jsonb_typeof(p->'set'->'rounds') = 'array' then
    select array_agg(trim(x)) into v_rounds from jsonb_array_elements_text(p->'set'->'rounds') x;
    if v_rounds is not null and array_length(v_rounds, 1) >= 1 then
      select count(*) into v_missing
        from unnest(v_rounds) r
       where not exists (select 1 from public.gramma_results g
                          where g.name = v_name and g.phone8 = v_phone and g.unit = v_unit
                            and g.round = r and g.pct >= public.gramma_pass_pct());
      if v_missing = 0 then
        v_cleared := true;
        insert into public.gramma_sets (name, school, grade, phone8, unit, set_no, rounds)
        values (v_name, trim(coalesce(p->>'school','')), trim(coalesce(p->>'grade','')), v_phone, v_unit, v_set_no, array_to_string(v_rounds, ','))
        on conflict (name, phone8, unit, set_no) do nothing;
        get diagnostics v_missing = row_count;   -- 1이면 이번에 처음 기록된 세트
        v_first := v_missing = 1;
      end if;
    end if;
  end if;
  select count(*) into v_stars from public.gramma_sets where name = v_name and phone8 = v_phone;
  return jsonb_build_object('ok', true, 'pct', v_pct, 'pass', v_pct >= public.gramma_pass_pct(),
                            'set_cleared', v_cleared, 'set_first', v_first, 'stars', v_stars);
end $$;

-- 학생 입구용: 테스트별 최고 정답률·통과 여부 + 클리어한 세트 + 별 수 (이름·8자리가 둘 다 맞아야)
create or replace function public.gramma_status(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name',''));
        v_phone text := regexp_replace(coalesce(p->>'phone8',''), '[^0-9]', '', 'g');
begin
  if v_name = '' or length(v_phone) <> 8 then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  return jsonb_build_object('ok', true,
    'pass_pct', public.gramma_pass_pct(),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'round', round, 'best', best, 'tries', tries,
                                                    'pass', best >= public.gramma_pass_pct(), 'points', points)
               order by unit, round), '[]'::jsonb)
        from (select unit, round, max(pct) as best, count(*) as tries, max(points) as points
                from public.gramma_results where name = v_name and phone8 = v_phone
               group by unit, round) s),
    'sets', (
      select coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'set_no', set_no) order by unit, set_no), '[]'::jsonb)
        from public.gramma_sets where name = v_name and phone8 = v_phone),
    'stars', (select count(*) from public.gramma_sets where name = v_name and phone8 = v_phone));
end $$;

-- 문법 슈스 탑30: 클리어 스테이지 수(최고 정답률 70% 이상인 테스트 수) → 플레이 점수(테스트마다 최고 점수의 합) 순.
--   p: {level: 'all'|'mid'|'high', month: 'YYYY-MM'(선택 — 그 달 제출만), name, phone8(선택 — 내 순위)}
--   응답 {ok, rows:[{rank,name,school,grade,stages,points,stars}] (30명), me:{rank,stages,points,stars}|null, total}
--   8자리는 응답에 담지 않는다. 학생·이름은 이름+8자리 단위로 묶는다(동명이인 구분).
create or replace function public.gramma_top(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_level text := coalesce(p->>'level','all');
        v_month text := coalesce(p->>'month','');
        v_name text := trim(coalesce(p->>'name',''));
        v_phone text := regexp_replace(coalesce(p->>'phone8',''), '[^0-9]', '', 'g');
        v_rows jsonb; v_me jsonb; v_total int;
begin
  if v_month !~ '^\d{4}-\d{2}$' then v_month := ''; end if;
  create temp table if not exists _gt (rank int, name text, phone8 text, school text, grade text, stages int, points int, stars int) on commit drop;
  delete from _gt;
  insert into _gt
  with agg as (
    select b.name, b.phone8,
           (select g2.school from public.gramma_results g2 where g2.name = b.name and g2.phone8 = b.phone8 and g2.school <> '' order by g2.id desc limit 1) as school,
           (select g2.grade  from public.gramma_results g2 where g2.name = b.name and g2.phone8 = b.phone8 and g2.grade  <> '' order by g2.id desc limit 1) as grade,
           count(*) filter (where b.best >= public.gramma_pass_pct())::int as stages,
           coalesce(sum(b.points), 0)::int as points,
           (select count(*)::int from public.gramma_sets s where s.name = b.name and s.phone8 = b.phone8
               and (v_month = '' or to_char(s.cleared_at at time zone 'Asia/Seoul', 'YYYY-MM') = v_month)) as stars
      from (select name, phone8, unit, round, max(pct) as best, max(points) as points
              from public.gramma_results
             where name <> '' and (v_month = '' or left(ts, 7) = v_month)
             group by name, phone8, unit, round) b
     group by b.name, b.phone8),
  lv as (
    select * from agg
     where (v_level = 'mid' and coalesce(grade,'') like '중%') or (v_level = 'high' and coalesce(grade,'') like '고%') or (v_level not in ('mid','high')))
  select row_number() over (order by stages desc, points desc, name, phone8)::int as rank,
         name, phone8, coalesce(school,''), coalesce(grade,''), stages, points, stars
    from lv;
  select count(*) into v_total from _gt;
  select coalesce(jsonb_agg(jsonb_build_object('rank', rank, 'name', name, 'school', school, 'grade', grade,
                                                'stages', stages, 'points', points, 'stars', stars) order by rank), '[]'::jsonb)
    into v_rows from _gt where rank <= 30;
  if v_name <> '' and length(v_phone) = 8 then
    select jsonb_build_object('rank', rank, 'stages', stages, 'points', points, 'stars', stars) into v_me
      from _gt where name = v_name and phone8 = v_phone limit 1;
  end if;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'me', v_me, 'total', v_total, 'pass_pct', public.gramma_pass_pct());
end $$;

revoke all on function public.gramma_submit(jsonb) from public;
revoke all on function public.gramma_status(jsonb) from public;
revoke all on function public.gramma_top(jsonb) from public;
grant execute on function public.gramma_submit(jsonb) to anon, authenticated;
grant execute on function public.gramma_status(jsonb) to anon, authenticated;
grant execute on function public.gramma_top(jsonb) to anon, authenticated;

-- student_bundle: 028 본문 그대로 + 'gramma_sets' 항목 (학생 페이지 별 집계 = 세트 클리어 수)
create or replace function public.student_bundle(
  p_key text,
  p_is_id boolean default false,
  p_pw text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me      public.students%rowtype;
  v_key   text := coalesce(p_key, '');
  v_code  text;
  v_sid   text;
  v_name  text;
  v_base  text;
  v_authed boolean;
  v_share int := 0;
  v_dup   int := 0;
begin
  if btrim(v_key) = '' then
    return jsonb_build_object('found', false);
  end if;

  if coalesce(p_is_id, false) then
    select * into me from public.students where student_id = v_key order by seq, id limit 1;
  else
    select * into me from public.students where code = v_key order by seq, id limit 1;
  end if;
  if me.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- 학생ID로 연 경우 접근코드는 빈값으로 둔다(연결부의 `key = isId ? '' : qsKey` 와 동일)
  v_code   := case when coalesce(p_is_id, false) then '' else v_key end;
  v_sid    := btrim(coalesce(me.student_id, ''));
  v_name   := btrim(coalesce(me.name, ''));
  v_base   := regexp_replace(v_name, '[A-Za-z]$', '');
  v_authed := (coalesce(p_pw, '') <> '' and p_pw = v_sid);

  -- 형제 수: 같은 학생ID를 쓰는 학생 수 (연결부와 같이 빈 학생ID도 그대로 센다)
  select count(*) into v_share
    from public.students
   where coalesce(student_id, '') = coalesce(me.student_id, '');

  -- 동명이인 수: 접미사만 다른 이름(baseName 일치) 중 재원생만
  select count(*) into v_dup
    from public.students
   where btrim(coalesce(name, '')) <> ''
     and regexp_replace(btrim(coalesce(name, '')), '[A-Za-z]$', '') = v_base
     and btrim(coalesce(enrolled, '')) !~* '^(퇴원|n|no|off|x|중단|비재원)$';

  return jsonb_build_object(
    'found', true,
    'me', jsonb_build_object(
      'student_id', me.student_id, 'name', me.name, 'school', me.school, 'grade', me.grade,
      'teacher', me.teacher, 'memo', me.memo, 'class_a', me.class_a, 'class_b', me.class_b,
      'naeshin_a', me.naeshin_a, 'naeshin_b', me.naeshin_b, 'enrolled', me.enrolled, 'code', me.code),
    'share_count', v_share,
    'name_dup_count', v_dup,

    'notices', (select coalesce(jsonb_agg(jsonb_build_object(
        'seq', seq, 'date', date, 'type', type, 'target', target,
        'title', title, 'body', body, 'hidden', hidden) order by seq, id), '[]'::jsonb)
      from public.notices),

    'notice_reads', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'name', name, 'school', school, 'notice_key', notice_key)
        order by at, id), '[]'::jsonb)
      from public.notice_reads
      where (v_sid <> '' and student_id = v_sid) or (v_name <> '' and name = v_name)),

    'assignments', (select coalesce(jsonb_agg(jsonb_build_object(
        'seq', seq, 'date', date, 'tool', tool, 'item', item,
        'type', type, 'target', target, 'due', due, 'memo', memo) order by seq, id), '[]'::jsonb)
      from public.assignments),

    'clinic_requests', (select coalesce(jsonb_agg(jsonb_build_object(
        'ts', ts, 'slot', slot, 'rtype', rtype, 'area', area, 'content', content,
        'qcount', qcount, 'memo', memo, 'student_id', student_id, 'token', token)
        order by id), '[]'::jsonb)
      from public.clinic_requests
      where (v_code <> '' and token = v_code) or (v_sid <> '' and student_id = v_sid)),

    'hwork_submissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'teacher', teacher, 'code', code, 'name', name, 'school', school, 'grade', grade)
        order by id), '[]'::jsonb)
      from public.hwork_submissions
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'voca_results', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'round', round, 'grade', grade, 'school', school) order by id), '[]'::jsonb)
      from public.voca_results
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'omr_responses', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'name', name, 'school', school, 'exam', exam, 'grade', grade)
        order by id), '[]'::jsonb)
      from public.omr_responses
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'hwcheck_records', (select coalesce(jsonb_agg(jsonb_build_object(
        'week', week, 'pct', pct, 'scores', scores, 'pub', pub, 'missing', missing)
        order by week), '[]'::jsonb)
      from public.hwcheck_records
      where v_code <> '' and token = v_code),

    'signup_entries', (select coalesce(jsonb_agg(jsonb_build_object(
        'ts', ts, 'name', name, 'school', school, 'student_id', student_id, 'day', day)
        order by id), '[]'::jsonb)
      from public.signup_entries
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'star_bonus', (select coalesce(jsonb_agg(jsonb_build_object(
        'at', at, 'student_id', student_id, 'name', name, 'school', school,
        'stars', stars, 'reason', reason, 'grade', grade) order by at, id), '[]'::jsonb)
      from public.star_bonus
      where (v_sid <> '' and student_id = v_sid) or (v_name <> '' and name = v_name)),

    'report_config', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.report_config),

    'submissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'submitted_at', submitted_at, 'exam', exam, 'school', school, 'grade', grade,
        'name', name, 'wrong_count', wrong_count, 'wrong_text', wrong_text, 'vow', vow,
        'teacher_note', teacher_note, 'score', score, 'parent_phone', parent_phone)
        order by id), '[]'::jsonb)
      from public.submissions
      where (v_sid <> '' and parent_phone = v_sid)
         or (v_name <> '' and name = v_name)
         or (v_base <> v_name and v_base <> '' and name = v_base)),

    'exams', (select coalesce(jsonb_agg(jsonb_build_object(
        'report_id', report_id, 'title', title, 'review', review, 'scope', scope)
        order by at, report_id), '[]'::jsonb)
      from public.exams),

    -- 문항은 비밀번호가 맞을 때만 — 예전에는 페이지가 판단해 조회를 건너뛰었다
    'exam_questions', case when v_authed then (select coalesce(jsonb_agg(jsonb_build_object(
        'report_id', report_id, 'no', no, 'area', area, 'qtype', qtype, 'lv', lv,
        'txt', txt, 'detail', detail, 'grp', grp, 'multi', multi) order by report_id, seq), '[]'::jsonb)
      from public.exam_questions) else '[]'::jsonb end,

    'clinic_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.clinic_settings),

    'gramma_results', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'school', school, 'grade', grade, 'phone8', phone8,
        'unit', unit, 'round', round, 'pct', pct) order by id), '[]'::jsonb)
      from public.gramma_results
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'gramma_sets', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'school', school, 'grade', grade, 'phone8', phone8,
        'unit', unit, 'set_no', set_no, 'cleared_at', cleared_at) order by id), '[]'::jsonb)
      from public.gramma_sets
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'signup_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.signup_settings)
  );
end $$;

revoke all on function public.student_bundle(text, boolean, text) from public;
grant execute on function public.student_bundle(text, boolean, text) to anon, authenticated;
