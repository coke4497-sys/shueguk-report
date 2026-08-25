-- ============================================================
-- 3단계(2026-08-25): 학생 페이지가 표를 직접 읽지 않게 — 함수 하나로
--
-- 왜:
--   s.html 에는 공개 키가 들어 있고, 그 페이지가 학생 496명에게 개인 링크로 나간다.
--   지금은 그 키로 주소창에서 바로 `/rest/v1/students?select=*` 를 부를 수 있어
--   전교생의 이름·학교·담당T·반은 물론 student_id(부모님 8자리 = 그 학생 페이지
--   비밀번호)와 접근코드까지 읽힌다. 학생 한 명이 남의 페이지를 열 수 있다는 뜻이다.
--
--   이 함수는 접근코드(또는 학생ID)를 받아 **그 학생 몫만** 조립해 돌려준다.
--   학생 화면은 이 함수 하나만 부르면 되고, 표를 직접 조회할 이유가 없어진다.
--   (표 직접 접근을 실제로 막는 것은 교사 페이지 신분 분리와 함께 — README 참고)
--
-- 덤: 지금까지 왕복 16번이던 첫 조회가 1번이 된다.
--
-- 규칙은 s.html 연결부의 조회 조건을 1:1로 옮긴 것이다(orFilter/nameOr/baseName).
-- 바꾸면 안 되는 것:
--   · 이름 뒤 한 글자 영문(동명이인 표기 '양지우A')을 뗀 것이 baseName
--   · 재원여부가 퇴원류면 동명이인 수에서 뺀다
--   · 문항(exam_questions)은 비밀번호가 맞을 때만 담는다 — 예전엔 페이지가 판단했다
-- ============================================================

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

    'signup_settings', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]'::jsonb)
      from public.signup_settings)
  );
end $$;

revoke all on function public.student_bundle(text, boolean, text) from public;
grant execute on function public.student_bundle(text, boolean, text) to anon, authenticated;
