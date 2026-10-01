-- ============================================================
-- 042: 수업 리포트를 옛 주간 형식으로 쓰지 못하게 막는다 (2026-10-01 사용자 "다른 세션이 옛 형식으로 쓰지 않게 고쳐 주세요")
--
--   · 040 이후 학생 페이지(class_history)는 반ID·수업 날짜가 있는 줄만 보여 준다. 같은 날 다른 클로슈 세션이 바뀌기 전
--     절차로 10/1 고3파이널A 리포트 7장을 주간 형식(class_id 빈 값·ymd 없음·body.parts)으로 써서 '공개'인데도
--     학생 화면에 안 나왔다(새 형식으로 다시 쓰고 옛 줄은 지움).
--   · 이제 그런 줄은 DB가 거절한다 — 반ID가 비었거나, 수업 날짜가 없거나, body 에 옛 주간 형식 키(parts)가 있으면 저장 오류.
--     옛 도구·옛 절차로 써도 조용히 '공개'로 남지 않고 실패가 드러난다.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'class_reports_session_check') then
    alter table public.class_reports add constraint class_reports_session_check
      check (class_id <> '' and ymd is not null and not (coalesce(body, '{}'::jsonb) ? 'parts'));
  end if;
end $$;
