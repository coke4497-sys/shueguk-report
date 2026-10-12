-- ============================================================
-- 049: 학생 페이지 '내 수업 정보' — 담당 선생님 = 내신 진도 반 담당 선생님 (2026-10-12 원장님
--      "학생 페이지의 담당 교사 → 담당 선생님. 이 이름을 내신반 담당 선생님으로 바꿔줘")
--
--   · student_bundle 의 me 에 `ns_teacher` 를 더한다 = 048 의 exam_ns_teacher_(이름)(내신 tt_classes 중 '확인' 반·w* 를 뺀
--     진도 반 명단에서 찾은 담당T, 둘 이상이면 빈 값, 짧은 이름은 students.teacher 전체 이름으로).
--     s.html 이 '담당 선생님' 줄에 이 값을 먼저 쓰고, 비어 있으면 종전의 students.teacher(슈스 링크 담당) 를 쓴다.
--   · 그 밖은 048 본문 그대로. 데이터는 채우지 않고 함수가 그때그때 계산한다(명단이 바뀌면 따라간다).
-- ============================================================

-- student_bundle: 048 본문 그대로 + me.ns_teacher(내신 진도 반 담당 선생님)
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
      'teacher', me.teacher, 'ns_teacher', v_nst, 'memo', me.memo, 'class_a', me.class_a, 'class_b', me.class_b,
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
        'stars', stars, 'reason', reason, 'grade', grade) order by at, id), '[]'::jsonb)
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

    'signup_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.signup_settings)
  );
end $$;

revoke all on function public.student_bundle(text, boolean, text) from public;
grant execute on function public.student_bundle(text, boolean, text) to anon, authenticated;
