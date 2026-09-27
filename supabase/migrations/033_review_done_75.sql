-- ============================================================
-- 033: 복습 영상 완료 기준 90% → 75% (2026-09-27 사용자 "영상의 75%를 보면 완료 처리, 별 추가 없음.
--      결석자 보충이므로 포상이 되면 안됨")
--   · review_done_pct() 한 곳만 바꾸면 review_save·review_list·review_open 이 모두 따라간다.
--   · 이미 75% 이상 봤지만 90%에 못 미쳐 완료가 안 된 줄은 지금 완료로 적는다.
--   · 슈퍼스타 별은 페이지(s.html·superstar.html)에서 더 이상 세지 않는다 — completed_at 은 '완료' 표시로만 쓴다.
--     student_bundle 의 review_done 항목은 남겨 두었다(화면이 쓰지 않으면 영향 없음).
-- 031·032 뒤에 실행할 것.
-- ============================================================

create or replace function public.review_done_pct() returns int language sql immutable as $$ select 75 $$;
grant execute on function public.review_done_pct() to anon, authenticated;

update public.review_watch set completed_at = now()
 where completed_at is null and pct >= 75;
