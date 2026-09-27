-- ============================================================
-- 032: 복습 영상 자료 파일 — 선생님이 올리고, 그 영상을 배정받은 학생만 내려받는다
--      (2026-09-27 사용자 요청 "수업 영상에 파일을 제공하고 싶어요. 학생이 다운로드 할 수 있게요"
--       → 결정 "선생님 화면에서 바로 올리기" + "그 영상을 배정받은 학생만")
--
--   · 저장소(Storage) 버킷 'review-files' — **비공개**, 파일당 20MB.
--     선생님(authenticated)은 올리기·지우기·읽기, 공개 키(anon)는 **내려받기 창이 열린 파일만** 읽기.
--   · review_files — 영상에 붙은 파일 목록(원래 파일 이름·크기). 저장 경로는 'v{영상}/{무작위}.{확장자}'
--     (한글 파일 이름은 경로에 쓰지 않고 이 표에만 둔다 — 내려받을 때 원래 이름으로 저장된다).
--   · review_file_url(p {key|student, file}) — 배정받은 학생인지 확인한 뒤 그 파일의 내려받기 창을 10분 열고
--     경로를 돌려준다. 학생 페이지는 그 경로를 공개 키로 받아(storage /object/authenticated/…) 파일로 저장한다.
--     10분이 지나면 공개 키로는 다시 막힌다 — 주소를 밖으로 보내도 계속 받을 수는 없다.
--   · review_list / review_open — 031 본문 + 'files'(열기) · 'nfiles'(목록) 항목.
-- 031 뒤에 실행할 것. 공개 키(anon)는 표를 못 읽고 함수만 부른다(015 규칙).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('review-files', 'review-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.review_files (
  id         bigint generated always as identity primary key,
  video_id   bigint not null references public.review_videos(id) on delete cascade,
  path       text not null unique,          -- 저장소 안 경로(버킷 이름 제외)
  name       text not null default '',      -- 원래 파일 이름
  size       bigint not null default 0,
  mime       text not null default '',
  open_until timestamptz,                   -- 이 시각까지 공개 키로 내려받을 수 있다(review_file_url 이 연다)
  created_at timestamptz not null default now()
);
create index if not exists review_files_video_idx on public.review_files (video_id);

alter table public.review_files enable row level security;
drop policy if exists teacher_all on public.review_files;
create policy teacher_all on public.review_files for all to authenticated using (true) with check (true);
revoke all privileges on public.review_files from anon;
grant all privileges on public.review_files to authenticated;

-- 저장소 읽기 판정: 그 경로의 내려받기 창이 열려 있는가 (정책에서 부른다 — 표를 못 읽는 anon 대신 이 함수가 본다)
create or replace function public.review_file_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.review_files where path = p_name and open_until > now())
$$;
revoke all on function public.review_file_ok(text) from public;
grant execute on function public.review_file_ok(text) to anon, authenticated;

drop policy if exists review_files_teacher on storage.objects;
create policy review_files_teacher on storage.objects for all to authenticated
  using (bucket_id = 'review-files') with check (bucket_id = 'review-files');
drop policy if exists review_files_student_read on storage.objects;
create policy review_files_student_read on storage.objects for select to anon
  using (bucket_id = 'review-files' and public.review_file_ok(name));

-- 학생: 파일 하나의 내려받기 창을 연다
create or replace function public.review_file_url(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        f public.review_files%rowtype;
        v_fid bigint := nullif(btrim(coalesce(p->>'file','')), '')::bigint;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into f from public.review_files where id = v_fid;
  if f.id is null or not exists (
       select 1 from public.review_targets t join public.review_videos v on v.id = t.video_id and v.active
        where t.video_id = f.video_id and t.code = me.code) then
    return jsonb_build_object('ok', false, 'error', 'not_assigned');
  end if;
  update public.review_files set open_until = now() + interval '10 minutes' where id = f.id;
  return jsonb_build_object('ok', true, 'bucket', 'review-files', 'path', f.path, 'name', f.name, 'size', f.size, 'mime', f.mime);
end $$;
revoke all on function public.review_file_url(jsonb) from public;
grant execute on function public.review_file_url(jsonb) to anon, authenticated;

-- 031 본문 + 파일 수(nfiles)
create or replace function public.review_list(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  return jsonb_build_object('ok', true, 'done_pct', public.review_done_pct(), 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', v.id, 'yt', v.yt_id, 'title', v.title, 'memo', v.memo, 'duration', v.duration,
             'at', v.created_at, 'cls', t.class_name,
             'pct', coalesce(w.pct, 0), 'sec', coalesce(w.total_sec, 0), 'pos', coalesce(w.last_pos, 0),
             'done', w.completed_at is not null,
             'nfiles', (select count(*) from public.review_files f where f.video_id = v.id)) order by v.created_at desc, v.id desc), '[]'::jsonb)
      from public.review_targets t
      join public.review_videos v on v.id = t.video_id and v.active
      left join public.review_watch w on w.video_id = v.id and w.code = t.code
     where t.code = me.code));
end $$;

-- 031 본문 + 파일 목록(files — 경로는 싣지 않는다. 내려받을 때 review_file_url 로 받는다)
create or replace function public.review_open(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype;
        v public.review_videos%rowtype;
        w public.review_watch%rowtype;
        v_vid bigint := nullif(btrim(coalesce(p->>'video','')), '')::bigint;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into v from public.review_videos where id = v_vid and active;
  if v.id is null or not exists (select 1 from public.review_targets where video_id = v.id and code = me.code) then
    return jsonb_build_object('ok', false, 'error', 'not_assigned');
  end if;
  select * into w from public.review_watch where video_id = v.id and code = me.code;
  return jsonb_build_object('ok', true, 'done_pct', public.review_done_pct(),
    'id', v.id, 'yt', v.yt_id, 'title', v.title, 'memo', v.memo, 'duration', v.duration,
    'bits', coalesce(w.bits, ''), 'pct', coalesce(w.pct, 0), 'sec', coalesce(w.total_sec, 0),
    'pos', coalesce(w.last_pos, 0), 'done', w.completed_at is not null,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size) order by f.id), '[]'::jsonb)
                from public.review_files f where f.video_id = v.id));
end $$;
