-- 007: H WORK 미러 (2026-08-23)
-- 원본은 H WORK 시트 「2026 Shueguk H WORK 채점」 (HWORK목록·제출기록 탭).
-- 채점(정답 대조)·마감 판정이 서버(Apps Script)에 있으므로 쓰기는 기존 백엔드가 담당,
-- 여기는 읽기 미러 — 페이지 훅(출제 저장·제출·마감·삭제) + 일일 점검(--hwork)이 유지.

-- 'HWORK목록' 탭 (A강사 B제목 C데이터JSON D마감일)
create table if not exists hwork_homeworks (
  id bigint generated always as identity primary key,
  teacher text not null default '',
  code text not null default '',        -- 제목
  data jsonb not null default '{}',     -- 문항·정답 전체 (백엔드 C열 JSON 그대로)
  due text not null default '',         -- 마감일 'yyyy-MM-dd', 빈값=기한 없음
  unique (teacher, code)
);

-- '제출기록' 탭 (제출시각·강사·제목·학교·학년·이름·맞은개수·총문항·답안·정오·질문)
create table if not exists hwork_submissions (
  id bigint generated always as identity primary key,
  ts text not null default '',          -- 제출시각 'yyyy-MM-dd HH:mm' (KST)
  teacher text not null default '',
  code text not null default '',
  school text not null default '',
  grade text not null default '',
  name text not null default '',
  got int not null default 0,
  total int not null default 0,
  answers jsonb not null default '{}',
  detail jsonb not null default '{}',   -- 정오(문항별 채점 결과)
  questions jsonb not null default '{}'
);
create index if not exists hwork_submissions_name_idx on hwork_submissions (name);
create index if not exists hwork_submissions_code_idx on hwork_submissions (code);

do $$
declare t text;
begin
  foreach t in array array['hwork_homeworks','hwork_submissions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
