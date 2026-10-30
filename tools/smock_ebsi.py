#!/usr/bin/env python3
"""EBSi 등급컷·오답률 TOP15(CSV)를 학력평가 회차(smock_exams.info)에 넣는다.

  python3 tools/smock_ebsi.py check            # CSV 검사만
  python3 tools/smock_ebsi.py plan             # 지금 DB 값과 무엇이 달라지는지 보기
  python3 tools/smock_ebsi.py info 2026-09-고1   # 그 회차에 넣을 info 출력(검사용)
  python3 tools/smock_ebsi.py apply            # DB 에 넣기(공용 교사 계정) + 10월 JSON 사본 갱신

자료: supabase/smock-info/ebsi-2026/*.csv (2026-10-23 원장님 제공, 출처 EBSi).
- 등급컷은 EBSi 자체 분석 원점수 — 교육청 확정값이라고 쓰지 않는다. 10월은 '예상'.
- 오답률은 EBSi 채점 참여자 기준(%) — 전체 응시자 오답률이라고 쓰지 않는다.
- 동률 문항 순위는 CSV 순서 그대로(top.rows).
- 10월 회차는 원장님이 준 시험지 자료(정답·배점·평균·표준편차·표준점수·백분위)를 그대로 두고
  cuts 의 원점수·자료 표시와 오답률만 이 CSV 로 맞춘다(다르면 plan 이 알려 준다).
"""
import csv, json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, '..', 'supabase', 'smock-info', 'ebsi-2026')
INFO_DIR = os.path.join(HERE, '..', 'supabase', 'smock-info')
SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
URL_CUT = 'https://www.ebsi.co.kr/ebs/xip/xipa/retrievePastGrdCutWrongAnswerRate.ebs?tab=1'
URL_TOP = 'https://www.ebsi.co.kr/ebs/xip/xipa/retrievePastGrdCutWrongAnswerRate.ebs?tab=2'
URL_FULL = {1: 'https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVMainInfo.ebs?irecord=202610201&targetCd=D100',
            2: 'https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVMainInfo.ebs?irecord=202610202&targetCd=D200'}


def read(name):
    with open(os.path.join(DIR, name), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def load():
    errs = []
    cuts = read('korean_grade_cutoffs_2026.csv')
    tops = read('korean_wrong_answers_2026_high1.csv') + read('korean_wrong_answers_2026_high2.csv')
    if len(cuts) != 8: errs.append('등급컷 행이 8개가 아님: %d' % len(cuts))
    if len(tops) != 120: errs.append('오답률 행이 120개가 아님: %d' % len(tops))
    exams = {}
    for r in cuts:
        g, m = int(r['학년']), int(r['월'])
        key = '%s-%02d-고%d' % (r['연도'], m, g)
        raws = [int(r['%d등급' % i]) for i in range(1, 9)]
        if any(raws[i] <= raws[i + 1] for i in range(7)): errs.append(key + ' 등급컷이 내려가지 않음')
        kind = {'역대등급컷': '역대', '예상등급컷': '예상'}.get(r['자료구분'])
        if not kind: errs.append(key + ' 자료구분 모름: ' + r['자료구분'])
        if m == 10 and kind != '예상': errs.append(key + ' 10월은 예상등급컷이어야 함')
        exams[key] = {'grade': g, 'month': m, 'kind': kind, 'checked': r['확인일'], 'raws': raws, 'top': []}
    for r in tops:
        key = '%s-%02d-고%s' % (r['연도'], int(r['월']), r['학년'])
        if key not in exams: errs.append('등급컷 없는 회차의 오답률: ' + key); continue
        rate = r['오답률']
        if len(rate.split('.')[-1]) != 1 or '.' not in rate: errs.append(key + ' 오답률 소수 한 자리 아님: ' + rate)
        exams[key]['top'].append({'rank': int(r['순위']), 'no': int(r['문항번호']), 'rate': float(rate)})
    for k, e in exams.items():
        t = e['top']
        if [x['rank'] for x in t] != list(range(1, 16)): errs.append(k + ' 순위 1~15 아님')
        if len({x['no'] for x in t}) != 15: errs.append(k + ' 문항 번호 중복')
        if any(not 1 <= x['no'] <= 45 for x in t): errs.append(k + ' 문항 번호 범위 밖')
        if e['checked'] != '2026-10-23': errs.append(k + ' 확인일 다름')
    return exams, errs


def patch_of(e, old):
    """old = 지금 DB 의 info(없으면 {}). 새 info 를 돌려준다."""
    info = json.loads(json.dumps(old or {}))
    if info.get('source'):
        info['source'] = info['source'].replace('전국 오답률', 'EBSi 오답률(채점 참여자 기준)')
    g = e['grade']
    src_cut = ('EBSi 시험별 풀서비스 — 분석 중 예상 등급컷(원점수)' if e['kind'] == '예상'
               else 'EBSi 역대 등급컷 — EBSi 자체 분석 원점수')
    cuts = info.get('cuts') or {}
    rows = [r for r in (cuts.get('rows') or []) if not isinstance(r.get('grade'), int)]   # 최고점 줄은 그대로
    byg = {r['grade']: r for r in (cuts.get('rows') or []) if isinstance(r.get('grade'), int)}
    for i, raw in enumerate(e['raws']):
        r = dict(byg.get(i + 1) or {'grade': i + 1}); r['raw'] = raw; rows.append(r)
    cuts['rows'] = rows
    cuts.update({'kind': e['kind'], 'src': src_cut, 'checked': e['checked'],
                 'url': URL_FULL[g] if e['kind'] == '예상' else URL_CUT})
    info['cuts'] = cuts
    info['top'] = {'basis': 'EBSi 채점 참여자 기준', 'src': 'EBSi 오답률 TOP15', 'checked': e['checked'],
                   'url': URL_FULL[g] if e['month'] == 10 else URL_TOP, 'rows': e['top']}
    oldnat = info.get('nat') or {}
    nat = {}
    for t in e['top']:
        n = dict(oldnat.get(str(t['no'])) or {}); n['rate'] = t['rate']; nat[str(t['no'])] = n
    info['nat'] = nat
    info['nat_basis'] = 'EBSi 채점 참여자 기준'
    return info


def diff(old, new):
    out = []
    oc = {r.get('grade'): r.get('raw') for r in ((old or {}).get('cuts') or {}).get('rows') or []}
    for r in new['cuts']['rows']:
        if isinstance(r['grade'], int) and r['grade'] in oc and oc[r['grade']] != r['raw']:
            out.append('%d등급 %s → %s' % (r['grade'], oc[r['grade']], r['raw']))
    on = {k: v.get('rate') for k, v in ((old or {}).get('nat') or {}).items()}
    nn = {k: v['rate'] for k, v in new['nat'].items()}
    if on:
        for k in sorted(set(on) | set(nn), key=int):
            if on.get(k) != nn.get(k): out.append('%s번 오답률 %s → %s' % (k, on.get(k, '없음'), nn.get(k, '없음')))
    return out


def token():
    req = urllib.request.Request(SB + '/auth/v1/token?grant_type=password',
                                 json.dumps({'email': T_ID, 'password': T_PW}).encode(),
                                 {'apikey': KEY, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))['access_token']


def sb(tok, path, method='GET', body=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    req = urllib.request.Request(SB + '/rest/v1/' + urllib.parse.quote(path, safe='?=&,.()*:"/-_'), json.dumps(body).encode() if body is not None else None, h, method=method)
    return json.load(urllib.request.urlopen(req))


def main():
    mode = (sys.argv[1:] or ['check'])[0]
    exams, errs = load()
    if mode == 'info':   # 검사용 — 지금 DB 와 상관없이 그 회차의 새 info 만 출력(10월은 JSON 사본에 덧씀)
        k = sys.argv[2]; p = os.path.join(INFO_DIR, k + '.json')
        old = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
        print(json.dumps(patch_of(exams[k], old), ensure_ascii=False)); return
    if errs:
        print('\n'.join('오류: ' + x for x in errs)); sys.exit(1)
    print('CSV 검사 통과 — 회차 %d개, 오답률 %d줄' % (len(exams), sum(len(e['top']) for e in exams.values())))
    if mode == 'check': return
    tok = token()
    keys = ','.join('"%s"' % k for k in exams)
    cur = {r['key']: r for r in sb(tok, 'smock_exams?select=key,info&key=in.(%s)' % keys)}
    for k in sorted(exams):
        if k not in cur: print(k, '회차 없음 — 건너뜀'); continue
        new = patch_of(exams[k], cur[k].get('info'))
        d = diff(cur[k].get('info'), new)
        print(k, ('예상' if exams[k]['kind'] == '예상' else '역대'), '등급컷 넣음', ('· 달라지는 값: ' + '; '.join(d)) if d else '')
        if mode == 'apply':
            sb(tok, 'smock_exams?key=eq.' + k, 'PATCH', {'info': new})
            p = os.path.join(INFO_DIR, k + '.json')
            if os.path.exists(p):
                with open(p, 'w', encoding='utf-8') as f: json.dump(new, f, ensure_ascii=False, indent=1); f.write('\n')


if __name__ == '__main__':
    main()
