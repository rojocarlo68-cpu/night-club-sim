import numpy as np, json
from PIL import Image
R=np.load('refit.npy',allow_pickle=True).item()
H1=np.array(json.load(open('room_warp.json'))['H'])
def S(c,r): return np.array([(c-r)*32+480,(c+r)*16+70.])
# lines in W1 tile coords: TL: col=a*row+b ; TR: row=a*col+b ; BR: col=a*row+b ; BL: row=a*col+b
def inter_col_row(colline,rowline):
    a,b=colline; c,d=rowline   # col=a*row+b ; row=c*col+d
    col=(a*d+b)/(1-a*c); row=c*col+d; return col,row
TL,TR,BR,BL=R['TL'],R['TR'],R['BR'],R['BL']
src={'top':S(*inter_col_row(TL,TR)),'right':S(*inter_col_row(BR,TR)),'bottom':S(*inter_col_row(BR,BL)),'left':S(*inter_col_row(TL,BL))}
dst={'top':S(0.5,0.5),'right':S(10.5,0.5),'bottom':S(10.5,10.5),'left':S(0.5,10.5)}
for k in src: print(k,src[k].round(1),dst[k])
def homog(d,s):
    M=[]
    for (x,y),(u,v) in zip(d,s):
        M.append([x,y,1,0,0,0,-u*x,-u*y,-u]); M.append([0,0,0,x,y,1,-v*x,-v*y,-v])
    _,_,Vt=np.linalg.svd(np.array(M)); h=Vt[-1].reshape(3,3); return h/h[2,2]
ks=['top','right','bottom','left']
H2=homog([dst[k] for k in ks],[src[k] for k in ks])
Ht=H1@H2
OS=2; SX=838.0952380952381/1168; SY=419.047619047619/784
x0=480-838.0952380952381/2; y0=252-419.047619047619/2
OW,OH=1676,838
T1=np.array([[1/OS,0,x0],[0,1/OS,y0],[0,0,1]]); T2=np.array([[1/SX,0,-x0/SX],[0,1/SY,-y0/SY],[0,0,1]])
M=T2@Ht@T1; M/=M[2,2]
im=Image.open('room_floor_ORIGINAL.jpeg').convert('RGB')
out=im.transform((OW,OH),Image.PERSPECTIVE,tuple(M.flatten()[:8]),Image.BICUBIC)
out.save('room_warped2.png')
json.dump({'H':Ht.tolist()},open('room_warp2.json','w'))
