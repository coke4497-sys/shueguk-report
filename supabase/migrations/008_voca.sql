-- 008: 어휘 테스트 결과 미러 (2026-08-23)
-- 원본은 어휘 시트 「2026 어휘, 시작이 반이다(응답)」 첫 탭.
-- 열린 주차 판정(vocaStatus)·삭제 검증이 서버(Apps Script)에 있으므로 쓰기는 기존 백엔드가 담당,
-- 여기는 읽기 미러 — 학생 제출 훅 + 대시보드 삭제 훅 + 일일 점검(--voca)이 유지.
-- 시트 열은 폼 시절 혼합 구조지만 실제 사용 열은 A타임스탬프·B이름·C학교·D학년·F점수·I phone4·J round·K details.

create table if not exists voca_results (
  id bigint generated always as identity primary key,
  ts text not null default '',          -- 타임스탬프 'yyyy-MM-dd HH:mm' (KST, test.html이 보내는 문자열 그대로)
  name text not null default '',
  school text not null default '',
  grade text not null default '',       -- '고3' 형태
  phone4 text not null default '',
  round text not null default '',       -- 주차 (숫자 문자열)
  score text not null default '',       -- '12 / 17' 형태
  details text not null default ''      -- 문항별 결과 텍스트
);
create index if not exists voca_results_name_idx on voca_results (name);
create index if not exists voca_results_round_idx on voca_results (round);

alter table voca_results enable row level security;
drop policy if exists anon_all on voca_results;
create policy anon_all on voca_results for all using (true) with check (true);
