#!/usr/bin/env python3
"""Shuefit 독서 — 국어공방 독서 HWPX 를 수파베이스 reading_* 표에 올린다 (2026-11-18, 079).

지문·문항(학원 자료)은 공개 저장소에 두지 않는다. HWPX 는 저장소 밖(스크래치 폴더)에 내려받아 이 도구로 올린다.
파일 이름 = '(2306고2)(사회)독점기업의이윤추구과정-공정거래법의이해 기본.hwpx' 꼴 — 첫 괄호 = 출처(연도 두 자리 + 월 + 학년),
둘째 괄호 = 영역(없으면 --area 로), 끝 = 기본|실력. 같은 지문의 기본·실력 두 파일을 함께 넘긴다.

  python3 -I tools/reading_load.py build <out.json> <a 기본.hwpx> <a 실력.hwpx> … [--area '제목=인문']
  python3 -I tools/reading_load.py build <out.json> '[비상 독서와 작문]5-(1)-1 제목(작가).hwp' …   # 교과서 묶음(081)
  python3 -I tools/reading_load.py check <out.json>
  python3 -I tools/reading_load.py put <out.json>      # 검사 뒤 올리기(교사 계정) — 같은 지문·자리는 덮어쓰고, 빠진 문항은 active=false
  python3 -I tools/reading_load.py list

허브 shufit_reading.html 이 이 표를 읽는다. 지문 데이터 모양(data·items)을 바꾸면 그 화면도 함께 고칠 것.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reading_hwpx as RH  # noqa: E402
import reading_hwp5 as R5  # noqa: E402

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
AREAS = ['인문', '사회', '과학', '기술', '예술', '융합']
KINDS = ('choice', 'ox', 'multi', 'blank', 'essay')
CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
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
    raw = urllib.request.urlopen(req, timeout=180).read().decode()
    return json.loads(raw) if raw.strip() else None


def plain(h):
    import html as H
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', str(h or '')))).strip()


def item_plain(it):
    parts = [it.get('stem', '')]
    parts += [b.get('p', '') for b in it.get('box', [])] + [b.get('p', '') for b in it.get('cond', [])]
    parts += it.get('opts', []) + [it.get('model', ''), it.get('ans', ''), it.get('expl', '')]
    return plain(' '.join(parts))


def src_info(src, title_raw, orig):
    m = re.match(r'(\d\d)(\d\d)(고\d|중\d)', src or '')
    srcname = ('20%s학년도 %d월 %s' % (m.group(1), int(m.group(2)), m.group(3))) if m else (src or '')
    # 고1·고2 학력평가는 모두 교육청, 고3은 6·9·11월(수능)만 평가원
    kind = ''
    if m and m.group(3).startswith('고'):
        kind = '평가원' if (m.group(3) == '고3' and int(m.group(2)) in (6, 9, 11)) else '교육청'
    elif title_raw.startswith('교육-') or (orig and '교육' in orig[0].get('src', '')):
        kind = '교육청'
    return srcname, kind, (m.group(3) if m else '')


def pid_of(src, title):
    slug = re.sub(r'[^0-9A-Za-z가-힣]', '', title)[:24]
    return (src + '-' + slug) if src else slug


def build_textbook(f, area_over):
    """국어공방 '비문학 문제 풀이'(교과서 지문, 옛 .hwp) 한 파일 → 지문 하나."""
    d = R5.convert(f)
    if not (d['book'] and d['unit'] and d['title']):
        sys.exit('교과서 이름·단원·제목을 못 읽었습니다(파일 이름 [교과서명]단원 제목(작가).hwp): ' + f)
    m = re.match(r'(\d+)-\((\d+)\)-(\d+)', d['unit'])
    slug = re.sub(r'[^0-9A-Za-z가-힣]', '', d['book'])[:20]
    pid = '교과서-%s-%s-%s-%s' % (slug, m.group(1), m.group(2), m.group(3))
    items = []
    for s in d['sections']:
        if s['code'] == '?':
            sys.exit('모르는 구역: %s (%s)' % (s['name'], f))
        for i, it in enumerate(s['items']):
            items.append({'level': '교과서', 'code': s['code'], 'sec_name': s['name'], 'v': 1, 'ord': i + 1,
                          'kind': it['kind'], 'data': it, 'plain': item_plain(it)})
    P = d['passage']
    return {
        'id': pid, 'title': d['title'], 'src': slug + d['unit'], 'srcname': '%s %s' % (d['book'], d['unit']),
        'kind': '교과서', 'area': area_over.get(d['title'], ''), 'grade': '',
        'data': {'passage': P, 'notes': d['notes'], 'analysis': d['analysis'], 'blanks': d['blanks'], 'keys': d['keys'],
                 'book': d['book'], 'unit': d['unit'], 'author': d['author'], 'levels': ['교과서']},
        'imgs': {},
        'plain': plain(d['title'] + ' ' + d['author'] + ' ' + ' '.join(b.get('p', '') for b in P['blocks'])
                       + ' ' + ' '.join(' '.join(r) for b in P['blocks'] for r in b.get('tbl', [])) + ' ' + ' '.join(P.get('vocab', []))),
        'items': items, '_removed': d['removed'], '_fixed': d['fixed'],
    }


def build(out, files, area_over):
    res = [build_textbook(f, area_over) for f in files if f.lower().endswith('.hwp')]
    files = [f for f in files if not f.lower().endswith('.hwp')]
    if not files:
        json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False)
        for p in res:
            print(p['id'], '|', p['title'], '|', p['srcname'], '| 문항', len(p['items']), '| 뺀 줄', len(p['_removed']), '| 고친 줄', len(p['_fixed']))
        return res
    groups = {}
    for f in files:
        d = RH.convert(f)
        title_raw = d['title']
        title = re.sub(r'^교육-', '', title_raw).strip()
        g = groups.setdefault(title, {'levels': {}, 'imgs': {}, 'tags': d.get('tags', []), 'title_raw': title_raw})
        g['imgs'].update(d['imgs'])
        lv = d.get('level') or '기본'
        if lv in g['levels']:
            sys.exit('같은 지문·난도 파일이 둘입니다: %s %s' % (title, lv))
        g['levels'][lv] = d
    for title, g in groups.items():
        base = g['levels'].get('기본') or next(iter(g['levels'].values()))
        tags = g['tags']
        src = tags[0] if tags else ''
        area = next((t for t in tags[1:] if t in AREAS), '') or area_over.get(title, '')
        srcname, kind, grade = src_info(src, g['title_raw'], base['orig'])
        notes = next((s['notes'] for s in base['sections'] if s['code'] == '01'), [])
        blanks = next((s['blanks'] for s in base['sections'] if s['code'] == '10'), None)
        items = []
        for i, it in enumerate(base['orig']):
            items.append({'level': '공통', 'code': '00', 'sec_name': '원 기출', 'v': 1, 'ord': i + 1,
                          'kind': it['kind'], 'data': it, 'plain': item_plain(it)})
        for lv, d in g['levels'].items():
            for s in d['sections']:
                if s['code'] in ('01', '10'):
                    continue
                for i, it in enumerate(s.get('items', [])):
                    data = dict(it)
                    if s.get('passage') and i == 0:
                        data['passage'] = s['passage']      # 99 독립 지문은 그 묶음 첫 문항에
                    items.append({'level': lv, 'code': s['code'], 'sec_name': s['name'], 'v': s['v'], 'ord': i + 1,
                                  'kind': it['kind'], 'data': data, 'plain': item_plain(it)})
        P = base['passage']
        res.append({
            'id': pid_of(src, title), 'title': title, 'src': src, 'srcname': srcname, 'kind': kind,
            'area': area, 'grade': grade,
            'data': {'passage': P, 'notes': notes, 'blanks': blanks, 'levels': sorted(g['levels'])},
            'imgs': g['imgs'],
            'plain': plain(title + ' ' + ' '.join(b.get('p', '') for b in P['blocks']) + ' ' + ' '.join(P.get('vocab', []))),
            'items': items,
        })
    json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False)
    for p in res:
        print(p['id'], '|', p['title'], '|', p['srcname'], p['kind'], '|', p['area'] or '영역 없음', '| 문항', len(p['items']), '| 난도', p['data']['levels'])
    return res


def img_refs(x):
    out = []
    if isinstance(x, dict):
        if 'img' in x:
            out.append(x['img'])
        for v in x.values():
            out += img_refs(v)
    elif isinstance(x, list):
        for v in x:
            out += img_refs(v)
    return out


def check(res):
    errs, warns = [], []
    ids = set()
    for p in res:
        tag = p['id']
        if tag in ids:
            errs.append('%s: 지문 id 가 겹칩니다' % tag)
        ids.add(tag)
        if not re.fullmatch(r'[0-9A-Za-z가-힣_-]{3,80}', tag):
            errs.append('%s: id 모양' % tag)
        if not p['area'] and p['kind'] != '교과서':
            warns.append('%s: 영역이 없습니다 (--area 로 넣으세요)' % tag)
        elif p['area'] and p['area'] not in AREAS:
            errs.append('%s: 영역 %s' % (tag, p['area']))
        if not p['data']['passage']['blocks']:
            errs.append('%s: 지문 비어 있음' % tag)
        for n in img_refs([p['data'], [i['data'] for i in p['items']]]):
            if n not in p['imgs']:
                errs.append('%s: 그림 %s 없음' % (tag, n))
        keys = set()
        for it in p['items']:
            k = (it['level'], it['code'], it['v'], it['ord'])
            w = '%s %s %s v%d %d번' % (tag, it['level'], it['code'], it['v'], it['ord'])
            if k in keys:
                errs.append(w + ': 자리가 겹칩니다')
            keys.add(k)
            d = it['data']
            if it['kind'] not in KINDS:
                errs.append(w + ': 종류 ' + it['kind'])
            if not plain(d.get('stem')):
                errs.append(w + ': 발문 없음')
            a = d.get('ans', '').replace(' ', '')
            if not a:
                errs.append(w + ': 정답 없음')
            if it['kind'] == 'choice' and (len(d.get('opts', [])) != 5 or not re.fullmatch('[①-⑤]', a)):
                errs.append(w + ': 5지 선다 모양(선지 %d, 정답 %s)' % (len(d.get('opts', [])), a))
            if it['kind'] == 'ox' and a not in ('O', 'X'):
                errs.append(w + ': OX 정답 ' + a)
            if it['kind'] == 'multi':
                n = len(d.get('opts', []))
                if any(CIRC.index(c) >= n for c in re.findall('[①-⑳]', a)):
                    errs.append(w + ': 정답 번호가 선지보다 큼')
        lv = {}
        for it in p['items']:
            lv[it['level']] = lv.get(it['level'], 0) + 1
        if lv.get('공통', 0) == 0 and p['kind'] != '교과서':
            warns.append('%s: 원 기출이 없습니다' % tag)
    for w in warns:
        print('  알림:', w)
    for e in errs:
        print('  오류:', e)
    print('검사', '통과' if not errs else '실패 %d건' % len(errs), '— 지문 %d개 · 문항 %d개' % (len(res), sum(len(p['items']) for p in res)))
    return not errs


def put(res):
    if not check(res):
        sys.exit(1)
    for k, p in enumerate(res):
        row = {x: p[x] for x in ('id', 'title', 'src', 'srcname', 'kind', 'area', 'grade', 'data', 'imgs', 'plain')}
        row['active'] = True
        rest('POST', '/reading_passages?on_conflict=id', [row], 'resolution=merge-duplicates,return=minimal')
        rows = [{'passage_id': p['id'], 'level': i['level'], 'code': i['code'], 'sec_name': i['sec_name'], 'v': i['v'],
                 'ord': i['ord'], 'kind': i['kind'], 'data': i['data'], 'plain': i['plain'], 'active': True} for i in p['items']]
        for j in range(0, len(rows), 200):
            rest('POST', '/reading_items?on_conflict=passage_id,level,code,v,ord', rows[j:j + 200],
                 'resolution=merge-duplicates,return=minimal')
        have = rest('GET', '/reading_items?select=id,level,code,v,ord&active=is.true&passage_id=eq.' + urllib.parse.quote(p['id']))
        keep = {(i['level'], i['code'], i['v'], i['ord']) for i in p['items']}
        gone = [h['id'] for h in have if (h['level'], h['code'], h['v'], h['ord']) not in keep]
        if gone:
            rest('PATCH', '/reading_items?id=in.(%s)' % ','.join(map(str, gone)), {'active': False}, 'return=minimal')
        print('올림:', p['id'], '| 문항', len(rows), '| 숨김', len(gone))


def lst():
    ps = rest('GET', '/reading_passages?select=id,title,srcname,kind,area,active&order=id')
    its = []
    off = 0
    while True:
        part = rest('GET', '/reading_items?select=passage_id,level&active=is.true&order=id&limit=1000&offset=%d' % off)
        its += part
        if len(part) < 1000:
            break
        off += 1000
    for p in ps:
        c = {}
        for i in its:
            if i['passage_id'] == p['id']:
                c[i['level']] = c.get(i['level'], 0) + 1
        print(p['id'], '|', p['title'], '|', p['srcname'], p['kind'], '|', p['area'], '|', c, '' if p['active'] else '(숨김)')
    print('지문', len(ps), '· 문항', len(its))


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == 'build':
        over = {}
        rest_args = []
        k = 1
        while k < len(a):
            if a[k] == '--area':
                t, v = a[k + 1].rsplit('=', 1)
                over[t.strip()] = v.strip()
                k += 2
            else:
                rest_args.append(a[k])
                k += 1
        res = build(rest_args[0], rest_args[1:], over)
        check(res)
    elif a[0] == 'check':
        sys.exit(0 if check(json.load(open(a[1], encoding='utf8'))) else 1)
    elif a[0] == 'put':
        put(json.load(open(a[1], encoding='utf8')))
    elif a[0] == 'list':
        lst()
    else:
        sys.exit(__doc__)
