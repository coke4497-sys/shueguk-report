#!/usr/bin/env python3
"""Shuefit 문법 — 슈국 자체 자료(문법 매뉴얼 TEST 등)를 문항 은행(gbank_items)에 더한다 (2026-11-25, 093).

모의고사 문항(gbank_load.py — 작업 폴더 shueguk_mogo, 번호 0~99999)과 따로, 번호 100000 부터 쓴다.
문항 종류(qtype) = choice5(5지선다) · ox(O/X) · short(단답 — 예시 답과 비교). 원문 자료는 저장소에 두지 않는다.

  python3 -I tools/gbank_manual.py build <src.json> <out.json>   # 자료 → 문항 HTML(검사 포함)
  python3 -I tools/gbank_manual.py check <out.json>
  python3 -I tools/gbank_manual.py put <out.json>                # 올리기(같은 번호 덮어씀, 같은 출처에서 빠진 번호는 숨김)

src.json = {set, src, area, lvl, kind, year, id_from, items:[{no, type, stem, answer|ans, box?, boxlabel?, box2?,
            opts?[5] | head?[칸 이름] + rows?[5][칸], good, bad?[]}]} — 글은 HTML(<u>·<b>), 옛한글은 그대로 적으면
            <span class="oh"> 로 감싼다(oh.js 와 같은 모양).
"""
import json
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gbank_load as G  # noqa: E402

CHS = '①②③④⑤'
QTYPES = ('choice5', 'ox', 'short')
# 옛한글 — 조합형 자모(첫·가·끝소리, 확장 A·B)와 방점
OH = re.compile('[ᄀ-ᇿꥠ-꥿ힰ-퟿〮〯]+')


def oh(s):
    return OH.sub(lambda m: '<span class="oh">' + m.group() + '</span>', s or '')


def box(inner, label='보기'):
    return f'<div class="box"><div class="bl"><span>{label}</span></div>{oh(inner)}</div>'


def render(it):
    h = f'<div class="qh"><div class="stem">{oh(it["stem"])}</div></div>'
    if it.get('box'):
        h += box(it['box'], it.get('boxlabel') or '보기')
    if it.get('box2'):
        h += box(it['box2'], '보기 2')
    t = it['type']
    if t == 'ox':
        h += '<div class="oxr"><span class="cn" data-d="O">O</span><span class="cn" data-d="X">X</span></div>'
    elif t == 'short':
        h += '<div class="sa"><span class="sal">답</span><span class="sat"></span></div>'
    elif it.get('rows'):
        head = ''.join(f'<th>{oh(c)}</th>' for c in it['head'])
        body = ''.join(f'<tr><td class="cc"><span class="cn" data-d="{k + 1}">{CHS[k]}</span></td>'
                       + ''.join(f'<td>{oh(c)}</td>' for c in r) + '</tr>' for k, r in enumerate(it['rows']))
        h += f'<div class="tw"><table class="ot chtab"><tr><th></th>{head}</tr>{body}</table></div>'
    else:
        h += '<div class="ch">' + ''.join(
            f'<div class="c"><span class="cn" data-d="{k + 1}">{CHS[k]}</span><span class="ct">{oh(o)}</span></div>'
            for k, o in enumerate(it['opts'])) + '</div>'
    return h


def build(src, out):
    s = json.load(open(src, encoding='utf-8'))
    items = []
    for k, it in enumerate(s['items']):
        t = it['type']
        if t == 'choice5':
            ans, answer = int(it['ans']), CHS[int(it['ans']) - 1]
        elif t == 'ox':
            ans, answer = (1 if it['answer'] == 'O' else 2), it['answer']
        else:
            ans, answer = 0, it['answer']
        html = render(it)
        items.append({'id': s['id_from'] + k, 'area': s['area'], 'lvl': it.get('lvl') or s['lvl'],
                      'src': f'{s["src"]} · {it["no"]}번', 'kind': s['kind'], 'year': s.get('year', ''), 'pid': '',
                      'ord': 900000 + s['id_from'] % 100000 + k, 'html': html, 'qtype': t, 'ans': ans,
                      'answer': answer, 'good': oh(it.get('good', '')),
                      'bad': [oh(b) for b in it.get('bad', [])], 'plain': G.plain(html)[:600]})
    data = {'src': s['src'], 'items': items, 'passages': []}
    bad = problems(data)
    if bad:
        raise SystemExit('검사 실패:\n' + '\n'.join(bad))
    json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'문항 {len(items)} ({", ".join(f"{q} {sum(1 for i in items if i["qtype"] == q)}" for q in QTYPES)}) → {out}')


def problems(d):
    out = []
    for it in d['items']:
        i, t = it['id'], it['qtype']
        if i < 100000:
            out.append(f'{i}: 번호는 100000 부터(모의고사 문항과 겹치지 않게)')
        if t not in QTYPES:
            out.append(f'{i}: 종류 {t!r}')
        if t == 'choice5' and (it['ans'] not in (1, 2, 3, 4, 5) or it['html'].count('class="cn"') != 5):
            out.append(f'{i}: 5지선다 정답·선지 수')
        if t == 'ox' and (it['ans'] not in (1, 2) or it['answer'] not in ('O', 'X')):
            out.append(f'{i}: OX 정답')
        if t == 'short' and (it['ans'] != 0 or not it['answer'].strip() or '<span class="sat"></span>' not in it['html']):
            out.append(f'{i}: 단답 정답·답 칸')
        if it['lvl'] not in G.LVL_ORDER:
            out.append(f'{i}: 난도 {it["lvl"]!r}')
        if 'cn ok' in it['html']:
            out.append(f'{i}: 학생용 HTML 에 정답 표시')
        if not it['good'].strip():
            out.append(f'{i}: 해설이 비었습니다')
    return out


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'build':
        build(args[0], args[1])
        return
    d = json.load(open(args[0], encoding='utf-8'))
    bad = problems(d)
    if bad:
        raise SystemExit('검사 실패:\n' + '\n'.join(bad))
    print(f'검사 통과 — 문항 {len(d["items"])}')
    if cmd != 'put':
        return
    rows = [dict(it, active=True) for it in d['items']]
    G.rest('POST', '/gbank_items?on_conflict=id', rows, 'resolution=merge-duplicates,return=minimal')
    ids = ','.join(str(it['id']) for it in d['items'])
    from urllib.parse import quote
    G.rest('PATCH', f'/gbank_items?id=gte.100000&src=like.{quote(d["src"])}*&id=not.in.({ids})&active=is.true',
           {'active': False}, 'return=minimal')
    print('올렸습니다.')


if __name__ == '__main__':
    main()
