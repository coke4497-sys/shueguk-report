#!/usr/bin/env python3
"""Shuefit 문학 — 슈국 '내신 기출 문제 모음' PDF(글자가 들어 있는 PDF)를 읽는다 (2026-11-19, 086).

모양(「[기출]멸치(김기택).pdf」 기준):
  '[1~2] 다음 글을 읽고 물음에 답하시오.' → 지문 — (가)·(나)·(다) 작품 여러 개, 작품 끝 '- 작가, 「제목」', 각주 '*낱말: 풀이'
  → '1. 발문' → (<보기> 줄들) → ①~⑤ 선지(줄이 꺾여 이어짐) … → 맨 뒤 '정답과 해설'(번호·정답 표 + 'n번' 해설 일부).
묶음마다 지문이 다르므로 문항마다 it['passage'] 를 단다(화면은 독서 99 '독립 지문'과 같은 길로 그린다 — 코드 '30' 내신 기출).
PDF 는 줄바꿈이 원문 행과 다를 수 있고(긴 행이 꺾임) 글자 층 자체에 오탈자가 있을 수 있다 → 검수 필요(올리면 '검수 중').

  python3 -I tools/reading_lit_pdf.py <파일.pdf> <out.json>
"""
import html
import json
import re
import sys

CIRC = '①②③④⑤'
FOOT = re.compile(r'^(다르게 하기의 힘, 이수경 국어|확인학습용 · .*|\[[^\]]+\] 내신 기출 문제 모음|\d학년\s+반\s+번\s+성명\s*:?)$')
GROUP = re.compile(r'^\[(\d+)(?:\s*[~∼]\s*(\d+))?\]\s*다음 글을 읽고')
QHEAD = re.compile(r'^(\d{1,2})\.\s+(.*)$')
LABEL = re.compile(r'^(\([가-하]\)|\[[A-Z]\])$')
SRC = re.compile(r'^-\s*([^,「｢‘<〈]+?),?\s*[「｢‘<〈]\s*(.+?)\s*[」｣’>〉]\s*-?\s*$')


def text_lines(path):
    import pymupdf
    d = pymupdf.open(path)
    out, ans = [], False
    for p in d:
        for ln in p.get_text().split('\n'):
            t = ln.strip()
            if t == '정답과 해설':
                ans = True
            if not t or FOOT.match(t) or (not ans and re.fullmatch(r'\d{1,3}', t)):
                continue
            out.append(t)
    return out


DOC = ''   # 문서 전체 글(줄바꿈 없이 이어 쓴 꼴을 찾는 데 쓴다)


def join2(a, b):
    """PDF 가 폭에 맞춰 꺾은 두 줄을 잇는다. 낱말 가운데서 꺾였는지 띄어쓰기 자리인지 글자 층에 표시가 없어,
    문서의 다른 곳(한 줄 안)에 붙여 쓴 꼴이 있으면 붙이고 아니면 띄운다."""
    if not a:
        return b
    if not b:
        return a
    if a.endswith(('/', '(', '‘', '“')):
        return a + b
    x = re.search(r'([가-힣]+)$', a); y = re.match(r'^([가-힣]+)', b)
    if x and y:
        w = x.group(1) + y.group(1)
        if re.search(r'(?<![가-힣])' + re.escape(w), DOC) and not re.search(re.escape(x.group(1)) + ' ' + re.escape(y.group(1)), DOC):
            return a + b
        if len(x.group(1)) == 1 and x.group(1) in '갑그' and y.group(1)[0] in '자런렇래':
            return a + b
    return a + ' ' + b


def paras(lines):
    """〈보기〉 같은 줄글 → 문단(문자열, 시 행은 '<br>' 로 이음 — 호출한 쪽이 esc 하기 전 '\n' 로 둔다).
    'ㄱ.'·'•'·'-'·'Ⅰ' 따위로 시작하는 줄과 문장이 끝난 뒤의 줄은 새 문단.
    마침표 없이 '…다'로 끝나는 줄이 이어지면 시 행으로 보고 줄을 살린다(〈보기〉 속 시)."""
    # 표처럼 흩어진 'Ⅰ·Ⅱ·…' + '1~4행→5~7행→…' 한 줄 → 'Ⅰ(1~4행) → Ⅱ(5~7행) → …'
    nums = [t for t in lines if re.fullmatch(r'[ⅠⅡⅢⅣⅤⅥⅦ]', t)]
    tail = [t for t in lines if re.match(r'^[ⅠⅡⅢⅣⅤⅥⅦ]?\s*\d+~\d+행(→\d+~\d+행)+$', t)]
    if nums and len(tail) == 1:
        last = re.match(r'^([ⅠⅡⅢⅣⅤⅥⅦ]?)\s*(.*)$', tail[0])
        ns = nums + ([last.group(1)] if last.group(1) else [])
        rs = last.group(2).split('→')
        if len(ns) == len(rs):
            rest = [t for t in lines if t not in nums and t != tail[0]]
            return [' → '.join('%s(%s)' % (a, b) for a, b in zip(ns, rs))] + paras(rest)
    # 〈보기〉 속 시: 출처 줄('- 작가, 「제목」') 바로 앞에서 마침표로 끝나는 줄까지 거슬러 올라간 줄들은 행을 살린다
    poemln = set()
    for i, t in enumerate(lines):
        if SRC.match(t):
            j = i - 1
            wrap = lambda k: k >= 0 and len(lines[k]) >= 31 and not re.search(r'[.?!]$', lines[k])   # 줄글이 폭에 맞춰 꺾인 줄
            while j >= 0 and not SRC.match(lines[j]) and not wrap(j) and not (re.search(r'[.?!]$', lines[j]) and wrap(j - 1)):
                poemln.add(j); j -= 1
    out = []
    for i, t in enumerate(lines):
        if i in poemln:
            if i - 1 in poemln and out:
                out[-1] += '\n' + t
            else:
                out.append(t)
            continue
        if not out or (i - 1) in poemln or re.match(r'^([ㄱ-ㅎ]\.|[•·▪○◦\-–]|[ⅠⅡⅢⅣⅤⅥ]|\(?[0-9]+[).]|\[[A-Z]\]|\([가-하]\))', t) or re.search(r'[.?!」』)]$', out[-1]) and len(out[-1].split('\n')[-1]) < 25:
            out.append(t)
        else:
            out[-1] = join2(out[-1], t)
    return out


def esc(t):
    return html.escape(t, quote=False)


def passage_of(lines):
    """지문 줄 → {'blocks': [...], 'vocab': [...]}, 작품 목록."""
    blocks, vocab, works, stanza = [], [], [], []

    def flush():
        if stanza:
            blocks.append({'p': '<br>'.join(esc(x) for x in stanza)}); stanza.clear()
    for t in lines:
        if LABEL.match(t):
            flush(); blocks.append({'label': t}); continue
        if vocab and not t.startswith('*') and not re.match(r'^\([가-하]\)', t) and not stanza and blocks and blocks[-1].get('src') and not re.search(r'[.]$', vocab[-1]):
            vocab[-1] = join2(vocab[-1], t); continue
        ml = re.match(r'^(\([가-하]\))\s*(\S.*)$', t)
        if ml:
            flush(); blocks.append({'label': ml.group(1)}); t = ml.group(2)
        m = SRC.match(t)
        if m:
            flush(); blocks.append({'p': esc(t), 'src': 1})
            works.append({'title': m.group(2).strip(), 'author': m.group(1).strip()}); continue
        if t.startswith('*'):
            flush(); vocab.append(t); continue
        stanza.append(t)
    flush()
    P = {'blocks': blocks}
    if vocab:
        P['vocab'] = [esc(re.sub(r'^\*\s*귓전으로: 흘리며', '* 귓전으로 흘리며:', v)) for v in vocab]
    return P, works


def item_of(lines):
    """한 문항 줄들 → stem·box·opts."""
    stem, box, opts, mode = [], [], [], 'stem'
    for t in lines:
        if t[0] in CIRC:
            mode = 'opt'; opts.append(t[1:].strip()); continue
        if mode == 'opt':
            opts[-1] += ('' if opts[-1].endswith(('/', '(')) else ' ') + t; continue
        if re.match(r'^[<〈]\s*보기\s*\d?\s*[>〉]$', t):
            mode = 'box'; box.append({'label': t.replace('<', '〈').replace('>', '〉')}); continue
        if mode == 'box':
            box.append(t); continue
        if re.fullmatch(r'\[\d+(?:\.\d+)?점\]', t) and not opts:
            stem.append(t); continue
        if stem and re.search(r'(것은|고른 것은)[?>]?$', stem[-1].rstrip()) and not box:
            mode = 'box'; box.append(t); continue
        stem.append(t)
    lab = [b for b in box if isinstance(b, dict)]
    txt = paras([b for b in box if isinstance(b, str)])
    box = lab + [{'p': '<br>'.join(esc(y) for y in x.split('\n'))} for x in txt]
    opts = [re.sub(r'\s*(?:\[[^\]]*|[^\s\]]+(?:\s[^\s\]]+)?)\]\S*\d{2}-\d-(?:중간|기말)\S*:\s*[①-⑤]\s*$', '', o) for o in opts]   # 기출 출처 표시('비상 문학]지산고20-1-기말: ④')
    st = ' '.join(stem)
    pts = re.search(r'\s*\[(\d+(?:\.\d+)?)점\]\s*$', st)
    st = re.sub(r'\s*\[(\d+(?:\.\d+)?)점\]\s*$', '', st).replace('것은>', '것은?')
    it = {'stem': esc(st), 'opts': [esc(o) for o in opts], 'box': box}
    if pts:
        it['pts'] = pts.group(1)
    return it


def answers_of(lines):
    ans, expl, k, cur = {}, {}, 0, None
    while k < len(lines):
        t = lines[k]
        m = re.fullmatch(r'(\d{1,2})번', t)
        if m:
            cur = m.group(1); expl[cur] = []; k += 1; continue
        if cur:
            expl[cur].append(t); k += 1; continue
        if re.fullmatch(r'\d{1,2}', t) and k + 1 < len(lines) and re.fullmatch('[①-⑤]', lines[k + 1]):
            ans[t] = lines[k + 1]; k += 2; continue
        m2 = re.findall(r'(\d{1,2})\s*([①-⑤])', t)
        if m2:
            for n, a in m2:
                ans[n] = a
        k += 1
    return ans, {n: re.sub(r'\s+\d{1,3}$', '', ' '.join(v)) for n, v in expl.items()}


def convert(path):
    global DOC
    L = text_lines(path)
    DOC = ' '.join(L)
    cut = next((i for i, t in enumerate(L) if t == '정답과 해설'), len(L))
    ans, expl = answers_of(L[cut + 1:])
    body = L[:cut]
    items, notes = [], []
    k = 0
    while k < len(body):
        g = GROUP.match(body[k])
        if not g:
            k += 1; continue
        a = int(g.group(1)); b = int(g.group(2) or g.group(1))
        k += 1
        plines = []
        while k < len(body) and not (QHEAD.match(body[k]) and int(QHEAD.match(body[k]).group(1)) == a):
            plines.append(body[k]); k += 1
        P, works = passage_of(plines)
        for n in range(a, b + 1):
            if k >= len(body) or not QHEAD.match(body[k]):
                notes.append('%d번 머리를 못 찾음' % n); break
            first = QHEAD.match(body[k]).group(2); k += 1
            ql = [first]
            while k < len(body) and not GROUP.match(body[k]) and not (QHEAD.match(body[k]) and int(QHEAD.match(body[k]).group(1)) == n + 1):
                ql.append(body[k]); k += 1
            it = item_of(ql)
            it['no'] = n
            it['ans'] = ans.get(str(n), '')
            it['expl'] = expl.get(str(n), '')   # 해설은 글 그대로(화면이 esc 한다)
            it['kind'] = 'choice'
            it['passage'] = P
            it['works'] = works
            it['range'] = '%d~%d' % (a, b) if b > a else str(a)
            if len(it['opts']) != 5:
                notes.append('%d번 선지 %d개' % (n, len(it['opts'])))
            if not it['ans']:
                notes.append('%d번 정답 없음' % n)
            items.append(it)
    return {'items': items, 'notes': notes, 'answers': len(ans), 'expl': len(expl)}


if __name__ == '__main__':
    d = convert(sys.argv[1])
    json.dump(d, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('문항', len(d['items']), '| 정답', d['answers'], '| 해설', d['expl'], '| 확인할 점', d['notes'])
