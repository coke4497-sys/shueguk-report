-- 094: H WORK 완료한 과제의 정답지 · 다른 기기에서 지난 과제 다시 보기 (2026-11-26 원장님
-- "슈퍼스타 페이지에서 지난 과제 문항을 확인할 수 있나요? 완료된 과제는 정답지 보기가 가능하게")
--
-- · hwork_retry_state — 지금 DB 본문(078) 그대로 + 'all_ans'.
--     완료한 과제(오답하기를 끝냄·모두 클리어/넘김, 또는 선생님 과제 검사 완료)면 모든 문항 정답 {번호: 정답},
--     아니면 null(틀린 문항 정답은 지금처럼 클리어해야 열린다).
-- · hwork_sub_find(p {key|student, teacher, code}) — 학생 페이지에서 '제출 완료' 과제를 열 때 그 학생의 가장 최근 제출 번호·열쇠.
--     이 기기에 오답하기 기록이 없어도(다른 기기에서 냈어도) 결과·문항·정답지를 다시 본다.
--     이름(끝 알파벳 뗌)·학년 숫자·학교(줄임 이름끼리 앞부분 일치)가 모두 맞을 때만 — 학교가 다르면 잇지 않는다.
-- 다시 실행해도 안전하다. 064·065·070·074·078 의 hwork_retry_state 를 다시 돌리면 그 뒤 094 도.

CREATE OR REPLACE FUNCTION public.hwork_retry_state(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.hwork_submissions; v_done boolean;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  v_done := s.review_at is not null or hwork_fix_done_(s.detail, s.review) or s.check_done is not null;
  return jsonb_build_object('ok', true,
    'stage', case when s.review_at is not null or hwork_fix_done_(s.detail, s.review) then 'done' else 'fix' end,
    'teacher', s.teacher, 'code', s.code, 'name', s.name, 'ts', s.ts,
    'got', s.got, 'total', s.total,
    'detail', hwork_hide_wrong_(s.detail),
    'review', s.review, 'answers', hwork_cleared_ans_(s.detail, s.review),
    'all_ans', case when v_done then (select coalesce(jsonb_object_agg(k, coalesce(v->>'ans','')), '{}'::jsonb)
                                        from jsonb_each(coalesce(s.detail,'{}'::jsonb)) e(k, v)) end,
    'reply', (select coalesce(jsonb_object_agg(e.k, e.v || jsonb_build_object('files', hwork_reply_files_(s.id, e.k))), '{}'::jsonb)
                from jsonb_each(coalesce(s.reply, '{}'::jsonb)) e(k, v)),
    'checked', coalesce(s.checked, '{}'::jsonb), 'check_done', s.check_done, 'check_seen_at', s.check_seen_at,
    'time', s.timelog, 'away_n', s.away_n, 'away_sec', s.away_sec);
end $function$;

revoke all on function public.hwork_retry_state(jsonb) from public;
grant execute on function public.hwork_retry_state(jsonb) to anon, authenticated;

create or replace function public.hwork_school_key_(s text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(btrim(coalesce(s,'')), '\s+', '', 'g'), '(등학교|학교)$', '');
$$;

create or replace function public.hwork_sub_find(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype; nm text; gd text; sk text; x record;
begin
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  nm := regexp_replace(btrim(coalesce(me.name,'')), '[A-Za-z]$', '');
  gd := substring(coalesce(me.grade,'') from '(\d)\D*$');
  sk := hwork_school_key_(me.school);
  select s.id, s.retry_key into x
    from hwork_submissions s
   where s.retry_key is not null
     and s.code = coalesce(p->>'code','')
     and (coalesce(p->>'teacher','') = '' or s.teacher = p->>'teacher')
     and regexp_replace(btrim(s.name), '[A-Za-z]$', '') = nm
     and (gd is null or substring(s.grade from '(\d)\D*$') is null or substring(s.grade from '(\d)\D*$') = gd)
     and (sk = '' or hwork_school_key_(s.school) = ''
          or starts_with(sk, hwork_school_key_(s.school)) or starts_with(hwork_school_key_(s.school), sk))
   order by s.id desc limit 1;
  if x.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'id', x.id, 'key', x.retry_key);
end $$;

revoke all on function public.hwork_sub_find(jsonb) from public;
revoke all on function public.hwork_school_key_(text) from public;
grant execute on function public.hwork_sub_find(jsonb) to anon, authenticated;
