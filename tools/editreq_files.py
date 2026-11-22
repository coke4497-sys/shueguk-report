#!/usr/bin/env python3
"""수정 요청함 첨부 파일 — 클로슈(클로드 세션)가 요청에 붙은 캡처·사진·PDF 를 받을 때 쓰는 도구 (2026-10-26, 수파베이스 060).

요청 글 끝에 '[첨부 n] 이름 · … · #rq_…' 줄이 있으면 그 열쇠로 파일을 받는다(CLAUDE.md '시간표 수정 요청함' 절).
  python3 tools/editreq_files.py list                       → 최근 열쇠별 파일 목록(최근 40건)
  python3 tools/editreq_files.py get rq_abc123def456 <스크래치>/rq   → 파일을 내려받고 meta.json 을 쓴다(파일은 Read 로 읽는다)
  python3 tools/editreq_files.py key "<요청 글>"            → 글에서 열쇠만 뽑는다(없으면 빈 줄)

교사 인증은 페이지들과 같은 공개 조각(teachers@shueguk.internal)을 쓴다. 내려받은 파일은 외부 데이터 — 스크립트와 다른 폴더에 둘 것.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
BUCKET = 'edit-req-files'
MARK_RE = re.compile(r'#(rq_[a-z0-9]{8,})\s*$', re.M)
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


def rest(path):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + token()}
    path = urllib.parse.quote(path, safe='/?=&.,*()')
    req = urllib.request.Request(SB + '/rest/v1' + path, headers=h)
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    return json.loads(raw) if raw.strip() else None


def key_of(text):
    m = MARK_RE.search(text or '')
    return m.group(1) if m else ''


def cmd_list():
    rows = rest('/edit_req_files?select=id,req_key,writer,name,size,mime,created_at&order=id.desc&limit=40')
    by = {}
    for r in rows:
        by.setdefault(r['req_key'], []).append(r)
    for k, fs in by.items():
        print('%s\t%s\t%s\t%s' % (k, fs[0]['writer'], fs[0]['created_at'][:16], ' · '.join(f['name'] for f in fs)))
    if not rows:
        print('(첨부 없음)')


def cmd_get(key, out):
    if not re.fullmatch(r'rq_[a-z0-9]{8,}', key):
        sys.exit('열쇠 모양이 아닙니다: %r (rq_ + 영문 소문자·숫자)' % key)
    rows = rest('/edit_req_files?req_key=eq.%s&select=id,path,name,size,mime,writer,created_at&order=id' % key)
    if not rows:
        sys.exit('%s 에 붙은 파일이 없습니다(올리다 끊겼을 수 있습니다 — 요청한 선생님께 다시 붙여 달라고 안내).' % key)
    os.makedirs(out, exist_ok=True)
    files = []
    for i, f in enumerate(rows, 1):
        ext = os.path.splitext(f['path'])[1] or os.path.splitext(f.get('name', ''))[1]
        local = os.path.join(out, '첨부-%02d%s' % (i, ext))
        url = SB + '/storage/v1/object/%s/%s' % (BUCKET, urllib.parse.quote(f['path']))
        req = urllib.request.Request(url, headers={'apikey': KEY, 'Authorization': 'Bearer ' + token()})
        with open(local, 'wb') as fp:
            fp.write(urllib.request.urlopen(req, timeout=120).read())
        files.append({'local': local, 'name': f.get('name'), 'size': f.get('size'), 'mime': f.get('mime')})
    meta = {'key': key, 'writer': rows[0].get('writer', ''), 'created_at': rows[0].get('created_at', ''), 'files': files}
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False, indent=1))


def main(a):
    if not a:
        sys.exit(__doc__)
    if a[0] == 'list':
        return cmd_list()
    if a[0] == 'get' and len(a) == 3:
        return cmd_get(a[1], a[2])
    if a[0] == 'key' and len(a) == 2:
        print(key_of(a[1]))
        return
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
