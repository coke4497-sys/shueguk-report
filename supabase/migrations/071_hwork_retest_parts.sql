-- ============================================================
-- 071 오답을 모은 리테스트 — 여러 과제·여러 학생 (2026-11-17 원장님 "오답 문항을 모아서 리테스트를 만들어주고 싶은데요" · "리테스트를 인쇄할 수도")
--   hwork_retests(다른 세션이 실제 DB 에 넣은 표, 070 참고)에 parts 를 더한다.
--   · parts jsonb = [{teacher, code, q}] — 리테스트 문항 순서대로(리테스트 n번 = parts[n-1]). qs 는 ["1".."N"].
--     parts 가 없으면 예전처럼 한 과제(teacher·code)의 qs 번호(질문함 [리테스트 내기]).
--     여러 과제를 모으면 code 는 리테스트 제목('오답 모음 · 문장 1권 01 외 2개').
--   · hwork_retest_open — parts 면 문항마다 그 과제의 종류(items)와 출처(parts)를 함께. 정답은 싣지 않는다.
--   · hwork_retest_submit — parts 면 문항마다 그 과제의 지금 정답으로 채점(069 hwork_ans_ok_ · '*').
--   만드는 곳: shueguk-h-work retest_make.html(교사 계정이 표에 직접 넣음 — RLS teacher_all).
-- 다시 실행해도 안전하다. 그 세션의 067 이나 070 을 다시 돌리면 그 뒤 071 도.
-- ============================================================

alter table public.hwork_retests add column if not exists parts jsonb;

create or replace function public.hwork_retest_open(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.hwork_retests; hw record; items jsonb;
begin
  r := hwork_retest_row_(p);
  if r.id is null then return jsonb_build_object('ok', false, 'error', '리테스트를 찾을 수 없습니다.'); end if;
  if jsonb_typeof(r.parts) = 'array' then
    select coalesce(jsonb_object_agg(e.n::text, jsonb_build_object('type', coalesce(h.data->'items'->(e.v->>'q')->>'type', 'choice5'))), '{}'::jsonb)
      into items
      from jsonb_array_elements(r.parts) with ordinality e(v, n)
      left join hwork_homeworks h on h.teacher = e.v->>'teacher' and h.code = e.v->>'code';
  else
    select * into hw from hwork_homeworks where teacher = r.teacher and code = r.code limit 1;
    if not found then return jsonb_build_object('ok', false, 'error', '원래 과제를 찾을 수 없습니다. 선생님께 알려 주세요.'); end if;
    select coalesce(jsonb_object_agg(q, jsonb_build_object('type', coalesce(hw.data->'items'->q->>'type', 'choice5'))), '{}'::jsonb)
      into items from jsonb_array_elements_text(r.qs) q;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'teacher', r.teacher, 'code', r.code, 'name', r.name,
    'qs', r.qs, 'items', items, 'parts', r.parts, 'submitted', r.submitted_at is not null, 'submitted_at', r.submitted_at,
    'got', r.got, 'total', r.total, 'answers', r.answers, 'detail', hwork_hide_wrong_(r.detail));
end $$;

create or replace function public.hwork_retest_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.hwork_retests; hw record; q text; item jsonb; mine text; ok boolean; pt jsonb;
        det jsonb := '{}'::jsonb; ans jsonb := '{}'::jsonb; v_got int := 0; v_tot int := 0;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  r := hwork_retest_row_(p);
  if r.id is null then return jsonb_build_object('ok', false, 'error', '리테스트를 찾을 수 없습니다.'); end if;
  select * into r from hwork_retests where id = r.id for update;   -- 두 번 눌러도 한 번만 채점
  if r.submitted_at is not null then
    return jsonb_build_object('ok', false, 'error', '이미 제출한 리테스트입니다.', 'reason', 'done',
      'got', r.got, 'total', r.total, 'detail', hwork_hide_wrong_(r.detail));
  end if;
  if jsonb_typeof(r.parts) <> 'array' or r.parts is null then
    select * into hw from hwork_homeworks where teacher = r.teacher and code = r.code limit 1;
    if not found then return jsonb_build_object('ok', false, 'error', '원래 과제를 찾을 수 없습니다. 선생님께 알려 주세요.'); end if;
  end if;
  for q in select jsonb_array_elements_text(r.qs) loop
    if jsonb_typeof(r.parts) = 'array' then
      pt := r.parts->(q::int - 1);
      select h.data->'items'->(pt->>'q') into item from hwork_homeworks h where h.teacher = pt->>'teacher' and h.code = pt->>'code' limit 1;
      item := coalesce(item, '{}'::jsonb);
    else
      item := coalesce(hw.data->'items'->q, '{}'::jsonb);
    end if;
    mine := btrim(coalesce(p->'answers'->>q, ''));
    if char_length(mine) > 200 then mine := left(mine, 200); end if;
    if item->>'type' = 'essay' then continue; end if;
    if coalesce(item->>'ans','') = '*' then ok := true;
    elsif item->>'type' = 'text' then ok := hwork_text_ok_(mine, item->>'ans');
    else ok := hwork_ans_ok_(mine, item->>'ans'); end if;
    v_tot := v_tot + 1; if ok then v_got := v_got + 1; end if;
    ans := ans || jsonb_build_object(q, mine);
    det := det || jsonb_build_object(q, jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
                                       || jsonb_build_object('mine', mine, 'ans', coalesce(item->>'ans',''), 'ok', ok));
  end loop;
  update hwork_retests set answers = ans, detail = det, got = v_got, total = v_tot, submitted_at = ts_now where id = r.id;
  return jsonb_build_object('ok', true, 'got', v_got, 'total', v_tot, 'submitted_at', ts_now, 'detail', hwork_hide_wrong_(det));
end $$;

revoke all on function public.hwork_retest_open(jsonb), public.hwork_retest_submit(jsonb) from public;
grant execute on function public.hwork_retest_open(jsonb), public.hwork_retest_submit(jsonb) to anon, authenticated;
