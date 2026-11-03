/* Прогон страницы вхолостую: настоящий three, заглушки DOM, канвы и рендерера.
   Ловит всё, что иначе видно только в браузере. */
const fs=require("fs"), vm=require("vm"), path=require("path");
const HTML=fs.readFileSync(process.env.INDEX||require("path").join(__dirname,"..","index.html"),"utf8");
const NOGL=!!process.env.NOGL;
/* GLBLANK=1 — самый подлый случай: контекст WebGL создаётся, а кадр пустой */
const GLBLANK=!!process.env.GLBLANK;
/* Страница по умолчанию WebGL не трогает; прогоны, которым он нужен,
   притворяются открытыми с ?gl=1. */
const SEARCH=process.env.SEARCH||((NOGL||process.env.SOFT)?"":"?gl=1");
let GLMADE=false;
const FRAMES=+(process.env.FRAMES||(GLBLANK?14:3));

const THREE=require("three");
/* рендерера нет — подменяем, остальное three настоящее */
let LAST=null;
class FakeRenderer{
  constructor(){ GLMADE=true; this.capabilities={getMaxAnisotropy:()=>8}; this.domElement=mkCanvas(900,640); }
  setPixelRatio(){} setSize(){} dispose(){}
  render(sc,cam){ LAST={scene:sc,camera:cam}; }
  getContext(){
    return {drawingBufferWidth:900, drawingBufferHeight:640, RGBA:1, UNSIGNED_BYTE:2,
            readPixels(x,y,w,h,f,t,buf){ buf.fill(GLBLANK?0:255); }};
  }
}
THREE.WebGLRenderer=FakeRenderer;

/* ---------- канва ---------- */
function mkCtx2D(cv){
  const stub={};
  const noop=function(){ return stub; };
  ["fillRect","clearRect","beginPath","arc","moveTo","lineTo","stroke","fill",
   "save","restore","translate","rotate","scale","fillText","strokeText",
   "closePath","bezierCurveTo","quadraticCurveTo","setTransform","drawImage",
   "clip","rect","measureText"].forEach(k=>stub[k]=noop);
  stub.measureText=()=>({width:100});
  stub.createLinearGradient=stub.createRadialGradient=()=>({addColorStop:noop});
  stub.createImageData=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});
  /* Настоящее хранилище пикселей: страница кладёт сюда свой кадр через
     putImageData, и его можно вытащить и записать в PNG. Для текстур,
     которые рисуются 2D-командами (их заглушка не исполняет), отдаём
     ровный серый с нулевой альфой — зерно выйдет однородным. */
  stub.getImageData=function(x,y,w,h){
    if(cv._frame&&cv._frame.width===w&&cv._frame.height===h) return cv._frame;
    const d=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<d.length;i+=4){ d[i]=d[i+1]=d[i+2]=128; d[i+3]=0; }
    return {width:w,height:h,data:d};
  };
  stub.putImageData=function(img){ cv._frame=img; return stub; };
  stub.canvas=cv;
  return stub;
}
function mkCanvas(w,h){
  const cv={
    width:w||300, height:h||150, style:{}, nodeName:"CANVAS",
    getContext(kind){
      if(kind==="2d") return this._c2||(this._c2=mkCtx2D(this));
      return NOGL?null:{getExtension:()=>({loseContext(){}})};
    },
    addEventListener(){}, removeEventListener(){},
    setPointerCapture(){}, getBoundingClientRect:()=>({left:0,top:0,width:900,height:640}),
    /* Настоящий PNG из последнего кадра: страница снимает превью для
       заявки именно так, и без этого сквозной прогон ничего не проверяет. */
    toDataURL(){ return cv._frame ? "data:image/png;base64,"+pngOf(cv._frame) : "data:image/png;base64,"; },
    appendChild(){}, classList:{add(){},remove(){},contains:()=>false}
  };
  return cv;
}

/* PNG из ImageData — тем же кодом пользуются прогоны, снимающие картинки */
let CRCT=null;
function crc32(buf){
  if(!CRCT){ CRCT=[]; for(let n=0;n<256;n++){ let c=n;
    for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; CRCT[n]=c>>>0; } }
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c=CRCT[(c^buf[i])&255]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function pngOf(frame){
  const zlib=require("zlib"), W=frame.width, H=frame.height, d=frame.data;
  const raw=Buffer.alloc((W*3+1)*H);
  let q=0;
  for(let y=0;y<H;y++){
    raw[q++]=0;
    for(let x=0;x<W;x++){
      const o=(y*W+x)*4, a=d[o+3]/255;         // подложка сцены из CSS
      raw[q++]=d[o]*a+12*(1-a); raw[q++]=d[o+1]*a+12*(1-a); raw[q++]=d[o+2]*a+12*(1-a);
    }
  }
  const chunk=(type,data)=>{
    const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td=Buffer.concat([Buffer.from(type,"ascii"),data]);
    const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len,td,crc]);
  };
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(raw,{level:6})),
    chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
module.exports=module.exports||{};

/* ---------- элементы ---------- */
const REG={};
function mkEl(id,tag){
  const el={
    id:id, tagName:(tag||"div").toUpperCase(), dataset:{}, style:{}, children:[],
    value:"", textContent:"", innerHTML:"", disabled:false, title:"",
    firstChild:{nodeValue:""},
    _on:{},
    classList:{ _s:new Set(),
      add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this[k]=v; }, getAttribute(k){ return this[k]; },
    addEventListener(t,f){ (this._on[t]=this._on[t]||[]).push(f); },
    removeEventListener(){}, appendChild(c){ c.parentNode=this; this.children.push(c); return c; },
    removeChild(c){ const i=this.children.indexOf(c); if(i>=0) this.children.splice(i,1); },
    closest(){ return this; }, focus(){}, select(){}, reset(){}, click(){},
    getBoundingClientRect:()=>({left:0,top:0,width:900,height:640}),
    querySelector(){ return null; },
    fire(t,ev){ (this._on[t]||[]).forEach(f=>f.call(this,Object.assign({
      preventDefault(){}, stopPropagation(){}, target:this, closest:()=>this
    },ev))); if(typeof this["on"+t]==="function") this["on"+t](ev||{}); },
    get clientWidth(){ return 900; }, get clientHeight(){ return 640; }
  };
  el.children[Symbol.iterator]=Array.prototype[Symbol.iterator];
  return el;
}
["stage","views","hint","hideName","swatches","finish","inits","count","face",
 "size","sizeVal","posVal","posX","posY","save","reset","zipLen","finishNote",
 "strap","summary","orderForm","ordName","ordMail","ordTg","ordNote","ordSend",
 "ordCopy","ordStatus"].forEach(id=>REG[id]=mkEl(id));

const document={
  documentElement:mkEl("html","html"),
  getElementById:id=>REG[id]||null,
  createElement(tag){
    if(tag==="canvas") return mkCanvas();
    const el=mkEl(null,tag);
    const setId=Object.getOwnPropertyDescriptor(el,"id");
    Object.defineProperty(el,"id",{get(){ return el._id; },
      set(v){ el._id=v; if(v) REG[v]=el; }, configurable:true});
    return el;
  },
  addEventListener(){}, body:{appendChild(){},removeChild(){}},
  fonts:null, execCommand:()=>true, querySelector:()=>null
};

/* ---------- окно ---------- */
const errors=[];
const sandbox={
  THREE, document, console,
  window:null, navigator:{clipboard:null},
  devicePixelRatio:+(process.env.DPR||1.5),
  matchMedia:()=>({matches:false}),
  addEventListener(t,f){ if(t==="error"||t==="unhandledrejection") errors.push(["listener",t]); },
  requestAnimationFrame(f){ if(sandbox.__frames===undefined) sandbox.__frames=0;
    if(sandbox.__frames++<FRAMES) f(0); return 1; },
  setTimeout(f){ f(); return 1; },
  clearTimeout(){}, location:{reload(){},href:"",search:SEARCH},
  /* Сеть в стенде закрыта; ALLOW_FETCH=1 открывает её для сквозного
     прогона «страница → API». */
  fetch:process.env.ALLOW_FETCH?((...a)=>globalThis.fetch(...a))
                               :(()=>Promise.reject(new Error("no network in harness"))),
  __ZH_ORDER_ENDPOINT:process.env.ORDER_ENDPOINT||undefined,
  Promise, JSON, Math, Date, Object, Array, String, Number, Map, Set, isNaN,
  Float32Array, Uint8ClampedArray, encodeURIComponent, parseInt, parseFloat
};
sandbox.window=sandbox; sandbox.self=sandbox; sandbox.globalThis=sandbox;
vm.createContext(sandbox);

/* ---------- запуск скриптов страницы ---------- */
const blocks=[];
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m; while((m=re.exec(HTML))) blocks.push(m[1]);
console.log("инлайновых скриптов:", blocks.length);

/* NOVM=1 — выполнить скрипты страницы прямо в этой реальности, без vm.
   Внутри vm типизированные массивы работают в полтора десятка раз медленнее,
   и замеры скорости рендера получаются про песочницу, а не про рендер. */
const NOVM=!!process.env.NOVM;
const GLOBALS=["THREE","document","window","navigator","devicePixelRatio","matchMedia",
               "addEventListener","requestAnimationFrame","setTimeout","clearTimeout",
               "location","fetch","self"];
blocks.forEach(function(code,i){
  try{
    if(NOVM){
      const fn=new Function(GLOBALS.join(","),code);
      fn.apply(null,GLOBALS.map(k=>sandbox[k]));
    } else {
      vm.runInContext(code,sandbox,{filename:"block"+i+".js"});
    }
  }
  catch(e){ console.log("  ПАДЕНИЕ в блоке "+i+": "+e.stack.split("\n").slice(0,3).join("\n    ")); process.exitCode=1; }
});


module.exports={sandbox,REG,THREE,mkEl,
  get scene(){ return (LAST&&LAST.scene)||(sandbox.__zhSoft&&sandbox.__zhSoft.scene); },
  get camera(){ return (LAST&&LAST.camera)||(sandbox.__zhSoft&&sandbox.__zhSoft.camera); },
  get glMade(){ return GLMADE; }};
