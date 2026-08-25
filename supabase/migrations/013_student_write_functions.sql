-- ============================================================
-- 3단계 ②(2026-08-25): 학생이 여는 나머지 페이지 4개도 표를 직접 건드리지 않게
--
-- s.html 말고도 학생이 여는 페이지가 넷 더 있다 — 복기 입력(r.html)·클리닉 신청·
-- 모의고사 신청·H WORK 제출. 넷 다 미러에 한 줄 넣는 일만 하는데, 그러려고 표에
-- 직접 INSERT 하고 있었다. 그러면 공개 키에 표 권한을 열어 둘 수밖에 없다.
--
-- 아래 함수들은 **넣기만 한다**. 돌려주는 값이 없으므로 이 함수로는 아무것도 읽지 못한다.
-- 컬럼도 여기서 정해 넣으므로 호출하는 쪽이 id·clear 같은 칸을 마음대로 채울 수 없다.
--
-- 복기 입력만 읽기가 하나 필요하다(그 시험 한 건). exam_bundle 이 그것만 돌려준다.
--
-- 원본은 그대로 각 백엔드(Apps Script)다 — 이건 여전히 읽기 미러이고, 실패해도
-- 제출에는 영향이 없으며 일일 점검이 원본 기준으로 맞춘다.
-- ============================================================

-- ── 복기 입력(r.html)이 여는 시험 한 건 ────────────────────────────
create or replace function public.exam_bundle(p_report_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare e public.exams%rowtype;
begin
  select * into e from public.exams where report_id = p_report_id limit 1;
  if e.report_id is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'title', e.title, 'scope', e.scope, 'review', e.review,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'no', q.no, 'area', q.area, 'qtype', q.qtype, 'lv', q.lv, 'txt', q.txt,
        'detail', q.detail, 'grp', q.grp, 'multi', q.multi) order by q.seq), '[]'::jsonb)
      from public.exam_questions q where q.report_id = e.report_id));
end $$;

-- ── 지필 복기 제출 미러(r.html) ────────────────────────────────────
create or replace function public.mirror_submission(p jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.submissions
    (submitted_at, exam, school, grade, name, wrong_count, wrong_text, vow, score, parent_phone)
  values (
    coalesce((p->>'submitted_at')::timestamptz, now()),
    coalesce(p->>'exam',''), coalesce(p->>'school',''), coalesce(p->>'grade',''),
    coalesce(p->>'name',''), coalesce(p->>'wrong_count',''), coalesce(p->>'wrong_text',''),
    coalesce(p->>'vow',''), coalesce(p->>'score',''), coalesce(p->>'parent_phone',''));
$$;

-- ── 클리닉 신청 미러(index.html) — 요청 건수만큼 여러 줄 ───────────
create or replace function public.mirror_clinic_requests(p jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.clinic_requests
    (ts, name, school, phone, slot, rtype, area, content, qcount, memo, grade, student_id, teacher, token, clear)
  select
    coalesce(r->>'ts',''), coalesce(r->>'name',''), coalesce(r->>'school',''), coalesce(r->>'phone',''),
    coalesce(r->>'slot',''), coalesce(r->>'rtype',''), coalesce(r->>'area',''), coalesce(r->>'content',''),
    coalesce(r->>'qcount',''), coalesce(r->>'memo',''), coalesce(r->>'grade',''),
    coalesce(r->>'student_id',''), coalesce(r->>'teacher',''), coalesce(r->>'token',''), ''
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else jsonb_build_array(p) end) r;
$$;

-- ── 주말 모의고사 신청 미러(signup.html) ───────────────────────────
create or replace function public.mirror_signup_entry(p jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.signup_entries (ts, name, school, grade, student_id, subject, day, exam_date)
  values (
    coalesce(p->>'ts',''), coalesce(p->>'name',''), coalesce(p->>'school',''), coalesce(p->>'grade',''),
    coalesce(p->>'student_id',''), coalesce(p->>'subject',''), coalesce(p->>'day',''),
    coalesce(p->>'exam_date',''));
$$;

-- ── H WORK 제출 미러(hwork.html) ───────────────────────────────────
create or replace function public.mirror_hwork_submission(p jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.hwork_submissions
    (ts, teacher, code, school, grade, name, got, total, answers, detail, questions)
  values (
    coalesce(p->>'ts',''), coalesce(p->>'teacher',''), coalesce(p->>'code',''),
    coalesce(p->>'school',''), coalesce(p->>'grade',''), coalesce(p->>'name',''),
    coalesce((p->>'got')::int, 0), coalesce((p->>'total')::int, 0),
    coalesce(p->'answers', '{}'::jsonb), coalesce(p->'detail', '{}'::jsonb),
    coalesce(p->'questions', '{}'::jsonb));
$$;

revoke all on function public.exam_bundle(text) from public;
revoke all on function public.mirror_submission(jsonb) from public;
revoke all on function public.mirror_clinic_requests(jsonb) from public;
revoke all on function public.mirror_signup_entry(jsonb) from public;
revoke all on function public.mirror_hwork_submission(jsonb) from public;

grant execute on function public.exam_bundle(text) to anon, authenticated;
grant execute on function public.mirror_submission(jsonb) to anon, authenticated;
grant execute on function public.mirror_clinic_requests(jsonb) to anon, authenticated;
grant execute on function public.mirror_signup_entry(jsonb) to anon, authenticated;
grant execute on function public.mirror_hwork_submission(jsonb) to anon, authenticated;
