"""지필 워크북(SHUEGUK 지필고사 대비 워크북) → 이미 낸 H WORK 과제에 문제 원문 잇기 (2026-11-17).

원장님이 준 워크북 원본 데이터(workbook_data.json — 지문·문항·빈칸·기출 포인트 OX)로 문항 HTML 을 만들고,
지문 그림·표 자리는 교사용 PDF 에서 잘라 그림으로 넣는다(학교 기출·교재라 저장소에 원본을 두지 않는다).
  WB_DIR=<작업 폴더> python3 tools/wb_workbook/build2.py      → <작업 폴더>/wb_out.json (H WORK 정답과 대조, 경고 출력)
  python3 tools/real_load.py put <작업 폴더>/wb_out.json         → hwork_src_items / hwork_src_passages
새 워크북은 이 파일의 과제 이름·세트 짝(res[...])을 그 책에 맞게 고쳐 쓴다.
"""
import sys, json, re, html as H, urllib.parse
import os
HERE=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,HERE); sys.path.insert(0,os.path.join(HERE,'..'))
import items, lay, psg, pymupdf
from sets import ROBOT, W2V
from gbank_load import rest
P=os.environ.get('WB_DIR','..').rstrip('/')+'/'   # 작업 폴더: pdf/robot.pdf · pdf/w2v.pdf · src1/(워드투벡 원본) · src2/(로봇 원본)
W=json.load(open(P+'src1/workbook_data.json'))
R=json.load(open(P+'src2/data/workbook_data.json'))
CIRC='①②③④⑤'
def h(s):
    s=H.escape(str(s),quote=False)
    s=re.sub(r'&lt;(/?(?:u|i|sup|b))&gt;',r'<\1>',s)
    s=s.replace('&lt;보기&gt;','〈보기〉')
    return s
def table_html(rows):
    return '<table class="ot">'+''.join('<tr>'+''.join(f'<td>{h(c)}</td>' for c in r)+'</tr>' for r in rows)+'</table>'
def chtab(hdr, opts):
    rows=[[''] + hdr]+[[CIRC[i]]+re.split(r'\s{2,}',o.strip()) for i,o in enumerate(opts)]
    return '<div class="chw"><table class="chtab">'+''.join('<tr>'+''.join((f'<td class="cnum"><span class="cn">{h(c)}</span></td>' if c else '<td class="cnum"></td>') if j==0 else f'<td>{h(c)}</td>' for j,c in enumerate(r))+'</tr>' for r in rows)+'</table></div>'
def mc(stem, box, opts, label='보기', extra='', hdr=None):
    o=f'<div class="qh"><div class="stem">{h(stem)}</div></div><div class="qb">'
    if box:
        o+=f'<div class="bogi"><span class="bl">{label}</span>'+'<br>'.join(h(b) for b in box)+extra+'</div>'
    if hdr: return o+chtab(hdr,opts)+'</div>'
    for i,t in enumerate(opts or []):
        o+=f'<div class="ch"><span class="cn">{CIRC[i]}</span> {h(t)}</div>'
    return o+'</div>'
def ox(stmt): return f'<div class="qh"><div class="stem">{h(stmt)}</div></div><div class="qb"></div>'
BK='<u class="bk">&emsp;&emsp;&emsp;&emsp;</u>'
res={}
# ---- robot
rs={'ox':R['ox'],'mc':R['multiple_choice']+R['suneung']+R['bogi']}
names=['02 OX 1차','03 OX 2차']
for nm,s in zip(names,R['ox']):
    res[ROBOT+nm]=[(it['no'],ox(it['statement']),it.get('answer'),it.get('explanation',''),'') for it in s['items']]
for nm,s in zip(['04 객관식 1차','05 객관식 2차','06 객관식 3차','07 객관식 4차','08 수능형 1차','09 수능형 2차','10 보기형 1차','11 보기형 2차'],rs['mc']):
    assert s['set'] in nm, (s['set'],nm)
    res[ROBOT+nm]=[(it['no'],mc(it['stem'],it.get('bogi'),it['options']),it['answer'],it.get('explanation',''),it.get('wrong_explanation','')) for it in s['items']]
titles={p['paragraph']:p.get('title','') for p in R['study']['paragraph_summaries']}
k=0; bl=[]
for b in R['study']['blanks']:
    for line in b['lines']:
        nums=[]
        def take(m):
            global k; k+=1; nums.append(k); return '\x00%d\x00'%k
        L2=re.sub(r'\{([^}]*)\}',take,line)
        for n in nums:
            t=h(L2)
            t=re.sub('\x00(\\d+)\x00',lambda m: f'<b class="bn">( {m.group(1)} )</b>' if int(m.group(1))==n else f'( {m.group(1)} )',t)
            bl.append((n,f'<div class="qh"><div class="stem">빈칸 ( {n} )에 들어갈 말을 쓰시오.</div></div><div class="qb"><div class="bogi"><div class="ph"><span class="prng">{b["paragraph"]}문단 · {h(titles.get(b["paragraph"],""))}</span></div>- {t}</div></div>',None,'',''))
res[ROBOT+'01 지문 학습 빈칸']=bl
# ---- w2v
bt={s['title']:s for s in W['sets']}
for nm,t in [('03 OX 1차','OX 1차'),('04 OX 2차','OX 2차')]:
    res[W2V+nm]=[(i+1,ox(it['stem']),it['ans'],it.get('exp',''),'') for i,it in enumerate(bt[t]['items'])]
for nm,t in [('05 객관식 1차','객관식 1차'),('06 객관식 2차','객관식 2차'),('09 수능형 1차','수능형 1차'),('10 수능형 2차','수능형 2차'),('11 보기형 1차','보기형 1차'),('12 보기형 2차','보기형 2차')]:
    out=[]
    for i,it in enumerate(bt[t]['items']):
        ex=table_html(it['table']) if it.get('table') else ''
        out.append((i+1,mc(it['stem'],it.get('box'),it['opts'],extra=ex,hdr=it.get('hdr')),it['ans'],it.get('exp',''),it.get('wrong','')))
    res[W2V+nm]=out
res[W2V+'02 기출 포인트 OX']=[(i+1,ox(it['statement']),it['answer'],it.get('explanation',''),'') for i,it in enumerate(W['study']['exam_point_ox'])]
sub=bt['키워드 빈칸·서술형']
kw=[]
for i,it in enumerate(sub['keyword_blanks']):
    model=h(it['model']); model=re.sub(r'\(\s{2,}\)',BK,model)
    kw.append((i+1,f'<div class="qh"><div class="stem">{h(it["stem"])}</div></div><div class="qb"><div class="frame">▷ {model}</div></div>',it['ans'],'',''))
res[W2V+'13 키워드 빈칸']=kw
res[W2V+'13 주관식']=[(i+1,mc(it['stem'],None,None),None,'','') for i,it in enumerate(sub['short_answer'])]
res[W2V+'13 조건형 서술']=[(i+1,mc(it['stem'],it.get('cond'),None,label='조건'),None,('채점 기준: '+it['crit']) if it.get('crit') else '','') for i,it in enumerate(sub['conditional'])]
# ---- passages: PDF 구조(그림 위치) + 원본 글
def passage(pdf,pages,paras,glossary,source):
    raw,_=psg.build(pdf,pages)
    def sub(m):
        n=int(m.group(1)); return f'<div class="psg"><span class="pn">{n}</span> {h(paras[n-1])}</div>'
    raw=re.sub(r'<div class="psg"><span class="pn">(\d+)</span> .*?</div>',sub,raw)
    raw=re.sub(r'<div class="voc">.*?</div>','',raw)
    raw=re.sub(r'<div class="src">.*?</div>','',raw)
    raw+=f'<div class="src">- {h(source)}</div>'
    raw+='<div class="voc"><b>어휘 풀이</b>'+''.join(f'<div><b>{h(g["word"])}</b> {h(g["meaning"])}</div>' for g in glossary)+'</div>'
    return raw
rp=[p for s in R['passage']['sections'] for p in s['paragraphs']]
rgl=[{'word':g.get('word') or g.get('term'),'meaning':g.get('meaning') or g.get('desc')} for g in R['passage']['glossary']]
pas=[{'pid':'wb-robot','html':passage(P+'pdf/robot.pdf',[2,4,6,8],rp,rgl,R['passage']['source_line'].lstrip('- '))},
     {'pid':'wb-w2v','html':passage(P+'pdf/w2v.pdf',[2,4,6,8,10],W['passage']['paragraphs_marked'],W['passage']['glossary'],'박상길, 정진호, 〈워드투벡, 언어를 숫자로 바꾸다〉')}]
assert pas[0]['html'].count('class="pn"')==12 and pas[1]['html'].count('class="pn"')==18
# ---- assemble with H WORK answers
BOOK={'robot':'지필 워크북 · 로봇, 마음 그리고 우리','w2v':'지필 워크북 · 워드투벡, 언어를 숫자로 바꾸다'}
TYPE={'ox':'OX','choice5':'5지','text':'단답','essay':'서술'}
data=[]; warn=[]
for c,lst in res.items():
    f='robot' if c.startswith(ROBOT) else 'w2v'
    L=rest('GET','/hwork_homeworks?select=data&code=eq.'+urllib.parse.quote(c))[0]['data']['items']
    if len(L)!=len(lst): warn.append(f'문항 수 {c} H WORK {len(L)} / 원본 {len(lst)}')
    for no,html,src_ans,ex,wr in lst:
        it=L[str(no)]; t=it['type']; a=it.get('ans')
        if t=='choice5':
            ans=','.join(CIRC[int(x)-1] for x in str(a).split(',') if x.strip().isdigit())
            sa=src_ans if isinstance(src_ans,int) else (CIRC.index(src_ans)+1 if isinstance(src_ans,str) and src_ans in CIRC else None)
            if sa is not None and str(sa)!=str(a): warn.append(f'정답 다름 {c} {no}번 H WORK {a} / 원본 {sa}')
        elif t=='ox':
            ans={'O':'○','X':'×'}.get(str(a).strip().upper(),str(a))
            if src_ans and str(src_ans).upper()!=str(a).upper(): warn.append(f'OX 다름 {c} {no}번 H WORK {a} / 원본 {src_ans}')
        elif t=='text': ans=str(a)
        else: ans=''
        data.append(dict(code=c,no=no,qid=f'{f}-{c.split(" · ")[-1]}-{no}',book=BOOK[f],html=html,pid='wb-'+f,
                         type=TYPE.get(t,t),ans=ans,essay=str(a) if t=='essay' else '',src='',err=False,expl=str(ex or ''),wrong=str(wr or '')))
json.dump({'items':data,'passages':pas},open(P+'wb_out.json','w'),ensure_ascii=False)
print(len(data),'items'); print('\n'.join(warn) or '경고 없음')
