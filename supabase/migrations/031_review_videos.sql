-- ============================================================
-- 031: 복습 영상 — 유튜브 복습 영상 배정 · 학생별 시청 시간 · 90% 시청 → 슈퍼스타 별 +1
--      (2026-09-27 사용자 요청 "유튜브에 업로드하는 복습 영상을 티쳐스 페이지 내에서 학습 시간을 관리"
--       → 결정 "90% 완료, 반 전체 배정, 별 +1" + "화면을 벗어나면 시간을 세지 않게")
--
--   · review_videos   — 영상(유튜브 ID·제목·배정한 반 표시용 목록). 교사 페이지(hub review.html)가 직접 쓴다.
--   · review_targets  — 배정 대상 학생(반 명단을 배정할 때 학생 한 명씩 풀어 넣은 것 — 스냅숏).
--   · review_watch    — 학생·영상마다 한 줄: 본 구간(초 단위 '0'/'1' 문자열 bits), 본 구간 %,
--                       실제 시청 시간(total_sec — 화면이 보이는 동안 재생된 초), 90% 도달 시각(completed_at)
--                       = **별 집계의 원본**(completed_at 있는 줄 하나 = 별 1개).
--   · 학생 함수(공개 키 허용 — 접근코드(key) 또는 학생ID로 본인 확인):
--       review_list(p {key|student})              — 나에게 배정된 영상 + 진행
--       review_open(p {key|student, video})       — 영상 하나 + 본 구간 bits·이어 볼 위치
--       review_save(p {key|student, video, duration, ranges:[[a,b],…], add_sec, pos})
--                                                 — 본 구간을 합치고 %·완료 판정. 응답 {pct, done, first}
--   · student_bundle  — 'review_done' 항목 추가(학생 페이지 별 집계; 029 본문 그대로 + 한 항목)
-- 공개 키(anon)는 함수만 부를 수 있고 표는 못 읽는다(015 규칙).
-- ============================================================

create table if not exists public.review_videos (
  id         bigint generated always as identity primary key,
  yt_id      text not null,                    -- 유튜브 영상 ID(11자)
  title      text not null default '',
  memo       text not null default '',
  classes    jsonb not null default '[]'::jsonb, -- 배정한 반(표시용) [{book,class_id,name,when,teacher}]
  duration   int  not null default 0,          -- 초 — 학생 화면이 처음 재생할 때 플레이어 값으로 채운다
  active     boolean not null default true,    -- false = 학생 화면에서 숨김(기록은 남음)
  created_at timestamptz not null default now()
);

create table if not exists public.review_targets (
  id         bigint generated always as identity primary key,
  video_id   bigint not null references public.review_videos(id) on delete cascade,
  code       text not null default '',         -- students.code(접근코드)
  student_id text not null default '',
  name       text not null default '',
  school     text not null default '',
  grade      text not null default '',
  class_name text not null default '',         -- 어느 반으로 배정됐는지(표시용)
  unique (video_id, code)
);
create index if not exists review_targets_code_idx on public.review_targets (code);

create table if not exists public.review_watch (
  id           bigint generated always as identity primary key,
  video_id     bigint not null references public.review_videos(id) on delete cascade,
  code         text not null default '',
  student_id   text not null default '',
  name         text not null default '',
  school       text not null default '',
  grade        text not null default '',
  bits         text not null default '',       -- 초마다 '1'(본 구간) / '0'
  pct          int  not null default 0,        -- 본 구간 % (0~100)
  total_sec    int  not null default 0,        -- 실제 시청 시간(되감아 다시 본 것 포함, 화면이 보일 때만)
  last_pos     int  not null default 0,        -- 이어 볼 위치(초)
  first_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,                    -- 90% 처음 넘은 시각 = 별
  unique (video_id, code)
);
create index if not exists review_watch_code_idx on public.review_watch (code);

do $$
declare t text;
begin
  foreach t in array array['review_videos','review_targets','review_watch'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists anon_all on public.%I', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all privileges on public.%I from anon', t);
    execute format('grant all privileges on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.review_done_pct() returns int language sql immutable as $$ select 90 $$;

-- 요청의 key(접근코드) 또는 student(학생ID)로 학생 한 명을 찾는다
create or replace function public.review_me_(p jsonb)
returns public.students language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        v_key text := btrim(coalesce(p->>'key',''));
        v_sid text := btrim(coalesce(p->>'student',''));
begin
  if v_key <> '' then
    select * into me from public.students where code = v_key order by seq, id limit 1;
  elsif v_sid <> '' then
    select * into me from public.students where student_id = v_sid order by seq, id limit 1;
  end if;
  return me;
end $$;

create or replace function public.review_list(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  return jsonb_build_object('ok', true, 'done_pct', public.review_done_pct(), 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', v.id, 'yt', v.yt_id, 'title', v.title, 'memo', v.memo, 'duration', v.duration,
             'at', v.created_at, 'cls', t.class_name,
             'pct', coalesce(w.pct, 0), 'sec', coalesce(w.total_sec, 0), 'pos', coalesce(w.last_pos, 0),
             'done', w.completed_at is not null) order by v.created_at desc, v.id desc), '[]'::jsonb)
      from public.review_targets t
      join public.review_videos v on v.id = t.video_id and v.active
      left join public.review_watch w on w.video_id = v.id and w.code = t.code
     where t.code = me.code));
end $$;

create or replace function public.review_open(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        v public.review_videos%rowtype;
        w public.review_watch%rowtype;
        v_vid bigint := nullif(btrim(coalesce(p->>'video','')), '')::bigint;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into v from public.review_videos where id = v_vid and active;
  if v.id is null or not exists (select 1 from public.review_targets where video_id = v.id and code = me.code) then
    return jsonb_build_object('ok', false, 'error', 'not_assigned');
  end if;
  select * into w from public.review_watch where video_id = v.id and code = me.code;
  return jsonb_build_object('ok', true, 'done_pct', public.review_done_pct(),
    'id', v.id, 'yt', v.yt_id, 'title', v.title, 'memo', v.memo, 'duration', v.duration,
    'bits', coalesce(w.bits, ''), 'pct', coalesce(w.pct, 0), 'sec', coalesce(w.total_sec, 0),
    'pos', coalesce(w.last_pos, 0), 'done', w.completed_at is not null);
end $$;

-- 저장: 본 구간을 합치고 %를 다시 센다. 한 번에 받는 양에 상한을 둔다(화면은 20초마다 보낸다).
create or replace function public.review_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        v public.review_videos%rowtype;
        w public.review_watch%rowtype;
        v_vid bigint := nullif(btrim(coalesce(p->>'video','')), '')::bigint;
        v_dur int := coalesce(nullif(btrim(coalesce(p->>'duration','')), '')::numeric, 0)::int;
        v_add int := greatest(0, least(coalesce(nullif(btrim(coalesce(p->>'add_sec','')), '')::numeric, 0)::int, 120));
        v_pos int := greatest(0, coalesce(nullif(btrim(coalesce(p->>'pos','')), '')::numeric, 0)::int);
        v_bits text; r jsonb; a int; b int; v_new int := 0; v_cap int := 300;
        v_pct int; v_first boolean := false;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into v from public.review_videos where id = v_vid and active;
  if v.id is null or not exists (select 1 from public.review_targets where video_id = v.id and code = me.code) then
    return jsonb_build_object('ok', false, 'error', 'not_assigned');
  end if;
  -- 영상 길이: 처음 재생한 학생의 플레이어 값으로 채운다(6시간 상한)
  if v.duration <= 0 and v_dur between 1 and 21600 then
    update public.review_videos set duration = v_dur where id = v.id;
    v.duration := v_dur;
  end if;
  if v.duration <= 0 then return jsonb_build_object('ok', false, 'error', 'no_duration'); end if;

  insert into public.review_watch (video_id, code, student_id, name, school, grade)
  values (v.id, me.code, me.student_id, me.name, me.school, me.grade)
  on conflict (video_id, code) do nothing;
  select * into w from public.review_watch where video_id = v.id and code = me.code for update;

  v_bits := rpad(left(w.bits, v.duration), v.duration, '0');
  if jsonb_typeof(p->'ranges') = 'array' then
    for r in select * from jsonb_array_elements(p->'ranges') loop
      exit when v_new >= v_cap;
      if jsonb_typeof(r) <> 'array' then continue; end if;
      a := greatest(0, floor((r->>0)::numeric)::int);
      b := least(v.duration, ceil((r->>1)::numeric)::int);
      if b <= a then continue; end if;
      b := least(b, a + (v_cap - v_new));
      v_new := v_new + (b - a);
      v_bits := overlay(v_bits placing repeat('1', b - a) from a + 1 for b - a);
    end loop;
  end if;
  v_pct := floor(length(replace(v_bits, '0', ''))::numeric * 100 / v.duration)::int;
  if w.completed_at is null and v_pct >= public.review_done_pct() then v_first := true; end if;

  update public.review_watch
     set bits = v_bits, pct = v_pct, total_sec = total_sec + v_add,
         last_pos = least(v_pos, v.duration), updated_at = now(),
         name = me.name, school = me.school, grade = me.grade, student_id = me.student_id,
         completed_at = case when v_first then now() else completed_at end
   where id = w.id;
  return jsonb_build_object('ok', true, 'pct', v_pct, 'done', (w.completed_at is not null or v_first),
                            'first', v_first, 'sec', w.total_sec + v_add, 'done_pct', public.review_done_pct());
end $$;

revoke all on function public.review_me_(jsonb) from public;
revoke all on function public.review_list(jsonb) from public;
revoke all on function public.review_open(jsonb) from public;
revoke all on function public.review_save(jsonb) from public;
grant execute on function public.review_list(jsonb) to anon, authenticated;
grant execute on function public.review_open(jsonb) to anon, authenticated;
grant execute on function public.review_save(jsonb) to anon, authenticated;
grant execute on function public.review_done_pct() to anon, authenticated;

-- student_bundle: 029 본문 그대로 + 'review_done' 항목 (학생 페이지 별 집계 = 90% 시청한 영상 수)
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

    'review_done', (select coalesce(jsonb_agg(jsonb_build_object(
        'video_id', w.video_id, 'title', v.title, 'completed_at', w.completed_at) order by w.completed_at), '[]'::jsonb)
      from public.review_watch w join public.review_videos v on v.id = w.video_id
      where w.completed_at is not null and btrim(coalesce(me.code, '')) <> '' and w.code = me.code),

    'signup_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.signup_settings)
  );
end $$;

revoke all on function public.student_bundle(text, boolean, text) from public;
grant execute on function public.student_bundle(text, boolean, text) to anon, authenticated;
