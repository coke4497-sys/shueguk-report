import sys, os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
P=os.environ.get('WB_DIR','..').rstrip('/')
import items, lay, pymupdf, pickle, os
if os.path.exists(P+'/J.pkl'): J=pickle.load(open(P+'/J.pkl','rb'))
else:
    allt=[]
    for f in ('robot','w2v'):
        p=f'{P}/pdf/{f}.pdf'; n=len(pymupdf.open(p))
        allt+=[items.plain(lay.line_html(L,'none')) for L in items.doc_lines(p, range(1,n+1))]
    J=items.Joiner(allt); pickle.dump(J,open(P+'/J.pkl','wb'))
