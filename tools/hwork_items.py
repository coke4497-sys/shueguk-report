#!/usr/bin/env python3
"""H WORK 교재 문항 그림 — 학생용 PDF에서 문항마다 잘라 hwork-items 버킷·hwork_book_imgs 표에 올린다 (068).

  python3 tools/hwork_items.py crop  <학생용.pdf> <출력 폴더>            # 자르기만 (index.json + png)
  python3 tools/hwork_items.py check <학생용.pdf> <출력 폴더> "<교재>"   # 세트 이름을 H WORK 과제와 맞춰 보기
  python3 tools/hwork_items.py put   <학생용.pdf> <출력 폴더> "<교재>"   # 올리기 (교사 계정, 다시 돌려도 덮어씀)

<교재> = 과제 제목의 과목·권 그대로 — '문장 1권(기본·실력)', '단어 형성 2권(심화·종합)', '음운 4권(종합)' …
교재 PDF는 'SHUEGUK REAL 내신 기출' 조판(2단, 문항 번호 9.4pt, 세트 머리 15pt 번호)을 전제로 한다.
목차의 '총 n문항'과 잘린 문항 수가 다르면 crop이 멈춘다.
"""
import hashlib
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
BUCKET = 'hwork-items'
TOP, BOT = 52, 800
COL_X = (40, 62, 292, 315)      # 문항 번호가 놓이는 x (짝·홀 쪽 왼단·오른단)
_tok = None


def token():
    global _tok
    if not _tok:
        req = urllib.request.Request(SB + '/auth/v1/token?grant_type=password', method='POST',
                                     data=json.dumps({'email': T_ID, 'password': T_PW}).encode(),
                                     headers={'apikey': KEY, 'Content-Type': 'application/json'})
        _tok = json.load(urllib.request.urlopen(req, timeout=30))['access_token']
    return _tok


def call(method, url, data=None, headers=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + token()}
    h.update(headers or {})
    req = urllib.request.Request(url, method=method, headers=h, data=data)
    raw = urllib.request.urlopen(req, timeout=120).read().decode()
    return json.loads(raw) if raw.strip() else None


# ── 자르기 ─────────────────────────────────────────────────────
def spans(p):
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                yield s


def cols(pn):
    lx, rx = (62, 315) if pn % 2 == 1 else (40, 292)
    w = rx - lx
    return {0: (lx - 8, rx - 14), 1: (rx - 5, rx + w - 10)}


def extent(d, pn, c, ymin=TOP):
    x0, x1 = cols(pn)[c]
    ys = []
    p = d[pn]
    for s in spans(p):
        b = s['bbox']
        if s['text'].strip() and b[0] >= x0 - 2 and b[2] <= x1 + 6 and b[1] >= ymin and b[3] <= BOT:
            ys.append((b[1], b[3]))
    for g in p.get_drawings():
        r = g['rect']
        if (r.x0 >= x0 - 4 and r.x1 <= x1 + 8 and r.y0 >= ymin and r.y1 <= BOT
                and 2 < r.height < 700 and r.width > 2):
            ys.append((r.y0, r.y1))
    if not ys:
        return None
    return min(a for a, _ in ys), max(b for _, b in ys)


def set_title(p, no):
    lines = [x.strip() for x in p.get_text().split('\n') if x.strip()]
    t = next((x for x in lines if ' · ' in x and not x.startswith('SHUEGUK') and '문항' not in x), '')
    return no + ' ' + t


def crop(pdf, out):
    import pymupdf as f
    from PIL import Image
    os.makedirs(out, exist_ok=True)
    d = f.open(pdf)
    total = re.findall(r'총 (\d+)문항', d[2].get_text())
    ans = d.page_count
    for pn in range(5, d.page_count):
        if '세트의 정답' in d[pn].get_text():
            ans = pn
            break
    ev = []
    for pn in range(ans):
        for s in spans(d[pn]):
            t = s['text'].strip()
            x0, y0 = s['bbox'][0], s['bbox'][1]
            if 'Type3' in s['font']:
                continue
            if re.fullmatch(r'\d{2,3}', t) and abs(s['size'] - 9.4) < .3 and min(abs(x0 - v) for v in COL_X) < 2:
                ev.append((pn, 0 if x0 < 180 else 1, y0, 'q', int(t)))
            elif abs(s['size'] - 15) < .5 and re.fullmatch(r'\d{2}', t):
                ev.append((pn, -1, y0, 'set', t))
    ev.sort(key=lambda e: (e[0], e[1], e[2]))
    sets, cur = [], None
    for e in ev:
        if e[3] == 'set':
            cur = {'page': e[0], 'no': e[4], 'title': set_title(d[e[0]], e[4]), 'qs': []}
            sets.append(cur)
        elif cur and e[4] == len(cur['qs']) + 1:
            cur['qs'].append(e)
    n = sum(len(s['qs']) for s in sets)
    if total and int(total[0]) != n:
        sys.exit('목차는 %s문항인데 %d문항을 잘랐습니다 — 조판이 달라졌는지 확인하세요.' % (total[0], n))
    order = [(pn, c) for pn in range(ans) for c in (0, 1)]
    items = []
    for si, s in enumerate(sets):
        endp = sets[si + 1]['page'] if si + 1 < len(sets) else ans
        for qi, q in enumerate(s['qs']):
            nxt = s['qs'][qi + 1] if qi + 1 < len(s['qs']) else None
            pc = (q[0], q[1])
            ystart = q[2] - 4
            k = order.index(pc)
            segs = []
            while True:
                pn, c = order[k]
                if nxt and (pn, c) == (nxt[0], nxt[1]):
                    if (pn, c) != pc:
                        ex = extent(d, pn, c, TOP)
                        ystart = (ex[0] - 2) if ex and ex[0] < nxt[2] - 6 else nxt[2]
                    if nxt[2] - 6 - ystart > 10:
                        segs.append((pn, c, ystart, nxt[2] - 6))
                    break
                ex = extent(d, pn, c, max(TOP, ystart))
                if ex:
                    segs.append((pn, c, ystart if (pn, c) == pc else ex[0] - 2, ex[1] + 3))
                k += 1
                if k >= len(order) or (not nxt and (order[k][0] >= endp or k - order.index(pc) > 3)):
                    break
                ystart = TOP
            imgs = []
            for j, (pn, c, y0, y1) in enumerate(segs):
                x0, x1 = cols(pn)[c]
                pix = d[pn].get_pixmap(dpi=160, clip=f.Rect(x0, y0, x1, y1))
                im = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB').quantize(32)
                fn = 's%02d_q%03d_%d.png' % (si + 1, qi + 1, j)
                im.save(os.path.join(out, fn), optimize=True)
                imgs.append({'file': fn, 'w': im.width, 'h': im.height})
            items.append({'set': si + 1, 'q': qi + 1, 'imgs': imgs})
    idx = {'pdf': os.path.basename(pdf), 'total': n,
           'sets': [{'no': s['no'], 'title': s['title'], 'count': len(s['qs'])} for s in sets], 'items': items}
    json.dump(idx, open(os.path.join(out, 'index.json'), 'w'), ensure_ascii=False, indent=1)
    print('%d문항 · 세트 %d개 → %s' % (n, len(sets), out))
    return idx


# ── 세트 이름 맞추기 ────────────────────────────────────────────
def hwork_codes(book):
    req = urllib.request.Request(SB + '/rest/v1/rpc/hwork_list', method='POST', data=b'{}',
                                 headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
                                          'Content-Type': 'application/json'})
    keys = {}
    for x in json.load(urllib.request.urlopen(req, timeout=60))['list']:
        m = re.match(r'^SHUEGUK REAL 내신 기출 (.+?) (\d권\([^)]*\)) (\d{2} .+?)(?: \(\d/\d: 교재 (\d+)~(\d+)번\))?$', x['code'])
        if m and m.group(1) + ' ' + m.group(2) == book:
            keys.setdefault(m.group(3), []).append((x['teacher'], x['code']))
    return keys


def set_keys(idx, book):
    """세트마다 과제 제목의 세트 이름. PDF 제목이 그대로 있으면 그것, 없으면 같은 번호의 남은 이름 하나."""
    codes = hwork_codes(book)
    used, out, warn = set(), [], []
    for s in idx['sets']:
        t = s['title']
        if t not in codes:
            cand = [k for k in codes if k.startswith(s['no'] + ' ') and k not in used
                    and k not in [x['title'] for x in idx['sets']]]
            if len(cand) == 1:
                warn.append('세트 %s: PDF 제목 「%s」 → 과제 이름 「%s」' % (s['no'], t, cand[0]))
                t = cand[0]
            else:
                warn.append('세트 %s: 「%s」에 맞는 H WORK 과제가 없습니다(그림은 이 이름으로 올립니다).' % (s['no'], t))
        used.add(t)
        out.append(t)
    for k in codes:
        if k not in used:
            warn.append('과제 「%s」에 맞는 교재 세트가 없습니다.' % k)
    return out, warn


def put(idx, out, book):
    keys, warn = set_keys(idx, book)
    for w in warn:
        print('  !', w)
    slug = hashlib.md5(book.encode('utf-8')).hexdigest()[:10]
    rows, n = [], 0
    for it in idx['items']:
        sk = keys[it['set'] - 1]
        for j, im in enumerate(it['imgs']):
            path = 'b/%s/s%02d/q%03d_%d.png' % (slug, it['set'], it['q'], j)
            data = open(os.path.join(out, im['file']), 'rb').read()
            call('POST', SB + '/storage/v1/object/%s/%s' % (BUCKET, path), data,
                 {'Content-Type': 'image/png', 'x-upsert': 'true'})
            rows.append({'book': book, 'set_key': sk, 'q': it['q'], 'j': j, 'path': path, 'w': im['w'], 'h': im['h']})
            n += 1
            if n % 200 == 0:
                print('  그림 %d개 올림' % n)
    # 예전에 올린 그림 중 이번에 없는 조각(j가 줄어든 경우)은 지운다
    old = call('GET', SB + '/rest/v1/hwork_book_imgs?select=id,path&book=eq.' + urllib.parse.quote(book))
    keep = {r['path'] for r in rows}
    gone = [r for r in old if r['path'] not in keep]
    for i in range(0, len(rows), 500):
        call('POST', SB + '/rest/v1/hwork_book_imgs?on_conflict=book,set_key,q,j',
             json.dumps(rows[i:i + 500]).encode(),
             {'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'})
    if gone:
        call('DELETE', SB + '/rest/v1/hwork_book_imgs?id=in.(%s)' % ','.join(str(r['id']) for r in gone))
        call('DELETE', SB + '/storage/v1/object/' + BUCKET, json.dumps({'prefixes': [r['path'] for r in gone]}).encode(),
             {'Content-Type': 'application/json'})
    print('%s: 문항 %d개 · 그림 %d개 올림%s' % (book, len(idx['items']), n, (' · 옛 조각 %d개 지움' % len(gone)) if gone else ''))


if __name__ == '__main__':
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    cmd, pdf, out = sys.argv[1:4]
    if cmd == 'crop':
        crop(pdf, out)
    elif cmd in ('check', 'put'):
        book = sys.argv[4]
        p = os.path.join(out, 'index.json')
        idx = json.load(open(p)) if os.path.exists(p) else crop(pdf, out)
        if cmd == 'check':
            keys, warn = set_keys(idx, book)
            for s, k in zip(idx['sets'], keys):
                print('  %-40s %d문항' % (k, s['count']))
            for w in warn:
                print('  !', w)
        else:
            put(idx, out, book)
    else:
        sys.exit(__doc__)
