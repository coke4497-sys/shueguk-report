-- 010: 슈퍼스타 순위 캐시 (2026-08-23)
-- 순위 계산(별 집계)은 교사 페이지(superstar.html)가 수파베이스 데이터로 직접 수행하고,
-- 그 결과 상위 30명만 여기에 저장한다. 학생 화면(s.html TOP30)은 이 표만 읽는다 —
-- 학생 브라우저가 전교생 기록을 내려받지 않게 하기 위한 공개용 요약(이름·학교·학년·별 수).
-- 원본은 여전히 각 기록 표들이며, 이 표는 언제든 다시 계산해 덮어써도 되는 캐시다.

create table if not exists star_ranking (
  rank int primary key,
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  total int not null default 0,
  updated_at timestamptz not null default now()
);

alter table star_ranking enable row level security;
drop policy if exists anon_all on star_ranking;
create policy anon_all on star_ranking for all using (true) with check (true);
