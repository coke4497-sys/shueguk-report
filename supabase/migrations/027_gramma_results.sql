-- ============================================================
-- 027: 문법 테스트 결과 — 슈퍼스타 별 적립 (2026-09-13 사용자 "정답률 90% 이상이면 별 +1")
--
-- 문법 테스트(shueguk-gramma test.html)의 제출 결과를 수파베이스에도 기록한다.
-- 시트(문법 결과 스프레드시트)는 종전대로 페이지가 함께 쓴다(대시보드·삭제는 시트 기준 그대로).
-- 여기 표는 **별 집계의 원본**: 정답률 90% 이상인 테스트(카테고리+회차 단위, 재응시 중복 없음) 하나당 별 1개.
--   · gramma_submit(p)  — 결과 한 건 기록. 응답 {ok, pct, star(90% 이상), first(이 테스트로 처음 별을 받음)}
--   · gramma_status(p)  — 이름+학부모 8자리로 테스트별 최고 정답률 목록(학생 입구 페이지의 '별 획득' 표시용)
--   · student_bundle    — 'gramma_results' 항목을 더한다(학생 페이지 별 집계)
-- 공개 키(anon)는 함수만 부를 수 있고 표는 못 읽는다(015 규칙).
-- ============================================================

create table if not exists public.gramma_results (
  id      bigint generated always as identity primary key,
  ts      text not null default '',        -- 페이지가 보낸 제출 시각 문자열(시트 사본과 동일)
  name    text not null default '',
  school  text not null default '',
  grade   text not null default '',
  phone8  text not null default '',        -- 학부모 휴대전화 8자리(= 학생ID)
  unit    text not null default '',        -- 카테고리 라벨('음운')
  round   text not null default '',        -- 회차('12')
  score   text not null default '',        -- '19 / 21'(시트 사본과 동일 표기)
  got     int  not null default 0,
  total   int  not null default 0,
  pct     int  not null default 0,         -- round(got/total*100)
  details text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists gramma_results_name_idx   on public.gramma_results (name);
create index if not exists gramma_results_phone8_idx on public.gramma_results (phone8);

alter table public.gramma_results enable row level security;
drop policy if exists anon_all on public.gramma_results;
drop policy if exists teacher_all on public.gramma_results;
create policy teacher_all on public.gramma_results for all to authenticated using (true) with check (true);
revoke all privileges on public.gramma_results from anon;

-- 제출 기록 + 별 판정
create or replace function public.gramma_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_got int := coalesce(nullif(trim(p->>'got'), '')::int, 0);
        v_total int := coalesce(nullif(trim(p->>'total'), '')::int, 0);
        v_pct int := 0;
        v_name text := trim(coalesce(p->>'name',''));
        v_phone text := regexp_replace(coalesce(p->>'phone8',''), '[^0-9]', '', 'g');
        v_unit text := trim(coalesce(p->>'unit',''));
        v_round text := trim(coalesce(p->>'round',''));
        v_ts text := coalesce(p->>'time','');
        v_prev int := 0;
begin
  if v_name = '' or v_unit = '' or v_round = '' or v_total <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_pct := round(v_got::numeric * 100 / v_total);
  if v_ts !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}' then
    v_ts := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
  end if;
  -- 같은 학생(이름+8자리)·같은 테스트로 이미 90% 이상을 받은 적이 있는가
  select count(*) into v_prev from public.gramma_results
   where name = v_name and phone8 = v_phone and unit = v_unit and round = v_round and pct >= 90;
  insert into public.gramma_results (ts, name, school, grade, phone8, unit, round, score, got, total, pct, details)
  values (v_ts, v_name, trim(coalesce(p->>'school','')), trim(coalesce(p->>'grade','')), v_phone,
          v_unit, v_round, coalesce(p->>'score', v_got || ' / ' || v_total), v_got, v_total, v_pct,
          left(coalesce(p->>'details',''), 20000));
  return jsonb_build_object('ok', true, 'pct', v_pct, 'star', v_pct >= 90, 'first', (v_pct >= 90 and v_prev = 0));
end $$;

-- 학생 입구 페이지용: 이 학생(이름+8자리)의 테스트별 최고 정답률 (개인정보는 본인 것만, 이름·8자리가 둘 다 맞아야)
create or replace function public.gramma_status(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p->>'name',''));
        v_phone text := regexp_replace(coalesce(p->>'phone8',''), '[^0-9]', '', 'g');
begin
  if v_name = '' or length(v_phone) <> 8 then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'round', round, 'best', best, 'tries', tries, 'star', best >= 90)
             order by unit, round), '[]'::jsonb)
      from (select unit, round, max(pct) as best, count(*) as tries
              from public.gramma_results where name = v_name and phone8 = v_phone
             group by unit, round) s));
end $$;

revoke all on function public.gramma_submit(jsonb) from public;
revoke all on function public.gramma_status(jsonb) from public;
grant execute on function public.gramma_submit(jsonb) to anon, authenticated;
grant execute on function public.gramma_status(jsonb) to anon, authenticated;
