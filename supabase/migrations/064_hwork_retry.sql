-- 064: H WORK 다시 풀기 · 오답 정리 (2026-11-11 원장님 "틀린 문제를 다시 풀게 하고 오답정리를 시키고 싶어요" → 권장안)
-- 흐름: 1차 제출 → 결과는 O·X만(틀린 문항 정답은 감춤) → [틀린 문항 다시 풀기] 1번
--       → 2차에도 틀린 문항만 오답 정리(왜 틀렸나요 + 바르게 고친 풀이) → 그때 틀렸던 문항 정답 공개.
-- 별은 주지 않는다(진단·정리용).
--
--   · hwork_submissions 새 열: retry_key(학생 화면이 받은 열쇠) · retry_answers · retry_detail{q:{mine,ok}}
--     · retry_got · retry_at · review{q:{why,fix}} · review_at
--   · hwork_submit(p)        — 020 본문 그대로 + 열쇠를 만들어 넣고 id·key 를 돌려준다.
--                              응답의 detail 에서 **틀린 문항(ok=false)의 ans 를 뺀다**(저장된 detail 에는 그대로).
--   · hwork_retry(p)         — {id,key,answers}: 1차에 틀린 문항만 저장된 정답으로 다시 채점, 한 번만.
--   · hwork_review(p)        — {id,key,notes}: 2차에도 틀린 문항마다 why(네 가지 중 하나)·fix(1~300자) 필수, 한 번만.
--                              성공하면 1차에 틀린 문항 전부의 정답을 돌려준다.
--   · hwork_retry_state(p)   — {id,key}: 이어 하기용 — 단계와(정리까지 끝났으면) 정답.
-- 열쇠가 맞아야만 읽고 쓴다(제출한 학생 화면만 아는 값). 마감 뒤에도 다시 풀기·정리는 받는다(새 제출이 아니라서).
-- 다시 실행해도 안전하다. 020·063 의 다른 함수는 그대로.

alter table public.hwork_submissions add column if not exists retry_key text;
alter table public.hwork_submissions add column if not exists retry_answers jsonb;
alter table public.hwork_submissions add column if not exists retry_detail jsonb;
alter table public.hwork_submissions add column if not exists retry_got int;
alter table public.hwork_submissions add column if not exists retry_at text;
alter table public.hwork_submissions add column if not exists review jsonb;
alter table public.hwork_submissions add column if not exists review_at text;

-- 응답용: 틀린 문항(ok=false)의 정답을 지운 detail
create or replace function public.hwork_hide_wrong_(detail jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, case when (v->>'ok') = 'false' then v - 'ans' else v end), '{}'::jsonb)
  from jsonb_each(coalesce(detail, '{}'::jsonb)) e(k, v);
$$;

create or replace function public.hwork_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := coalesce(p->>'teacher',''); c text := coalesce(p->>'code','');
        hw record; d text; r jsonb; v_id bigint; v_key text;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  select * into hw from hwork_homeworks where teacher = t and code = c limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'H WORK을 찾을 수 없습니다: ' || t || ' / ' || c);
  end if;
  d := hwork_due_(hw.due);
  if hwork_closed_(d) then
    return jsonb_build_object('ok', false, 'error', '마감된 과제입니다 (마감 ' || d || '). 선생님께 문의해 주세요.');
  end if;
  if hw.data is null or hw.data = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', '정답 데이터(C칸)가 비어 있습니다.');
  end if;
  r := hwork_grade_(hw.data, coalesce(p->'answers','{}'::jsonb));
  v_key := replace(gen_random_uuid()::text, '-', '');
  insert into hwork_submissions (ts,teacher,code,school,grade,name,got,total,answers,detail,questions,retry_key)
  values (ts_now, t, c, coalesce(p->>'school',''), coalesce(p->>'grade',''), coalesce(p->>'name',''),
          (r->>'got')::int, (r->>'total')::int,
          coalesce(p->'answers','{}'::jsonb), r->'detail', coalesce(p->'questions','{}'::jsonb), v_key)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key,
    'result', jsonb_set(r, '{detail}', hwork_hide_wrong_(r->'detail')),
    'student', jsonb_build_object('teacher', t, 'code', c, 'school', coalesce(p->>'school',''),
                                  'grade', coalesce(p->>'grade',''), 'name', coalesce(p->>'name','')));
end $$;

-- 열쇠로 제출 한 줄 찾기 (없으면 null)
create or replace function public.hwork_row_(p jsonb)
returns public.hwork_submissions language sql stable security definer set search_path = public as $$
  select s.* from hwork_submissions s
   where s.id = case when coalesce(p->>'id','') ~ '^\d{1,18}$' then (p->>'id')::bigint else -1 end
     and s.retry_key is not null and s.retry_key = coalesce(p->>'key','')
   limit 1;
$$;

-- 1차에 틀린(ok=false) 문항 번호
create or replace function public.hwork_wrong_qs_(detail jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(k order by k::int), '{}') from jsonb_each(coalesce(detail,'{}'::jsonb)) e(k, v)
   where (v->>'ok') = 'false' and k ~ '^\d+$';
$$;

create or replace function public.hwork_retry(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; qs text[]; q text; it jsonb; mine text; ok boolean;
        rd jsonb := '{}'::jsonb; ra jsonb := '{}'::jsonb; v_got int := 0; still text[] := '{}';
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다. 처음부터 다시 제출해 주세요.'); end if;
  if s.retry_at is not null then return jsonb_build_object('ok', false, 'error', '이미 다시 풀었습니다.', 'reason', 'done'); end if;
  qs := hwork_wrong_qs_(s.detail);
  if coalesce(array_length(qs,1),0) = 0 then return jsonb_build_object('ok', false, 'error', '다시 풀 문항이 없습니다.'); end if;
  foreach q in array qs loop
    it := s.detail->q;
    mine := coalesce(p->'answers'->>q, '');
    if it->>'type' = 'text' then ok := hwork_text_ok_(mine, it->>'ans');
    else ok := coalesce(it->>'ans','') <> '' and mine = it->>'ans'; end if;
    ra := ra || jsonb_build_object(q, mine);
    rd := rd || jsonb_build_object(q, jsonb_build_object('mine', mine, 'ok', ok));
    if ok then v_got := v_got + 1; else still := still || q; end if;
  end loop;
  update hwork_submissions set retry_answers = ra, retry_detail = rd, retry_got = v_got, retry_at = ts_now
   where id = s.id and retry_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', '이미 다시 풀었습니다.', 'reason', 'done'); end if;
  return jsonb_build_object('ok', true, 'retry', rd, 'retry_got', v_got, 'still', to_jsonb(still));
end $$;

-- 1차에 틀린 문항의 정답 {q: ans}
create or replace function public.hwork_wrong_ans_(detail jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, coalesce(v->>'ans','')), '{}'::jsonb)
    from jsonb_each(coalesce(detail,'{}'::jsonb)) e(k, v) where (v->>'ok') = 'false';
$$;

create or replace function public.hwork_review(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; q text; n jsonb; why text; fix text; out jsonb := '{}'::jsonb;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  if s.retry_at is null then return jsonb_build_object('ok', false, 'error', '먼저 틀린 문항을 다시 풀어 주세요.', 'reason', 'no_retry'); end if;
  if s.review_at is not null then return jsonb_build_object('ok', false, 'error', '이미 오답 정리를 마쳤습니다.', 'reason', 'done'); end if;
  for q in select k from jsonb_each(coalesce(s.retry_detail,'{}'::jsonb)) e(k, v) where (v->>'ok') = 'false' loop
    n := p->'notes'->q;
    why := btrim(coalesce(n->>'why',''));
    fix := btrim(coalesce(n->>'fix',''));
    if why not in ('개념을 몰라서','헷갈려서','문제를 잘못 읽어서','실수') then
      return jsonb_build_object('ok', false, 'error', q || '번: 왜 틀렸는지 골라 주세요.', 'reason', 'why', 'q', q);
    end if;
    if fix = '' then
      return jsonb_build_object('ok', false, 'error', q || '번: 바르게 고친 풀이를 적어 주세요.', 'reason', 'fix', 'q', q);
    end if;
    if char_length(fix) > 300 then
      return jsonb_build_object('ok', false, 'error', q || '번: 풀이는 300자까지 적을 수 있어요.', 'reason', 'long', 'q', q);
    end if;
    out := out || jsonb_build_object(q, jsonb_build_object('why', why, 'fix', fix));
  end loop;
  update hwork_submissions set review = out, review_at = ts_now where id = s.id and review_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', '이미 오답 정리를 마쳤습니다.', 'reason', 'done'); end if;
  return jsonb_build_object('ok', true, 'answers', hwork_wrong_ans_(s.detail));
end $$;

create or replace function public.hwork_retry_state(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hwork_submissions;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true,
    'stage', case when s.review_at is not null then 'done' when s.retry_at is not null then 'review'
                  when coalesce(array_length(hwork_wrong_qs_(s.detail),1),0) = 0 then 'done' else 'retry' end,
    'teacher', s.teacher, 'code', s.code, 'name', s.name, 'ts', s.ts,
    'got', s.got, 'total', s.total,
    'detail', hwork_hide_wrong_(s.detail),
    'retry', s.retry_detail, 'retry_got', s.retry_got, 'review', s.review,
    'answers', case when s.review_at is not null then hwork_wrong_ans_(s.detail) else null end);
end $$;

-- ── 권한: 학생 폼(공개 키)은 제출·다시 풀기·정리·상태만, 도우미는 막는다 ──
revoke all on function public.hwork_hide_wrong_(jsonb) from public;
revoke all on function public.hwork_row_(jsonb) from public;
revoke all on function public.hwork_wrong_qs_(jsonb) from public;
revoke all on function public.hwork_wrong_ans_(jsonb) from public;
revoke all on function public.hwork_submit(jsonb) from public;
revoke all on function public.hwork_retry(jsonb) from public;
revoke all on function public.hwork_review(jsonb) from public;
revoke all on function public.hwork_retry_state(jsonb) from public;
grant execute on function public.hwork_submit(jsonb) to anon, authenticated;
grant execute on function public.hwork_retry(jsonb) to anon, authenticated;
grant execute on function public.hwork_review(jsonb) to anon, authenticated;
grant execute on function public.hwork_retry_state(jsonb) to anon, authenticated;
