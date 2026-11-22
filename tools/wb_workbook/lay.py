import pymupdf, re, statistics
CIRC='①②③④⑤'
def page_lines(page, two_col=True, top=55, bottom=800, left=38, right=574, mid=295.0):
    t3=[]; chars=[]; t3c=[]
    raw=page.get_text('rawdict')
    for b in raw['blocks']:
        for l in b.get('lines',[]):
            for s in l['spans']:
                if s['font'].startswith('Type3'):
                    t3.append(s['bbox'])
                    for c in s['chars']:
                        if c['c'].strip(): t3c.append(dict(c=c['c'],x0=c['bbox'][0],x1=c['bbox'][2],y0=c['bbox'][1],y1=c['bbox'][3],oy=c['origin'][1],sz=s['size']))
                    continue
                for c in s['chars']:
                    x0,y0,x1,y1=c['bbox']
                    if not(left<x0<right and top<y0<bottom): continue
                    chars.append(dict(c=c['c'],x0=x0,x1=x1,y0=y0,y1=y1,oy=c['origin'][1],sz=s['size']))
    # Type3-only glyphs (θ 등) — 일반 글자 층에 없는 것만 더한다
    def covered(c):
        cx=(c['x0']+c['x1'])/2; cy=(c['y0']+c['y1'])/2
        return any(r['x0']-0.5<=cx<=r['x1']+0.5 and r['y0']-2<=cy<=r['y1']+2 for r in chars)
    seen=set()
    for c in t3c:
        k=(c['c'],round(c['x0']),round(c['y0']))
        if k in seen or not(left<c['x0']<right and top<c['y0']<bottom) or covered(c): continue
        seen.add(k); chars.append(c)
    # underline segments
    segs=[]
    for g in page.get_drawings():
        for it in g['items']:
            if it[0]=='l':
                p1,p2=it[1],it[2]
                if abs(p1.y-p2.y)<0.6 and abs(p2.x-p1.x)>3: segs.append((min(p1.x,p2.x),max(p1.x,p2.x),p1.y))
            elif it[0]=='re':
                r=it[1]
                if r.height<1.6 and r.width>3: segs.append((r.x0,r.x1,(r.y0+r.y1)/2))
    for c in chars:
        cx=(c['x0']+c['x1'])/2; cy=(c['y0']+c['y1'])/2
        c['b']=any(b[0]-0.5<=cx<=b[2]+0.5 and b[1]-1<=cy<=b[3]+1 for b in t3)
        c['u']=c['c'].strip()!='' and any(s[0]-0.5<=cx<=s[1]+0.5 and c['oy']-1<=s[2]<=c['oy']+4.5 for s in segs)
    segs.sort()
    merged=[]
    for sg in segs:
        if merged and abs(merged[-1][2]-sg[2])<1.2 and sg[0]<=merged[-1][1]+4:
            merged[-1]=(merged[-1][0],max(merged[-1][1],sg[1]),merged[-1][2])
        else: merged.append(sg)
    page_segs=merged
    cols=[[c for c in chars if c['x0']<mid],[c for c in chars if c['x0']>=mid]] if two_col else [chars]
    out=[]
    for ci,cs in enumerate(cols):
        cs.sort(key=lambda c:(c['oy'],c['x0']))
        lines=[]
        for c in cs:
            # attach to line with close baseline (superscripts sit higher: allow 4)
            for L in lines[-3:]:
                if abs(L['oy']-c['oy'])<2.2: L['ch'].append(c); break
            else:
                lines.append(dict(oy=c['oy'],ch=[c]))
        # merge superscript-only lines into the nearest line below/above
        res=[]
        for L in lines:
            L['ch'].sort(key=lambda c:c['x0'])
            vis=[c for c in L['ch'] if c['c'].strip()]
            if not vis: continue
            L['sz']=statistics.median(c['sz'] for c in vis)
            L['x0']=vis[0]['x0']; L['x1']=vis[-1]['x1']; L['col']=ci
            L['bold']=sum(c['b'] for c in vis)/len(vis)>0.5
            # blank underlines on this line with no text above
            L['blank_x']=[s[0] for s in page_segs if L['oy']-1<=s[2]<=L['oy']+5 and (s[0]<mid)==(ci==0 or not two_col)
                          and s[1]-s[0]>18 and not any(s[0]-1<=(c['x0']+c['x1'])/2<=s[1]+1 for c in vis)]
            res.append(L)
        # fold small-size lines (superscript) into neighbor main line if overlapping vertically
        final=[]
        big=[L for L in res if not any(M is not L and L['sz']<M['sz']*0.8 and -2<=M['oy']-L['oy']<=8 for M in res)]
        for L in res:
            if L in big: final.append(L); continue
            tgt=min((M for M in big if -2<=M['oy']-L['oy']<=8 and L['sz']<M['sz']*0.8), key=lambda M:abs(M['oy']-L['oy']))
            tgt['ch']+=L['ch']; tgt['ch'].sort(key=lambda c:c['x0'])
            tgt['x0']=min(tgt['x0'],L['x0']); tgt['x1']=max(tgt['x1'],L['x1'])
        out+=final
    return out

def esc(s): return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def line_html(L, gapmode='slash', blank='＿＿＿＿'):
    """chars → html: sup for small, <u> for underline, gaps -> marker"""
    sz=L['sz']; out=[]; prev=None; ul=False; lastv=None
    vis=[c for c in L['ch']]
    if False:
        vis=vis+[dict(c='\x01',x0=x,x1=x+20,sz=sz,u=False,y0=0,y1=0,oy=L['oy']) for x in L['blank_x']]
        vis.sort(key=lambda c:c['x0'])
    for c in vis:
        if prev is not None and c['c'].strip() and lastv is not None:
            gap=c['x0']-lastv['x1']
            if gap>9:
                if ul: out.append('</u>'); ul=False
                out.append(' '+blank+' ' if gapmode=='blank' else ' / ' if gapmode=='slash' else ' ')
            elif gap>1.6 and prev['c'].strip(): out.append(' ')
        ch=c['c']
        if ch=='\x01':
            if ul: out.append('</u>'); ul=False
            out.append(' '+blank+' '); prev=lastv=dict(c,c='x',x1=c['x0']+60); continue
        if ch=='\xa0': ch=' '
        small=c['sz']<sz*0.78 and ch.strip()
        if c['u'] and not ul: out.append('<u>'); ul=True
        if not c['u'] and ul and ch.strip(): out.append('</u>'); ul=False
        out.append(f'<sup>{esc(ch)}</sup>' if small else esc(ch))
        if ch.strip(): lastv=c
        if ch.strip() or prev is None: prev=c
        else: prev=dict(c, c=' ')
    if ul: out.append('</u>')
    h=''.join(out)
    h=re.sub(r'</sup><sup>','',h)
    h=re.sub(r' {2,}',' ',h).strip()
    return h
