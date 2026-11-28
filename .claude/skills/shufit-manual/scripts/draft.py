# 한글 파일 줄(hwp_lines.py 결과) → 문항 초안. python3 -I draft.py lines.json draft.json
# 머리말(4-nn.)·답 상자 사본(¶)은 건너뛰고, [정답]/[이감] 줄로 문항을 끊는다. 표 선지는 lvl 2 칸에서 head·rows 로.
import json, re, sys, html
L = json.load(open(sys.argv[1]))
CH = '①②③④⑤'
items = []; cur = None; started = False
def un(s): return html.unescape(s).replace('<u>', '<u>').strip()
for i, x in enumerate(L):
    t, h, lv = x['t'].strip(), x['h'].strip(), x['lvl']
    if not t: continue
    if t in ('OX 체크', '실전 공략 훈련'): started = True; continue
    if not started: continue
    if t == '정답과 해설': break
    if lv == 2 and t.startswith('¶'):
        # 답 상자의 사본 — 본문 쪽 [정답] 줄이 잘려 있으면 이쪽이 온전하다
        if items and len(t) > len(items[-1].get('rawans', '')):
            parts = [q.strip() for q in t.split('¶')]
            items[-1].update(ansraw=parts[1], good=parts[2] if len(parts) > 2 else '', badraw=' ¶ '.join(parts[3:]), rawans=t)
        continue
    if lv == 2 and re.match(r'^4-\d+\.', t): continue
    if re.match(r'^\[(정답|이감)\]', t):
        parts = [p.strip() for p in t.split('¶')]
        cur['ansraw'] = parts[1]; cur['good'] = parts[2] if len(parts) > 2 else ''
        cur['badraw'] = ' ¶ '.join(parts[3:]); cur['rawans'] = '¶' + t.split('¶', 1)[1] if '¶' in t else t; items.append(cur); cur = None; continue
    if cur is None:
        cur = {'line': i, 'stem': un(h), 'opts': [], 'box': [], 'cells': [], 'ox': False}; continue
    if t == '(O/X)': cur['ox'] = True; continue
    if t == '보 기': cur['boxlabel'] = True; continue
    if lv == 2: cur['cells'].append(un(h)); continue
    if t[0] in CH: cur['opts'].append(un(h)[1:].strip()); continue
    cur['box'].append(un(h))
out = []
for it in items:
    o = {'no': len(out) + 1, 'line': it['line'], 'stem': it['stem']}
    a = it['ansraw']
    if it['ox']: o.update(type='ox', answer=a)
    elif it['opts'] or it['cells']:
        o.update(type='choice5', ans=CH.index(a) + 1 if a in CH else a)
        if it['opts']: o['opts'] = it['opts']
        if it['cells']:
            c = it['cells']; k = c.index('①') if '①' in c else 0
            o['head'] = [re.sub('</?u>', '', z) for z in c[:k]]; n = len(o['head']); rows = []
            for r in range(5):
                rows.append(c[k + r * (n + 1) + 1: k + (r + 1) * (n + 1)])
            o['rows'] = rows
    else: o.update(type='short', answer=a)
    if it['box']: o['box'] = it['box']
    o['good'] = it['good']
    b = it['badraw']
    if b: o['bad'] = [s.strip() for s in re.split('(?=[①②③④⑤] )', b) if s.strip()]
    out.append(o)
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
for o in out: print(o['no'], o['type'], o.get('ans', o.get('answer')), '| box', len(o.get('box', [])), '| rows' if 'rows' in o else '', o['stem'][:50])
