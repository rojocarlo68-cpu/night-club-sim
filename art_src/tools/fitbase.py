from PIL import Image
import numpy as np, math
MAP={'se':'B','sw':'A','ne':'C','nw':'D'}
def load(k):
    im=np.array(Image.open(f'/workspace/cutouts/sofa_new/cut_{k}.png').convert('RGBA')); return im
def lowcontour(a):
    cols=np.nonzero(a.any(0))[0]
    return cols,np.array([np.nonzero(a[:,x])[0].max() for x in cols])
def robust(xs,ys,iters=300):
    best=None; rng=np.random.default_rng(0)
    for _ in range(iters):
        i,j=rng.choice(len(xs),2,replace=False)
        if xs[i]==xs[j]: continue
        s=(ys[j]-ys[i])/(xs[j]-xs[i]); c=ys[i]-s*xs[i]
        n=(np.abs(ys-(s*xs+c))<1.5).sum()
        if best is None or n>best[0]: best=(n,s,c)
    n,s,c=best; m=np.abs(ys-(s*xs+c))<2
    p=np.polyfit(xs[m],ys[m],1); return p,m.sum()
if __name__=='__main__':
    for f,k in MAP.items():
        im=load(k); a=im[:,:,3]>128; cols,low=lowcontour(a)
        iv=low.argmax(); xv=cols[iv]; yv=low[iv]
        # left of vertex & right of vertex ranges excluding 8 px near vertex
        L=(cols<xv-12); R=(cols>xv+12)
        # restrict to contiguous region where contour is linear: use robust fit
        pl,nl=robust(cols[L].astype(float),low[L].astype(float))
        pr,nr=robust(cols[R].astype(float),low[R].astype(float))
        print(f,k,'vertex',xv,yv,'left slope %.3f (%.1fdeg, n=%d)'%(pl[0],math.degrees(math.atan(abs(pl[0]))),nl),'right slope %.3f (%.1fdeg n=%d)'%(pr[0],math.degrees(math.atan(abs(pr[0]))),nr))
