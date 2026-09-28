#!/usr/bin/env python3
"""수업 리포트 — 클로슈(클로드 세션)가 보고서를 쓸 때 쓰는 도구 (2026-09-28, 수파베이스 034).

흐름(CLAUDE.md '수업 리포트' 절):
  1) python3 tools/class_report.py pending
       → 리포트 요청(report_status='요청')이 걸린 수업 목록
  2) python3 tools/class_report.py data 내신 n081 2026-09-27 > /tmp/…/data.json
       → 그 수업의 진도·과제·코멘트 + 학생별 출석·숙제 검사·접근코드를 한 파일로
  3) 클로슈가 data.json 을 읽고 학생마다 body 를 쓴 publish.json 을 만든다
       {"book","class_id","ymd","reports":[{"code","body":{attend,attend_note,summary,homework,hw,comment}}]}
  4) python3 tools/class_report.py publish publish.json
       → class_reports 에 저장(같은 수업·학생은 덮어씀) + class_notes 상태 '공개'
     못 쓰는 경우: python3 tools/class_report.py hold 내신 n081 2026-09-27 "이유"

교사 인증은 페이지들과 같은 공개 조각(teachers@shueguk.internal)을 쓴다 — 학생 페이지에는 넣지 않는 값.
"""
import datetime as dt
import json
import re
import sys
import urllib.parse
import urllib.request

SB = 'https://bangdbhqpphqqdwcledg.supabase.co'
KEY = 'sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
T_ID, T_PW = 'teachers@shueguk.internal', 'shg_FCePWvnawH44SV8kYB9BHRKi6aag'
LEFT_RE = re.compile(r'^(퇴원|n|no|off|x|중단|비재원)$', re.I)
_tok = None


def token():
    global _tok
    if _tok:
        return _tok
    req = urllib.request.Request(SB + '/auth/v1/token?grant_type=password', method='POST',
                                 data=json.dumps({'email': T_ID, 'password': T_PW}).encode(),
                                 headers={'apikey': KEY, 'Content-Type': 'application/json'})
    _tok = json.load(urllib.request.urlopen(req, timeout=30))['access_token']
    return _tok


def rest(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'}
    if prefer:
        h['Prefer'] = prefer
    if method == 'GET':
        h['Range'] = '0-9999'
    req = urllib.request.Request(SB + '/rest/v1' + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    return json.loads(raw) if raw.strip() else None


def q(v):
    return urllib.parse.quote(str(v), safe='')


def ymd_of(s):
    return dt.date.fromisoformat(str(s)[:10])


def week_wed(d):
    """시간표 규칙: 월~일 달력 주의 수요일(월·화는 다가오는 수요일)"""
    return d - dt.timedelta(days=d.weekday()) + dt.timedelta(days=2)


def plain(nm):
    s = re.sub(r'^\s*\([^)]*\)\s*', '', str(nm or ''))
    return re.sub(r'\(.*\)$', '', s).strip()


def front_school(nm):
    m = re.match(r'^\s*\(([^)]*)\)', str(nm or ''))
    return m.group(1) if m else ''


def note_of(nm):
    m = re.search(r'\((.+)\)\s*$', str(nm or ''))
    return m.group(1) if m else ''


def cmd_pending():
    rows = rest('GET', '/class_notes?report_status=eq.' + q('요청') +
                '&select=book,class_id,ymd,class_name,class_time,teacher,requested_at&order=requested_at')
    print(json.dumps(rows, ensure_ascii=False, indent=1))


def find_student(tok, studs):
    """시간표 이름 → students 한 줄. 정확히 → 끝의 A 떼고 → A 붙여서, 동명이인은 앞 괄호 학교로."""
    p = plain(tok)
    cands = [s for s in studs if s['name'] == p]
    if not cands and p.endswith('A'):
        cands = [s for s in studs if s['name'] == p[:-1]]
    if not cands:
        cands = [s for s in studs if s['name'] == p + 'A']
    if len(cands) > 1:
        sch = front_school(tok)
        if sch:
            c2 = [s for s in cands if str(s['school']).startswith(sch)]
            if c2:
                cands = c2
    return cands


def cmd_data(book, cid, ymd):
    d = ymd_of(ymd)
    wed = week_wed(d)
    mon, sun = wed - dt.timedelta(days=2), wed + dt.timedelta(days=4)
    note = (rest('GET', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=*' % (q(book), q(cid), ymd)) or [None])[0]
    cls = (rest('GET', '/tt_classes?book=eq.%s&class_id=eq.%s&select=*' % (q(book), q(cid))) or [None])[0]
    if not cls and not note:
        sys.exit('그 수업을 찾지 못했어요: %s %s %s' % (book, cid, ymd))
    roster = (cls or {}).get('roster', '') or ''
    logs = rest('GET', '/tt_log?book=eq.%s&apply_date=gte.%s&apply_date=lte.%s&select=*' % (q(book), mon, sun)) or []
    if cid.startswith('w') and not roster.strip():   # '이 주만' 복사본은 원본 반 명단을 따라간다
        src = [l for l in logs if l['kind'] in ('주간반이동', '주간반보강') and l['to_class_id'] == cid]
        if src:
            o = (rest('GET', '/tt_classes?book=eq.%s&class_id=eq.%s&select=roster' % (q(book), q(src[0]['from_class_id']))) or [{}])[0]
            roster = o.get('roster', '') or ''
    names = roster.split()
    away = set()
    for l in logs:
        if not str(l.get('student') or '').strip():
            continue
        if l['kind'] == '1회' and l['from_class_id'] == cid:
            away.add(plain(l['student']))
        if l['kind'] == '주간빼기' and l['from_class_id'] == cid and str(l['apply_date']) == ymd:
            away.add(plain(l['student']))
    incoming = [l['student'] for l in logs if l['kind'] in ('1회', '주간추가') and l['to_class_id'] == cid
                and str(l['apply_date']) == ymd and str(l.get('student') or '').strip()]
    att = rest('GET', '/attendance?date=eq.%s&book=eq.%s&class_id=eq.%s&select=student,status,memo,makeup_plan,makeup_done' % (ymd, q(book), q(cid))) or []
    att_by = {plain(a['student']): a for a in att}
    toks, seen = [], set()
    for t in [n for n in names if plain(n) not in away or plain(n) in att_by] + incoming + [a['student'] for a in att]:
        if plain(t) and plain(t) not in seen:
            seen.add(plain(t))
            toks.append(t)
    studs = [s for s in (rest('GET', '/students?select=name,school,grade,code,student_id,enrolled') or [])
             if not LEFT_RE.match(str(s.get('enrolled') or '').strip())]
    hws = rest('GET', '/hwcheck_records?week=eq.%s&select=token,name,scores,max,pct,missing,pub' % wed) or []
    hw_by_code = {h['token']: h for h in hws if h.get('token')}
    wk_reports = rest('GET', '/class_reports?week=eq.%s&select=code,class_id,ymd,body' % wed) or []
    comments = (note or {}).get('comments') or {}
    out = []
    for t in toks:
        p = plain(t)
        c = find_student(t, studs)
        s = c[0] if len(c) == 1 else None
        a = att_by.get(p)
        hw = hw_by_code.get(s['code']) if s else None
        elsewhere = bool(s) and any(r['code'] == s['code'] and not (r['class_id'] == cid and str(r['ymd']) == ymd)
                                    and (r.get('body') or {}).get('hw') for r in wk_reports)
        out.append({
            'token': t, 'name': p, 'note': note_of(t),
            'code': s['code'] if s else '', 'student_id': s['student_id'] if s else '',
            'school': s['school'] if s else '', 'grade': s['grade'] if s else '',
            'match': 'ok' if s else ('동명이인' if len(c) > 1 else '명단에 없음'),
            'attend': a and {'status': a['status'], 'memo': a['memo'], 'makeup_plan': a['makeup_plan'], 'makeup_done': a['makeup_done']},
            'hw': hw and {k: hw[k] for k in ('pct', 'missing', 'scores', 'max', 'pub')},
            'hw_in_other_report': elsewhere,
            'comment': comments.get(p, ''),
        })
    print(json.dumps({
        'book': book, 'class_id': cid, 'ymd': ymd, 'week': str(wed),
        'class_name': (note or {}).get('class_name') or (cls or {}).get('name', ''),
        'teacher': (note or {}).get('teacher') or (cls or {}).get('teacher', ''),
        'class_time': (note or {}).get('class_time') or ('%s %s~%s' % (cls['day'], cls['start_time'], cls['end_time']) if cls else ''),
        'progress': (note or {}).get('progress', ''), 'homework': (note or {}).get('homework', ''),
        'report_status': (note or {}).get('report_status', ''),
        'students': out,
    }, ensure_ascii=False, indent=1))


BODY_KEYS = ('attend', 'attend_note', 'summary', 'homework', 'hw', 'comment')


def cmd_publish(path):
    pub = json.load(open(path, encoding='utf-8'))
    book, cid, ymd = pub['book'], pub['class_id'], pub['ymd']
    d = ymd_of(ymd)
    note = (rest('GET', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=*' % (q(book), q(cid), ymd)) or [None])[0]
    if not note:
        sys.exit('수업 기록(class_notes)이 없어요 — 선생님이 저장한 수업만 공개할 수 있어요.')
    studs = {s['code']: s for s in rest('GET', '/students?select=name,code,student_id') if s.get('code')}
    rows, now = [], dt.datetime.now(dt.timezone.utc).isoformat()
    for r in pub['reports']:
        code = str(r.get('code') or '').strip()
        if code not in studs:
            sys.exit('접근코드가 명단에 없어요: %r (%s)' % (code, r.get('name', '')))
        body = {k: r['body'][k] for k in BODY_KEYS if k in r['body']}
        if not isinstance(body.get('homework', []), list):
            sys.exit('homework 는 목록이어야 해요: %s' % studs[code]['name'])
        rows.append({'book': book, 'class_id': cid, 'ymd': ymd, 'week': str(week_wed(d)),
                     'class_name': note['class_name'], 'teacher': note['teacher'], 'class_time': note['class_time'],
                     'code': code, 'student_id': studs[code]['student_id'], 'name': studs[code]['name'],
                     'body': body, 'published': True, 'updated_at': now})
    if rows:
        rest('POST', '/class_reports?on_conflict=book,class_id,ymd,code', rows, 'resolution=merge-duplicates,return=minimal')
    rest('PATCH', '/class_notes?id=eq.%s' % note['id'],
         {'report_status': '공개', 'report_note': pub.get('note', ''), 'reported_at': now}, 'return=minimal')
    print('공개 %d명 — %s %s %s %s' % (len(rows), book, cid, ymd, note['class_name']))


def cmd_hold(book, cid, ymd, why):
    rest('PATCH', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s' % (q(book), q(cid), ymd),
         {'report_status': '보류', 'report_note': why}, 'return=minimal')
    print('보류 — ' + why)


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['pending']:
        cmd_pending()
    elif a[:1] == ['data'] and len(a) == 4:
        cmd_data(a[1], a[2], a[3])
    elif a[:1] == ['publish'] and len(a) == 2:
        cmd_publish(a[1])
    elif a[:1] == ['hold'] and len(a) == 5:
        cmd_hold(a[1], a[2], a[3], a[4])
    else:
        sys.exit(__doc__)
