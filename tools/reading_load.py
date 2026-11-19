#!/usr/bin/env python3
"""Shuefit 독서 — 국어공방 독서 HWPX 를 수파베이스 reading_* 표에 올린다 (2026-11-18, 079).

지문·문항(학원 자료)은 공개 저장소에 두지 않는다. HWPX 는 저장소 밖(스크래치 폴더)에 내려받아 이 도구로 올린다.
파일 이름 = '(2306고2)(사회)독점기업의이윤추구과정-공정거래법의이해 기본.hwpx' 꼴 — 첫 괄호 = 출처(연도 두 자리 + 월 + 학년),
둘째 괄호 = 영역(없으면 --area 로), 끝 = 기본|실력. 같은 지문의 기본·실력 두 파일을 함께 넘긴다.

  python3 -I tools/reading_load.py build <out.json> <a 기본.hwpx> <a 실력.hwpx> … [--area '제목=인문']
  python3 -I tools/reading_load.py build <out.json> '[비상 독서와 작문]5-(1)-1 제목(작가).hwp' …   # 교과서 묶음(081)
  python3 -I tools/reading_load.py build <out.json> '[국어공방][26EBS수특문학-29현시]멸치(김기택) ….hwp' '[기출]멸치(김기택).pdf' [--by 이름]
        # 문학(086) — 국어공방 '시 문제 풀이' .hwp + 슈국 '내신 기출' PDF(코드 30, 문항마다 독립 지문). 같은 이름 PDF 는 대조용.
        # 문학은 subject '문학'·review '검수 중'(원장님이 화면에서 [검수 완료]), --by = 올린 선생님
        # --by 이름 = 선생님이 [문항 올리기]로 올린 자료 → 어느 과목이든 '검수 중' · --subject 독서|문학|화법|작문 = 폴더 과목
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
import reading_lit_pdf as RL  # noqa: E402

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
AREAS = ['인문', '사회', '과학', '기술', '예술', '융합', '현대시', '현대소설', '고전시가', '고전소설', '수필', '극', '갈래 복합']
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


def html_un(t):
    import html as H
    return H.unescape(re.sub(r'<[^>]+>', '', t))


def lit_srcname(src):
    """'26EBS수특문학-29현시' → '2026 수능특강 문학 29'."""
    m = re.match(r'^(\d\d)EBS수특문학-(\d+)', src)
    if m:
        return '20%s 수능특강 문학 %d' % (m.group(1), int(m.group(2)))
    return src


def build_lit(d, f, pdfs, by):
    """문학 .hwp 하나(+ '[기출]제목(작가).pdf') → 지문 하나. 문항 = 국어공방 구역(11~19) + 내신 기출(30, 독립 지문)."""
    if not d['title']:
        sys.exit('작품 제목·작가를 못 읽었습니다(파일 이름 [국어공방][출처]제목(작가)…hwp): ' + f)
    slug = re.sub(r'[^0-9A-Za-z가-힣]', '', d['title'])[:24]
    src = re.sub(r'[^0-9A-Za-z가-힣-]', '', d['book'])[:30]
    pid = '문학-%s-%s' % (src, slug)
    items, notes = [], []
    for s in d['sections']:
        if s['code'] == '?':
            sys.exit('모르는 구역: %s (%s)' % (s['name'], f))
        for i, it in enumerate(s['items']):
            items.append({'level': '교과서', 'code': s['code'], 'sec_name': s['name'], 'v': 1, 'ord': i + 1,
                          'kind': it['kind'], 'data': it, 'plain': item_plain(it)})
    base = os.path.splitext(os.path.basename(f))[0]
    poem = [html_un(x) for b in d['passage']['blocks'] if not b.get('src') for x in b.get('p', '').split('<br>')]
    for pf in pdfs:
        pb = os.path.splitext(os.path.basename(pf))[0]
        m = re.match(r'^\[기출\]\s*(.+?)\s*\(([^()]+)\)$', pb)
        if m and m.group(1).replace(' ', '') == d['title'].replace(' ', ''):
            r = RL.convert(pf)
            notes += ['기출 PDF: ' + x for x in r['notes']]
            for i, it in enumerate(r['items']):
                it2 = {k: v for k, v in it.items() if k not in ('works', 'no', 'range')}
                if it.get('works'):
                    it2['passage'] = dict(it2['passage'], works=it['works'])
                items.append({'level': '교과서', 'code': '30', 'sec_name': '내신 기출', 'v': 1, 'ord': i + 1,
                              'kind': 'choice', 'data': it2, 'plain': item_plain(it2)})
            # 기출 지문 속 이 작품 행을 국어공방 원문과 대조 — 표시(㉠·[A]≪≫·ㄱ.)·마침표·띄어쓰기를 빼고도 다른 글자가 있는 행만 알린다
            import difflib
            nz = lambda t: re.sub(r"[㉠-㉭\s.‘’'\"≪≫《》]|\[[A-Z]\]|^[ㄱ-ㅎ]\.|\([一-龥]+\)", '', t)
            P0 = [(nz(w), w) for w in poem if w]
            seen = set()
            for it in r['items']:
                for b in it['passage']['blocks']:
                    for ln in b.get('p', '').split('<br>'):
                        t = html_un(re.sub(r'\s+', ' ', ln).strip()); z = nz(t)
                        if len(z) < 8 or z in seen or any(z == q for q, _ in P0):
                            continue
                        best = max(P0, key=lambda q: difflib.SequenceMatcher(None, z, q[0]).ratio())
                        if abs(len(z) - len(best[0])) <= 4 and difflib.SequenceMatcher(None, z, best[0]).ratio() >= .8:
                            seen.add(z)
                            notes.append('기출 PDF 행이 원문과 다름(%d번 등): 「%s」 ↔ 원문 「%s」' % (it['no'], t, best[1]))
        elif pb.replace(' ', '') == base.replace(' ', ''):
            import pymupdf
            txt = ''.join(pg.get_text() for pg in pymupdf.open(pf)).replace(' ', '')
            miss = [w for w in poem if w and w.replace(' ', '') not in txt]
            notes.append('같은 이름 PDF 대조: 원문 %d행 중 %d행이 PDF 에 그대로 있음' % (len(poem), len(poem) - len(miss)))
    P = d['passage']
    works = [{'title': d['title'], 'author': d['author'], 'genre': d['genre']}]
    return {
        'id': pid, 'title': d['title'], 'src': src, 'srcname': lit_srcname(d['book']),
        'kind': 'EBS' if 'EBS' in d['book'] else '', 'area': d['genre'], 'grade': '',
        'subject': '문학', 'review': '검수 중', 'uploaded_by': by,
        'data': {'passage': P, 'notes': d['notes'], 'analysis': d['analysis'], 'blanks': d['blanks'], 'keys': d['keys'],
                 'author': d['author'], 'works': works, 'levels': ['교과서'], 'file': os.path.basename(f)},
        'imgs': {},
        'plain': plain(d['title'] + ' ' + d['author'] + ' ' + ' '.join(b.get('p', '') for b in P['blocks'])),
        'items': items, '_removed': d['removed'], '_fixed': d['fixed'], '_notes': notes,
    }


def build(out, files, area_over, by=''):
    res, pdfs = [], [f for f in files if f.lower().endswith('.pdf')]
    for f in files:
        if not f.lower().endswith('.hwp'):
            continue
        d = R5.convert(f)
        res.append(build_lit(d, f, pdfs, by) if d.get('lit') else build_textbook(f, area_over))
    files = [f for f in files if not f.lower().endswith(('.hwp', '.pdf'))]
    if not files:
        json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False)
        for p in res:
            print(p['id'], '|', p['title'], '|', p['srcname'], '| 문항', len(p['items']), '| 뺀 줄', len(p['_removed']), '| 고친 줄', len(p['_fixed']))
            for n in p.get('_notes', []):
                print('   확인:', n)
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
        if not p['area'] and p['kind'] != '교과서' and p.get('subject') != '문학':
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
        if lv.get('공통', 0) == 0 and p['kind'] != '교과서' and lv.get('교과서', 0) == 0:
            warns.append('%s: 원 기출이 없습니다' % tag)
    for w in warns:
        print('  알림:', w)
    for e in errs:
        print('  오류:', e)
    print('검사', '통과' if not errs else '실패 %d건' % len(errs), '— 지문 %d개 · 문항 %d개' % (len(res), sum(len(p['items']) for p in res)))
    return not errs


def _walk(obj, path):
    ks = path.split('.')
    for k in ks[:-1]:
        obj = obj[int(k)] if isinstance(obj, list) else obj[k]
    last = ks[-1]
    return obj, (int(last) if isinstance(obj, list) else last)


def apply_edits(p, edits):
    """검수 고침(원장님 지시로 고친 글자·정답·해설·삭제)을 지문 하나에 적용한다 — 원본 파일로 다시 올려도 사라지지 않게
    reading_passages.data.edits 에 남겨 두고 put 이 다시 적용한다. 원소: {code, ord, level, v, path, old→new | set} ·
    {code, ord, level, v, delete} · {passage, path, old→new | set}. 적용하지 못한 고침(원본이 바뀌어 old 가 없음)은 돌려준다."""
    miss = []
    for e in edits:
        if e.get('passage'):
            tgt = p['data']
        else:
            hit = [i for i in p['items'] if i['code'] == e['code'] and i['ord'] == e['ord'] and i['level'] == e.get('level', i['level']) and i['v'] == e.get('v', i['v'])]
            if not hit:
                miss.append(e); continue
            if e.get('delete'):
                hit[0]['_deleted'] = True; continue
            tgt = hit[0]['data']
        try:
            o, k = _walk(tgt, e['path'])
            if 'set' in e:
                o[k] = e['set']
            else:
                cur = o[k]
                if not isinstance(cur, str) or cur.count(e['old']) != 1:
                    if isinstance(cur, str) and e['new'] in cur and e['old'] not in cur:
                        continue   # 이미 고쳐져 있음
                    miss.append(e); continue
                o[k] = cur.replace(e['old'], e['new'])
        except (KeyError, IndexError, TypeError, ValueError):
            miss.append(e)
    for i in p['items']:
        if not i.get('_deleted'):
            i['plain'] = item_plain(i['data'])
    return miss


def put(res):
    if not check(res):
        sys.exit(1)
    for k, p in enumerate(res):
        row = {x: p[x] for x in ('id', 'title', 'src', 'srcname', 'kind', 'area', 'grade', 'data', 'imgs', 'plain')}
        row['active'] = True
        for x in ('subject', 'review', 'uploaded_by'):   # 084·086
            if p.get(x):
                row[x] = p[x]
        old = rest('GET', '/reading_passages?select=data&id=eq.' + urllib.parse.quote(p['id']))
        eds = ((old[0]['data'] or {}).get('edits') or []) if old else []
        if eds:   # 앞서 검수에서 고친 것을 새로 만든 자료에도 다시 적용
            miss = apply_edits(p, eds)
            p['data']['edits'] = eds
            row['data'] = p['data']
            print('검수 고침 다시 적용: %d건' % (len(eds) - len(miss)) + (' · 적용 못 함 %d건(원본이 바뀜 — 확인)' % len(miss) if miss else ''))
        rest('POST', '/reading_passages?on_conflict=id', [row], 'resolution=merge-duplicates,return=minimal')
        rows = [{'passage_id': p['id'], 'level': i['level'], 'code': i['code'], 'sec_name': i['sec_name'], 'v': i['v'],
                 'ord': i['ord'], 'kind': i['kind'], 'data': i['data'], 'plain': i['plain'], 'active': not i.get('_deleted')} for i in p['items']]
        for j in range(0, len(rows), 200):
            rest('POST', '/reading_items?on_conflict=passage_id,level,code,v,ord', rows[j:j + 200],
                 'resolution=merge-duplicates,return=minimal')
        have = rest('GET', '/reading_items?select=id,level,code,v,ord&active=is.true&passage_id=eq.' + urllib.parse.quote(p['id']))
        keep = {(i['level'], i['code'], i['v'], i['ord']) for i in p['items'] if not i.get('_deleted')}
        gone = [h['id'] for h in have if (h['level'], h['code'], h['v'], h['ord']) not in keep]
        if gone:
            rest('PATCH', '/reading_items?id=in.(%s)' % ','.join(map(str, gone)), {'active': False}, 'return=minimal')
        print('올림:', p['id'], '| 문항', len(rows), '| 숨김', len(gone))


def edit_cmd(pid, edits):
    """올라가 있는 지문에 검수 고침을 적용·기록한다(edits.json — 위 apply_edits 형식, 문항은 id 로 줘도 된다)."""
    q = urllib.parse.quote(pid)
    P = rest('GET', '/reading_passages?select=id,data&id=eq.' + q)[0]
    its = rest('GET', '/reading_items?select=id,level,code,v,ord,kind,data&active=is.true&passage_id=eq.' + q)
    byid = {i['id']: i for i in its}
    for e in edits:   # id → (level, code, v, ord)
        if 'id' in e:
            i = byid.get(e.pop('id'))
            if not i:
                sys.exit('없는 문항 id: ' + json.dumps(e, ensure_ascii=False))
            e.update(level=i['level'], code=i['code'], v=i['v'], ord=i['ord'])
    p = {'id': pid, 'data': P['data'], 'items': its}
    miss = apply_edits(p, edits)
    if miss:
        for m in miss:
            print('적용 못 함:', json.dumps(m, ensure_ascii=False)[:300])
        sys.exit('적용하지 못한 고침이 있어 아무것도 올리지 않았습니다.')
    p['data']['edits'] = (P['data'].get('edits') or []) + edits
    rest('PATCH', '/reading_passages?id=eq.' + q, {'data': p['data']}, 'return=minimal')
    n = 0
    for i in its:
        if i.get('_deleted'):
            rest('PATCH', '/reading_items?id=eq.%d' % i['id'], {'active': False}, 'return=minimal'); n += 1
        else:
            rest('PATCH', '/reading_items?id=eq.%d' % i['id'], {'data': i['data'], 'plain': i['plain'], 'kind': i['data'].get('kind', i['kind'])}, 'return=minimal')
    print('고침 %d건 적용 · 숨긴 문항 %d' % (len(edits), n))


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
        by = subj = ''
        k = 1
        while k < len(a):
            if a[k] == '--by':
                by = a[k + 1]; k += 2
            elif a[k] == '--subject':
                subj = a[k + 1]; k += 2
            elif a[k] == '--area':
                t, v = a[k + 1].rsplit('=', 1)
                over[t.strip()] = v.strip()
                k += 2
            else:
                rest_args.append(a[k])
                k += 1
        res = build(rest_args[0], rest_args[1:], over, by)
        # [문항 올리기](087) — 선생님이 올린 자료는 모두 '검수 중'(원장님이 화면에서 [검수 완료]), 과목은 폴더대로
        if by or subj:
            for p in res:
                if by:
                    p['uploaded_by'] = by; p['review'] = '검수 중'
                if subj:
                    p['subject'] = subj
            json.dump(res, open(rest_args[0], 'w', encoding='utf8'), ensure_ascii=False)
        check(res)
    elif a[0] == 'check':
        sys.exit(0 if check(json.load(open(a[1], encoding='utf8'))) else 1)
    elif a[0] == 'put':
        put(json.load(open(a[1], encoding='utf8')))
    elif a[0] == 'edit':
        edit_cmd(a[1], json.load(open(a[2], encoding='utf8')))
    elif a[0] == 'list':
        lst()
    else:
        sys.exit(__doc__)
