/* Сколько стоит кадр программного рендера и какого он размера. */
process.env.SOFT="1";
const {sandbox}=require("./harness.js");
const S=sandbox.__zhSoft;
if(!S){ console.error("страница не отдала ручку __zhSoft"); process.exit(1); }
function bench(q,n,label){
  S.renderer.setQuality(q);
  S.renderer.render(S.scene,S.camera);            // прогрев и пересбор списка
  const st=S.renderer.stats();
  const t0=process.hrtime.bigint();
  for(let i=0;i<n;i++){ S.camera.position.x+=1; S.renderer.render(S.scene,S.camera); }
  const ms=Number(process.hrtime.bigint()-t0)/1e6/n;
  console.log(label.padEnd(26)+st.w+"×"+st.h+(st.ss>1?" ×"+st.ss+" выборки":"")+"  "+ms.toFixed(0)+" мс/кадр"+
              (st.fine?"   (плавные нормали, билинейно, рельеф)":"   (плоское затенение)"));
  return ms;
}
console.log("треугольников в сцене:", S.renderer.stats().tris);
bench(.52,8,"пока крутят");
bench(1,4,"чистовой, в покое");
S.renderer.setQuality(.52);
let t0=process.hrtime.bigint();
for(let i=0;i<6;i++){ S.renderer.dirty(); S.renderer.render(S.scene,S.camera); }
console.log("с пересбором сцены".padEnd(26)+"          "+
  (Number(process.hrtime.bigint()-t0)/1e6/6).toFixed(0)+" мс/кадр");
