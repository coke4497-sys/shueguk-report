-- 080: Shuefit 독서 문제지 — 출제 선생님별 저장 (2026-11-19 원장님 "문제지 저장 기능도 문법처럼 만들어줘").
-- 076(Shuefit 문법 shufit_papers)과 같은 짜임이되 표를 따로 둔다 — 문법 화면이 shufit_papers 의 ids 를 gbank_items 로 읽으므로 섞지 않는다.
-- 한 행 = 문제지 하나(출제 선생님 + 제목이 열쇠 — 같은 제목으로 다시 저장하면 덮어쓴다). ids = reading_items.id 를 문제지 순서대로.
-- 허브 shufit_reading.html 이 이 표와 H WORK 과제(hwork_homeworks.data.rd)를 합쳐 선생님마다 '낸 적 있는 문항'을 센다.
-- 교사 전용(공용 교사 계정도 — 045 규칙: is_active_teacher() 를 정책에 쓰지 않는다), 공개 키 차단, 시트 사본 없음. 다시 실행해도 안전하다.

create table if not exists public.shufit_reading_papers (
  id bigint generated always as identity primary key,
  teacher text not null check (btrim(teacher) <> ''),
  title text not null check (btrim(title) <> '' and char_length(title) <= 120),
  ids integer[] not null default '{}',
  author text not null default '',
  print_date date,
  school text not null default '' check (char_length(school) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher, title)
);

create index if not exists shufit_reading_papers_teacher_idx on public.shufit_reading_papers (teacher, updated_at desc);

drop trigger if exists shufit_reading_papers_touch on public.shufit_reading_papers;
create trigger shufit_reading_papers_touch
before update on public.shufit_reading_papers
for each row execute function public.set_updated_at();

alter table public.shufit_reading_papers enable row level security;
drop policy if exists teacher_all on public.shufit_reading_papers;
create policy teacher_all on public.shufit_reading_papers
for all to authenticated
using (true)
with check (true);

revoke all privileges on public.shufit_reading_papers from anon;
revoke all privileges on public.shufit_reading_papers from authenticated;
grant select, insert, update, delete on public.shufit_reading_papers to authenticated;
grant usage, select on sequence public.shufit_reading_papers_id_seq to authenticated;
