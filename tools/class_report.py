#!/usr/bin/env python3
"""슈퍼스타 주간 리포트 — 클로슈(클로드 세션)가 주간 리포트를 쓸 때 쓰는 도구 (2026-09-28, 수파베이스 034).

흐름(CLAUDE.md '수업 리포트' 절):
  1) python3 tools/class_report.py pending
       → 리포트 요청(report_status='요청')이 걸린 수업 목록
  2) python3 tools/class_report.py data 내신 n081 2026-09-27 > /tmp/…/data.json
       → 그 수업의 진도·과제·코멘트 + 학생별 출석·숙제 검사·접근코드를 한 파일로
  3) 클로슈가 data.json 을 읽고 학생마다 그 주 전체를 담은 body 를 쓴 publish.json 을 만든다
       {"book","class_id","ymd","reports":[{"code","body":{parts:[{…, hw}],comments:[…]}}]}
       (숙제 검사는 수업마다 parts[].hw — 2026-09-28, 035. body.hw 는 반 구분 전 주 단위 기록이 있을 때만)
  4) python3 tools/class_report.py publish publish.json
       → class_reports 에 저장(같은 주·학생은 덮어씀) + 요청한 수업의 class_notes 상태 '공개'
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


DOW = '월화수목금토일'


def part_of(name, book):
    n = str(name or '').strip()
    if book == '내신':
        return '확인' if '확인' in n else '진도'
    m = re.search(r'(가|나)$', re.sub(r'\(.*\)\s*$', '', n).strip())
    return m.group(1) if m else ''


def roster_has(roster, p):
    for t in str(roster or '').split():
        q_ = plain(t)
        if q_ == p or (q_.endswith('A') and q_[:-1] == p) or q_ == p + 'A':
            return True
    return False


def cmd_data(book, cid, ymd):
    """그 수업(요청이 온 반·날짜)의 학생마다 **그 주 전체**(월~일, 시간표 규칙)의 수업·출석·기록·숙제 검사를 모은다."""
    d = ymd_of(ymd)
    wed = week_wed(d)
    mon, sun = wed - dt.timedelta(days=2), wed + dt.timedelta(days=4)
    note0 = (rest('GET', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=*' % (q(book), q(cid), ymd)) or [None])[0]
    classes = rest('GET', '/tt_classes?book=eq.%s&select=class_id,day,start_time,end_time,teacher,name,roster' % q(book)) or []
    cls_by = {c['class_id']: c for c in classes}
    cls0 = cls_by.get(cid)
    if not cls0 and not note0:
        sys.exit('그 수업을 찾지 못했어요: %s %s %s' % (book, cid, ymd))
    logs = rest('GET', '/tt_log?book=eq.%s&apply_date=gte.%s&apply_date=lte.%s&select=*' % (q(book), mon, sun)) or []
    # '이 주만' 복사본은 원본 반 명단을 따라간다
    for l in logs:
        if l['kind'] in ('주간반이동', '주간반보강') and l['to_class_id'] in cls_by and not str(cls_by[l['to_class_id']].get('roster') or '').strip():
            src = cls_by.get(l['from_class_id'])
            if src:
                cls_by[l['to_class_id']]['roster'] = src.get('roster', '')
    off = {(l['from_class_id'], str(l['apply_date'])) for l in logs if l['kind'] in ('주간반휴강', '주간반이동')}
    att = rest('GET', '/attendance?date=gte.%s&date=lte.%s&book=eq.%s&select=date,class_id,student,status,memo,makeup_plan,makeup_done' % (mon, sun, q(book))) or []
    notes = rest('GET', '/class_notes?book=eq.%s&ymd=gte.%s&ymd=lte.%s&select=*' % (q(book), mon, sun)) or []
    note_by = {(n['class_id'], str(n['ymd'])): n for n in notes}
    # 요청 수업의 학생 = 그 날 출석 기록이 있는 학생(출석 미체크는 리포트에서 빠진다 — 선생님 창에서 안내함)
    toks = []
    seen = set()
    for a in att:
        if a['class_id'] == cid and str(a['date']) == ymd and plain(a['student']) not in seen:
            seen.add(plain(a['student']))
            toks.append(a['student'])
    studs = [s for s in (rest('GET', '/students?select=name,school,grade,code,student_id,enrolled') or [])
             if not LEFT_RE.match(str(s.get('enrolled') or '').strip())]
    # 숙제 검사는 수업마다 한 줄(035 — class_id). 숙제 검사 주차 = 수업일의 가장 최근 수요일(월·화 수업은 지난주)
    hws = rest('GET', '/hwcheck_records?week=gte.%s&week=lte.%s&select=*' % (wed - dt.timedelta(days=7), wed)) or []
    hw_by = {(h['token'], h.get('class_id') or '', str(h['week'])): h for h in hws if h.get('token')}
    HWK = ('scores', 'pct', 'missing', 'pub', 'max', 'missing_items')   # missing_items = 과제별 미제출(039)
    prev = rest('GET', '/class_reports?week=eq.%s&select=code,body' % wed) or []
    prev_by = {r['code']: r['body'] for r in prev}
    days = [mon + dt.timedelta(days=i) for i in range(7)]
    out = []
    for t in toks:
        p = plain(t)
        c = find_student(t, studs)
        s = c[0] if len(c) == 1 else None
        sessions = {}
        # 이 주에 빠진 수업(1회 이동은 원래 반의 그 주 전체, 이 주만 빼기는 그 날짜)
        gone = set()
        for l in logs:
            if plain(l.get('student') or '') != p:
                continue
            if l['kind'] == '1회':
                gone.add((l['from_class_id'], None))
            elif l['kind'] == '주간빼기':
                gone.add((l['from_class_id'], str(l['apply_date'])))
        today = dt.date.today()
        # 그 주 이 학생의 수업: 명단에 있는 반의 그 요일(지난 날짜는 출석 기록이 있을 때만) + 출석 기록이 있는 반
        for cl in cls_by.values():
            cidx = cl['class_id']
            if cidx.startswith('w'):
                m = re.match(r'^w(\d{2})(\d{2})(\d{2})', cidx)
                dates = [dt.date(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3)))] if m else []
            else:
                dates = [x for x in days if DOW[x.weekday()] == cl['day']]
            if not roster_has(cl.get('roster'), p):
                continue
            for x in dates:
                if not (mon <= x <= sun) or (cidx, str(x)) in off or (cidx, None) in gone or (cidx, str(x)) in gone:
                    continue
                if x < today:
                    continue   # 지난 날짜는 아래 출석 기록으로만 잡는다(기록이 없으면 휴강·이동 등이라 칸을 만들지 않음)
                sessions[(cidx, str(x))] = cl
        for a in att:
            if plain(a['student']) == p and a['class_id'] in cls_by:
                sessions[(a['class_id'], str(a['date']))] = cls_by[a['class_id']]
        parts = []
        for (cidx, day), cl in sorted(sessions.items(), key=lambda kv: kv[0][1]):
            a = next((x for x in att if x['class_id'] == cidx and str(x['date']) == day and plain(x['student']) == p), None)
            n = note_by.get((cidx, day))
            dd = ymd_of(day)
            h = hw_by.get((s['code'], cidx, str(dd - dt.timedelta(days=(dd.weekday() - 2) % 7)))) if s else None
            parts.append({
                'class_id': cidx, 'ymd': day, 'part': part_of(cl['name'], book), 'cls': cl['name'], 'teacher': cl['teacher'],
                'time': '%s %s~%s' % (cl['day'], cl['start_time'], cl['end_time']),
                'attend': a and {'status': a['status'], 'memo': a['memo'], 'makeup_plan': a['makeup_plan'], 'makeup_done': a['makeup_done']},
                'note': n and {'progress': n.get('progress', ''), 'units': n.get('units') or [], 'homework': n.get('homework', ''),
                               'comment': (n.get('comments') or {}).get(p, ''),
                               'attitude': ((n.get('comments') or {}).get('__태도') or {}).get(p, ''), 'status': n.get('report_status', '')},
                'pending': not n or not a,
                'hw': h and {k: h.get(k) for k in HWK},
            })
            # 전체 미제출인데 코멘트가 비면 정해 둔 문장(2026-10-01 사용자 지정 — timetable crMissComment·039 와 같은 문장, 리포트 comments 에 그대로)
            if n and h and h.get('missing') and not str(parts[-1]['note']['comment'] or '').strip():
                parts[-1]['note']['comment'] = re.sub(r'[A-Z]$', '', p) + ' 친구는 과제 제출을 하지 않았습니다!!!!'
                parts[-1]['note']['comment_auto'] = True
        hw = hw_by.get((s['code'], '', str(wed))) if s else None   # 반 구분 전(035 이전) 주 단위 기록
        out.append({
            'token': t, 'name': p, 'note': note_of(t),
            'code': s['code'] if s else '', 'student_id': s['student_id'] if s else '',
            'school': s['school'] if s else '', 'grade': s['grade'] if s else '',
            'match': 'ok' if s else ('동명이인' if len(c) > 1 else '명단에 없음'),
            'parts': parts,
            'hw': hw and {k: hw[k] for k in ('scores', 'pct', 'missing', 'pub', 'max')},
            'prev_body': prev_by.get(s['code']) if s else None,
        })
    print(json.dumps({
        'book': book, 'class_id': cid, 'ymd': ymd, 'week': str(wed), 'week_range': '%s ~ %s' % (mon, sun),
        'request_class': (note0 or {}).get('class_name') or (cls0 or {}).get('name', ''),
        'students': out,
    }, ensure_ascii=False, indent=1))


BODY_KEYS = ('parts', 'hw', 'comments')
PART_KEYS = ('part', 'cls', 'teacher', 'ymd', 'time', 'attend', 'attend_note', 'summary', 'units', 'homework', 'pending', 'hw')


def cmd_publish(path):
    pub = json.load(open(path, encoding='utf-8'))
    book, cid, ymd = pub['book'], pub['class_id'], pub['ymd']
    wed = week_wed(ymd_of(ymd))
    note = (rest('GET', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=id' % (q(book), q(cid), ymd)) or [None])[0]
    if not note:
        sys.exit('수업 기록(class_notes)이 없어요 — 선생님이 저장한 수업만 공개할 수 있어요.')
    studs = {s['code']: s for s in rest('GET', '/students?select=name,code,student_id') if s.get('code')}
    rows, now = [], dt.datetime.now(dt.timezone.utc).isoformat()
    for r in pub['reports']:
        code = str(r.get('code') or '').strip()
        if code not in studs:
            sys.exit('접근코드가 명단에 없어요: %r (%s)' % (code, r.get('name', '')))
        b = r['body']
        body = {k: b[k] for k in BODY_KEYS if k in b}
        parts = []
        for pt in body.get('parts') or []:
            x = {k: pt[k] for k in PART_KEYS if k in pt}
            for k in ('units', 'homework'):
                if k in x and not isinstance(x[k], list):
                    sys.exit('%s 는 목록이어야 해요: %s' % (k, studs[code]['name']))
            parts.append(x)
        body['parts'] = parts
        rows.append({'week': str(wed), 'book': book, 'code': code, 'student_id': studs[code]['student_id'],
                     'name': studs[code]['name'], 'body': body, 'published': True, 'updated_at': now})
    if rows:
        rest('POST', '/class_reports?on_conflict=week,code', rows, 'resolution=merge-duplicates,return=minimal')
    rest('PATCH', '/class_notes?id=eq.%s' % note['id'],
         {'report_status': '공개', 'report_note': pub.get('note', ''), 'reported_at': now}, 'return=minimal')
    print('주간 리포트 %d명 공개 — %s 주 (%s %s %s 요청)' % (len(rows), wed, book, cid, ymd))


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
