-- ============================================================
-- 060: 수정 요청함 첨부 파일 — 요청에 캡처·사진·PDF 를 붙인다
--      (2026-10-26 원장님 "수정 요청에 파일이나 캡쳐 복사붙이기가 가능하도록" + "내신 시험 범위를 수정요청함에 받아 기록")
--
--   · 수정 요청 자체는 리포트 시트 '수정요청' 탭이 원본(앱스스크립트 editReqAdd)이고 줄에 고유 번호가 없다.
--     그래서 화면이 요청마다 **열쇠 `rq_<무작위 12자>`** 를 만들어 파일은 이 표와 버킷에 두고, 요청 글 끝에
--     `[첨부 n] 이름들 · #rq_…` 한 줄을 붙여 잇는다(editReqList 로 읽는 클로슈도 그 줄을 보고 파일을 받는다 — tools/editreq_files.py).
--   · 저장소(Storage) 버킷 'edit-req-files' — **비공개**, 파일당 20MB. 036(exam-drafts)과 같은 구조.
--     경로 'r/{열쇠}/{무작위}.{확장자}'(한글 파일 이름은 이 표에만). 파일은 지우지 않고 보관한다.
--   · 선생님(authenticated)만 표·저장소 전부, 공개 키(anon)는 접근 없음(015 규칙). 학생 화면과 무관. 재실행 안전.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('edit-req-files', 'edit-req-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.edit_req_files (
  id         bigint generated always as identity primary key,
  req_key    text not null,                 -- 'rq_…' (요청 글 끝의 열쇠)
  writer     text not null default '',      -- 올린 선생님(허브 로그인 이름)
  path       text not null unique,          -- 저장소 안 경로(버킷 이름 제외)
  name       text not null default '',      -- 원래 파일 이름('캡처_1026_153012.png' 등)
  size       bigint not null default 0,
  mime       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists edit_req_files_key_idx on public.edit_req_files (req_key);

alter table public.edit_req_files enable row level security;
drop policy if exists teacher_all on public.edit_req_files;
create policy teacher_all on public.edit_req_files for all to authenticated using (true) with check (true);
revoke all privileges on public.edit_req_files from anon;
grant all privileges on public.edit_req_files to authenticated;

drop policy if exists edit_req_files_teacher on storage.objects;
create policy edit_req_files_teacher on storage.objects for all to authenticated
  using (bucket_id = 'edit-req-files') with check (bucket_id = 'edit-req-files');
