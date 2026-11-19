-- ============================================================
-- 070 질문함에 답장 첨부 · 개인 리테스트 합치기 (2026-11-17 원장님 "답장 첨부랑 개인 리테스트도 질문함에 합쳐줘")
--   다른 세션(브랜치 claude/vibrant-heisenberg-whfy06)이 같은 날 실제 DB 에 넣은 것 — 저장소 main 에는 그 파일이 없다:
--     · 비공개 버킷 hwork-reply-files + 표 hwork_reply_files + hwork_reply_file_url(10분 창) — 답장 첨부
--     · 표 hwork_retests + hwork_retest_open / hwork_retest_submit / hwork_student_extra / hwork_open_mine — 개인 리테스트
--   그 표·함수는 그대로 쓰고, 이 파일은 질문함(hwork_qa — 067)에 잇는 부분만 더한다.
--   · hwork_reply_files.qa_id — 질문함 답장 한 줄(hwork_qa.id)에 붙은 첨부. 답장을 지우면 함께 지워진다.
--   · hwork_qa_rows_ — 대화 줄마다 files [{id,name,size,mime}] (경로는 싣지 않음).
--   · hwork_reply_file_url — 질문함 답장(qa_id)의 첨부도 그 제출의 학생이면 연다.
--   · hwork_retest_submit — 채점을 069 hwork_ans_ok_ 로(복수 정답 '3,4' · 모두 정답 '*').
-- 이 파일은 그 표·함수가 이미 있는 실제 DB 에만 돌린다(없으면 앞부분에서 멈춘다).
-- 다시 실행해도 안전하다. 그 세션의 067_hwork_reply_retest 를 다시 돌리면 그 뒤 070 도.
-- ============================================================

alter table public.hwork_reply_files add column if not exists qa_id bigint references public.hwork_qa(id) on delete cascade;
create index if not exists hwork_reply_files_qa_idx on public.hwork_reply_files (qa_id);

create or replace function public.hwork_qa_rows_(sid bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'q', a.q, 'who', a.who, 'name', a.name, 'body', a.body, 'mine', a.mine,
           'at', to_char(a.at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
           'read', a.read_at is not null,
           'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size, 'mime', f.mime) order by f.id), '[]'::jsonb)
                       from hwork_reply_files f where f.qa_id = a.id)) order by a.id), '[]'::jsonb)
  from hwork_qa a where a.sub_id = sid;
$$;

create or replace function public.hwork_reply_file_url(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.hwork_reply_files; s public.hwork_submissions; me public.students;
        v_fid bigint := case when coalesce(p->>'file','') ~ '^\d{1,18}$' then (p->>'file')::bigint else -1 end;
begin
  select * into f from hwork_reply_files where id = v_fid;
  if f.id is null then return jsonb_build_object('ok', false, 'error', '파일을 찾을 수 없습니다.'); end if;
  if coalesce(p->>'via','') = 'retry' then
    s := hwork_row_(p);
    if s.id is null or s.id <> f.sub_id then return jsonb_build_object('ok', false, 'error', 'not_mine'); end if;
  else
    me := review_me_(p);
    if me.id is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
    select * into s from hwork_submissions where id = f.sub_id;
    if s.id is null or not hwork_is_me_(me, s.name, s.school, s.grade) then
      return jsonb_build_object('ok', false, 'error', 'not_mine');
    end if;
  end if;
  if not (coalesce(s.reply, '{}'::jsonb) ? f.q)
     and not exists (select 1 from hwork_qa a where a.id = f.qa_id and a.sub_id = s.id) then
    return jsonb_build_object('ok', false, 'error', 'not_mine');
  end if;
  update hwork_reply_files set open_until = now() + interval '10 minutes' where id = f.id;
  return jsonb_build_object('ok', true, 'bucket', 'hwork-reply-files', 'path', f.path, 'name', f.name, 'size', f.size, 'mime', f.mime);
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
    if item->>'type' = 'essay' then continue; end if;
    if coalesce(item->>'ans','') = '*' then ok := true;
    elsif item->>'type' = 'text' then ok := hwork_text_ok_(mine, item->>'ans');
    else ok := hwork_ans_ok_(mine, item->>'ans'); end if;
    v_tot := v_tot + 1; if ok then v_got := v_got + 1; end if;
    ans := ans || jsonb_build_object(q, mine);
    det := det || jsonb_build_object(q, jsonb_strip_nulls(jsonb_build_object('type', item->>'type'))
                                       || jsonb_build_object('mine', mine, 'ans', coalesce(item->>'ans',''), 'ok', ok));
  end loop;
  update hwork_retests set answers = ans, detail = det, got = v_got, total = v_tot, submitted_at = ts_now where id = r.id;
  return jsonb_build_object('ok', true, 'got', v_got, 'total', v_tot, 'submitted_at', ts_now, 'detail', hwork_hide_wrong_(det));
end $$;

revoke all on function public.hwork_qa_rows_(bigint) from public;
revoke all on function public.hwork_reply_file_url(jsonb) from public;
grant execute on function public.hwork_reply_file_url(jsonb) to anon, authenticated;
revoke all on function public.hwork_retest_submit(jsonb) from public;
grant execute on function public.hwork_retest_submit(jsonb) to anon, authenticated;
