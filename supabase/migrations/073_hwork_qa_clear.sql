-- ============================================================
-- 073 H WORK 선생님 답장을 보고 '이해했어요' → 클리어 (2026-11-17 원장님 "학생이 답변을 보고 이해가 되었으면 클리어 버튼을, 재질문하려면 다시 질문을 기록하는 버튼")
--   · hwork_qa_clear(p {id, key, q}) — 학생(제출 열쇠)이 그 문항에 선생님 답장이 있을 때만. review[q].understood_at = 지금(한국 시각 'YYYY-MM-DD HH24:MI').
--     1차에 틀렸고 아직 클리어 전이면 cleared_at·via 'qa'(답장으로 이해)도 — 정답이 열리고 오답하기 끝냄(review_at)도 다시 센다.
--     맞힌 문항·이미 클리어한 문항은 understood_at 만.
--   · 다시 질문은 지금처럼 hwork_qa_post — 072 트리거가 새 '대기' 할 일을 만든다.
--   · hwork_fix — 069 본문(실제 DB 와 같음 확인) + retry_got(1차 시도에 클리어한 수)에서 via 'qa' 를 뺀다.
-- 다시 실행해도 안전하다. 069 를 다시 돌리면 그 뒤 073 도.
-- ============================================================

create or replace function public.hwork_qa_clear(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; v_q text := btrim(coalesce(p->>'q','')); it jsonb; rv jsonb; cur jsonb; cleared boolean := false; first_ok int;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  select * into s from hwork_submissions
   where id = case when coalesce(p->>'id','') ~ '^\d{1,18}$' then (p->>'id')::bigint else -1 end
     and retry_key is not null and retry_key = coalesce(p->>'key','')
   for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  it := s.detail->v_q;
  if it is null then return jsonb_build_object('ok', false, 'error', '없는 문항입니다.', 'reason', 'q'); end if;
  if not exists (select 1 from hwork_qa a where a.sub_id = s.id and a.q = v_q and a.who = '선생님') then
    return jsonb_build_object('ok', false, 'error', '선생님 답장이 온 뒤에 누를 수 있어요.', 'reason', 'no_reply');
  end if;
  rv := coalesce(s.review, '{}'::jsonb);
  cur := coalesce(rv->v_q, jsonb_build_object('tries', '[]'::jsonb)) || jsonb_build_object('understood_at', ts_now);
  if coalesce(it->>'ok','') = 'false' and coalesce(it->>'type','') <> 'essay' and not (cur ? 'cleared_at') then
    cur := cur || jsonb_build_object('cleared_at', ts_now, 'via', 'qa'); cleared := true;
  end if;
  rv := rv || jsonb_build_object(v_q, cur);
  select count(*) filter (where v ? 'cleared_at' and coalesce(v->>'via','') <> 'qa' and jsonb_array_length(coalesce(v->'tries','[]'::jsonb)) = 1)
    into first_ok from jsonb_each(rv) e(k, v);
  update hwork_submissions
     set review = rv,
         retry_got = case when cleared then first_ok else retry_got end,
         retry_at = case when cleared then coalesce(retry_at, ts_now) else retry_at end,
         review_at = case when hwork_fix_done_(s.detail, rv) then coalesce(review_at, ts_now) else null end
   where id = s.id;
  return jsonb_build_object('ok', true, 'q', v_q, 'cleared', cleared, 'at', ts_now, 'review', cur,
    'ans', case when cur ? 'cleared_at' then it->>'ans' else null end, 'done', hwork_fix_done_(s.detail, rv));
end $$;
revoke all on function public.hwork_qa_clear(jsonb) from public;
grant execute on function public.hwork_qa_clear(jsonb) to anon, authenticated;

-- 069 본문 + retry_got 에서 via 'qa' 제외
CREATE OR REPLACE FUNCTION public.hwork_fix(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  elsif coalesce(it->>'ans','') = '*' then ok := true;
  else ok := hwork_ans_ok_(pick, it->>'ans'); end if;
  tries := tries || jsonb_build_array(jsonb_build_object('wrong', wrong, 'why_wrong', ww, 'pick', pick, 'why_right', wr, 'ok', ok, 'at', ts_now));
  cur := jsonb_set(cur, '{tries}', tries);
  if ok then cur := cur || jsonb_build_object('cleared_at', ts_now); end if;
  rv := rv || jsonb_build_object(q, cur);
  select count(*) into nwrong from jsonb_each(s.detail) e(k, v) where (v->>'ok') = 'false';  -- 응답용
  select count(*) filter (where v ? 'cleared_at'),
         count(*) filter (where v ? 'cleared_at' and coalesce(v->>'via','') <> 'qa' and jsonb_array_length(coalesce(v->'tries','[]'::jsonb)) = 1)
    into ncleared, first_ok from jsonb_each(rv) e(k, v);
  update hwork_submissions
     set review = rv, retry_got = first_ok, retry_at = coalesce(retry_at, ts_now),
         review_at = case when hwork_fix_done_(s.detail, rv) then coalesce(review_at, ts_now) else null end
   where id = s.id;
  return jsonb_build_object('ok', true, 'q', q, 'correct', ok, 'wrong', case when ok then null else pick end,
    'tries', jsonb_array_length(tries), 'cleared', ncleared, 'total', nwrong, 'done', hwork_fix_done_(s.detail, rv),
    'ans', case when ok then it->>'ans' else null end);
end $function$;
