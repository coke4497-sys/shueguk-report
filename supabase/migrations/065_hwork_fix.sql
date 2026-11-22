-- 065: H WORK '오답하기' (2026-11-11 원장님 — 064 의 '다시 풀기 한 번 → 오답 정리'를 대신한다)
-- "오답하기: 내가 틀린 답을 고른 이유, 다시 고른 정답, 이 답이 정답인 이유 → 재채점 후
--  1) 맞음: 오답 클리어  2) 틀림: 내가 틀린 답을 고른 이유로 회귀"
--   · 1차에 틀린 문항(서술형 제외)마다 학생이 세 칸을 채워 hwork_fix 로 보낸다:
--       why_wrong(내가 틀린 답을 고른 이유, 1~300자) · pick(다시 고른 답) · why_right(이 답이 정답인 이유, 1~300자)
--     서버가 pick 을 저장된 정답으로 채점 → 맞으면 그 문항 클리어(정답 공개), 틀리면 그 답이 새 '틀린 답'이 되어 처음 칸부터 다시.
--     횟수 제한 없음. 모든 문항을 클리어하면 review_at.
--   · 기록: hwork_submissions.review = {q:{tries:[{wrong, why_wrong, pick, why_right, ok, at}], cleared_at}}
--           retry_got = 첫 번째 시도에 바로 클리어한 문항 수, retry_at = 첫 시도 시각.
--   · 정답은 클리어한 문항만 공개한다(hwork_fix·hwork_retry_state 의 answers).
--   · 같은 날 원장님 "왜 틀렸는지 모르겠음, 선생님 도와주세요 표시 버튼과 문항 오류 신고 버튼과 문항 오류 제보 내용 기록 칸":
--     hwork_flag(p {id,key,q,kind:'help'|'error',text}) — review[q].help = {at,text(선택)} · review[q].error = {at,text(1~300자 필수)}.
--     표시한 문항은 클리어 전이어도 '선생님께 넘김'으로 쳐서 다 끝냄(review_at)을 막지 않는다. 표시한 뒤에도 계속 오답하기 할 수 있다.
--     정답은 여전히 클리어한 문항만 공개한다.
--   · 064 의 hwork_retry·hwork_review 는 지운다(화면이 더는 부르지 않음). 표·열·hwork_submit 은 064 그대로.
-- 다시 실행해도 안전하다. 064 를 다시 돌리면 그 뒤 065 도 다시 돌릴 것.

drop function if exists public.hwork_retry(jsonb);
drop function if exists public.hwork_review(jsonb);

-- 1차에 틀린 문항이 모두 클리어됐거나 선생님께 넘겼는지(도움 요청·오류 신고)
create or replace function public.hwork_fix_done_(detail jsonb, review jsonb)
returns boolean language sql immutable set search_path = public as $$
  select not exists (select 1 from jsonb_each(coalesce(detail,'{}'::jsonb)) e(k, v)
                      where (v->>'ok') = 'false'
                        and not (coalesce(review->k,'{}'::jsonb) ?| array['cleared_at','help','error']));
$$;

-- 클리어한 문항의 정답 {q: ans}
create or replace function public.hwork_cleared_ans_(detail jsonb, review jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, coalesce(detail->k->>'ans','')), '{}'::jsonb)
    from jsonb_each(coalesce(review,'{}'::jsonb)) e(k, v) where v ? 'cleared_at';
$$;

create or replace function public.hwork_fix(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; q text := coalesce(p->>'q',''); it jsonb; rv jsonb; cur jsonb; tries jsonb;
        wrong text; ww text; wr text; pick text; ok boolean; nwrong int; ncleared int; first_ok int;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  -- 같은 제출을 동시에 고치지 않게 줄을 잠근다
  select * into s from hwork_submissions
   where id = case when coalesce(p->>'id','') ~ '^\d{1,18}$' then (p->>'id')::bigint else -1 end
     and retry_key is not null and retry_key = coalesce(p->>'key','')
   for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다. 처음부터 다시 제출해 주세요.'); end if;
  it := s.detail->q;
  if it is null or coalesce(it->>'ok','') <> 'false' then
    return jsonb_build_object('ok', false, 'error', '오답하기 할 문항이 아닙니다.', 'reason', 'not_wrong');
  end if;
  rv := coalesce(s.review, '{}'::jsonb);
  cur := coalesce(rv->q, jsonb_build_object('tries', '[]'::jsonb));
  if cur ? 'cleared_at' then return jsonb_build_object('ok', false, 'error', '이미 클리어한 문항입니다.', 'reason', 'cleared'); end if;
  tries := coalesce(cur->'tries', '[]'::jsonb);
  wrong := case when jsonb_array_length(tries) = 0 then coalesce(it->>'mine','') else coalesce(tries->-1->>'pick','') end;
  ww := btrim(coalesce(p->>'why_wrong','')); wr := btrim(coalesce(p->>'why_right',''));
  pick := btrim(coalesce(p->>'pick',''));
  if ww = '' then return jsonb_build_object('ok', false, 'error', q || '번: 내가 틀린 답을 고른 이유를 적어 주세요.', 'reason', 'why_wrong'); end if;
  if pick = '' then return jsonb_build_object('ok', false, 'error', q || '번: 다시 고른 답을 넣어 주세요.', 'reason', 'pick'); end if;
  if wr = '' then return jsonb_build_object('ok', false, 'error', q || '번: 이 답이 정답인 이유를 적어 주세요.', 'reason', 'why_right'); end if;
  if char_length(ww) > 300 or char_length(wr) > 300 or char_length(pick) > 200 then
    return jsonb_build_object('ok', false, 'error', q || '번: 칸마다 300자까지 적을 수 있어요.', 'reason', 'long');
  end if;
  if it->>'type' = 'text' then ok := hwork_text_ok_(pick, it->>'ans');
  else ok := coalesce(it->>'ans','') <> '' and pick = it->>'ans'; end if;
  tries := tries || jsonb_build_array(jsonb_build_object('wrong', wrong, 'why_wrong', ww, 'pick', pick, 'why_right', wr, 'ok', ok, 'at', ts_now));
  cur := jsonb_set(cur, '{tries}', tries);
  if ok then cur := cur || jsonb_build_object('cleared_at', ts_now); end if;
  rv := rv || jsonb_build_object(q, cur);
  select count(*) into nwrong from jsonb_each(s.detail) e(k, v) where (v->>'ok') = 'false';  -- 응답용
  select count(*) filter (where v ? 'cleared_at'),
         count(*) filter (where v ? 'cleared_at' and jsonb_array_length(v->'tries') = 1)
    into ncleared, first_ok from jsonb_each(rv) e(k, v);
  update hwork_submissions
     set review = rv, retry_got = first_ok, retry_at = coalesce(retry_at, ts_now),
         review_at = case when hwork_fix_done_(s.detail, rv) then coalesce(review_at, ts_now) else null end
   where id = s.id;
  return jsonb_build_object('ok', true, 'q', q, 'correct', ok, 'wrong', case when ok then null else pick end,
    'tries', jsonb_array_length(tries), 'cleared', ncleared, 'total', nwrong, 'done', hwork_fix_done_(s.detail, rv),
    'ans', case when ok then it->>'ans' else null end);
end $$;

create or replace function public.hwork_flag(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; q text := coalesce(p->>'q',''); k text := coalesce(p->>'kind','');
        txt text := btrim(coalesce(p->>'text','')); it jsonb; rv jsonb; cur jsonb;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  select * into s from hwork_submissions
   where id = case when coalesce(p->>'id','') ~ '^\d{1,18}$' then (p->>'id')::bigint else -1 end
     and retry_key is not null and retry_key = coalesce(p->>'key','')
   for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  it := s.detail->q;
  if it is null or coalesce(it->>'ok','') <> 'false' then
    return jsonb_build_object('ok', false, 'error', '오답하기 할 문항이 아닙니다.', 'reason', 'not_wrong');
  end if;
  if k not in ('help','error') then return jsonb_build_object('ok', false, 'error', '알 수 없는 표시입니다.'); end if;
  if k = 'error' and txt = '' then return jsonb_build_object('ok', false, 'error', q || '번: 문항 오류 내용을 적어 주세요.', 'reason', 'text'); end if;
  if char_length(txt) > 300 then return jsonb_build_object('ok', false, 'error', '300자까지 적을 수 있어요.', 'reason', 'long'); end if;
  rv := coalesce(s.review, '{}'::jsonb);
  cur := coalesce(rv->q, jsonb_build_object('tries', '[]'::jsonb));
  if cur ? k then return jsonb_build_object('ok', false, 'error', '이미 표시했습니다.', 'reason', 'done'); end if;
  cur := cur || jsonb_build_object(k, jsonb_build_object('at', ts_now, 'text', txt));
  rv := rv || jsonb_build_object(q, cur);
  update hwork_submissions
     set review = rv, review_at = case when hwork_fix_done_(s.detail, rv) then coalesce(review_at, ts_now) else null end
   where id = s.id;
  return jsonb_build_object('ok', true, 'q', q, 'kind', k, 'at', ts_now, 'done', hwork_fix_done_(s.detail, rv));
end $$;

create or replace function public.hwork_retry_state(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hwork_submissions;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true,
    'stage', case when s.review_at is not null or hwork_fix_done_(s.detail, s.review) then 'done' else 'fix' end,
    'teacher', s.teacher, 'code', s.code, 'name', s.name, 'ts', s.ts,
    'got', s.got, 'total', s.total,
    'detail', hwork_hide_wrong_(s.detail),
    'review', s.review, 'answers', hwork_cleared_ans_(s.detail, s.review));
end $$;

revoke all on function public.hwork_cleared_ans_(jsonb, jsonb) from public;
revoke all on function public.hwork_fix_done_(jsonb, jsonb) from public;
revoke all on function public.hwork_fix(jsonb) from public;
revoke all on function public.hwork_flag(jsonb) from public;
grant execute on function public.hwork_flag(jsonb) to anon, authenticated;
revoke all on function public.hwork_retry_state(jsonb) from public;
grant execute on function public.hwork_fix(jsonb) to anon, authenticated;
grant execute on function public.hwork_retry_state(jsonb) to anon, authenticated;
