-- 079: Shuefit 독서 — 독서 지문·변형 문항 은행 (2026-11-18 원장님 "슈핏 독서에 문제를 만들려고" → 국어공방 HWPX 샘플 검토
-- → "지금 묶음 그대로 쓰고 슈핏 독서 메뉴로 만들어 주세요").
-- 원본 = 국어공방 독서 HWPX(지문 하나에 기본·실력 두 파일 — 원 기출 6문항 + 01 핵심정리 + 02~09·99 변형 문항 137개 + 10 핵심 요약 빈칸).
-- 학원 자료라 공개 저장소에 두지 않는다 — 이 두 표에만 담고(교사 전용) 올리기는 tools/reading_load.py.
--
-- reading_passages: 지문 하나 한 줄. data = {passage:{blocks,vocab,range}, notes:[…], blanks:{lines,answers}},
--   imgs = {파일이름: base64} (지문·문항의 그림), plain = 제목 + 지문 글(찾기용, 서식 없음).
-- reading_items: 문항 한 줄. level '공통'(원 기출) | '기본' | '실력', code '00'(원 기출)·'02'…'09'·'99', v(유형 안 v1·v2),
--   ord(그 안 순서), kind 'choice'|'ox'|'multi'|'blank'|'essay', data = {stem, box, opts, grid, cond, model, ans, expl, src, passage(99 독립 지문)},
--   plain = 발문·보기·선지·정답·해설 글(찾기용).
-- 교사 전용(045 규칙 — 공용 교사 계정도 쓰므로 is_active_teacher() 를 정책에 쓰지 않는다), 공개 키 차단, 시트 사본 없음.

create table if not exists public.reading_passages (
  id text primary key check (id ~ '^[0-9A-Za-z가-힣_-]{3,80}$'),
  title text not null check (btrim(title) <> ''),
  src text not null default '',          -- '2306고2'
  srcname text not null default '',      -- '2023학년도 6월 고2'
  kind text not null default '',         -- '교육청' | '평가원' | ''
  area text not null default '',         -- '인문' | '사회' | '과학' | '기술' | '예술' | '융합' | ''
  grade text not null default '',        -- '고2'
  data jsonb not null default '{}'::jsonb,
  imgs jsonb not null default '{}'::jsonb,
  plain text not null default '',
  ord integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_items (
  id bigint generated always as identity primary key,
  passage_id text not null references public.reading_passages(id) on delete cascade,
  level text not null check (level in ('공통', '기본', '실력')),
  code text not null check (code ~ '^[0-9]{2}(_[0-9])?$'),
  sec_name text not null default '',
  v smallint not null default 1,
  ord smallint not null default 0,
  kind text not null check (kind in ('choice', 'ox', 'multi', 'blank', 'essay')),
  data jsonb not null default '{}'::jsonb,
  plain text not null default '',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (passage_id, level, code, v, ord)
);

create index if not exists reading_items_passage_idx on public.reading_items (passage_id, level, code, v, ord);

drop trigger if exists reading_passages_touch on public.reading_passages;
create trigger reading_passages_touch
before update on public.reading_passages
for each row execute function public.set_updated_at();
drop trigger if exists reading_items_touch on public.reading_items;
create trigger reading_items_touch
before update on public.reading_items
for each row execute function public.set_updated_at();

alter table public.reading_passages enable row level security;
alter table public.reading_items enable row level security;
drop policy if exists teacher_all on public.reading_passages;
create policy teacher_all on public.reading_passages for all to authenticated using (true) with check (true);
drop policy if exists teacher_all on public.reading_items;
create policy teacher_all on public.reading_items for all to authenticated using (true) with check (true);

revoke all privileges on public.reading_passages from anon;
revoke all privileges on public.reading_items from anon;
revoke all privileges on public.reading_passages from authenticated;
revoke all privileges on public.reading_items from authenticated;
grant select, insert, update, delete on public.reading_passages to authenticated;
grant select, insert, update, delete on public.reading_items to authenticated;
grant usage, select on sequence public.reading_items_id_seq to authenticated;
