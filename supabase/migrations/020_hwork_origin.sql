-- 020: H WORK 제출 — 수파베이스가 원본 (2026-08-26)
-- 채점·마감 판정 로직(shueguk-h-work Code.gs)을 1:1로 옮긴 SECURITY DEFINER 함수 셋을 anon에 연다
-- (016 주말 신청·019 클리닉과 같은 방식). 과제(HWORK목록)의 원본은 여전히 H WORK 시트 —
-- 출제 저장·마감·삭제가 백엔드 먼저 + hwork_homeworks 미러를 갱신하고, 여기 함수는 미러를 읽는다.
--   · hwork_list()    — 학생 폼 과제 목록 (action=list 응답과 같은 모양)
--   · hwork_meta(p)   — 선택한 과제의 문항 구성 (action=meta — 정답은 절대 내보내지 않는다)
--   · hwork_submit(p) — 제출: 마감 판정 후 채점해 hwork_submissions에 기록 (action=submit)
--   · hwork_grade_(data, answers) — 채점만 (제출 없음, 교사 인증 전용 — 채점 일치 검증용)

-- ── 도우미 ──────────────────────────────────────────────────
-- norm(): 공백 전부 제거 + 소문자
create or replace function public.hwork_norm_(s text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(coalesce(s,''), '\s+', '', 'g'));
$$;

-- 서술형 채점 (백엔드 isTextCorrect 1:1)
-- 쉼표(,·，)로 나뉜 키워드를 "모두" 포함해야 정답(순서 무관), 키워드 안 빗금(/)은 대체 표현(택일).
-- 대체 표현은 학생 답의 쉼표 조각과 정확 일치하거나, 2글자 이상이면 답 전체에 포함되면 인정.
create or replace function public.hwork_text_ok_(student text, model text)
returns boolean language plpgsql immutable set search_path = public as $$
declare full_a text := hwork_norm_(student);
        parts text[]; groups text[]; g text; alts text[]; a text; hit boolean;
begin
  if model is null or trim(model) = '' then return false; end if;
  parts := array(select x from (select hwork_norm_(y) as x
                 from unnest(regexp_split_to_array(coalesce(student,''), '[,，]')) y) t where x <> '');
  groups := array(select trim(y) from unnest(regexp_split_to_array(model, '[,，]')) y where trim(y) <> '');
  if array_length(groups,1) is null then return false; end if;
  foreach g in array groups loop
    alts := array(select x from (select hwork_norm_(y) as x from unnest(string_to_array(g,'/')) y) t where x <> '');
    hit := false;
    foreach a in array alts loop
      if a = any(parts) or (length(a) >= 2 and position(a in full_a) > 0) then hit := true; exit; end if;
    end loop;
    if not hit then return false; end if;
  end loop;
  return true;
end $$;

-- 마감일 문자열 정리 (백엔드 dueYmd_) — yyyy-MM-dd 형식만 인정, 아니면 기한 없음
create or replace function public.hwork_due_(due text)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(due,'') ~ '^\d{4}-\d{2}-\d{2}$' then due else '' end;
$$;

-- 마감 판정 (백엔드 isClosed_) — 마감일 그 날 밤 11:59(KST)까지 제출 가능, 다음 날부터 닫힘
create or replace function public.hwork_closed_(due text)
returns boolean language sql stable set search_path = public as $$
  select coalesce(due,'') ~ '^\d{4}-\d{2}-\d{2}$'
     and (now() at time zone 'Asia/Seoul')::date > due::date;
$$;

-- 채점 (백엔드 submit의 채점 루프 1:1 — 제출 기록 없음)
create or replace function public.hwork_grade_(data jsonb, answers jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare cnt int := case when coalesce(data->>'count','') ~ '^\d+$' then (data->>'count')::int else 0 end;
        got int := 0; detail jsonb := '{}'::jsonb;
        q int; item jsonb; mine text; ok boolean;
begin
  for q in 1..cnt loop
    item := coalesce(data->'items'->(q::text), '{}'::jsonb);
    mine := coalesce(answers->>(q::text), '');
    if item->>'type' = 'text' then
      ok := hwork_text_ok_(mine, item->>'ans');
    else
      ok := (item->>'ans') is not null and mine = item->>'ans';   -- choice5 · ox 공통 (문자 비교)
    end if;
    if ok then got := got + 1; end if;
    detail := detail || jsonb_build_object(q::text,
      jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
      || jsonb_build_object('mine', mine, 'ans', coalesce(item->>'ans',''), 'ok', ok));
  end loop;
  return jsonb_build_object('got', got, 'total', cnt, 'detail', detail);
end $$;

-- ── 학생 폼 과제 목록 (action=list와 같은 응답) ─────────────────
create or replace function public.hwork_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'list', coalesce(jsonb_agg(
           jsonb_build_object('teacher', teacher, 'code', code,
                              'due', hwork_due_(due), 'closed', hwork_closed_(hwork_due_(due)))
           order by id), '[]'::jsonb))
  from hwork_homeworks
  where teacher <> '' and code <> '';
$$;

-- ── 문항 구성 (action=meta — 정답 미포함) ───────────────────────
create or replace function public.hwork_meta(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t text := coalesce(p->>'teacher',''); c text := coalesce(p->>'code','');
        hw record; d text; items jsonb;
begin
  select * into hw from hwork_homeworks where teacher = t and code = c limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'H WORK을 찾을 수 없습니다: ' || t || ' / ' || c);
  end if;
  if hw.data is null or hw.data = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', '정답 데이터(C칸)가 비어 있습니다.');
  end if;
  select coalesce(jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object('type', v->>'type'))), '{}'::jsonb)
    into items from jsonb_each(coalesce(hw.data->'items','{}'::jsonb)) e(k, v);
  d := hwork_due_(hw.due);
  return jsonb_build_object('ok', true, 'meta', jsonb_build_object(
    'teacher', coalesce(nullif(hw.data->>'teacher',''), t),
    'code', coalesce(nullif(hw.data->>'code',''), c),
    'count', case when coalesce(hw.data->>'count','') ~ '^\d+$' then (hw.data->>'count')::int else 0 end,
    'schools', coalesce(hw.data->'schools','[]'::jsonb),
    'items', items, 'due', d, 'closed', hwork_closed_(d)));
end $$;

-- ── 제출 (action=submit 1:1) ───────────────────────────────────
-- 잠금 없음 — 채점은 읽기만, 저장은 행 추가라 동시 제출이 몰려도 안전 (백엔드와 같은 판단).
create or replace function public.hwork_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := coalesce(p->>'teacher',''); c text := coalesce(p->>'code','');
        hw record; d text; r jsonb;
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
  insert into hwork_submissions (ts,teacher,code,school,grade,name,got,total,answers,detail,questions)
  values (ts_now, t, c, coalesce(p->>'school',''), coalesce(p->>'grade',''), coalesce(p->>'name',''),
          (r->>'got')::int, (r->>'total')::int,
          coalesce(p->'answers','{}'::jsonb), r->'detail', coalesce(p->'questions','{}'::jsonb));
  return jsonb_build_object('ok', true, 'result', r,
    'student', jsonb_build_object('teacher', t, 'code', c, 'school', coalesce(p->>'school',''),
                                  'grade', coalesce(p->>'grade',''), 'name', coalesce(p->>'name','')));
end $$;

-- ── 권한: 학생 폼(공개 키)은 목록·메타·제출만, 채점 단독 함수는 교사 인증 전용 ──
revoke all on function public.hwork_norm_(text) from public;
revoke all on function public.hwork_text_ok_(text, text) from public;
revoke all on function public.hwork_due_(text) from public;
revoke all on function public.hwork_closed_(text) from public;
revoke all on function public.hwork_grade_(jsonb, jsonb) from public;
revoke all on function public.hwork_list() from public;
revoke all on function public.hwork_meta(jsonb) from public;
revoke all on function public.hwork_submit(jsonb) from public;
grant execute on function public.hwork_list() to anon, authenticated;
grant execute on function public.hwork_meta(jsonb) to anon, authenticated;
grant execute on function public.hwork_submit(jsonb) to anon, authenticated;
grant execute on function public.hwork_grade_(jsonb, jsonb) to authenticated;
