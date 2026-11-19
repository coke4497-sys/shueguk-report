#!/usr/bin/env python3
"""Shuefit 독서 — 국어공방 '비문학 문제 풀이'(교과서 지문) 옛 .hwp(HWP 5) 를 읽는다 (2026-11-19, 081).

reading_hwpx.py 의 모의고사 묶음(원 기출 + 기본·실력)과 짜임이 다르다 — 교과서 지문 하나에 한 파일, 난도 구분 없음:
  지문(+◆ 어휘 풀이) → 03-02 문단별 정리 → 03-02(둘째) 지문 분석 → 03-03a/b OX → 03-04 모의고사형 →
  03-05a/b/c 보기형·고난도·1등급 → 03-06 문단별 정리(빈칸, [답안]) → 03-07 정오답 선지 근거 →
  03-08a/b 주관식·조건형 → 03-09 키워드 빈칸.
문항마다 [정답] 줄이 두 번(학생용 가림 사본) 있어 같은 줄이 이어지면 하나만 쓴다.

파일 이름 = '[비상 독서와 작문]5-(1)-1 무엇이 내 삶의 정치일까(설규주).hwp' (2026-11-19 원장님 규칙).
이름이 그 꼴이 아니면 파일 안 머리글('[국어공방][22개정][비상독서와작문]' + '5-(1)-1 제목(작가)')로 읽는다.

  python3 -I tools/reading_hwp5.py <파일.hwp> <out.json>    # 변환 결과 보기
올리기는 reading_load.py build (.hwp 를 넘기면 이 모듈을 쓴다).
"""
import html
import json
import os
import re
import struct
import sys
import zlib

import olefile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reading_hwpx as RH  # noqa: E402

T_CHAR_SHAPE, T_PARA_HEADER, T_PARA_TEXT, T_PARA_CHAR_SHAPE = 21, 66, 67, 68
EXT_CTRL = {1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}
INL_CTRL = {4, 5, 6, 7, 8, 9, 19, 20}

# 교과서 묶음 구역 → reading_items.code (모의고사 묶음 02~10·99 와 겹치지 않게 11~19)
SECS = [
    (r'03-03a', '11', 'OX 쉬움'), (r'03-03b', '12', 'OX 어려움'), (r'03-04', '13', '모의고사형'),
    (r'03-05a', '14', '보기형'), (r'03-05b', '15', '고난도 보기형'), (r'03-05c', '16', '1등급 보기형'),
    (r'03-08a', '17', '주관식'), (r'03-08b', '18', '조건형 서술'), (r'03-09', '19', '키워드 빈칸'),
]
# 문학 '시(소설…) 문제 풀이'(2026-11-19, 086) — 구역 번호가 '01-'로 시작하고 뒤 번호는 같다. 코드는 교과서와 같은 11~19, 이름만 문학식.
LIT_SECS = {'03a': ('11', 'OX 쉬움'), '03b': ('12', 'OX 어려움'), '04': ('13', '표현법·시어의 의미'), '05a': ('14', '보기형'),
            '05b': ('15', '고난도 보기형'), '05c': ('16', '참고자료 보기형'), '08a': ('17', '주관식'), '08b': ('18', '조건형 서술'),
            '09': ('19', '키워드 빈칸')}
GENRE = {'현시': '현대시', '고시': '고전시가', '현소': '현대소설', '고소': '고전소설', '수필': '수필', '극': '극'}
SEC_HEAD = re.compile(r'^(0\d-\d+[a-z]?)\s+\S')
JUNK = re.compile(r'^(국어공방|••|\[\s*국어공방\s*\]\s*\S+\s*문제 풀이|\[국어공방\]\[[^\]]*\]\[[^\]]*\]|\[국어공방\]\[[^\]]*\])$')
# 원본에 남은 AI 대화 문장(5-(1)-2 지문 분석 머리) — 학생 자료에 싣지 않는다
CHAT = re.compile(r'^(물론이야|물론입니다|네,? 알겠|요청한 형식|아래와 같이 정리|첨부된 지문)')


def _recs(d):
    p = 0
    while p < len(d):
        h = struct.unpack('<I', d[p:p + 4])[0]; p += 4
        tag, lvl, size = h & 0x3ff, (h >> 10) & 0x3ff, h >> 20
        if size == 0xfff:
            size = struct.unpack('<I', d[p:p + 4])[0]; p += 4
        yield tag, lvl, d[p:p + size]
        p += size


def _shapes(o, comp):
    d = o.openstream('DocInfo').read()
    if comp:
        d = zlib.decompress(d, -15)
    out = []
    for tag, _l, b in _recs(d):
        if tag == T_CHAR_SHAPE and len(b) >= 50:
            prop = struct.unpack('<I', b[46:50])[0]
            out.append({'b': bool(prop & 2), 'u': ((prop >> 2) & 3) == 1})
    return out


def pua_fix(x):
    """한글 전용 기호(사용자 정의 글자) → 보통 글자. 화면 글꼴에 없어 네모 칸으로 보인다."""
    x = re.sub('\uf000([^\uf000]*)\uf000', '『\\1』', x)
    x = x.replace('\uf077', '◆')                 # 어휘 풀이가 있는 낱말 표시
    return re.sub('[\ue000-\uf8ff]', '', x)

def _para_html(body, runs, shapes):
    """PARA_TEXT(utf-16) + 글자 모양 구간 → (글, html)."""
    n = len(body) // 2
    w = struct.unpack('<%dH' % n, body[:2 * n])
    chars = []                        # (위치, 문자)
    j = 0
    while j < n:
        c = w[j]
        if c < 32:
            if c in EXT_CTRL or c in INL_CTRL:
                if c == 9:
                    chars.append((j, ' '))
                j += 8; continue
            if c == 10:
                chars.append((j, '\n'))
            j += 1; continue
        chars.append((j, chr(c))); j += 1
    runs = sorted(runs) or [(0, 0)]

    def sh(pos):
        k = 0
        for i, (p, _s) in enumerate(runs):
            if p <= pos:
                k = i
        sid = runs[k][1]
        return shapes[sid] if sid < len(shapes) else {'b': False, 'u': False}
    t = ''.join(ch for _p, ch in chars)
    out, cur = [], {'b': False, 'u': False}
    for pos, ch in chars:
        s = sh(pos) if ch.strip() else cur
        if s != cur:
            if cur['u']: out.append('</u>')
            if cur['b']: out.append('</b>')
            if s['b']: out.append('<b>')
            if s['u']: out.append('<u>')
            cur = s
        out.append(html.escape(ch, quote=False))
    if cur['u']: out.append('</u>')
    if cur['b']: out.append('</b>')
    h = ''.join(out)
    t, h = pua_fix(t), pua_fix(h)
    h = re.sub(r'</u>(\s*)<u>', r'\1', re.sub(r'</b>(\s*)<b>', r'\1', h))
    return t, h


def lines(path):
    """옛 .hwp → [{'t': 글, 'h': html, 'lvl': 깊이}] (본문 순서)."""
    o = olefile.OleFileIO(path)
    hdr = o.openstream('FileHeader').read()
    comp = struct.unpack('<I', hdr[36:40])[0] & 1
    if struct.unpack('<I', hdr[36:40])[0] & 2:
        raise SystemExit('암호가 걸린 hwp 입니다: ' + path)
    shapes = _shapes(o, comp)
    out = []
    i = 0
    while o.exists('BodyText/Section%d' % i):
        d = o.openstream('BodyText/Section%d' % i).read()
        if comp:
            d = zlib.decompress(d, -15)
        cur = None
        for tag, lvl, b in _recs(d):
            if tag == T_PARA_HEADER:
                if cur:
                    out.append(cur)
                cur = {'lvl': lvl, 'body': b'', 'runs': []}
            elif tag == T_PARA_TEXT and cur is not None:
                cur['body'] = b
            elif tag == T_PARA_CHAR_SHAPE and cur is not None:
                k = len(b) // 8
                cur['runs'] = [struct.unpack('<II', b[8 * j:8 * j + 8]) for j in range(k)]
        if cur:
            out.append(cur)
        i += 1
    res = []
    for p in out:
        t, h = _para_html(p['body'], p['runs'], shapes)
        for k, (tt, hh) in enumerate(zip(t.split('\n'), h.split('\n'))):
            res.append({'t': tt.strip(), 'h': hh.strip(), 'lvl': p['lvl']})
    return res


def name_info(fname, L):
    """(교과서, 단원, 제목, 작가)."""
    base = os.path.splitext(os.path.basename(fname))[0]
    m = re.match(r'^\[([^\]]+)\]\s*(\d+-\(\d+\)-\d+)\s*(.+?)\s*\(([^()]+)\)\s*$', base)
    if m:
        return m.group(1).strip(), m.group(2), m.group(3).strip(), m.group(4).strip()
    book = unit = title = author = ''
    for x in L[:20]:
        t = x['t']
        mb = re.match(r'^\[국어공방\]\[[^\]]*\]\[([^\]]+)\]$', t)
        if mb:
            book = mb.group(1)
        mu = re.match(r'^(\d+-\(\d+\)-\d+)\s*(.+?)\s*\(([^()]+)\)$', t)
        if mu:
            unit, title, author = mu.group(1), mu.group(2), mu.group(3)
    return book, unit, title, author


def nice_book(b):
    """'비상독서와작문' → '비상 독서와 작문' (파일 이름이 띄어 쓴 꼴이면 그대로)."""
    if ' ' in b:
        return b
    m = re.match(r'^(비상|천재|미래엔|창비|지학사|동아|해냄|좋은책신사고|신사고|금성|교학사|비유와상징|visang)(.+)$', b)
    if not m:
        return b
    rest = m.group(2).replace('독서와작문', '독서와 작문').replace('화법과언어', '화법과 언어').replace('문학과영상', '문학과 영상')
    return m.group(1) + ' ' + rest


def title_space(t, book):
    """머리글에서 읽은 '문화를담은건축물' 처럼 붙은 제목은 그대로 둔다(파일 이름 규칙으로 고친다)."""
    return t


def lit_info(fname, L):
    """문학 — (출처, 제목, 작가). 파일 이름 '[국어공방][26EBS수특문학-29현시]멸치(김기택) [국어공방] JY….hwp' 또는 머리글."""
    base = os.path.splitext(os.path.basename(fname))[0]
    m = re.search(r'\[국어공방\]\[([^\]]+)\]\s*([^\[\]]+?)\s*\(([^()]+)\)', base)
    if m:
        return m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
    src = title = author = ''
    for x in L[:40]:
        mb = re.match(r'^\[국어공방\]\[([^\]]+)\]$', x['t'])
        if mb:
            src = mb.group(1)
        mt = re.match(r'^(.+?)\s*\(([^()]+)\)$', x['t'])
        if src and mt and not title:
            title, author = mt.group(1), mt.group(2)
    return src, title, author


def lit_passage(L):
    """문학 지문 — 머리글 '제목 (작가)' 다음 줄부터 첫 구역 전까지. 빈 줄 = 연 나눔, '- 작가, <제목>' = 출처."""
    out, stanza, started, seen = [], [], False, False
    for x in L:
        t = x['t']
        if not started:
            if re.match(r'^\[국어공방\]\[[^\]]+\]$', t):
                seen = True; continue
            if seen and re.match(r'^.+\s*\([^()]+\)$', t):
                started = True
            continue
        if SEC_HEAD.match(t) and len(t) < 40:
            break
        if not t:
            if stanza and x['lvl'] == 0:
                out.append({'p': '<br>'.join(stanza)}); stanza = []
            continue
        if JUNK.match(t) or t.startswith('▣'):
            continue
        if re.match(r'^-\s*\S+,\s*[<〈「]', t):
            if stanza:
                out.append({'p': '<br>'.join(stanza)}); stanza = []
            out.append({'p': RH.norm_u(x['h']), 'src': 1}); continue
        stanza.append(RH.norm_u(x['h']))
    if stanza:
        out.append({'p': '<br>'.join(stanza)})
    return out


INL_HEAD = re.compile(r'(0\d-\d+[a-z]?\s+(?:시|소설|수필|극|고전시가|고전소설|현대시|현대소설)?\s*(?:변형\s*)?(?:OX\s*어려움|OX\s*쉬움|핵심\s*정리|\S*보기형|주관식(?:\s*조건형)?|분석\s*정오답\s*선지|표현법\S*))')


def unfloat(L):
    """글상자로 떠 있는 구역 머리글이 문장 한가운데 끼어 나온 줄 — '…생명01-03b 시 OX어려움의 비가역적…' 을 떼어
    그 문항(바로 뒤의 같은 [정답] 줄 사본까지) 다음에 머리글 줄로 넣는다."""
    out, k = [], 0
    while k < len(L):
        x = L[k]
        m = INL_HEAD.search(x['t'])
        if m and m.start() > 0:
            head = m.group(1)
            x = dict(x, t=x['t'].replace(head, '', 1), h=x['h'].replace(head, '', 1))
            out.append(x)
            j = k + 1
            while j < len(L) and not L[j]['t']:
                j += 1
            if j < len(L) and L[j]['t'] == x['t']:
                out.extend(L[k + 1:j + 1]); k = j
            out.append({'t': head, 'h': head, 'lvl': 0})
            k += 1; continue
        out.append(x); k += 1
    return out


def lit_table(L2):
    """문학 작품 정리 — 표 칸(lvl ≥ 1)이 '제목' / '멸치'처럼 한 줄씩 풀려 나온다. 이름 칸 + 값 칸을 한 줄('<b>제목</b> 멸치')로,
    값이 여러 줄이면 이름 칸을 굵게 한 줄 두고 값을 잇는다. 이름 칸 = 문장 끝(. 다 함 음 됨 임)이 아니고 '-'·'→'로 시작하지 않는 40자 이하 줄."""
    def is_lab(x):
        t = x['t']
        return x['lvl'] >= 1 and len(t) <= 40 and not re.search(r'[.다함음됨임?]$', t) and not t.startswith(('-', '→', '▷'))
    out, k = [], 0
    while k < len(L2):
        x = L2[k]
        if not is_lab(x):
            out.append(x); k += 1; continue
        j = k + 1
        vals = []
        while j < len(L2) and L2[j]['lvl'] >= 1 and not is_lab(L2[j]):
            vals.append(L2[j]); j += 1
        if len(vals) == 0 and j < len(L2) and L2[j]['lvl'] >= 1 and len(L2[j]['t']) <= 40 and is_lab(L2[j]) and len(x['t']) <= 12 \
                and not (j + 1 < len(L2) and L2[j + 1]['lvl'] >= 1 and not is_lab(L2[j + 1])):
            vals = [L2[j]]; j += 1      # 값도 짧은 칸('멸치', '김기택')
        lab = x['h'] if re.fullmatch(r'<b>.*</b>', x['h']) else '<b>' + x['h'] + '</b>'
        if len(vals) == 1 and len(vals[0]['t']) <= 80 and not vals[0]['t'].startswith('-'):
            out.append(dict(x, t=x['t'] + ' ' + vals[0]['t'], h=lab + '　' + vals[0]['h']))
        else:
            out.append(dict(x, h=lab)); out.extend(vals)
        k = j
    return out


def convert(path, fname=None):
    L = lines(path)
    lit = any(re.match(r'^01-\d', x['t']) for x in L)
    if lit:
        L = unfloat(L)
    if lit:
        src, title, author = lit_info(fname or path, L)
        mg = re.search(r'(현시|고시|현소|고소|수필|극)$', src)
        book, unit = src, ''
    else:
        book, unit, title, author = name_info(fname or path, L)
    book = nice_book(book)
    # 구역 나누기
    secs = []
    cur = {'code': 'pas', 'lines': []}
    for x in L:
        t = x['t']
        if not t:
            continue
        m = SEC_HEAD.match(t) if len(t) < 40 else None
        if m:
            secs.append(cur)
            cur = {'code': m.group(1), 'name': t, 'lines': []}
            continue
        cur['lines'].append(x)
    secs.append(cur)
    # 지문
    pl = []
    started = False
    for x in secs[0]['lines']:
        t = x['t']
        if JUNK.match(t) or t.startswith('▣'):
            continue
        if not started:
            if re.match(r'^\d+-\(\d+\)-\d+', t):
                started = True
            continue
        pl.append(x)
    blocks, vocab = [], []
    k = 0
    while k < len(pl):
        x = pl[k]
        t, h = x['t'], RH.norm_u(x['h'])
        if t.startswith('◆') or (vocab and t.startswith('예)')):
            vocab.append(h); k += 1; continue
        if re.match(r'^-\s*\S+,\s*<', t):
            blocks.append({'p': h, 'src': 1}); k += 1; continue
        # 지문 속 그림(글자 칸 여럿 + 설명 한 줄) — '木 本 末 未 / 나무 목 …' → 작은 표 + 설명
        run = []
        while k + len(run) < len(pl) and len(pl[k + len(run)]['t']) <= 8 and not re.search(r'[.?]$', pl[k + len(run)]['t']):
            run.append(pl[k + len(run)])
        if len(run) >= 4 and len(run) % 2 == 0 and k + len(run) < len(pl):
            cap = pl[k + len(run)]
            if len(cap['t']) <= 30 and not re.search(r'[.?]$', cap['t']):
                half = len(run) // 2
                blocks.append({'tbl': [[RH.norm_u(c['h']) for c in run[:half]], [RH.norm_u(c['h']) for c in run[half:]]]})
                blocks.append({'p': RH.norm_u(cap['h']), 'cap': 1})
                k += len(run) + 1; continue
        sub = len(t) <= 34 and not re.search(r'[.]$', t) and (re.fullmatch(r'<b>.*</b>', h) or len(t) <= 24)
        blocks.append({'p': h, 'sub': 1} if sub else {'p': h})
        k += 1
    passage = {'blocks': blocks}
    if vocab:
        passage['vocab'] = vocab
    if lit:
        passage = {'blocks': lit_passage(L)}
    doc = {'file': os.path.basename(fname or path), 'book': book, 'unit': unit, 'title': title, 'author': author,
           'lit': lit, 'genre': (GENRE[mg.group(1)] if lit and mg else ''),
           'passage': passage, 'notes': [], 'analysis': [], 'blanks': None, 'keys': [], 'sections': [], 'imgs': {},
           'removed': [], 'fixed': []}
    seen02 = 0
    for s in secs[1:]:
        c = s['code']
        L2 = []
        for x in s['lines']:
            if JUNK.match(x['t']):
                continue
            if CHAT.match(x['t']):
                doc['removed'].append(x['t']); continue
            x = dict(x)
            if re.match(r'^▷\[모[^\]]*\]', x['t']) and not x['t'].startswith('▷[모범답안]'):   # 원본 오타 '▷[모OBUMDAPAN]'
                doc['fixed'].append(x['t'][:30])
                x['t'] = re.sub(r'^▷\[모[^\]]*\]', '▷[모범답안]', x['t']); x['h'] = re.sub(r'^▷\[모[^\]]*\]', '▷[모범답안]', x['h'])
            if x['t'].startswith('#'):
                x['t'] = re.sub(r'^#+\s*', '', x['t']); x['h'] = re.sub(r'^#+\s*', '', x['h'])
            L2.append(x)
        if lit:
            c = '03-' + c.split('-', 1)[1]
        if lit and c == '03-02':
            L2 = lit_table(L2)
        if c == '03-02':
            seen02 += 1
            (doc['notes'] if seen02 == 1 else doc['analysis']).extend(RH.parse_notes(L2))
            continue
        if c == '03-06':
            doc['blanks'] = RH.parse_blanks(L2); continue
        if c == '03-07':
            doc['keys'] = RH.parse_notes(L2); continue
        hit = next((sc for sc in SECS if sc[0] == c), None)
        if lit and c[3:] in LIT_SECS:
            hit = (c, LIT_SECS[c[3:]][0], LIT_SECS[c[3:]][1])
        if not hit:
            doc['sections'].append({'code': '?', 'name': s['name'], 'items': [], 'rest': [x['t'] for x in L2[:3]]})
            continue
        # 학생용 가림 사본(같은 [정답] 줄이 바로 이어짐) 빼기
        dd, last = [], None
        for x in L2:
            if x['t'].startswith('[정답]') and last is not None and x['t'] == last:
                continue
            last = x['t'] if x['t'].startswith('[정답]') else None
            dd.append(x)
        items, rest = RH.parse_items(dd)
        for it in items:
            if it['kind'] == 'ox' or re.search(r'\(\s*O\s*/\s*X\s*\)\s*$', it.get('stem', '')):
                it['stem'] = re.sub(r'\s*\(\s*O\s*/\s*X\s*\)\s*$', '', it['stem'])
        prev = next((x for x in doc['sections'] if x['code'] == hit[1]), None)
        if prev:   # 같은 구역이 둘(01-05c 두 묶음) — 한 유형으로 잇는다
            prev['items'].extend(items)
            if rest:
                prev.setdefault('rest', []).extend(x['t'] for x in rest)
            continue
        e = {'code': hit[1], 'name': hit[2], 'v': 1, 'items': items}
        if rest:
            e['rest'] = [x['t'] for x in rest]
        doc['sections'].append(e)
    return doc


if __name__ == '__main__':
    d = convert(sys.argv[1])
    json.dump(d, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(d['file'], '|', d['book'], d['unit'], d['title'], '(%s)' % d['author'],
          '| 지문 문단', len(d['passage']['blocks']), '어휘', len(d['passage'].get('vocab', [])))
    print('  문단별 정리', len(d['notes']), '| 분석', len(d['analysis']), '| 빈칸', d['blanks'] and len(d['blanks']['answers']),
          '| 정오답 근거', len(d['keys']), '| 뺀 줄', d['removed'], '| 고친 줄', d['fixed'])
    for s in d['sections']:
        ks = {}
        for it in s['items']:
            ks[it['kind']] = ks.get(it['kind'], 0) + 1
        print('  ', s['code'], s['name'], len(s['items']), ks, ('REST:' + str(s['rest'][:2])) if s.get('rest') else '')
