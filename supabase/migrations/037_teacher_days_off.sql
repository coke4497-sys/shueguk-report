-- 037: 주차별 시간표의 교사 임시 휴무 표시
-- 수업·출석·회차 데이터와 분리한다. 한 행은 한 선생님의 특정 날짜 임시 휴무를 뜻한다.

create table if not exists public.tt_teacher_days_off (
  id bigint generated always as identity primary key,
  off_date date not null,
  teacher text not null check (btrim(teacher) <> ''),
  reason text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (off_date, teacher)
);

create index if not exists tt_teacher_days_off_date_idx
  on public.tt_teacher_days_off (off_date);

drop trigger if exists tt_teacher_days_off_touch on public.tt_teacher_days_off;
create trigger tt_teacher_days_off_touch
before update on public.tt_teacher_days_off
for each row execute function public.set_updated_at();

alter table public.tt_teacher_days_off enable row level security;
drop policy if exists teacher_all on public.tt_teacher_days_off;
create policy teacher_all on public.tt_teacher_days_off
for all to authenticated
using (private.is_active_teacher())
with check (private.is_active_teacher());

revoke all privileges on public.tt_teacher_days_off from anon;
grant select, insert, update, delete on public.tt_teacher_days_off to authenticated;
grant usage, select on sequence public.tt_teacher_days_off_id_seq to authenticated;
