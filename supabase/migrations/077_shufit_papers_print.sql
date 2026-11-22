-- 077: Shuefit 문법 문제지 — 인쇄 날짜·학교를 문제지에 함께 저장 (2026-11-17 원장님 "데이터베이스에 저장해서 다른 기기에서도 보이게").
-- 허브 shufit_grammar.html 의 날짜(#pDate)·학교(#pSchool) 칸. 그전에는 이 기기 localStorage(sf_pmeta)에만 기억했다.
-- 둘 다 선택 — 비면 인쇄물에 빈칸. 권한·정책은 076 그대로(교사 전용).
alter table public.shufit_papers add column if not exists print_date date;
alter table public.shufit_papers add column if not exists school text not null default '' check (char_length(school) <= 30);
