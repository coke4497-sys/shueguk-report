#!/bin/bash
# 068 H WORK 교재 문항 그림 — 로컬 PostgreSQL 검사 (원격에 돌리지 말 것)
# PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/hwork-items-sql-test.sh
set -u
M=$(cd "$(dirname "$0")/../supabase/migrations" && pwd)
DB=hwitems_test
TMPF=$(mktemp)
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
export PGDATABASE=$DB
psql -q -c "do \$\$begin create role anon; exception when others then null; end\$\$; do \$\$begin create role authenticated; exception when others then null; end\$\$;" >/dev/null 2>&1
psql -q <<'SQL' >/dev/null
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
SQL
psql -q -c "create table students(id bigint generated always as identity primary key, seq int default 0, code text, student_id text, name text, school text, grade text)"
python3 - "$M/031_review_videos.sql" > "$TMPF" <<'PY'
import sys,re
s=open(sys.argv[1]).read()
print(re.search(r"create or replace function public\.review_me_.*?end \$\$;", s, re.S).group(0))
PY
psql -q -v ON_ERROR_STOP=1 -f "$TMPF" >/dev/null || { echo 'review_me_ 실패'; exit 1; }
for f in 007_hwork 020_hwork_origin 063_hwork_essay 064_hwork_retry 065_hwork_fix 066_hwork_away 067_hwork_reply_retest 068_hwork_items 068_hwork_items; do
  out=$(psql -q -v ON_ERROR_STOP=1 -f "$M/$f.sql" 2>&1 | grep -v NOTICE)
  [ -n "$out" ] && { echo "적용 실패 $f: $out"; exit 1; }
done
C1='SHUEGUK REAL 내신 기출 음운 1권(기본) 01 음운과 음운 체계 · 기본 (2/2: 교재 37~71번)'
C2='SHUEGUK REAL 내신 기출 문장 1권(기본·실력) 01 문장 성분 · 기본'
psql -q -c "insert into students(code,student_id,name,school,grade) values ('K1','11112222','이민준','화정고','2026 고등 1학년'),('K2','33334444','김하나','화정고','2026 고등 1학년')"
psql -q -c "insert into hwork_homeworks(teacher,code,data) values ('T','$C1','{\"count\":3,\"items\":{\"1\":{\"type\":\"choice5\",\"ans\":3},\"2\":{\"type\":\"choice5\",\"ans\":1},\"3\":{\"type\":\"choice5\",\"ans\":2}}}'),('T','$C2','{\"count\":2,\"items\":{\"1\":{\"type\":\"choice5\",\"ans\":2},\"2\":{\"type\":\"choice5\",\"ans\":5}}}')"
psql -q -c "insert into hwork_book_imgs(book,set_key,q,j,path,w,h) values
 ('음운 1권(기본)','01 음운과 음운 체계 · 기본',36,0,'b/x/q036_0.png',500,300),
 ('음운 1권(기본)','01 음운과 음운 체계 · 기본',37,0,'b/x/q037_0.png',500,300),
 ('음운 1권(기본)','01 음운과 음운 체계 · 기본',38,0,'b/x/q038_0.png',500,300),
 ('음운 1권(기본)','01 음운과 음운 체계 · 기본',38,1,'b/x/q038_1.png',500,120),
 ('음운 1권(기본)','01 음운과 음운 체계 · 기본',39,0,'b/x/q039_0.png',500,300),
 ('문장 1권(기본·실력)','01 문장 성분 · 기본',1,0,'b/y/q001_0.png',500,300),
 ('문장 1권(기본·실력)','01 문장 성분 · 실력',1,0,'b/y/r001_0.png',500,300)"
psql -q -c "insert into storage.objects(bucket_id,name) select 'hwork-items', path from hwork_book_imgs"
PASS=0; FAIL=0
q(){ psql -At -c "set role anon; select $1" 2>&1 | tail -1; }
qt(){ psql -At -c "set role authenticated; select $1" 2>&1 | tail -1; }
ok(){ if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "실패: $1 — $2"; fi; }
js(){ python3 -c "import sys,json;d=json.loads(sys.argv[1]);print($2)" "$1"; }
sq(){ psql -At -c "$1" | tail -1; }

ok '제목 읽기(나눈 과제)' "$(sq "select book||'|'||set_key||'|'||off from hwork_book_ref_('$C1')")" '음운 1권(기본)|01 음운과 음운 체계 · 기본|36'
ok '제목 읽기(통째)' "$(sq "select book||'|'||set_key||'|'||off from hwork_book_ref_('$C2')")" '문장 1권(기본·실력)|01 문장 성분 · 기본|0'
ok '다른 제목은 없음' "$(sq "select coalesce(book,'없음') from hwork_book_ref_('고1 어휘 1~4주 종합')")" '없음'
ok '학생 키로 표 못 읽음' "$(psql -At -c "set role anon; select count(*) from hwork_book_imgs" 2>&1)" 'permission denied'
ok '학생 키로 교사 함수 못 씀' "$(q "hwork_item_imgs_t('{\"code\":\"$C1\"}')")" 'permission denied'
T=$(qt "hwork_item_imgs_t('{\"code\":\"$C1\"}')")
ok '교사: 과제 번호로 이음(1=교재 37)' "$(js "$T" "d['items']['1'][0]['path']")" 'q037_0'
ok '교사: 여러 조각 순서' "$(js "$T" "[x['path'] for x in d['items']['2']]")" "q038_0.png', 'b/x/q038_1"
ok '교사: 앞 과제 번호는 안 섞임' "$(js "$T" "sorted(d['items'])")" "\['1', '2', '3'\]"
ok '교사: 번호만' "$(js "$(qt "hwork_item_imgs_t('{\"code\":\"$C1\",\"qs\":[\"3\"]}')")" "sorted(d['items'])")" "\['3'\]"
ok '교사: 세트 이름이 정확해야(실력 안 섞임)' "$(js "$(qt "hwork_item_imgs_t('{\"code\":\"$C2\"}')")" "d['items']['1'][0]['path']")" 'b/y/q001_0'
ok '창 열기 전 저장소 못 읽음' "$(psql -At -c "set role anon; select count(*) from storage.objects where bucket_id='hwork-items'")" '^0$'
# 오답하기 열쇠로
R=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"$C1\",\"name\":\"이민준\",\"school\":\"화정고\",\"grade\":\"고1\",\"answers\":{\"1\":\"1\",\"2\":\"1\",\"3\":\"2\"}}')")
ID=$(js "$R" "d['id']"); KEY=$(js "$R" "d['key']")
ok '틀린 열쇠 거절' "$(q "hwork_item_imgs('{\"via\":\"retry\",\"id\":$ID,\"key\":\"x\"}')")" 'not_mine'
O=$(q "hwork_item_imgs('{\"via\":\"retry\",\"id\":$ID,\"key\":\"$KEY\"}')")
ok '오답하기: 그 과제 문항 전부' "$(js "$O" "(d['bucket'],sorted(d['items']))")" "('hwork-items', \['1', '2', '3'\])"
ok '창 연 뒤 그 과제 그림만 읽힘' "$(psql -At -c "set role anon; select count(*) from storage.objects where bucket_id='hwork-items'")" '^4$'
ok '다른 과제 그림은 안 열림' "$(psql -At -c "set role anon; select count(*) from storage.objects where name like 'b/y/%'")" '^0$'
# 리테스트
psql -q -c "update hwork_book_imgs set open_until = null"
RT=$(psql -At -c "set role authenticated; insert into hwork_retests(teacher,code,src_id,stu_code,name,school,grade,qs,created_by) values ('T','$C1',$ID,'K1','이민준','화정고','고1','[\"1\",\"2\"]','김현지') returning id" | grep -E "^[0-9]+$" | head -1)
ok '남의 리테스트 거절' "$(q "hwork_item_imgs('{\"via\":\"retest\",\"id\":$RT,\"key\":\"K2\"}')")" 'not_mine'
O=$(q "hwork_item_imgs('{\"via\":\"retest\",\"id\":$RT,\"key\":\"K1\"}')")
ok '리테스트: 그 문항만' "$(js "$O" "sorted(d['items'])")" "\['1', '2'\]"
ok '리테스트 창은 그 문항 그림만' "$(psql -At -c "set role anon; select count(*) from storage.objects where bucket_id='hwork-items'")" '^3$'
ok '모르는 via' "$(q "hwork_item_imgs('{\"via\":\"x\"}')")" 'bad_via'
ok '같은 조각 두 번 못 넣음' "$(psql -At -c "insert into hwork_book_imgs(book,set_key,q,j,path) values ('음운 1권(기본)','01 음운과 음운 체계 · 기본',37,0,'b/z.png')" 2>&1)" 'duplicate'
echo "통과 $PASS · 실패 $FAIL"
[ $FAIL -eq 0 ]
