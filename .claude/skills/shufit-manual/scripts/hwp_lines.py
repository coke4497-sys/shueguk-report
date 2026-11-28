#!/usr/bin/env python3
"""슈국 문법 매뉴얼 TEST(.hwp) → 줄 목록. 옛한글(한양 PUA)을 조합형 자모로 바꿔 읽는다.
  python3 -I hwp_lines.py <파일.hwp> <hypua2jamo 폴더> <out.json>
hypua2jamo: pip 빌드가 안 되면 sdist(hypua2jamo-0.7.tar.gz)를 풀어 src/ 폴더를 둘째 인자로.
"""
import sys, json, re, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'tools'))
sys.path.insert(0, sys.argv[2])
import hypua2jamo as hj
import reading_hwp5 as r
r.pua_fix = lambda x: x          # 기본 PUA 정리를 끈다 — 끄지 않으면 옛한글이 지워진다
L = r.lines(sys.argv[1])
def fix(s):
    s = s.encode('utf-16', 'surrogatepass').decode('utf-16')
    s = hj.translate(s)
    return re.sub('[\U000f0000-\U000fffff]', '¶', s)   # 정답·해설 표시 상자
out = [{'t': fix(x['t']), 'h': fix(x['h']), 'lvl': x['lvl']} for x in L]
json.dump(out, open(sys.argv[3], 'w'), ensure_ascii=False, indent=0)
for i, x in enumerate(out):
    if x['t']: print(i, x['lvl'], x['h'])
