import numpy as np, sys
from PIL import Image
f=sys.argv[1]; OS=float(sys.argv[2]); out=sys.argv[3]
im=Image.open(f).convert('RGB'); a=np.array(im).astype(float)
x0=480-838.0952380952381/2; y0=252-419.047619047619/2
N=40; lo,hi=-3,14
n=(hi-lo)*N
c=np.linspace(lo,hi,n,endpoint=False)+0.5/N
C,R=np.meshgrid(c,c)  # C varies along x(out), R along y
X=(C-R)*32+480; Y=(C+R)*16+70
xi=((X-x0)*OS).astype(int); yi=((Y-y0)*OS).astype(int)
ok=(xi>=0)&(xi<a.shape[1])&(yi>=0)&(yi<a.shape[0])
o=np.zeros((n,n,3),np.uint8); o[ok]=a[yi[ok],xi[ok]].astype(np.uint8)
# out[row_index=R(y), col_index=C(x)]
Image.fromarray(o).save(out)
r,g,b=o[...,0].astype(float),o[...,1].astype(float),o[...,2].astype(float)
neon=((r>215)&(b>150)&(g<170)&(r-g>70))|((b>215)&(g>190)&(r<170))
print(o.shape)
colh=neon[int((2.5-lo)*N):int((8.5-lo)*N)].sum(0)   # along rows 2.5..8.5, hist over col
rowh=neon[:,int((2.5-lo)*N):int((8.5-lo)*N)].sum(1)
def peaks(h,name):
    idx=np.argsort(h)[::-1]; got=[]
    for i in idx:
        v=lo+i/N
        if all(abs(v-g)>0.25 for g in got) and h[i]>40: got.append(v)
        if len(got)>=8: break
    print(name,[(round(g,2),int(h[int((g-lo)*N)])) for g in sorted(got)])
peaks(colh,'col(x) peaks'); peaks(rowh,'row(y) peaks')
