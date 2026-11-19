-- 085: Shuefit 화법·작문 — 독서·문학과 같은 표·같은 화면(2026-11-19 원장님 "화법·작문 화면도 만들어 주세요").
-- reading_passages.subject · shufit_reading_papers.subject 에 '화법'·'작문'을 더한다(084 check 를 넓힘).
-- 다시 실행해도 안전하다. 권한·정책은 079·080·084 그대로.
alter table public.reading_passages drop constraint if exists reading_passages_subject_check;
alter table public.reading_passages add constraint reading_passages_subject_check check (subject in ('독서','문학','화법','작문'));
alter table public.shufit_reading_papers drop constraint if exists shufit_reading_papers_subject_check;
alter table public.shufit_reading_papers add constraint shufit_reading_papers_subject_check check (subject in ('독서','문학','화법','작문'));
comment on column public.reading_passages.subject is '독서 | 문학 | 화법 | 작문 — Shuefit 화면이 이 값으로 가른다(084·085).';
comment on column public.shufit_reading_papers.subject is '독서 | 문학 | 화법 | 작문 — 문제지가 어느 화면 것인지(084·085). 열쇠 = (subject, teacher, title).';
