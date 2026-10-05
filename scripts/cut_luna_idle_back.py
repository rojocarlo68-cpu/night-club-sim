# Luna back idle: JPG(white bg) -> transparent RGBA cutout. usage: cut_luna_idle_back.py src.jpg out.png
# border flood + enclosed pure-white pockets (leg gap, under skirt, arm/body gaps) removed; hem-ruffle lobes (pure white, no outline) restored via traced polygons.
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
im=Image.open(__import__('sys').argv[1]).convert('RGB'); a=np.array(im).astype(int)
dist=(255-a).max(axis=2)
lab,n=ndi.label(dist<=12)
border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
bg=np.isin(lab,list(border))
# enclosed pure-white pockets (legs gap, under skirt, arm/body gaps, hair gaps): dist<=5 comps >=12px
lab5,n5=ndi.label(dist<=5)
s5=ndi.sum(np.ones_like(lab5),lab5,range(1,n5+1))
bg|=np.isin(lab5,[i for i in range(1,n5+1) if s5[i-1]>=12])
# grow enclosed pockets by dist<=12 pixels touching them (halo around pockets)
lab12=lab
fg=~bg
# Hem ruffle lobes are pure white with no outline where they touch the backdrop -> restore by hand-traced polygons
from PIL import ImageDraw
def poly(pts,ox,oy,k=3):
    m=Image.new('L',(a.shape[1],a.shape[0]),0)
    ImageDraw.Draw(m).polygon([(ox+x/k,oy+y/k) for x,y in pts],fill=1)
    return np.array(m).astype(bool)
RESTORE=poly([(215,200),(270,215),(300,255),(370,267),(390,243),(440,265),(470,284),(560,300),(560,150),(400,170),(330,140),(215,120)],60,980)
RESTORE|=poly([(660,60),(600,110),(500,185),(445,215),(412,236),(330,275),(240,292),(200,285),(200,100),(560,0),(655,0)],400,980)
fg|=RESTORE
fgo=ndi.binary_opening(fg,structure=np.ones((2,2)))
l2,n2=ndi.label(fgo,structure=np.ones((3,3)))
sz=ndi.sum(fgo,l2,range(1,n2+1))
fgo=np.isin(l2,[i+1 for i,s in enumerate(sz) if s>=300])
inv=~fgo; l3,n3=ndi.label(inv); s3=ndi.sum(inv,l3,range(1,n3+1))
for i,s in enumerate(s3,1):
    if s<12: fgo|=l3==i
# drop 1px more of the edge (halo) then decontaminate colors
core=ndi.binary_erosion(fgo,iterations=2)
idx=ndi.distance_transform_edt(~core,return_distances=False,return_indices=True)
rgb=np.array(im)[idx[0],idx[1]]
rgb=np.where(core[...,None],np.array(im),rgb)
alpha=ndi.binary_erosion(fgo,iterations=1).astype(float)
alpha=np.clip((ndi.gaussian_filter(alpha,0.7)-0.15)/0.7,0,1)
out=np.dstack([rgb,(alpha*255).astype(np.uint8)]).astype(np.uint8)
Image.fromarray(out,'RGBA').save(__import__('sys').argv[2])
ys,xs=np.where(alpha>0.05);print(ys.min(),ys.max(),xs.min(),xs.max())
for c,name in ():
    bgc=Image.new('RGBA',(out.shape[1],out.shape[0]),c+(255,));bgc.alpha_composite(Image.fromarray(out,'RGBA'));bgc.convert('RGB').save(f'check_{name}.png')
