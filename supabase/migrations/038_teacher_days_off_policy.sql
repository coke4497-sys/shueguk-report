-- 038: 교사 임시 휴무 표(tt_teacher_days_off)의 권한을 다른 교사 표와 같게 맞춘다.
-- 037은 정책 조건을 private.is_active_teacher()로 두었는데, 티쳐스 페이지가 쓰는
-- 공용 교사 계정(teachers@shueguk.internal)에서 이 함수가 거짓이라 저장·조회가 모두 막혔다
-- (2026-09-30 확인: POST가 'new row violates row-level security policy'로 403, 표는 비어 있음).
-- 034·036처럼 로그인한 교사(authenticated)면 허용한다. 재실행 안전.

alter table public.tt_teacher_days_off enable row level security;
drop policy if exists teacher_all on public.tt_teacher_days_off;
create policy teacher_all on public.tt_teacher_days_off
for all to authenticated
using (true)
with check (true);

revoke all privileges on public.tt_teacher_days_off from anon;
grant select, insert, update, delete on public.tt_teacher_days_off to authenticated;
grant usage, select on sequence public.tt_teacher_days_off_id_seq to authenticated;
