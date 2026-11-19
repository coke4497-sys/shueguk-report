-- 080: Shuefit 독서 — 교과서 지문 묶음(국어공방 '비문학 문제 풀이', 2026-11-19 원장님 "네, 파일명은 [교과서명]단원(작가명)").
-- 079 의 모의고사 묶음(원 기출 '공통' + 기본·실력)과 달리 난도 구분이 없어 reading_items.level 에 '교과서' 를 더한다.
-- 교과서 지문: reading_passages.kind = '교과서', srcname = '비상 독서와 작문 5-(1)-1',
--   data = {passage, notes(문단별 정리), analysis(지문 분석), blanks(문단별 정리 빈칸), keys(정오답 선지 근거), book, unit, author}.
-- 문항 code(교과서): 11 OX 쉬움 · 12 OX 어려움 · 13 모의고사형 · 14 보기형 · 15 고난도 보기형 · 16 1등급 보기형 ·
--   17 주관식 · 18 조건형 서술 · 19 키워드 빈칸 (모의고사 묶음 00·02~10·99 와 겹치지 않음).
-- 올리기는 tools/reading_load.py build (.hwp → tools/reading_hwp5.py). 권한·정책은 079 그대로.

alter table public.reading_items drop constraint if exists reading_items_level_check;
alter table public.reading_items add constraint reading_items_level_check
  check (level in ('공통', '기본', '실력', '교과서'));
