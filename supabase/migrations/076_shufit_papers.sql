-- 076: Shuefit 문법 시험지 — 출제 선생님별로 저장 (2026-11-17 원장님 "출제선생님을 구분하고 싶어. 강사별로 시험지를
-- 저장할 수 있고 나중에 사용하지 않은 문제를 모아 모의고사 제작" → "시험지 이름을 입력하고 저장해야 인쇄가 가능하도록",
-- '안 쓴 문제' = 그 선생님이 안 쓴 문제).
-- 한 행 = 시험지 하나(출제 선생님 + 제목이 열쇠 — 같은 제목으로 다시 저장하면 덮어쓴다). ids = gbank_items.id 를 시험지 순서대로.
-- 화면(허브 shufit_grammar.html)이 이 표와 H WORK 과제(hwork_homeworks.data.bank)를 합쳐 선생님마다 '낸 적 있는 문항'을 센다.
-- 교사 전용(공용 교사 계정도 — 045 규칙: is_active_teacher() 를 정책에 쓰지 않는다), 공개 키 차단, 시트 사본 없음.

create table if not exists public.shufit_papers (
  id bigint generated always as identity primary key,
  teacher text not null check (btrim(teacher) <> ''),
  title text not null check (btrim(title) <> '' and char_length(title) <= 120),
  ids integer[] not null default '{}',
  author text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher, title)
);

create index if not exists shufit_papers_teacher_idx on public.shufit_papers (teacher, updated_at desc);

drop trigger if exists shufit_papers_touch on public.shufit_papers;
create trigger shufit_papers_touch
before update on public.shufit_papers
for each row execute function public.set_updated_at();

alter table public.shufit_papers enable row level security;
drop policy if exists teacher_all on public.shufit_papers;
create policy teacher_all on public.shufit_papers
for all to authenticated
using (true)
with check (true);

revoke all privileges on public.shufit_papers from anon;
revoke all privileges on public.shufit_papers from authenticated;
grant select, insert, update, delete on public.shufit_papers to authenticated;
grant usage, select on sequence public.shufit_papers_id_seq to authenticated;
