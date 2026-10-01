#!/usr/bin/env python3
"""수업 리포트 — 클로슈(클로드 세션)가 학생마다 **수업 한 번에 한 장** 리포트를 쓸 때 쓰는 도구
(2026-09-28 주간 리포트로 시작 → 2026-10-01 수업마다 한 장으로 바꿈, 수파베이스 034·040).

흐름(CLAUDE.md '수업 리포트' 절):
  1) python3 tools/class_report.py pending
       → 리포트 요청(report_status='요청')이 걸린 수업 목록
  2) python3 tools/class_report.py data 내신 n081 2026-09-27 > /tmp/…/data.json
       → 그 수업의 진도·단원·과제 + 출석 기록이 있는 학생마다 출석·태도·코멘트·과제 검사·접근코드
  3) 클로슈가 data.json 을 읽고 학생마다 body 를 쓴 publish.json 을 만든다
       {"book","class_id","ymd","reports":[{"code","body":{attend,attend_note,attitude,summary,units,homework,hw,comment}}],"note"}
  4) python3 tools/class_report.py publish publish.json
       → class_reports 에 저장(같은 수업·학생은 덮어씀) + 그 수업 class_notes 상태 '공개'
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
    """그 수업 한 번(반·날짜)에 출석 기록이 있는 학생마다 이 수업의 기록을 모은다(040 — 수업마다 리포트 한 장)."""
    d = ymd_of(ymd)
    note = (rest('GET', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=*' % (q(book), q(cid), ymd)) or [None])[0]
    if not note:
        sys.exit('수업 기록(class_notes)이 없어요: %s %s %s' % (book, cid, ymd))
    att = rest('GET', '/attendance?date=eq.%s&book=eq.%s&class_id=eq.%s&select=student,status,memo,makeup_plan,makeup_done' % (ymd, q(book), q(cid))) or []
    studs = [s for s in (rest('GET', '/students?select=name,school,grade,code,student_id,enrolled') or [])
             if not LEFT_RE.match(str(s.get('enrolled') or '').strip())]
    hwk = d - dt.timedelta(days=(d.weekday() - 2) % 7)   # 과제 검사 주차 = 가장 최근 수요일(월·화는 지난주)
    hws = rest('GET', '/hwcheck_records?week=eq.%s&class_id=eq.%s&select=*' % (hwk, q(cid))) or []
    hw_by = {h['token']: h for h in hws if h.get('token')}
    prev = rest('GET', '/class_reports?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=code,body' % (q(book), q(cid), ymd)) or []
    prev_by = {r['code']: r['body'] for r in prev}
    cm = note.get('comments') or {}
    att_map = (cm.get('__태도') or {}) if isinstance(cm.get('__태도'), dict) else {}
    out, seen = [], set()
    for a in att:
        p = plain(a['student'])
        if not p or p in seen:
            continue
        seen.add(p)
        c = find_student(a['student'], studs)
        s = c[0] if len(c) == 1 else None
        h = hw_by.get(s['code']) if s else None
        comment = str(cm.get(p) or '').strip()
        auto = False
        if not comment and h and h.get('missing'):
            # 전체 미제출인데 코멘트가 비면 정해 둔 문장(원장님 지정 — timetable crMissComment 와 같은 문장, 다듬지 말 것)
            comment, auto = re.sub(r'[A-Z]$', '', p) + ' 친구는 과제 제출을 하지 않았습니다!!!!', True
        hw = None
        if h:
            hw = {k: h.get(k) for k in ('scores', 'pct', 'missing', 'pub', 'max', 'missing_items')}
        out.append({
            'token': a['student'], 'name': p, 'note': note_of(a['student']),
            'code': s['code'] if s else '', 'match': 'ok' if s else ('동명이인' if len(c) > 1 else '명단에 없음'),
            'attend': {'status': a['status'], 'memo': a['memo'], 'makeup_plan': a['makeup_plan']},
            'attitude': att_map.get(p, ''), 'comment': comment, 'comment_auto': auto,
            'hw': hw, 'prev_body': prev_by.get(s['code']) if s else None,
        })
    print(json.dumps({
        'book': book, 'class_id': cid, 'ymd': ymd, 'part': note.get('part', ''), 'cls': note.get('class_name', ''),
        'teacher': note.get('teacher', ''), 'time': note.get('class_time', ''),
        'progress': note.get('progress', ''), 'units': note.get('units') or [],
        'homework': [t for t in (x.strip() for x in str(note.get('homework') or '').split('\n')) if t],
        'students': out,
    }, ensure_ascii=False, indent=1))


BODY_KEYS = ('attend', 'attend_note', 'attitude', 'summary', 'units', 'homework', 'hw', 'comment')
ATTITUDES = ('', '매우 좋음', '좋음', '노력 필요')


def cmd_publish(path):
    pub = json.load(open(path, encoding='utf-8'))
    book, cid, ymd = pub['book'], pub['class_id'], pub['ymd']
    d = ymd_of(ymd)
    wed = d - dt.timedelta(days=d.weekday()) + dt.timedelta(days=2)
    note = (rest('GET', '/class_notes?book=eq.%s&class_id=eq.%s&ymd=eq.%s&select=*' % (q(book), q(cid), ymd)) or [None])[0]
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
        for k in ('units', 'homework'):
            if k in body and not isinstance(body[k], list):
                sys.exit('%s 는 목록이어야 해요: %s' % (k, studs[code]['name']))
        if body.get('attitude', '') not in ATTITUDES:
            sys.exit('수업 태도는 매우 좋음/좋음/노력 필요 중 하나여야 해요: %s' % studs[code]['name'])
        rows.append({'week': str(wed), 'book': book, 'class_id': cid, 'ymd': ymd, 'code': code,
                     'student_id': studs[code]['student_id'], 'name': studs[code]['name'],
                     'part': note.get('part', ''), 'class_name': note.get('class_name', ''),
                     'teacher': note.get('teacher', ''), 'class_time': note.get('class_time', ''),
                     'body': body, 'published': True, 'updated_at': now})
    if rows:
        rest('POST', '/class_reports?on_conflict=book,class_id,ymd,code', rows, 'resolution=merge-duplicates,return=minimal')
    rest('PATCH', '/class_notes?id=eq.%s' % note['id'],
         {'report_status': '공개', 'report_note': pub.get('note', ''), 'reported_at': now}, 'return=minimal')
    print('수업 리포트 %d명 공개 — %s %s %s' % (len(rows), book, cid, ymd))


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
