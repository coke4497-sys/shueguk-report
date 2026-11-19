-- ============================================================
-- 067 모의고사 문법 문항 은행 + H WORK 문항 화면 · 질문 대화 (2026-11-17 원장님)
--   "모의고사 문법 문항을 H WORK으로 사용하고 싶어. 오답과 질문을 학생과 교사가 함께 문제를 보며
--    질답을 주고 받을 수 있게" + "문제 출제, 인쇄도 가능하게"
--
--   · gbank_items / gbank_passages — SHUEGUK MOGO 2026 문법 문항(평가원·교육청·사설 모의고사, 454개).
--     사설 문항은 저작권이 있어 공개 저장소에 두지 않고 이 표에만 둔다. 교사(authenticated)만 읽고 쓴다.
--     올리기 = tools/gbank_load.py (작업 폴더의 gen.py·fixes.py 를 그대로 거친 결과).
--     html = 학생용(정답 표시 없음), ans = 정답 1~5, good/bad = 해설(정답 해설 / 오답 해설 목록).
--   · H WORK 과제의 data.bank = {"1": 문항id, …} — 출제 화면(shueguk-h-work bank_make.html)이 문항을 골라
--     보통 H WORK 과제(choice5 정답 포함)로 저장하면서 함께 적는다. 채점·오답하기는 064~066 그대로.
--   · hwork_meta(p)  — 020 본문 그대로 + 'bank': 문항 화면 과제인지.
--   · hwork_qs(p {teacher,code}) — 그 과제의 문항 HTML·지문(정답·해설 없음). anon.
--   · hwork_expl(p {id,key,q})   — 제출 열쇠로, 맞힌 문항·오답하기로 클리어한 문항만 정답·해설. anon.
--   · hwork_qa — 제출 한 건의 문항마다 학생 ↔ 선생님 대화. 학생은 함수로만(제출 열쇠), 선생님은 표 직접.
--       hwork_qa_list(p {id,key})       대화 전부(+ 선생님 글을 읽음 처리)
--       hwork_qa_post(p {id,key,q,text}) 학생 글(1~1000자). 그 문항의 학생 답이 함께 적힌다(mine).
--       hwork_qa_mine(p {key|student})  학생 페이지용 — 내 제출 중 대화가 있거나 오답하기가 남은 것(열쇠 포함 —
--                                       다른 기기에서도 이어 하도록), 안 읽은 선생님 답장 수.
--     제출할 때 문항 옆 [질문]에 적은 글(hwork_submissions.questions)은 트리거가 대화 첫 글로 옮긴다.
--     064·065 의 [선생님 도와주세요](review[q].help)는 이미 쌓인 것도 대화 첫 글로 옮긴다(이 마이그레이션 한 번,
--     원장님 기본안 5 — 다시 실행해도 겹치지 않음). 앞으로 도움 요청은 화면이 대화 글로 보낸다.
-- 다시 실행해도 안전하다. 020 을 다시 돌리면 hwork_meta 가 옛 본문으로 돌아가니 그 뒤 067 도 다시 돌릴 것.
-- ============================================================

create table if not exists public.gbank_items (
  id         int primary key,                      -- 작업 폴더의 문항 id (책 번호 아님)
  area       text not null default '',             -- '음운' '단어 형성법' …
  lvl        text not null default '',             -- 기본(고1·고2) · 실력(평가원·교육청 고3) · 심화(사설 고3)
  src        text not null default '',             -- '2026학년도 6월 평가원 · 고3'
  kind       text not null default '',             -- 평가원 · 교육청 · 사설
  year       text not null default '',
  pid        text not null default '',             -- 지문 세트 (gbank_passages.pid), 없으면 ''
  ord        int  not null default 0,              -- 책 순서(영역 → 난도 → 출처)
  html       text not null default '',             -- 학생용 문항 HTML(정답 표시 없음)
  ans        smallint not null check (ans between 1 and 5),
  good       text not null default '',             -- 정답 해설(HTML)
  bad        jsonb not null default '[]'::jsonb,   -- 오답 해설 ['① …', …]
  plain      text not null default '',             -- 찾기용 글
  active     boolean not null default true,        -- 거짓 = 작업 폴더에서 빠진 문항(이미 낸 과제는 그대로 보임)
  updated_at timestamptz not null default now()
);
create index if not exists gbank_items_area_idx on public.gbank_items (area, lvl, ord);

create table if not exists public.gbank_passages (
  pid  text primary key,
  html text not null default ''
);

create table if not exists public.hwork_qa (
  id      bigint generated always as identity primary key,
  sub_id  bigint not null references public.hwork_submissions(id) on delete cascade,
  q       text not null check (q ~ '^\d{1,3}$'),
  who     text not null check (who in ('학생','선생님')),
  name    text not null default '',
  body    text not null check (char_length(btrim(body)) between 1 and 1000),
  mine    text not null default '',                -- 학생 글일 때 그 순간 학생 답(1차 답 또는 오답하기 마지막 답)
  at      timestamptz not null default now(),
  read_at timestamptz                              -- 받는 쪽이 읽은 때
);
create index if not exists hwork_qa_sub_idx on public.hwork_qa (sub_id, q, id);
create index if not exists hwork_qa_wait_idx on public.hwork_qa (who, read_at);

do $$
declare t text;
begin
  foreach t in array array['gbank_items','gbank_passages','hwork_qa'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('revoke all privileges on public.%I from anon', t);
    execute format('revoke all privileges on public.%I from authenticated', t);
  end loop;
end $$;
create policy teacher_all on public.gbank_items for all to authenticated using (true) with check (true);
create policy teacher_all on public.gbank_passages for all to authenticated using (true) with check (true);
-- 선생님은 대화를 읽고, 선생님 글만 넣고, 읽음 표시·고치기·지우기를 한다
create policy teacher_all on public.hwork_qa for all to authenticated using (true) with check (who = '선생님' or read_at is not null);
grant select, insert, update, delete on public.gbank_items, public.gbank_passages, public.hwork_qa to authenticated;

-- ── 과제 구성 (020 hwork_meta + bank) ─────────────────────────
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
    'items', items, 'due', d, 'closed', hwork_closed_(d),
    'bank', coalesce(jsonb_typeof(hw.data->'bank') = 'object', false)));
end $$;

-- ── 문항 화면 (정답·해설 없음) ─────────────────────────────────
create or replace function public.hwork_qs(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hw record; bank jsonb; items jsonb; pas jsonb;
begin
  select * into hw from hwork_homeworks
   where teacher = coalesce(p->>'teacher','') and code = coalesce(p->>'code','') limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'H WORK을 찾을 수 없습니다.'); end if;
  bank := hw.data->'bank';
  if coalesce(jsonb_typeof(bank), '') <> 'object' then return jsonb_build_object('ok', false, 'error', '문항 화면이 없는 과제입니다.', 'reason', 'not_bank'); end if;
  select coalesce(jsonb_object_agg(e.k, jsonb_build_object('html', g.html, 'pid', g.pid, 'src', g.src)), '{}'::jsonb)
    into items
    from jsonb_each_text(bank) e(k, v) join gbank_items g on g.id::text = e.v;
  select coalesce(jsonb_object_agg(gp.pid, gp.html), '{}'::jsonb) into pas
    from gbank_passages gp
   where gp.pid in (select distinct g.pid from jsonb_each_text(bank) e(k, v) join gbank_items g on g.id::text = e.v where g.pid <> '');
  return jsonb_build_object('ok', true, 'items', items, 'passages', pas);
end $$;

-- ── 해설 (맞힌 문항 · 클리어한 문항만) ─────────────────────────
create or replace function public.hwork_expl(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hwork_submissions; hw record; q text := coalesce(p->>'q',''); g record; d jsonb;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  d := s.detail->q;
  if d is null then return jsonb_build_object('ok', false, 'error', '없는 문항입니다.'); end if;
  if coalesce(d->>'ok','') <> 'true' and not (coalesce(s.review->q,'{}'::jsonb) ? 'cleared_at') then
    return jsonb_build_object('ok', false, 'error', '정답을 맞히거나 오답하기로 클리어하면 해설을 볼 수 있어요.', 'reason', 'locked');
  end if;
  select * into hw from hwork_homeworks where teacher = s.teacher and code = s.code limit 1;
  select * into g from gbank_items where id::text = coalesce(hw.data->'bank'->>q, '');
  if g.id is null then return jsonb_build_object('ok', false, 'error', '해설이 없는 문항입니다.', 'reason', 'none'); end if;
  return jsonb_build_object('ok', true, 'q', q, 'ans', g.ans, 'good', g.good, 'bad', g.bad);
end $$;

-- ── 대화 ───────────────────────────────────────────────────────
-- 그 문항의 지금 학생 답 — 오답하기 중이면 마지막에 고른 답
create or replace function public.hwork_qa_mine_(s public.hwork_submissions, q text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(s.review->q->'tries'->-1->>'pick', ''),
    s.detail->q->>'mine', '');
$$;

create or replace function public.hwork_qa_rows_(sid bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'q', q, 'who', who, 'name', name, 'body', body, 'mine', mine,
           'at', to_char(at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
           'read', read_at is not null) order by id), '[]'::jsonb)
  from hwork_qa where sub_id = sid;
$$;

create or replace function public.hwork_qa_list(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; r jsonb;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  r := hwork_qa_rows_(s.id);   -- 읽음 처리 전 상태(새 답장 표시용)
  update hwork_qa set read_at = now() where sub_id = s.id and who = '선생님' and read_at is null;
  return jsonb_build_object('ok', true, 'msgs', r);
end $$;

create or replace function public.hwork_qa_post(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; q text := btrim(coalesce(p->>'q','')); txt text := btrim(coalesce(p->>'text',''));
        n int; v_id bigint;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  if not (s.detail ? q) then return jsonb_build_object('ok', false, 'error', '없는 문항입니다.', 'reason', 'q'); end if;
  if txt = '' then return jsonb_build_object('ok', false, 'error', '질문을 적어 주세요.', 'reason', 'text'); end if;
  if char_length(txt) > 1000 then return jsonb_build_object('ok', false, 'error', '1000자까지 적을 수 있어요.', 'reason', 'long'); end if;
  select count(*) into n from hwork_qa where sub_id = s.id and who = '학생';
  if n >= 200 then return jsonb_build_object('ok', false, 'error', '질문을 더 남길 수 없습니다. 선생님께 직접 여쭤 주세요.', 'reason', 'many'); end if;
  insert into hwork_qa (sub_id, q, who, name, body, mine)
  values (s.id, q, '학생', s.name, txt, hwork_qa_mine_(s, q)) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'msgs', hwork_qa_rows_(s.id));
end $$;

-- 학생 페이지: 내 제출 중 대화가 있거나 오답하기가 남은 것
create or replace function public.hwork_qa_mine(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.students%rowtype; nm text; gd text; r jsonb;
begin
  me := public.review_me_(p);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
  nm := regexp_replace(btrim(coalesce(me.name,'')), '[A-Za-z]$', '');
  gd := substring(coalesce(me.grade,'') from '(\d)\D*$');   -- '2026 고등 1학년' → 1 (마지막 숫자)
  select coalesce(jsonb_agg(x order by x->>'ts' desc), '[]'::jsonb) into r from (
    select jsonb_build_object('id', s.id, 'key', s.retry_key, 'teacher', s.teacher, 'code', s.code, 'ts', s.ts,
             'unread', (select count(*) from hwork_qa a where a.sub_id = s.id and a.who = '선생님' and a.read_at is null),
             'msgs', (select count(*) from hwork_qa a where a.sub_id = s.id),
             'done', s.review_at is not null or not exists (select 1 from jsonb_each(s.detail) e(k, v) where (v->>'ok') = 'false')) x
      from hwork_submissions s
     where s.retry_key is not null
       and regexp_replace(btrim(s.name), '[A-Za-z]$', '') = nm
       and (gd is null or substring(s.grade from '(\d)\D*$') is null or substring(s.grade from '(\d)\D*$') = gd)
       and (exists (select 1 from hwork_qa a where a.sub_id = s.id)
            or (s.review_at is null and exists (select 1 from jsonb_each(s.detail) e(k, v) where (v->>'ok') = 'false')))
     order by s.id desc limit 30) t;
  return jsonb_build_object('ok', true, 'list', r);
end $$;

-- 제출할 때 적은 문항 질문 → 대화 첫 글
create or replace function public.hwork_qa_from_submit_()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; v text;
begin
  for k, v in select e.key, btrim(e.value) from jsonb_each_text(coalesce(new.questions,'{}'::jsonb)) e loop
    if k ~ '^\d{1,3}$' and v <> '' then
      insert into hwork_qa (sub_id, q, who, name, body, mine)
      values (new.id, k, '학생', new.name, left(v, 1000), coalesce(new.detail->k->>'mine',''));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists hwork_qa_from_submit on public.hwork_submissions;
create trigger hwork_qa_from_submit after insert on public.hwork_submissions
  for each row execute function public.hwork_qa_from_submit_();

-- 이미 쌓인 [선생님 도와주세요] → 대화 첫 글 (한 번만 — 같은 제출·문항에 대화가 있으면 건너뜀)
insert into public.hwork_qa (sub_id, q, who, name, body, mine, at)
select s.id, e.key, '학생', s.name,
       coalesce(nullif(btrim(e.value->'help'->>'text'),''), '왜 틀렸는지 모르겠어요. 선생님 도와주세요.'),
       coalesce(nullif(e.value->'tries'->-1->>'pick',''), s.detail->e.key->>'mine', ''),
       coalesce(to_timestamp(e.value->'help'->>'at', 'YYYY-MM-DD HH24:MI')::timestamp at time zone 'Asia/Seoul', now())
  from public.hwork_submissions s, jsonb_each(coalesce(s.review,'{}'::jsonb)) e
 where e.value ? 'help' and e.key ~ '^\d{1,3}$'
   and not exists (select 1 from public.hwork_qa a where a.sub_id = s.id and a.q = e.key);

revoke all on function public.hwork_meta(jsonb), public.hwork_qs(jsonb), public.hwork_expl(jsonb),
  public.hwork_qa_list(jsonb), public.hwork_qa_post(jsonb), public.hwork_qa_mine(jsonb) from public;
revoke all on function public.hwork_qa_mine_(public.hwork_submissions, text), public.hwork_qa_rows_(bigint),
  public.hwork_qa_from_submit_() from public;
grant execute on function public.hwork_meta(jsonb), public.hwork_qs(jsonb), public.hwork_expl(jsonb),
  public.hwork_qa_list(jsonb), public.hwork_qa_post(jsonb), public.hwork_qa_mine(jsonb) to anon, authenticated;
