#!/bin/bash
# 067 H WORK 도움 요청 답장 · 개인 리테스트 — 로컬 PostgreSQL 검사 (원격에 돌리지 말 것)
# PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/hwork-reply-retest-sql-test.sh
set -u
M=$(cd "$(dirname "$0")/../supabase/migrations" && pwd)
DB=hwreply_test
TMPF=$(mktemp)
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
export PGDATABASE=$DB
psql -q -c "do \$\$begin create role anon; exception when others then null; end\$\$; do \$\$begin create role authenticated; exception when others then null; end\$\$;" >/dev/null 2>&1
# 학생 표 · review_me_ (031 의 그 함수만 떼어 씀)
psql -q -c "create table students(id bigint generated always as identity primary key, seq int default 0, code text, student_id text, name text, school text, grade text)"
python3 - "$M/031_review_videos.sql" > "$TMPF" <<'PY'
import sys,re
s=open(sys.argv[1]).read()
m=re.search(r"create or replace function public\.review_me_.*?end \$\$;", s, re.S)
print(m.group(0))
PY
psql -q -v ON_ERROR_STOP=1 -f "$TMPF" >/dev/null || { echo 'review_me_ 실패'; exit 1; }
for f in 007_hwork 020_hwork_origin 063_hwork_essay 064_hwork_retry 065_hwork_fix 066_hwork_away 067_hwork_reply_retest 067_hwork_reply_retest; do
  out=$(psql -q -v ON_ERROR_STOP=1 -f "$M/$f.sql" 2>&1 | grep -v NOTICE)
  [ -n "$out" ] && { echo "적용 실패 $f: $out"; exit 1; }
done
psql -q -c "insert into students(code,student_id,name,school,grade) values ('K1','11112222','이민준A','화정고','2026 고등 1학년'),('K2','33334444','이민준B','화수고','2026 고등 1학년'),('K3','55556666','김하나','화정고','2026 고등 2학년')"
psql -q -c "insert into hwork_homeworks(teacher,code,data) values ('T','C','{\"count\":5,\"items\":{\"1\":{\"type\":\"choice5\",\"ans\":3},\"2\":{\"type\":\"text\",\"ans\":\"가, 나\"},\"3\":{\"type\":\"essay\",\"ans\":\"예시\"},\"4\":{\"type\":\"ox\",\"ans\":\"O\"},\"5\":{\"type\":\"text\",\"ans\":\"다/라\"}}}')"
PASS=0; FAIL=0
q(){ psql -At -c "set role anon; select $1" 2>&1 | tail -1; }
qt(){ psql -At -c "set role authenticated; select $1" 2>&1 | tail -1; }
ok(){ if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "실패: $1 — $2"; fi; }
no(){ if echo "$2" | grep -q -- "$3"; then FAIL=$((FAIL+1)); echo "실패: $1 — $2"; else PASS=$((PASS+1)); fi; }
js(){ python3 -c "import sys,json;d=json.loads(sys.argv[1]);print($2)" "$1"; }

R=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"이민준\",\"school\":\"화정고\",\"grade\":\"고1\",\"answers\":{\"1\":\"1\",\"2\":\"가,나\",\"3\":\"x\",\"4\":\"X\",\"5\":\"마\"}}')")
ID=$(js "$R" "d['id']"); KEY=$(js "$R" "d['key']")
R2=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"이민준\",\"school\":\"화수고\",\"grade\":\"고1\",\"answers\":{\"1\":\"3\"}}')")
ID2=$(js "$R2" "d['id']")

# ── 답장 ──
ok '학생 키로는 답장 못 씀' "$(q "hwork_reply('{\"id\":$ID,\"q\":\"1\",\"text\":\"a\"}')")" 'permission denied'
ok '도움 요청 없는 문항 거절' "$(qt "hwork_reply('{\"id\":$ID,\"q\":\"1\",\"text\":\"a\"}')")" 'no_help'
q "hwork_flag('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"1\",\"kind\":\"help\",\"text\":\"모르겠어요\"}')" >/dev/null
q "hwork_flag('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"5\",\"kind\":\"help\",\"text\":\"\"}')" >/dev/null
LONG=$(python3 -c "print('가'*1001)")
ok '1000자 넘음' "$(qt "hwork_reply('{\"id\":$ID,\"q\":\"1\",\"text\":\"$LONG\"}')")" '"reason": "long"'
ok '답장 저장' "$(qt "hwork_reply('{\"id\":$ID,\"q\":\"1\",\"text\":\"3번은 지문 둘째 문단을 보세요\",\"by\":\"김현지\"}')")" '"by": "김현지"'
qt "hwork_reply('{\"id\":$ID,\"q\":\"5\",\"text\":\"다 또는 라\",\"by\":\"김현지\"}')" >/dev/null
# 학생이 오답하기를 이어 해도 답장이 남는다
q "hwork_fix('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"1\",\"why_wrong\":\"a\",\"pick\":\"3\",\"why_right\":\"b\"}')" >/dev/null
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '상태에 답장' "$(js "$S" "d['reply']['1']['text']")" '둘째 문단'
ok '오답하기 뒤에도 답장 유지' "$(js "$S" "sorted(d['reply'].keys())")" "\['1', '5'\]"
ok '답장 지우기' "$(qt "hwork_reply('{\"id\":$ID,\"q\":\"5\",\"text\":\"\"}')")" '"removed": true'
ok '지운 뒤 하나' "$(psql -At -c "select reply::text from hwork_submissions where id=$ID")" '^{"1"'
qt "hwork_reply('{\"id\":$ID,\"q\":\"1\",\"text\":\"\"}')" >/dev/null
ok '모두 지우면 null' "$(psql -At -c "select coalesce(reply::text,'NULL') from hwork_submissions where id=$ID")" '^NULL$'
qt "hwork_reply('{\"id\":$ID,\"q\":\"1\",\"text\":\"다시 답장\",\"by\":\"김현지\"}')" >/dev/null

# ── 학생 페이지 목록 ──
X=$(q "hwork_student_extra('{\"key\":\"K1\"}')")
ok '이민준A 답장 1개' "$(js "$X" "len(d['replies'])")" '^1$'
ok '답장 내용' "$(js "$X" "(d['replies'][0]['q'],d['replies'][0]['help'],d['replies'][0]['text'],d['replies'][0]['cleared'],d['replies'][0]['mine'])")" "('1', '모르겠어요', '다시 답장', True, '1')"
ok '학교 다른 이민준B 답장 없음' "$(js "$(q "hwork_student_extra('{\"key\":\"K2\"}')")" "len(d['replies'])")" '^0$'
ok '학생ID로도' "$(js "$(q "hwork_student_extra('{\"student\":\"11112222\"}')")" "len(d['replies'])")" '^1$'
ok '없는 키' "$(q "hwork_student_extra('{\"key\":\"nope\"}')")" 'no_student'
no '정답은 안 나감' "$X" '"ans"'

# ── 다른 기기에서 이어 하기 ──
O=$(q "hwork_open_mine('{\"key\":\"K1\",\"teacher\":\"T\",\"code\":\"C\"}')")
ok '내 제출 열쇠' "$(js "$O" "(d['id'],d['key'])")" "($ID, '$KEY')"
ok '이민준B는 화수고 제출' "$(js "$(q "hwork_open_mine('{\"key\":\"K2\",\"code\":\"C\"}')")" "d['id']")" "^$ID2$"
ok '안 낸 학생' "$(q "hwork_open_mine('{\"key\":\"K3\",\"code\":\"C\"}')")" '"reason": "none"'

# ── 리테스트 ──
ok '학생 키로 표 직접 못 씀' "$(psql -At -c "set role anon; insert into hwork_retests(stu_code) values ('K1')" 2>&1)" 'permission denied'
RT=$(psql -At -c "set role authenticated; insert into hwork_retests(teacher,code,src_id,stu_code,name,school,grade,qs,created_by) values ('T','C',$ID,'K1','이민준A','화정고','고1','[\"1\",\"4\",\"5\"]','김현지') returning id" | grep -E "^[0-9]+$" | head -1)
ok '같은 제출로 두 번 못 만듦' "$(psql -At -c "set role authenticated; insert into hwork_retests(src_id,stu_code) values ($ID,'K1')" 2>&1)" 'duplicate'
ok '목록에 리테스트' "$(js "$(q "hwork_student_extra('{\"key\":\"K1\"}')")" "(len(d['retests']),d['retests'][0]['n'])")" '(1, 3)'
ok '남의 리테스트 못 엶' "$(q "hwork_retest_open('{\"key\":\"K2\",\"id\":$RT}')")" '찾을 수 없'
OP=$(q "hwork_retest_open('{\"key\":\"K1\",\"id\":$RT}')")
ok '문항 종류' "$(js "$OP" "(d['items']['4']['type'],d['submitted'])")" "('ox', False)"
no '여는 응답에 정답 없음' "$(js "$OP" "d['items']")" "ans"
SB=$(q "hwork_retest_submit('{\"key\":\"K1\",\"id\":$RT,\"answers\":{\"1\":\"3\",\"4\":\"X\",\"5\":\"라\"}}')")
ok '채점 2/3' "$(js "$SB" "(d['got'],d['total'])")" '(2, 3)'
no '틀린 4번 정답 감춤' "$(js "$SB" "d['detail']['4']")" "'ans'"
ok '맞은 5번 정답 보임' "$(js "$SB" "d['detail']['5']")" "'ans'"
ok '두 번 못 냄' "$(q "hwork_retest_submit('{\"key\":\"K1\",\"id\":$RT,\"answers\":{}}')")" '"reason": "done"'
ok '제출 뒤 상태' "$(js "$(q "hwork_retest_open('{\"key\":\"K1\",\"id\":$RT}')")" "(d['submitted'],d['got'])")" '(True, 2)'
ok '원 제출 수는 그대로(별 없음)' "$(psql -At -c "select count(*) from hwork_submissions")" '^2$'
echo "통과 $PASS · 실패 $FAIL"
[ $FAIL -eq 0 ]
