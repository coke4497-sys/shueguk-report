-- ============================================================
-- 3단계 ④(준비): 공개 키에서 표 권한 회수 — 실제 잠그기
--
-- ⚠️ 배포 전에 실행하지 말 것.
--    이 SQL을 실행하는 순간 '공개 키로 표를 직접 읽는' 모든 페이지가 멈춘다.
--    지금 배포돼 있는(main) 페이지들은 아직 그 방식이므로, **바뀐 페이지가 배포된 뒤**
--    실행해야 한다. 순서: 브랜치 머지 → 사이트 반영 확인 → 아래 실행 → 확인 스크립트.
--
-- 무엇을 하나:
--   · anon(공개 키의 신분)에게서 public 스키마 모든 표의 권한을 회수한다.
--   · 정책(RLS)도 authenticated(교사 신분)만 통과하도록 바꾼다.
--   · 앞으로 만들 표도 자동으로 anon 에 열리지 않게 기본 권한을 바꾼다.
--
-- 그러면:
--   · 학생이 페이지 소스에서 키를 꺼내 `/rest/v1/students?select=*` 를 불러도 막힌다.
--   · 학생 화면은 표 대신 함수(student_bundle·exam_bundle·star_top30·mirror_*)를 쓰므로
--     그대로 동작한다. 함수는 SECURITY DEFINER 라 표 권한과 무관하게 돈다.
--   · 교사 페이지는 조용한 인증으로 authenticated 신분이라 그대로 동작한다.
--   · 일일 점검 도구(tools/audit_heal.py)도 같은 신분으로 인증한다.
--
-- 되돌리려면(문제가 생겼을 때):
--   grant all on all tables in schema public to anon;
--   그리고 정책을 다시 to public 으로 — 아래 되돌리기 블록 참고.
-- ============================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- 공개 키 신분에서 표 권한 회수
    execute format('revoke all privileges on public.%I from anon', t.tablename);
    -- 정책을 교사 신분 전용으로 (옛 anon_all 은 to 절이 없어 모든 신분에 열려 있었다)
    execute format('drop policy if exists anon_all on public.%I', t.tablename);
    execute format('drop policy if exists teacher_all on public.%I', t.tablename);
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('create policy teacher_all on public.%I for all to authenticated using (true) with check (true)', t.tablename);
  end loop;
end $$;

-- 앞으로 만드는 표도 anon 에 열리지 않게
alter default privileges in schema public revoke all on tables from anon;

-- 학생 화면이 쓰는 함수는 계속 부를 수 있어야 한다(표 권한과는 별개)
grant usage on schema public to anon;
grant execute on function public.student_bundle(text, boolean, text)   to anon;
grant execute on function public.exam_bundle(text)                     to anon;
grant execute on function public.star_top30()                          to anon;
grant execute on function public.mirror_submission(jsonb)              to anon;
grant execute on function public.mirror_clinic_requests(jsonb)         to anon;
grant execute on function public.mirror_signup_entry(jsonb)            to anon;
grant execute on function public.mirror_hwork_submission(jsonb)        to anon;
grant execute on function public.mirror_notice_read(jsonb)             to anon;

-- ── 되돌리기(문제가 생기면 이 블록만 실행) ─────────────────────────
-- do $$
-- declare t record;
-- begin
--   for t in select tablename from pg_tables where schemaname = 'public' loop
--     execute format('grant all privileges on public.%I to anon', t.tablename);
--     execute format('drop policy if exists teacher_all on public.%I', t.tablename);
--     execute format('create policy anon_all on public.%I for all using (true) with check (true)', t.tablename);
--   end loop;
-- end $$;
-- alter default privileges in schema public grant all on tables to anon;
