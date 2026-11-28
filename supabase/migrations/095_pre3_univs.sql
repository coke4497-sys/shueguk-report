-- ============================================================
-- 095 예비 고3 — 인서울 15개 대학 2028학년도 입시전형 · 고3 자가 점검 (2026-11-28 원장님 "이것(pre1)을 고3 버전으로 — 인서울 15개 대학 입시전형과 고3이 되는 학생 자가 점검")
--   · 061 pre1_schools 와 같은 짜임. 대학마다 한 줄(kind 'univ', data = pre3.html 이 그리는 JSON) + 공통 한 줄(kind 'common' — 대교협
--     「2028학년도 대학입학전형시행계획 주요사항」의 전국 총계·일정).
--   · 자료 출처는 대입정보포털 '어디가'에 게재된 각 대학의 2028학년도 대학입학전형 시행계획 원문과 대교협 자료집 — 공개 자료지만
--     옮긴 글은 학원 정리본이라 저장소에 두지 않고 이 표에만(재원생 모두 — 원장님 선택). 학생은 함수 pre3_list(p {key|student})로만 읽는다.
--   · 넣기·고치기는 교사(authenticated) — tools/pre3_load.py 가 JSON 파일을 올린다. 서버는 data 모양을 검사하지 않는다.
-- ============================================================

create table if not exists public.pre3_univs (
  key        text primary key check (key ~ '^[a-z0-9_-]{2,40}$'),   -- 'snu' 처럼 대학마다 하나, 공통은 'common'
  ord        int  not null default 0,                                -- 화면 순서(작을수록 앞)
  kind       text not null default 'univ' check (kind in ('univ','common')),
  name       text not null check (btrim(name) <> ''),                -- '서울대학교' / '공통'
  year       text not null default '2028',                           -- 입시 학년도
  data       jsonb not null default '{}'::jsonb,
  visible    boolean not null default true,                          -- 거짓이면 학생에게 안 보임
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.pre3_univs enable row level security;
drop policy if exists teacher_all on public.pre3_univs;
create policy teacher_all on public.pre3_univs for all to authenticated using (true) with check (true);
revoke all privileges on public.pre3_univs from anon;
revoke all privileges on public.pre3_univs from authenticated;
grant select, insert, update, delete on public.pre3_univs to authenticated;

-- 학생: 보이는 줄 전부(순서대로). 학생 확인은 031 review_me_ 그대로(재원생 모두).
create or replace function public.pre3_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', s.key, 'kind', s.kind, 'name', s.name, 'year', s.year, 'data', s.data, 'at', s.updated_at)
           order by s.ord, s.name), '[]'::jsonb)
      from public.pre3_univs s where s.visible));
end $$;

revoke all on function public.pre3_list(jsonb) from public;
grant execute on function public.pre3_list(jsonb) to anon, authenticated;

-- 090 누가 기록 — 표를 새로 만들었으니 트리거를 붙인다(090 전 DB 에서는 건너뜀)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'audit_attach') then
    perform private.audit_attach('pre3_univs');
  end if;
end $$;
