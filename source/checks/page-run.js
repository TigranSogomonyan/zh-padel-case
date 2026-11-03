/* Прогон страницы вхолостую: настоящий three, заглушки DOM, канвы и рендерера.
   Заглушки живут в harness.js, он же исполняет скрипты страницы.
   NOGL=1 — прогон без WebGL, страница должна рисовать сама. */
const H=require("./harness.js");
const {REG,THREE,mkEl}=H;
const NOGL=!!process.env.NOGL;
const GLBLANK=!!process.env.GLBLANK;

/* ---------- дёргаем интерфейс ---------- */
function check(name,fn){
  try{ fn(); console.log("  ok   "+name); }
  catch(e){ console.log("  FAIL "+name+": "+e.message); if(process.env.TRACE) console.log(e.stack.split("\n").slice(0,4).join("\n")); process.exitCode=1; }
}
console.log("\n== интерфейс =="+(NOGL?" (программный растеризатор)":""));
check("превью собралось",()=>{ if(!/Leather/.test(REG.summary.innerHTML)) throw new Error("сцена не дошла до сводки"); });
check("сводка заказа заполнена",()=>{ if(!/Leather/.test(REG.summary.innerHTML)) throw new Error("пусто"); });
check("выбор кожи",()=>{ REG.swatches.children[3].onclick(); });
check("сводка следит за кожей",()=>{ if(!/Orange/.test(REG.summary.innerHTML)) throw new Error(REG.summary.innerHTML.slice(0,120)); });
check("смена шрифта",()=>{ REG.face.fire("click",{target:Object.assign(mkEl(null,"button"),{dataset:{v:"grot"}})}); });
check("ремень снимается",()=>{ REG.strap.fire("click",{target:Object.assign(mkEl(null,"button"),{dataset:{v:"off"}})}); });
check("инициалы",()=>{ REG.inits.value="ЖЯ!x"; REG.inits.fire("input"); if(REG.inits.value!=="ЖЯX") throw new Error(REG.inits.value); });
check("размер оттиска",()=>{ REG.size.value="55"; REG.size.fire("input"); });
check("положение оттиска",()=>{ REG.posX.value="-90"; REG.posX.fire("input",{target:REG.posX});
                                REG.posY.value="-180"; REG.posY.fire("input",{target:REG.posY}); });
check("оттиск не уехал за край",()=>{ if(!/across/.test(REG.summary.innerHTML)) throw new Error("нет размещения"); });
console.log("     "+REG.posVal.textContent+"  (ползунки: "+REG.posX.value+" / "+REG.posY.value+")");
check("виды камеры",()=>{ REG.views.fire("click",{target:Object.assign(mkEl(null,"button"),{dataset:{view:"edge"}})}); });
check("сброс",()=>{ REG.reset.onclick(); });
check("сохранение превью",()=>{
  if(typeof REG.save.onclick!=="function"){ console.log("     (в этой сборке кнопки нет)"); return; }
  REG.save.onclick();
});

console.log("\n== без просьб к видеокарте ==");
if(process.env.SOFT){        // страница открыта без ?gl=1, но WebGL в системе есть
  check("страница по умолчанию не создаёт контекст WebGL",()=>{
    if(H.glMade) throw new Error("WebGLRenderer всё-таки создан");
  });
  check("кадр всё равно нарисован",()=>{
    const cv=(REG.stage.children||[]).filter(c=>c&&c.nodeName==="CANVAS").pop();
    if(!cv||!cv._frame) throw new Error("кадра нет");
    console.log("     кадр "+cv._frame.width+"×"+cv._frame.height);
  });
}

console.log("\n== форма заказа ==");
check("пустая форма ругается",()=>{
  REG.ordName.value=""; REG.ordMail.value="";
  REG.orderForm.fire("submit");
  if(!/name and a working email/.test(REG.ordStatus.textContent)) throw new Error(REG.ordStatus.textContent);
});
check("кривая почта ругается",()=>{
  REG.ordName.value="Тигран"; REG.ordMail.value="почта-без-собаки";
  REG.orderForm.fire("submit");
  if(REG.ordStatus.className.indexOf("err")<0) throw new Error("проглотила");
});
check("годная заявка не падает без отправки",()=>{
  REG.ordMail.value="a@b.co"; REG.ordNote.value="без ремня";
  REG.orderForm.fire("submit");
});
check("копирование спецификации",()=>{ REG.ordCopy.onclick(); });

if(NOGL){
  console.log("\n== без WebGL ==");
  check("страница не упала",()=>{ if(process.exitCode) throw new Error("были падения"); });
  check("извинений нет — рисуем сами",()=>{
    if(/3D preview unavailable/.test(REG.stage.innerHTML)) throw new Error("показана заглушка вместо картинки");
  });
  check("канва создана и кадр нарисован",()=>{
    const cv=(REG.stage.children||[]).find(c=>c&&c.nodeName==="CANVAS");
    if(!cv) throw new Error("канвы нет");
    if(!cv._frame) throw new Error("putImageData не вызывался");
  });
  check("сцена показана",()=>{
    if(!REG.stage.classList.contains("ready")) throw new Error("stage не помечен ready");
  });
}
if(GLBLANK){
  console.log("\n== WebGL есть, а кадра нет ==");
  check("страница заметила пустой кадр и перешла на свой рендер",()=>{
    if(!/Drawn in software/.test(REG.hint.innerHTML)) throw new Error("подписи о программном рендере нет: "+REG.hint.innerHTML.slice(0,60));
  });
  check("канва растеризатора создана и кадр нарисован",()=>{
    const cv=(REG.stage.children||[]).filter(c=>c&&c.nodeName==="CANVAS").pop();
    if(!cv) throw new Error("канвы нет");
    if(!cv._frame) throw new Error("кадр не нарисован");
    console.log("     кадр "+cv._frame.width+"×"+cv._frame.height);
  });
  check("кнопка ручного переключения убрана",()=>{
    const v=REG.views.children.filter(c=>c&&c.id==="softBtn");
    if(v.length) throw new Error("кнопка осталась");
  });
}
console.log(process.exitCode?"\nЕСТЬ ПРОВАЛЫ":"\nвсё сошлось");
