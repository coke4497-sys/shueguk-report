#!/usr/bin/env python3
"""예비 고3 — 인서울 15개 대학 2028학년도 입시전형 JSON 을 수파베이스 pre3_univs 에 올린다 (2026-11-28, 095).

옮긴 글은 저장소에 두지 않는다 — JSON 은 세션 스크래치패드 같은 저장소 밖에 두고 이 도구로 올린다
(클로슈 계정, 학생은 pre3_list 함수로만 읽음). 원문은 대입정보포털 '어디가'의 각 대학 2028학년도 시행계획 +
대교협 「2028학년도 대학입학전형시행계획 주요사항」(2026-04-29).

  python3 tools/pre3_load.py check <common.json> <대학.json> …   # 모양·숫자 검사만
  python3 tools/pre3_load.py put <common.json> <대학.json> …     # 검사 뒤 올리기(대학 파일 순서 = 화면 순서)
  python3 tools/pre3_load.py list                                 # 올라간 줄
  python3 tools/pre3_load.py hide <key> | show <key>              # 학생 화면에서 숨기기·보이기

대학 JSON 모양은 pre3.html 이 그리는 그대로(아래 REQUIRED — name·short·src·changes·tracks·jeongsi·korean·totals).
common.json = {"schedule":[{"k":"수시 원서접수","v":"2027. 9. 20.(월) ~ 23.(목) 중 3일 이상"}…], "national":{…}, "src":"…"}.
키(key)는 파일 이름(확장자 뺀 것, 영문 소문자)으로 만든다 — 'snu.json' → 'snu'.
"""
import json
import os
import re
import sys
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID = 'closhu@shueguk.internal'   # 클로슈 전용 계정(2026-11-22 공용 교사 계정 폐지) — 비밀번호는 환경 비밀값 CLOSHU_TOKEN 에서 만든다
T_PW = __import__('hashlib').sha256(('shueguk-closhu-sb:' + (os.environ.get('CLOSHU_TOKEN') or (_ for _ in ()).throw(SystemExit('환경 비밀값 CLOSHU_TOKEN 이 없습니다 — 클로슈 계정으로 로그인할 수 없어요')))).encode()).hexdigest()
REQUIRED = ['name', 'short', 'src', 'changes', 'tracks', 'jeongsi', 'korean']
KCUE_ALIAS = {'한국외대': '한국외국어대'}   # 대교협 표의 대학 이름
PERIODS = ['수시', '정시']
TYPES = ['학생부종합', '학생부교과', '논술', '수능']
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


def problems(d):
    """대학 JSON 의 모양·숫자가 맞는지 본다. 돌려주는 목록이 비어야 통과."""
    out = [f'{k} 없음' for k in REQUIRED if k not in d]
    if out:
        return out
    if not isinstance(d['tracks'], list) or not d['tracks']:
        return ['tracks 가 비었습니다']
    for t in d['tracks']:
        if t.get('period') not in PERIODS:
            out.append(f"전형 '{t.get('name')}' period '{t.get('period')}'")
        if t.get('type') not in TYPES:
            out.append(f"전형 '{t.get('name')}' type '{t.get('type')}'")
        if not str(t.get('name', '')).strip() or not str(t.get('method', '')).strip():
            out.append(f"전형 이름·방법이 비었습니다: {t}")
        if t.get('n') is not None and not isinstance(t.get('n'), int):
            out.append(f"전형 '{t.get('name')}' n 은 정수 또는 null")
        if not str(t.get('min', '')).strip():
            out.append(f"전형 '{t.get('name')}' min 이 비었습니다('없음'이라고 적을 것)")
    j = d['jeongsi']
    if not isinstance(j, dict) or not isinstance(j.get('ratio'), list) or not j['ratio']:
        out.append('jeongsi.ratio 가 비었습니다')
    else:
        for r in j['ratio']:
            for k in ('kor', 'math', 'eng', 'inq'):
                v = r.get(k)
                if v is not None and not isinstance(v, (int, float)):
                    out.append(f"정시 반영 비율 '{r.get('track')}' {k} 는 숫자 또는 null")
            if r.get('kor') is None and not str(r.get('note', '')).strip():
                out.append(f"정시 반영 비율 '{r.get('track')}' 국어(kor)가 없고 note 도 없습니다('우수 영역 순' 같은 방식은 note 에 적을 것)")
    if not isinstance(d['korean'], list) or not d['korean']:
        out.append('korean(국어 요점)이 비었습니다')
    tt = d.get('totals')
    if not isinstance(tt, dict) or 'total' not in tt:
        out.append('totals 없음 — common.json(대교협 표)을 함께 넘기면 채워집니다')
    blob = json.dumps(d, ensure_ascii=False)
    if '—' in blob:
        out.append('긴 가로줄(—)이 들어 있습니다')
    return out


def common_problems(d):
    out = []
    if not isinstance(d.get('schedule'), list) or not d['schedule']:
        out.append('schedule 없음')
    if not isinstance(d.get('national'), dict):
        out.append('national 없음')
    return out


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def key_of(path):
    k = re.sub(r'[^a-z0-9_-]', '', os.path.splitext(os.path.basename(path))[0].lower())
    if not re.fullmatch(r'[a-z0-9_-]{2,40}', k):
        raise SystemExit(f'파일 이름을 키로 쓸 수 없습니다(영문 소문자·숫자): {path}')
    return k


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd in ('check', 'put'):
        bad, rows, n_univ = False, [], 0
        common = next((load(a) for a in args if key_of(a) == 'common'), None)
        kcue = (common or {}).get('kcue15') or {}
        for path in args:
            d = load(path)
            k = key_of(path)
            if k != 'common' and 'totals' not in d:   # 대교협 「대학별 모집인원」 표의 그 대학 줄을 그대로 붙인다
                t = kcue.get(KCUE_ALIAS.get(d.get('short'), d.get('short')))
                if t:
                    d['totals'] = t
            if k == 'common':
                ps = common_problems(d)
                print(f"{os.path.basename(path)}: 공통(일정·전국 총계)" + (' · 통과' if not ps else ''))
                rows.append({'key': 'common', 'ord': 0, 'kind': 'common', 'name': '공통', 'year': str(d.get('year', '2028')),
                             'data': d, 'visible': True, 'updated_by': '클로슈'})
            else:
                ps = problems(d)
                n_univ += 1
                print(f"{os.path.basename(path)}: {d.get('name')} · 전형 {len(d.get('tracks') or [])}개" + (' · 통과' if not ps else ''))
                rows.append({'key': k, 'ord': n_univ * 10, 'kind': 'univ', 'name': d.get('name', ''), 'year': str(d.get('year', '2028')),
                             'data': d, 'visible': True, 'updated_by': '클로슈'})
            for p in ps:
                print('  오류:', p)
            bad = bad or bool(ps)
        if bad:
            raise SystemExit('오류가 있어 멈춥니다.')
        if cmd == 'put':
            rest('POST', '/pre3_univs?on_conflict=key', rows, 'resolution=merge-duplicates,return=minimal')
            print(f'{len(rows)}줄을 올렸습니다.')
    elif cmd == 'list':
        for r in rest('GET', '/pre3_univs?select=key,ord,kind,name,year,visible,updated_at&order=ord') or []:
            print(r['ord'], r['key'], r['kind'], r['name'], r['year'], '보임' if r['visible'] else '숨김', r['updated_at'][:16])
    elif cmd in ('hide', 'show') and args:
        rest('PATCH', '/pre3_univs?key=eq.' + args[0], {'visible': cmd == 'show'}, 'return=minimal')
        print(args[0], '보임' if cmd == 'show' else '숨김')
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
