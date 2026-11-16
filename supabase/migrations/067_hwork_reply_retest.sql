-- 067: H WORK 도움 요청 답장 · 개인 리테스트 (2026-11-16 원장님)
-- "h work를 제출한 친구들에게 문항을 띄워 답장하는 기능" → 고른 것: **도움 요청에 답장**
--   · 학생이 오답하기에서 [왜 틀렸는지 모르겠어요 · 선생님 도와주세요]를 누른 문항(review[q].help)에
--     선생님이 답장을 적는다 → hwork_submissions.reply = {q: {text, by, at}}.
--     쓰기는 hwork_reply(p {id, q, text, by}) 하나(교사 계정만) — 빈 글이면 답장을 지운다.
--     학생 오답하기 화면(review 열)과 따로 둔 열이라 학생이 동시에 오답하기를 해도 덮이지 않는다.
--   · 학생은 학생 페이지 H WORK 목록(hwork_student_extra)과 H WORK 오답하기 화면(hwork_retry_state 의 reply)에서 본다.
--   · 학생 페이지에서 연 오답하기는 이 기기 기록이 없어도 접근코드로 이어 한다(hwork_open_mine — 같은 학생의 가장 최근 제출).
-- "틀린 문항을 모아 리테스트" → 고른 것: **학생마다 자기 오답만 · 처음 제출에서 틀린 문항 · 별 없음**
--   · 표 hwork_retests(학생·원 제출마다 한 줄 — qs = 원 과제의 문항 번호, 서술형 제외).
--     선생님 화면(교사 계정)이 직접 넣는다. 원 제출 하나에 리테스트 하나(src_id 유일).
--   · 학생: hwork_retest_open(p {key|student, id}) 문항 종류만(정답 없음) · hwork_retest_submit(p {…, answers}) 한 번만 채점.
--     채점은 원 과제(hwork_homeworks)의 지금 정답으로, 결과의 틀린 문항 정답은 감춘다(오답하기와 같은 원칙).
--     마감과 상관없이 받는다. 슈퍼스타 별은 주지 않는다(별 집계는 hwork_submissions 만 센다 — 이 표는 따로).
-- 학생 확인은 031 review_me_(접근코드·학생ID). 제출 ↔ 학생 대조는 학생 페이지(s.html hworkDoneSet_)와 같은 규칙.
-- 065 를 다시 돌리면 hwork_retry_state 가 reply 없는 본문으로 돌아가니 그 뒤 067 도 다시 돌릴 것.
-- 다시 실행해도 안전하다.

alter table public.hwork_submissions add column if not exists reply jsonb;

-- ── 답장 쓰기 (교사 계정만) ─────────────────────────────────────
create or replace function public.hwork_reply(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; q text := coalesce(p->>'q','');
        txt text := btrim(coalesce(p->>'text','')); who text := btrim(coalesce(p->>'by',''));
        rp jsonb; ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  select * into s from hwork_submissions
   where id = case when coalesce(p->>'id','') ~ '^\d{1,18}$' then (p->>'id')::bigint else -1 end
   for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  if not (coalesce(s.review->q, '{}'::jsonb) ? 'help') then
    return jsonb_build_object('ok', false, 'error', q || '번은 학생이 도움을 요청한 문항이 아닙니다.', 'reason', 'no_help');
  end if;
  if char_length(txt) > 1000 then return jsonb_build_object('ok', false, 'error', '답장은 1,000자까지 적을 수 있어요.', 'reason', 'long'); end if;
  rp := coalesce(s.reply, '{}'::jsonb);
  if txt = '' then rp := rp - q;
  else rp := rp || jsonb_build_object(q, jsonb_build_object('text', txt, 'by', left(who, 40), 'at', ts_now));
  end if;
  update hwork_submissions set reply = case when rp = '{}'::jsonb then null else rp end where id = s.id;
  return jsonb_build_object('ok', true, 'q', q, 'reply', rp->q, 'removed', txt = '');
end $$;

-- 065 본문 그대로 + reply
create or replace function public.hwork_retry_state(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hwork_submissions;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok', true,
    'stage', case when s.review_at is not null or hwork_fix_done_(s.detail, s.review) then 'done' else 'fix' end,
    'teacher', s.teacher, 'code', s.code, 'name', s.name, 'ts', s.ts,
    'got', s.got, 'total', s.total,
    'detail', hwork_hide_wrong_(s.detail),
    'review', s.review, 'answers', hwork_cleared_ans_(s.detail, s.review),
    'reply', coalesce(s.reply, '{}'::jsonb));
end $$;

-- ── 학생 ↔ 제출 대조 (s.html hworkDoneSet_ 와 같은 규칙) ─────────
-- 학년 숫자: '1학년' → '고1' → 마지막 1~3
create or replace function public.hwork_gd_(g text)
returns text language sql immutable set search_path = public as $$
  select coalesce(substring(x from '([1-3])학년'), substring(x from '고([1-3])'),
                  (regexp_match(x, '([1-3])[^1-3]*$'))[1], '')
    from (select regexp_replace(coalesce(g,''), '\s+', '', 'g') x) t;
$$;
create or replace function public.hwork_is_me_(me public.students, sname text, sschool text, sgrade text)
returns boolean language plpgsql immutable set search_path = public as $$
declare v_name text := btrim(coalesce(me.name,'')); v_base text; rn text := btrim(coalesce(sname,''));
        mg text := hwork_gd_(me.grade); rg text := hwork_gd_(sgrade);
        ms text := regexp_replace(coalesce(me.school,''), '\s+', '', 'g'); rs text := regexp_replace(coalesce(sschool,''), '\s+', '', 'g');
begin
  if v_name = '' then return false; end if;
  v_base := regexp_replace(v_name, '[A-Za-z]$', '');
  if rn <> v_name and rn <> v_base then return false; end if;
  if mg <> '' and rg <> '' and rg <> mg then return false; end if;
  if ms <> '' and rs <> '' and position(ms in rs) = 0 and position(rs in ms) = 0 then return false; end if;
  return true;
end $$;

-- ── 학생 페이지: 답장 목록 + 리테스트 목록 ──────────────────────
create or replace function public.hwork_student_extra(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students; v_base text;
begin
  me := review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  v_base := regexp_replace(btrim(me.name), '[A-Za-z]$', '');
  return jsonb_build_object('ok', true,
    'replies', (select coalesce(jsonb_agg(x order by x->>'at' desc, (x->>'id')::bigint desc), '[]'::jsonb) from (
      select jsonb_build_object('id', s.id, 'teacher', s.teacher, 'code', s.code, 'ts', s.ts, 'q', e.k,
               'type', coalesce(s.detail->e.k->>'type', 'choice5'), 'mine', coalesce(s.detail->e.k->>'mine', ''),
               'help', coalesce(s.review->e.k->'help'->>'text', ''), 'help_at', coalesce(s.review->e.k->'help'->>'at', ''),
               'cleared', coalesce(s.review->e.k, '{}'::jsonb) ? 'cleared_at',
               'text', e.v->>'text', 'by', coalesce(e.v->>'by', ''), 'at', coalesce(e.v->>'at', '')) x
        from hwork_submissions s, jsonb_each(coalesce(s.reply, '{}'::jsonb)) e(k, v)
       where s.reply is not null and (s.name = btrim(me.name) or s.name = v_base)
         and hwork_is_me_(me, s.name, s.school, s.grade)
       order by e.v->>'at' desc limit 100) t),
    'retests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'teacher', r.teacher, 'code', r.code,
               'n', jsonb_array_length(r.qs), 'created_at', to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
               'submitted_at', r.submitted_at, 'got', r.got, 'total', r.total) order by r.id desc), '[]'::jsonb)
        from (select * from hwork_retests where stu_code = me.code order by id desc limit 50) r));
end $$;

-- ── 학생 페이지에서 연 오답하기 — 이 기기 기록이 없어도 접근코드로 이어 한다 ──
create or replace function public.hwork_open_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students; s public.hwork_submissions; v_base text;
begin
  me := review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  v_base := regexp_replace(btrim(me.name), '[A-Za-z]$', '');
  select * into s from hwork_submissions
   where code = coalesce(p->>'code','') and (coalesce(p->>'teacher','') = '' or teacher = p->>'teacher')
     and retry_key is not null and (name = btrim(me.name) or name = v_base)
     and hwork_is_me_(me, name, school, grade)
   order by id desc limit 1;
  if s.id is null then return jsonb_build_object('ok', false, 'error', '이 과제를 낸 기록을 찾지 못했습니다.', 'reason', 'none'); end if;
  return jsonb_build_object('ok', true, 'id', s.id, 'key', s.retry_key);
end $$;

-- ── 개인 리테스트 ──────────────────────────────────────────────
create table if not exists public.hwork_retests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  teacher text not null default '',
  code text not null default '',            -- 원 과제 제목
  src_id bigint references public.hwork_submissions(id) on delete set null,   -- 원 제출(처음 제출)
  stu_code text not null default '',        -- 학생 접근코드(students.code)
  name text not null default '',
  school text not null default '',
  grade text not null default '',
  qs jsonb not null default '[]',           -- 원 과제의 문항 번호 ["3","7"] — 처음 제출에서 틀린 문항(서술형 제외)
  created_by text not null default '',
  answers jsonb,
  detail jsonb,
  got int,
  total int,
  submitted_at text
);
create unique index if not exists hwork_retests_src_uniq on public.hwork_retests (src_id);
create index if not exists hwork_retests_stu_idx on public.hwork_retests (stu_code);
create index if not exists hwork_retests_code_idx on public.hwork_retests (teacher, code);
alter table public.hwork_retests enable row level security;
drop policy if exists teacher_all on public.hwork_retests;
create policy teacher_all on public.hwork_retests for all to authenticated using (true) with check (true);
revoke all on public.hwork_retests from anon, public;
revoke references, trigger, truncate on public.hwork_retests from authenticated;
grant select, insert, update, delete on public.hwork_retests to authenticated;

-- 리테스트 한 줄 (학생 확인 포함, 없으면 null)
create or replace function public.hwork_retest_row_(p jsonb)
returns public.hwork_retests language plpgsql stable security definer set search_path = public as $$
declare me public.students; r public.hwork_retests;
begin
  me := review_me_(p);
  if me.id is null or btrim(coalesce(me.code,'')) = '' then return r; end if;
  select * into r from hwork_retests
   where id = case when coalesce(p->>'id','') ~ '^\d{1,18}$' then (p->>'id')::bigint else -1 end
     and stu_code = me.code;
  return r;
end $$;

create or replace function public.hwork_retest_open(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.hwork_retests; hw record; items jsonb;
begin
  r := hwork_retest_row_(p);
  if r.id is null then return jsonb_build_object('ok', false, 'error', '리테스트를 찾을 수 없습니다.'); end if;
  select * into hw from hwork_homeworks where teacher = r.teacher and code = r.code limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', '원래 과제를 찾을 수 없습니다. 선생님께 알려 주세요.'); end if;
  select coalesce(jsonb_object_agg(q, jsonb_build_object('type', coalesce(hw.data->'items'->q->>'type', 'choice5'))), '{}'::jsonb)
    into items from jsonb_array_elements_text(r.qs) q;
  return jsonb_build_object('ok', true, 'id', r.id, 'teacher', r.teacher, 'code', r.code, 'name', r.name,
    'qs', r.qs, 'items', items, 'submitted', r.submitted_at is not null, 'submitted_at', r.submitted_at,
    'got', r.got, 'total', r.total, 'answers', r.answers, 'detail', hwork_hide_wrong_(r.detail));
end $$;

create or replace function public.hwork_retest_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.hwork_retests; hw record; q text; item jsonb; mine text; ok boolean;
        det jsonb := '{}'::jsonb; ans jsonb := '{}'::jsonb; v_got int := 0; v_tot int := 0;
        ts_now text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
begin
  r := hwork_retest_row_(p);
  if r.id is null then return jsonb_build_object('ok', false, 'error', '리테스트를 찾을 수 없습니다.'); end if;
  select * into r from hwork_retests where id = r.id for update;   -- 두 번 눌러도 한 번만 채점
  if r.submitted_at is not null then
    return jsonb_build_object('ok', false, 'error', '이미 제출한 리테스트입니다.', 'reason', 'done',
      'got', r.got, 'total', r.total, 'detail', hwork_hide_wrong_(r.detail));
  end if;
  select * into hw from hwork_homeworks where teacher = r.teacher and code = r.code limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', '원래 과제를 찾을 수 없습니다. 선생님께 알려 주세요.'); end if;
  for q in select jsonb_array_elements_text(r.qs) loop
    item := coalesce(hw.data->'items'->q, '{}'::jsonb);
    mine := btrim(coalesce(p->'answers'->>q, ''));
    if char_length(mine) > 200 then mine := left(mine, 200); end if;
    if item->>'type' = 'essay' then continue; end if;   -- 만들 때 빼지만 원 과제가 바뀌었을 때를 대비
    if item->>'type' = 'text' then ok := hwork_text_ok_(mine, item->>'ans');
    else ok := (item->>'ans') is not null and mine = item->>'ans'; end if;
    v_tot := v_tot + 1; if ok then v_got := v_got + 1; end if;
    ans := ans || jsonb_build_object(q, mine);
    det := det || jsonb_build_object(q, jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
                                       || jsonb_build_object('mine', mine, 'ans', coalesce(item->>'ans',''), 'ok', ok));
  end loop;
  update hwork_retests set answers = ans, detail = det, got = v_got, total = v_tot, submitted_at = ts_now where id = r.id;
  return jsonb_build_object('ok', true, 'got', v_got, 'total', v_tot, 'submitted_at', ts_now, 'detail', hwork_hide_wrong_(det));
end $$;

-- ── 권한 ──
revoke all on function public.hwork_reply(jsonb) from public, anon;
grant execute on function public.hwork_reply(jsonb) to authenticated;
revoke all on function public.hwork_retry_state(jsonb) from public;
grant execute on function public.hwork_retry_state(jsonb) to anon, authenticated;
revoke all on function public.hwork_gd_(text) from public;
revoke all on function public.hwork_is_me_(public.students, text, text, text) from public;
revoke all on function public.hwork_retest_row_(jsonb) from public;
revoke all on function public.hwork_student_extra(jsonb) from public;
revoke all on function public.hwork_open_mine(jsonb) from public;
revoke all on function public.hwork_retest_open(jsonb) from public;
revoke all on function public.hwork_retest_submit(jsonb) from public;
grant execute on function public.hwork_student_extra(jsonb) to anon, authenticated;
grant execute on function public.hwork_open_mine(jsonb) to anon, authenticated;
grant execute on function public.hwork_retest_open(jsonb) to anon, authenticated;
grant execute on function public.hwork_retest_submit(jsonb) to anon, authenticated;
