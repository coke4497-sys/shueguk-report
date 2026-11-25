-- 092 · H WORK 질문 답장 초안 (2026-11-24 원장님 "질문에 대한 답을 자동으로 클로슈가 해결해줄 수 있어요? 답장을 전송하기 전 제가 한번 확인하고요"
--                               → "30분마다, 모든 선생님 과제로")
-- 클로슈 순찰(tools/hwork_qa_draft.py)이 답장을 기다리는 학생 질문마다 초안을 이 표에 적고,
-- 선생님이 채점·질문 확인 화면(H WORK hwork_result.html)에서 고친 뒤 [답장 보내기]를 눌러야 hwork_qa 로 간다.
-- 학생은 이 표를 볼 수 없다(교사 전용 — 045 규칙: authenticated 전체 허용, 공개 키 차단).
-- kind: '초안' = 바로 다듬어 보낼 답장 / '확인 필요' = 정답·문항 자체가 의심스러워 선생님 판단이 먼저(body 는 참고 글, note 에 이유).
-- after_id = 이 초안이 답하는 마지막 학생 글(hwork_qa.id) — 학생이 또 물으면 새 초안이 생긴다.
create table if not exists public.hwork_qa_drafts (
  id         bigserial primary key,
  sub_id     bigint not null references public.hwork_submissions(id) on delete cascade,
  q          text   not null,
  after_id   bigint not null,
  kind       text   not null default '초안' check (kind in ('초안','확인 필요')),
  body       text   not null default '' check (char_length(body) <= 5000),
  note       text   not null default '' check (char_length(note) <= 1000),
  made_by    text   not null default '클로슈',
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    text   not null default '',
  dismissed_at timestamptz,
  unique (sub_id, q, after_id)
);
create index if not exists hwork_qa_drafts_sub_idx on public.hwork_qa_drafts (sub_id, q);

alter table public.hwork_qa_drafts enable row level security;
revoke all on public.hwork_qa_drafts from anon;
revoke references, trigger, truncate on public.hwork_qa_drafts from authenticated;
grant select, insert, update, delete on public.hwork_qa_drafts to authenticated;
grant usage, select on sequence public.hwork_qa_drafts_id_seq to authenticated;
drop policy if exists teacher_all on public.hwork_qa_drafts;
create policy teacher_all on public.hwork_qa_drafts for all to authenticated using (true) with check (true);

-- 누가 했는지 기록(090)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'audit_attach') then
    perform private.audit_attach('hwork_qa_drafts');
  end if;
end $$;
