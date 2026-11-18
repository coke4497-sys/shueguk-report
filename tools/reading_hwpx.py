#!/usr/bin/env python3
"""국어공방 독서 HWPX(지문 1개 묶음, 기본 또는 실력) -> 슈핏 독서 JSON 한 벌 (2026-11-18, 079).

reading_load.py 가 불러 쓴다. 혼자 돌리면 구역별 문항 수를 보여 준다:
  python3 -I tools/reading_hwpx.py <파일.hwpx> <out.json>
문항 글은 바꾸지 않는다 — 구조만 나누고, 밑줄(<u>)·굵게(<b>)만 HTML 로 옮긴다.
파일 짜임(국어공방 틀): 지문 → 원 기출(번호 문항 + '[출처] (정답 아이콘) ③' + 해설 두 번) → '01_핵심정리' → '02 OX'(+_v2) …
'10_핵심 요약 빈칸' → '99_독립_밑줄_고난도수능형'(그 지문은 제목 줄 앞에 '▣'로 먼저 나온다). 변형 문항은 줄마다
'[정답] … [해설] …' 로 끝난다. 표가 '①' 줄과 값 줄로 풀려 있으면(Ⓐ~Ⓒ 짝짓기) fix_grid 가 표로 다시 묶는다.
"""
import sys, os, re, json, zipfile, html, base64
import xml.etree.ElementTree as ET

def ns(t): return t.split('}')[-1]
CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
OPT_RE = re.compile(r'^([①-⑳])\s*(.*)$', re.S)
SEC_RE = re.compile(r'^(\d{2})(?:_(\d))?[ _](.+?)$')
ANS_ICON, EXP_ICON, SEP_ICON = '\U000f00bc', '\U000f00ef', '\U000f00db'

def load(path):
    z = zipfile.ZipFile(path)
    sec = ET.fromstring(z.read('Contents/section0.xml'))
    head = ET.fromstring(z.read('Contents/header.xml'))
    hpf = z.read('Contents/content.hpf').decode('utf8')
    bins = dict(re.findall(r'<opf:item id="([^"]+)" href="(BinData/[^"]+)"', hpf))
    cp = {}
    for e in head.iter():
        if ns(e.tag) == 'charPr':
            f = set()
            for c in e:
                n = ns(c.tag)
                if n == 'bold': f.add('b')
                if n == 'underline' and c.get('type') not in (None, 'NONE'): f.add('u')
            cp[e.get('id')] = f
    return z, sec, cp, bins

def run_html(r, cp):
    f = cp.get(r.get('charPrIDRef'), set())
    out = ''
    for c in r:
        if ns(c.tag) == 't':
            s = html.escape(''.join(c.itertext()))
            if not s: continue
            if 'u' in f: s = '<u>%s</u>' % s
            if 'b' in f: s = '<b>%s</b>' % s
            out += s
    return out

def para_lines(sec, cp, bins, z, imgs):
    """맨 위 문단마다 {h:html, t:text} 또는 {img:..}/{tbl:[[..]]}."""
    lines = []
    for i, p in enumerate(sec):
        if ns(p.tag) != 'p': continue
        h = ''; extra = []
        for r in p:
            if ns(r.tag) != 'run': continue
            h += run_html(r, cp)
            for x in r:
                n = ns(x.tag)
                if n == 'pic':
                    for im in x.iter():
                        ref = im.get('binaryItemIDRef')
                        if ref and ref in bins:
                            name = os.path.basename(bins[ref])
                            if name not in imgs:
                                imgs[name] = base64.b64encode(z.read(bins[ref])).decode()
                            extra.append({'img': name})
                            break
                elif n == 'tbl' and i > 0:
                    rows = []
                    for tr in x.iter():
                        if ns(tr.tag) != 'tr': continue
                        cells = []
                        for tc in tr:
                            if ns(tc.tag) != 'tc': continue
                            ps = []
                            for pp in tc.iter():
                                if ns(pp.tag) == 'p':
                                    ps.append(''.join(run_html(rr, cp) for rr in pp if ns(rr.tag) == 'run'))
                            cells.append('<br>'.join(s for s in ps if s))
                        rows.append(cells)
                    extra.append({'tbl': rows})
        h = h.replace('󰡔', '『').replace('󰡕', '』')
        t = html.unescape(re.sub(r'<[^>]+>', '', h)).strip()
        if i == 0: continue           # 쪽 머리 표
        lines.append({'h': h.strip(), 't': t})
        lines.extend(extra)
    return lines

def norm_u(h):
    # '<u>‘완전경쟁시장</u>’' 같은 따옴표 걸침 정리 없음 — 원문 그대로
    return re.sub(r'</u><u>', '', re.sub(r'</b><b>', '', h))

# ---------- 지문 ----------
def parse_passage(L):
    blocks = []; title = ''
    pend_bracket = None; vocab = None
    for x in L:
        if 'img' in x or 'tbl' in x:
            blocks.append(x); continue
        t, h = x['t'], norm_u(x['h'])
        if not t: continue
        if t.startswith('▣'): continue
        if vocab is not None:
            vocab.append(h); continue
        if t == '[어휘 풀이]':
            vocab = []; continue
        if re.fullmatch(r'\[[A-Z]\]', t):
            pend_bracket = t; continue
        m = re.fullmatch(r'\((가|나|다|라)\)', t)
        if m:
            blocks.append({'label': t}); continue
        m = re.match(r'^\((가|나|다|라)\)\s*', t)
        if m:
            blocks.append({'label': m.group(0).strip()})
            h = re.sub(r'^\((?:가|나|다|라)\)\s*', '', h)
        b = {'p': h}
        if pend_bracket: b['bracket'] = pend_bracket; pend_bracket = None
        blocks.append(b)
    out = {'blocks': blocks}
    if vocab: out['vocab'] = vocab
    return out

# ---------- 문항 몸통 ----------
def build_item(body, kind_hint=''):
    """body = 정답 줄 앞 줄들. stem/box/options/cond/model 로 나눈다."""
    it = {'stem': '', 'box': [], 'opts': [], 'cond': [], 'model': ''}
    mode = 'stem'
    for x in body:
        if 'img' in x or 'tbl' in x:
            (it['box'] if mode in ('stem', 'box') else it['cond']).append(x); continue
        t, h = x['t'], norm_u(x['h'])
        if not t: continue
        if re.fullmatch(r'<?\s*보\s*기\s*>?', t): mode = 'box'; continue
        if re.fullmatch(r'<\s*조\s*건\s*>', t): mode = 'cond'; continue
        if t.startswith('▷[모범답안]'):
            it['model'] = re.sub(r'^▷\[모범답안\]\s*', '', h); continue
        m = OPT_RE.match(t)
        if m and mode != 'cond':
            mode = 'opts'
            it['opts'].append(re.sub(r'^[①-⑳]\s*', '', h)); continue
        if mode == 'stem' and not it['stem']:
            it['stem'] = re.sub(r'^\d+\.\s*', '', h); continue
        if mode == 'opts':                     # 표 모양 선지의 값 줄
            it.setdefault('grid_vals', []).append(h); continue
        if mode == 'cond': it['cond'].append({'p': h}); continue
        it['box'].append({'p': h}); mode = 'box' if mode == 'stem' else mode
    fix_grid(it)
    for k in ('box', 'opts', 'cond', 'model'):
        if not it[k]: it.pop(k)
    return it

def fix_grid(it):
    """선지가 '①' 만 있고 값이 다음 줄로 흩어진 짝짓기 표 -> grid."""
    if not it.get('opts') or any(o.strip() for o in it['opts']): return
    vals = it.pop('grid_vals', [])
    n = len(it['opts'])
    if not vals or len(vals) % n: return
    k = len(vals) // n
    # 머리(Ⓐ Ⓑ Ⓒ)는 box 끝의 k 줄
    head = [b['p'] for b in it['box'][-k:]] if len(it['box']) >= k else []
    if head and all(len(re.sub('<[^>]+>', '', h)) <= 3 for h in head):
        it['box'] = it['box'][:-k]
    else:
        head = []
    it['grid'] = {'head': head, 'rows': [vals[i*k:(i+1)*k] for i in range(n)]}
    it['opts'] = [' · '.join(re.sub('<[^>]+>', '', v) for v in r) for r in it['grid']['rows']]

def kind_of(it, ans):
    if re.fullmatch(r'[OX]', ans): return 'ox'
    if 'opts' in it:
        a = ans.replace(' ', '')
        if re.fullmatch('[①-⑤]', a) and len(it['opts']) == 5: return 'choice'
        return 'multi'
    if 'model' in it: return 'blank'
    return 'essay'

def ans_expl(t):
    m = re.match(r'^\[정답\]\s*(.*?)\s*\[해설\]\s*(.*)$', t, re.S)
    if m: return m.group(1).strip(), m.group(2).strip()
    return re.sub(r'^\[정답\]\s*', '', t).strip(), ''

def parse_items(L):
    items = []; body = []
    for x in L:
        t = x.get('t', '')
        if t.startswith('[정답]'):
            it = build_item(body)
            a, e = ans_expl(t)
            it['ans'] = a; it['expl'] = e; it['kind'] = kind_of(it, a)
            items.append(it); body = []
        else:
            if t or 'img' in x or 'tbl' in x: body.append(x)
    return items, body   # body = 남은 줄(정답 없는)

# ---------- 원 기출 ----------
def parse_orig(L):
    items = []; cur = None; state = 'q'
    for x in L:
        t = x.get('t', '')
        if re.match(r'^\d+\.\s', t) and (cur is None or state == 'done'):
            cur = {'body': [x]}; items.append(cur); state = 'q'; continue
        if cur is None: continue
        if state == 'q':
            m = re.match(r'^\[([^\]]+)\]\s*' + ANS_ICON + r'\s*(.+)$', t)
            if m:
                cur['src'] = m.group(1); cur['ans'] = m.group(2).strip(); state = 'a'; continue
            cur['body'].append(x); continue
        if t.startswith(EXP_ICON) and 'expl' not in cur:
            e = t[len(EXP_ICON):].strip()
            cur['expl'] = e.replace(SEP_ICON, '\n').strip(); state = 'done'
    out = []; tail = []
    for c in items:
        it = build_item(c['body'])
        it['ans'] = c.get('ans', ''); it['expl'] = c.get('expl', ''); it['src'] = c.get('src', '')
        it['kind'] = kind_of(it, it['ans'])
        out.append(it)
    return out

def parse_notes(L):
    """핵심정리: 줄을 그대로(들여쓰기 유지). 머리줄 구분."""
    out = []
    for x in L:
        if 'img' in x or 'tbl' in x: out.append(x); continue
        if not x['t']: continue
        out.append({'p': norm_u(x['h'])})
    return out

def parse_blanks(L):
    lines = parse_notes(L); ans = ''
    keep = []
    for b in lines:
        p = b.get('p', '')
        if p.startswith('[답안]'): ans = p[4:].strip(); continue
        keep.append(b)
    amap = dict(re.findall(r'\((\d+)\)\s*([^()]+?)(?=\s*\(\d+\)|$)', html.unescape(re.sub('<[^>]+>', '', ans))))
    return {'lines': keep, 'answers': {k: v.strip() for k, v in amap.items()}}

def convert(path, fname=None):
    z, sec, cp, bins = load(path)
    imgs = {}
    L = para_lines(sec, cp, bins, z, imgs)
    # 구역 나누기
    secs = []; cur = {'code': '00', 'name': '원문', 'v': 1, 'lines': []}
    pend = None          # 다음 구역(99 독립)에 붙일 지문
    for x in L:
        t = x.get('t', '')
        m = SEC_RE.match(t) if t else None
        if m and len(t) < 40 and not t[2:3].isdigit():
            secs.append(cur)
            name = m.group(3); v = 1
            mv = re.search(r'_v(\d)$', name)
            if mv: v = int(mv.group(1)); name = name[:mv.start()]
            code = m.group(1) + ('_' + m.group(2) if m.group(2) else '')
            cur = {'code': code, 'name': name.replace('_', ' ').strip(), 'v': v, 'lines': []}
            if pend is not None: cur['pas'] = pend; pend = None
        elif t.startswith('▣') and cur['code'] != '00':
            pend = []
        elif pend is not None and (t or 'img' in x) and not t.startswith(('[정답]',)) and not OPT_RE.match(t) and not re.search(r'(것은|것인가|하시오)[.?]?$', t):
            pend.append(x)
        else:
            if pend is not None and t:
                cur['lines'].extend(pend); pend = None
            cur['lines'].append(x)
    secs.append(cur)
    head = secs[0]['lines']
    qi = next(i for i, x in enumerate(head) if re.match(r'^1\.\s', x.get('t', '')))
    pas = head[:qi]
    title = ''
    # 첫 줄이 제목이면(▣ 앞) 떼어 둔다
    tl = [x for x in pas if x.get('t')]
    if len(tl) > 2 and not tl[1]['t'].startswith('▣') and tl[0]['t'].startswith('▣') and tl[2]['t'].startswith('▣'):
        title = tl[1]['t']; pas = [x for x in pas if x is not tl[1]]
    doc = {
        'file': fname or os.path.basename(path),
        'title': title or re.sub(r'\s*(기본|실력)$', '', re.sub(r'^(\([^)]*\))+', '', os.path.splitext(fname or os.path.basename(path))[0])).strip(),
        'level': (re.search(r'(기본|실력)\s*$', os.path.splitext(fname or os.path.basename(path))[0]) or [None,''])[1],
        'tags': re.findall(r'\(([^)]*)\)', fname or os.path.basename(path)),
        'passage': parse_passage(pas),
        'orig': parse_orig(head[qi:]),
        'sections': [], 'imgs': imgs,
    }
    # 원 기출 뒤에 붙는 범위 표시('시장의 유일한~수 있다.')
    rng = [x['t'] for x in head[qi:] if re.fullmatch(r'[^~\d.]{2,15}~[^~]{2,15}\.', x.get('t', ''))]
    if rng: doc['passage']['range'] = rng[-1]
    for s in secs[1:]:
        e = {'code': s['code'], 'name': s['name'], 'v': s['v']}
        if s['code'] == '01':
            e['notes'] = parse_notes(s['lines'])
        elif s['code'] == '10':
            e['blanks'] = parse_blanks(s['lines'])
        else:
            lines = s['lines']
            if s.get('pas'): e['passage'] = parse_passage(s['pas'])
            items, rest = parse_items(lines)
            e['items'] = items
            if rest: e['rest'] = [x.get('t', '') for x in rest if x.get('t')]
        doc['sections'].append(e)
    return doc

if __name__ == '__main__':
    d = convert(sys.argv[1])
    json.dump(d, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    n = sum(len(s.get('items', [])) for s in d['sections'])
    print(d['file'], '| 원 기출', len(d['orig']), '| 변형 문항', n, '| 구역', len(d['sections']))
    for s in d['sections']:
        ks = {}
        for it in s.get('items', []): ks[it['kind']] = ks.get(it['kind'], 0) + 1
        print('  ', s['code'], s['name'], 'v%d' % s['v'], ks or '', 'passage' if 'passage' in s else '', ('REST:' + str(s['rest'][:2])) if s.get('rest') else '')
