-- 009: 학생 페이지(s.html) 완전 전환 — 배정·설정 미러 (2026-08-23)
-- 원본은 리포트 시트 '배정'·'설정' 탭 (기존 백엔드가 계속 씀).
-- s.html이 getStudent 서버 조립 대신 수파베이스에서 직접 조립하기 위한 마지막 조각.

-- '배정' 탭 (A작성일 B도구 C항목 D대상유형 E대상 F마감 G비고)
create table if not exists assignments (
  id bigint generated always as identity primary key,
  seq int not null default 0,        -- 시트 행 번호(assignList rowIndex) — 정렬·최신순용
  date text not null default '',     -- 작성일 'yyyy-MM-dd'
  tool text not null default '',     -- H WORK / 클리닉 / 지필고사 분석지
  item text not null default '',     -- '강사 / 제목' 또는 시험ID
  type text not null default '',     -- 대상유형 (전체/학년/개인/일부)
  target text not null default '',
  due text not null default '',
  memo text not null default ''
);
create index if not exists assignments_tool_idx on assignments (tool);

-- '설정' 탭 미러 — s.html이 쓰는 항목만 (어휘 테스트 열림/중단, 어휘 주차)
create table if not exists report_config (
  key text primary key,
  value text not null default ''
);

do $$
declare t text;
begin
  foreach t in array array['assignments','report_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
