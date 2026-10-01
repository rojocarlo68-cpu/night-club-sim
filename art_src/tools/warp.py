import json, math, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from fitbase import MAP
G=json.load(open('/workspace/sofa_work/geom.json'))
FP={'se':(1,2),'sw':(2,1),'nw':(1,2),'ne':(2,1)}
OUT='/workspace/night-club-sim/public/assets/furniture/sofa_%s.png'
SSAA=8   # warp grid px per display px
TEX=2    # final texture px per display px
def build(f, kE=1.0):
    k=MAP[f]; g=G[f]; fw,fh=FP[f]
    im=np.array(Image.open(f'/workspace/cutouts/sofa_new/cut_{k}.png').convert('RGBA')).astype(np.float64)
    H,W,_=im.shape
    a=im[...,3:4]/255.0
    pm=np.concatenate([im[...,:3]*a, a],2)   # premultiplied RGBA 0..1ish (rgb 0..255*a)
    XV,YV=g['V']; ml=g['sl']; mr=g['sr']
    dxL=32.0*fw; dxR=32.0*fh
    # measured extents of the base edges in source x
    ext_l=XV-g['xL']; ext_r=g['xR']-XV
    sl=dxL/ext_l; sr=dxR/ext_r     # display px per src px, left/right pieces
    e = (sl if f in ('sw','ne') else sr)*kE
    dl=0.5*sl - e*ml
    dr=-0.5*sr - e*mr
    # output bbox in display px (relative to V)
    xs_min=(0-XV)*sl; xs_max=(W-XV)*sr
    ys=[]; 
    for x in (0,XV,W):
        for y in (0,H):
            if x<XV: ys.append(e*(y-YV)+dl*(x-XV))
            else: ys.append(e*(y-YV)+dr*(x-XV))
    y_min=min(ys); y_max=max(ys)
    pad=1.0
    x0=math.floor(xs_min)-pad; x1=math.ceil(xs_max)+pad; y0=math.floor(y_min)-pad; y1=math.ceil(y_max)+pad
    # make V sit on a texture-pixel boundary: integer display px => fine
    OW=int((x1-x0)*SSAA); OH=int((y1-y0)*SSAA)
    xo=x0+(np.arange(OW)+0.5)/SSAA; yo=y0+(np.arange(OH)+0.5)/SSAA
    XO,YO=np.meshgrid(xo,yo)
    left=XO<0
    xsrc=np.where(left, XV+XO/sl, XV+XO/sr)
    dd=np.where(left, dl, dr)
    sc=np.where(left, sl, sr)
    ysrc=YV+(YO-dd*(xsrc-XV))/e
    # prefilter source (area-ish) to avoid aliasing: blur sigma ~ half the decimation factor
    dec=1.0/(min(sl,sr)*SSAA)   # src px per grid px (min scale => largest dec is for min scale... use per-piece)
    out=np.zeros((OH,OW,4))
    for piece,s in (('l',sl),('r',sr)):
        sig=max(0.0,0.5*(1.0/(s*SSAA))*0.9)  # <1 means upsampling: no blur
        src=pm if sig<0.4 else np.stack([ndi.gaussian_filter(pm[...,c],sig) for c in range(4)],2)
        m=left if piece=='l' else ~left
        coords=[ysrc,xsrc]
        for c in range(4):
            v=ndi.map_coordinates(src[...,c],[ysrc,xsrc],order=1,mode='constant',cval=0.0)
            out[...,c]=np.where(m,v,out[...,c])
    # to straight-alpha at SSAA, then premult downsample to TEX
    A=np.clip(out[...,3],0,1)
    big=Image.fromarray(np.clip(out*np.array([1,1,1,255]),0,255).astype(np.uint8) if False else (np.clip(np.concatenate([out[...,:3]/255.0,out[...,3:4]],2),0,1)*255).astype(np.uint8),'RGBA')
    # premultiplied RGBA in uint8 -> resize with LANCZOS (premult stays linear) -> unpremultiply
    tw=int(round((x1-x0)*TEX)); th=int(round((y1-y0)*TEX))
    small=big.resize((tw,th),Image.LANCZOS)
    sa=np.array(small).astype(np.float64)/255.0
    al=np.clip(sa[...,3:4],0,1)
    rgb=np.where(al>1e-4, sa[...,:3]/np.maximum(al,1e-4), 0)
    rgb=np.clip(rgb,0,1)
    # clean faint alpha, keep soft edge
    al=np.where(al<0.02,0,al)
    res=np.concatenate([rgb,al],2)
    img=Image.fromarray((res*255+0.5).astype(np.uint8),'RGBA')
    # trim transparent borders (keep V reference)
    bb=img.split()[3].point(lambda v:255 if v>8 else 0).getbbox()
    cropx,cropy=bb[0],bb[1]
    img=img.crop(bb)
    Vx_tex=(0-x0)*TEX-cropx; Vy_tex=(0-y0)*TEX-cropy
    w_d=img.width/TEX; h_d=img.height/TEX
    meta=dict(w=round(w_d,3),h=round(h_d,3),vx=round(Vx_tex/TEX-w_d/2,3),vy=round(Vy_tex/TEX-h_d/2,3),tex=[img.width,img.height],sl=sl,sr=sr,e=e,dl=dl,dr=dr)
    return img,meta
KE=float(sys.argv[1]) if len(sys.argv)>1 else 1.0
if __name__=='__main__':
    meta={}
    for f in ('se','sw','nw','ne'):
        img,m=build(f,KE); img.save(OUT%f,optimize=True); meta[f]=m; print(f,m)
    json.dump(meta,open('/workspace/sofa_work/meta2.json','w'),indent=1)
