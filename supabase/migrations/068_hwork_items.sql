-- 068: H WORK 교재 문항 그림 (2026-11-16 원장님 — 답장·리테스트에 문항을 띄우려면 문항이 저장돼 있어야 한다)
-- 교재 「SHUEGUK REAL 내신 기출」 학생용 PDF에서 문항마다 잘라 낸 그림을 비공개 버킷 hwork-items에 두고,
-- 한 그림 = 한 줄(hwork_book_imgs). 과제 제목 'SHUEGUK REAL 내신 기출 {과목} {n권(…)} {NN} {세트} [(k/2: 교재 a~b번)]'에서
-- 교재·세트·번호를 읽어(hwork_book_ref_) 과제의 n번 = 세트의 (a-1+n)번으로 잇는다.
-- 교사(authenticated)는 표·저장소를 바로 읽고, 학생(anon)은 hwork_item_imgs가 10분 창을 연 그림만 받는다(032·067과 같은 방식).
-- 올리기 = tools/hwork_items.py (교사 계정).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hwork-items', 'hwork-items', false, 5242880, array['image/png','image/webp','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.hwork_book_imgs (
  id bigint generated always as identity primary key,
  book text not null,          -- '문장 1권(기본·실력)' (과제 제목의 과목·권 그대로)
  set_key text not null,       -- '01 문장 성분 · 기본'
  q int not null,              -- 세트 안 문항 번호(교재 번호)
  j int not null default 0,    -- 문항이 여러 단·쪽에 걸치면 0,1,2…
  path text not null unique,   -- 저장소 경로 b/{무작위}/…png
  w int not null default 0,
  h int not null default 0,
  open_until timestamptz,
  created_at timestamptz not null default now(),
  unique (book, set_key, q, j)
);
create index if not exists hwork_book_imgs_set_idx on public.hwork_book_imgs (book, set_key, q);
alter table public.hwork_book_imgs enable row level security;
drop policy if exists teacher_all on public.hwork_book_imgs;
create policy teacher_all on public.hwork_book_imgs for all to authenticated using (true) with check (true);
revoke all on public.hwork_book_imgs from anon, public;
revoke references, trigger, truncate on public.hwork_book_imgs from authenticated;
grant select, insert, update, delete on public.hwork_book_imgs to authenticated;

create or replace function public.hwork_item_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hwork_book_imgs where path = p_name and open_until > now())
$$;
revoke all on function public.hwork_item_ok(text) from public;
grant execute on function public.hwork_item_ok(text) to anon, authenticated;

drop policy if exists hwork_items_teacher on storage.objects;
create policy hwork_items_teacher on storage.objects for all to authenticated
  using (bucket_id = 'hwork-items') with check (bucket_id = 'hwork-items');
drop policy if exists hwork_items_student_read on storage.objects;
create policy hwork_items_student_read on storage.objects for select to anon
  using (bucket_id = 'hwork-items' and public.hwork_item_ok(name));

-- 과제 제목 → 교재·세트·번호 차이(+ 나눈 과제의 끝 번호 lim). 맞지 않으면 book null
drop function if exists public.hwork_book_ref_(text);
create or replace function public.hwork_book_ref_(p_code text, out book text, out set_key text, out off int, out lim int)
language plpgsql immutable set search_path = public as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_code,''),
    '^SHUEGUK REAL 내신 기출 (.+?) (\d권\([^)]*\)) (\d{2} .+?)(?: \(\d/\d: 교재 (\d+)~(\d+)번\))?$');
  if m is null then return; end if;
  book := m[1] || ' ' || m[2];
  set_key := m[3];
  off := coalesce(m[4]::int, 1) - 1;
  lim := m[5]::int;
end $$;
revoke all on function public.hwork_book_ref_(text) from public;

-- 과제의 문항(번호 목록, null이면 전부) 그림 — 학생이면 10분 창을 연다
create or replace function public.hwork_items_of_(p_code text, p_nums text[], p_open boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; out jsonb := '{}'::jsonb;
begin
  select * into r from hwork_book_ref_(p_code);
  if r.book is null then return out; end if;
  if p_open then
    update hwork_book_imgs i set open_until = now() + interval '10 minutes'
     where i.book = r.book and i.set_key = r.set_key and i.q > r.off and (r.lim is null or i.q <= r.lim)
       and (p_nums is null or (i.q - r.off)::text = any (p_nums));
  end if;
  select coalesce(jsonb_object_agg(n, v), '{}'::jsonb) into out from (
    select (i.q - r.off)::text n,
           jsonb_agg(jsonb_build_object('path', i.path, 'w', i.w, 'h', i.h) order by i.j) v
      from hwork_book_imgs i
     where i.book = r.book and i.set_key = r.set_key and i.q > r.off and (r.lim is null or i.q <= r.lim)
       and (p_nums is null or (i.q - r.off)::text = any (p_nums))
     group by i.q, r.off) t;
  return out;
end $$;
revoke all on function public.hwork_items_of_(text, text[], boolean) from public;

-- 문항 그림 목록 (+ 학생은 창 열기)
--   via 'retry'  = 오답하기 화면(p.id + p.key = retry_key) — 그 과제의 문항 전부
--   via 'retest' = 리테스트(p.id + p.key 접근코드) — 리테스트 문항만
create or replace function public.hwork_item_imgs(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; r public.hwork_retests; v text := coalesce(p->>'via','');
        nums text[];
begin
  if v = 'retry' then
    s := hwork_row_(p);
    if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_mine'); end if;
    return jsonb_build_object('ok', true, 'bucket', 'hwork-items', 'items', hwork_items_of_(s.code, null, true));
  elsif v = 'retest' then
    r := hwork_retest_row_(p);
    if r.id is null then return jsonb_build_object('ok', false, 'error', 'not_mine'); end if;
    select array_agg(x) into nums from jsonb_array_elements_text(r.qs) x;
    return jsonb_build_object('ok', true, 'bucket', 'hwork-items', 'items', hwork_items_of_(r.code, coalesce(nums, '{}'), true));
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_via');
end $$;
revoke all on function public.hwork_item_imgs(jsonb) from public;
grant execute on function public.hwork_item_imgs(jsonb) to anon, authenticated;

-- 교사 계정: 과제(p.code)의 문항 그림 목록 [+ p.qs 번호만]. 저장소는 교사 신분으로 바로 받는다.
create or replace function public.hwork_item_imgs_t(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nums text[];
begin
  if jsonb_typeof(p->'qs') = 'array' then select array_agg(x) into nums from jsonb_array_elements_text(p->'qs') x; end if;
  return jsonb_build_object('ok', true, 'bucket', 'hwork-items', 'items', hwork_items_of_(p->>'code', nums, false));
end $$;
revoke all on function public.hwork_item_imgs_t(jsonb) from public, anon;
grant execute on function public.hwork_item_imgs_t(jsonb) to authenticated;
