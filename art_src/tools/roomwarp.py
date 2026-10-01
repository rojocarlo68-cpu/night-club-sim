import numpy as np, math, json, sys
from PIL import Image
L=np.load('lines.npy',allow_pickle=True).item()
W,H=1168,784
SX=838.0952380952381/W; SY=419.047619047619/H
def inter(a,b):  # y=s x+c
    x=(b[1]-a[1])/(a[0]-b[0]); return np.array([x,a[0]*x+a[1]])
src={'top':inter(L['TL'],L['TR']),'right':inter(L['TR'],L['BR']),'bottom':inter(L['BR'],L['BL']),'left':inter(L['BL'],L['TL'])}
def P(c,r): return np.array([(c-r)*32+480,(c+r)*16+70])
A=float(sys.argv[1]) if len(sys.argv)>1 else 0.5   # boundary tile coord
B=10+ (0.5 if len(sys.argv)<=2 else float(sys.argv[2]))
dst={'top':P(A,A),'right':P(B,A),'bottom':P(B,B),'left':P(A,B)}
for k in src: print(k,src[k].round(1),'->',dst[k].round(1))
# homography dst->src (scene coords)
def homog(d,s):
    M=[];
    for (x,y),(u,v) in zip(d,s):
        M.append([x,y,1,0,0,0,-u*x,-u*y,-u]); M.append([0,0,0,x,y,1,-v*x,-v*y,-v])
    _,_,Vt=np.linalg.svd(np.array(M)); h=Vt[-1].reshape(3,3); return h/h[2,2]
ks=['top','right','bottom','left']
Hds=homog([dst[k] for k in ks],[src[k] for k in ks])
# output canvas: scene rect cx=480,cy=252, 838.095 x 419.048 at OS px per scene px
OS=2
OW,OH=int(round(838.0952380952381*OS)),int(round(419.047619047619*OS))
x0=480-838.0952380952381/2; y0=252-419.047619047619/2
# out px (i,j) -> scene (x0+i/OS, y0+j/OS) -> src scene via Hds -> src px ((u-x0)/SX, (v-y0)/SY)
T1=np.array([[1/OS,0,x0],[0,1/OS,y0],[0,0,1]])
T2=np.array([[1/SX,0,-x0/SX],[0,1/SY,-y0/SY],[0,0,1]])
M=T2@Hds@T1; M/=M[2,2]
im=Image.open('room_floor_ORIGINAL.jpeg').convert('RGB')
out=im.transform((OW,OH),Image.PERSPECTIVE,tuple(M.flatten()[:8]),Image.BICUBIC)
out.save('room_warped.png'); print(out.size)
json.dump({'OW':OW,'OH':OH,'H':Hds.tolist()},open('room_warp.json','w'))
