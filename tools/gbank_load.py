#!/usr/bin/env python3
"""모의고사 문법 문항 은행 — SHUEGUK MOGO 작업 폴더의 문항을 수파베이스 gbank_* 표에 올린다 (2026-11-17, 067).

문항 원문(평가원·교육청·사설 모의고사)은 공개 저장소에 두지 않는다. 작업 폴더(shueguk_mogo — 드라이브
「클로슈」 폴더의 두 zip을 한 곳에 푼 것)는 저장소 밖에 두고, 이 도구가 그 폴더의 scripts/gen.py 를 그대로
불러(fixes.py 수정·정답 수정·영역 이동·제외가 모두 적용된 상태) 문항을 만들어 올린다.

  python3 tools/gbank_load.py build <shueguk_mogo 폴더> <out.json>   # 문항 JSON 만들기(검사 포함)
  python3 tools/gbank_load.py check <out.json>                        # 모양 검사만
  python3 tools/gbank_load.py put <out.json>                          # 검사 뒤 올리기(교사 계정, 덮어씀)
  python3 tools/gbank_load.py list                                    # 올라간 영역·난도별 문항 수

오타는 작업 폴더의 scripts/fixes.py 에 고친 뒤 build → put 을 다시 돌리면 앱에도 반영된다.
put 은 같은 문항 번호(id)를 덮어쓰고, 작업 폴더에서 빠진(제외된) 문항은 active=false 로 숨긴다(지우지 않음 —
이미 낸 H WORK 과제가 그 문항을 가리키고 있을 수 있어서).

학생용 HTML(html)에는 정답 표시가 없다(render_body 의 ans=0). 정답(ans 1~5)·해설(good·bad)은 따로 담아
교사 화면과 '클리어한 문항'에만 보낸다(hwork_expl).
"""
import json
import os
import re
import sys
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
LVL_ORDER = ['기본', '실력', '심화']
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
                                 data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
    raw = urllib.request.urlopen(req, timeout=120).read().decode()
    return json.loads(raw) if raw.strip() else None


def plain(h):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h)).strip()


def build(root, out):
    os.environ['PYTHONUTF8'] = '1'
    sys.path.insert(0, os.path.join(root, 'scripts'))
    import gen  # noqa: E402 — 작업 폴더의 gen.py (fixes.py 를 읽어 적용한다)
    if gen.FIXMISS:
        raise SystemExit(f'fixes.py 에 적용되지 않은 수정이 있습니다: {gen.FIXMISS[:5]}')
    items, passages, ord_ = [], {}, 0
    for area in gen.AREAS:
        for lv, ids in gen.build_volume(area):
            for i in ids:
                o = gen.OUT[i]
                stem = gen.fixhtml(o['stem'])
                stem = re.sub(r'\[\s*(\d)\s*점\s*\]', r'<span class="pt">[\1점]</span>', stem)
                body = gen.render_body(o['body'], 0, i)          # 정답 표시 없이
                src = gen.meta(o['file'], i)               # 2025 문항(id≥457)은 번호가 필요하다
                html = f'<div class="qh"><div class="stem">{stem}</div></div>{body}'
                a, good, bad = gen.expl(i)
                ans = gen.ANSN.get(gen.items[i]['ans'], 0)
                kind = '평가원' if '평가원' in src else ('교육청' if '교육청' in src else '사설')
                y = re.search(r'20\d\d', src)
                pid = ''
                p = o.get('passage')
                if p:
                    pid = 'p' + str(p['id'])
                    if pid not in passages:
                        _head, paras = gen.passage_html(p, 1, 1, i)
                        passages[pid] = ''.join(paras)
                ord_ += 1
                items.append({'id': i, 'area': gen.DISP.get(area, area), 'lvl': lv, 'src': src, 'kind': kind,
                              'year': y.group() if y else '', 'pid': pid, 'ord': ord_, 'html': html, 'ans': ans,
                              'good': good, 'bad': bad, 'plain': plain(html)[:600]})
    data = {'items': items, 'passages': [{'pid': k, 'html': v} for k, v in passages.items()]}
    bad = problems(data)
    if bad:
        raise SystemExit('검사 실패:\n' + '\n'.join(bad[:30]))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f'문항 {len(items)} · 지문 {len(passages)} · {os.path.getsize(out) // 1024} KB → {out}')


def problems(d):
    out = []
    pids = {p['pid'] for p in d['passages']}
    seen = set()
    for it in d['items']:
        i = it['id']
        if i in seen:
            out.append(f'{i}: 문항 번호가 겹칩니다')
        seen.add(i)
        if it['ans'] not in (1, 2, 3, 4, 5):
            out.append(f'{i}: 정답 {it["ans"]!r} (1~5 아님)')
        if it['lvl'] not in LVL_ORDER:
            out.append(f'{i}: 난도 {it["lvl"]!r}')
        if 'class="c ok"' in it['html'] or 'cn ok' in it['html'] or 'class="tex"' in it['html']:
            out.append(f'{i}: 학생용 HTML 에 정답 표시가 남았습니다')
        if '@IMG@' in it['html'] or 'data-src=' in it['html']:
            out.append(f'{i}: 그림이 들어가지 않았습니다')
        if it['pid'] and it['pid'] not in pids:
            out.append(f'{i}: 지문 {it["pid"]} 없음')
        if len(it['plain']) < 5:
            out.append(f'{i}: 문항 글이 비었습니다')
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'build':
        build(args[0], args[1])
    elif cmd in ('check', 'put'):
        d = json.load(open(args[0], encoding='utf-8'))
        bad = problems(d)
        if bad:
            raise SystemExit('검사 실패:\n' + '\n'.join(bad[:30]))
        print(f'검사 통과 — 문항 {len(d["items"])} · 지문 {len(d["passages"])}')
        if cmd == 'check':
            return
        rest('POST', '/gbank_passages?on_conflict=pid', d['passages'], 'resolution=merge-duplicates,return=minimal')
        rows = [dict(it, active=True) for it in d['items']]
        for k in range(0, len(rows), 40):
            rest('POST', '/gbank_items?on_conflict=id', rows[k:k + 40], 'resolution=merge-duplicates,return=minimal')
        ids = ','.join(str(it['id']) for it in d['items'])
        rest('PATCH', f'/gbank_items?id=not.in.({ids})&active=is.true', {'active': False}, 'return=minimal')
        print('올렸습니다.')
    elif cmd == 'list':
        rows, off = [], 0
        while True:                                   # 수파베이스는 한 번에 1000줄까지 — 끝까지 넘긴다
            part = rest('GET', f'/gbank_items?select=area,lvl,active&order=id&limit=1000&offset={off}') or []
            rows += part
            off += 1000
            if len(part) < 1000:
                break
        c = {}
        for r in rows:
            k = (r['area'], r['lvl'], r['active'])
            c[k] = c.get(k, 0) + 1
        for k in sorted(c):
            print(*k, c[k])
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
