-- ============================================================
-- 096 2028 대입 미리보기 — 팀09 셀프 체크리스트를 서버에 저장 (2026-11-28 원장님 "1. 제가 확인 가능해야 해요")
--   · 그전엔 체크리스트(○△×·돌아보기·내신 히스토리·수능 목표·희망 대학)가 학생 기기 localStorage 에만 있어 원장님이 볼 수 없었다.
--   · 학생마다 한 줄(students.id) — data = pre3.html 의 CK {m:{번호:o|t|x|n}, f:{칸:값}, at}. 학생은 함수로만 쓰고 읽는다
--     (pre3_check_save / pre3_check_mine — 학생 확인은 031 review_me_). 선생님(authenticated)은 표를 직접 읽는다(pre3.html?teacher=1).
--   · 표에 이름·학교·학년을 같이 적어 두어(저장할 때 students 에서) 목록을 그릴 때 students 를 다시 잇지 않는다.
-- ============================================================

create table if not exists public.pre3_checks (
  student_id bigint primary key references public.students(id) on delete cascade,
  code       text not null default '',
  name       text not null default '',
  school     text not null default '',
  grade      text not null default '',
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  marks      int  not null default 0,          -- ○△×– 를 표시한 항목 수(목록용)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pre3_checks enable row level security;
drop policy if exists teacher_read on public.pre3_checks;
create policy teacher_read on public.pre3_checks for select to authenticated using (true);
revoke all privileges on public.pre3_checks from anon;
revoke all privileges on public.pre3_checks from authenticated;
grant select on public.pre3_checks to authenticated;

-- 학생: 저장(덮어쓰기). data 는 객체·20,000자까지.
create or replace function public.pre3_check_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        d jsonb := p->'data';
        n int;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  if d is null or jsonb_typeof(d) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_data');
  end if;
  if length(d::text) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  select count(*) into n from jsonb_each_text(coalesce(d->'m', '{}'::jsonb)) e where e.value in ('o','t','x','n');
  insert into public.pre3_checks (student_id, code, name, school, grade, data, marks, updated_at)
  values (me.id, coalesce(me.code,''), coalesce(me.name,''), coalesce(me.school,''), coalesce(me.grade,''), d, n, now())
  on conflict (student_id) do update
    set code = excluded.code, name = excluded.name, school = excluded.school, grade = excluded.grade,
        data = excluded.data, marks = excluded.marks, updated_at = now();
  return jsonb_build_object('ok', true, 'at', now());
end $$;

-- 학생: 내 것 읽기(없으면 data null).
create or replace function public.pre3_check_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        r public.pre3_checks%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  select * into r from public.pre3_checks where student_id = me.id;
  if r.student_id is null then return jsonb_build_object('ok', true, 'data', null); end if;
  return jsonb_build_object('ok', true, 'data', r.data, 'at', r.updated_at);
end $$;

revoke all on function public.pre3_check_save(jsonb) from public;
revoke all on function public.pre3_check_mine(jsonb) from public;
grant execute on function public.pre3_check_save(jsonb) to anon, authenticated;
grant execute on function public.pre3_check_mine(jsonb) to anon, authenticated;

-- 090 누가 기록(090 전 DB 에서는 건너뜀)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'audit_attach') then
    perform private.audit_attach('pre3_checks');
  end if;
end $$;
