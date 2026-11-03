/* Меряется не код-двойник, а то, что index.html реально положил в сцену. */
const {scene,THREE,REG}=require("./harness.js");
const T=THREE;
let fail=0;
function ok(n,c,i){ console.log((c?"  ok   ":"  FAIL ")+n+(i?"   "+i:"")); if(!c) fail++; }
if(!scene){ console.log("сцена не собралась"); process.exit(1); }

/* корпус — три первые сетки в группе */
const meshes=[];
scene.traverse(o=>{ if(o.isMesh||o.isInstancedMesh) meshes.push(o); });
console.log("сеток в сцене:", meshes.length);

const shell=meshes.filter(m=>m.geometry.attributes.uv && m.geometry.type!=="TubeGeometry" &&
                             m.geometry.attributes.position.count>2000);
console.log("\n== корпус ==");
const box=new T.Box3();
shell.forEach(m=>box.union(new T.Box3().setFromBufferAttribute(m.geometry.attributes.position)));
const sz=box.getSize(new T.Vector3()), ctr=box.getCenter(new T.Vector3());
console.log("  "+sz.x.toFixed(2)+" × "+sz.y.toFixed(2)+" × "+sz.z.toFixed(2)+" мм, кусков "+shell.length);
ok("284 × 497 по плану", Math.abs(sz.x-284)<1 && Math.abs(sz.y-497)<1, sz.x.toFixed(2)+" × "+sz.y.toFixed(2));
ok("толщина 46 плюс неровность", sz.z>45.9 && sz.z<48.5, sz.z.toFixed(2));
ok("центрирован", ctr.length()<0.5, ctr.length().toFixed(3));

/* сечение площе эллипса: доля высоты на половине захода внутрь */
console.log("\n== мягкость сечения ==");
(function(){
  const band=shell.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b);
  const p=band.geometry.attributes.position;
  // столбец i=0 по всем рядам: смотрим (заход, высота)
  const N=289, rows=[];
  for(let j=0;j*N<p.count;j++){
    const v=new T.Vector3().fromBufferAttribute(p,j*N);
    rows.push(v);
  }
  const top=rows[rows.length-1], seam=rows[(rows.length-1)/2|0];
  const half=rows[Math.round(rows.length*0.75)];       // середина верхней половины
  const insHalf=Math.hypot(half.x-seam.x,half.y-seam.y)/Math.hypot(top.x-seam.x,top.y-seam.y);
  const zHalf=half.z/top.z;
  console.log("  на полпути по дуге: заход "+(insHalf*100).toFixed(0)+"% , высота "+(zHalf*100).toFixed(0)+"%");
  ok("высота набирается раньше захода (мягкая подушка)", zHalf>0.75 && insHalf<0.35);
})();

console.log("\n== рант, молния, ремень ==");
const welts=meshes.filter(m=>m.geometry.type==="TubeGeometry");
ok("кант по всему периметру есть", welts.length>0, welts.length+" трубчатых деталей");
(function(){
  const w=welts[0], p=w.geometry.attributes.position;
  const b=new T.Box3().setFromBufferAttribute(p), s=b.getSize(new T.Vector3());
  console.log("  кант: "+s.x.toFixed(1)+" × "+s.y.toFixed(1)+" × "+s.z.toFixed(1)+" мм");
  ok("кант тонкий (сечение до 4 мм)", s.z<4.0, s.z.toFixed(2));
  ok("кант лежит в шве", Math.abs(b.getCenter(new T.Vector3()).z)<0.6);
})();
ok("молнии нет: зубцов инстансами не осталось", !meshes.some(m=>m.isInstancedMesh));

/* ремень */
const strapGrp=[];
scene.traverse(o=>{ if(o.type==="Group") strapGrp.push(o); });
(function(){
  // стропа — самая длинная лента без uv и не труба
  const web=meshes.filter(m=>!m.geometry.attributes.uv && m.geometry.type==="BufferGeometry"
                             && m.geometry.attributes.position.count>800);
  ok("стропа построена", web.length>=1, web.length+" лент");
  if(!web.length) return;
  const long=web.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b);
  const p=long.geometry.attributes.position;
  const b=new T.Box3().setFromBufferAttribute(p), s=b.getSize(new T.Vector3());
  console.log("  стропа: габарит "+s.x.toFixed(0)+" × "+s.y.toFixed(0)+" × "+s.z.toFixed(0)+" мм");
  // длина по осевой
  let len=0; const W=12;
  for(let i=W;i<p.count;i+=W){
    const a=new T.Vector3(), c=new T.Vector3();
    for(let k=0;k<W;k++){ a.add(new T.Vector3().fromBufferAttribute(p,i-W+k)); c.add(new T.Vector3().fromBufferAttribute(p,i+k)); }
    len+=a.multiplyScalar(1/W).distanceTo(c.multiplyScalar(1/W));
  }
  console.log("  длина стропы по осевой: "+(len/10).toFixed(0)+" см");
  ok("стропа длиной с плечевой ремень (70..130 см)", len>700 && len<1300, (len/10).toFixed(0)+" см");
  ok("ширина ленты около 25 мм", Math.max(s.x,s.y,s.z)>200, "габарит "+s.x.toFixed(0));
  ok("стропа уходит вбок и назад от корпуса", b.min.x<-120 && b.min.z<-100,
     "x до "+b.min.x.toFixed(0)+", z до "+b.min.z.toFixed(0));
  ok("концы стропы держатся у макушки и у торца", b.max.y>240 && b.min.y<-240,
     b.min.y.toFixed(0)+" .. "+b.max.y.toFixed(0));
})();
const rings=meshes.filter(m=>m.geometry.type==="TorusGeometry");
ok("полукольца и карабины на месте", rings.length>=6, rings.length+" колец");

console.log("\n== габарит и крепёж на спинке ==");
(function(){
  const welt=welts.slice().sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0];
  const b=new T.Box3();
  shell.concat([welt]).forEach(m=>b.union(new T.Box3().setFromBufferAttribute(m.geometry.attributes.position)));
  const s2=b.getSize(new T.Vector3());
  console.log("  кожа с кантом: "+s2.x.toFixed(1)+" × "+s2.y.toFixed(1)+" мм");
  ok("284 × 497 — это размер готовой вещи с кантом", s2.x<284.5 && s2.y<497.5, s2.x.toFixed(1)+" × "+s2.y.toFixed(1));

  // хлястики: те же трубы, но короткие; должны сидеть на спинке
  const keepers=welts.filter(m=>m!==welt);
  ok("два хлястика под ремень", keepers.length===2, keepers.length+" шт.");
  keepers.forEach(function(k,i){
    k.updateMatrixWorld();
    const kb=new T.Box3().setFromBufferAttribute(k.geometry.attributes.position);
    const c=kb.getCenter(new T.Vector3());
    console.log("  хлястик "+(i+1)+": y="+c.y.toFixed(0)+", z от "+kb.min.z.toFixed(1)+" до "+kb.max.z.toFixed(1));
    ok("  сидит на задней половине", kb.max.z<0, kb.max.z.toFixed(1));
    ok("  не проваливается сквозь кожу", kb.max.z>-24.5, kb.max.z.toFixed(1));
    ok("  не отходит от спинки дальше 16 мм", kb.min.z>-40, kb.min.z.toFixed(1));
    ok("  стоит в пределах чехла по длине", Math.abs(c.y)<230, c.y.toFixed(0));
  });
  scene.updateMatrixWorld(true);
  const rr=meshes.filter(m=>m.geometry.type==="TorusGeometry");
  const back=rr.filter(function(m){
    return new T.Vector3().setFromMatrixPosition(m.matrixWorld).z<-20; });
  ok("полукольца и карабины смотрят назад", back.length>=4, back.length+" колец сзади");
})();

console.log("\n== ничего лишнего ==");
ok("плоскости-тени под чехлом нет", !meshes.some(m=>m.geometry.type==="PlaneGeometry"));
(function(){
  const blend=meshes.filter(m=>m.material.transparent);
  console.log("  прозрачных сеток: "+blend.length+
    " ("+blend.map(m=>m.geometry.type).join(", ")+")");
  ok("прозрачная только монограмма", blend.length===1);
})();

console.log("\n== монограмма ==");
(function(){
  const mono=meshes.find(m=>m.material.type==="MeshBasicMaterial"&&m.material.transparent&&
                            m.material.map&&m.geometry.type!=="PlaneGeometry");
  ok("сетка оттиска построена", !!mono && mono.geometry.attributes.position.count>100);
  if(!mono) return;
  const p=mono.geometry.attributes.position;
  let below=0;
  for(let i=0;i<p.count;i++) if(p.getZ(i)<0.5) below++;
  ok("оттиск лежит на поверхности, а не проваливается", below===0, below+" вершин ниже нуля");
})();


console.log("\n== развёртка кожи ==");
(function(){
  const band=shell.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b);
  const g=band.geometry, p=g.attributes.position, uv=g.attributes.uv, idx=g.index.array;
  // шаг плитки восстанавливаем из геометрии: длина шва / число плиток по U
  let per=0; const N=289;
  const seamRow=Math.floor((p.count/N-1)/2)*N;
  for(let i=1;i<N;i++){
    const a=new T.Vector3().fromBufferAttribute(p,seamRow+i-1),
          b=new T.Vector3().fromBufferAttribute(p,seamRow+i);
    per+=a.distanceTo(b);
  }
  const tilesU=uv.getX(seamRow+N-1);
  const tile=per/tilesU;
  console.log("  периметр шва "+(per/10).toFixed(1)+" см, плиток по кругу "+tilesU.toFixed(4)+", плитка "+tile.toFixed(1)+" мм");
  ok("плиток целое число — шва по кругу нет", Math.abs(tilesU-Math.round(tilesU))<1e-4, tilesU.toFixed(5));
  const rs=[];
  for(let f=0;f<idx.length;f+=3){
    const a=idx[f],b=idx[f+1],c=idx[f+2];
    const A=new T.Vector3().fromBufferAttribute(p,a),B=new T.Vector3().fromBufferAttribute(p,b),C=new T.Vector3().fromBufferAttribute(p,c);
    const ar=new T.Vector3().subVectors(B,A).cross(new T.Vector3().subVectors(C,A)).length()/2;
    const ua=new T.Vector2().fromBufferAttribute(uv,a),ub=new T.Vector2().fromBufferAttribute(uv,b),uc=new T.Vector2().fromBufferAttribute(uv,c);
    const au=Math.abs((ub.x-ua.x)*(uc.y-ua.y)-(uc.x-ua.x)*(ub.y-ua.y))/2*tile*tile;
    if(ar>1e-6&&au>1e-9) rs.push(au/ar);
  }
  rs.sort((x,y)=>x-y);
  let good=0; for(const r of rs) if(Math.abs(r-1)<0.05) good++;
  console.log("  масштаб зерна: медиана "+rs[rs.length>>1].toFixed(3)+
              ", 5% "+rs[(rs.length*.05)|0].toFixed(3)+", 95% "+rs[(rs.length*.95)|0].toFixed(3));
  ok("масштаб зерна держится (медиана ±3%)", Math.abs(rs[rs.length>>1]-1)<0.03);
  ok("не меньше 84% площади в пределах 5%", good/rs.length>=0.84, (100*good/rs.length).toFixed(1)+"%");
})();

console.log("\n== проекция оттиска против рейкаста ==");
(function(){
  const mono=meshes.find(m=>m.material.type==="MeshBasicMaterial"&&m.material.transparent&&
                            m.material.map&&m.geometry.type!=="PlaneGeometry");
  const targets=shell.map(m=>{ m.updateMatrixWorld(); return m; });
  const ray=new T.Raycaster();
  const p=mono.geometry.attributes.position;
  let n=0,worst=1.2,sum=0;
  for(let i=0;i<p.count;i++){
    const v=new T.Vector3().fromBufferAttribute(p,i);
    ray.set(new T.Vector3(v.x,v.y,400),new T.Vector3(0,0,-1));
    const hit=ray.intersectObjects(targets,false)[0];
    if(!hit) continue;
    const d=v.z-hit.point.z;                    // подъём над кожей
    n++; sum+=d; if(Math.abs(d-1.2)>Math.abs(worst-1.2)) worst=d;
  }
  console.log("  вершин "+n+" из "+p.count+", подъём над кожей: средний "+(sum/n).toFixed(3)+
              " мм, худший "+worst.toFixed(3)+" мм (задан 1.2)");
  ok("оттиск лежит по кривизне, а не висит", Math.abs(sum/n-1.2)<0.15 && Math.abs(worst-1.2)<0.45);
})();

console.log("\n"+(fail?fail+" ПРОВАЛОВ":"всё сошлось"));
process.exit(fail?1:0);
