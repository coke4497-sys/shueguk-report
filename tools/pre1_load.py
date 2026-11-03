#!/usr/bin/env python3
"""예비 고1 학교 분석 — 학교별 분석 JSON 을 수파베이스 pre1_schools 에 올린다 (2026-11-03, 061).

분석 글은 학원 자료라 공개 저장소에 두지 않는다 — JSON 은 세션 스크래치패드 같은 저장소 밖에 두고
이 도구로 올린다(교사 계정, 학생은 pre1_list 함수로만 읽음).

  python3 tools/pre1_load.py check a.json b.json …        # 모양·숫자 검사만
  python3 tools/pre1_load.py put a.json b.json …          # 검사 뒤 올리기(파일 순서 = 화면 순서)
  python3 tools/pre1_load.py list                         # 올라간 학교
  python3 tools/pre1_load.py hide <key> | show <key>      # 학생 화면에서 숨기기·보이기

JSON 모양은 pre1.html 이 그리는 그대로(맨 위 docstring 아래 REQUIRED). 키(key)는 파일 이름
(확장자 뺀 것) + '-' + 시험 줄임('26-1m' = 2026학년도 1학기 중간)으로 만든다.
"""
import json
import os
import re
import sys
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
REQUIRED = ['school', 'short', 'exam', 'subject', 'cover', 'composition', 'scope', 'areaDist', 'levelDist',
            'questions', 'review', 'trends', 'hard', 'points']
LEVELS = ['중', '중상', '상', '최상']
_tok = None


def token():
    global _tok
    if not _tok:
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


def exam_tag(exam):
    m = re.search(r'(\d{4})학년도\s*([12])학기\s*(중간|기말)', exam or '')
    if not m:
        raise SystemExit(f'시험 이름을 읽지 못했습니다: {exam!r}')
    return f"{m.group(1)[2:]}-{m.group(2)}{'m' if m.group(3) == '중간' else 'f'}"


def problems(d):
    """숫자가 서로 맞는지 본다. 돌려주는 목록이 비어야 통과."""
    out = []
    for k in REQUIRED:
        if k not in d:
            out.append(f'{k} 없음')
    if out:
        return out
    qs = d['questions']
    if not qs:
        return ['questions 가 비었습니다']
    a_sum = sum(int(x['n']) for x in d['areaDist'])
    l_sum = sum(int(x['n']) for x in d['levelDist'])
    if a_sum != len(qs):
        out.append(f'영역 분포 합 {a_sum} ≠ 문항 {len(qs)}')
    if l_sum != len(qs):
        out.append(f'난도 분포 합 {l_sum} ≠ 문항 {len(qs)}')
    for x in d['levelDist']:
        c = sum(1 for q in qs if q.get('lv') == x['name'])
        if c != int(x['n']):
            out.append(f"난도 '{x['name']}' 그래프 {x['n']} ≠ 문항 표 {c}")
    for q in qs:
        if q.get('lv') not in LEVELS:
            out.append(f"{q.get('no')}번 난도 '{q.get('lv')}'")
        if not str(q.get('text', '')).strip():
            out.append(f"{q.get('no')}번 내용이 비었습니다")
    nos = {str(q.get('no')): q for q in qs}
    for h in d['hard']:   # 두 문항을 한 칸에 묶은 것('20·21')은 번호마다 본다
        for n in re.findall(r'\d+', str(h.get('no'))) or [str(h.get('no'))]:
            q = nos.get(n)
            if not q:
                out.append(f"고난도 {n}번이 문항 표에 없습니다")
            elif h.get('lv') and q.get('lv') != h.get('lv'):
                out.append(f"고난도 {n}번 난도 {h.get('lv')} ≠ 문항 표 {q.get('lv')}")
    for it in d.get('scopeItems') or []:   # 범위의 양(작품·지문·단원 개수) — 종류는 넷만
        if it.get('kind') not in ('교과서', '프린트', '모의고사', '외부') or not str(it.get('name', '')).strip():
            out.append(f"scopeItems 항목이 이상합니다: {it}")
    if not d.get('scopeItems'):
        out.append('scopeItems 없음 — 범위의 양을 셀 수 없습니다')
    for p in d['points']:
        if not str(p.get('title', '')).strip():
            out.append('학습 포인트 제목이 비었습니다')
    return out


def area_problems(d):
    """영역 이름은 PDF마다 묶는 단위가 달라(문학 ↔ 현대시·고전 수필) 경고로만 본다."""
    out = []
    qs = d['questions']
    for x in d['areaDist']:
        c = sum(1 for q in qs if q.get('area') == x['name'])
        if c != int(x['n']):
            out.append(f"영역 '{x['name']}' 그래프 {x['n']} ≠ 문항 표 {c}")
    return out


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd in ('check', 'put'):
        bad = False
        rows = []
        for i, path in enumerate(args):
            d = load(path)
            ps = problems(d)
            ws = area_problems(d) if not ps else []
            name = os.path.basename(path)
            print(f"{name}: {d.get('school')} · 문항 {len(d.get('questions') or [])}" +
                  (' · 통과' if not ps else ''))
            for p in ps:
                print('  오류:', p)
            for w in ws:
                print('  참고:', w)
            bad = bad or bool(ps)
            key = re.sub(r'[^a-z0-9_-]', '', os.path.splitext(name)[0].lower()) + '-' + exam_tag(d['exam'])
            rows.append({'key': key, 'ord': (i + 1) * 10, 'school': d['school'], 'exam': d['exam'],
                         'data': d, 'visible': True, 'updated_by': '클로슈'})
        if bad:
            raise SystemExit('오류가 있어 멈춥니다.')
        if cmd == 'put':
            rest('POST', '/pre1_schools?on_conflict=key', rows, 'resolution=merge-duplicates,return=minimal')
            print(f'{len(rows)}곳을 올렸습니다.')
    elif cmd == 'list':
        for r in rest('GET', '/pre1_schools?select=key,ord,school,exam,visible,updated_at&order=ord') or []:
            print(r['ord'], r['key'], r['school'], r['exam'], '보임' if r['visible'] else '숨김', r['updated_at'][:16])
    elif cmd in ('hide', 'show') and args:
        rest('PATCH', '/pre1_schools?key=eq.' + args[0], {'visible': cmd == 'show'}, 'return=minimal')
        print(args[0], '보임' if cmd == 'show' else '숨김')
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
