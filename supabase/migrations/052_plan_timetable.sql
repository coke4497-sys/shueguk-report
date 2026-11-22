-- 052: 27 예상 정규 시간표 — 예비 고1 반 배치 (2026-10-17 원장님 "슈국 스케쥴에 27 예상 정규 시간표로 메뉴를 만들어주세요.
--      전체 시간표처럼, 학생 배치가 가능하도록" + "원장님만 보기")
-- 반(시간·선생님·가/나)은 화면 코드(timetable.html P27_CLASSES)에 고정해 두고, 이 표에는 학생마다 어느 가 반·나 반에
-- 놓았는지만 쌓는다. 실제 시간표(tt_classes)와 섞이지 않게 따로 둔다 — tt_classes를 읽는 화면이 많아서다.
--   plan     = 계획 이름('2027')
--   student  = 학생 이름(앞뒤 괄호 뗀 것, 동명이인 알파벳은 그대로 — '양지우A')
--   school   = 학교(명단에서 찾은 값, 신입은 직접 적은 값)
--   src      = 지금 다니는 중3 반('토 11:00 승연T') — 참고용
--   ga / na  = 놓은 반 ID(P27_CLASSES의 id, 빈 값 = 아직 안 놓음)
--   excluded = 이번 계획에서 뺀 학생(고1로 이어 가지 않는 학생 등)
--   author   = 마지막으로 바꾼 선생님(허브 로그인 이름)
-- 화면은 원장님(teacher_accounts.role = 'admin')에게만 메뉴를 보여 준다. 표 권한은 다른 교사 표와 같다(authenticated).

create table if not exists public.tt_plan_students (
  id bigint generated always as identity primary key,
  plan text not null default '2027',
  student text not null,
  school text not null default '',
  src text not null default '',
  ga text not null default '',
  na text not null default '',
  excluded boolean not null default false,
  author text not null default '',
  updated_at timestamptz not null default now(),
  unique (plan, student)
);

alter table public.tt_plan_students enable row level security;
drop policy if exists teacher_all on public.tt_plan_students;
-- 공용 교사 계정은 private.is_active_teacher()가 거짓이라(045 참고) authenticated 전체 허용.
create policy teacher_all on public.tt_plan_students
for all to authenticated
using (true)
with check (true);

revoke all privileges on public.tt_plan_students from anon;
revoke all privileges on public.tt_plan_students from authenticated;
grant select, insert, update, delete on public.tt_plan_students to authenticated;
grant usage, select on sequence public.tt_plan_students_id_seq to authenticated;
