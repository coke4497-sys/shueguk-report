-- ============================================================
-- 051: 지필 복기 고치기 (2026-10-16 원장님 "학생이 제출한 지필고사 리포트를 수정할 수 있게")
--
--   결정: 고치는 사람 = 학생·선생님 둘 다 · 학생은 선생님이 [리포트 보내기]를 누르기 전까지만(sent_at 이 비어 있을 때)
--         · 고칠 수 있는 것 = 전부(틀린 문항·문항별 반성·다짐, 점수는 틀린 문항으로 다시 계산).
--
--   · submissions.edited_at / edited_by — 마지막으로 고친 시각과 고친 사람('학생' 또는 선생님 이름).
--     처음 제출 시각(submitted_at)은 그대로 둔다(제출 결과 화면·일일 점검의 짝짓기 기준).
--   · submission_mine(p) — 학생 복기 화면(r.html)이 '내가 이미 낸 복기'를 다시 연다.
--       p = {exam_id, title, name, phone}. 학부모 휴대전화 8자리 + 이름(끝 알파벳은 떼고 대조)이 맞고
--       시험(제목 또는 ID)이 같은 제출 중 가장 최근 한 건. 선생님 한 마디는 돌려주지 않는다.
--   · submission_update(p) — 학생이 고친 복기를 그 줄에 덮어쓴다. 보내기 전(sent_at 없음)일 때만.
--       p = {id, name, phone, wrong_count, wrong_text, vow, score}. 결과 {ok, reason}
--       reason: not_found(본인 제출이 아님) · sent(이미 리포트를 보냄).
--   · 선생님은 제출 결과(t.html)에서 교사 인증으로 표를 바로 PATCH 한다(보낸 뒤에도 고칠 수 있다).
--   · 시트 사본('제출결과' 탭)에는 고친 내용이 가지 않는다 — 원본은 수파베이스, 일일 점검은 보고만.
-- ============================================================

alter table public.submissions add column if not exists edited_at timestamptz;
alter table public.submissions add column if not exists edited_by text not null default '';

create or replace function public.sub_base_(s text) returns text
language sql immutable as $$ select regexp_replace(btrim(coalesce(s, '')), '[A-Za-z]$', '') $$;

create or replace function public.submission_mine(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_name  text := btrim(coalesce(p->>'name', ''));
  v_title text := btrim(coalesce(p->>'title', ''));
  v_id    text := btrim(coalesce(p->>'exam_id', ''));
  s public.submissions%rowtype;
begin
  if v_phone !~ '^\d{8}$' or v_name = '' or (v_title = '' and v_id = '') then
    return jsonb_build_object('found', false);
  end if;
  select * into s from public.submissions
   where parent_phone = v_phone
     and sub_base_(name) = sub_base_(v_name)
     and btrim(exam) in (v_title, v_id) and btrim(exam) <> ''
   order by id desc limit 1;
  if s.id is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'id', s.id, 'submitted_at', s.submitted_at,
    'edited_at', s.edited_at, 'sent', s.sent_at is not null,
    'wrong_count', s.wrong_count, 'wrong_text', s.wrong_text, 'vow', s.vow, 'score', s.score);
end $$;

create or replace function public.submission_update(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    bigint := nullif(regexp_replace(coalesce(p->>'id', ''), '\D', '', 'g'), '')::bigint;
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_name  text := btrim(coalesce(p->>'name', ''));
  s public.submissions%rowtype;
begin
  if v_id is null or v_phone !~ '^\d{8}$' or v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into s from public.submissions
   where id = v_id and parent_phone = v_phone and sub_base_(name) = sub_base_(v_name)
   for update;
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.sent_at is not null then return jsonb_build_object('ok', false, 'reason', 'sent'); end if;
  update public.submissions set
    wrong_count = left(coalesce(p->>'wrong_count', ''), 10),
    wrong_text  = left(coalesce(p->>'wrong_text', ''), 30000),
    vow         = left(coalesce(p->>'vow', ''), 5000),
    score       = left(coalesce(p->>'score', ''), 10),
    edited_at   = now(),
    edited_by   = '학생'
   where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.submission_mine(jsonb) from public;
revoke all on function public.submission_update(jsonb) from public;
revoke all on function public.sub_base_(text) from public;
grant execute on function public.submission_mine(jsonb) to anon, authenticated;
grant execute on function public.submission_update(jsonb) to anon, authenticated;
grant execute on function public.sub_base_(text) to anon, authenticated;
