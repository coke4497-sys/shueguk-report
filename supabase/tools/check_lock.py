#!/usr/bin/env python3
"""공개 키가 실제로 잠겼는지 확인하는 도구 (2026-08-25).

  python3 check_lock.py           # 지금 상태 점검
  python3 check_lock.py --before  # 잠그기 전 점검(아직 열려 있는 게 정상)

무엇을 보나:
  1) 공개 키로 표를 직접 읽을 수 있는가  → 잠근 뒤에는 **막혀야** 한다
  2) 공개 키로 학생 화면용 함수를 부를 수 있는가 → 항상 **되어야** 한다
  3) 교사 신분으로 표를 읽을 수 있는가 → 항상 **되어야** 한다

세 가지가 다 기대대로여야 통과다. 하나라도 어긋나면 무엇이 어긋났는지 찍는다.
"""
import sys, json, ssl, os, urllib.request, urllib.error

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID = 'teachers@shueguk.internal'
T_PW = 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'   # 비밀 아님 — 공개된 교사용 페이지에 그대로 있음

def ctx():
    ca = os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt'
    return ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)
CTX = ctx()

def call(path, headers, method='GET', body=None):
    req = urllib.request.Request(SB + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers)
    try:
        with urllib.request.urlopen(req, context=CTX) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def anon_h(extra=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
    if extra: h.update(extra)
    return h

def teacher_token():
    st, body = call('/auth/v1/token?grant_type=password',
                    {'apikey': KEY, 'Content-Type': 'application/json'}, 'POST',
                    {'email': T_ID, 'password': T_PW})
    if st != 200: return None
    return json.loads(body).get('access_token')

TABLES = ['students', 'attendance', 'submissions', 'voca_results', 'hwork_submissions',
          'omr_responses', 'clinic_requests', 'signup_entries', 'notice_reads', 'star_bonus',
          'hwcheck_records', 'tt_classes', 'tt_log', 'exams', 'exam_questions']

def main():
    before = '--before' in sys.argv
    want_open = before          # 잠그기 전이면 열려 있는 게 정상
    ok = True

    print('① 공개 키로 표 직접 읽기 —', '열려 있어야 정상(잠그기 전)' if want_open else '막혀야 정상')
    opened = []
    for t in TABLES:
        st, _ = call(f'/rest/v1/{t}?select=*&limit=1', anon_h())
        if st == 200: opened.append(t)
    if want_open:
        print(f'   열린 표 {len(opened)}/{len(TABLES)}')
    else:
        if opened:
            ok = False
            print(f'   ✗ 아직 열려 있음: {", ".join(opened)}')
        else:
            print(f'   ✓ {len(TABLES)}개 표 전부 막힘')

    print('② 공개 키로 학생 화면 함수 부르기 — 항상 되어야 정상')
    checks = [('student_bundle', {'p_key': 'ZZ없는코드', 'p_is_id': False, 'p_pw': ''}),
              ('exam_bundle',    {'p_report_id': 'ZZ없음'}),
              ('star_top30',     {})]
    for fn, args in checks:
        st, body = call(f'/rest/v1/rpc/{fn}', anon_h(), 'POST', args)
        mark = '✓' if st == 200 else '✗'
        if st != 200: ok = False
        print(f'   {mark} {fn}: HTTP {st}' + ('' if st == 200 else ' ' + body[:120].decode('utf-8', 'replace')))

    print('③ 교사 신분으로 표 읽기 — 항상 되어야 정상')
    tk = teacher_token()
    if not tk:
        ok = False
        print('   ✗ 교사 신분 인증 실패')
    else:
        h = {'apikey': KEY, 'Authorization': 'Bearer ' + tk}
        bad = [t for t in TABLES if call(f'/rest/v1/{t}?select=*&limit=1', h)[0] != 200]
        if bad:
            ok = False
            print(f'   ✗ 못 읽는 표: {", ".join(bad)}')
        else:
            print(f'   ✓ {len(TABLES)}개 표 전부 읽힘')

    print()
    print('결과:', '통과' if ok else '문제 있음 — 위 ✗ 항목을 볼 것')
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
