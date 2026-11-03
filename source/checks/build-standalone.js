/* Собирает страницу в один самодостаточный файл: three.js и шрифты
   вшиваются внутрь. Нужно для площадок, где внешние запросы запрещены.
   node checks/build-standalone.js [выходной.html] */
const fs=require("fs"), path=require("path"), https=require("https");
const ROOT=path.join(__dirname,"..");
const OUT=process.argv.slice(2).find(a=>!a.startsWith("--"))||path.join(ROOT,"zh-standalone.html");

/* Ключи. Их два по существу, остальные — сочетания под конкретную площадку.
     --no-order   приёмника заявок рядом нет, отправку выключить
     --no-save    площадка не даёт странице отдавать файлы, кнопку убрать
     --static     статический хост (GitHub Pages): файлы отдаёт, API нет
     --demo       и то и другое
     --artifact   demo плюс снятая обёртка документа: на claude.ai страницу
                  кладут внутрь чужого <!doctype>/<head>/<body>            */
const KEY=n=>process.argv.includes("--"+n);
const ARTIFACT=KEY("artifact");
const NO_ORDER=KEY("no-order")||KEY("static")||KEY("demo")||ARTIFACT;
const NO_SAVE =KEY("no-save")||KEY("demo")||ARTIFACT;
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function get(url,binary){
  return new Promise(function(res,rej){
    https.get(url,{headers:{"User-Agent":UA}},function(r){
      if(r.statusCode!==200){ rej(new Error(url+" → "+r.statusCode)); return; }
      const bufs=[]; r.on("data",b=>bufs.push(b));
      r.on("end",()=>res(binary?Buffer.concat(bufs):Buffer.concat(bufs).toString("utf8")));
    }).on("error",rej);
  });
}

(async function(){
  let html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");

  /* --- шрифты: только латиница и кириллица, остальные подмножества лишние.
     Адрес берётся из самой страницы, а не переписан сюда: списки начертаний
     разошлись, и из сборки пропал курсив заголовка --- */
  const CSS=(html.match(/<link href="(https:\/\/fonts\.googleapis[^"]+)"/)||[])[1];
  let fontCss="";
  try{
    if(!CSS) throw new Error("в index.html нет ссылки на fonts.googleapis");
    const css=await get(CSS.replace(/&amp;/g,"&"),false);
    const blocks=css.split("/*").filter(b=>/^\s*(latin|cyrillic)\s*\*\//.test(b));
    let bytes=0;
    for(const b of blocks){
      const m=b.match(/url\((https:[^)]+\.woff2)\)/);
      if(!m) continue;
      const data=await get(m[1],true);
      bytes+=data.length;
      fontCss+=b.slice(b.indexOf("@font-face"))
                .replace(/url\(https:[^)]+\.woff2\)/,
                  "url(data:font/woff2;base64,"+data.toString("base64")+")")
                .replace(/\}[\s\S]*$/,"}\n");
    }
    console.log("шрифтов вшито: "+blocks.length+", "+(bytes/1024).toFixed(0)+" КБ");
  }catch(e){
    console.log("шрифты не скачались ("+e.message+") — останутся системные");
  }

  /* --- убираем внешние ссылки, вставляем шрифты внутрь --- */
  html=html.replace(/<link rel="preconnect"[^>]*>\s*/g,"")
           .replace(/<link href="https:\/\/fonts\.googleapis[^>]*>\s*/,
                    fontCss?("<style>\n"+fontCss+"</style>\n"):"");

  /* --- three.js внутрь, вместе с запасной ссылкой на cdnjs --- */
  const three=fs.readFileSync(path.join(ROOT,"vendor","three.min.js"),"utf8");
  html=html.replace(/<!-- three со своего хоста[\s\S]*?<\/script>\s*<script>\s*\nif\(typeof THREE[\s\S]*?<\/script>/,
    "<script>\n/* three.js r128, вшит целиком: внешних запросов у страницы нет */\n"+
    three.replace(/<\/script>/gi,"<\\/script>")+"\n</script>");

  /* --- карты рельефа кожи (HEIGHT_SRC) внутрь data-URL: рядом со
     страницей на витрине их нет, а без них кожа откатится на процедурную --- */
  html=html.replace(/"(textures\/[\w.-]+\.jpg)"/g,function(m,rel){
    const data=fs.readFileSync(path.join(ROOT,rel));
    console.log("вшит рельеф: "+rel+", "+(data.length/1024).toFixed(0)+" КБ");
    return '"data:image/jpeg;base64,'+data.toString("base64")+'"';
  });

  html=html.replace(/<title>[^<]*<\/title>/,"<title>ZH Padel Case</title>");

  /* --- кнопка «Save preview»: убирается там, где площадка не даёт странице
     отдавать файлы. На обычном хосте она работает и остаётся --- */
  if(NO_SAVE){
    html=html.replace('<button class="btn btn-a" id="save">Save preview</button>\n        ',"")
             .replace('<button class="btn btn-b" id="reset">Reset</button>',
                      '<button class="btn btn-b" id="reset">Reset the view</button>')
             .replace(/document\.getElementById\("save"\)\.onclick=function\(\)\{[\s\S]*?\n\};\n/,
                      "/* в этой сборке сохранение превью убрано: площадка не даёт\n"+
                      "   странице отдавать файлы, и кнопка была бы мёртвой */\n");
    console.log("сохранение превью убрано");
  }
  if(NO_ORDER){
    /* Приёмника заявок в демо нет: страница лежит одна, без server.js и без
       Laravel за ним, и «/api/orders» ушло бы в 404. Пустой адрес — не поломка:
       форма тогда прямо говорит, что отправка не подключена, и кладёт заявку
       в буфер обмена. Замену проверяем: строка в index.html уже переезжала
       с localhost:8000 на свой хост, и молча промахнувшийся replace оставил
       бы в демо форму, которая делает вид, что отправляет. */
    const wired=html;
    html=html.replace(/\|\| "(?:https?:\/\/localhost:8000)?\/api\/orders";/,'|| "";');
    if(html===wired){
      console.error("не нашёл адрес приёмника заявок в index.html — "+
                    "демо-сборка отправляла бы заявки в никуда");
      process.exit(1);
    }
    console.log("отправка заявок отключена: форма кладёт заявку в буфер обмена");
  }

  /* --- ключ artifact: страница уезжает в Artifact на claude.ai, а там её
     кладут внутрь чужого <!doctype>/<head>/<body>. Свою обёртку снимаем,
     иначе документ вложится в документ. Всё остальное — заголовок, стили,
     разметка — остаётся как есть; <body> в index.html и так подразумеваемый.
     Ключ включает и demo: на claude.ai страница одна, без приёмника заявок. --- */
  if(ARTIFACT){
    html=html.replace(/^\s*<!doctype html>\s*/i,"")
             .replace(/^\s*<html[^>]*>\s*/i,"")
             .replace(/\s*<\/html>\s*$/i,"\n");
    console.log("сборка для Artifact: обёртка документа снята");
  }

  fs.writeFileSync(OUT,html);
  console.log("собрано: "+OUT+"  "+(html.length/1024).toFixed(0)+" КБ");
  const left=html.match(/(?:src|href)="https?:\/\/[^"]+"/g);
  console.log(left?("ОСТАЛИСЬ внешние ссылки: "+left.join(", ")):"внешних ссылок не осталось");
})();
