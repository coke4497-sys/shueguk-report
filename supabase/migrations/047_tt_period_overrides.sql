-- 047: 슈국 캘린더 주별 기간에 '학년별 예외' (2026-10-11 사용자 결정 "권장안으로")
-- 어떤 학년만 그 주에 다른 시간표로 수업할 때(중2는 10/14·10/21·10/28 주 정규, 고1·고2는 기말까지 내신)
-- 주 기준 book은 그대로 두고 overrides에 {학년: '정규'|'내신'}을 적는다. 비어 있으면 종전과 같다.
-- 읽는 곳: timetable.html(ttBoot·timetableWeek·ttPeriodList·ttPeriodSet), hub sessions.html, classlog.html.

alter table public.tt_period
  add column if not exists overrides jsonb not null default '{}'::jsonb;

-- check 제약에는 서브쿼리를 쓸 수 없어(0A000) 모양 검사는 immutable 함수로 둔다.
create or replace function public.tt_period_ov_ok(ov jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(ov) = 'object'
     and not exists (
       select 1 from jsonb_each_text(ov) kv
       where kv.key !~ '^[중고][1-3]$' or kv.value not in ('정규', '내신')
     );
$$;

alter table public.tt_period drop constraint if exists tt_period_overrides_shape;
alter table public.tt_period add constraint tt_period_overrides_shape
  check (public.tt_period_ov_ok(overrides));

comment on column public.tt_period.overrides is
  '학년별 예외 {학년: 정규|내신} — 그 주에 주 기준(book)과 다른 시간표로 수업하는 학년만. 빈 객체 = 예외 없음 (047, 2026-10-11)';
