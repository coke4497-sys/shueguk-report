-- ============================================================
-- 058: 교육청·평가원 모의고사 리포트 — 회차 정답·배점·등급컷·문항 정보 (2026-10-21 원장님이
--      10월 고1 학력평가 문제지·정답 해설·등급컷·전국 오답률을 주며 → 결정: 점수·등급 자동 계산 ·
--      문항별 영역·유형 표시 · 선생님용 회차 분석)
--
--   · smock_exams.info jsonb (없으면 null — 정답이 없는 회차는 예전처럼 학생이 점수를 적는다)
--       { answers: [45개 정답 1~5],
--         points:  [45개 배점 2|3 — 합 100],
--         items:   [45개 {area:'독서', sub:'독서(과학)', intent:'세부 내용 적용하기', work:'…'}],
--         cuts:    { avg, sd, rows: [{grade:'최고점'|1~8, raw, std, pct, prev}] },
--         nat:     { "14": {rate: 69.9, dist: [15.2,23.5,30.1,24.9,6.4]}, … } }   ← 전국 오답률(있는 문항만)
--   · smock_submit — 회차에 배점이 있으면 점수를 서버가 계산한다(100 − 틀린 문항 배점 합, 화면이 보낸 점수는 쓰지 않음).
--   · smock_mine — 열린 회차·내 기록에 info 를 함께 준다(정답은 학생이 입력한 뒤 확인용으로 보여 준다).
-- ============================================================

alter table public.smock_exams add column if not exists info jsonb;

create or replace function public.smock_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype; g text;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  g := public.smock_grade_(me.grade);
  return jsonb_build_object('ok', true, 'grade', g,
    'open', (select coalesce(jsonb_agg(jsonb_build_object('key', e.key, 'year', e.year, 'month', e.month,
                 'grade', e.grade, 'layout', e.layout, 'title', e.title, 'info', e.info) order by e.year desc, e.month desc), '[]'::jsonb)
               from public.smock_exams e where e.open and e.grade = g),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('exam', x.exam_key, 'year', e.year, 'month', e.month,
                 'grade', e.grade, 'layout', e.layout, 'title', e.title, 'open', e.open, 'info', e.info,
                 'score', x.score, 'score_text', x.score_text, 'feel', x.feel, 'subject', x.subject,
                 'wrong', x.wrong, 'review', x.review, 'src', x.src,
                 'at', x.submitted_at, 'updated_at', x.updated_at) order by e.year desc, e.month desc), '[]'::jsonb)
               from public.smock_entries x join public.smock_exams e on e.key = x.exam_key
              where x.code = me.code));
end $$;

create or replace function public.smock_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.students%rowtype; e public.smock_exams%rowtype;
        v_wrong jsonb; v_txt text; v_score numeric; v_subj text; v_feel text; v_first boolean;
        v_auto boolean; k text; n jsonb; v_lost numeric := 0;
begin
  me := public.review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  select * into e from public.smock_exams where key = btrim(coalesce(p->>'exam',''));
  if e.key is null then return jsonb_build_object('ok', false, 'error', 'no_exam'); end if;
  if not e.open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if e.grade <> public.smock_grade_(me.grade) then return jsonb_build_object('ok', false, 'error', 'wrong_grade'); end if;

  v_wrong := public.smock_clean_wrong_(e.layout, coalesce(p->'wrong', '{}'::jsonb));
  if v_wrong is null then return jsonb_build_object('ok', false, 'error', 'bad_wrong'); end if;

  v_auto := e.info is not null and jsonb_typeof(e.info->'points') = 'array' and jsonb_array_length(e.info->'points') >= 45;
  if v_auto then
    for k in select jsonb_object_keys(v_wrong) loop
      for n in select * from jsonb_array_elements(v_wrong->k) loop
        v_lost := v_lost + coalesce((e.info->'points'->>((n #>> '{}')::int - 1))::numeric, 0);
      end loop;
    end loop;
    v_score := greatest(0, 100 - v_lost);
    v_txt := v_score::text;
  else
    v_txt := left(btrim(coalesce(p->>'score','')), 20);
    if v_txt = '' then return jsonb_build_object('ok', false, 'error', 'no_score'); end if;
    if v_txt ~ '^[0-9]{1,3}(\.[0-9])?$' then
      v_score := v_txt::numeric;
      if v_score > 100 then return jsonb_build_object('ok', false, 'error', 'bad_score'); end if;
    end if;
  end if;
  v_subj := btrim(coalesce(p->>'subject',''));
  if e.layout = '고3' then
    if v_subj not in ('화법과작문','언어와매체') then return jsonb_build_object('ok', false, 'error', 'no_subject'); end if;
  else
    v_subj := '';
  end if;
  select string_agg(f, ', ' order by array_position(array['최상','상','중','하'], f)) into v_feel
    from (select distinct btrim(x) f from unnest(string_to_array(coalesce(p->>'feel',''), ',')) x) s
   where f in ('최상','상','중','하');

  v_first := not exists (select 1 from public.smock_entries where exam_key = e.key and code = me.code);
  insert into public.smock_entries as t (exam_key, code, student_id, name, school, grade, score, score_text, feel,
                                         subject, wrong, review, src)
  values (e.key, me.code, coalesce(me.student_id,''), coalesce(me.name,''), coalesce(me.school,''), coalesce(me.grade,''),
          v_score, v_txt, coalesce(v_feel,''), v_subj, v_wrong, left(coalesce(p->>'review',''), 1000), '학생')
  on conflict (exam_key, code) do update
     set score = excluded.score, score_text = excluded.score_text, feel = excluded.feel, subject = excluded.subject,
         wrong = excluded.wrong, review = excluded.review, name = excluded.name, school = excluded.school,
         grade = excluded.grade, student_id = excluded.student_id, updated_at = now();
  return jsonb_build_object('ok', true, 'first', v_first, 'exam', e.key, 'score', v_score);
end $$;

revoke all on function public.smock_mine(jsonb) from public;
revoke all on function public.smock_submit(jsonb) from public;
grant execute on function public.smock_mine(jsonb) to anon, authenticated;
grant execute on function public.smock_submit(jsonb) to anon, authenticated;
