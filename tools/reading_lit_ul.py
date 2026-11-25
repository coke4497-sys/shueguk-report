#!/usr/bin/env python3
"""Shuefit 문학 내신 기출 — 기출 PDF의 밑줄을 올라가 있는 지문·〈보기〉에 되살린다 (2026-11-25 원장님 "지문 밑줄 누락").

reading_lit_pdf.py 는 PDF 글자 층만 읽어 밑줄(선으로 그려짐)을 잃는다. 이 도구는 PDF의 가로 선(높이 2.5 미만, 폭 6~250)
아래 글자를 찾아 묶음('[1~2] 다음 글을 읽고')별로 모으고, DB 묶음(같은 지문 문항들)의 지문 블록·〈보기〉에서
같은 글을 찾아 <u> 로 감싼 고침(edits.json)을 만든다. 적용은 reading_load.py edit (data.edits 로 남아 put 때 다시 적용).
표 칸 선(Ⅰ~Ⅴ·n~m행)·발문 '않은'은 건너뛴다. PDF 글자 층 오타는 FIX 에 바로잡은 원문을 적는다.

  python3 -I tools/reading_lit_ul.py <[기출]….pdf> <지문 id> <edits.json>
  python3 -I tools/reading_load.py edit <지문 id> <edits.json>
"""
import os
sys_path_dir = os.path.dirname(os.path.abspath(__file__))
import pymupdf, sys, json, re, urllib.parse
sys.path.insert(0, sys_path_dir)
import reading_load as RL
pdf, pid, out = sys.argv[1], sys.argv[2], sys.argv[3]
GROUP = re.compile(r'^\[(\d+)(?:\s*[~∼]\s*(\d+))?\]\s*다음 글을 읽고')
d = pymupdf.open(pdf)
def col(x, w): return 0 if x < w / 2 else 1
heads, runs, srcs = [], [], []
ans = None
SRC = re.compile(r'[「｢]\s*(.+?)\s*[」｣]')
for pi, p in enumerate(d):
    W = p.rect.width
    lines = []
    for b in p.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            cs = [(c['c'], c['bbox']) for s in l['spans'] for c in s['chars']]
            if not cs: continue
            t = ''.join(c for c, _ in cs).strip()
            bb = l['bbox']
            lines.append((t, bb, cs))
            if t == '정답과 해설' and ans is None: ans = (pi, col(bb[0], W), bb[1])
            if GROUP.match(t): heads.append((pi, col(bb[0], W), bb[1]))
            m = SRC.search(t)
            if m: srcs.append((pi, col(bb[0], W), bb[1], re.sub(r'\s|\(.*?\)', '', m.group(1))))
    for x in p.get_drawings():
        r = x['rect']
        if not (r.height < 2.5 and 6 < r.width < 250): continue
        for t, bb, cs in lines:
            ins = [(cb[0], ch) for ch, cb in cs if r.x0 - 1 <= (cb[0] + cb[2]) / 2 <= r.x1 + 1 and r.y0 - 5 <= cb[3] <= r.y0 + 2]
            if not ins: continue
            ins.sort(); first = ins[0][0]
            pre = ''.join(ch for ch, cb in sorted(cs, key=lambda z: z[1][0]) if cb[2] <= first + 0.5)
            txt = ''.join(ch for _, ch in ins).strip()
            if txt: runs.append((pi, col(r.x0, W), r.y0, txt, pre))
key = lambda z: (z[0], z[1], z[2])
if ans: runs = [r for r in runs if key(r) < ans]; srcs = [z for z in srcs if key(z) < ans]   # 맨 뒤 정답과 해설의 밑줄은 빼기
heads.sort(key=key)
def grp(r):
    g = -1
    for i, h in enumerate(heads):
        if key(h) <= key(r): g = i
    return g
its = [{'id': i['id'], 'ord': i['ord'], 'p': i['data'].get('passage'), 'bx': i['data'].get('box')} for i in
       RL.rest('GET', '/reading_items?select=id,ord,data&code=eq.30&active=is.true&order=ord&passage_id=eq.' + urllib.parse.quote(pid))]
groups, last = [], None
for it in its:
    k = json.dumps(it['p'], ensure_ascii=False, sort_keys=True)
    if k != last: groups.append([]); last = k
    groups[-1].append(it)
print('PDF 묶음', len(heads), '· DB 묶음', len(groups), file=sys.stderr)
FIX = {'지느러미가 있고 지느러미 흔드는 물결이 있다': '지느러미가 있고 지느러미를 흔드는 물결이 있다'}   # PDF 글자 층 오타 → 바로잡은 원문
# DB 묶음 ↔ PDF 묶음 짝 — 작품 제목(「…」)으로 차례대로 맞춘다. 같은 지문이 여러 묶음에 되풀이되므로 글 일치 수로 고르면 안 된다
psig = [set() for _ in heads]
for z in srcs:
    k = grp(z)
    if k >= 0: psig[k].add(z[3])
if os.environ.get("ULDBG"): [print(k + 1, sorted(x), file=sys.stderr) for k, x in enumerate(psig)]
MAP, j = [], 0
for g in groups:
    dsig = {re.sub(r'\s|\(.*?\)', '', w.get('title', '')) for w in (g[0]['p'] or {}).get('works', [])}
    hit = next((k for k in range(j, len(heads)) if psig[k] == dsig), None)
    if hit is None: hit = next((k for k in range(j, len(heads)) if dsig and dsig <= psig[k]), None)
    if hit is None and j < len(heads) and not psig[j]: hit = j   # PDF 쪽 제목을 못 읽은 묶음은 차례대로
    if hit is None:   # 제목으로 못 정하면 앞 묶음(같은 PDF 묶음이 DB 에서 둘로 나뉨)과 다음 묶음 중 글이 더 많이 맞는 쪽
        txt = json.dumps(g[0]['p'], ensure_ascii=False).replace(' ', '') + json.dumps([it.get('bx') for it in g], ensure_ascii=False).replace(' ', '')
        sc = lambda k: sum(1 for r in runs if grp(r) == k and len(r[3].replace(' ', '')) >= 4 and r[3].rstrip('.,').replace(' ', '') in txt)
        cand = [k for k in (j - 1, j) if 0 <= k < len(heads)]
        hit = max(cand, key=sc) if cand else 0
        print('  묶음 짝 제목으로 못 정함 →', len(MAP) + 1, '번 DB 묶음 = PDF', hit + 1, '번', file=sys.stderr)
    MAP.append(hit); j = hit + 1
edits, miss, done = [], [], 0
for gi, g in enumerate(groups):
    P = g[0]['p']
    best = MAP[gi]
    rs = [r for r in runs if grp(r) == best]
    blocks = P.get('blocks', [])
    new = [b.get('p') for b in blocks]; pos = {}; n_ok = 0
    bxs = {it['id']: [b.get('p') for b in (it.get('bx') or [])] for it in g}; extra = []
    def fz(t): return re.compile(r'\s*'.join(re.escape(ch) for ch in t.replace(' ', '')))
    for _, _, _, txt0, pre in rs:
        ok = False
        if re.fullmatch(r'[ⅠⅡⅢⅣⅤⅥ]|\d+~\d+행|않은|않는', txt0): continue   # 표 칸 선·발문 강조는 지문 밑줄이 아님
        fix = FIX.get(txt0.rstrip('.,'), txt0)
        for txt in (fix, fix.rstrip('.,')):
            tail0 = pre[-1:] if pre and re.match(r'[㉠-㉿ⓐ-ⓩ]', pre[-1]) else ''
            if not txt or (len(txt.replace(' ', '')) < 2 and not tail0): continue
            R = fz(txt)
            allt = ''.join(x or '' for x in new) + ''.join(x or '' for L in bxs.values() for x in L)
            if re.search('<u>' + R.pattern + '</u>', allt): ok = True; break   # 이미 밑줄 — 다시 돌려도 같은 결과(다른 곳을 감싸지 않음)
            tail = pre[-1:] if pre and re.match(r'[㉠-㉿ⓐ-ⓩ]', pre[-1]) else ''
            def wrap(s0, start):
                ms = [m for m in R.finditer(s0 or '') if not s0[max(0, m.start() - 3):m.start()].endswith('<u>')]
                if tail: ms = [m for m in ms if s0[max(0, m.start() - 1):m.start()] == tail] or ms
                aft = [m for m in ms if m.start() >= start]
                if not ms: return None
                m = (aft or ms)[0]
                return s0[:m.start()] + '<u>' + m.group(0) + '</u>' + s0[m.end():], m.end() + 7
            for bi in range(len(blocks)):
                r = wrap(new[bi], pos.get(bi, 0)) if new[bi] else None
                if r: new[bi], pos[bi] = r; ok = True; break
            if not ok:
                for it in g + [z for gg in groups[gi + 1:gi + 2] for z in gg]:
                    if it['id'] not in bxs: bxs[it['id']] = [b.get('p') for b in (it.get('bx') or [])]; extra.append(it)
                    L = bxs[it['id']]
                    for k in range(len(L)):
                        r = wrap(L[k], 0) if L[k] else None
                        if r: L[k] = r[0]; ok = True; break
                    if ok: break
            if ok: break
        if ok: n_ok += 1
        else: miss.append((gi + 1, txt0))
    for it in g + extra:
        for k, b in enumerate(it.get('bx') or []):
            if bxs[it['id']][k] != b.get('p'):
                edits.append({'id': it['id'], 'path': 'box.%d.p' % k, 'old': b['p'], 'new': bxs[it['id']][k]})
    for it in g:
        for bi, b in enumerate(blocks):
            if new[bi] != b.get('p'):
                edits.append({'id': it['id'], 'path': 'passage.blocks.%d.p' % bi, 'old': b['p'], 'new': new[bi]})
    done += n_ok
json.dump(edits, open(out, 'w'), ensure_ascii=False, indent=0)
print('밑줄', done, '곳 · 고침', len(edits), '건', file=sys.stderr)
for m in miss: print('  못 찾음', m, file=sys.stderr)
