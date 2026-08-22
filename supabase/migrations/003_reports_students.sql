-- ============================================================
-- 슈국 수파베이스 이전 3단계: 지필 리포트·성적 + 학생정보 미러
-- ============================================================

-- 시트 '보고서목록' (A:ID B:제목 C:복기 D:시험범위 E:학교 F:학년)
create table if not exists exams (
  report_id text primary key,
  title text not null default '',
  review text not null default '',
  scope text not null default '',
  school text not null default '',
  grade text not null default '',
  at timestamptz not null default now()
);

-- 시트 '문항' (A:ID B:번호 C:영역 D:형식 E:난도 F:내용 G:세부유형 H:지문그룹 I:복수선택)
create table if not exists exam_questions (
  id bigint generated always as identity primary key,
  report_id text not null,
  seq int not null default 0,          -- 시트 행 순서 (문항 표시 순서 유지)
  no text not null default '',
  area text not null default '',
  qtype text not null default '',
  lv text not null default '',
  txt text not null default '',
  detail text not null default '',
  grp text not null default '',
  multi boolean not null default false
);
create index if not exists exam_questions_rid_idx on exam_questions (report_id, seq);

-- 시트 '제출결과' (A:제출일시 B:시험 C:학교 D:학년 E:이름 F:틀린문항수 G:틀린문항·반성
--                H:다짐 I:선생님의한마디 J:예상점수 K:부모님연락처)
create table if not exists submissions (
  id bigint generated always as identity primary key,
  submitted_at timestamptz not null default now(),
  exam text not null default '',       -- 시험ID 또는 제목(옛 기록)
  school text not null default '',
  grade text not null default '',
  name text not null default '',
  wrong_count text not null default '',
  wrong_text text not null default '',
  vow text not null default '',
  teacher_note text not null default '',
  score text not null default '',
  parent_phone text not null default ''
);
create index if not exists submissions_exam_idx on submissions (exam);
create index if not exists submissions_name_idx on submissions (name);

-- 시트 '학생정보' 미러 — **시트가 원본**(신입 등록·수정은 슈퍼스타 페이지=기존 백엔드).
-- 여기서는 제출결과 화면의 학생 매칭(개별 페이지 링크)용으로만 읽는다.
create table if not exists students (
  id bigint generated always as identity primary key,
  student_id text not null default '',   -- 부모님 전화 8자리
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  teacher text not null default '',
  memo text not null default '',
  class_a text not null default '',      -- 정규 가
  class_b text not null default '',      -- 정규 나
  naeshin_a text not null default '',
  naeshin_b text not null default '',
  enrolled text not null default '',     -- 재원 여부
  code text not null default '',         -- 접근코드
  student_phone text not null default '',
  reg_date text not null default '',
  seq int not null default 0             -- 시트 행 순서
);
create index if not exists students_name_idx on students (name);
create index if not exists students_sid_idx on students (student_id);

-- 접근 정책 — 기존 공개 수준과 동일 (티쳐스 페이지 게이트 없음; 제출결과·접근코드는
-- 현재도 t.html/getResults가 비밀번호 없이 응답하는 공개 수준)
do $$
declare t text;
begin
  foreach t in array array['exams','exam_questions','submissions','students'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
