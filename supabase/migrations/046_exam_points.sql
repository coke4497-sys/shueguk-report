-- ============================================================
-- 046 · 지필 리포트 문항 배점 — 복기 점수 자동 계산 (2026-10-08 원장님 요청)
-- ============================================================
-- 원장님: "틀린 문제 체크와 본인의 점수가 차이가 큰 친구들이 있어요. 예상점수를 적는 칸을
--          점수로 바꾸고 틀린 문항을 체크하면 점수가 자동으로 기록되도록"
-- · exam_questions.pts(배점, 0 = 미지정). 시험 등록(m.html)에서 문항마다 적고, 복기 화면(r.html)은
--   100점에서 틀린 문항 배점을 빼 점수를 만든다. 배점이 하나도 없는 옛 시험은 문항당 100÷문항 수.
-- · exam_bundle 이 배점을 함께 돌려준다(복기 화면이 이 함수로 문항을 읽는다). submissions.score 는 그대로
--   (텍스트 — 이제 자동 계산값이 들어간다). student_bundle 의 exam_questions 는 학생 화면이 배점을
--   쓰지 않아 그대로 둔다.
-- · 시트 사본 '문항' 탭에는 J열 '배점'(백엔드 createReport·getReport — 재배포 필요).

alter table public.exam_questions add column if not exists pts numeric not null default 0;

create or replace function public.exam_bundle(p_report_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare e public.exams%rowtype;
begin
  select * into e from public.exams where report_id = p_report_id limit 1;
  if e.report_id is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'title', e.title, 'scope', e.scope, 'review', e.review,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'no', q.no, 'area', q.area, 'qtype', q.qtype, 'lv', q.lv, 'txt', q.txt,
        'detail', q.detail, 'grp', q.grp, 'multi', q.multi, 'pts', q.pts) order by q.seq), '[]'::jsonb)
      from public.exam_questions q where q.report_id = e.report_id));
end $$;

revoke all on function public.exam_bundle(text) from public;
grant execute on function public.exam_bundle(text) to anon, authenticated;
