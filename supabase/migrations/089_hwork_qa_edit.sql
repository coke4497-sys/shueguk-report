-- 089 — H WORK 답장 수정·지우기 (2026-11-20 원장님 "h work에 잘못된 답장을 붙여넣었어요" → "수정 지우기 버튼 필요")
-- 선생님 화면(hwork_result.html)이 자기 답장을 PATCH(body·edited_at)·DELETE 한다(072 teacher_all 정책·권한 그대로).
-- ① edited_at: 고친 때(선생님 화면에 '수정됨'). 학생 함수(hwork_qa_rows_)는 손대지 않는다.
-- ② 선생님 답장을 지워 그 문항의 마지막 글이 다시 학생 질문이 되면, 072 가 완료로 바꾼 슈톡 할 일을 '대기'로 되돌린다
--    (그 문항을 [잘 고쳤습니다]로 확인했으면 그대로 — 082 규칙).
-- 다시 실행해도 안전하다.

alter table public.hwork_qa add column if not exists edited_at timestamptz;

create or replace function public.hwork_qa_reopen_()
returns trigger language plpgsql security definer set search_path = public as $$
declare last_who text; chk jsonb;
begin
  if old.who <> '선생님' then return old; end if;
  select who into last_who from hwork_qa where sub_id = old.sub_id and q = old.q order by id desc limit 1;
  if last_who is distinct from '학생' then return old; end if;
  select checked into chk from hwork_submissions where id = old.sub_id;
  if chk is not null and chk ? old.q then return old; end if;
  update msg_tasks set status = '대기', done_by_name = null, done_at = null, updated_at = now()
   where hw_ref = 'hw:' || old.sub_id || ':' || old.q and status = '완료';
  return old;
end $$;

revoke all on function public.hwork_qa_reopen_() from public, anon, authenticated;

drop trigger if exists hwork_qa_reopen on public.hwork_qa;
create trigger hwork_qa_reopen after delete on public.hwork_qa
  for each row execute function public.hwork_qa_reopen_();
