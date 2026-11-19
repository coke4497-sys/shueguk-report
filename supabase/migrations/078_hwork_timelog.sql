-- 078: H WORK 풀이 시간 기록 (2026-11-18 원장님 "친구들이 h work 를 풀때 푸는 시간을 기록하고 싶어요.
-- 화면 밖으로 나간 시간, 빈도 등을요. 나눠서 풀었다면 중지한 시간과 재시작 시간도요. 시간 기록을 친구가 확인할 수 있고")
-- hwork_submissions.timelog jsonb = 화면(hwork.html)이 센 기록
--   {v, first, last(ms), span 처음 시작→제출 초, act 화면을 보며 푼 초, an 화면 밖 횟수, as 화면 밖 초, breaks 나눈 횟수,
--     sessions:[{s, e(ms), act, an, as(초), end 'pause'|'close'|'idle'|'submit'}]}
-- · hwork_submit — 066 본문 그대로 + p.time 을 timelog 로(객체·20000자·구간 60개 이하일 때만)
-- · hwork_retry_state — 지금 DB 본문(074) 그대로 + time·away_n·away_sec (학생이 결과 화면에서 다시 본다)
-- 다시 실행해도 안전하다. 064·066·069 의 hwork_submit, 064·065·070·074 의 hwork_retry_state 를 다시 돌리면 그 뒤 078 도.

alter table public.hwork_submissions add column if not exists timelog jsonb;

create or replace function public.hwork_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := coalesce(p->>'teacher',''); c text := coalesce(p->>'code','');
        hw record; d text; r jsonb; v_id bigint; v_key text; v_an int := 0; v_as int := 0; v_tl jsonb := null;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  select * into hw from hwork_homeworks where teacher = t and code = c limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'H WORK을 찾을 수 없습니다: ' || t || ' / ' || c);
  end if;
  d := hwork_due_(hw.due);
  if hwork_closed_(d) then
    return jsonb_build_object('ok', false, 'error', '마감된 과제입니다 (마감 ' || d || '). 선생님께 문의해 주세요.');
  end if;
  if hw.data is null or hw.data = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', '정답 데이터(C칸)가 비어 있습니다.');
  end if;
  r := hwork_grade_(hw.data, coalesce(p->'answers','{}'::jsonb));
  -- 화면 이탈(다른 앱·화면 끔) 횟수·초 — 화면이 센 값, 이상한 값은 0·상한으로
  if coalesce(p->'away'->>'n','') ~ '^\d{1,6}$' then v_an := least((p->'away'->>'n')::int, 9999); end if;
  if coalesce(p->'away'->>'sec','') ~ '^\d{1,9}$' then v_as := least((p->'away'->>'sec')::int, 86400); end if;
  -- 풀이 시간 기록(078) — 화면이 센 구간 목록. 모양만 보고(객체·크기) 그대로 둔다
  if jsonb_typeof(p->'time') = 'object' and length((p->'time')::text) <= 20000
     and jsonb_typeof(coalesce(p->'time'->'sessions','[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p->'time'->'sessions','[]'::jsonb)) <= 60 then
    v_tl := p->'time';
  end if;
  v_key := replace(gen_random_uuid()::text, '-', '');
  insert into hwork_submissions (ts,teacher,code,school,grade,name,got,total,answers,detail,questions,retry_key,away_n,away_sec,timelog)
  values (ts_now, t, c, coalesce(p->>'school',''), coalesce(p->>'grade',''), coalesce(p->>'name',''),
          (r->>'got')::int, (r->>'total')::int,
          coalesce(p->'answers','{}'::jsonb), r->'detail', coalesce(p->'questions','{}'::jsonb), v_key, v_an, v_as, v_tl)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key,
    'result', jsonb_set(r, '{detail}', hwork_hide_wrong_(r->'detail')),
    'student', jsonb_build_object('teacher', t, 'code', c, 'school', coalesce(p->>'school',''),
                                  'grade', coalesce(p->>'grade',''), 'name', coalesce(p->>'name','')));
end $$;

revoke all on function public.hwork_submit(jsonb) from public;
grant execute on function public.hwork_submit(jsonb) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.hwork_retry_state(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.hwork_submissions;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true,
    'stage', case when s.review_at is not null or hwork_fix_done_(s.detail, s.review) then 'done' else 'fix' end,
    'teacher', s.teacher, 'code', s.code, 'name', s.name, 'ts', s.ts,
    'got', s.got, 'total', s.total,
    'detail', hwork_hide_wrong_(s.detail),
    'review', s.review, 'answers', hwork_cleared_ans_(s.detail, s.review),
    'reply', (select coalesce(jsonb_object_agg(e.k, e.v || jsonb_build_object('files', hwork_reply_files_(s.id, e.k))), '{}'::jsonb)
                from jsonb_each(coalesce(s.reply, '{}'::jsonb)) e(k, v)),
    'checked', coalesce(s.checked, '{}'::jsonb), 'check_done', s.check_done, 'check_seen_at', s.check_seen_at,
    'time', s.timelog, 'away_n', s.away_n, 'away_sec', s.away_sec);
end $function$;

revoke all on function public.hwork_retry_state(jsonb) from public;
grant execute on function public.hwork_retry_state(jsonb) to anon, authenticated;
