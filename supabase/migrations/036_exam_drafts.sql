-- ============================================================
-- 036: 지필 리포트 자동 생성 — 시험지·정답지(사진·PDF)를 올리면 클로슈(클로드 세션)가 읽어
--      옮긴 글·정답·문항 구성·영역·세부유형·난이도·문항 내용·시험 범위·총평 초안을 만든다
--      (2026-09-29 원장님 요청 "시험지 사진과 정답지를 넣으면 텍스트로 변환하고 문항 분석, 총평 등을 만들어
--       주는 메뉴 — 궁극적으로 지필고사 리포트 제작" → 결정: 클로슈 통로(수정 요청함) · PDF도 받음 ·
--       옮긴 글 보관 · 파일은 지우지 않음 · 리포트 제작 페이지(m.html)에서 '자동 생성/수동 생성'을 고르고,
--       자동 생성 초안은 수동 화면에 채워져 원장님이 확인·배정·등록)
--
--   · exam_drafts — 요청 한 건 = 한 줄. m.html '자동 생성'에서 파일을 올리고 요청하면 status '요청',
--                   클로슈가 draft 를 채우면 '완료', 못 만들면 '보류'(note 에 이유).
--       draft = { text: 옮긴 글(문항 번호·지문 순서대로), answers: [{no, ans}],
--                 scope, review:[문단], questions:[{no, group, area, detail, type, lv, txt, multi}],
--                 notes:[원장님이 확인할 점] }
--       (scope·review·questions 는 m.html collect() 와 같은 모양 — 그대로 수동 화면에 채운다)
--       report_id — 그 초안으로 리포트를 등록하면 m.html 이 리포트 ID 를 적는다(원본 시험지 찾기용).
--   · 저장소(Storage) 버킷 'exam-drafts' — **비공개**, 파일당 20MB. 선생님(authenticated)만, 학생 접근 없음.
--     경로 'd{초안id}/{무작위}.{확장자}'(한글 파일 이름은 files 열에만). 파일은 지우지 않고 보관한다.
-- 공개 키(anon)는 표·버킷 모두 못 쓴다(015 규칙). 재실행 안전.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('exam-drafts', 'exam-drafts', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.exam_drafts (
  id          bigint generated always as identity primary key,
  title       text not null default '',          -- '26-2-중간-화정고1-공통국어2'
  period      text not null default '',
  school      text not null default '',
  grade       text not null default '',          -- '1'·'2'·'3'
  subject     text not null default '',
  scope       text not null default '',          -- 요청 때 적어 둔 시험 범위(클로슈 참고용)
  memo        text not null default '',          -- 원장님 참고 메모(출제 경향·강조할 점 등)
  files       jsonb not null default '[]'::jsonb, -- [{path, name, kind:'시험지'|'정답지', size, mime}]
  status      text not null default '요청' check (status in ('요청','완료','보류')),
  draft       jsonb,
  note        text not null default '',          -- 클로슈 처리 메모('보류' 이유 등)
  report_id   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists exam_drafts_created_idx on public.exam_drafts (created_at desc);

alter table public.exam_drafts enable row level security;
drop policy if exists teacher_all on public.exam_drafts;
create policy teacher_all on public.exam_drafts for all to authenticated using (true) with check (true);
revoke all privileges on public.exam_drafts from anon;
grant all privileges on public.exam_drafts to authenticated;

drop policy if exists exam_drafts_teacher on storage.objects;
create policy exam_drafts_teacher on storage.objects for all to authenticated
  using (bucket_id = 'exam-drafts') with check (bucket_id = 'exam-drafts');
