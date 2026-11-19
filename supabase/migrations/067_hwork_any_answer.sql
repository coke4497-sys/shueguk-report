-- 067: H WORK 정답 없는 문항 = 모두 정답 (2026-11-16 원장님)
-- 「문장 1권 02 서술어 자릿수·필수 성분 · 기본」 33번 오류 신고(수정 요청함 827) — 원장님 "33번 답이 없음" → '모두 정답 처리'.
-- 문항의 ans 가 '*' 이면 어떤 답(빈 답 포함)이든 정답으로 채점하고, 결과의 정답 칸은 '모두 정답'으로 보낸다.
-- 그래서 그 문항은 오답하기(hwork_fix) 대상이 되지 않는다.
-- 063 hwork_grade_ 본문 그대로 + 한 갈래. shueguk-h-work apps-script/Code.gs gradeOne 과 같은 규칙(두 벌 — 고치면 함께).
-- 다시 실행해도 안전하다. 063 을 다시 돌리면 그 뒤 067 도 다시 돌릴 것.

create or replace function public.hwork_grade_(data jsonb, answers jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
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
      ok := (item->>'ans') is not null and mine = item->>'ans';   -- choice5 · ox 공통 (문자 비교)
    end if;
    if ok is not null then graded := graded + 1; end if;
    if ok then got := got + 1; end if;
    detail := detail || jsonb_build_object(q::text,
      jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
      || jsonb_build_object('mine', mine, 'ans', case when item->>'ans' = '*' then '모두 정답' else coalesce(item->>'ans','') end, 'ok', ok));
  end loop;
  return jsonb_build_object('got', got, 'total', graded, 'count', cnt, 'detail', detail);
end $$;

revoke all on function public.hwork_grade_(jsonb, jsonb) from public;
grant execute on function public.hwork_grade_(jsonb, jsonb) to authenticated;
