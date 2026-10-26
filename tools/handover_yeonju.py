#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
정연주T 퇴사(2026-11-06) · 고3 종강(2026-11-06) 시간표 인수인계 — 2026-11-07부터 적용.
(2026-10-26 원장님 "정연주 선생님은 11/6일자로 퇴사, 현 고3도 11/6자로 종강. 정연주 선생님의
 모든 수업을 11/7일부터 내가(슈T) 진행하게 돼. 그에 맞게 시간표를 수정해줘.")

하는 일(apply):
  ① tt_classes — 담당T '연주'인 정규(r###)·내신(n###) 반 전부 → 담당T '슈'. 요일·시간·위치(민트초코)는 그대로.
     tt_log '반이동' 한 줄씩(2026-09-07 담당T 변경 기록과 같은 형식) + 시트 사본(백엔드 timetableMoveClass).
  ② tt_classes — 반이름에 '고3파이널'이 든 정규·내신 반(슈T, 11/6 종강) 삭제. 명단은 tt_log '반삭제' 사유에 남긴다.
     시트 사본은 학생이 남은 반을 지우지 못해(백엔드 규칙) 그대로 둔다 — 일일 점검이 '시트에만 있는 행'으로 보고만 한다.
  ③ students — 담당 '정연주' → '이수경'(수파베이스 먼저 + 시트 '학생정보' 사본 backend updateStudent).
  '이 주만' 반(w…)은 지난 날짜라 손대지 않는다. 출석·수업 기록·학생정보 시간 칸은 건드리지 않는다.

쓰는 법:
  python3 tools/handover_yeonju.py plan      # 바꿀 것 목록만(쓰기 없음)
  python3 tools/handover_yeonju.py apply     # 실제 적용(한국 날짜 2026-11-07 전에는 --force 없이 거절). 다시 돌려도 안전(남은 것만).
  python3 tools/handover_yeonju.py verify    # 남은 것이 없는지 확인(남아 있으면 종료 코드 1)
교사 인증은 tools/class_report.py의 공개 조각(teachers@shueguk.internal)을 그대로 쓴다.
"""
import sys, os, re, json, time, datetime, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from class_report import rest, q  # noqa: E402

APPLY_FROM = datetime.date(2026, 11, 7)
OLD_T, NEW_T = '연주', '슈'
OLD_NAME, NEW_NAME = '정연주', '이수경'
G3_RE = re.compile(r'고3파이널')
FIXED_RE = re.compile(r'^[rn]\d{3,4}$')
ENDPOINT = 'https://script.google.com/macros/s/AKfycbzhCncBwn-JlqXARC3wfrWUCuNHzlNK2df0bdhx-w78Xr8mzYUcIYZOJdRi9N4bHtsb/exec'
PW = 'sh'
AUTHOR = '클로슈'
REASON_T = '담당T 변경 연주T → 슈T (정연주T 11/6 퇴사 · 11/7부터 · 원장님 지시 10/26)'
REASON_G3 = '고3 11/6 종강 — 11/7부터 시간표에서 뺌 (원장님 지시 10/26)'


def kst_today():
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).date()


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ')


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def legacy_post(body):
    """앱스스크립트 POST — 302 Location을 직접 따라가 결과 JSON을 받는다(POST가 GET으로 바뀌어도 결과는 그 주소에 있다)."""
    body = dict(body); body['pw'] = PW
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(ENDPOINT, method='POST', data=data,
                                 headers={'Content-Type': 'text/plain;charset=utf-8'})
    opener = urllib.request.build_opener(_NoRedirect)
    loc = None
    try:
        r = opener.open(req, timeout=60)
        raw = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307):
            loc = e.headers.get('Location')
        else:
            raise
    if loc:
        raw = urllib.request.urlopen(urllib.request.Request(loc), timeout=60).read().decode('utf-8', 'replace')
    try:
        return json.loads(raw)
    except Exception:
        return {'result': 'error', 'message': raw[:200]}


def legacy_retry(body, tries=3):
    last = None
    for i in range(tries):
        try:
            res = legacy_post(body)
            if res.get('result') == 'success':
                return res
            last = res
        except Exception as e:  # 네트워크·HTML 오류 페이지
            last = {'result': 'error', 'message': str(e)}
        time.sleep(4)
    return last


def classes():
    return rest('GET', '/tt_classes?select=id,book,class_id,day,start_time,end_time,location,teacher,name,roster&order=book,class_id')


def targets():
    cs = classes()
    yj = [c for c in cs if FIXED_RE.match(c['class_id']) and (c['teacher'] or '').strip() == OLD_T]
    g3 = [c for c in cs if FIXED_RE.match(c['class_id']) and G3_RE.search(c['name'] or '')]
    st = rest('GET', '/students?select=id,code,name,school,grade,teacher,memo,class_a,class_b,naeshin_a,naeshin_b,enrolled&teacher=eq.' + q(OLD_NAME) + '&order=name')
    return yj, g3, st


def n_roster(c):
    return len((c.get('roster') or '').split())


def label(c, t=None):
    s = '%s (%s%s' % (c['name'], c['day'], c['start_time'])
    return s + (' · %sT)' % t if t else ')')


def show(yj, g3, st):
    print('① 담당T 연주 → 슈: %d개 반' % len(yj))
    for c in yj:
        print('   %s %s %s %s~%s %s %s (%d명)' % (c['book'], c['class_id'], c['day'], c['start_time'], c['end_time'], c['location'], c['name'], n_roster(c)))
    print('② 고3파이널 삭제: %d개 반' % len(g3))
    for c in g3:
        print('   %s %s %s %s~%s %s %s (%d명)' % (c['book'], c['class_id'], c['day'], c['start_time'], c['end_time'], c['teacher'], c['name'], n_roster(c)))
    print('③ 학생정보 담당 정연주 → 이수경: %d명' % len(st))
    print('   ' + ', '.join('%s(%s)' % (s['name'], s['school']) for s in st))


def apply(force=False):
    if kst_today() < APPLY_FROM and not force:
        print('아직 %s 전입니다(한국 날짜 %s). 미리 적용하려면 --force.' % (APPLY_FROM, kst_today())); sys.exit(2)
    yj, g3, st = targets()
    show(yj, g3, st)
    if not (yj or g3 or st):
        print('바꿀 것이 없습니다(이미 적용됨).'); return
    bak = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.handover_backup_%s.json' % now_iso().replace(':', ''))
    bak = os.path.abspath(bak)
    with open(bak, 'w', encoding='utf-8') as f:
        json.dump({'classes_teacher': yj, 'classes_deleted': g3, 'students': st}, f, ensure_ascii=False, indent=1)
    print('백업: %s (저장소에 커밋하지 말 것 — 학생 이름이 들어 있다)' % bak)

    # ① 담당T
    for c in yj:
        path = '/tt_classes?book=eq.%s&class_id=eq.%s&teacher=eq.%s' % (q(c['book']), q(c['class_id']), q(OLD_T))
        res = rest('PATCH', path, {'teacher': NEW_T}, prefer='return=representation')
        if not res:
            print('   ! %s %s 담당T 바뀌지 않음(그 사이 바뀜?)' % (c['book'], c['class_id'])); continue
        rest('POST', '/tt_log', {'at': now_iso(), 'kind': '반이동', 'student': '(반 전체 %d명)' % n_roster(c), 'book': c['book'],
                                 'from_class_id': c['class_id'], 'from_class': label(c, OLD_T),
                                 'to_class_id': c['class_id'], 'to_class': label(c, NEW_T),
                                 'reason': REASON_T, 'apply_date': None, 'author': AUTHOR}, prefer='return=minimal')
        lg = legacy_retry({'action': 'timetableMoveClass', 'book': c['book'], 'classId': c['class_id'], 'day': c['day'],
                           'start': c['start_time'], 'end': c['end_time'], 'loc': c['location'] or '', 'teacher': NEW_T,
                           'reason': REASON_T})
        print('   ✓ %s %s 담당T 슈 · 시트 사본 %s' % (c['book'], c['class_id'], (lg or {}).get('result'), ))
        if (lg or {}).get('result') != 'success':
            print('     시트 사본 응답: %s' % json.dumps(lg, ensure_ascii=False)[:200])

    # ② 고3파이널 삭제
    for c in g3:
        path = '/tt_classes?book=eq.%s&class_id=eq.%s&name=like.%s' % (q(c['book']), q(c['class_id']), q('*고3파이널*'))
        res = rest('DELETE', path, prefer='return=representation')
        if not res:
            print('   ! %s %s 지워지지 않음' % (c['book'], c['class_id'])); continue
        rest('POST', '/tt_log', {'at': now_iso(), 'kind': '반삭제', 'student': '(고3 종강 · %d명)' % n_roster(c), 'book': c['book'],
                                 'from_class_id': c['class_id'], 'from_class': label(c, c['teacher']),
                                 'to_class_id': '', 'to_class': '',
                                 'reason': REASON_G3 + ' · 명단: ' + (c.get('roster') or ''), 'apply_date': None, 'author': AUTHOR},
             prefer='return=minimal')
        print('   ✓ %s %s %s 삭제' % (c['book'], c['class_id'], c['name']))

    # ③ 학생정보 담당
    for s in st:
        res = rest('PATCH', '/students?id=eq.%s&teacher=eq.%s' % (s['id'], q(OLD_NAME)), {'teacher': NEW_NAME}, prefer='return=representation')
        if not res:
            print('   ! %s 담당 바뀌지 않음' % s['name']); continue
        lg = {'result': 'skip(접근코드 없음)'}
        if s.get('code'):
            lg = legacy_retry({'action': 'updateStudent', 'code': s['code'], 'school': s['school'] or '', 'grade': s['grade'] or '',
                               'teacher': NEW_NAME, 'memo': s.get('memo') or '', 'classA': s.get('class_a') or '',
                               'classB': s.get('class_b') or '', 'progress': s.get('naeshin_a') or '', 'checkup': s.get('naeshin_b') or ''})
        print('   ✓ %s 담당 이수경 · 시트 사본 %s' % (s['name'], (lg or {}).get('result')))
    print('적용 끝.')


def verify():
    yj, g3, st = targets()
    left = len(yj) + len(g3) + len(st)
    print('남은 것 — 연주 반 %d · 고3파이널 반 %d · 담당 정연주 %d' % (len(yj), len(g3), len(st)))
    if left:
        show(yj, g3, st); sys.exit(1)
    cs = classes()
    mine = [c for c in cs if FIXED_RE.match(c['class_id']) and c['teacher'] == NEW_T]
    print('슈T 반(정규·내신): %d개' % len(mine))
    for c in mine:
        print('   %s %s %s %s~%s %s %s (%d명)' % (c['book'], c['class_id'], c['day'], c['start_time'], c['end_time'], c['location'], c['name'], n_roster(c)))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'plan'
    if cmd == 'plan':
        show(*targets())
    elif cmd == 'apply':
        apply('--force' in sys.argv)
    elif cmd == 'verify':
        verify()
    else:
        print(__doc__)
