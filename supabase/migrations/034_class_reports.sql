-- ============================================================
-- 034: 슈퍼스타 주간 리포트 — 선생님이 수업마다 진도·과제·코멘트와 숙제 검사를 오늘의 시간표 왼쪽 창에
--      적고, 반마다 [리포트 생성]을 누르면 클로슈(클로드 세션)가 그 학생들의 **주간 리포트 한 장**을
--      새로 써서 학생 페이지에 공개한다.
--      (2026-09-28 사용자 요청 "수업에 온 친구들의 수업 리포트를 학생 개인 페이지에" →
--       결정: 수업마다 입력 / 리포트 생성 → 클로슈가 보고서 형식으로 작성·공개 / 학생별 코멘트 / 출석 표시 /
--             오늘의 시간표 왼쪽 팝업 / 작성은 수정 요청함 통로 / "슈국 슈퍼스타 주간 리포트 형식" —
--             정규 주간은 가·나 수업을, 내신 주간은 진도·확인 수업을 나눠 적는다 / 숙제 검사를 이 창으로 일원화)
--
--   · class_notes   — 수업 한 번(시간표·반ID·날짜)마다 한 줄: 진도·과제·학생별 코멘트 + 리포트 상태.
--                     내신 진도 수업은 고른 시험범위 단원(units)도 담는다(내신대비 피드백 기록과 함께 저장).
--                     report_status: '' 작성 전 / '요청' / '공개' / '보류'(report_note에 이유)
--   · class_reports — 학생 한 명 × 주차 한 장 = 한 줄. 클로슈가 쓴 주간 리포트(body jsonb).
--                     body = { parts:[{part,cls,teacher,ymd,time,attend,attend_note,summary,units[],homework[],pending}],
--                              hw:{items:[{name,score}],pct,missing,text}|null, comments:[{teacher,text}] }
--   · class_report_list(p {key|student}) — 학생 페이지가 부르는 함수(공개 키 허용). 최근 16주, 공개된 것만.
-- 공개 키(anon)는 함수만 부를 수 있고 표는 못 읽는다(015 규칙).
-- ============================================================

create table if not exists public.class_notes (
  id             bigint generated always as identity primary key,
  book           text not null check (book in ('정규','내신')),
  class_id       text not null,
  ymd            date not null,                  -- 수업한 날
  class_name     text not null default '',       -- 기록 당시 반이름(표시용)
  teacher        text not null default '',
  class_time     text not null default '',       -- '금 5:30~7:00'
  part           text not null default '',       -- '가'/'나'/'진도'/'확인'/''(단일 수업)
  progress       text not null default '',       -- 오늘 진도(내신 진도 수업은 메모)
  units          jsonb not null default '[]'::jsonb,  -- 내신 진도 수업에서 고른 시험범위 단원
  homework       text not null default '',       -- 다음 시간까지 과제(한 줄에 하나)
  comments       jsonb not null default '{}'::jsonb,  -- {학생이름(괄호 뗀 것): 코멘트}
  writer         text not null default '',
  report_status  text not null default '',
  report_note    text not null default '',
  requested_at   timestamptz,
  reported_at    timestamptz,
  updated_at     timestamptz not null default now(),
  unique (book, class_id, ymd)
);
create index if not exists class_notes_ymd_idx on public.class_notes (ymd);

create table if not exists public.class_reports (
  id          bigint generated always as identity primary key,
  week        date not null,                     -- 주차 수요일(월·화는 다가오는 수요일 — 시간표 규칙)
  book        text not null default '',          -- 그 주의 기간(정규/내신) — 표시용
  code        text not null default '',          -- students.code(접근코드)
  student_id  text not null default '',
  name        text not null default '',
  body        jsonb not null default '{}'::jsonb,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (week, code)
);
create index if not exists class_reports_code_idx on public.class_reports (code, week);

do $$
declare t text;
begin
  foreach t in array array['class_notes','class_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all privileges on public.%I from anon', t);
    execute format('grant all privileges on public.%I to authenticated', t);
  end loop;
end $$;

-- 학생 페이지: 접근코드(key) 또는 학생ID(student)로 본인 확인 → 최근 16주 공개 주간 리포트
create or replace function public.class_report_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype;
        v_key text := btrim(coalesce(p->>'key',''));
        v_sid text := btrim(coalesce(p->>'student',''));
begin
  if v_key <> '' then
    select * into me from public.students where code = v_key order by seq, id limit 1;
  elsif v_sid <> '' then
    select * into me from public.students where student_id = v_sid order by seq, id limit 1;
  end if;
  if me.id is null or btrim(coalesce(me.code,'')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'week', r.week, 'book', r.book, 'body', r.body, 'at', r.updated_at)
           order by r.week desc), '[]'::jsonb)
      from public.class_reports r
     where r.code = me.code and r.published
       and r.week >= (current_date - 112)));
end $$;

revoke all on function public.class_report_list(jsonb) from public;
grant execute on function public.class_report_list(jsonb) to anon, authenticated;
