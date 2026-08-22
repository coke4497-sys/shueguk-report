-- 006: 클리닉 신청 미러 (2026-08-23)
-- 원본은 클리닉 시트 「shueguk 클리닉 수업 신청」 '응답' 탭 + 클리닉 백엔드 Script Properties.
-- 정원(강사별 9명)·대상 판정이 서버(Apps Script)에 있으므로 쓰기는 기존 백엔드가 담당,
-- 여기는 읽기 미러 — 학생 폼 제출 훅 + 교사 화면 열람 시 통째 재동기화 + 일일 점검이 유지.

-- '응답' 탭 (제출시각·이름·학교·전화뒤4·클리닉시간·유형·영역·구체내용·질문개수·메모·학년·학생ID·담당강사·토큰·클리어)
create table if not exists clinic_requests (
  id bigint generated always as identity primary key,
  ts text not null default '',          -- 제출시각 'yyyy-MM-dd HH:mm' (KST)
  name text not null default '',
  school text not null default '',      -- 폼의 '학교' (반 표기 포함 가능: "무원고3 화작")
  phone text not null default '',       -- 전화뒤4
  slot text not null default '',        -- 클리닉시간
  rtype text not null default '',       -- 유형 (추가 문제/질문/…)
  area text not null default '',        -- 영역
  content text not null default '',     -- 구체내용
  qcount text not null default '',      -- 질문개수
  memo text not null default '',
  grade text not null default '',       -- '중2'/'고3' 형태 (옛 기록은 빈값)
  student_id text not null default '',
  teacher text not null default '',     -- 담당강사 (옛 기록 빈값 = 이수경T로 표시)
  token text not null default '',       -- 학생 페이지 '내 클리닉 신청' 매칭 키
  clear text not null default ''        -- 클리어(완료) 일시, 빈값=미완료
);
create index if not exists clinic_requests_ts_idx on clinic_requests (ts);
create index if not exists clinic_requests_name_idx on clinic_requests (name);

-- 클리닉 백엔드 Script Properties 미러 (강사별 시간대·신청받기·대상 등)
-- key: open / slots / allSlots / teachers / target — action=data 응답의 같은 이름 값(JSON)
create table if not exists clinic_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['clinic_requests','clinic_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
