#!/usr/bin/env bash
# 068 이미 낸 H WORK 과제에 문제 원문 잇기 — 로컬 PostgreSQL 검사 (원격에 돌리지 말 것)
# PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/hwork-src-sql-test.sh
set -uo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=hwsrc_test_$$
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
trap 'psql -qc "drop database if exists $DB" postgres >/dev/null' EXIT
export PGDATABASE=$DB
psql -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema if not exists private;
create or replace function private.is_active_teacher() returns boolean language sql stable as $$ select true $$;
grant usage on schema private to anon, authenticated;
SQL
for f in supabase/migrations/0*.sql; do
  [ "$(basename $f)" = 068_hwork_src.sql ] && continue
  psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -f supabase/migrations/068_hwork_src.sql >/dev/null || { echo "068 적용 실패($i)"; exit 1; }; done
psql -v ON_ERROR_STOP=1 -q <<'SQL'
insert into hwork_homeworks(teacher,code,data) values
 ('이수경','REAL A','{"count":3,"items":{"1":{"type":"choice5","ans":2},"2":{"type":"text","ans":"주어"},"3":{"type":"essay","ans":"예시"}}}'),
 ('이수경','PLAIN','{"count":1,"items":{"1":{"type":"choice5","ans":1}}}'),
 ('T','BANK','{"count":1,"items":{"1":{"type":"choice5","ans":3}},"bank":{"1":10}}');
insert into gbank_items(id,area,lvl,src,kind,pid,ord,html,ans,good,bad) values (10,'음운','기본','s','사설','',1,'<div>은행</div>',3,'해설','[]');
insert into hwork_src_passages(pid,html) values ('wb-P1','<div class="psg">지문</div>');
insert into hwork_src_items(code,no,qid,book,html,pid,type,ans,essay,src) values
 ('REAL A',1,'wb-1','문장 1권','<div class="stem">일번</div>','wb-P1','5지','②','','A고'),
 ('REAL A',2,'wb-2','문장 1권','<div class="stem">이번</div>','','단답','주어','주어','B고'),
 ('REAL A',3,'wb-3','문장 1권','<div class="stem">삼번</div>','','서술','','예시 답 글','C고');
insert into hwork_submissions(ts,teacher,code,name,grade,got,total,detail,retry_key,review) values
 ('2026-11-17 10:00','이수경','REAL A','김철수','고1',1,2,'{"1":{"mine":"2","ok":true},"2":{"mine":"목적어","ok":false},"3":{"mine":"글","ok":null}}','k1','{}');
SQL
PASS=0; FAIL=0
q(){ psql -At -c "set role anon; select $1" 2>&1 | tail -1; }
t(){ psql -At -c "set role authenticated; $1" 2>&1 | tail -1; }
ok(){ if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "실패: $1 — $2"; fi; }
no(){ if echo "$2" | grep -q -- "$3"; then FAIL=$((FAIL+1)); echo "실패: $1 — $2"; else PASS=$((PASS+1)); fi; }
SID=$(psql -At -c "select id from hwork_submissions where retry_key='k1'")

ok '공개 키 원문 표 못 읽음' "$(q "count(*) from hwork_src_items")" 'permission denied'
ok '공개 키 지문 표 못 읽음' "$(q "count(*) from hwork_src_passages")" 'permission denied'
ok '교사는 원문 읽음' "$(t "select count(*) from hwork_src_items")" '^3$'
ok 'meta 교재 과제 bank 참' "$(q "hwork_meta('{\"teacher\":\"이수경\",\"code\":\"REAL A\"}')")" '"bank": true'
ok 'meta 교재 과제 style real' "$(q "hwork_meta('{\"teacher\":\"이수경\",\"code\":\"REAL A\"}')")" '"style": "real"'
ok 'meta 은행 과제 style gbank' "$(q "hwork_meta('{\"teacher\":\"T\",\"code\":\"BANK\"}')")" '"style": "gbank"'
ok 'meta 원문 없는 과제 bank 거짓' "$(q "hwork_meta('{\"teacher\":\"이수경\",\"code\":\"PLAIN\"}')")" '"bank": false'
R=$(q "hwork_qs('{\"teacher\":\"이수경\",\"code\":\"REAL A\"}')")
ok 'qs 교재 문항 3개' "$R" '"3": {'
ok 'qs 지문' "$R" '"wb-P1": "<div class=\\"psg\\">지문</div>"'
ok 'qs style real' "$R" '"style": "real"'
no 'qs 정답 없음' "$R" '"ans"'
no 'qs 예시 답 없음' "$R" '예시 답 글'
ok 'qs 은행 그대로' "$(q "hwork_qs('{\"teacher\":\"T\",\"code\":\"BANK\"}')")" '은행'
ok 'qs 원문 없는 과제 거절' "$(q "hwork_qs('{\"teacher\":\"이수경\",\"code\":\"PLAIN\"}')")" 'not_bank'
ok 'expl 맞힌 문항 정답' "$(q "hwork_expl('{\"id\":$SID,\"key\":\"k1\",\"q\":\"1\"}')")" '"ans_text": "②"'
ok 'expl kind src' "$(q "hwork_expl('{\"id\":$SID,\"key\":\"k1\",\"q\":\"1\"}')")" '"kind": "src"'
ok 'expl 틀린 문항 잠김' "$(q "hwork_expl('{\"id\":$SID,\"key\":\"k1\",\"q\":\"2\"}')")" 'locked'
ok 'expl 열쇠 틀리면 거절' "$(q "hwork_expl('{\"id\":$SID,\"key\":\"x\",\"q\":\"1\"}')")" '"ok": false'
psql -qc "update hwork_submissions set review='{\"2\":{\"cleared_at\":\"2026-11-17 10:10\"}}' where id=$SID"
ok 'expl 클리어하면 단답 정답' "$(q "hwork_expl('{\"id\":$SID,\"key\":\"k1\",\"q\":\"2\"}')")" '"ans_text": "주어"'
psql -qc "update hwork_src_items set active=false where code='REAL A' and no=1"
no 'qs 숨긴 문항 빠짐' "$(q "hwork_qs('{\"teacher\":\"이수경\",\"code\":\"REAL A\"}')")" '일번'
echo "통과 $PASS · 실패 $FAIL"; [ $FAIL -eq 0 ]
