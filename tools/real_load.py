#!/usr/bin/env python3
"""이미 낸 H WORK 과제에 문제 원문 잇기 — SHUEGUK REAL 내신 기출 (2026-11-17, 068).

교재를 만든 작업 폴더(드라이브 「클로슈」의 'SHUEGUK REAL' zip — 교재마다 하나)를 저장소 밖에 풀고,
그 안의 data/<교재>_<n>권.json(과제 이름·과제 안 번호·문제 원문, 교정 반영본)을 hwork_src_items 에 올린다.
학교 기출이라 문항은 공개 저장소에 두지 않는다.

  python3 tools/real_load.py build <out.json> <교재 폴더> [<교재 폴더> …]   # 예: …/SHUEGUK_REAL_문장 …/SHUEGUK_REAL_음운
  python3 tools/real_load.py check <out.json>      # 모양 검사 + 지금 H WORK 과제와 이름·문항 수·정답 대조
  python3 tools/real_load.py put <out.json>        # 검사 뒤 올리기(교사 계정, 같은 과제·번호는 덮어씀)
  python3 tools/real_load.py list                  # 올라간 교재·과제 수

문제 HTML 은 교재 작업 폴더 source/gen.py 의 group_body(〈보기〉 상자·선지 표·목록 들여쓰기)를 그대로 써서 만든다.
서술형 '답' 칸(WBOX)은 화면에서는 빼고, 정답 표시는 넣지 않는다. 정답·예시 답은 ans·essay 칸에 따로 둔다.
교재를 고치면(source/fixes.json → build_data.py → export) 새 data JSON 으로 build → put 을 다시 돌리면 된다.
put 은 이번에 올리는 과제 안에서 빠진 번호만 active=false 로 숨긴다(다른 교재는 건드리지 않음).
"""
import glob
import html as H
import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbank_load import rest  # noqa: E402 — 같은 교사 계정 요청 도구

WRONG = '오류 문항입니다. 풀지 말고 넘어가세요.'


def load_gen(book_dir):
    """교재 작업 폴더의 gen.py 에서 화면 함수(group_body·wrap·plain)만 꺼낸다."""
    src_dir = os.path.join(book_dir, 'source')
    code = open(os.path.join(src_dir, 'gen.py'), encoding='utf-8').read()
    code = code[:code.index('def qblock')]
    cwd = os.getcwd()
    os.chdir(src_dir)                      # gen.py 가 wb.json 을 상대 경로로 읽는다
    try:
        g = {'__name__': 'realgen'}
        exec(compile(code, 'gen.py', 'exec'), g)
    finally:
        os.chdir(cwd)
    g['WBOX'] = ''                         # 화면에서는 손글씨 '답' 칸을 쓰지 않는다
    return g


def item_html(g, it):
    stem = it['stem'] or ''
    tag = ''
    if re.search(r'서술형|서답형', g['plain'](stem)[:12]) or not it.get('multiple_choice'):
        tag = '<span class="tag">서술형</span>'
        stem = re.sub(r'\[?\s*서[술답]형\s*\d*\s*\]?\.?', '', stem, count=1)
    body = ''.join(x for x in g['group_body'](list(it.get('body') or [])) if x)
    if it.get('error_item'):
        body = f'<div class="errq">※ {WRONG}</div>' + body
    return f'<div class="qh"><div class="stem">{tag}{stem}</div></div><div class="qb">{body}</div>'


def passage_html(g, blocks):
    out = []
    for b in blocks:
        if g['plain'](b) or '<table' in b or '<img' in b or '<svg' in b:
            out.append(f'<div class="psg">{g["wrap"](b)}</div>')
    return ''.join(out)


def build(out, dirs):
    items, passages = [], {}
    for d in dirs:
        g = load_gen(d)
        for f in sorted(glob.glob(os.path.join(d, 'data', '*.json'))):
            data = json.load(open(f, encoding='utf-8'))
            book = f"{data['book']} {data['volume_name']}"
            for pid, p in (data.get('passages') or {}).items():
                passages[pid] = passage_html(g, p.get('blocks') or [])
            for s in data['sets']:
                for it in s['items']:
                    ha = it.get('hwork_answer') or {}
                    typ = ha.get('type') or ('5지' if it.get('multiple_choice') else '서술')
                    if typ == '5지':
                        ans = it.get('answer') or ''
                    elif typ == '단답':
                        ans = it.get('essay_answer') or ha.get('answer') or ''
                    else:
                        ans = ''
                    items.append({
                        'code': s['hwork_title'], 'no': int(it['hwork_no']), 'qid': it['qid'], 'book': book,
                        'html': item_html(g, it), 'pid': it.get('passage_id') or '', 'type': typ,
                        'ans': ans, 'essay': (it.get('essay_answer') or '') if typ != '5지' else '',
                        'src': it.get('source') or '', 'err': bool(it.get('error_item'))})
    data = {'items': items, 'passages': [{'pid': k, 'html': v} for k, v in passages.items()]}
    bad = problems(data)
    if bad:
        raise SystemExit('검사 실패:\n' + '\n'.join(bad[:30]))
    with open(out, 'w', encoding='utf-8') as fp:
        json.dump(data, fp, ensure_ascii=False)
    print(f'문항 {len(items)} · 지문 {len(passages)} · 과제 {len({i["code"] for i in items})} · '
          f'{os.path.getsize(out) // 1024} KB → {out}')


def problems(d):
    out, seen = [], set()
    pids = {p['pid'] for p in d['passages']}
    for p in d['passages']:
        if not p['html'].strip():
            out.append(f'지문 {p["pid"]}: 비었습니다')
    for it in d['items']:
        k = (it['code'], it['no'])
        if k in seen:
            out.append(f'{k}: 번호가 겹칩니다')
        seen.add(k)
        if it['pid'] and it['pid'] not in pids:
            out.append(f'{k}: 지문 {it["pid"]} 없음')
        if len(re.sub(r'<[^>]+>', '', it['html']).strip()) < 3 and '<img' not in it['html']:
            out.append(f'{k}: 문항 글이 비었습니다')
        if 'data-ans=' in it['html'] or 'class="hand' in it['html'] or 'cn right' in it['html']:
            out.append(f'{k}: 학생용 HTML 에 정답 표시가 남았습니다')
        if it['type'] == '5지' and it['ans'] and not re.fullmatch(r'[①②③④⑤](\s*,\s*[①②③④⑤])*', it['ans']):
            out.append(f'{k}: 5지 정답 {it["ans"]!r}')
    return out


ANSN = {'①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5'}


def compare(d):
    """지금 H WORK 과제(hwork_homeworks)와 이름·문항 수·5지 정답을 대조한다. 다른 곳은 알리기만 한다."""
    codes = sorted({i['code'] for i in d['items']})
    live = {}
    for k in range(0, len(codes), 20):
        part = ','.join('"' + c.replace('"', '\\"') + '"' for c in codes[k:k + 20])
        for r in rest('GET', '/hwork_homeworks?select=code,data&code=in.(' + urllib.parse.quote(part) + ')') or []:
            live[r['code']] = (r.get('data') or {}).get('items') or {}
    msgs = []
    by = {}
    for it in d['items']:
        by.setdefault(it['code'], []).append(it)
    for c, lst in by.items():
        if c not in live:
            msgs.append(f'H WORK 에 없는 과제: {c}')
            continue
        if len(live[c]) != len(lst):
            msgs.append(f'문항 수 다름: {c} — H WORK {len(live[c])} / 교재 {len(lst)}')
        for it in lst:
            L = live[c].get(str(it['no']))
            if not L:
                msgs.append(f'H WORK 에 없는 번호: {c} {it["no"]}번')
            elif it['type'] == '5지' and L.get('type') == 'choice5' and not it['err']:
                want = ','.join(ANSN.get(x.strip(), x) for x in it['ans'].split(','))
                if str(L.get('ans')).replace(' ', '') != want:
                    msgs.append(f'정답 다름: {c} {it["no"]}번 — H WORK {L.get("ans")} / 교재 {it["ans"]}')
    return msgs


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'build':
        build(args[0], args[1:])
    elif cmd in ('check', 'put'):
        d = json.load(open(args[0], encoding='utf-8'))
        bad = problems(d)
        if bad:
            raise SystemExit('검사 실패:\n' + '\n'.join(bad[:30]))
        print(f'검사 통과 — 문항 {len(d["items"])} · 지문 {len(d["passages"])}')
        for m in compare(d):
            print('  확인:', m)
        if cmd == 'check':
            return
        if d['passages']:
            for k in range(0, len(d['passages']), 40):
                rest('POST', '/hwork_src_passages?on_conflict=pid', d['passages'][k:k + 40],
                     'resolution=merge-duplicates,return=minimal')
        rows = [dict(it, active=True) for it in d['items']]
        for k in range(0, len(rows), 40):
            rest('POST', '/hwork_src_items?on_conflict=code,no', rows[k:k + 40],
                 'resolution=merge-duplicates,return=minimal')
        by = {}
        for it in d['items']:
            by.setdefault(it['code'], []).append(it['no'])
        for c, nos in by.items():
            rest('PATCH', '/hwork_src_items?code=eq.' + urllib.parse.quote(c) +
                 '&no=not.in.(' + ','.join(map(str, nos)) + ')&active=is.true', {'active': False}, 'return=minimal')
        print('올렸습니다.')
    elif cmd == 'list':
        rows, off = [], 0
        while True:                        # 한 번에 1000줄까지라 나눠 받는다
            part = rest('GET', f'/hwork_src_items?select=book,code,active&order=code,no&limit=1000&offset={off}') or []
            rows += part
            if len(part) < 1000:
                break
            off += 1000
        c = {}
        for r in rows:
            k = (r['book'], r['active'])
            c.setdefault(k, [0, set()])
            c[k][0] += 1
            c[k][1].add(r['code'])
        for k in sorted(c):
            print(*k, f'문항 {c[k][0]} · 과제 {len(c[k][1])}')
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
