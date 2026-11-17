import sys, re, base64, io; sys.path.insert(0,'.')
import items, lay, pymupdf
from runall_j import J
def crop(page, y0, y1, x0=50, x1=560):
    pix=page.get_pixmap(clip=pymupdf.Rect(x0,y0,x1,y1), dpi=130)
    b=pix.tobytes('jpeg', jpg_quality=72)
    return f'<div class="fig"><img src="data:image/jpeg;base64,{base64.b64encode(b).decode()}" alt="그림"></div>', len(b)
def build(path, pages):
    d=pymupdf.open(path); paras=[]; total=0
    vocab=[]
    for pn in pages:
        page=d[pn-1]
        ls=[L for L in lay.page_lines(page, two_col=False)]
        body=[L for L in ls if L['sz']>=9.5 and L['x0']<85]
        if not body: continue
        bi=0; pend=[]
        def flush_pend(nextL):
            nonlocal total
            if not pend: return
            top=min(min(c['y0'] for c in L['ch']) for L in pend)-3
            bot=(min(c['y0'] for c in nextL['ch'])-4) if nextL is not None else max(max(c['y1'] for c in L['ch']) for L in pend)+4
            h,n=crop(page, top, bot); total+=n; paras.append(['fig',h]); pend.clear()
        started=False; invocab=False
        for L in ls:
            t=items.plain(lay.line_html(L,'none')).strip()
            if L in body:
                started=True; flush_pend(L)
                h=lay.line_html(L,'none')
                m=re.match(r'^\s*(?:<sup>)?(\d{1,2})(?:</sup>)?\s+(.*)$',h)
                if m and L['x0']>=65:
                    paras.append(['p',m.group(2),m.group(1)])
                elif L['bold']:
                    paras.append(['h',h])
                elif paras and paras[-1][0]=='p':
                    paras[-1][1]=J.join(paras[-1][1],h)
                else:
                    paras.append(['p',h,''])
                continue
            if not started: continue
            if t.startswith('어휘 풀이') or invocab:
                invocab=True
                if not t.startswith('어휘 풀이'): vocab.append(lay.line_html(L,'none'))
                continue
            if re.match(r'^[-–—] ',t): paras.append(['src',lay.line_html(L,'none')]); continue
            pend.append(L)
        flush_pend(None)
    html=''
    for p in paras:
        if p[0]=='h': html+=f'<div class="ph"><b>{p[1]}</b></div>'
        elif p[0]=='fig': html+=p[1]
        elif p[0]=='src': html+=f'<div class="src">{p[1]}</div>'
        else: html+=f'<div class="psg">'+(f'<span class="pn">{p[2]}</span> ' if p[2] else '')+p[1]+'</div>'
    # vocab: dedupe (repeated on pages)
    seen=[]; vv=''
    for v in vocab:
        if v not in seen: seen.append(v)
    if seen:
        merged=''
        for v in seen: merged=J.join(merged,v) if merged else v
        html+=f'<div class="voc"><b>어휘 풀이</b> {merged}</div>'
    return items.tidy(html),total
if __name__=='__main__':
    for f,pg in (('robot',[2,4,6,8]),('w2v',[2,4,6,8,10])):
        h,n=build(f'../pdf/{f}.pdf',pg)
        open(f'psg_{f}.html','w').write(h)
        print(f,len(h)//1024,'KB img',n//1024,'KB')
