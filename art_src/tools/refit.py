import numpy as np, random
from PIL import Image
o=np.array(Image.open(''+__import__('sys').argv[1]+'')).astype(float)
N=40; lo=-3
r,g,b=o[...,0],o[...,1],o[...,2]
core=((r>215)&(b>140)&(g<150)&(r-g>80))|((b>215)&(g>190)&(r<150))
random.seed(5)
bands={'TL':(-0.2,1.0),'TR':(0.7,1.9),'BR':(9.8,11.2),'BL':(9.8,11.2)}
res={}
for side,(a,bnd) in bands.items():
    pts=[]
    for al in np.arange(1.5,9.51,0.05):
        ai=int((al-lo)*N)
        for d in (0,):
            ln=core[ai,:] if side in('TL','BR') else core[:,ai]
            idx=[i for i in range(int((a-lo)*N),int((bnd-lo)*N)) if ln[i]]
            if idx:
                v=lo+(idx[-1] if side in('TL','TR') else idx[0])/N   # innermost
                pts.append((al,v))
    pts=np.array(pts)
    best=None
    for _ in range(3000):
        i,j=random.sample(range(len(pts)),2)
        if abs(pts[i,0]-pts[j,0])<2: continue
        s=(pts[j,1]-pts[i,1])/(pts[j,0]-pts[i,0]); c=pts[i,1]-s*pts[i,0]
        n=(np.abs(pts[:,1]-(s*pts[:,0]+c))<0.06).sum()
        if best is None or n>best[0]: best=(n,s,c)
    n,s,c=best; k=np.abs(pts[:,1]-(s*pts[:,0]+c))<0.08
    p=np.polyfit(pts[k,0],pts[k,1],1)
    print(side,len(pts),'inl',int(k.sum()),'perp = %.3f*along + %.3f'%tuple(p),' at along1.5: %.2f  at 9.5: %.2f'%(np.polyval(p,1.5),np.polyval(p,9.5)), 'resid std %.3f'%np.std(pts[k,1]-np.polyval(p,pts[k,0])))
    res[side]=p
np.save('refit_out.npy',res,allow_pickle=True)
