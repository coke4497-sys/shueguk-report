-- ============================================================
-- 023 (2026-08-30): 모의고사 회차별 평균 — 학생 화면의 '성적 추이' 평균선용
--
-- 학생 페이지(s.html)의 성적 추이에 슈국 평균선을 겹쳐 보여 주려면 그 회차의 평균이 필요한데,
-- 학생 화면은 공개 키(anon)라 015 이후 omr_responses 를 직접 읽지 못한다(읽히면 전교생 점수가 샌다).
-- 그래서 **평균과 응시 인원 숫자만** 돌려주는 창구를 따로 둔다. 이름·개별 점수는 어떤 경우에도 나가지 않는다.
--
-- 규칙 (hub omr_analysis.html '회차 분석'의 기본값과 같게 맞춤 — 교사 화면과 숫자가 어긋나지 않게):
--   · 점수는 저장값이 아니라 **지금 정답으로 다시 채점**한 값 (omr_score_build_)
--   · 이름이나 학교가 '테스트'인 제출(출제 뒤 시험 삼아 낸 것)은 제외
--   · 같은 학생(이름+학교)의 여러 제출은 **마지막 것만**
--   · **응시 5명 미만인 회차는 평균을 내보내지 않는다**(avg = null) — 인원이 적으면 평균으로
--     남의 점수가 짐작될 수 있어서. 인원(n)은 그대로 알려 준다.
--
-- 입력  p = {exams: ["260829-260830", ...]}   (학생이 응시한 회차만, 최대 30개)
-- 출력  {result:'success', stats:[{exam, subject, n, avg}, ...]}
--       subject 는 '화법과작문'·'언어와매체'·'공통' 과 전체 합계인 '전체'
-- ============================================================

create or replace function public.omr_exam_stats(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exams text[];
  v_min   int := 5;         -- 이 인원 미만이면 평균을 내보내지 않는다
  r       record;
  packs   jsonb := '{}'::jsonb;
  pack    jsonb;
  rep     jsonb;
  v_key   text;
  sums    jsonb := '{}'::jsonb;   -- '회차|과목' -> [합계, 인원]
  k       text;
  parts   text[];
  v_n     numeric;
  v_sum   numeric;
  out_arr jsonb := '[]'::jsonb;
begin
  select array_agg(x)::text[] into v_exams
  from (select jsonb_array_elements_text(coalesce(p->'exams', '[]'::jsonb)) as x limit 30) t;
  if v_exams is null or array_length(v_exams, 1) is null then
    return jsonb_build_object('result', 'success', 'stats', '[]'::jsonb);
  end if;

  for r in
    -- 같은 학생(이름+학교)의 마지막 제출만, 테스트 제출은 빼고
    select distinct on (exam, btrim(name), btrim(school)) *
    from omr_responses
    where exam = any(v_exams)
      and btrim(name) <> '테스트' and btrim(school) <> '테스트'
    order by exam, btrim(name), btrim(school), submitted_at desc, id desc
  loop
    if packs ? r.exam then
      pack := packs->r.exam;
    else
      select data::jsonb into pack from omr_exams where name = r.exam;
      if pack is null then continue; end if;    -- 정답이 없는 옛 회차는 건너뜀
      packs := packs || jsonb_build_object(r.exam, pack);
    end if;

    rep := omr_score_build_(pack, jsonb_build_object(
      'examName', r.exam, 'examDate', r.exam_date, 'name', r.name, 'school', r.school,
      'grade', r.grade, 'subject', r.subject, 'answers', r.answers));
    if not (rep->>'ok')::boolean then continue; end if;

    -- 과목별 + 전체 두 칸에 더한다
    foreach v_key in array array[rep->'student'->>'subject', '전체'] loop
      k := r.exam || '|' || v_key;
      v_sum := coalesce((sums->k->>0)::numeric, 0) + (rep->'result'->>'got')::numeric;
      v_n   := coalesce((sums->k->>1)::numeric, 0) + 1;
      sums := sums || jsonb_build_object(k, jsonb_build_array(v_sum, v_n));
    end loop;
  end loop;

  for k in select jsonb_object_keys(sums) loop
    parts := string_to_array(k, '|');
    v_sum := (sums->k->>0)::numeric;
    v_n   := (sums->k->>1)::numeric;
    out_arr := out_arr || jsonb_build_object(
      'exam', parts[1], 'subject', parts[2], 'n', v_n::int,
      'avg', case when v_n >= v_min then round(v_sum / v_n, 1) else null end);
  end loop;

  return jsonb_build_object('result', 'success', 'stats', out_arr);
end $$;

-- 학생 화면(공개 키)도 부를 수 있어야 한다 — 평균·인원 숫자만 나가므로 안전하다.
grant execute on function public.omr_exam_stats(jsonb) to anon, authenticated;
