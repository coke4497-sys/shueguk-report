# 연락처 xlsx → students.phone_student/parent1/parent2 (018 실행 후 --write)
import json, re, sys, urllib.request, urllib.parse
import openpyxl
SB='https://bangdbhqpphqqdwcledg.supabase.co'
K='sb_publishable_dE9d1KIbpgYaQkaS2MSrlg_-7SiRJuT'
XLSX='/root/.claude/uploads/a8af3d14-a96a-5eb2-8313-e9d5102432b4/4585b50b-_____.xlsx'
WRITE='--write' in sys.argv

def sb(method, path, body=None, tok=None, prefer=None):
    req=urllib.request.Request(SB+path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header('apikey',K); req.add_header('Content-Type','application/json')
    if tok: req.add_header('Authorization','Bearer '+tok)
    if prefer: req.add_header('Prefer',prefer)
    with urllib.request.urlopen(req) as r:
        t=r.read().decode(); return json.loads(t) if t else None

tok=sb('POST','/auth/v1/token?grant_type=password',{'email':'teachers@shueguk.internal','password':'shg_FCePWvnawH44SV8kYB9BHRKi6aag'})['access_token']
students=sb('GET','/rest/v1/students?select=id,code,name,student_id,student_phone,enrolled',tok=tok)
LEFT=re.compile(r'^(퇴원|n|no|off|x|중단|비재원)$',re.I)
act=[s for s in students if str(s.get('name') or '').strip() and not LEFT.match(str(s.get('enrolled') or '').strip())]
by_name={}
for s in act: by_name.setdefault(s['name'].strip(), []).append(s)

def digits(v): return re.sub(r'\D','',str(v or ''))
wb=openpyxl.load_workbook(XLSX, data_only=True); ws=wb.worksheets[0]
rows=[]
for r in ws.iter_rows(min_row=3, values_only=True):
    if not r[1]: continue
    pp1, pp2 = digits(r[5]), digits(r[6])
    if not pp1 and pp2: pp1, pp2 = pp2, ''   # (모)가 비면 (부)를 학부모1로
    rows.append({'name':str(r[1]).strip(),'grade':str(r[2] or ''),'school':str(r[3] or ''),
                 'pstu':digits(r[4]),'pp1':pp1,'pp2':pp2})

matched=[]; unmatched=[]; ambiguous=[]
for r in rows:
    cand=by_name.get(r['name']) or []
    if not cand and r['name'].endswith('A'): cand=by_name.get(r['name'][:-1]) or []
    if not cand: cand=by_name.get(r['name']+'A') or []
    if len(cand)==1:
        s=cand[0]
        # 안전 확인: 시트 8자리(학생ID=부모8자리)와 학부모1 뒤 8자리 대조
        sid=str(s.get('student_id') or '').strip()
        ok8=(not sid) or (not r['pp1']) or sid==r['pp1'][-8:]
        matched.append((r,s,ok8))
    elif len(cand)>1: ambiguous.append(r['name'])
    else: unmatched.append(r['name'])
print(f"CRM {len(rows)}건 → 매칭 {len(matched)} · 못 찾음 {len(unmatched)} · 동명이인 모호 {len(ambiguous)}")
bad8=[(r['name'],str(s.get('student_id') or ''),r['pp1'][-8:]) for r,s,ok in matched if not ok]
print(f"학부모1 뒤 8자리가 기존 비밀번호(학생ID)와 다른 학생: {len(bad8)}")
for n,a,b in bad8[:15]: print('  ·',n,'학생ID',a,'≠ 학부모1 뒤8',b)
if unmatched: print('못 찾음:', unmatched)
if ambiguous: print('모호:', ambiguous)
no_pp1=[r['name'] for r,s,ok in matched if not r['pp1']]
print('학부모1(모) 비어 있음:', len(no_pp1), no_pp1[:10])
if WRITE:
    okN=0; fail=0
    for r,s,ok in matched:
        try:
            sb('PATCH','/rest/v1/students?id=eq.%d'%s['id'],
               {'phone_student':r['pstu'],'phone_parent1':r['pp1'],'phone_parent2':r['pp2']}, tok=tok)
            okN+=1
        except Exception as e:
            fail+=1; print('실패:', r['name'], e)
    print(f'저장 완료: {okN}건 / 실패 {fail}건')
else:
    print('(예행 — 저장하려면 --write, 018 마이그레이션 실행 후)')
