-- ============================================================
-- 슈국 수파베이스 이전 2단계: 숙제 검사(hwcheck) + 내신 피드백(naeshin)
-- ============================================================

-- 시트 '숙제검사' (A일시 B주차 C접근코드 D이름 E학교 F학년 G항목점수JSON H만점 I점수%
--                J공개메모 K비공개메모 L상태('미제출') M대책 N대책완료('완료'))
create table if not exists hwcheck_records (
  id bigint generated always as identity primary key,
  week date not null,               -- 주차 수요일 (yyyy-MM-dd)
  token text not null,              -- 접근코드 (학생 키)
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  scores jsonb not null default '{}',   -- {항목: 0~6}
  max int not null default 0,
  pct int not null default 0,
  pub text not null default '',
  priv text not null default '',
  missing boolean not null default false,
  plan text not null default '',
  plan_done boolean not null default false,
  at timestamptz not null default now(),
  unique (week, token)              -- 주차·학생당 1행 (덮어쓰기 규칙과 동일)
);
create index if not exists hwcheck_token_idx on hwcheck_records (token, week);
create index if not exists hwcheck_plan_idx on hwcheck_records (week) where missing or plan <> '';

-- 시트 '내신기록' (A기간 B반ID/공유키 C구분(범위/주차/학생/클리어) D주차 E학생 F내용1 G내용2 H기록일시)
create table if not exists naeshin_records (
  id bigint generated always as identity primary key,
  period text not null,
  class_key text not null,          -- 반ID(n001) 또는 공유키(공유:고1|화정)
  kind text not null check (kind in ('범위','주차','학생','클리어')),
  week text not null default '',    -- 주차(yyyy-MM-dd), 범위/클리어는 ''
  student text not null default '', -- 학생 구분만 채움
  text1 text not null default '',
  text2 text not null default '',
  at timestamptz not null default now(),
  unique (period, class_key, kind, week, student)
);
create index if not exists naeshin_period_idx on naeshin_records (period, class_key);

-- 접근 정책 — 1단계와 동일한 공개 수준 (티쳐스 페이지 게이트 없음, 비번 페이지 내장)
do $$
declare t text;
begin
  foreach t in array array['hwcheck_records','naeshin_records'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
