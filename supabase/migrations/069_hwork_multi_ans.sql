-- ============================================================
-- 069 H WORK 객관식 복수 정답 (2026-11-17 원장님 "단어 형성 5번은 ③, ④ 둘 다 정답 처리해줘")
--   · 정답 칸(ans)에 '3,4' 처럼 쉼표로 여러 번호를 적으면 그중 하나를 고르면 정답.
--   · '*'(모두 정답 — 실제 DB 에만 있던 규칙)를 저장소에 함께 옮겼다. hwork_fix(오답하기 재채점)도 같은 규칙.
--   · 채점 규칙 두 벌 — 이 파일 hwork_ans_ok_ 와 H WORK apps-script/Code.gs gradeOne.
-- 다시 실행해도 안전하다. 063·065·066 을 다시 돌리면 그 뒤 069 도.
-- ============================================================

create or replace function public.hwork_ans_ok_(mine text, ans text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when ans is null or btrim(ans) = '' then false
    when position(',' in ans) > 0 then btrim(coalesce(mine,'')) <> ''
         and btrim(mine) = any (select btrim(x) from unnest(string_to_array(ans, ',')) x)
    else coalesce(mine,'') = ans end
$$;
revoke all on function public.hwork_ans_ok_(text, text) from public;

CREATE OR REPLACE FUNCTION public.hwork_grade_(data jsonb, answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare cnt int := case when coalesce(data->>'count','') ~ '^\d+$' then (data->>'count')::int else 0 end;
        got int := 0; graded int := 0; detail jsonb := '{}'::jsonb;
        q int; item jsonb; mine text; ok boolean;
begin
  for q in 1..cnt loop
    item := coalesce(data->'items'->(q::text), '{}'::jsonb);
    mine := coalesce(answers->>(q::text), '');
    if item->>'type' = 'essay' then
      ok := null;                                                  -- 채점 안 함 (예시 답과 비교)
    elsif coalesce(item->>'ans','') = '*' then
      ok := true;                                                  -- 정답 없는 문항 = 모두 정답 (067)
    elsif item->>'type' = 'text' then
      ok := hwork_text_ok_(mine, item->>'ans');
    else
      ok := hwork_ans_ok_(mine, item->>'ans');                    -- choice5 · ox 공통 (복수 정답 '3,4' 포함)
    end if;
    if ok is not null then graded := graded + 1; end if;
    if ok then got := got + 1; end if;
    detail := detail || jsonb_build_object(q::text,
      jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
      || jsonb_build_object('mine', mine, 'ans', case when item->>'ans' = '*' then '모두 정답' else coalesce(item->>'ans','') end, 'ok', ok));
  end loop;
  return jsonb_build_object('got', got, 'total', graded, 'count', cnt, 'detail', detail);
end $function$;

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
         count(*) filter (where v ? 'cleared_at' and jsonb_array_length(v->'tries') = 1)
    into ncleared, first_ok from jsonb_each(rv) e(k, v);
  update hwork_submissions
     set review = rv, retry_got = first_ok, retry_at = coalesce(retry_at, ts_now),
         review_at = case when hwork_fix_done_(s.detail, rv) then coalesce(review_at, ts_now) else null end
   where id = s.id;
  return jsonb_build_object('ok', true, 'q', q, 'correct', ok, 'wrong', case when ok then null else pick end,
    'tries', jsonb_array_length(tries), 'cleared', ncleared, 'total', nwrong, 'done', hwork_fix_done_(s.detail, rv),
    'ans', case when ok then it->>'ans' else null end);
end $function$;
grant execute on function public.hwork_ans_ok_(text, text) to authenticated;
