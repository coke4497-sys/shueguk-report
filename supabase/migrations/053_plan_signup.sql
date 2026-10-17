-- 053: 27 예상 정규 시간표 — 학생 페이지에서 반 신청(선착순) (2026-10-17 원장님 "학생 페이지 신청으로 만들어줘, 선착순으로"
--      + "가 반 이동도 가능하게")
-- 052의 tt_plan_students(학생마다 가·나 반) 위에 얹는다.
--   tt_plan_config  = 계획마다 한 줄 — 신청을 받는지(open)·정원(cap)·반 목록(classes, 화면 코드 P27_CLASSES를 선생님 화면이 넣는다)
--   tt_plan_log     = 학생이 바꾼 기록(선착순 다툼이 생기면 누가 언제 바꿨는지 본다)
--   plan_view(p)    = 학생 자기 배치 + 반마다 인원·꽉 참
--   plan_pick(p)    = 가 반 옮기기 / 나 반 고르기·바꾸기·취소. 정원·같은 날 시간 겹침을 잠금 안에서 확인한다(054부터 같은 요일이면 시간과 상관없이 거절).
-- 학생 확인은 031 review_me_(접근코드 key 또는 학생ID student). 계획 줄은 이름으로 찾는다(정확히 → 끝 A 붙여서 → 끝 A 떼고).
-- 052 계획에서 뺀 학생(excluded)·계획에 없는 학생은 신청할 수 없다(신입은 선생님 화면에서 넣는다).

create table if not exists public.tt_plan_config (
  plan text primary key,
  open boolean not null default false,
  cap int not null default 9,
  classes jsonb not null default '[]'::jsonb,
  author text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.tt_plan_config enable row level security;
drop policy if exists teacher_all on public.tt_plan_config;
create policy teacher_all on public.tt_plan_config for all to authenticated using (true) with check (true);
revoke all privileges on public.tt_plan_config from anon;
revoke all privileges on public.tt_plan_config from authenticated;
grant select, insert, update, delete on public.tt_plan_config to authenticated;

create table if not exists public.tt_plan_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  plan text not null,
  student text not null,
  part text not null,
  from_cls text not null default '',
  to_cls text not null default '',
  by text not null default ''
);
alter table public.tt_plan_log enable row level security;
drop policy if exists teacher_read on public.tt_plan_log;
create policy teacher_read on public.tt_plan_log for select to authenticated using (true);
revoke all privileges on public.tt_plan_log from anon;
revoke all privileges on public.tt_plan_log from authenticated;
grant select on public.tt_plan_log to authenticated;

-- 학생의 계획 줄
-- 계획 줄과 학생정보의 학교가 둘 다 적혀 있는데 다르면 다른 학생(동명이인)으로 본다.
create or replace function public.plan_row_(v_plan text, v_name text, v_school text)
returns public.tt_plan_students language sql stable security definer set search_path = public as $$
  select r.* from public.tt_plan_students r
   where r.plan = v_plan and not r.excluded and v_name <> ''
     and r.student in (v_name, v_name || 'A', regexp_replace(v_name, 'A$', ''))
     and (r.school = '' or coalesce(v_school, '') = '' or r.school = v_school)
   order by (r.student = v_name) desc, (r.student = v_name || 'A') desc, r.id
   limit 1
$$;

create or replace function public.plan_view(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        cfg public.tt_plan_config%rowtype;
        r public.tt_plan_students%rowtype;
        v_plan text := coalesce(nullif(btrim(p->>'plan'), ''), '2027');
begin
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into cfg from public.tt_plan_config where plan = v_plan;
  if cfg.plan is null then return jsonb_build_object('ok', true, 'eligible', false, 'open', false); end if;
  r := public.plan_row_(v_plan, btrim(coalesce(me.name, '')), btrim(coalesce(me.school, '')));
  if r.id is null then return jsonb_build_object('ok', true, 'eligible', false, 'open', cfg.open); end if;
  return jsonb_build_object('ok', true, 'eligible', true, 'open', cfg.open, 'cap', cfg.cap,
    'name', r.student, 'ga', r.ga, 'na', r.na,
    'classes', (select coalesce(jsonb_agg(c || jsonb_build_object(
        'cnt', (select count(*) from public.tt_plan_students s where s.plan = v_plan and not s.excluded
                 and (case when c->>'part' = '가' then s.ga else s.na end) = c->>'id'))) , '[]'::jsonb)
      from jsonb_array_elements(cfg.classes) c));
end $$;

create or replace function public.plan_pick(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        cfg public.tt_plan_config%rowtype;
        r public.tt_plan_students%rowtype;
        v_plan text := coalesce(nullif(btrim(p->>'plan'), ''), '2027');
        v_part text := btrim(coalesce(p->>'part', ''));
        v_cls text := btrim(coalesce(p->>'cls', ''));
        c jsonb; o jsonb;
        v_other text; v_from text; n int;
begin
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  if v_part not in ('가', '나') then return jsonb_build_object('ok', false, 'error', 'bad_part'); end if;
  perform pg_advisory_xact_lock(hashtext('tt_plan:' || v_plan));
  select * into cfg from public.tt_plan_config where plan = v_plan;
  if cfg.plan is null or not cfg.open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  r := public.plan_row_(v_plan, btrim(coalesce(me.name, '')), btrim(coalesce(me.school, '')));
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'not_in_plan'); end if;
  v_from := case when v_part = '가' then r.ga else r.na end;
  v_other := case when v_part = '가' then r.na else r.ga end;
  if v_cls = '' then
    if v_part = '가' then return jsonb_build_object('ok', false, 'error', 'ga_required'); end if;
  else
    select x into c from jsonb_array_elements(cfg.classes) x where x->>'id' = v_cls limit 1;
    if c is null or c->>'part' <> v_part then return jsonb_build_object('ok', false, 'error', 'bad_class'); end if;
    if v_cls <> v_from then
      select count(*) into n from public.tt_plan_students s
       where s.plan = v_plan and not s.excluded and s.id <> r.id
         and (case when v_part = '가' then s.ga else s.na end) = v_cls;
      if n >= cfg.cap then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    end if;
    if v_other <> '' then
      select x into o from jsonb_array_elements(cfg.classes) x where x->>'id' = v_other limit 1;
      if o is not null and o->>'day' = c->>'day' and abs((o->>'m')::int - (c->>'m')::int) < 120 then
        return jsonb_build_object('ok', false, 'error', 'clash');
      end if;
    end if;
  end if;
  if v_cls is distinct from v_from then
    if v_part = '가' then
      update public.tt_plan_students set ga = v_cls, author = '학생 신청', updated_at = now() where id = r.id;
    else
      update public.tt_plan_students set na = v_cls, author = '학생 신청', updated_at = now() where id = r.id;
    end if;
    insert into public.tt_plan_log(plan, student, part, from_cls, to_cls, by)
    values (v_plan, r.student, v_part, coalesce(v_from, ''), v_cls, '학생 신청');
  end if;
  return public.plan_view(p);
end $$;

revoke all on function public.plan_row_(text, text, text) from public, anon, authenticated;
grant execute on function public.plan_view(jsonb) to anon, authenticated;
grant execute on function public.plan_pick(jsonb) to anon, authenticated;
