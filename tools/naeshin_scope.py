#!/usr/bin/env python3
"""내신 시험 범위 기록 — 수정 요청함 화면 '내신 시험 범위' 건을 클로슈(클로드 세션)가 naeshin_records 에 넣을 때 쓰는 도구 (2026-10-26).

범위 기록은 내신대비 피드백(naeshin.html)·수업 기록 창(timetable.html 내신 진도·확인 수업)·지필 리포트 자동 생성(m.html)이 함께 읽는
naeshin_records (period, class_key='공유:고1|화정', kind='범위', week='', student='') 한 줄이다.
  text1 = {"book","inRange","extra","outRange"} JSON(줄바꿈으로 항목 구분 — inRange 한 줄 = 진도 고르기 단원 하나), text2 = 읽기용 글.

  python3 tools/naeshin_scope.py keys                      → 내신 시간표 반이름에서 나오는 공유 키 목록(고1 화정 · 교과서)
  python3 tools/naeshin_scope.py show 26-2-기말 공유:고1|화정   → 지금 저장된 범위
  python3 tools/naeshin_scope.py put 26-2-기말 공유:고1|화정 scope.json
       scope.json = {"book": "천재수 공통국어2", "inRange": ["2(1) 청산별곡", "2(2) 속미인곡"], "outRange": ["학습지 프린트"], "extra": []}
       (inRange·outRange·extra 는 목록 또는 줄바꿈 글 — 비면 빈 값, 모두 비면 거절)
  python3 tools/naeshin_scope.py put ... --merge           → 기존 기록에 새 항목을 더한다(같은 줄은 한 번만, 교과서는 새 값 우선)
  python3 tools/naeshin_scope.py toc 고1 화정 [천재수 공통국어2]  → 그 학년·학교(·교과서 글)에 맞는 교과서 목차(textbook-toc.json) — 교과서 내 범위 줄은 이 label 을 그대로 쓴다
교과서 내 범위(inRange)는 2026-10-26부터 화면이 목차(textbook-toc.json, 2022 개정 중1·중2·고1·고2)에서 골라 넣는다 — put 할 때도 같은 label 을 쓰고,
목록에 없는 줄이 있으면 경고만 한다(중3·고3은 목록이 없어 자유 글).
수파베이스에 먼저 쓰고 시트 사본('내신기록' 탭)은 백엔드 naeshinSet 으로 뒤에서(실패해도 원본은 저장됨). 교사 인증은 공개 조각.
"""
import json
import re
import sys
import urllib.parse
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
ENDPOINT = 'https://script.google.com/macros/s/AKfycbzhCncBwn-JlqXARC3wfrWUCuNHzlNK2df0bdhx-w78Xr8mzYUcIYZOJdRi9N4bHtsb/exec'
PW = 'sh'
KEY_RE = re.compile(r'^공유:[중고][1-3]\|[가-힣]{2,}$')
PERIOD_RE = re.compile(r'^\d\d-[12]-(중간|기말)$')
FULL = {'화언': '화법과 언어', '독작': '독서와 작문', '언매': '언어와 매체', '화작': '화법과 작문', '문영': '문학과 영상', '매체': '매체 의사소통'}
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
    path = urllib.parse.quote(path, safe='/?=&.,*()')
    req = urllib.request.Request(SB + '/rest/v1' + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    return json.loads(raw) if raw.strip() else None


def lines(v):
    if isinstance(v, list):
        items = [str(x).strip() for x in v]
    else:
        items = [x.strip() for x in str(v or '').split('\n')]
    return [x for x in items if x]


def readable(sp):
    pairs = [('교과서', sp.get('book', '')), ('교과서 내 범위', '\n'.join(lines(sp.get('inRange')))),
             ('교과서 외 범위', '\n'.join(lines(sp.get('outRange')))), ('추가 자료', '\n'.join(lines(sp.get('extra'))))]
    return '\n'.join('%s: %s' % (k, v) for k, v in pairs if v)


def parse(row):
    if not row:
        return None
    t1 = str(row.get('text1') or '')
    if t1.lstrip().startswith('{'):
        try:
            return json.loads(t1)
        except ValueError:
            pass
    return {'inRange': row.get('text2') or t1} if (row.get('text2') or t1) else None


def default_book(cls):
    m = re.search(r'\((.+)\)\s*$', cls or '')
    if not m:
        return ''
    return ' '.join(FULL.get(w, w) for w in m.group(1).strip().split('·')[0].strip().split())


def cmd_keys():
    rows = rest('GET', '/tt_classes?book=eq.내신&class_id=not.like.w*&select=name&order=class_id')
    by = {}
    for r in rows:
        m = re.match(r'^([중고][1-3])\s+([가-힣]+)', r['name'] or '')
        if not m or m.group(2) == '확인':
            continue
        k = '공유:%s|%s' % (m.group(1), m.group(2))
        by.setdefault(k, default_book(r['name']))
        by[k] = by[k] or default_book(r['name'])
    for k in sorted(by):
        print('%s\t%s' % (k, by[k]))


def fetch(period, key):
    rows = rest('GET', '/naeshin_records?period=eq.%s&class_key=eq.%s&kind=eq.범위&student=eq.&select=text1,text2,at' % (period, key))
    return rows[0] if rows else None


TOC_PATH = __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', 'textbook-toc.json')
_toc = None


def toc():
    global _toc
    if _toc is None:
        with open(TOC_PATH, encoding='utf-8') as fp:
            _toc = json.load(fp)
    return _toc


def toc_books(grade, school='', text=''):
    """textbook-toc.js match 와 같은 뜻의 단순판 — 학년 책 중 출판사·책 이름·학교가 맞는 것부터"""
    t = re.sub(r'\s+', '', text or '')
    pubs = ['미래엔', '지학사', '천재', '비상', '해냄', '창비', '지학', '동아', '미래']
    pub = next((('지학사' if p == '지학' else '미래엔' if p == '미래' else p) for p in pubs if p in t), '')
    out = []
    for b in toc()['books']:
        if grade and b['grade'] != grade:
            continue
        sc = 0
        if pub and b['pub'] == pub:
            sc += 3
        if re.sub(r'\s+', '', b['name']) in t or any(re.sub(r'\s+', '', v) == re.sub(r'\s+', '', b['name']) for k, v in FULL.items() if k in t):
            sc += 4
        if school and any(x.startswith(school) for x in b['schools']):
            sc += 2
        out.append((sc, b))
    out.sort(key=lambda x: -x[0])
    return out


def cmd_toc(grade, school, text=''):
    for sc, b in toc_books(grade, school, text)[:3]:
        print('== %s %s (%s · 점수 %d)' % (b['id'], b['label'], ', '.join(b['schools']), sc))
        for it in b['items']:
            print('   ' + it['label'])


def cmd_show(period, key):
    r = fetch(period, key)
    print(readable(parse(r)) if r else '(없음)')


def cmd_put(period, key, path, merge=False):
    if not PERIOD_RE.match(period):
        sys.exit('기간은 26-2-기말 꼴이어야 합니다: %r' % period)
    if not KEY_RE.match(key):
        sys.exit("공유 키는 '공유:고1|화정' 꼴이어야 합니다: %r (반 하나만의 범위라면 화면에서 반 ID로 — 이 도구는 공유 키만)" % key)
    with open(path, encoding='utf-8') as fp:
        new = json.load(fp)
    sp = {'book': str(new.get('book', '')).strip(), 'inRange': lines(new.get('inRange')), 'outRange': lines(new.get('outRange')), 'extra': lines(new.get('extra'))}
    if merge:
        old = parse(fetch(period, key)) or {}
        for k in ('inRange', 'outRange', 'extra'):
            have = lines(old.get(k))
            sp[k] = have + [x for x in sp[k] if x not in have]
        sp['book'] = sp['book'] or str(old.get('book', '')).strip()
    # 교과서 내 범위 줄이 목차 label 과 맞는지(화면은 목차에서 고르므로 같은 글자여야 진도 표·클리어가 한 줄로 이어진다)
    try:
        g, sch = key.split(':', 1)[1].split('|')
        labels = {it['label'] for _, b in toc_books(g, sch, sp['book']) for it in b['items']}
        odd = [x for x in sp['inRange'] if x not in labels]
        if odd and labels:
            print('(경고) 목차에 없는 교과서 내 범위 줄 %d개 — `toc %s %s` 로 label 을 확인해 같은 글자로 넣는 것이 좋습니다: %s' % (len(odd), g, sch, ' / '.join(odd[:5])), file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — 목차 파일이 없어도 저장은 한다
        print('(목차 대조 생략: %s)' % e, file=sys.stderr)
    sp = {'book': sp['book'], 'inRange': '\n'.join(sp['inRange']), 'extra': '\n'.join(sp['extra']), 'outRange': '\n'.join(sp['outRange'])}
    text2 = readable(sp)
    if not text2:
        sys.exit('범위가 비어 있습니다(교과서·안 범위·밖 범위 모두 빈 값).')
    body = [{'period': period, 'class_key': key, 'kind': '범위', 'week': '', 'student': '', 'text1': json.dumps(sp, ensure_ascii=False), 'text2': text2,
             'at': __import__('datetime').datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}]
    rest('POST', '/naeshin_records?on_conflict=period,class_key,kind,week,student', body, 'resolution=merge-duplicates,return=minimal')
    # 시트 사본 — naeshin.html·수업 기록 창과 같은 액션(classId 자리에 공유 키)
    try:
        data = json.dumps({'action': 'naeshinSet', 'pw': PW, 'period': period, 'classId': key, 'scopeKey': key, 'kind': '범위',
                           'text1': body[0]['text1'], 'text2': text2}).encode()
        req = urllib.request.Request(ENDPOINT, method='POST', data=data, headers={'Content-Type': 'text/plain;charset=utf-8'})
        urllib.request.urlopen(req, timeout=60).read()
    except Exception as e:  # noqa: BLE001 — 사본 실패는 원본에 영향 없음
        print('(시트 사본 전송 실패 — 원본은 저장됨: %s)' % e, file=sys.stderr)
    print('저장: %s %s\n%s' % (period, key, text2))


def main(a):
    if not a:
        sys.exit(__doc__)
    if a[0] == 'keys':
        return cmd_keys()
    if a[0] == 'toc' and len(a) >= 3:
        return cmd_toc(a[1], a[2], a[3] if len(a) > 3 else '')
    if a[0] == 'show' and len(a) == 3:
        return cmd_show(a[1], a[2])
    if a[0] == 'put' and len(a) >= 4:
        return cmd_put(a[1], a[2], a[3], merge='--merge' in a[4:])
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
