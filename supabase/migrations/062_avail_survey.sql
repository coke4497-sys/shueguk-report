-- ============================================================
-- 062: 시간표 조사 — 새 시간표로 바꿀 때 학생·학부모님이 '안 되는 시간'을 골라 제출
--      (2026-11-05 원장님 "시간표 배치를 위한 메뉴를 학생 페이지에 — 안 되는 시간을 모두 골라 제출하고
--       그 중에 가능한 시간으로 배치" → 결정: 표시 2단계(가능/안 돼요) · 학생과 학부모님이 응답 하나를 같이 고침 ·
--       제출하면 별 +1 · 대상은 전체·학년·학교·반·개인(여러 명))
--
--   · avail_surveys   — 조사 한 건. 후보 칸 slots = [{id:'수-5:30', day:'수', start:'5:30', end:'7:30'}],
--                       due = 마감일(한국 날짜, 그 날 밤까지 받음, 비면 마감 없음), open = 학생 화면에 보이는지.
--                       target = 고른 대상 명세(화면 표시·명단 다시 반영용 — 실제 대상은 avail_targets).
--   · avail_targets   — 대상 학생(조사·접근코드 유일). 만들 때 명단을 학생 한 명씩 풀어 넣는다(복습 영상과 같은 방식).
--   · avail_responses — 학생마다 응답 한 줄. no = 안 되는 칸 id 목록, memo, last_by '학생'|'학부모님'(마지막에 고친 분),
--                       submitted_at = 처음 낸 때(별 기준), updated_at = 마지막으로 고친 때.
--   · 학생 함수(anon): avail_mine(p {key|student}) — 나를 대상으로 열린 조사 + 내 응답
--                      avail_submit(p {key|student, survey, no[], memo, who}) — 대상·열림·마감·칸 id 확인, 처음이면 first.
--   · 별: 조사 하나 제출 = 별 1개(STAR_RULES.avail — s.html·superstar.html). student_bundle 에 avail_responses 항목.
--   · 표는 교사(authenticated)만, 공개 키는 함수만.
-- ============================================================

create table if not exists public.avail_surveys (
  id         bigserial primary key,
  title      text not null check (btrim(title) <> ''),
  memo       text not null default '',
  slots      jsonb not null default '[]'::jsonb,
  target     jsonb not null default '[]'::jsonb,
  due        date,
  open       boolean not null default false,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.avail_targets (
  id         bigserial primary key,
  survey_id  bigint not null references public.avail_surveys(id) on delete cascade,
  code       text not null check (btrim(code) <> ''),
  student_id text not null default '',
  name       text not null default '',
  school     text not null default '',
  grade      text not null default '',
  class_name text not null default '',
  unique (survey_id, code)
);

create table if not exists public.avail_responses (
  id         bigserial primary key,
  survey_id  bigint not null references public.avail_surveys(id) on delete cascade,
  code       text not null check (btrim(code) <> ''),
  student_id text not null default '',
  name       text not null default '',
  school     text not null default '',
  grade      text not null default '',
  no         jsonb not null default '[]'::jsonb,
  memo       text not null default '',
  last_by    text not null default '학생' check (last_by in ('학생','학부모님')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (survey_id, code)
);
create index if not exists avail_targets_code_idx on public.avail_targets (code);
create index if not exists avail_responses_code_idx on public.avail_responses (code);

do $$
declare t text;
begin
  foreach t in array array['avail_surveys','avail_targets','avail_responses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all privileges on public.%I from anon', t);
    execute format('revoke references, trigger, truncate on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.avail_surveys_id_seq, public.avail_targets_id_seq, public.avail_responses_id_seq to authenticated;

-- 한국 날짜 오늘
create or replace function public.avail_today_() returns date language sql stable as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create or replace function public.avail_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  return jsonb_build_object('ok', true, 'today', public.avail_today_(),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'memo', s.memo, 'slots', s.slots, 'due', s.due,
        'closed', (s.due is not null and s.due < public.avail_today_()),
        'response', case when r.id is null then null else jsonb_build_object(
            'no', r.no, 'memo', r.memo, 'last_by', r.last_by, 'at', r.submitted_at, 'updated_at', r.updated_at) end)
        order by s.id desc), '[]'::jsonb)
      from public.avail_surveys s
      join public.avail_targets t on t.survey_id = s.id and t.code = me.code
      left join public.avail_responses r on r.survey_id = s.id and r.code = me.code
     where s.open));
end $$;

create or replace function public.avail_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype; s public.avail_surveys%rowtype;
        v_ids text[]; v_no text[] := '{}'; v jsonb; x text; v_who text; v_first boolean; v_sid bigint;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  begin v_sid := (p->>'survey')::bigint; exception when others then return jsonb_build_object('ok', false, 'error', 'no_survey'); end;
  select * into s from public.avail_surveys where id = v_sid;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'no_survey'); end if;
  if not exists (select 1 from public.avail_targets where survey_id = s.id and code = me.code) then
    return jsonb_build_object('ok', false, 'error', 'not_target');
  end if;
  if not s.open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if s.due is not null and s.due < public.avail_today_() then return jsonb_build_object('ok', false, 'error', 'past_due'); end if;

  v_who := btrim(coalesce(p->>'who',''));
  if v_who not in ('학생','학부모님') then return jsonb_build_object('ok', false, 'error', 'no_who'); end if;

  select coalesce(array_agg(e->>'id'), '{}') into v_ids from jsonb_array_elements(coalesce(s.slots, '[]'::jsonb)) e;
  if p->'no' is not null and jsonb_typeof(p->'no') = 'array' then
    for v in select * from jsonb_array_elements(p->'no') loop
      x := v #>> '{}';
      if x is null or not x = any(v_ids) then return jsonb_build_object('ok', false, 'error', 'bad_slot'); end if;
      if not x = any(v_no) then v_no := v_no || x; end if;
    end loop;
  elsif p->'no' is not null and jsonb_typeof(p->'no') <> 'null' then
    return jsonb_build_object('ok', false, 'error', 'bad_slot');
  end if;
  -- 후보 칸 순서대로 정리
  select coalesce(jsonb_agg(i order by array_position(v_ids, i)), '[]'::jsonb) into v from unnest(v_no) i;

  v_first := not exists (select 1 from public.avail_responses where survey_id = s.id and code = me.code);
  insert into public.avail_responses as t (survey_id, code, student_id, name, school, grade, no, memo, last_by)
  values (s.id, me.code, coalesce(me.student_id,''), coalesce(me.name,''), coalesce(me.school,''), coalesce(me.grade,''),
          v, left(coalesce(p->>'memo',''), 500), v_who)
  on conflict (survey_id, code) do update
     set no = excluded.no, memo = excluded.memo, last_by = excluded.last_by, name = excluded.name,
         school = excluded.school, grade = excluded.grade, student_id = excluded.student_id, updated_at = now();
  return jsonb_build_object('ok', true, 'first', v_first, 'survey', s.id, 'no', v);
end $$;

revoke all on function public.avail_today_() from public;
revoke all on function public.avail_mine(jsonb) from public;
revoke all on function public.avail_submit(jsonb) from public;
grant execute on function public.avail_today_() to anon, authenticated;
grant execute on function public.avail_mine(jsonb) to anon, authenticated;
grant execute on function public.avail_submit(jsonb) to anon, authenticated;

-- student_bundle: 057 본문 그대로 + avail_responses 항목(시간표 조사 제출 별 집계용)
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
  v_nst   text := '';
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
  v_nst    := public.exam_ns_teacher_(v_name);   -- 048: 이름 없는 리포트의 담당 선생님 폴백

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
        'week', week, 'pct', pct, 'scores', scores, 'pub', pub, 'missing', missing,
        'class_id', class_id, 'part', part, 'class_name', class_name)
        order by week, class_id), '[]'::jsonb)
      from public.hwcheck_records
      where v_code <> '' and token = v_code),

    'signup_entries', (select coalesce(jsonb_agg(jsonb_build_object(
        'ts', ts, 'name', name, 'school', school, 'student_id', student_id, 'day', day)
        order by id), '[]'::jsonb)
      from public.signup_entries
      where v_name <> '' and (name = v_name or (v_base <> v_name and name = v_base))),

    'star_bonus', (select coalesce(jsonb_agg(jsonb_build_object(
        'at', at, 'student_id', student_id, 'name', name, 'school', school,
        'stars', stars, 'reason', reason, 'grade', grade, 'giver', giver, 'reason_nice', reason_nice) order by at, id), '[]'::jsonb)
      from public.star_bonus
      where (v_sid <> '' and student_id = v_sid) or (v_name <> '' and name = v_name)),

    'report_config', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.report_config),

    'submissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'submitted_at', submitted_at, 'exam', exam, 'school', school, 'grade', grade,
        'name', name, 'wrong_count', wrong_count, 'wrong_text', wrong_text, 'vow', vow,
        'teacher_note', case when sent_at is not null then teacher_note else '' end,
        'teacher_name', case when sent_at is not null then coalesce(nullif(btrim(teacher_name), ''), v_nst) else '' end,
        'sent_at', sent_at, 'score', score, 'parent_phone', parent_phone)
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

    'review_done', (select coalesce(jsonb_agg(jsonb_build_object(
        'video_id', w.video_id, 'title', v.title, 'completed_at', w.completed_at) order by w.completed_at), '[]'::jsonb)
      from public.review_watch w join public.review_videos v on v.id = w.video_id
      where w.completed_at is not null and btrim(coalesce(me.code, '')) <> '' and w.code = me.code),

    'smock_entries', (select coalesce(jsonb_agg(jsonb_build_object(
        'exam', exam_key, 'at', submitted_at) order by id), '[]'::jsonb)
      from public.smock_entries
      where btrim(coalesce(me.code, '')) <> '' and code = me.code),

    'avail_responses', (select coalesce(jsonb_agg(jsonb_build_object(
        'survey', survey_id, 'at', submitted_at) order by id), '[]'::jsonb)
      from public.avail_responses
      where btrim(coalesce(me.code, '')) <> '' and code = me.code),

    'signup_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.signup_settings)
  );
end $$;

revoke all on function public.student_bundle(text, boolean, text) from public;
grant execute on function public.student_bundle(text, boolean, text) to anon, authenticated;
