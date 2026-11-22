-- ============================================================
-- 055: 공지 첨부 파일 — 선생님이 공지에 파일을 붙이고, 그 공지를 받는 학생만 내려받는다
--      (2026-10-18 원장님 "이 파일을 고3 친구들의 공지사항에 업로드하고 싶어요"
--       → 결정 "공지에 파일 첨부 기능 추가" — 비공개 저장소, 그 공지 대상 학생만)
--
--   · 저장소(Storage) 버킷 'notice-files' — **비공개**, 파일당 20MB. 032(review-files)와 같은 구조.
--     선생님(authenticated)은 올리기·지우기·읽기, 공개 키(anon)는 **내려받기 창이 열린 파일만** 읽기.
--   · notice_files — 공지에 붙은 파일 목록. 공지는 시트가 원본이고 미러(notices)는 통째로 다시
--     넣어 id 가 바뀌므로, 공지 확인(022)과 같은 **공지 키 '작성일|제목'**으로 잇는다.
--     저장 경로는 'n/{무작위}.{확장자}'(한글 파일 이름은 경로에 쓰지 않고 이 표에만 둔다).
--   · notice_files_mine(p {key|student}) — 이 학생에게 보이는 공지(022 notice_matches_)의 파일 목록.
--   · notice_file_url(p {key|student, file}) — 그 공지가 이 학생에게 보이는지 확인한 뒤 내려받기 창을
--     10분 열고 경로를 돌려준다. 10분이 지나면 공개 키로는 다시 막힌다.
-- 022·031 뒤에 실행할 것(notice_matches_·review_me_ 를 쓴다). 공개 키는 표를 못 읽고 함수만 부른다(015 규칙).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('notice-files', 'notice-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.notice_files (
  id         bigint generated always as identity primary key,
  notice_key text not null,                 -- '작성일|제목' (022 공지 키와 같다)
  path       text not null unique,          -- 저장소 안 경로(버킷 이름 제외)
  name       text not null default '',      -- 원래 파일 이름
  size       bigint not null default 0,
  mime       text not null default '',
  open_until timestamptz,                   -- 이 시각까지 공개 키로 내려받을 수 있다(notice_file_url 이 연다)
  created_at timestamptz not null default now()
);
create index if not exists notice_files_key_idx on public.notice_files (notice_key);

alter table public.notice_files enable row level security;
drop policy if exists teacher_all on public.notice_files;
create policy teacher_all on public.notice_files for all to authenticated using (true) with check (true);
revoke all privileges on public.notice_files from anon;
grant all privileges on public.notice_files to authenticated;

create or replace function public.notice_file_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.notice_files where path = p_name and open_until > now())
$$;
revoke all on function public.notice_file_ok(text) from public;
grant execute on function public.notice_file_ok(text) to anon, authenticated;

drop policy if exists notice_files_teacher on storage.objects;
create policy notice_files_teacher on storage.objects for all to authenticated
  using (bucket_id = 'notice-files') with check (bucket_id = 'notice-files');
drop policy if exists notice_files_student_read on storage.objects;
create policy notice_files_student_read on storage.objects for select to anon
  using (bucket_id = 'notice-files' and public.notice_file_ok(name));

-- 이 학생에게 보이는 공지 키 (022 notice_read_submit 판정과 같다)
create or replace function public.notice_visible_(me public.students, nkey text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.notices n
     where not n.hidden
       and (btrim(n.title) <> '' or btrim(n.body) <> '')
       and (btrim(coalesce(n.date,'')) || '|' || btrim(n.title)) = nkey
       and public.notice_matches_(n.type, n.target, btrim(me.name), btrim(me.school), btrim(me.grade),
                                  regexp_replace(btrim(coalesce(me.student_id,'')), '^''', ''), btrim(coalesce(me.code,''))))
$$;
revoke all on function public.notice_visible_(public.students, text) from public;

create or replace function public.notice_files_mine(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  return jsonb_build_object('ok', true, 'files', (
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'key', f.notice_key, 'name', f.name, 'size', f.size)
                              order by f.id), '[]'::jsonb)
      from public.notice_files f
     where public.notice_visible_(me, f.notice_key)));
end $$;
revoke all on function public.notice_files_mine(jsonb) from public;
grant execute on function public.notice_files_mine(jsonb) to anon, authenticated;

create or replace function public.notice_file_url(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        f public.notice_files%rowtype;
        v_fid bigint;
begin
  begin v_fid := nullif(btrim(coalesce(p->>'file','')), '')::bigint;
  exception when others then v_fid := null; end;
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into f from public.notice_files where id = v_fid;
  if f.id is null or not public.notice_visible_(me, f.notice_key) then
    return jsonb_build_object('ok', false, 'error', 'not_visible');
  end if;
  update public.notice_files set open_until = now() + interval '10 minutes' where id = f.id;
  return jsonb_build_object('ok', true, 'bucket', 'notice-files', 'path', f.path, 'name', f.name, 'size', f.size, 'mime', f.mime);
end $$;
revoke all on function public.notice_file_url(jsonb) from public;
grant execute on function public.notice_file_url(jsonb) to anon, authenticated;
