-- ============================================================
-- 슈국 수파베이스 이전 1단계: 시간표·출석 시스템 (timetable.html 도메인)
-- 시트 탭 → 테이블 대응은 supabase/README.md 참고.
-- 시트의 문자열 규약(반ID, 명단 공백 구분, 괄호 특이사항)은 페이지 코드
-- 호환을 위해 그대로 유지한다 — 프런트 수정을 연결부 교체로 한정하기 위함.
-- ============================================================

-- 시트 '정규시간표'·'내신시간표' (A:반ID B:요일 C:시작 D:끝 E:위치 F:담당T G:반이름 H:학생명단)
create table if not exists tt_classes (
  id bigint generated always as identity primary key,
  book text not null check (book in ('정규','내신')),
  class_id text not null,
  day text not null,                -- 요일: 월~일
  start_time text not null,         -- '14:00' 형태 문자열 (시트와 동일)
  end_time text not null,
  location text not null default '',
  teacher text not null default '',
  name text not null,
  roster text not null default '',  -- 학생명단 공백 구분 (괄호 특이사항 포함 원본)
  updated_at timestamptz not null default now(),
  unique (book, class_id)
);

-- 시트 '출석기록' (A:날짜 B:시간표 C:반ID D:학생 E:상태 F:메모 G:기록일시 H:보충계획 I:완료 J:보충메모)
create table if not exists attendance (
  id bigint generated always as identity primary key,
  date date not null,
  book text not null check (book in ('정규','내신')),
  class_id text not null,
  student text not null,            -- 표기 원본 (괄호 특이사항 포함)
  student_plain text generated always as (regexp_replace(student, '\(.*\)$', '')) stored,
  status text not null check (status in ('출석','지각','결석')),
  memo text not null default '',
  makeup_plan text not null default '',   -- 결석 보충 계획 (H열)
  makeup_done text not null default '',   -- '완료'/빈칸 (I열)
  makeup_memo text not null default '',   -- 보충메모 (J열)
  updated_at timestamptz not null default now(),
  -- 같은 날·같은 반·같은 학생(괄호 제외)당 1건 — attendSet의 덮어쓰기 규칙과 동일
  unique (date, book, class_id, student_plain)
);
create index if not exists attendance_date_idx on attendance (date);
create index if not exists attendance_student_idx on attendance (student_plain, date);
create index if not exists attendance_makeup_idx on attendance (status, makeup_done) where status = '결석';

-- 시트 '시간표이동기록' (A:일시 B:구분 C:학생 D:from반ID E:from반 F:to반ID G:to반 H:사유 I:시간표 J:적용일)
create table if not exists tt_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,               -- 영구/1회/추가/빼기/표기수정 등
  student text not null,
  from_class_id text not null default '',
  from_class text not null default '',
  to_class_id text not null default '',
  to_class text not null default '',
  reason text not null default '',
  book text not null default '정규' check (book in ('정규','내신')),
  apply_date date                   -- 1회 이동 적용일 (J열)
);
create index if not exists tt_log_at_idx on tt_log (at);
create index if not exists tt_log_apply_idx on tt_log (apply_date) where apply_date is not null;
create index if not exists tt_log_student_idx on tt_log (student);

-- 시트 '시간표메모' (A:날짜 B:메모 C:기록일시) — 오늘의 이슈, 날짜당 1건
create table if not exists tt_memo (
  date date primary key,
  memo text not null default '',
  updated_at timestamptz not null default now()
);

-- 시트 '기간설정' (A:주차수요일 B:구분 C:기록일시) — 슈국 캘린더 주별 정규/내신
create table if not exists tt_period (
  week_wednesday date primary key,
  book text not null check (book in ('정규','내신')),
  updated_at timestamptz not null default now()
);

-- 시트 '지필일정' (A:유형 B:학교 C:시작일 D:종료일 E:내용 F:기록일시)
create table if not exists exam_sched (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('기간','과목')),
  school text not null,
  start_date date not null,
  end_date date,                    -- 과목은 해당일 하루 (start=end 또는 null)
  text text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists exam_sched_range_idx on exam_sched (start_date);

-- updated_at 자동 갱신
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tt_classes','attendance','tt_memo','tt_period','exam_sched'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ── 접근 정책 ─────────────────────────────────────────────────
-- 현재 티쳐스 페이지는 게이트 없이 공개이고 서버 비밀번호도 페이지에 내장돼
-- 있으므로(2026-08-14 사용자 확정 공개 수준), 익명(publishable 키) 읽기·쓰기를
-- 허용한다. 나중에 로그인 도입 시 이 정책만 조이면 된다.
do $$
declare t text;
begin
  foreach t in array array['tt_classes','attendance','tt_log','tt_memo','tt_period','exam_sched'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
