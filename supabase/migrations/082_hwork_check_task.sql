-- ============================================================
-- 082 H WORK [잘 고쳤습니다]도 슈톡 업무 카드 완료 (2026-11-19 원장님 "잘 고쳤습니다만 눌러도 처리로 쳐줘" → "업무 카드도 함께 완료되게")
--   · 선생님이 채점 결과 화면에서 문항을 확인하면(hwork_submissions.checked 에 그 문항이 새로 생기거나 바뀜 —
--     [잘 고쳤습니다 ♥]·[클리어한 … 모두 잘 고쳤습니다]·[과제 검사 완료]) 그 문항의 '대기' H WORK 질문 할 일(hw_ref 'hw:제출:문항')을 완료로.
--     done_by_name = checked 의 by(확인한 선생님). 답장 때 완료하는 072 트리거와 같은 모양.
--   · 확인을 취소해도 할 일을 되살리지 않는다(학생이 다시 질문하면 072 가 새로 '대기'로 올린다).
--   · 이미 확인한 뒤에 남아 있는 '대기' 할 일(마지막 학생 글보다 늦게 확인한 것)도 한 번 완료로.
-- 다시 실행해도 안전하다.
-- ============================================================

create or replace function public.hwork_check_to_task_()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; v jsonb;
begin
  if new.checked is null or jsonb_typeof(new.checked) <> 'object' then return new; end if;
  for k, v in select * from jsonb_each(new.checked) loop
    if old.checked is not null and jsonb_typeof(old.checked) = 'object' and old.checked -> k is not distinct from v then continue; end if;
    update msg_tasks set status = '완료', done_by_name = left(coalesce(nullif(v->>'by',''), '선생님'), 40), done_at = now(),
                         hand_push = null, updated_at = now()
     where hw_ref = 'hw:' || new.id || ':' || k and status = '대기';
  end loop;
  return new;
end $$;

drop trigger if exists hwork_check_to_task on public.hwork_submissions;
create trigger hwork_check_to_task after update of checked on public.hwork_submissions
  for each row execute function public.hwork_check_to_task_();

revoke all on function public.hwork_check_to_task_() from public;

-- 이미 확인했는데 남아 있는 할 일 — 확인 시각(한국 'YYYY-MM-DD HH:MM')이 그 문항 마지막 학생 글보다 늦으면 완료
update msg_tasks t set status = '완료', done_by_name = left(coalesce(nullif(c.v->>'by',''), '선생님'), 40), done_at = now(),
                       hand_push = null, updated_at = now()
  from hwork_submissions s
  cross join lateral jsonb_each(case when jsonb_typeof(s.checked) = 'object' then s.checked else '{}'::jsonb end) as c(k, v)
 where t.status = '대기' and t.hw_ref = 'hw:' || s.id || ':' || c.k
   and coalesce(c.v->>'at','') >= coalesce((select to_char(max(a.at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
                                               from hwork_qa a where a.sub_id = s.id and a.q = c.k and a.who = '학생'), '');
