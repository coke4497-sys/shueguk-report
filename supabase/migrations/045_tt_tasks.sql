-- 045: 오늘 할 일 · 전달 사항 (2026-10-08 원장님 요청 "오늘의 시간표에 해야할 업무나 전달사항을 메모")
-- 한 행 = 요청 한 건. 받는 곳은 센터 단위(본원·화정센터·민트초코·정리정독·전체).
-- ymd = 그 요청이 보이는 날짜. 완료 전이면 다음 날에도 '지난 요청'으로 보인다.
-- [못 했어요]로 넘기면 history에 {ymd, loc, by, reason, at}를 덧붙이고 ymd를 다음 날로 옮긴다.
-- 완료는 status '완료' + done_by·done_at·done_ymd. 시트 사본 없음(교사 전용).

create table if not exists public.tt_tasks (
  id bigint generated always as identity primary key,
  ymd date not null,
  loc text not null default '전체',
  text text not null check (btrim(text) <> ''),
  student text not null default '',
  author text not null default '',
  status text not null default '대기' check (status in ('대기','완료')),
  done_by text not null default '',
  done_at timestamptz,
  done_ymd date,
  history jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tt_tasks_ymd_idx on public.tt_tasks (status, ymd);
create index if not exists tt_tasks_done_idx on public.tt_tasks (done_ymd);

drop trigger if exists tt_tasks_touch on public.tt_tasks;
create trigger tt_tasks_touch
before update on public.tt_tasks
for each row execute function public.set_updated_at();

alter table public.tt_tasks enable row level security;
drop policy if exists teacher_all on public.tt_tasks;
create policy teacher_all on public.tt_tasks
for all to authenticated
using (private.is_active_teacher())
with check (private.is_active_teacher());

revoke all privileges on public.tt_tasks from anon;
grant select, insert, update, delete on public.tt_tasks to authenticated;
grant usage, select on sequence public.tt_tasks_id_seq to authenticated;
