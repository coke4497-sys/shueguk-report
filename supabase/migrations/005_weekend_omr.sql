-- ============================================================
-- 슈국 수파베이스 이전: 주말 실전 모의고사 (OMR 채점 + 신청)
-- 셋 다 **해당 구글시트가 원본**:
--  · OMR 학생/교사 화면은 Apps Script 내부(iframe)라 실시간 미러 불가 —
--    출제(answer_key.html)만 실시간 미러, 응답은 일일 점검이 동기화.
--  · 신청은 페이지 훅(제출·교사 화면)이 실시간 미러 + 일일 점검 백스톱.
-- ============================================================

-- OMR 시트 '회차정답' (A:회차이름 B:회차데이터 JSON)
create table if not exists omr_exams (
  name text primary key,
  data text not null default '',    -- 회차 JSON 원문 그대로 (파싱은 쓰는 쪽에서)
  mode text not null default ''     -- '통합' 또는 '' (고3형)
);

-- OMR 시트 '응답' (제출시각·회차·응시일·이름·학교·학년·선택과목·점수·총점·등급·1~45번·학생ID)
create table if not exists omr_responses (
  id bigint generated always as identity primary key,
  submitted_at timestamptz not null default now(),
  exam text not null default '',
  exam_date text not null default '',   -- '6월 3일' 표기 그대로
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  subject text not null default '',
  got text not null default '',
  total text not null default '',
  level text not null default '',       -- 등급
  answers jsonb not null default '{}',  -- {"1":"3", ... "45":"5"}
  student_id text not null default ''
);
create index if not exists omr_responses_name_idx on omr_responses (name);
create index if not exists omr_responses_exam_idx on omr_responses (exam);

-- 신청 시트 '신청' (제출시각·이름·학교·학년·학생ID·선택과목·응시요일·응시일자)
create table if not exists signup_entries (
  id bigint generated always as identity primary key,
  ts text not null default '',          -- 제출시각 'yyyy-MM-dd HH:mm' 문자열 그대로
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  student_id text not null default '',
  subject text not null default '',
  day text not null default '',         -- 토요일/일요일
  exam_date text not null default ''    -- 'M월 D일'
);
create index if not exists signup_entries_ts_idx on signup_entries (ts);

do $$
declare t text;
begin
  foreach t in array array['omr_exams','omr_responses','signup_entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
