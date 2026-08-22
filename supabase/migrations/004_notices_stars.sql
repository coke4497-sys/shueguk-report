-- ============================================================
-- 슈국 수파베이스 이전 4단계(a): 공지·공지확인·별(보너스) — 리포트 시트의 남은 탭
-- 셋 다 **시트가 원본**(공지 확인·별 적립은 학생 페이지가 기존 백엔드로 기록).
-- 여기 미러는 앞으로의 s.html 전환·통계용이며, 페이지 어댑터의 재동기화와
-- 일일 점검 루틴이 신선도를 유지한다.
-- ============================================================

-- 시트 '공지' (A:작성일 B:대상유형 C:대상 D:제목 E:내용 F:게시)
create table if not exists notices (
  id bigint generated always as identity primary key,
  seq int not null default 0,          -- 시트 행 순서
  date text not null default '',       -- 작성일 (yyyy-MM-dd 문자열)
  type text not null default '',       -- 전체/학년/개인/일부
  target text not null default '',
  title text not null default '',
  body text not null default '',
  hidden boolean not null default false
);

-- 시트 '공지확인' (A:일시 B:학생ID C:이름 D:학교 E:공지키)
create table if not exists notice_reads (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  student_id text not null default '',
  name text not null default '',
  school text not null default '',
  notice_key text not null default ''
);
create index if not exists notice_reads_key_idx on notice_reads (notice_key);
create index if not exists notice_reads_sid_idx on notice_reads (student_id);

-- 시트 '별' (A:일시 B:학생ID C:이름 D:학교 E:별 F:사유 G:학년)
create table if not exists star_bonus (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  student_id text not null default '',
  name text not null default '',
  school text not null default '',
  stars int not null default 0,
  reason text not null default '',
  grade text not null default ''
);
create index if not exists star_bonus_name_idx on star_bonus (name);

do $$
declare t text;
begin
  foreach t in array array['notices','notice_reads','star_bonus'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
