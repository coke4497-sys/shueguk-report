-- ============================================================
-- 057: 학력평가 성적 — 학교 모의고사(3·5·6·9·10월 교육청·평가원) 성적 입력·누적
--      (2026-10-21 원장님 "구글 설문(2026년 9월 고1 모의고사 리포트)을 학생 개인 페이지에서
--       모의고사 성적 데이터 메뉴를 만들고 거기에 입력하고 누적하고 싶어요"
--       → 결정: 학생 페이지 새 카드 · 지난 설문 응답 옮겨 오기 · 선생님 화면 · 입력하면 별 +1)
--
--   · smock_exams   — 회차(연·월·학년). 선생님 화면에서 만들고 '입력 받기'를 켠다(open).
--                     layout = '통합'(고1·고2 — 화법 1~6 · 언어 7~10 · 독서 11~23 · 작문 24~30 · 문학 31~45)
--                            | '고3'(독서 1~17 · 문학 18~34 · 선택과목 35~45, 화법과작문/언어와매체)
--   · smock_entries — 학생마다 회차 한 줄(exam_key, code 유일). 점수(score 숫자, 못 읽으면 null)와
--                     적은 그대로(score_text — '50점대'·'미채점'), 체감 난이도, 영역별 틀린 문항(wrong jsonb),
--                     선택과목, 후기. src = '학생'(학생 페이지) | '설문'(구글 설문 응답 옮겨 옴).
--   · 학생 함수(anon): smock_mine(p {key|student}) — 내 학년의 열린 회차 + 내 기록 전부
--                      smock_submit(p {key|student, exam, score, feel, subject, wrong, review})
--                      — 열린 회차·학년 확인, 틀린 문항 범위 확인, 같은 회차는 덮어씀, 처음이면 first.
--   · 별: 회차 하나 입력 = 별 1개(STAR_RULES.smock — s.html·superstar.html). 원본은 이 표.
--   · student_bundle — smock_entries 항목을 더한다(056 본문 그대로 + 한 칸).
-- ============================================================

create table if not exists public.smock_exams (
  key        text primary key,                       -- '2026-10-고1'
  year       int  not null,
  month      int  not null check (month between 1 and 12),
  grade      text not null check (grade in ('고1','고2','고3')),
  layout     text not null default '통합' check (layout in ('통합','고3')),
  title      text not null default '',
  open       boolean not null default false,
  created_at timestamptz not null default now(),
  unique (year, month, grade)
);

create table if not exists public.smock_entries (
  id          bigserial primary key,
  exam_key    text not null references public.smock_exams(key) on update cascade on delete cascade,
  code        text not null check (btrim(code) <> ''),   -- students.code(접근코드)
  student_id  text not null default '',
  name        text not null default '',
  school      text not null default '',
  grade       text not null default '',
  score       numeric,                                   -- null = 숫자로 못 읽음(미채점 등)
  score_text  text not null default '',
  feel        text not null default '',                  -- '상' · '중, 하' (여러 개면 쉼표)
  subject     text not null default '',                  -- 고3: 화법과작문 | 언어와매체
  wrong       jsonb not null default '{}'::jsonb,        -- {"화법":[1,3],"독서":[12]}
  review      text not null default '',
  src         text not null default '학생',
  submitted_at timestamptz not null default now(),       -- 처음 낸 때(설문은 설문 타임스탬프)
  updated_at  timestamptz not null default now(),
  unique (exam_key, code)
);
create index if not exists smock_entries_code_idx on public.smock_entries (code);

do $$
declare t text;
begin
  foreach t in array array['smock_exams','smock_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all privileges on public.%I from anon', t);
    execute format('grant all privileges on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.smock_entries_id_seq to authenticated;

-- 영역 → 문항 번호 범위 (화면 SMOCK_LAYOUT 과 같은 표 — 고치면 함께)
create or replace function public.smock_range_(p_layout text, p_area text)
returns int[] language sql immutable as $$
  select case p_layout
    when '고3' then case p_area when '독서' then array[1,17] when '문학' then array[18,34] when '선택' then array[35,45] end
    else case p_area when '화법' then array[1,6] when '언어' then array[7,10] when '독서' then array[11,23]
                     when '작문' then array[24,30] when '문학' then array[31,45] end
  end
$$;

-- '2026 고등 1학년' → '고1' (중학생·미상은 빈 값)
create or replace function public.smock_grade_(p text)
returns text language sql immutable as $$
  select case when g ~ '중' then ''
              else coalesce('고' || substring(g from '[1-3]'), '') end
    from (select regexp_replace(coalesce(p,''), '20[0-9]{2}', '', 'g') as g) s
$$;

-- 틀린 문항 정리: 영역 키만, 범위 안 정수만, 중복 없이 오름차순. 범위 밖이 있으면 null.
create or replace function public.smock_clean_wrong_(p_layout text, p_wrong jsonb)
returns jsonb language plpgsql immutable as $$
declare out jsonb := '{}'::jsonb; k text; rng int[]; nums int[]; v jsonb; n int;
begin
  if p_wrong is null or jsonb_typeof(p_wrong) <> 'object' then return '{}'::jsonb; end if;
  for k in select jsonb_object_keys(p_wrong) loop
    rng := public.smock_range_(p_layout, k);
    if rng is null then return null; end if;
    if jsonb_typeof(p_wrong->k) <> 'array' then return null; end if;
    nums := '{}';
    for v in select * from jsonb_array_elements(p_wrong->k) loop
      begin n := (v #>> '{}')::int; exception when others then return null; end;
      if n < rng[1] or n > rng[2] then return null; end if;
      if not n = any(nums) then nums := nums || n; end if;
    end loop;
    if array_length(nums, 1) > 0 then
      out := out || jsonb_build_object(k, (select jsonb_agg(x order by x) from unnest(nums) x));
    end if;
  end loop;
  return out;
end $$;

create or replace function public.smock_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype; g text;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  g := public.smock_grade_(me.grade);
  return jsonb_build_object('ok', true, 'grade', g,
    'open', (select coalesce(jsonb_agg(jsonb_build_object('key', e.key, 'year', e.year, 'month', e.month,
                 'grade', e.grade, 'layout', e.layout, 'title', e.title) order by e.year desc, e.month desc), '[]'::jsonb)
               from public.smock_exams e where e.open and e.grade = g),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('exam', x.exam_key, 'year', e.year, 'month', e.month,
                 'grade', e.grade, 'layout', e.layout, 'title', e.title, 'open', e.open,
                 'score', x.score, 'score_text', x.score_text, 'feel', x.feel, 'subject', x.subject,
                 'wrong', x.wrong, 'review', x.review, 'src', x.src,
                 'at', x.submitted_at, 'updated_at', x.updated_at) order by e.year desc, e.month desc), '[]'::jsonb)
               from public.smock_entries x join public.smock_exams e on e.key = x.exam_key
              where x.code = me.code));
end $$;

create or replace function public.smock_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype; e public.smock_exams%rowtype;
        v_wrong jsonb; v_txt text; v_score numeric; v_subj text; v_feel text; v_first boolean;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into e from public.smock_exams where key = btrim(coalesce(p->>'exam',''));
  if e.key is null then return jsonb_build_object('ok', false, 'error', 'no_exam'); end if;
  if not e.open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if e.grade <> public.smock_grade_(me.grade) then return jsonb_build_object('ok', false, 'error', 'wrong_grade'); end if;

  v_txt := left(btrim(coalesce(p->>'score','')), 20);
  if v_txt = '' then return jsonb_build_object('ok', false, 'error', 'no_score'); end if;
  if v_txt ~ '^[0-9]{1,3}(\.[0-9])?$' then
    v_score := v_txt::numeric;
    if v_score > 100 then return jsonb_build_object('ok', false, 'error', 'bad_score'); end if;
  end if;
  v_wrong := public.smock_clean_wrong_(e.layout, coalesce(p->'wrong', '{}'::jsonb));
  if v_wrong is null then return jsonb_build_object('ok', false, 'error', 'bad_wrong'); end if;
  v_subj := btrim(coalesce(p->>'subject',''));
  if e.layout = '고3' then
    if v_subj not in ('화법과작문','언어와매체') then return jsonb_build_object('ok', false, 'error', 'no_subject'); end if;
  else
    v_subj := '';
  end if;
  select string_agg(f, ', ' order by array_position(array['최상','상','중','하'], f)) into v_feel
    from (select distinct btrim(x) f from unnest(string_to_array(coalesce(p->>'feel',''), ',')) x) s
   where f in ('최상','상','중','하');

  v_first := not exists (select 1 from public.smock_entries where exam_key = e.key and code = me.code);
  insert into public.smock_entries as t (exam_key, code, student_id, name, school, grade, score, score_text, feel,
                                         subject, wrong, review, src)
  values (e.key, me.code, coalesce(me.student_id,''), coalesce(me.name,''), coalesce(me.school,''), coalesce(me.grade,''),
          v_score, v_txt, coalesce(v_feel,''), v_subj, v_wrong, left(coalesce(p->>'review',''), 1000), '학생')
  on conflict (exam_key, code) do update
     set score = excluded.score, score_text = excluded.score_text, feel = excluded.feel, subject = excluded.subject,
         wrong = excluded.wrong, review = excluded.review, name = excluded.name, school = excluded.school,
         grade = excluded.grade, student_id = excluded.student_id, updated_at = now();
  return jsonb_build_object('ok', true, 'first', v_first, 'exam', e.key);
end $$;

revoke all on function public.smock_range_(text, text) from public;
revoke all on function public.smock_grade_(text) from public;
revoke all on function public.smock_clean_wrong_(text, jsonb) from public;
revoke all on function public.smock_mine(jsonb) from public;
revoke all on function public.smock_submit(jsonb) from public;
grant execute on function public.smock_range_(text, text) to anon, authenticated;
grant execute on function public.smock_grade_(text) to anon, authenticated;
grant execute on function public.smock_clean_wrong_(text, jsonb) to anon, authenticated;
grant execute on function public.smock_mine(jsonb) to anon, authenticated;
grant execute on function public.smock_submit(jsonb) to anon, authenticated;

-- student_bundle: 056 본문 그대로 + smock_entries 항목(학력평가 성적 별 집계용)
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

    'signup_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.signup_settings)
  );
end $$;

revoke all on function public.student_bundle(text, boolean, text) from public;
grant execute on function public.student_bundle(text, boolean, text) to anon, authenticated;
