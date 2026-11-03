-- ============================================================
-- 061 예비 고1 학교 분석 (2026-11-03 원장님 "학생 페이지에 예비고1 학교 분석 메뉴 — 전체 요약 · 학교별 상세")
--   · 원장님이 만든 학교별 '고1 지필고사 분석' PDF를 학생 페이지 메뉴로 옮긴다(재원생 모두 — 원장님 선택).
--   · 분석 글은 공개 저장소에 두지 않는다(학원 자료 — 재원생만). 이 표에 학교마다 한 줄(data jsonb),
--     학생은 함수 pre1_list(p {key|student})로만 읽는다(접근코드·학생ID가 맞는 학생만).
--   · 넣기·고치기는 교사(authenticated) — tools/pre1_load.py 가 JSON 파일을 올린다.
--   · data 모양은 pre1.html 이 그리는 그대로(school·exam·composition·scope·areaDist·levelDist·questions·
--     review·trends·hard·points·extra …) — 서버는 모양을 검사하지 않는다.
-- ============================================================

create table if not exists public.pre1_schools (
  key        text primary key check (key ~ '^[a-z0-9_-]{2,40}$'),   -- 'neunggok-26-1m' 처럼 학교·시험마다 하나
  ord        int  not null default 0,                                -- 화면 순서(작을수록 앞)
  school     text not null check (btrim(school) <> ''),              -- '능곡고'
  exam       text not null default '',                               -- '2026학년도 1학기 중간고사'
  data       jsonb not null default '{}'::jsonb,
  visible    boolean not null default true,                          -- 거짓이면 학생에게 안 보임
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.pre1_schools enable row level security;
drop policy if exists teacher_all on public.pre1_schools;
create policy teacher_all on public.pre1_schools for all to authenticated using (true) with check (true);
revoke all privileges on public.pre1_schools from anon;
revoke all privileges on public.pre1_schools from authenticated;
grant select, insert, update, delete on public.pre1_schools to authenticated;

-- 학생: 보이는 학교 분석 전부(순서대로). 학생 확인은 031 review_me_ 그대로.
create or replace function public.pre1_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', s.key, 'school', s.school, 'exam', s.exam, 'data', s.data, 'at', s.updated_at)
           order by s.ord, s.school), '[]'::jsonb)
      from public.pre1_schools s where s.visible));
end $$;

revoke all on function public.pre1_list(jsonb) from public;
grant execute on function public.pre1_list(jsonb) to anon, authenticated;
