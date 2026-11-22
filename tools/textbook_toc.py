#!/usr/bin/env python3
"""교과서 목차(원장님 정리 xlsx) → textbook-toc.json (2026-10-26 원장님 "교과서 내 범위는 이미 기록된 것을 드롭다운 선택 추가 방식").

  python3 tools/textbook_toc.py [tools/data/교과서목차-2026-10-26.xlsx] [textbook-toc.json]

시트 '목차 목록'(학년·출판사·교과서·대표저자·복사용 항목·대단원 번호·대단원명·소단원 번호·소단원·코너명·하위 항목·작품·항목 구분·교과서 ID)과
'교과서와 출처'(교과서 ID·…·사용 학교)를 읽어 책마다 항목 목록을 만든다. 화면(textbook-toc.js)·클로슈 도구(naeshin_scope.py)가 같은 JSON 을 읽는다.
항목의 `label` 이 시험범위 '교과서 내 범위' 한 줄(= 진도 단원 하나)이 된다 — 한 책 안에서 유일해야 하므로 겹치면 '②'를 붙인다.
  라벨: 소단원 번호가 숫자 → '2(1) 소단원명 · 작품' / '1(1)' 꼴 → '2-1(1) …' / 부록 → '2단원 부록 코너명 · 항목' / 책 부록 → '책 부록 · 항목' / 도입 → '2단원 도입 …'
"""
import json
import re
import sys

import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else 'tools/data/교과서목차-2026-10-26.xlsx'
DST = sys.argv[2] if len(sys.argv) > 2 else 'textbook-toc.json'


def s(v):
    return str(v).strip() if v is not None else ''


def label_of(u, s_no, st, w):
    u, s_no, st, w = s(u), s(s_no), s(st), s(w)
    if u == '책':
        head = '책 부록'
        body = ' · '.join(x for x in (st, w) if x and x != '부록')
        return head + (' · ' + body if body else '')
    if s_no == '부록':
        head = u + '단원 부록'
    elif s_no == '도입':
        head = u + '단원 도입'
    elif re.fullmatch(r'\d+', s_no):
        head = u + '(' + s_no + ')'
    elif re.fullmatch(r'\d+\(\d+\)', s_no):
        head = u + '-' + s_no
    else:
        head = u + ' ' + s_no
    body = st + (' · ' + w if w else '')
    return (head + ' ' + body).strip()


wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
meta = {}
for r in wb['교과서와 출처'].iter_rows(values_only=True):
    if r and s(r[0]) and re.fullmatch(r'[A-Z][A-Za-z0-9]{0,4}', s(r[0])) and s(r[1]) in ('중1', '중2', '중3', '고1', '고2', '고3'):
        meta[s(r[0])] = {'schools': [x.strip() for x in s(r[5]).split(',') if x.strip()], 'url': s(r[8])}
books, order = {}, []
for i, r in enumerate(wb['목차 목록'].iter_rows(values_only=True)):
    if i < 5 or not r or not s(r[0]):
        continue
    grade, pub, name, author, copy_, u, ut, sn, st, w, kind, bid = [s(x) for x in r[:12]]
    if bid not in books:
        books[bid] = {'id': bid, 'grade': grade, 'pub': pub, 'name': name, 'author': author,
                      'label': pub + ('(' + author + ') ' if author else ' ') + name,
                      'schools': meta.get(bid, {}).get('schools', []), 'items': []}
        order.append(bid)
    books[bid]['items'].append({'label': label_of(u, sn, st, w), 'u': u, 'ut': ut, 'kind': kind})
# 라벨 유일성
for b in books.values():
    seen = {}
    for it in b['items']:
        n = seen.get(it['label'], 0) + 1
        seen[it['label']] = n
        if n > 1:
            it['label'] += ' ' + '②③④⑤⑥⑦⑧⑨'[min(n - 2, 7)]
    # 같은 출판사·책에 저자가 다른 책이 있으면 label 에 저자가 이미 들어 있다 — 하나뿐이면 저자를 뺀 짧은 이름도 둔다
same = {}
for b in books.values():
    same.setdefault((b['grade'], b['pub'], b['name']), []).append(b['id'])
for b in books.values():
    b['short'] = b['pub'] + ' ' + b['name'] if len(same[(b['grade'], b['pub'], b['name'])]) == 1 else b['label']
out = {'version': '2026-10-26', 'note': '2022 개정 · 중1·중2·고1·고2 · 원장님 정리 「시험 범위용 교과서 목차」(출판사 공식 목차 기준). 중3·고3(2015 개정)은 없음.',
       'books': [books[k] for k in order]}
json.dump(out, open(DST, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
n = sum(len(b['items']) for b in out['books'])
print('책 %d권 · 항목 %d개 → %s' % (len(out['books']), n, DST))
