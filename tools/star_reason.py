#!/usr/bin/env python3
"""별 선물 사유 다듬기 — 클로슈 도구 (2026-10-19, 056).

선생님이 슈퍼스타 관리 [별 선물하기]에 적은 사유(키워드·짧은 메모)를 학생 페이지에 보일
단정하고 따뜻한 문장으로 바꿔 star_bonus.reason_nice 에 넣는다. 원문(reason)은 건드리지 않는다.

  python3 tools/star_reason.py list            # 다듬기 전(reason_nice 빈 값) 기록
  python3 tools/star_reason.py show <id>       # 한 건
  python3 tools/star_reason.py put <id> "문장"  # 다듬은 문장 저장
  python3 tools/star_reason.py put-json f.json # [{"id":1,"text":"…"}, …] 한꺼번에

문장 규칙은 리포트 저장소 CLAUDE.md '별 선물 사유 다듬기' 절.
"""
import json
import sys
import urllib.parse
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
COLS = 'id,at,name,school,grade,stars,reason,giver,reason_nice'
MAX_LEN = 120
_tok = None


def token():
    global _tok
    if _tok:
        return _tok
    req = urllib.request.Request(SB + '/auth/v1/token?grant_type=password', method='POST',
                                 data=json.dumps({'email': T_ID, 'password': T_PW}).encode(),
                                 headers={'apikey': KEY, 'Content-Type': 'application/json'})
    _tok = json.load(urllib.request.urlopen(req, timeout=30))['access_token']
    return _tok


def rest(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'}
    if prefer:
        h['Prefer'] = prefer
    req = urllib.request.Request(SB + '/rest/v1' + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    return json.loads(raw) if raw.strip() else None


def check(text):
    t = ' '.join(str(text or '').split())
    if not t:
        raise SystemExit('빈 문장입니다.')
    if len(t) > MAX_LEN:
        raise SystemExit(f'{MAX_LEN}자 이내로 줄여 주세요({len(t)}자): {t}')
    if not t.endswith(('.', '!', '요', '다')):
        raise SystemExit(f'완결 문장으로 끝내 주세요: {t}')
    if '—' in t:
        raise SystemExit(f'긴 가로줄(—)은 쓰지 않습니다: {t}')
    return t


def put(i, text):
    t = check(text)
    rows = rest('PATCH', f'/star_bonus?id=eq.{int(i)}', {'reason_nice': t}, 'return=representation')
    if not rows:
        raise SystemExit(f'id {i} 기록이 없습니다(지워졌을 수 있어요).')
    r = rows[0]
    print(f"저장: b{r['id']} {r['name']} · 원문 {r['reason']!r} → {t}")


def main(a):
    if not a or a[0] == 'list':
        rows = rest('GET', f'/star_bonus?reason_nice=eq.&reason=neq.&order=id&select={COLS}')
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        print(f'다듬기 전 {len(rows)}건', file=sys.stderr)
    elif a[0] == 'show':
        print(json.dumps(rest('GET', f'/star_bonus?id=eq.{int(a[1])}&select={COLS}'), ensure_ascii=False, indent=1))
    elif a[0] == 'put':
        put(a[1], ' '.join(a[2:]))
    elif a[0] == 'put-json':
        items = json.load(open(a[1], encoding='utf-8'))
        for it in items:
            check(it['text'])          # 모두 검사한 뒤 저장
        for it in items:
            put(it['id'], it['text'])
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
