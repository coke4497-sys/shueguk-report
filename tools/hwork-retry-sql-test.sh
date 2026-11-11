#!/bin/bash
# 064 H WORK 다시 풀기·오답 정리 — 로컬 PostgreSQL 검사 (원격에 돌리지 말 것)
# PGHOST=/home/pgtest PGPORT=5499 PGUSER=postgres bash tools/hwork-retry-sql-test.sh
set -u
M=$(cd "$(dirname "$0")/../supabase/migrations" && pwd)
DB=hwretry_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
export PGDATABASE=$DB
psql -q -c "do \$\$begin create role anon; exception when others then null; end\$\$; do \$\$begin create role authenticated; exception when others then null; end\$\$;" >/dev/null 2>&1
for f in 007_hwork 020_hwork_origin 063_hwork_essay 064_hwork_retry 064_hwork_retry; do
  out=$(psql -q -v ON_ERROR_STOP=1 -f "$M/$f.sql" 2>&1 | grep -v NOTICE)
  [ -n "$out" ] && { echo "적용 실패 $f: $out"; exit 1; }
done
psql -q -c "insert into hwork_homeworks(teacher,code,data) values ('T','C','{\"count\":5,\"items\":{\"1\":{\"type\":\"choice5\",\"ans\":3},\"2\":{\"type\":\"text\",\"ans\":\"가, 나\"},\"3\":{\"type\":\"essay\",\"ans\":\"예시\"},\"4\":{\"type\":\"choice5\",\"ans\":2},\"5\":{\"type\":\"text\",\"ans\":\"다/라\"}}}')"
PASS=0; FAIL=0
q(){ psql -At -c "set role anon; select $1" 2>&1 | tail -1; }
ok(){ if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "실패: $1 — $2"; fi; }
no(){ if echo "$2" | grep -q -- "$3"; then FAIL=$((FAIL+1)); echo "실패: $1 — $2"; else PASS=$((PASS+1)); fi; }
js(){ python3 -c "import sys,json;d=json.loads(sys.argv[1]);print($2)" "$1"; }

R=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"n\",\"answers\":{\"1\":\"1\",\"2\":\"가,나\",\"3\":\"x\",\"4\":\"5\",\"5\":\"마\"}}')")
ok '제출 성공' "$R" '"ok": true'
ok '틀린 1번 정답 숨김' "$(js "$R" "d['result']['detail']['1']")" "'ok': False"
no '틀린 1번 ans 없음' "$(js "$R" "d['result']['detail']['1']")" "'ans'"
ok '맞은 2번 ans 보임' "$(js "$R" "d['result']['detail']['2']")" "'ans'"
ok '서술 예시 답 보임' "$(js "$R" "d['result']['detail']['3']")" "'ans': '예시'"
ID=$(js "$R" "d['id']"); KEY=$(js "$R" "d['key']")
ok '열쇠 32자' "${#KEY}" '32'
ok '저장 detail 에는 정답' "$(psql -At -c "select detail->'1'->>'ans' from hwork_submissions where id=$ID")" '^3$'

ok '틀린 열쇠' "$(q "hwork_retry('{\"id\":$ID,\"key\":\"x\",\"answers\":{}}')")" '찾을 수 없'
ok '숫자 아닌 id' "$(q "hwork_retry('{\"id\":\"1;x\",\"key\":\"$KEY\",\"answers\":{}}')")" '찾을 수 없'
ok '다시 풀기 전 정리 거절' "$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\"}')")" 'no_retry'
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '상태 retry' "$S" '"stage": "retry"'
no '상태도 정답 숨김' "$(js "$S" "d['detail']['4']")" "'ans'"

RT=$(q "hwork_retry('{\"id\":$ID,\"key\":\"$KEY\",\"answers\":{\"1\":\"3\",\"4\":\"1\",\"5\":\"라\",\"2\":\"zz\"}}')")
ok '다시 풀기 성공' "$RT" '"ok": true'
ok '2차 맞힌 수 2' "$RT" '"retry_got": 2'
ok '남은 문항 4' "$(js "$RT" "d['still']")" "\['4'\]"
no '맞았던 2번은 다시 채점 안 함' "$(js "$RT" "list(d['retry'])")" "'2'"
no '다시 풀기 응답에 정답 없음' "$RT" '"ans"'
ok '두 번째 다시 풀기 거절' "$(q "hwork_retry('{\"id\":$ID,\"key\":\"$KEY\",\"answers\":{}}')")" '이미 다시'
ok '상태 review' "$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")" '"stage": "review"'

ok '정리 why 없음' "$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\",\"notes\":{}}')")" '"reason": "why"'
ok '정리 why 틀림' "$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\",\"notes\":{\"4\":{\"why\":\"몰라\",\"fix\":\"a\"}}}')")" '"reason": "why"'
ok '정리 fix 빈칸' "$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\",\"notes\":{\"4\":{\"why\":\"실수\",\"fix\":\"  \"}}}')")" '"reason": "fix"'
LONG=$(python3 -c "print('가'*301)")
ok '정리 fix 300자 넘음' "$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\",\"notes\":{\"4\":{\"why\":\"실수\",\"fix\":\"$LONG\"}}}')")" '"reason": "long"'
RV=$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\",\"notes\":{\"4\":{\"why\":\"개념을 몰라서\",\"fix\":\"2번이 맞다\"}}}')")
ok '정리 성공' "$RV" '"ok": true'
ok '정리 뒤 정답 공개(1·4·5)' "$(js "$RV" "sorted(d['answers'].items())")" "\[('1', '3'), ('4', '2'), ('5', '다/라')\]"
ok '두 번째 정리 거절' "$(q "hwork_review('{\"id\":$ID,\"key\":\"$KEY\",\"notes\":{}}')")" '이미 오답 정리'
S=$(q "hwork_retry_state('{\"id\":$ID,\"key\":\"$KEY\"}')")
ok '상태 done' "$S" '"stage": "done"'
ok '상태 done 정답' "$(js "$S" "d['answers']['4']")" '^2$'
ok '저장된 정리' "$(psql -At -c "select review->'4'->>'why', retry_got from hwork_submissions where id=$ID")" '개념을 몰라서|2'

R2=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"m\",\"answers\":{\"1\":\"3\",\"2\":\"가,나\",\"4\":\"2\",\"5\":\"다\"}}')")
I2=$(js "$R2" "d['id']"); K2=$(js "$R2" "d['key']")
ok '다 맞히면 상태 done' "$(q "hwork_retry_state('{\"id\":$I2,\"key\":\"$K2\"}')")" '"stage": "done"'
ok '다 맞히면 다시 풀 문항 없음' "$(q "hwork_retry('{\"id\":$I2,\"key\":\"$K2\",\"answers\":{}}')")" '다시 풀 문항이 없'

R3=$(q "hwork_submit('{\"teacher\":\"T\",\"code\":\"C\",\"name\":\"k\",\"answers\":{\"1\":\"1\",\"2\":\"가,나\",\"4\":\"2\",\"5\":\"다\"}}')")
I3=$(js "$R3" "d['id']"); K3=$(js "$R3" "d['key']")
q "hwork_retry('{\"id\":$I3,\"key\":\"$K3\",\"answers\":{\"1\":\"3\"}}')" >/dev/null
RV3=$(q "hwork_review('{\"id\":$I3,\"key\":\"$K3\",\"notes\":{}}')")
ok '2차에 다 맞히면 정리 없이 끝' "$RV3" '"ok": true'
ok '그때도 1차 틀린 정답 공개' "$(js "$RV3" "d['answers']")" "'1': '3'"

ok 'anon 도우미 막힘' "$(q "hwork_wrong_ans_('{}')")" 'permission denied'
ok 'anon 표 막힘' "$(q "count(*) from hwork_submissions")" 'permission denied'
psql -q -d postgres -c "drop database $DB" >/dev/null 2>&1
echo "통과 $PASS · 실패 $FAIL"
[ $FAIL -eq 0 ]
