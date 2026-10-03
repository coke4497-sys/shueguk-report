#!/usr/bin/env python3
"""지필 리포트 자동 생성 — 클로슈(클로드 세션)가 시험지·정답지로 리포트 초안을 만들 때 쓰는 도구 (2026-09-29, 수파베이스 036).

흐름(CLAUDE.md '지필 리포트 자동 생성' 절):
  1) python3 tools/exam_draft.py pending
       → 초안 요청(status '요청') 목록
  2) python3 tools/exam_draft.py get 12 <스크래치>/d12
       → 올린 파일(시험지·정답지, 사진·PDF)을 내려받고 meta.json(제목·범위·메모·파일 순서)을 쓴다
  3) 클로슈가 파일을 읽고 draft.json 을 쓴다
       {"text","answers":[{"no","ans"}],"scope","review":[문단],"questions":[{no,group,area,detail,type,lv,txt,multi}],"notes":[…]}
  4) python3 tools/exam_draft.py put 12 draft.json      → 형식 검사 뒤 저장, status '완료'
     python3 tools/exam_draft.py check draft.json       → 저장하지 않고 형식 검사만
     못 만들면: python3 tools/exam_draft.py hold 12 "이유"
  5) python3 tools/exam_draft.py show 12                → 저장된 초안 확인

영역·세부유형·형식·난이도 목록은 m.html(AREA_OPTS·SUBTYPES·FORM_OPTS·LV_OPTS)과 두 벌이다 — 고치면 함께.
교사 인증은 페이지들과 같은 공개 조각(teachers@shueguk.internal)을 쓴다.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
BUCKET = 'exam-drafts'

AREAS = ['문학', '독서', '화법', '작문', '문법']
SUBTYPES = {
    '문학': ['현대시', '현대소설', '고전시가', '고전소설', '수필', '극', '갈래복합'],
    '독서': ['인문', '사회', '예술', '과학기술'],
    '화법': [],
    '작문': [],
    '문법': ['음운', '형태소', '단어', '문장', '문법요소', '국어사', '한글 맞춤법'],
}
FORMS = ['객관식', '서술형']
LEVELS = ['중', '중상', '상', '최상']
_tok = None
BOGI_RE = re.compile(r'[<〈]\s*보기\s*[>〉]')


def txt_patterns():
    """문항 내용 드롭다운 목록 — m.html 의 TXT_COMMON·TXT_READ·TXT_WRITE·TXT_LIT 를 그대로 읽는다(한 벌만 유지)."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'm.html'), encoding='utf-8').read()
    out = []
    for name in ('TXT_COMMON', 'TXT_READ', 'TXT_WRITE', 'TXT_LIT'):
        m = re.search(r'var %s = \[(.*?)\];' % name, src, re.S)
        if not m:
            raise SystemExit('m.html 에서 %s 목록을 찾지 못했습니다' % name)
        out += re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))
    return out


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
    path = urllib.parse.quote(path, safe='/?=&.,*()')  # 한글 값(status=eq.요청 등)을 그대로 넣으면 urllib 가 ascii 오류를 낸다
    req = urllib.request.Request(SB + '/rest/v1' + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    return json.loads(raw) if raw.strip() else None


def row_of(did):
    rows = rest('GET', '/exam_drafts?id=eq.%d&select=*' % int(did))
    if not rows:
        sys.exit('초안 요청 d%s 이 없습니다.' % did)
    return rows[0]


def validate(d):
    """초안 형식 검사 — 문제 목록을 돌려준다(빈 목록이면 통과)."""
    errs = []
    if not isinstance(d, dict):
        return ['초안이 객체가 아닙니다']
    for k in ('text', 'scope'):
        if not isinstance(d.get(k, ''), str):
            errs.append('%s 는 문자열이어야 합니다' % k)
    if not isinstance(d.get('review'), list) or not all(isinstance(p, str) and p.strip() for p in d.get('review') or []):
        errs.append('review 는 빈 문단 없는 문자열 목록이어야 합니다')
    if not isinstance(d.get('notes', []), list):
        errs.append('notes 는 목록이어야 합니다')
    for a in d.get('answers', []) or []:
        if not isinstance(a, dict) or 'no' not in a or 'ans' not in a:
            errs.append('answers 항목은 {no, ans} 입니다: %r' % (a,))
    qs = d.get('questions')
    if not isinstance(qs, list) or not qs:
        return errs + ['questions 가 비어 있습니다']
    pats = set(txt_patterns())
    seen, groups, last = set(), {}, None
    for i, q in enumerate(qs):
        at = '%s번' % q.get('no', '?(%d)' % (i + 1))
        no = str(q.get('no', '')).strip()
        if not no:
            errs.append('%d번째 문항에 번호가 없습니다' % (i + 1))
        elif no in seen:
            errs.append('%s 이 두 번 나옵니다' % at)
        seen.add(no)
        area, det = q.get('area', ''), q.get('detail', '')
        if area not in AREAS:
            errs.append('%s 영역 %r 은 목록(%s)에 없습니다' % (at, area, '·'.join(AREAS)))
        elif det and det not in SUBTYPES[area]:
            errs.append('%s 세부유형 %r 은 %s 목록에 없습니다' % (at, det, area))
        elif not det and SUBTYPES[area]:
            errs.append('%s 세부유형이 비어 있습니다(%s)' % (at, area))
        if q.get('type', '객관식') not in FORMS:
            errs.append('%s 형식 %r' % (at, q.get('type')))
        if q.get('lv') not in LEVELS:
            errs.append('%s 난이도 %r 은 %s 중 하나여야 합니다' % (at, q.get('lv'), '·'.join(LEVELS)))
        txt = str(q.get('txt', '')).strip()
        parts = re.split(r'\n?\s*[<〈]\s*보기\s*[>〉]\s*:\s*', txt, maxsplit=1)
        base = parts[0].strip()
        if not base:
            errs.append('%s 문항 내용이 비어 있습니다' % at)
        elif base not in pats:
            errs.append('%s 문항 내용 %r 은 m.html 드롭다운 목록에 없습니다 — 목록 값으로 쓰거나, 필요한 유형이면 목록에 추가할 것' % (at, base))
        if len(parts) > 1 and not BOGI_RE.search(base):
            errs.append('%s <보기> 꼬리표는 유형명에 <보기>가 든 문항에만 붙일 수 있습니다' % at)
        g = str(q.get('group', '')).strip()
        if g:
            if g in groups and last != g:
                errs.append('지문 묶음 %r 이 떨어져 있습니다(%s) — 묶음 문항은 이어서 적을 것' % (g, at))
            if g in groups and groups[g] != (area, det):
                errs.append('지문 묶음 %r 안에서 영역·세부유형이 다릅니다(%s) — 화면은 첫 문항 것만 읽으니 묶음을 나눌 것' % (g, at))
            groups.setdefault(g, (area, det))
        last = g
    return errs


def cmd_pending():
    rows = rest('GET', '/exam_drafts?status=eq.요청&select=id,title,files,created_at&order=id')
    for r in rows:
        print('d%d\t%s\t파일 %d개\t%s' % (r['id'], r['title'], len(r.get('files') or []), r['created_at'][:16]))
    if not rows:
        print('(요청 없음)')


def cmd_get(did, out):
    r = row_of(did)
    os.makedirs(out, exist_ok=True)
    files, n = [], {'시험지': 0, '정답지': 0}
    for f in r.get('files') or []:
        kind = f.get('kind') or '시험지'
        n[kind] = n.get(kind, 0) + 1
        ext = os.path.splitext(f['path'])[1] or os.path.splitext(f.get('name', ''))[1]
        local = os.path.join(out, '%s-%02d%s' % (kind, n[kind], ext))
        url = SB + '/storage/v1/object/%s/%s' % (BUCKET, urllib.parse.quote(f['path']))
        req = urllib.request.Request(url, headers={'apikey': KEY, 'Authorization': 'Bearer ' + token()})
        with open(local, 'wb') as fp:
            fp.write(urllib.request.urlopen(req, timeout=120).read())
        files.append({'local': local, 'kind': kind, 'name': f.get('name'), 'size': f.get('size'), 'mime': f.get('mime')})
    meta = {k: r.get(k) for k in ('id', 'title', 'period', 'school', 'grade', 'subject', 'scope', 'memo', 'status')}
    meta['files'] = files
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False, indent=1))


def load(path):
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def cmd_check(path):
    errs = validate(load(path))
    for e in errs:
        print('✗', e)
    print('통과' if not errs else '문제 %d건' % len(errs))
    return not errs


def cmd_put(did, path):
    d = load(path)
    errs = validate(d)
    if errs:
        for e in errs:
            print('✗', e)
        sys.exit('형식 문제가 있어 저장하지 않았습니다.')
    note = '초안을 만들어 두었어요. [리포트 만들기]를 눌러 확인해 주세요.'
    if d.get('notes'):
        note += ' 확인할 점 %d개가 있어요.' % len(d['notes'])
    rest('PATCH', '/exam_drafts?id=eq.%d' % int(did),
         {'draft': d, 'status': '완료', 'note': note, 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat()},
         'return=minimal')
    print('저장했습니다 — d%s 문항 %d개' % (did, len(d['questions'])))


def cmd_hold(did, reason):
    rest('PATCH', '/exam_drafts?id=eq.%d' % int(did),
         {'status': '보류', 'note': reason, 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat()}, 'return=minimal')
    print('보류로 표시했습니다 — d%s' % did)


def cmd_show(did):
    r = row_of(did)
    print(json.dumps({k: r.get(k) for k in ('id', 'title', 'status', 'note', 'report_id', 'draft')}, ensure_ascii=False, indent=1))


def main(a):
    if not a:
        sys.exit(__doc__)
    c = a[0]
    if c == 'pending':
        cmd_pending()
    elif c == 'get' and len(a) == 3:
        cmd_get(a[1].lstrip('d'), a[2])
    elif c == 'check' and len(a) == 2:
        sys.exit(0 if cmd_check(a[1]) else 1)
    elif c == 'put' and len(a) == 3:
        cmd_put(a[1].lstrip('d'), a[2])
    elif c == 'hold' and len(a) == 3:
        cmd_hold(a[1].lstrip('d'), a[2])
    elif c == 'show' and len(a) == 2:
        cmd_show(a[1].lstrip('d'))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
