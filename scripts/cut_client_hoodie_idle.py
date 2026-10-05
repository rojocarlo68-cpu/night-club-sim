import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
im=Image.open(sys.argv[1]).convert('RGB'); a=np.array(im).astype(int)
H,W=a.shape[:2]
r,g,b=a[...,0],a[...,1],a[...,2]
dist=(255-a).max(axis=2)
# magenta/pink: blue well above green and red well above green
mag=((b-g)>35)&((r-g)>45)&(r>110)
# also light pink fringe (bg-ish pink): high all but g lower
lightpink=(r>200)&(b>170)&(g<r-40)&(b>g+25)
pinkseed=mag|lightpink
print('pink px',pinkseed.sum())
# white bg connected to border
lab,n=ndi.label(dist<=12)
border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
bg=np.isin(lab,list(border))
# enclosed pure-white pockets
lab5,n5=ndi.label(dist<=5)
s5=ndi.sum(np.ones_like(lab5),lab5,range(1,n5+1))
bg|=np.isin(lab5,[i for i in range(1,n5+1) if s5[i-1]>=12])
# pink pockets: components of pink (dilated by 1 to join fringe) of size>=6 (skip: hoodie orange not pink)
pk=ndi.binary_closing(pinkseed,structure=np.ones((3,3)))
lp,npk=ndi.label(pk)
sp=ndi.sum(np.ones_like(lp),lp,range(1,npk+1))
big=[i for i in range(1,npk+1) if sp[i-1]>=6]
bg|=np.isin(lp,big)
np.save('bg_raw.npy',bg)
fg=~bg
Image.fromarray((fg*255).astype(np.uint8)).save('fg_mask.png')
# keep the main subject; drop tiny specks; fill tiny non-bg holes
fgo=ndi.binary_opening(fg,structure=np.ones((2,2)))
l2,n2=ndi.label(fgo,structure=np.ones((3,3)))
sz=ndi.sum(fgo,l2,range(1,n2+1))
fgo=np.isin(l2,[i+1 for i,s in enumerate(sz) if s>=400])
inv=~fgo; l3,n3=ndi.label(inv); s3=ndi.sum(inv,l3,range(1,n3+1))
for i,s in enumerate(s3,1):
    if s<10: fgo|=l3==i
# also remove any remaining pink-ish pixels within 3px of the edge (halo) 
edge=fgo&~ndi.binary_erosion(fgo,iterations=3)
whiteish=(dist<=24)
purple=((b-g)>8)&((r-g)>8)
edge6=fgo&~ndi.binary_erosion(fgo,iterations=6)
fgo&=~(edge6&purple)

for _ in range(2):
    edge=fgo&~ndi.binary_erosion(fgo,iterations=3)
    fgo&=~(edge&(mag|lightpink|whiteish))
fgo=ndi.binary_opening(fgo,structure=np.ones((2,2)))
l4,n4=ndi.label(fgo,structure=np.ones((3,3)));s4=ndi.sum(fgo,l4,range(1,n4+1))
fgo=np.isin(l4,[i+1 for i,v in enumerate(s4) if v>=400])
# color decontamination: core eroded 2px, outside copy nearest core colour
core=ndi.binary_erosion(fgo,iterations=3)
idx=ndi.distance_transform_edt(~core,return_distances=False,return_indices=True)
src=np.array(im)
rgb=np.where(core[...,None],src,src[idx[0],idx[1]])
alpha=ndi.binary_erosion(fgo,iterations=1).astype(float)
alpha=np.clip((ndi.gaussian_filter(alpha,0.7)-0.15)/0.7,0,1)
out=np.dstack([rgb,(alpha*255).astype(np.uint8)]).astype(np.uint8)
Image.fromarray(out,'RGBA').save('client_hoodie_cutout.png')
ys,xs=np.where(alpha>0.05);print('bbox',ys.min(),ys.max(),xs.min(),xs.max())
for c,name in (((255,0,255),'mag'),((0,200,0),'grn')):
    bgc=Image.new('RGBA',(W,H),c+(255,));bgc.alpha_composite(Image.fromarray(out,'RGBA'));bgc.convert('RGB').save(f'check_{name}.png')
    bgc.convert('RGB').crop((100,900,435,1327)).resize((670,854),Image.LANCZOS).save(f'check_{name}_legs.png')
    bgc.convert('RGB').crop((120,0,360,200)).resize((720,600),Image.LANCZOS).save(f'check_{name}_head.png')
