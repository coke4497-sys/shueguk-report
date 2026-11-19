-- ============================================================
-- 075 — 교재 문제 원문(hwork_src_items)에 해설 칸 (2026-11-17 원장님 "해설도 넣어줘")
--   · hwork_src_items.expl  — 정답 해설(지필 워크북 explanation / 서술형 채점 기준)
--   · hwork_src_items.wrong — 오답 해설(① … ② … — 지필 워크북 wrong_explanation)
--   · hwork_expl(p) — 068 본문 그대로 + 이 표 문항이면 'expl'·'wrong' 을 함께 돌려준다
--     (학생은 맞혔거나 오답하기로 클리어한 문항만 — 열리는 조건은 068 그대로).
-- 다시 실행해도 안전하다. 067·068 을 다시 돌리면 hwork_expl 이 옛 본문으로 돌아가니 그 뒤 075 도.
-- ============================================================
alter table public.hwork_src_items add column if not exists expl  text not null default '';
alter table public.hwork_src_items add column if not exists wrong text not null default '';

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
    return jsonb_build_object('ok', true, 'q', q, 'ans', g.ans, 'good', g.good, 'bad', g.bad);
  end if;
  select * into r from hwork_src_items x where x.code = s.code and x.no::text = q and x.active;
  if not found then return jsonb_build_object('ok', false, 'error', '해설이 없는 문항입니다.', 'reason', 'none'); end if;
  return jsonb_build_object('ok', true, 'q', q, 'kind', 'src', 'type', r.type, 'ans_text', r.ans, 'essay', r.essay, 'err', r.err,
                            'expl', r.expl, 'wrong', r.wrong);
end $$;

grant execute on function public.hwork_expl(jsonb) to anon, authenticated;
