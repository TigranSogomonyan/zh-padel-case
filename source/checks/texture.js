/* Разглядеть саму кожу: плитка albedo, карта нормалей и та же плитка,
   освещённая как в сцене. Всё из тех же функций, что и в странице.
   node checks/texture.js [pebble|smooth|saffiano] [файл.png] */
process.env.SOFT="1";
const fs=require("fs"), zlib=require("zlib"), vm=require("vm");
const html=fs.readFileSync("/Users/tigransogomonan/Documents/01 Projects/ZH/index.html","utf8");
const code=html.slice(html.indexOf("function rngFrom(seed)"),html.indexOf("const FINISHES="))+
           "\nout={rngFrom,voronoi,detail,hideSmooth,hidePebble,hideSaffiano,CLAMP};";
const ctx={console,Math,Float32Array,Uint8ClampedArray,out:null};
vm.createContext(ctx); vm.runInContext(code,ctx);

const KIND=process.argv[2]||"pebble", OUT=process.argv[3]||"/tmp/leather.png";
const S=512, TILE=55;                          // плитка 55 мм — как в развёртке
const f=ctx.out[{pebble:"hidePebble",smooth:"hideSmooth",saffiano:"hideSaffiano"}[KIND]](S,ctx.out.rngFrom(20260812));
const h=f.h;

let mn=1,mx=0,sum=0,sq=0;
for(let i=0;i<h.length;i++){ const v=h[i]; if(v<mn)mn=v; if(v>mx)mx=v; sum+=v; sq+=v*v; }
const m=sum/h.length;
console.log(KIND+": высота "+mn.toFixed(3)+".."+mx.toFixed(3)+", средняя "+m.toFixed(3)+
            ", разброс "+Math.sqrt(sq/h.length-m*m).toFixed(3));
console.log("  масштаб: "+(S/TILE).toFixed(1)+" точек на мм");

/* три поля рядом: albedo, нормали, освещённая плитка */
/* PANELS=lit — только освещённая кожа: вблизи и издали. Для сравнения
   вариантов карты не нужны, нужен вид материала. */
const LIT_ONLY=process.env.PANELS==="lit";
const P=4, W=S*P, H=S, px=new Uint8ClampedArray(W*H*3);
const ST=f.ST, put=(col,x,y,r,g,b)=>{ const o=((y)*W+col*S+x)*3; px[o]=r; px[o+1]=g; px[o+2]=b; };
const L=[[-0.36,0.63,0.70,1.5],[-0.19,0.95,0.38,.42],[0.83,0.18,0.51,.22]];
const HIDE=[0x22/255,0x30/255,0x4A/255];
for(let y=0;y<S;y++) for(let x=0;x<S;x++){
  const i=y*S+x, v=h[i];
  const a=Math.round(255*ctx.out.CLAMP(f.aBase+f.aSpan*v));
  put(0,x,y,a,a,a);
  const xl=(x-1+S)%S, xr=(x+1)%S, yu=((y-1+S)%S)*S, yd=((y+1)%S)*S;
  const dx=(h[y*S+xl]-h[y*S+xr])*ST, dy=(h[yd+x]-h[yu+x])*ST;
  const len=Math.sqrt(dx*dx+dy*dy+1), nx=dx/len, ny=dy/len, nz=1/len;
  put(1,x,y,(nx*.5+.5)*255,(ny*.5+.5)*255,(nz*.5+.5)*255);
  let lit=.34;
  for(const l of L){ const d=nx*l[0]+ny*l[1]+nz*l[2]; if(d>0) lit+=d*l[3]; }
  const alb=(f.aBase+f.aSpan*v)*1.42;
  const c=HIDE.map(function(k){
    let q=Math.pow(k,2.2)*alb*lit; q=q/(1+q*.42);
    return Math.pow(q,1/2.2)*255;
  });
  put(2,x,y,c[0],c[1],c[2]);
}

/* четвёртое поле: та же кожа, уменьшенная в 8 раз и растянутая обратно —
   так она выглядит на общем плане, когда чешуйка меньше пикселя */
(function(){
  const F=8, w2=S/F;
  const avg=new Float32Array(w2*w2*3);
  for(let y=0;y<S;y++) for(let x=0;x<S;x++){
    const o=((y)*W+2*S+x)*3, k=((y/F|0)*w2+(x/F|0))*3;
    avg[k]+=px[o]/(F*F); avg[k+1]+=px[o+1]/(F*F); avg[k+2]+=px[o+2]/(F*F);
  }
  for(let y=0;y<S;y++) for(let x=0;x<S;x++){
    const k=((y/F|0)*w2+(x/F|0))*3, o=((y)*W+3*S+x)*3;
    px[o]=avg[k]; px[o+1]=avg[k+1]; px[o+2]=avg[k+2];
  }
})();

const OW=LIT_ONLY?S*2:W, OX=LIT_ONLY?S*2:0;
const raw=Buffer.alloc((OW*3+1)*H);
let q=0;
for(let y=0;y<H;y++){ raw[q++]=0; for(let x=0;x<OW;x++){ const o=(y*W+OX+x)*3;
  raw[q++]=px[o]; raw[q++]=px[o+1]; raw[q++]=px[o+2]; } }
let TBL=null;
const crc32=b=>{ if(!TBL){TBL=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;TBL[n]=c>>>0;}}
  let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=TBL[(c^b[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,"ascii"),d]);
  const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);};
const ih=Buffer.alloc(13); ih.writeUInt32BE(OW,0); ih.writeUInt32BE(H,4); ih[8]=8; ih[9]=2;
fs.writeFileSync(OUT,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]));
console.log("  → "+OUT+"   "+(LIT_ONLY?"(вблизи | издали)":"(albedo | нормали | вблизи | издали)"));
