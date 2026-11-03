/* Проверки разметки и стиля, которые не требуют браузера:
   объявлены ли все переменные, есть ли все id, к которым лезет скрипт,
   нет ли повторов id и незакрытых тегов. */
const fs=require("fs");
const html=fs.readFileSync(process.env.INDEX||require("path").join(__dirname,"..","index.html"),"utf8");
let fail=0;
/* Файл мог быть вытеснен в облако: размер числится, содержимого нет.
   Ловится тем, что прочитанное короче заявленного в fs.stat. */
(function(){
  const f=process.env.INDEX||require("path").join(__dirname,"..","index.html");
  const st=require("fs").statSync(f);
  if(html.length===0 || st.size===0){
    console.log("  FAIL файл пуст — похоже, macOS выгрузил его содержимое (dataless): "+f);
    process.exit(1);
  }
})();
const ok=(n,c,i)=>{ console.log((c?"  ok   ":"  FAIL ")+n+(i?"   "+i:"")); if(!c) fail++; };

/* стилей может быть несколько (в самодостаточной сборке первым идёт
   блок со шрифтами) — берём их все */
const css=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join("\n");
const root=(css.match(/:root\{([\s\S]*?)\}/)||[])[1]||"";
const declared=new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]));
const used=new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m=>m[1]));
const missing=[...used].filter(v=>!declared.has(v));
console.log("== стиль ==");
console.log("  переменных объявлено "+declared.size+", использовано "+used.size);
ok("нет обращений к необъявленным переменным", missing.length===0, missing.join(", "));
const unused=[...declared].filter(v=>!used.has(v));
ok("нет мёртвых переменных", unused.length===0, unused.join(", "));
ok("цвет фона у body задан явно", /body\{[^}]*background:var\(--ink\)/.test(css.replace(/\s+/g," ")));

console.log("\n== разметка ==");
const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
const dupes=ids.filter((v,i)=>ids.indexOf(v)!==i);
ok("нет повторяющихся id", dupes.length===0, dupes.join(", "));
const wanted=[...html.matchAll(/getElementById\("([^"]+)"\)/g)].map(m=>m[1]);
const created=new Set([...ids, ...[...html.matchAll(/\.id="([^"]+)"/g)].map(m=>m[1])]);
const absent=[...new Set(wanted)].filter(v=>!created.has(v));
ok("все id, к которым лезет скрипт, существуют", absent.length===0, absent.join(", "));
console.log("  id в разметке: "+ids.length+", запросов из скрипта: "+new Set(wanted).size);

/* грубая проверка парности тегов в разметке (скрипты и стили вырезаны) */
const body=html.replace(/<script[\s\S]*?<\/script>/g,"").replace(/<style>[\s\S]*?<\/style>/g,"")
               .replace(/<!--[\s\S]*?-->/g,"");
const VOID=new Set(["meta","link","br","hr","img","input","source","path","circle","use","area","col"]);
const stack=[]; let bad=null;
for(const m of body.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)){
  const close=m[1]==="/", tag=m[2].toLowerCase();
  if(VOID.has(tag)||m[3].endsWith("/")) continue;
  if(!close) stack.push(tag);
  else{ const t=stack.pop(); if(t!==tag && !bad) bad=tag+" закрыт при открытом "+t; }
}
ok("теги закрыты парно", !bad && stack.length===0, bad||stack.join(" > "));

console.log("\n== типографика ==");
const scale=[...root.matchAll(/--t-[\w-]+:\s*([\d.]+)px/g)].map(m=>+m[1]).sort((a,b)=>a-b);
console.log("  шкала кегля: "+scale.join(", ")+" px");
ok("шкала задана и без дублей", scale.length>=4 && new Set(scale).size===scale.length);
ok("числа в таблицах выровнены по разрядам", /tabular-nums/.test(css));
ok("длинные строки не растягиваются", /max-width:\s*\d+ch/.test(css));

console.log("\n"+(fail?fail+" ПРОВАЛОВ":"всё сошлось"));
process.exit(fail?1:0);
