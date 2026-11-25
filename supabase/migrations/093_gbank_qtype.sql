-- ============================================================
-- 093 — Shuefit 문법 문항 은행에 OX·단답 문항 (2026-11-25 원장님 "[슈핏]중세국어 문제지 출제" — 슈국 문법 매뉴얼 TEST 4-47)
--   · gbank_items.qtype  — 'choice5'(5지선다, 지금까지 문항 전부) · 'ox' · 'short'(단답 — H WORK 에서는 예시 답과 비교)
--   · gbank_items.answer — 화면에 보일 정답 글('③' · 'O' · '바미, 새, ᄉᆈ'). 5지선다는 비워 둬도 된다(ans 로 셈).
--   · ans 제약을 종류에 맞게 — 5지선다 1~5 · OX 1(O)/2(X) · 단답 0.
--   · hwork_expl — 075 본문 그대로 + 문항 은행 문항이면 'qtype'·'ans_text'(학생 해설 머리의 '정답 ○')를 함께 돌려준다.
--   슈국 자체 자료는 번호 100000 부터(tools/gbank_manual.py), 모의고사 문항(tools/gbank_load.py)은 그 아래.
-- 다시 실행해도 안전하다. 067·068·075 를 다시 돌리면 hwork_expl 이 옛 본문으로 돌아가니 그 뒤 093 도.
-- ============================================================
alter table public.gbank_items add column if not exists qtype  text not null default 'choice5';
alter table public.gbank_items add column if not exists answer text not null default '';

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.gbank_items'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~ '\mans\M' and conname <> 'gbank_items_ans_ok'
  loop
    execute format('alter table public.gbank_items drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbank_items'::regclass and conname = 'gbank_items_qtype_ok') then
    alter table public.gbank_items add constraint gbank_items_qtype_ok check (qtype in ('choice5', 'ox', 'short'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbank_items'::regclass and conname = 'gbank_items_ans_ok') then
    alter table public.gbank_items add constraint gbank_items_ans_ok check (
      (qtype = 'choice5' and ans between 1 and 5) or (qtype = 'ox' and ans in (1, 2)) or (qtype = 'short' and ans = 0));
  end if;
end $$;

create or replace function public.hwork_expl(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hwork_submissions; hw record; q text := coalesce(p->>'q',''); g record; r record; d jsonb;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  d := s.detail->q;
  if d is null then return jsonb_build_object('ok', false, 'error', '없는 문항입니다.'); end if;
  if coalesce(d->>'ok','') <> 'true' and not (coalesce(s.review->q,'{}'::jsonb) ? 'cleared_at') then
    return jsonb_build_object('ok', false, 'error', '정답을 맞히거나 오답하기로 클리어하면 해설을 볼 수 있어요.', 'reason', 'locked');
  end if;
  select * into hw from hwork_homeworks where teacher = s.teacher and code = s.code limit 1;
  if coalesce(jsonb_typeof(hw.data->'bank'), '') = 'object' then
    select * into g from gbank_items where id::text = coalesce(hw.data->'bank'->>q, '');
    if g.id is null then return jsonb_build_object('ok', false, 'error', '해설이 없는 문항입니다.', 'reason', 'none'); end if;
    return jsonb_build_object('ok', true, 'q', q, 'ans', g.ans, 'good', g.good, 'bad', g.bad, 'qtype', g.qtype,
      'ans_text', case when g.qtype = 'choice5' then substr('①②③④⑤', g.ans, 1) else g.answer end);
  end if;
  select * into r from hwork_src_items x where x.code = s.code and x.no::text = q and x.active;
  if not found then return jsonb_build_object('ok', false, 'error', '해설이 없는 문항입니다.', 'reason', 'none'); end if;
  return jsonb_build_object('ok', true, 'q', q, 'kind', 'src', 'type', r.type, 'ans_text', r.ans, 'essay', r.essay, 'err', r.err,
                            'expl', r.expl, 'wrong', r.wrong);
end $$;

grant execute on function public.hwork_expl(jsonb) to anon, authenticated;
