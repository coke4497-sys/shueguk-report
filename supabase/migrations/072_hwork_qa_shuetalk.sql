-- ============================================================
-- 072 H WORK 학생 질문 → 슈톡 업무 카드 · 휴대폰 알림 (2026-11-17 원장님 "질문함은 없애고 새 질문이 도착하면 슈톡에서 알려줘 업무진행에도 추가")
--   · 학생이 질문하면(hwork_qa who '학생') 담당 선생님(hwork_submissions.teacher 와 표시 이름이 같은 활성 교사, 없으면 활성 원장님)의
--     슈톡 업무 카드에 메시지 없는 할 일 한 줄(202610250002 꼴) — requester_name 'H WORK 질문', hw_ref 'hw:{제출}:{문항}'.
--     글 = '[H WORK 질문] 이름(학교 학년) · 과제 n번' + 질문 앞부분 + 채점 결과 화면 주소(hwork_result.html?sid=&q=).
--     같은 문항에 아직 '대기'인 할 일이 있으면 새로 만들지 않고 글을 바꿔 다시 알린다.
--     휴대폰 알림은 넘김 알림과 같은 길(hand_push·hand_by — 학생 화면이 hwork-ask 엣지 함수를 부르고, 못 부르면 클로슈 순찰이 보냄).
--   · 선생님이 답장하면(who '선생님') 그 문항의 '대기' 할 일을 완료로(done_by_name = 답장한 선생님).
--   · hwork_qa_post — 067 본문 + 응답에 push(알림 보낼 할 일 번호들).
--   · 이미 쌓인 답장 기다림 질문도 할 일로 한 번 넣는다(알림 없이).
-- 다시 실행해도 안전하다. 067 을 다시 돌리면 hwork_qa_post 가 옛 본문으로 돌아가니 그 뒤 072 도.
-- ============================================================

alter table public.msg_tasks add column if not exists hw_ref text not null default '';
create index if not exists msg_tasks_hw_ref_idx on public.msg_tasks (hw_ref) where hw_ref <> '';

create or replace function public.hwork_qa_task_text_(s public.hwork_submissions, q text, body text)
returns text language sql immutable set search_path = public as $$
  select left(
    '[H WORK 질문] ' || coalesce(s.name,'') || '(' || btrim(coalesce(s.school,'') || ' ' || coalesce(s.grade,'')) || ') · '
      || left(regexp_replace(regexp_replace(coalesce(s.code,''), '^SHUEGUK REAL 내신 기출\s*', ''), '^\[[^\]]+\]\s*', ''), 70) || ' ' || q || '번'
      || chr(10) || left(regexp_replace(btrim(coalesce(body,'')), '\s+', ' ', 'g'), 110)
      || chr(10) || 'https://coke4497-sys.github.io/shueguk-h-work/hwork_result.html?sid=' || s.id || '&q=' || q,
    300);
$$;

create or replace function public.hwork_qa_to_task_()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.hwork_submissions; ref text; who record; txt text; n int := 0;
begin
  ref := 'hw:' || new.sub_id || ':' || new.q;
  if new.who = '선생님' then
    update msg_tasks set status = '완료', done_by_name = left(coalesce(nullif(new.name,''), '선생님'), 40), done_at = now(),
                         hand_push = null, updated_at = now()
     where hw_ref = ref and status = '대기';
    return new;
  end if;
  select * into s from hwork_submissions where id = new.sub_id;
  if s.id is null then return new; end if;
  txt := hwork_qa_task_text_(s, new.q, new.body);
  for who in
    select t.user_id, t.display_name from teacher_accounts t where t.active and btrim(t.display_name) = btrim(coalesce(s.teacher,''))
  loop n := n + 1;
    update msg_tasks set text = txt, hand_push = who.user_id, hand_by = who.user_id, seen_at = null, updated_at = now()
     where hw_ref = ref and status = '대기' and assignee = who.user_id;
    if not found then
      insert into msg_tasks (message_id, assignee, assignee_name, requester, requester_name, text, hand_push, hand_by, hw_ref)
      values (null, who.user_id, who.display_name, who.user_id, 'H WORK 질문', txt, who.user_id, who.user_id, ref);
    end if;
  end loop;
  if n = 0 then   -- 담당 이름이 계정과 다르면(묶음 이름 등) 원장님께
    for who in select t.user_id, t.display_name from teacher_accounts t where t.active and t.role = 'admin' loop
      update msg_tasks set text = txt, hand_push = who.user_id, hand_by = who.user_id, seen_at = null, updated_at = now()
       where hw_ref = ref and status = '대기' and assignee = who.user_id;
      if not found then
        insert into msg_tasks (message_id, assignee, assignee_name, requester, requester_name, text, hand_push, hand_by, hw_ref)
        values (null, who.user_id, who.display_name, who.user_id, 'H WORK 질문', txt, who.user_id, who.user_id, ref);
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists hwork_qa_to_task on public.hwork_qa;
create trigger hwork_qa_to_task after insert on public.hwork_qa for each row execute function public.hwork_qa_to_task_();

-- 067 본문 + push
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
  return jsonb_build_object('ok', true, 'id', v_id, 'msgs', hwork_qa_rows_(s.id),
    'push', (select coalesce(jsonb_agg(t.id), '[]'::jsonb) from msg_tasks t where t.hw_ref = 'hw:' || s.id || ':' || q and t.hand_push is not null));
end $$;

revoke all on function public.hwork_qa_task_text_(public.hwork_submissions, text, text), public.hwork_qa_to_task_() from public;
revoke all on function public.hwork_qa_post(jsonb) from public;
grant execute on function public.hwork_qa_post(jsonb) to anon, authenticated;

-- 이미 쌓인 답장 기다림 질문 — 할 일로 한 번(알림 없이)
insert into msg_tasks (message_id, assignee, assignee_name, requester, requester_name, text, hw_ref)
select null, t.user_id, t.display_name, t.user_id, 'H WORK 질문', hwork_qa_task_text_(s, l.q, l.body), 'hw:' || l.sub_id || ':' || l.q
  from (select distinct on (sub_id, q) sub_id, q, who, body from hwork_qa order by sub_id, q, id desc) l
  join hwork_submissions s on s.id = l.sub_id
  join teacher_accounts t on t.active and (btrim(t.display_name) = btrim(coalesce(s.teacher,''))
        or (t.role = 'admin' and not exists (select 1 from teacher_accounts x where x.active and btrim(x.display_name) = btrim(coalesce(s.teacher,'')))))
 where l.who = '학생'
   and not exists (select 1 from msg_tasks m where m.hw_ref = 'hw:' || l.sub_id || ':' || l.q);
