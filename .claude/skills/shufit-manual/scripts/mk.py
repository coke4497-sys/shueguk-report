# 초안(d*.json) + 고침 → src.json (gbank_manual 형식)
import json, re, sys
def norm(s):
    s = s.replace('<보기>', '〈보기〉').replace('&lt;보기&gt;', '〈보기〉')
    s = re.sub(r'<u>([^<]*?)\s*</u>\s*것', lambda m: f'<b><u>{m.group(1)}</u></b> 것', s)
    return s
def mk(draft, out, meta, patch, fixes):
    D = json.load(open(draft))
    items = []
    for o in D:
        no = o['no']; p = patch.get(no, {})
        o = dict(o)
        for k, v in p.get('rep', []):          # 모든 글 칸에서 바꿈
            pass
        it = {'no': no, 'type': o['type'], 'stem': o['stem'], 'good': o['good']}
        if o['type'] == 'choice5': it['ans'] = o['ans']
        else: it['answer'] = o['answer']
        if 'opts' in o: it['opts'] = o['opts']
        if 'rows' in o: it['head'] = o['head']; it['rows'] = o['rows']
        if o.get('bad'): it['bad'] = o['bad']
        if o.get('box'): it['box'] = ''.join(f'<p>{b}</p>' for b in o['box'])
        for k, v in p.items():
            if k == 'rep': continue
            if v is None: it.pop(k, None)
            else: it[k] = v
        def R(x):
            if isinstance(x, str):
                for a, b in p.get('rep', []): x = x.replace(a, b)
                return norm(x)
            if isinstance(x, list): return [R(y) for y in x]
            return x
        it = {k: R(v) for k, v in it.items()}
        items.append(it)
    json.dump(dict(meta, fixes=fixes, items=items), open(out, 'w'), ensure_ascii=False, indent=1)
    print(len(items), out)
