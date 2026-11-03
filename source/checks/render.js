/* Программный рендер сцены в PNG — без WebGL и без зависимостей.
   Берётся та же сцена, которую собирает index.html; треугольники
   растеризуются с z-буфером и ламбертовым светом. Текстур нет:
   задача — увидеть форму, силуэт и посадку деталей.

   node checks/render.js [файл.png] [цвет]      цвет: navy|aqua|burgundy|orange|brown|white
*/
const {scene,THREE}=require("./harness.js");
const T=THREE, zlib=require("zlib"), fs=require("fs");

const OUT=process.argv[2]||"preview-soft.png";
const HIDE=(process.argv[3]||"navy").toLowerCase();
const HIDES={navy:0x22304A,aqua:0x5CBDB4,burgundy:0x63202A,
             orange:0xC85A1E,brown:0x6B4429,white:0xE6E1D8};
if(!scene){ console.error("сцена не собралась"); process.exit(1); }
scene.updateMatrixWorld(true);

/* ---------- собираем треугольники мира ---------- */
const TRIS=[];
function pushGeo(g,mat,color){
  const p=g.attributes.position, idx=g.index;
  const n=idx?idx.count:p.count;
  for(let f=0;f<n;f+=3){
    const ia=idx?idx.getX(f):f, ib=idx?idx.getX(f+1):f+1, ic=idx?idx.getX(f+2):f+2;
    const A=new T.Vector3().fromBufferAttribute(p,ia).applyMatrix4(mat),
          B=new T.Vector3().fromBufferAttribute(p,ib).applyMatrix4(mat),
          C=new T.Vector3().fromBufferAttribute(p,ic).applyMatrix4(mat);
    const fn=new T.Vector3().subVectors(B,A).cross(new T.Vector3().subVectors(C,A));
    if(fn.lengthSq()<1e-12) continue;
    TRIS.push({a:A,b:B,c:C,n:fn.normalize(),col:color});
  }
}
scene.traverse(function(o){
  if(!o.isMesh&&!o.isInstancedMesh) return;
  if(o.geometry.type==="PlaneGeometry") return;                 // тень под чехлом
  const m=o.material;
  let col=m.color?m.color.getHex():0x888888;
  // оттиск текстурой не отрисовать (канва в прогоне — заглушка), поэтому
  // площадка монограммы просто затемняется: видно, где она сядет
  const isMono=m.transparent&&m.map;
  if(m===sceneLeather()) col=HIDES[HIDE]||col;
  if(isMono){
    const base=HIDES[HIDE]||0x808080;
    col=((base>>16&255)*0.55&255)<<16|((base>>8&255)*0.55&255)<<8|((base&255)*0.55&255);
  }
  if(o.isInstancedMesh){
    const mm=new T.Matrix4();
    for(let i=0;i<o.count;i++){
      o.getMatrixAt(i,mm);
      pushGeo(o.geometry,new T.Matrix4().multiplyMatrices(o.matrixWorld,mm),col);
    }
  } else pushGeo(o.geometry,o.matrixWorld,col);
});
function sceneLeather(){
  if(sceneLeather._m!==undefined) return sceneLeather._m;
  let big=null,cnt=0;
  scene.traverse(function(o){
    if(o.isMesh&&o.geometry.attributes.uv&&o.geometry.attributes.position.count>cnt){
      cnt=o.geometry.attributes.position.count; big=o.material;
    }
  });
  return (sceneLeather._m=big);
}
console.log("треугольников:",TRIS.length);

/* ---------- камеры ---------- */
const ONLY=process.env.VIEW;
let VIEWS=[
  {name:"three-quarter", yaw:-0.42, pitch:0.30},
  {name:"front",         yaw: 0.00, pitch:0.02},
  {name:"profile",       yaw:-1.50, pitch:0.10},
  {name:"back",          yaw: 3.14, pitch:0.16}      // крепёж под ремень
];
if(ONLY) VIEWS=VIEWS.filter(v=>v.name===ONLY);
const PW=+(process.env.PW||440), PH=+(process.env.PH||700), PAD=14;
const W=VIEWS.length*PW+(VIEWS.length+1)*PAD, HH=PH+2*PAD;
const img=new Float32Array(W*HH*3);
for(let i=0;i<img.length;i+=3){ img[i]=0.055; img[i+1]=0.055; img[i+2]=0.058; }

const LIGHTS=[
  {d:new T.Vector3(-400,700,780).normalize(), i:1.50},
  {d:new T.Vector3(-150,760,300).normalize(), i:0.42},
  {d:new T.Vector3( 680,150,420).normalize(), i:0.22},
  {d:new T.Vector3( 230,-430,-600).normalize(), i:0.30}
];
const AMB=0.30;

function renderView(v,ox,oy){
  const dist=1180;
  const eye=new T.Vector3(dist*Math.cos(v.pitch)*Math.sin(v.yaw),
                          dist*Math.sin(v.pitch),
                          dist*Math.cos(v.pitch)*Math.cos(v.yaw));
  const cam=new T.PerspectiveCamera(30,PW/PH,10,6000);
  cam.position.copy(eye); cam.lookAt(0,0,0); cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const VP=new T.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);
  const zbuf=new Float32Array(PW*PH).fill(1e9);

  /* система координат ровно та же, что в странице: модель стоит в XY,
     толщина по Z, камера облетает её тем же образом */
  const toView=function(p){
    const q=p.clone().applyMatrix4(VP);
    return {x:(q.x*.5+.5)*PW, y:(1-(q.y*.5+.5))*PH, z:q.z};
  };

  TRIS.forEach(function(t){
    const A=toView(t.a),B=toView(t.b),C=toView(t.c);
    if(A.z<-1||B.z<-1||C.z<-1) return;
    const minx=Math.max(0,Math.floor(Math.min(A.x,B.x,C.x))),
          maxx=Math.min(PW-1,Math.ceil(Math.max(A.x,B.x,C.x))),
          miny=Math.max(0,Math.floor(Math.min(A.y,B.y,C.y))),
          maxy=Math.min(PH-1,Math.ceil(Math.max(A.y,B.y,C.y)));
    if(minx>maxx||miny>maxy) return;
    const d=(B.y-C.y)*(A.x-C.x)+(C.x-B.x)*(A.y-C.y);
    if(Math.abs(d)<1e-9) return;

    // свет по нормали грани, отвёрнутые от камеры гасим слабее (нет теней)
    const nv=t.n;
    let lit=AMB;
    LIGHTS.forEach(function(L){ lit+=Math.max(0,nv.dot(L.d))*L.i; });
    const cen=new T.Vector3((t.a.x+t.b.x+t.c.x)/3,(t.a.y+t.b.y+t.c.y)/3,(t.a.z+t.b.z+t.c.z)/3);
    const view=cen.clone().sub(eye).normalize();
    const spec=Math.pow(Math.max(0,nv.dot(new T.Vector3().subVectors(LIGHTS[0].d,view).normalize())),22)*0.22;
    const r=((t.col>>16)&255)/255, g=((t.col>>8)&255)/255, b=(t.col&255)/255;
    const sr=Math.pow(r,2.2)*lit+spec, sg=Math.pow(g,2.2)*lit+spec, sb=Math.pow(b,2.2)*lit+spec;

    for(let y=miny;y<=maxy;y++) for(let x=minx;x<=maxx;x++){
      const px=x+.5, py=y+.5;
      const w0=((B.y-C.y)*(px-C.x)+(C.x-B.x)*(py-C.y))/d;
      const w1=((C.y-A.y)*(px-C.x)+(A.x-C.x)*(py-C.y))/d;
      const w2=1-w0-w1;
      if(w0<0||w1<0||w2<0) continue;
      const z=w0*A.z+w1*B.z+w2*C.z;
      const k=y*PW+x;
      if(z>=zbuf[k]) continue;
      zbuf[k]=z;
      const o=((y+oy)*W+(x+ox))*3;
      img[o]=Math.pow(Math.min(1,sr),1/2.2);
      img[o+1]=Math.pow(Math.min(1,sg),1/2.2);
      img[o+2]=Math.pow(Math.min(1,sb),1/2.2);
    }
  });
  console.log("  "+v.name+": закрашено "+
    (100*zbuf.filter(z=>z<1e9).length/zbuf.length).toFixed(1)+"% кадра");
}
VIEWS.forEach(function(v,i){ renderView(v,PAD+i*(PW+PAD),PAD); });

/* ---------- PNG ---------- */
const raw=Buffer.alloc((W*3+1)*HH);
let q=0;
for(let y=0;y<HH;y++){
  raw[q++]=0;
  for(let x=0;x<W;x++){
    const o=(y*W+x)*3;
    raw[q++]=Math.round(img[o]*255); raw[q++]=Math.round(img[o+1]*255); raw[q++]=Math.round(img[o+2]*255);
  }
}
function chunk(type,data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type,"ascii"),data]);
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(td)>>>0);
  return Buffer.concat([len,td,crc]);
}
let TBL=null;
function crc32(buf){
  if(!TBL){ TBL=[]; for(let n=0;n<256;n++){ let c=n;
    for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; TBL[n]=c>>>0; } }
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c=TBL[(c^buf[i])&255]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
const ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(HH,4);
ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
fs.writeFileSync(OUT,Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(raw,{level:9})), chunk("IEND",Buffer.alloc(0))
]));
console.log("записано: "+OUT+"  "+W+"×"+HH);
