-- ============================================================
-- 068 이미 낸 H WORK 과제에 문제 원문 잇기 — SHUEGUK REAL 내신 기출 (2026-11-17 원장님)
--   "지금 h work 에 출제된 파일들을 먼저 연결하고 싶어"
--
--   · hwork_src_items  — 과제 이름(code) × 과제 안 번호(no) 마다 문제 원문 HTML(학생용 — 정답 표시 없음).
--                        정답(ans)·서술형 예시 답(essay)은 따로 담아 맞힌 문항·클리어한 문항에만 보낸다.
--                        학교 기출이라 공개 저장소에 두지 않고 이 표에만 둔다. 교사(authenticated)만 읽고 쓴다.
--                        올리기 = tools/real_load.py (교재 작업 폴더 data/<교재>_<n>권.json — 과제 이름이 H WORK 과
--                        글자 하나까지 같다).
--   · hwork_src_passages — 여러 문항이 함께 쓰는 지문.
--   · hwork_homeworks.data 는 건드리지 않는다(시트 원본·미러를 다시 쓰지 않으려고). 과제 이름으로 잇는다.
--   · hwork_meta(p)  — 067 본문 + 'bank' 를 '문제 화면이 있는 과제'로 넓힘(data.bank 또는 이 표에 문항이 있음),
--                      'style'('gbank'|'real') 을 더함.
--   · hwork_qs(p)    — data.bank 가 있으면 067 그대로, 없으면 이 표.
--   · hwork_expl(p)  — 067 그대로 + 이 표의 문항이면 {kind:'src', ans_text, essay}.
-- 다시 실행해도 안전하다. 020·067 을 다시 돌리면 hwork_meta·hwork_qs·hwork_expl 이 옛 본문으로 돌아가니 그 뒤 068 도.
-- ============================================================

create table if not exists public.hwork_src_items (
  code       text not null,                       -- H WORK 과제 이름(hwork_homeworks.code)
  no         int  not null check (no between 1 and 300),
  qid        text not null default '',            -- 교재 데이터의 문항 키('wb-1')
  book       text not null default '',            -- '문장 1권(기본·실력)'
  html       text not null,                       -- 학생용 문제 HTML(정답 표시 없음)
  pid        text not null default '',            -- 지문(hwork_src_passages.pid), 없으면 ''
  type       text not null default '',            -- '5지' | '단답' | '서술'
  ans        text not null default '',            -- 보여 줄 정답('②', 단답 글)
  essay      text not null default '',            -- 서술형 예시 답
  src        text not null default '',            -- '건대부고3 24 1 중간 · 24수특 언매'
  err        boolean not null default false,      -- 교재의 '오류 문항' 표시
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (code, no)
);

create table if not exists public.hwork_src_passages (
  pid  text primary key,
  html text not null
);

alter table public.hwork_src_items enable row level security;
alter table public.hwork_src_passages enable row level security;
do $$ declare t text; begin
  foreach t in array array['hwork_src_items','hwork_src_passages'] loop
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke references, trigger, truncate on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 과제 구성 (067 hwork_meta + 문제 원문이 있는 과제도 bank) ──
create or replace function public.hwork_meta(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t text := coalesce(p->>'teacher',''); c text := coalesce(p->>'code','');
        hw record; d text; items jsonb; gb boolean; rs boolean;
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
  gb := coalesce(jsonb_typeof(hw.data->'bank') = 'object', false);
  rs := (not gb) and exists (select 1 from hwork_src_items s where s.code = hw.code and s.active);
  return jsonb_build_object('ok', true, 'meta', jsonb_build_object(
    'teacher', coalesce(nullif(hw.data->>'teacher',''), t),
    'code', coalesce(nullif(hw.data->>'code',''), c),
    'count', case when coalesce(hw.data->>'count','') ~ '^\d+$' then (hw.data->>'count')::int else 0 end,
    'schools', coalesce(hw.data->'schools','[]'::jsonb),
    'items', items, 'due', d, 'closed', hwork_closed_(d),
    'bank', gb or rs,
    'style', case when gb then 'gbank' when rs then 'real' else '' end));
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
  if coalesce(jsonb_typeof(bank), '') = 'object' then
    select coalesce(jsonb_object_agg(e.k, jsonb_build_object('html', g.html, 'pid', g.pid, 'src', g.src)), '{}'::jsonb)
      into items
      from jsonb_each_text(bank) e(k, v) join gbank_items g on g.id::text = e.v;
    select coalesce(jsonb_object_agg(gp.pid, gp.html), '{}'::jsonb) into pas
      from gbank_passages gp
     where gp.pid in (select distinct g.pid from jsonb_each_text(bank) e(k, v) join gbank_items g on g.id::text = e.v where g.pid <> '');
    return jsonb_build_object('ok', true, 'style', 'gbank', 'items', items, 'passages', pas);
  end if;
  select coalesce(jsonb_object_agg(s.no::text, jsonb_build_object('html', s.html, 'pid', s.pid, 'src', s.src, 'err', s.err)), '{}'::jsonb)
    into items from hwork_src_items s where s.code = hw.code and s.active;
  if items = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', '문항 화면이 없는 과제입니다.', 'reason', 'not_bank');
  end if;
  select coalesce(jsonb_object_agg(sp.pid, sp.html), '{}'::jsonb) into pas
    from hwork_src_passages sp
   where sp.pid in (select distinct s.pid from hwork_src_items s where s.code = hw.code and s.active and s.pid <> '');
  return jsonb_build_object('ok', true, 'style', 'real', 'items', items, 'passages', pas);
end $$;

-- ── 해설 (맞힌 문항 · 클리어한 문항만) ─────────────────────────
create or replace function public.hwork_expl(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hwork_submissions; hw record; q text := coalesce(p->>'q',''); g record; r record; d jsonb;
begin
  s := hwork_row_(p);
  if s.id is null then return jsonb_build_object('ok', false, 'error', '제출 기록을 찾을 수 없습니다.'); end if;
  d := s.detail->q;
  if d is null then return jsonb_build_object('ok', false, 'error', '없는 문항입니다.'); end if;
  if coalesce(d->>'ok','') <> 'true' and not (coalesce(s.review->q,'{}'::jsonb) ? 'cleared_at') then
    return jsonb_build_object('ok', false, 'error', '정답을 맞히거나 오답하기로 클리어하면 해설을 볼 수 있어요.', 'reason', 'locked');
  end if;
  select * into hw from hwork_homeworks where teacher = s.teacher and code = s.code limit 1;
  if coalesce(jsonb_typeof(hw.data->'bank'), '') = 'object' then
    select * into g from gbank_items where id::text = coalesce(hw.data->'bank'->>q, '');
    if g.id is null then return jsonb_build_object('ok', false, 'error', '해설이 없는 문항입니다.', 'reason', 'none'); end if;
    return jsonb_build_object('ok', true, 'q', q, 'ans', g.ans, 'good', g.good, 'bad', g.bad);
  end if;
  select * into r from hwork_src_items x where x.code = s.code and x.no::text = q and x.active;
  if not found then return jsonb_build_object('ok', false, 'error', '해설이 없는 문항입니다.', 'reason', 'none'); end if;
  return jsonb_build_object('ok', true, 'q', q, 'kind', 'src', 'type', r.type, 'ans_text', r.ans, 'essay', r.essay, 'err', r.err);
end $$;

grant execute on function public.hwork_meta(jsonb), public.hwork_qs(jsonb), public.hwork_expl(jsonb) to anon, authenticated;
