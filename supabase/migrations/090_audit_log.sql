-- 090 · 모든 쓰기의 '누가' 기록 (2026-11-22 원장님 "공용교사 계정을 없애고 모든 활동을 누가했는지 알아야 해요"
--        → 선택 'DB가 자동으로 모두 기록')
--
-- public 의 표(아래 제외 목록 빼고)에 쓰기·고치기·지우기가 일어날 때마다 audit_log 에 한 줄:
--   at · tbl · op(I/U/D) · pk(그 줄의 id 등) · uid(auth.uid) · who(사람 이름) · via(경로) · changed(바뀐 열) · old/new(긴 글은 자름)
-- who 정하기: 활성/비활성 teacher_accounts 의 display_name → 공용 교사 계정(teachers@) → '클로슈'(closhu@) →
--   공개 키(학생 페이지 함수) '학생 페이지' → service_role '서버(엣지 함수)' → JWT 없음 '관리자 직접(SQL)'.
-- 읽기는 원장님만(private.activity_viewer()). 쓰기는 트리거만(표 권한 없음).
-- 새 표를 만들면 맨 아래 private.audit_attach('표 이름') 를 한 줄 더 돌릴 것.
-- 400일 지난 줄은 pg_cron 이 매일 지운다(있을 때만).

create table if not exists public.audit_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  tbl      text not null,
  op       text not null check (op in ('I','U','D')),
  pk       text,
  uid      uuid,
  who      text,
  via      text,
  changed  text[],
  old      jsonb,
  new      jsonb
);
create index if not exists audit_log_at_idx  on public.audit_log (at desc);
create index if not exists audit_log_tbl_idx on public.audit_log (tbl, at desc);
create index if not exists audit_log_uid_idx on public.audit_log (uid, at desc);
create index if not exists audit_log_who_idx on public.audit_log (who, at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using (private.activity_viewer());

-- 긴 글은 300자로 자르고, 그림·파일처럼 큰 열은 '(생략)'
create or replace function private.audit_slim(j jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k,
           case
             when k in ('photo','imgs','img','data_url','bits','html') then to_jsonb('(생략)'::text)
             when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 300 then to_jsonb(left(v #>> '{}', 300) || '…')
             when jsonb_typeof(v) in ('object','array') and length(v::text) > 1500 then to_jsonb(left(v::text, 1500) || '…')
             else v end), '{}'::jsonb)
  from jsonb_each(j) as e(k, v)
$$;

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j_old jsonb; j_new jsonb; ch text[]; o jsonb; n jsonb;
  claims jsonb; jrole text; u uuid; nm text; mail text; via_s text; pk_s text;
begin
  if tg_op <> 'INSERT' then j_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then j_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into ch
      from jsonb_each(j_new) e(k, v)
     where k not in ('updated_at') and (j_old -> k) is distinct from v;
    if ch is null then return null; end if;           -- 바뀐 것 없음(또는 updated_at 만)
    select jsonb_object_agg(k, j_old -> k) into o from unnest(ch) k;
    select jsonb_object_agg(k, j_new -> k) into n from unnest(ch) k;
  else
    o := j_old; n := j_new;
  end if;

  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  jrole := coalesce(claims ->> 'role', '');
  begin u := nullif(claims ->> 'sub', '')::uuid; exception when others then u := null; end;
  mail := claims ->> 'email';

  if u is not null then
    select display_name into nm from public.teacher_accounts where user_id = u limit 1;
  end if;
  if nm is null then
    nm := case
      when mail = 'teachers@shueguk.internal' then '공용 교사 계정'
      when mail = 'closhu@shueguk.internal'   then '클로슈'
      when jrole = 'anon'          then '학생 페이지'
      when jrole = 'service_role'  then '서버(엣지 함수)'
      when claims is null         then '관리자 직접(SQL)'
      else coalesce(mail, jrole, '?') end;
  end if;
  via_s := case when claims is null then 'sql' else jrole end;

  pk_s := coalesce(j_new ->> 'id', j_old ->> 'id', j_new ->> 'user_id', j_old ->> 'user_id', j_new ->> 'code', j_old ->> 'code');

  insert into public.audit_log (tbl, op, pk, uid, who, via, changed, old, new)
  values (tg_table_name, left(tg_op, 1), pk_s, u, nm, via_s, ch,
          case when o is null then null else private.audit_slim(o) end,
          case when n is null then null else private.audit_slim(n) end);
  return null;
exception when others then
  return null;                                        -- 기록이 실패해도 원래 쓰기는 막지 않는다
end $$;

create or replace function private.audit_attach(t text) returns void
language plpgsql as $$
begin
  execute format('drop trigger if exists zz_audit on public.%I', t);
  execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function private.audit_row()', t);
end $$;

-- 제외: 기록 표 자신, 잦은 자동 기록(사용 시간·읽은 자리·알림 구독·활동 알림), 계산 캐시, 큰 그림 표
do $$
declare r record;
begin
  for r in select table_name from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE'
              and table_name not in ('audit_log','teacher_usage','teacher_usage_last','msg_push_subs','msg_reads',
                                     'activity_log','activity_notices','star_ranking','hwork_book_imgs','msg_bot_runs')
  loop
    perform private.audit_attach(r.table_name);
  end loop;
end $$;

-- 400일 지난 기록 지우기 (pg_cron 이 있을 때만)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'audit-log-trim';
    perform cron.schedule('audit-log-trim', '17 19 * * *', $c$delete from public.audit_log where at < now() - interval '400 days'$c$);
  end if;
end $$;
