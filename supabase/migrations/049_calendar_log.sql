-- 049: 슈국 캘린더 수정 기록 (2026-10-12 원장님 "캘린더의 수정사항들을 누가 했는지 기록으로 남겨줘")
-- 캘린더 저장은 행을 덮어쓰거나 지우므로(tt_period·tt_memo·exam_sched) 그 행에 작성자 칸을 두면
-- 마지막 사람만 남고 지운 기록은 사라진다 — 그래서 바꿀 때마다 한 줄씩 쌓는 기록 표를 따로 둔다.
-- 048과 같은 방침: 화면에는 보이지 않고, 원장님이 물으면 클로슈가 조회한다. 시트 사본 없음.
--   what   = '기간'(정규/내신) · '학년 예외' · '메모' · '지필 기간' · '지필 과목'
--   target = 주 수요일 / 메모 날짜 / '학교 · 시작~끝'
--   action = '저장' · '지움'
--   before / after = 바꾸기 전·후 값(읽기용 글)
--   author = 허브 개인 로그인 이름(없으면 이 기기에 적어 둔 이름, 빈 값 = 로그인 없이 쓴 기록)

create table if not exists public.tt_calendar_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  what text not null default '',
  target text not null default '',
  action text not null default '저장',
  before text not null default '',
  after text not null default '',
  author text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid()
);

create index if not exists tt_calendar_log_at_idx on public.tt_calendar_log (at desc);

alter table public.tt_calendar_log enable row level security;
drop policy if exists teacher_all on public.tt_calendar_log;
-- 공용 교사 계정은 private.is_active_teacher()가 거짓이라(045 참고) authenticated 전체 허용.
-- 기록 표라 고치기·지우기는 주지 않는다(넣기·읽기만).
create policy teacher_all on public.tt_calendar_log
for all to authenticated
using (true)
with check (true);

revoke all privileges on public.tt_calendar_log from anon;
-- 수파베이스 기본 권한이 authenticated 에 UPDATE·DELETE 까지 주므로 먼저 거둔다(2026-10-13 적용 때 발견).
revoke all privileges on public.tt_calendar_log from authenticated;
grant select, insert on public.tt_calendar_log to authenticated;
grant usage, select on sequence public.tt_calendar_log_id_seq to authenticated;
