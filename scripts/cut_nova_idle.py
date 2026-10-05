"""Nova idle (white bg + magenta residue) -> transparent cutout: python3 cut_nova_idle.py src.jpg out.png
Background = border-connected white + magenta/pink (red&blue >> green; maroon bow has b<<r, blue hair r<<b) + enclosed white pockets that touch
magenta (the white apron is kept); thin purple/white fringe within 2-3 px of the edge removed; colours decontaminated from the core."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
im=Image.open(sys.argv[1]).convert('RGB'); a=np.array(im).astype(int)
H,W=a.shape[:2]
r,g,b=a[...,0],a[...,1],a[...,2]
mx=a.max(2); mn=a.min(2)
dist=(255-a).max(axis=2)
# strong magenta / pink: red and blue both far above green, blue close to red (maroon bow has b << r, blue hair has r << b)
mag=((r-g)>50)&((b-g)>40)&(b>0.55*r)&(r>0.55*b)&(r>100)
print('mag px',mag.sum())
white=dist<=14
lab,n=ndi.label(white)
border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
bgw=np.isin(lab,list(border))
# magenta regions (closed by 1px to join antialiased fringe)
mk=ndi.binary_dilation(mag,iterations=1)
# enclosed near-white pockets are only background if they touch magenta (apron is white!)
lab2,n2=ndi.label(white&~bgw)
touch=ndi.binary_dilation(mag,iterations=3)
pock=np.zeros_like(bgw)
for i in range(1,n2+1):
    m=lab2==i
    if (m&touch).any(): pock|=m; print('white pocket touching magenta size',m.sum())
bg=bgw|mag|pock
fg=~bg
# drop specks, fill tiny holes
l,nn=ndi.label(fg,structure=np.ones((3,3))); sz=ndi.sum(fg,l,range(1,nn+1))
fg=np.isin(l,[i+1 for i,s in enumerate(sz) if s>=300])
inv=~fg; l3,n3=ndi.label(inv); s3=ndi.sum(inv,l3,range(1,n3+1))
for i,s in enumerate(s3,1):
    if s<6 : fg|=l3==i
# fringe: pink/purple tinted pixels and near-white halo within 4 px of the background
purple=((r-g)>14)&((b-g)>14)&(r>60)&~((g>140)&((r-g)<40))
ring=fg&~ndi.binary_erosion(fg,iterations=4)
ring3=fg&~ndi.binary_erosion(fg,iterations=3)
fg&=~(ring3&purple)
ring2=fg&~ndi.binary_erosion(fg,iterations=2)
fg&=~(ring2&(dist<=24))
ring3=fg&~ndi.binary_erosion(fg,iterations=3)
fg&=~(ring3&purple)
fg=ndi.binary_opening(fg,structure=np.ones((2,2)))
l,nn=ndi.label(fg,structure=np.ones((3,3))); sz=ndi.sum(fg,l,range(1,nn+1))
fg=np.isin(l,[i+1 for i,s in enumerate(sz) if s>=300])
# decontaminate colour: core eroded 2px, edge takes nearest core colour
core=ndi.binary_erosion(fg,iterations=2)
idx=ndi.distance_transform_edt(~core,return_distances=False,return_indices=True)
src=np.array(im)
rgb=np.where(core[...,None],src,src[idx[0],idx[1]])
alpha=ndi.binary_erosion(fg,iterations=1).astype(float)
alpha=np.clip((ndi.gaussian_filter(alpha,0.6)-0.12)/0.7,0,1)
out=np.dstack([rgb,(alpha*255).astype(np.uint8)]).astype(np.uint8)
Image.fromarray(out,'RGBA').save(sys.argv[2])
ys,xs=np.where(alpha>0.05);print('bbox',ys.min(),ys.max(),xs.min(),xs.max())
