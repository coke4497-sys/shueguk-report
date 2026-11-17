import re, pymupdf, collections
import lay
CIRC='①②③④⑤'
def plain(h): return re.sub(r'<[^>]+>','',h).replace('&lt;','<').replace('&gt;','>').replace('&amp;','&')

LOG=[]
class Joiner:  # PDF 줄바꿈 잇기(원본 데이터가 없을 때만 쓰는 방식 — 지금은 표 자리 찾기에만 쓴다)
    def __init__(self, texts):
        self.c=collections.Counter()
        for t in texts:
            tok=t.split()
            for w in tok[1:-1]: self.c[self.norm(w)]+=1
        self.big='\n'.join(k for k in self.c)
    @staticmethod
    def norm(w): return re.sub(r'[^\w가-힣]','',w)
    def join(self,a,b):
        r=self._join(a,b)
        try:
            pa=plain(a).rstrip(); pb=plain(b).lstrip()
            if pa and pb: LOG.append((pa.split()[-1], pb.split()[0], r[len(a):len(a)+1]==' '))
        except Exception: pass
        return r
    def _join(self,a,b):
        """a: html so far, b: next line html"""
        if not a: return b
        if not b: return a
        pa=plain(a).rstrip(); pb=plain(b).lstrip()
        if not pa or not pb: return a+b
        la=pa.split()[-1]; fb=pb.split()[0]
        last=pa[-1]; first=pb[0]
        if not re.match(r'[가-힣]',last) or not re.match(r'[가-힣]',first):
            # punctuation/latin: space unless a ends with opening char
            if last in '(‘“[〈<-/' or first in ')’”],.?!:;·〉>-/~': return a+b
            if re.match(r'[0-9]',last) and re.match(r'[0-9]',first): return a+b
            if first=='(' and re.match(r'[가-힣]',last): return a+b
            return a+' '+b
        A=self.norm(la); B=self.norm(fb)
        jo=self.c[A+B]; 
        sp=min(self.c[A],self.c[B])
        if jo>0 and jo>=sp and not (A[-1] in '을를은는의고야게면며' and len(A)>=2 and sp>0): return a+b
        SOLO={'그','저','두','세','네','한','수','것','더','잘','못','또','및','등','각','이','첫','온','새','큰','뒤','앞','안','밖','때','곳','중','즉','왜','꼭','다','될','할','볼','갈','줄','데','을','를','가','은','는','의','에','로','와','과','도'}
        if len(B)<=2 and re.search(r'[.?!]$',fb) and A[-1] not in '을를이가은는에의도로와과만서' and A not in SOLO: return a+b
        if len(A)==1 and A not in {'을','를','가','은','는','의','에','로','와','과','도','그','저','두','세','네','한','수','것','더','잘','못','또','및','등','각','이','첫','온','새','큰','뒤','앞','안','밖','때','곳','중','즉','왜','꼭','다','될','할','볼','갈','줄','온','데','점','값','일','말'}: return a+b
        frag=A+B[:2]
        ENDS='을를이가은는에의도로와과만서고며야게지면한할된될해던든다요던므니까'
        if len(frag)>=3 and A[-1] not in ENDS and not re.match(r'^[(\[‘“]',fb) and ('\n'+frag) in ('\n'+self.big) and self.c[A+B]==0 and not (self.c[A]>2 and self.c[B]>2):
            return a+b
        NOUN1={'때','수','것','데','중','뿐','듯','등','바','곳','점','안','밖','위','뒤','앞','속','간','일','말','값','날','해','쪽','편'}
        if B in NOUN1: return a+' '+b
        if B=='수록' or (len(B)==1 and B not in NOUN1): return a+b
        PART={'가','이','을','를','은','는','의','에','로','와','과','도','에서','으로','에게','이다','이며','다','오','요','까','니다','습니다','다는','라는','고','며'}
        if B in PART or (len(B)==1 and fb!=B): return a+b
        if len(A)>=2 and A[-1] in '을를이가은는에의도로와과만서' and len(B)>=2: return a+' '+b
        if re.match(r'^(하|한|할|합|했|해|되|된|될|됩|돼|시키|시킨|함|됨)',B) and A[-1] not in '을를이가은는에의도로와과만서고며야게지어아': return a+b
        if sp>0 and self.c[A]>0 and self.c[B]>0: return a+' '+b
        # prefix evidence
        pre=sum(v for k,v in self.c.items() if k.startswith(A+B[:1]) and len(k)>len(A))
        if pre>0: return a+b
        if self.c[B]>0 and len(B)>1 and B[0] not in '이가을를은는의에로와과도만다고며서면여어아해했한할하된될되적' : return a+' '+b
        if B[0] in '이가을를은는의에로와과도만다고며서면여어아해했한할하된될되적요죠니습음기게지었였는데들' : return a+b
        return a+' '+b

def doc_lines(path, pages, two_col=True):
    d=pymupdf.open(path); out=[]
    for pn in pages:
        ls=lay.page_lines(d[pn-1], two_col)
        for L in ls:
            L['pn']=pn; L['right']=max(M['x1'] for M in ls if M['col']==L['col']); out.append(L)
    return out

def start_num(L, n):
    t=plain(lay.line_html(L,'none'))
    m=re.match(r'\s*(\d{1,2})(?![\d.,~%])\s*(.*)',t)
    if m and int(m.group(1))==n and m.group(2): return True
    return False

def strip_num(h, n):
    T=r'(?:</?u>|\s)*'
    digs=T.join(re.escape(d) for d in str(n))
    h=re.sub(r'^'+T+'(?:0'+T+')?'+digs+T+r'(?:/\s*)?','',h)
    if h.count('</u>')>h.count('<u>'): h=h.replace('</u>','',1)
    return h

OXRE=re.compile(r'\s*/?\s*\(\s*[○O]\s*/\s*[×X]\s*\)\s*')

def parse(lines, count, J, mode='q', first=1):
    ox = mode=='ox'
    """lines in reading order → list of item dicts {stem, box:[(label,[html])], frame, choices}"""
    items=[]; n=first; cur=None
    for L in lines:
        if n<=first+count-1 and start_num(L,n):
            cur=dict(no=n, stem=strip_num(lay.line_html(L), n), stage='stem', box=[], frame='', choices=[], extra=[], fx=None)
            items.append(cur); n+=1; continue
        if cur is None: continue
        t=plain(lay.line_html(L,'none')).strip()
        if re.match(r'^(Ⅰ|Ⅱ|Ⅲ|Ⅳ)\.',t) or t in ('수업 포인트',): cur['stage']='done'; continue
        if cur['stage']=='done': continue
        if t in ('보기','조건'):
            cur['box'].append([t,'']); cur['stage']='box'; continue
        if t and t[0] in CIRC:
            h=lay.line_html(L)
            parts=re.split(r'\s*/?\s*(?=[①②③④⑤])',h)
            for p in parts:
                p=p.strip(' /')
                if p and p[0] in CIRC: cur['choices'].append(p)
                elif p and cur['choices']: cur['choices'][-1]=J.join(cur['choices'][-1],p)
            cur['stage']='ch'; continue
        if t.startswith('▷') or cur['stage']=='frame':
            if t.startswith('▷'): cur['fx']=L['x0']; cur['stage']='frame'
            h=lay.line_html(L,'blank')
            if not t.startswith('▷') and L['x0']>cur['fx']+10: h='＿＿＿＿ '+h
            cur.setdefault('flines',[]).append([h,L]); continue
        h=lay.line_html(L)
        if ox and cur['stage']=='stem':
            cur['stem']=J.join(cur['stem'],h); continue
        if cur['stage']=='stem' and L['bold']:
            cur['stem']=J.join(cur['stem'],h); continue
        if cur['stage']=='ch':
            cur['choices'][-1]=J.join(cur['choices'][-1],h); continue
        if cur['stage']=='stem':
            cur['box'].append(['','']); cur['stage']='box'
        if cur['stage']=='box':
            cur.setdefault('blines',{}).setdefault(len(cur['box'])-1,[]).append(L)
            if re.match(r'^\s*(<u>)?([ㄱ-ㅎ]\.|\([가-하]\)|\[[A-Z가-하]\]|[•·※-]\s|〔|\[사용자|\[FAQ|\[[^\]]{1,10}\])',h) and cur['box'][-1][1]:
                cur['box'][-1][1]+='<br>'+h
            else:
                cur['box'][-1][1]=J.join(cur['box'][-1][1],h)
    return items

RIGHT=[288,545]
def tidy(h):
    h=h.replace('</u><u>','').replace('</u> <u>',' ')
    h=re.sub(r'\((?:[가-힣]+ , )+[가-힣]+ \)','',h)
    h=re.sub(r'\(\s*/\s*\)','',h)
    h=h.replace(', 떨어질 , 떠날 )',')')
    return re.sub(r' {2,}',' ',h)
def finish_frame(it,J):
    fl=it.get('flines') or []
    out=''
    for i,(h,L) in enumerate(fl):
        if i<len(fl)-1 and L['x1']<L['right']-22 and not h.rstrip().endswith('＿＿＿＿'):
            h=h+' ＿＿＿＿'
        out=J.join(out,h)
    out=re.sub(r'(＿＿＿＿\s*){2,}','＿＿＿＿ ',out)
    it['frame']=out

def item_html(it, ox=False, cropper=None):
    for k in ('stem','frame'): it[k]=tidy(it[k])
    it['choices']=[tidy(c) for c in it['choices']]
    it['box']=[[a,tidy(b)] for a,b in it['box']]
    stem=it['stem']
    if ox: stem=OXRE.sub('',stem).strip()
    else: stem=OXRE.sub('',stem).strip()
    out=f'<div class="qh"><div class="stem">{stem}</div></div><div class="qb">'
    for bi,(lab,body) in enumerate(it['box']):
        lab_h=f'<span class="bl">{lab}</span>' if lab else ''
        bl=(it.get('blines') or {}).get(bi) or []
        tab=sum(1 for L in bl if ' / ' in lay.line_html(L))
        if tab>=2 and cropper:
            out+=f'<div class="bogi">{lab_h}{cropper(bl)}</div>'
        else:
            out+=f'<div class="bogi">{lab_h}{body}</div>'
    if it.get('flines') and not it['frame']: pass
    if it['frame']:
        fr=it['frame'].replace('＿＿＿＿','<u class="bk">&emsp;&emsp;&emsp;&emsp;</u>')
        out+=f'<div class="frame">{fr}</div>'
    for c in it['choices']:
        out+=f'<div class="ch"><span class="cn">{c[0]}</span> {c[1:].strip()}</div>'
    return out+'</div>'
