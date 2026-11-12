#!/bin/bash
# 064·065 H WORK 오답하기 + 066 화면 이탈 — 로컬 PostgreSQL 검사 (원격에 돌리지 말 것)
# PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/hwork-retry-sql-test.sh
set -u
M=$(cd "$(dirname "$0")/../supabase/migrations" && pwd)
DB=hwretry_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
export PGDATABASE=$DB
psql -q -c "do \$\$begin create role anon; exception when others then null; end\$\$; do \$\$begin create role authenticated; exception when others then null; end\$\$;" >/dev/null 2>&1
for f in 007_hwork 020_hwork_origin 063_hwork_essay 064_hwork_retry 065_hwork_fix 064_hwork_retry 065_hwork_fix 066_hwork_away 066_hwork_away; do
  out=$(psql -q -v ON_ERROR_STOP=1 -f "$M/$f.sql" 2>&1 | grep -v NOTICE)
  [ -n "$out" ] && { echo "적용 실패 $f: $out"; exit 1; }
done
psql -q -c "insert into hwork_homeworks(teacher,code,data) values ('T','C','{\"count\":5,\"items\":{\"1\":{\"type\":\"choice5\",\"ans\":3},\"2\":{\"type\":\"text\",\"ans\":\"가, 나\"},\"3\":{\"type\":\"essay\",\"ans\":\"예시\"},\"4\":{\"type\":\"choice5\",\"ans\":2},\"5\":{\"type\":\"text\",\"ans\":\"다/라\"}}}')"
PASS=0; FAIL=0
q(){ psql -At -c "set role anon; select $1" 2>&1 | tail -1; }
ok(){ if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "실패: $1 — $2"; fi; }
no(){ if echo "$2" | grep -q -- "$3"; then FAIL=$((FAIL+1)); echo "실패: $1 — $2"; else PASS=$((PASS+1)); fi; }
js(){ python3 -c "import sys,json;d=json.loads(sys.argv[1]);print($2)" "$1"; }
fx(){ q "hwork_fix('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"$1\",\"why_wrong\":\"$2\",\"pick\":\"$3\",\"why_right\":\"$4\"}')"; }

R=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"n\",\"answers\":{\"1\":\"1\",\"2\":\"가,나\",\"3\":\"x\",\"4\":\"5\",\"5\":\"마\"}}')")
ok '제출 성공' "$R" '"ok": true'
no '틀린 1번 ans 숨김' "$(js "$R" "d['result']['detail']['1']")" "'ans'"
ok '맞은 2번 ans 보임' "$(js "$R" "d['result']['detail']['2']")" "'ans'"
ok '서술 예시 답 보임' "$(js "$R" "d['result']['detail']['3']")" "'ans': '예시'"
ID=$(js "$R" "d['id']"); KEY=$(js "$R" "d['key']")
ok '064 hwork_retry 지워짐' "$(q "hwork_retry('{}')")" 'No function'
ok '064 hwork_review 지워짐' "$(q "hwork_review('{}')")" 'No function'
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '상태 fix' "$S" '"stage": "fix"'
ok '처음엔 공개 정답 없음' "$(js "$S" "d['answers']")" '^{}$'
ok '틀린 열쇠' "$(q "hwork_fix('{\"id\":$ID,\"key\":\"x\",\"q\":\"1\"}')")" '찾을 수 없'
ok '맞은 문항은 오답하기 아님' "$(fx 2 a 가 b)" 'not_wrong'
ok '서술형은 오답하기 아님' "$(fx 3 a b c)" 'not_wrong'
ok '이유 빈칸' "$(fx 1 ' ' 3 b)" '"reason": "why_wrong"'
ok '답 빈칸' "$(fx 1 a '' b)" '"reason": "pick"'
ok '정답 이유 빈칸' "$(fx 1 a 3 '')" '"reason": "why_right"'
LONG=$(python3 -c "print('가'*301)")
ok '300자 넘음' "$(fx 1 a 3 $LONG)" '"reason": "long"'
F=$(fx 1 '그냥 찍었다' 4 '4번이 맞아 보였다')
ok '1번 다시 틀림' "$F" '"correct": false'
ok '틀리면 정답 안 줌' "$(js "$F" "d['ans']")" '^None$'
F=$(fx 1 '4번 보기를 잘못 읽었다' 3 '3번이 지문과 맞는다')
ok '1번 두 번째에 클리어' "$F" '"correct": true'
ok '클리어하면 정답' "$(js "$F" "d['ans']")" '^3$'
ok '클리어 수 1/3' "$(js "$F" "(d['cleared'],d['total'])")" '(1, 3)'
ok '회귀 기록 — 둘째 시도의 틀린 답은 첫 시도 답' "$(psql -At -c "select review->'1'->'tries'->1->>'wrong', review->'1'->'tries'->0->>'wrong' from hwork_submissions where id=$ID")" '^4|1$'
ok '클리어한 문항 다시 못 함' "$(fx 1 a 3 b)" 'cleared'
ok '4번 바로 클리어' "$(fx 4 '헷갈렸다' 2 '2번이 근거와 맞다')" '"correct": true'
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '아직 fix' "$S" '"stage": "fix"'
ok '상태 정답은 클리어한 1·4번만' "$(js "$S" "sorted(d['answers'].items())")" "\[('1', '3'), ('4', '2')\]"
no '상태 detail 5번 정답 숨김' "$(js "$S" "d['detail']['5']")" "'ans'"
fl(){ q "hwork_flag('{\"id\":$ID,\"key\":\"$KEY\",\"q\":\"$1\",\"kind\":\"$2\",\"text\":\"$3\"}')"; }
ok '오류 신고는 내용 필수' "$(fl 5 error '')" '"reason": "text"'
ok '맞은 문항엔 표시 못 함' "$(fl 2 help '')" 'not_wrong'
ok '이상한 표시 거절' "$(fl 5 xx '')" '알 수 없는'
F=$(fl 5 help '')
ok '도움 요청 표시(내용 없어도 됨)' "$F" '"kind": "help"'
ok '표시만으로 5번은 넘김 → 모두 끝' "$F" '"done": true'
ok '같은 표시 두 번 거절' "$(fl 5 help '')" '"reason": "done"'
ok '오류 신고 표시' "$(fl 5 error '보기 3번 오타')" '"kind": "error"'
ok '저장된 표시' "$(psql -At -c "select review->'5'->'error'->>'text', review->'5' ? 'help', review_at is not null from hwork_submissions where id=$ID")" '^보기 3번 오타|t|t$'
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '넘긴 문항 정답은 여전히 숨김' "$(js "$S" "'5' in d['answers']")" '^False$'
ok '5번 단답 키워드 채점(표시 뒤에도 계속 가능)' "$(fx 5 '마로 착각했다' 라 '라가 맞다')" '"correct": true'
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '모두 클리어하면 done' "$S" '"stage": "done"'
ok '저장: 첫 시도 클리어 2·review_at' "$(psql -At -c "select retry_got, review_at is not null, retry_at is not null from hwork_submissions where id=$ID")" '^2|t|t$'

R2=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"m\",\"answers\":{\"1\":\"3\",\"2\":\"가,나\",\"4\":\"2\",\"5\":\"다\"}}')")
I2=$(js "$R2" "d['id']"); K2=$(js "$R2" "d['key']")
ok '다 맞히면 done' "$(q "hwork_retry_state('{\"id\":$I2,\"key\":\"$K2\"}')")" '"stage": "done"'

ok 'anon 도우미 막힘' "$(q "hwork_cleared_ans_('{}','{}')")" 'permission denied'
ok 'anon 표 막힘' "$(q "count(*) from hwork_submissions")" 'permission denied'
# 066 화면 이탈
A=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"aw\",\"answers\":{},\"away\":{\"n\":3,\"sec\":130}}')")
ok '066 이탈 있는 제출' "$A" '"ok": true'
ok '066 이탈 저장' "$(psql -At -c "select away_n||'/'||away_sec from hwork_submissions where name='aw'")" '^3/130$'
q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"aw2\",\"answers\":{},\"away\":{\"n\":\"x\",\"sec\":-5}}')" >/dev/null
ok '066 이상한 값은 0' "$(psql -At -c "select away_n||'/'||away_sec from hwork_submissions where name='aw2'")" '^0/0$'
q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"aw3\",\"answers\":{},\"away\":{\"n\":99999,\"sec\":999999}}')" >/dev/null
ok '066 상한' "$(psql -At -c "select away_n||'/'||away_sec from hwork_submissions where name='aw3'")" '^9999/86400$'
ok '066 away 없는 옛 화면' "$(psql -At -c "select away_n||'/'||away_sec from hwork_submissions where name='n'")" '^0/0$'
psql -q -d postgres -c "drop database $DB" >/dev/null 2>&1
echo "통과 $PASS · 실패 $FAIL"
[ $FAIL -eq 0 ]
