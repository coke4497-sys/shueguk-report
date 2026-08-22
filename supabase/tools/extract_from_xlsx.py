import openpyxl, json, datetime, re, sys

XLSX = '/tmp/claude-0/-home-user/db5098ef-8985-5521-afc9-2fa4493af66e/scratchpad/report.xlsx'
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)

def ymd(v):
    if v is None: return ''
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date): return v.strftime('%Y-%m-%d')
    return str(v).strip()

def ts(v):
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%dT%H:%M:%S+09:00')
    s = str(v or '').strip()
    return s if s else None

def hm(v):
    if isinstance(v, datetime.time): return v.strftime('%H:%M')
    if isinstance(v, datetime.datetime): return v.strftime('%H:%M')
    return str(v or '').strip()

def txt(v): return str(v).strip() if v is not None else ''
def book(v):
    s = txt(v)
    return '내신' if s == '내신' else '정규'

def rows(name):
    sh = wb[name]
    it = sh.iter_rows(values_only=True)
    next(it, None)  # header
    return [r for r in it if r and any(c is not None and str(c).strip() != '' for c in r)]

def col(r, i): return r[i] if len(r) > i else None

out = {}

# 정규/내신 시간표 → tt_classes
cls = []
for bk, tab in [('정규', '정규시간표'), ('내신', '내신시간표')]:
    for r in rows(tab):
        if not txt(col(r,0)): continue
        cls.append({'book': bk, 'class_id': txt(col(r,0)), 'day': txt(col(r,1)),
                    'start_time': hm(col(r,2)), 'end_time': hm(col(r,3)),
                    'location': txt(col(r,4)), 'teacher': txt(col(r,5)),
                    'name': txt(col(r,6)), 'roster': txt(col(r,7))})
out['tt_classes'] = cls

# 출석기록 → attendance (같은 날·반·학생 중복은 마지막 기록 우선)
att = {}
skipped = []
for r in rows('출석기록'):
    d = ymd(col(r,0)); st = txt(col(r,4))
    if not d or st not in ('출석','지각','결석'):
        skipped.append([txt(c) for c in r[:6]]); continue
    rec = {'date': d, 'book': book(col(r,1)), 'class_id': txt(col(r,2)),
           'student': txt(col(r,3)), 'status': st, 'memo': txt(col(r,5)),
           'makeup_plan': txt(col(r,7)), 'makeup_done': txt(col(r,8)),
           'makeup_memo': txt(col(r,9))}
    t = ts(col(r,6))
    if t: rec['updated_at'] = t
    plain = re.sub(r'\(.*\)$', '', rec['student'])
    att[(rec['date'], rec['book'], rec['class_id'], plain)] = rec
out['attendance'] = list(att.values())
out['_att_skipped'] = skipped

# 시간표이동기록 → tt_log
logs = []
for r in rows('시간표이동기록'):
    rec = {'kind': txt(col(r,1)), 'student': txt(col(r,2)),
           'from_class_id': txt(col(r,3)), 'from_class': txt(col(r,4)),
           'to_class_id': txt(col(r,5)), 'to_class': txt(col(r,6)),
           'reason': txt(col(r,7)), 'book': book(col(r,8))}
    t = ts(col(r,0))
    if t: rec['at'] = t
    ad = ymd(col(r,9))
    if re.match(r'^\d{4}-\d{2}-\d{2}$', ad): rec['apply_date'] = ad
    if rec['kind'] or rec['student']: logs.append(rec)
out['tt_log'] = logs

# 시간표메모 → tt_memo
memos = {}
for r in rows('시간표메모'):
    d = ymd(col(r,0))
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', d): continue
    rec = {'date': d, 'memo': txt(col(r,1))}
    t = ts(col(r,2))
    if t: rec['updated_at'] = t
    memos[d] = rec
out['tt_memo'] = list(memos.values())

# 기간설정 → tt_period
per = {}
for r in rows('기간설정'):
    d = ymd(col(r,0))
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', d): continue
    rec = {'week_wednesday': d, 'book': book(col(r,1))}
    t = ts(col(r,2))
    if t: rec['updated_at'] = t
    per[d] = rec
out['tt_period'] = list(per.values())

# 지필일정 → exam_sched
exs = []
for r in rows('지필일정'):
    kind = txt(col(r,0)); sd = ymd(col(r,2))
    if kind not in ('기간','과목') or not re.match(r'^\d{4}-\d{2}-\d{2}$', sd):
        continue
    ed = ymd(col(r,3))
    rec = {'kind': kind, 'school': txt(col(r,1)), 'start_date': sd,
           'end_date': ed if re.match(r'^\d{4}-\d{2}-\d{2}$', ed) else None,
           'text': txt(col(r,4))}
    t = ts(col(r,5))
    if t: rec['updated_at'] = t
    exs.append(rec)
out['exam_sched'] = exs

for k, v in out.items():
    print(k, len(v))
json.dump(out, open('/tmp/claude-0/-home-user/db5098ef-8985-5521-afc9-2fa4493af66e/scratchpad/data1.json', 'w'), ensure_ascii=False)
