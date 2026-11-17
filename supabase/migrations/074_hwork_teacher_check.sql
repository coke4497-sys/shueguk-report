-- ============================================================
-- 074 H WORK 선생님 확인 · 과제 검사 완료 · 학생 하트 팝업 · 답장 길이 (2026-11-17 원장님 "이런 문항은 답장이 필요 없어요. 선생님 확인 버튼을 …
--     학생이 다시 이 페이지에 들어갔을 때 하트 뿅뿅 사인을 통해 선생님이 애정을 가지고 이 과제를 검사했다는 팝업" · "답변 칸이 너무 짧아요")
--   · hwork_submissions.checked jsonb {문항: {at, by}} — 선생님 채점 결과 화면의 문항별 [확인했어요]
--   · hwork_submissions.check_done jsonb {at, by, note} — [과제 검사 완료 · 하트 보내기](한마디는 선택)
--   · hwork_submissions.check_seen_at text — 학생이 하트 팝업을 본 때(이보다 늦은 확인이 생기면 다시 뜬다)
--     선생님은 교사 계정으로 표를 직접 고친다(teacher_all). 시각은 한국 시각 'YYYY-MM-DD HH24:MI' 문자열.
--   · hwork_retry_state — 실제 DB 본문 + checked·check_done·check_seen_at
--   · hwork_check_seen(p {id, key}) — 학생(제출 열쇠)이 팝업을 닫으면 지금 시각을 적는다
--   · hwork_qa 글 길이 1000 → 5000(선생님 답장이 늘 모자랐다 — 학생 질문은 hwork_qa_post 가 1000 그대로)
-- 다시 실행해도 안전하다. 064·065·070 의 hwork_retry_state 를 다시 돌리면 그 뒤 074 도.
-- ============================================================

alter table public.hwork_submissions add column if not exists checked jsonb not null default '{}'::jsonb;
alter table public.hwork_submissions add column if not exists check_done jsonb;
alter table public.hwork_submissions add column if not exists check_seen_at text;

alter table public.hwork_qa drop constraint if exists hwork_qa_body_check;
alter table public.hwork_qa add constraint hwork_qa_body_check check (char_length(btrim(body)) between 1 and 5000);

create or replace function public.hwork_check_seen(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  update hwork_submissions set check_seen_at = ts_now where id = s.id;
  return jsonb_build_object('ok', true, 'at', ts_now);
end $$;
revoke all on function public.hwork_check_seen(jsonb) from public;
grant execute on function public.hwork_check_seen(jsonb) to anon, authenticated;

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
    'checked', coalesce(s.checked, '{}'::jsonb), 'check_done', s.check_done, 'check_seen_at', s.check_seen_at);
end $function$;
