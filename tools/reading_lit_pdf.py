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
        ml = re.match(r'^(\([가-하]\))\s*(\S.*)$', t)
        if ml and not stanza:
            flush(); blocks.append({'label': ml.group(1)}); t = ml.group(2)
        m = SRC.match(t)
        if m:
            flush(); blocks.append({'p': esc(t), 'src': 1})
            works.append({'title': m.group(2).strip(), 'author': m.group(1).strip()}); continue
        if t.startswith('*'):
            flush(); vocab.append(esc(t)); continue
        stanza.append(t)
    flush()
    P = {'blocks': blocks}
    if vocab:
        P['vocab'] = vocab
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
            box.append({'p': esc(t)}); continue
        stem.append(t)
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
    return ans, {n: ' '.join(v) for n, v in expl.items()}


def convert(path):
    L = text_lines(path)
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
            it['expl'] = esc(expl.get(str(n), ''))
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
