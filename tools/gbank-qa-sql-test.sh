#!/usr/bin/env bash
# 067 모의고사 문법 문항 은행 + H WORK 문항 화면·질문 대화 — 로컬 PostgreSQL 검사 (원격에 돌리지 말 것)
# PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/gbank-qa-sql-test.sh
set -uo pipefail
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
cd "$(dirname "$0")/.."
DB=gbank_test_$$
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
  [ "$(basename $f)" = 067_gbank_qa.sql ] && continue
  psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "적용 실패: $f"; exit 1; }
done
# 이미 쌓인 도움 요청 하나 (067 이 대화로 옮겨야 한다)
psql -v ON_ERROR_STOP=1 -q <<'SQL'
insert into hwork_homeworks(teacher,code,data) values ('T','OLD','{"count":2,"items":{"1":{"type":"choice5","ans":3},"2":{"type":"choice5","ans":1}}}');
insert into hwork_submissions(ts,teacher,code,name,grade,got,total,detail,retry_key,review)
values ('2026-11-12 10:00','T','OLD','김철수','고1',1,2,'{"1":{"mine":"2","ans":"3","ok":false},"2":{"mine":"1","ans":"1","ok":true}}','oldkey',
        '{"1":{"tries":[{"pick":"4","ok":false}],"help":{"at":"2026-11-12 10:05","text":"ㄱ이 왜 틀려요"}}}');
SQL
for i in 1 2; do psql -v ON_ERROR_STOP=1 -q -f supabase/migrations/067_gbank_qa.sql >/dev/null || { echo "067 적용 실패($i)"; exit 1; }; done
psql -v ON_ERROR_STOP=1 -q <<'SQL'
insert into students (student_id, name, school, grade, code, enrolled) values ('12345678','김철수A','화정고','2026 고등 1학년','tok-kim','재원');
insert into gbank_passages(pid,html) values ('p9','<p class="pp">지문 글</p>');
insert into gbank_items(id,area,lvl,src,kind,pid,ord,html,ans,good,bad) values
 (10,'음운','심화','2026 사설 · 고3','사설','p9',1,'<div class="stem">문항 열</div>',3,'정답 해설 열','["① 오답 해설"]'),
 (11,'음운','심화','2026 사설 · 고3','사설','p9',2,'<div class="stem">문항 열하나</div>',1,'해설 열하나','[]'),
 (12,'품사','기본','2026학년도 3월 교육청 · 고1','교육청','',3,'<div class="stem">문항 열둘</div>',5,'해설 열둘','[]');
insert into hwork_homeworks(teacher,code,data) values ('T','BANK','{"count":3,"items":{"1":{"type":"choice5","ans":3},"2":{"type":"choice5","ans":1},"3":{"type":"choice5","ans":5}},"bank":{"1":10,"2":11,"3":12}}');
SQL
PASS=0; FAIL=0
q(){ psql -At -c "set role anon; select $1" 2>&1 | tail -1; }
t(){ psql -At -c "set role authenticated; $1" 2>&1 | tail -1; }
ok(){ if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "실패: $1 — $2"; fi; }
no(){ if echo "$2" | grep -q -- "$3"; then FAIL=$((FAIL+1)); echo "실패: $1 — $2"; else PASS=$((PASS+1)); fi; }
js(){ python3 -c "import sys,json;d=json.loads(sys.argv[1]);print($2)" "$1"; }

ok '공개 키 문항 표 못 읽음' "$(q "count(*) from gbank_items")" 'permission denied'
ok '공개 키 대화 표 못 읽음' "$(q "count(*) from hwork_qa")" 'permission denied'
ok '교사는 문항 읽음' "$(t "select count(*) from gbank_items")" '^3$'
ok 'meta bank 참' "$(q "hwork_meta('{\"teacher\":\"T\",\"code\":\"BANK\"}')")" '"bank": true'
ok 'meta 옛 과제 bank 거짓' "$(q "hwork_meta('{\"teacher\":\"T\",\"code\":\"OLD\"}')")" '"bank": false'
QS=$(q "hwork_qs('{\"teacher\":\"T\",\"code\":\"BANK\"}')")
ok '문항 화면 html' "$QS" '문항 열하나'
ok '문항 화면 지문' "$(js "$QS" "d['passages']['p9']")" '지문 글'
no '문항 화면에 정답 없음' "$QS" '"ans"'
no '문항 화면에 해설 없음' "$QS" '해설'
ok '옛 과제는 not_bank' "$(q "hwork_qs('{\"teacher\":\"T\",\"code\":\"OLD\"}')")" 'not_bank'

R=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"BANK\",\"name\":\"김철수\",\"grade\":\"고1\",\"answers\":{\"1\":\"3\",\"2\":\"4\",\"3\":\"2\"},\"questions\":{\"3\":\"보기 ㄴ이 헷갈려요\"}}')")
ok '제출' "$R" '"ok": true'
ID=$(js "$R" "d['id']"); KEY=$(js "$R" "d['key']")
ok '맞힌 문항 해설' "$(q "hwork_expl('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"1\"}')")" '정답 해설 열'
ok '틀린 문항 해설 잠김' "$(q "hwork_expl('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"2\"}')")" 'locked'
ok '틀린 열쇠 해설 거절' "$(q "hwork_expl('{\"id\":$ID,\"key\":\"x\",\"q\":\"1\"}')")" '찾을 수 없'
q "hwork_fix('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"2\",\"why_wrong\":\"a\",\"pick\":\"1\",\"why_right\":\"b\"}')" >/dev/null
ok '클리어 뒤 해설' "$(q "hwork_expl('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"2\"}')")" '해설 열하나'

L=$(q "hwork_qa_list('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '제출 때 질문이 대화 첫 글' "$L" '보기 ㄴ이 헷갈려요'
ok '첫 글에 학생 답' "$(js "$L" "d['msgs'][0]['mine']")" '^2$'
ok '빈 질문 거절' "$(q "hwork_qa_post('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"3\",\"text\":\"  \"}')")" '"reason": "text"'
ok '없는 문항 거절' "$(q "hwork_qa_post('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"9\",\"text\":\"a\"}')")" '"reason": "q"'
ok '틀린 열쇠 거절' "$(q "hwork_qa_post('{\"id\":$ID,\"key\":\"zz\",\"q\":\"3\",\"text\":\"a\"}')")" '찾을 수 없'
LONG=$(python3 -c "print('가'*1001)")
ok '1000자 넘음' "$(q "hwork_qa_post('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"3\",\"text\":\"$LONG\"}')")" '"reason": "long"'
P=$(q "hwork_qa_post('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"2\",\"text\":\"1번이 왜 답이에요?\"}')")
ok '학생 질문' "$P" '"ok": true'
ok '오답하기 마지막 답이 붙음' "$(js "$P" "d['msgs'][-1]['mine']")" '^1$'
ok '공개 키로 대화 직접 넣기 불가' "$(q "1; insert into hwork_qa(sub_id,q,who,body) values ($ID,'1','선생님','x')" 2>&1)" 'permission denied'
ok '교사가 학생 이름으로 넣기 불가' "$(t "insert into hwork_qa(sub_id,q,who,body) values ($ID,'2','학생','가짜')")" 'row-level security'
ok '교사 답장' "$(t "insert into hwork_qa(sub_id,q,who,name,body) values ($ID,'2','선생님','이현지','ㄱ을 다시 보세요')")" 'INSERT 0 1'
ok '교사 읽음 표시' "$(t "update hwork_qa set read_at=now() where sub_id=$ID and who='학생'")" 'UPDATE 2'
M=$(q "hwork_qa_mine('{\"key\":\"tok-kim\"}')")
ok '학생 페이지 목록에 제출' "$M" "\"id\": $ID"
ok '안 읽은 답장 1' "$(js "$M" "[x['unread'] for x in d['list'] if x['id']==$ID][0]")" '^1$'
ok '열쇠도 함께(다른 기기 이어 하기)' "$(js "$M" "[x['key'] for x in d['list'] if x['id']==$ID][0]")" "$KEY"
ok '끝의 A 떼고 이름 대조 — 옛 도움 요청 제출도' "$M" '"code": "OLD"'
L2=$(q "hwork_qa_list('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '읽기 전 상태로 돌려줌' "$(js "$L2" "[m['read'] for m in d['msgs'] if m['who']=='선생님'][0]")" 'False'
M2=$(q "hwork_qa_mine('{\"key\":\"tok-kim\"}')")
ok '읽은 뒤 안 읽은 답장 0' "$(js "$M2" "[x['unread'] for x in d['list'] if x['id']==$ID][0]")" '^0$'
ok '없는 학생' "$(q "hwork_qa_mine('{\"key\":\"nope\"}')")" 'no_student'
OLD=$(psql -At -c "select id from hwork_submissions where code='OLD'")
ok '옛 도움 요청이 대화로(한 번만)' "$(psql -At -c "select count(*)||'|'||max(body)||'|'||max(mine) from hwork_qa where sub_id=$OLD")" '^1|ㄱ이 왜 틀려요|4$'
ok '옛 도움 요청 시각 한국 시각 그대로' "$(psql -At -c "select to_char(at at time zone 'Asia/Seoul','HH24:MI') from hwork_qa where sub_id=$OLD")" '^10:05$'
psql -qc "delete from hwork_submissions where id=$ID"
ok '제출 지우면 대화도' "$(psql -At -c "select count(*) from hwork_qa where sub_id=$ID")" '^0$'
echo "통과 $PASS · 실패 $FAIL"
[ $FAIL -eq 0 ]
