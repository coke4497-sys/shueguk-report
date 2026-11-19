-- 083: Shuefit 독서 문제지에 학습 자료(핵심정리·문단별 정리·지문 분석·정오답 선지 근거·요약 빈칸)도 담는다
-- (2026-11-19 원장님 화면 개편 3단계 "진행해 주세요" — '골라서 인쇄'를 없애고 모든 인쇄를 문제지 → 내 문제지함 한 길로).
-- 학습 자료는 문항(reading_items)이 아니라 지문(reading_passages.data)에 들어 있어 ids(integer[])에 넣을 수 없다.
-- seq = 문제지에 실리는 차례 전체 — 문항은 숫자(reading_items.id), 학습 자료는 'm:<지문 id>:<종류>'(notes·analysis·keys·10) 글자.
-- ids 는 그대로 문항만(낸 적 있는 문항 세기·H WORK·옛 화면이 읽는다). seq 가 비어 있으면(옛 문제지) ids 차례대로 문항만.
-- 다시 실행해도 안전하다. 권한·정책은 080 그대로(교사 전용, 공개 키 차단).

alter table public.shufit_reading_papers add column if not exists seq jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shufit_reading_papers_seq_array') then
    alter table public.shufit_reading_papers add constraint shufit_reading_papers_seq_array
      check (seq is null or (jsonb_typeof(seq) = 'array' and jsonb_array_length(seq) <= 600));
  end if;
end $$;

comment on column public.shufit_reading_papers.seq is
  '문제지 차례 전체 — 문항 = reading_items.id(숫자), 학습 자료 = ''m:지문id:종류''(글자). 비면 ids 차례(옛 문제지).';
