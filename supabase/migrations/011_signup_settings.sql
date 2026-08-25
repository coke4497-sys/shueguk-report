-- ============================================================
-- 1단계(2026-08-25): 주말 모의고사 신청 설정 미러
--
-- 학생 개별 페이지(s.html)는 열릴 때마다 신청 백엔드에 ?action=days 를 물어
-- '신청받기 중단 여부'와 '신청 가능 학년'만 받아 왔다. 그 한 번이 5~19초라
-- 학생 페이지 지연의 가장 큰 몫이었다. 값은 두 개뿐이고 교사가 가끔 바꾸므로
-- 미러에 두고 리포트 연결부가 함께 담아 준다.
--
-- 원본은 신청 백엔드(Script Properties + 신청 시트 '설정' 탭)다 — 여기는 읽기 미러.
-- 갱신: 신청 확인 페이지(signup_teacher.html)가 목록을 읽을 때와
--       신청받기·학년을 저장할 때. 그리고 일일 점검(--signup)이 대조·복구.
-- ============================================================

-- key: open(boolean) / grades(text[] 예: ["1","3"]) — 신청 백엔드 action=data 의 같은 이름 값
create table if not exists signup_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table signup_settings enable row level security;
drop policy if exists anon_all on signup_settings;
create policy anon_all on signup_settings for all using (true) with check (true);
