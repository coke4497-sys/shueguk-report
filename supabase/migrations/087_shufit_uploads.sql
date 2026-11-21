-- 087: Shuefit [문항 올리기] — 드라이브 「슈핏 문항 올리기」 과목 폴더에서 클로슈가 처리한 파일 기록
-- (2026-11-19 원장님 "문항 올리기 버튼 만들어 주세요"). 선생님이 넣은 파일은 그 선생님 소유라 옮기지 않고, 처리한 파일을 여기 적어
-- 같은 파일을 다시 처리하지 않는다. 한 행 = 드라이브 파일 하나(drive_id 열쇠).
-- status = 올림(지문에 넣음) | 대조용(같은 이름 PDF — 한글 파일과 대조만) | 확인 필요(못 읽음·규칙 밖 — 처리메모·슈톡으로 알림).
-- 교사 전용(045 규칙), 공개 키 차단, 시트 사본 없음. 다시 실행해도 안전하다.
create table if not exists public.shufit_uploads (
  drive_id text primary key,
  name text not null default '',
  subject text not null default '' check (subject in ('','문법','독서','문학','화법','작문')),
  uploaded_by text not null default '',
  status text not null default '올림' check (status in ('올림','대조용','확인 필요')),
  passage_ids text[] not null default '{}',
  note text not null default '',
  req_ts text not null default '',
  processed_at timestamptz not null default now()
);
create index if not exists shufit_uploads_subject_idx on public.shufit_uploads (subject, processed_at desc);
alter table public.shufit_uploads enable row level security;
drop policy if exists teacher_all on public.shufit_uploads;
create policy teacher_all on public.shufit_uploads for all to authenticated using (true) with check (true);
revoke all privileges on public.shufit_uploads from anon;
revoke all privileges on public.shufit_uploads from authenticated;
grant select, insert, update, delete on public.shufit_uploads to authenticated;
