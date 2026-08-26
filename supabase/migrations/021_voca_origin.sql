-- 021: 어휘 테스트 제출 — 수파베이스가 원본 (2026-08-26)
-- 제출 판정(열린 주차·운영 중단 — 어휘 Code.gs doPost와 리포트 vocaStatus의 조합)을 1:1로 옮긴
-- SECURITY DEFINER 함수 하나를 anon에 연다(016·019·020과 같은 방식).
-- 채점은 원래 페이지(test.html)가 한다 — 정답이 공개 데이터(data/*.json)에 있는 구조라 그대로.
-- 열린 주차·운영 여부 설정의 원본은 여전히 리포트 시트 '설정' 탭 — report_config 미러를 읽는다
-- (티쳐스 토글이 백엔드 먼저 + 미러 갱신, 일일 점검이 시트 기준 복구 — 종전 그대로).
--   · voca_submit(p) — 판정 후 voca_results에 기록. 응답 {ok:true} / {ok:false, error, week}.

-- 시트가 숫자로 바꾸는 칸(전화 뒤 4자리·주차)을 시트 사본과 같은 표기로 맞춘다
-- (어휘 Code.gs sbNum_ 1:1 — '0913' → '913'. 사본과 표기가 다르면 일일 점검이 매번 차이로 잡는다)
create or replace function public.voca_num_(v text)
returns text language sql immutable set search_path = public as $$
  select case when trim(coalesce(v,'')) ~ '^\d+$'
              then trim(coalesce(v,''))::bigint::text
              else trim(coalesce(v,'')) end;
$$;

-- '설정' 값의 켜짐/꺼짐 판정 (리포트 backend configOpen_ 1:1 — 빈값/항목 없음 = 기본값 참)
create or replace function public.voca_open_()
returns boolean language plpgsql stable set search_path = public as $$
declare s text;
begin
  select lower(trim(value)) into s from report_config where key = '어휘 테스트';
  if s is null or s = '' then return true; end if;
  return not (s in ('중단','off','n','no','x','0','닫힘','꺼짐'));
end $$;

create or replace function public.voca_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wk_s text; wk int;
        round_s text := trim(coalesce(p->>'round',''));
        ts_s text := coalesce(p->>'time','');
begin
  -- 지난 주차 제출 차단 (어휘 Code.gs doPost 1:1 — 설정을 못 읽으면 정상 제출을 잃지 않도록 받아준다)
  if not voca_open_() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  select trim(value) into wk_s from report_config where key = '어휘 주차';
  if wk_s ~ '^\d+$' then
    wk := wk_s::int;
    if wk >= 1 and wk::text <> round_s then
      return jsonb_build_object('ok', false, 'error', 'wrong_week', 'week', wk);
    end if;
  end if;
  -- 제출 시각은 페이지가 보낸 문자열 그대로(시트 사본과 정확히 일치) — 모양이 다르면 서버 시각
  if ts_s !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}' then
    ts_s := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
  end if;
  insert into voca_results (ts, name, school, grade, phone4, round, score, details)
  values (ts_s, coalesce(p->>'name',''), coalesce(p->>'school',''), coalesce(p->>'grade',''),
          voca_num_(p->>'phone4'), voca_num_(p->>'round'),
          coalesce(p->>'score',''), coalesce(p->>'details',''));
  return jsonb_build_object('ok', true);
end $$;

-- ── 권한: 학생 페이지(공개 키)는 제출 함수만 부를 수 있다 ─────────
revoke all on function public.voca_num_(text) from public;
revoke all on function public.voca_open_() from public;
revoke all on function public.voca_submit(jsonb) from public;
grant execute on function public.voca_submit(jsonb) to anon, authenticated;
