/* Снимок того, что страница рисует своим растеризатором, когда WebGL нет.
   Это не «похожий рендер», а ровно тот кадр, который увидит человек.
   node checks/render-soft.js [файл.png] */
process.env.NOGL="1";
const {REG}=require("./harness.js");
const fs=require("fs"), zlib=require("zlib");
const OUT=process.argv[2]||"preview-page.png";

/* FINE=1 — попросить чистовой проход: полное разрешение, плавные нормали,
   билинейная текстура и рельеф кожи */
if(process.env.FINE){
  const S=require("./harness.js").sandbox.__zhSoft;
  if(S){ S.renderer.setQuality(1); S.renderer.render(S.scene,S.camera); }
}
const cv=(REG.stage.children||[]).find(c=>c&&c.nodeName==="CANVAS");
if(!cv){ console.error("страница не создала канву"); process.exit(1); }
const f=cv._frame;
if(!f){ console.error("кадр не нарисован: putImageData не вызывался"); process.exit(1); }
console.log("кадр страницы: "+f.width+"×"+f.height);

const W=f.width,H=f.height,d=f.data;
let lit=0; for(let i=3;i<d.length;i+=4) if(d[i]) lit++;
console.log("закрашено пикселей: "+(100*lit/(W*H)).toFixed(1)+"%");

const raw=Buffer.alloc((W*3+1)*H);
let q=0;
for(let y=0;y<H;y++){
  raw[q++]=0;
  for(let x=0;x<W;x++){ const o=(y*W+x)*4; raw[q++]=d[o]; raw[q++]=d[o+1]; raw[q++]=d[o+2]; }
}
let TBL=null;
function crc32(buf){
  if(!TBL){ TBL=[]; for(let n=0;n<256;n++){ let c=n;
    for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; TBL[n]=c>>>0; } }
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c=TBL[(c^buf[i])&255]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function chunk(type,data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type,"ascii"),data]);
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len,td,crc]);
}
const ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
fs.writeFileSync(OUT,Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(raw,{level:9})), chunk("IEND",Buffer.alloc(0))]));
console.log("записано: "+OUT);
