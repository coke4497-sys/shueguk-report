-- 063: H WORK 서술형 — 채점하지 않고 예시 답과 비교 (2026-11-10 원장님)
-- "서술형은 정답 입력 후 OX 채점을 하지 않고 예시 답 보기(본인의 답안과 비교해 보세요)로 처리"
-- 문항 종류 'essay'를 더한다(기존 'text' = 키워드 채점 단답형은 그대로).
--   · essay 문항은 채점하지 않는다 — detail 의 ok 는 null, 맞은 개수(got)·채점 문항 수(total)에서 뺀다.
--   · 결과에 count(전체 문항 수)를 더해 화면이 서술형 줄까지 그리게 한다.
--   · ans 에는 예시 답 원문이 들어 있고, 제출 뒤 결과로만 학생에게 간다(hwork_meta 는 type 만 — 020 그대로).
-- shueguk-h-work apps-script/Code.gs gradeOne/submit 과 같은 규칙(두 벌 — 고치면 함께).
-- 020 의 다른 함수·권한은 바꾸지 않는다. 다시 실행해도 안전하다.

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
    elsif item->>'type' = 'text' then
      ok := hwork_text_ok_(mine, item->>'ans');
    else
      ok := (item->>'ans') is not null and mine = item->>'ans';   -- choice5 · ox 공통 (문자 비교)
    end if;
    if ok is not null then graded := graded + 1; end if;
    if ok then got := got + 1; end if;
    detail := detail || jsonb_build_object(q::text,
      jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
      || jsonb_build_object('mine', mine, 'ans', coalesce(item->>'ans',''), 'ok', ok));
  end loop;
  return jsonb_build_object('got', got, 'total', graded, 'count', cnt, 'detail', detail);
end $$;

revoke all on function public.hwork_grade_(jsonb, jsonb) from public;
grant execute on function public.hwork_grade_(jsonb, jsonb) to authenticated;
