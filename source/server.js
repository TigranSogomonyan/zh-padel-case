/* Статический сервер для конфигуратора. Без зависимостей.
   node server.js [порт]        по умолчанию 5310, занят — берётся следующий
*/
const http=require("http"), fs=require("fs"), path=require("path"), net=require("net");
const {execFile}=require("child_process");

const ROOT=__dirname;
const START=+(process.argv[2]||process.env.PORT||5310);
/* Приёмник заявок отдаётся с того же адреса, что и страница: гость по
   публичной ссылке шлёт заявку на /api/orders — и она уходит туда же,
   куда ходит браузер. Иначе форма стучалась бы в localhost гостя. */
const API=process.env.ZH_API||"http://127.0.0.1:8000";
const TYPES={
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",   ".json":"application/json; charset=utf-8",
  ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml",
  ".woff2":"font/woff2", ".glb":"model/gltf-binary", ".stl":"model/stl",
  ".md":"text/markdown; charset=utf-8", ".map":"application/json"
};

function proxy(req,res){
  const target=new URL(req.url,API);
  const headers=Object.assign({},req.headers,{
    host:target.host,
    "x-forwarded-for":(req.headers["x-forwarded-for"]?req.headers["x-forwarded-for"]+", ":"")+
                      (req.socket.remoteAddress||""),
    "x-forwarded-proto":"http"
  });
  const up=http.request({hostname:target.hostname,port:target.port||80,
    path:target.pathname+target.search,method:req.method,headers:headers},function(r){
    res.writeHead(r.statusCode,r.headers);
    r.pipe(res);
    log(req,r.statusCode);
  });
  up.on("error",function(e){
    res.writeHead(502,{"Content-Type":"application/json; charset=utf-8"});
    res.end(JSON.stringify({ok:false,
      message:"Приёмник заявок не отвечает ("+e.code+"). Запусти его: cd api && php artisan serve"}));
    log(req,502);
  });
  req.pipe(up);
}

const server=http.createServer(function(req,res){
  let rel;
  try{ rel=decodeURIComponent(new URL(req.url,"http://localhost").pathname); }
  catch(e){ res.writeHead(400).end("bad request"); return; }

  /* Проверять префикс нужно уже по разобранному пути: «/api%2F.env» не
     начинается с «/api/», а после разбора это ровно он. Через туннель папка
     видна всему интернету, и такая мелочь стоила бы токена бота. */
  if(rel.startsWith("/api/")){ proxy(req,res); return; }

  if(rel==="/") rel="/index.html";

  // ни скрытых файлов, ни баз, ни журналов наружу
  if(rel.split("/").some(p=>p.startsWith(".")) || /\.(env|sqlite|log|key|pem)$/i.test(rel)){
    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
    res.end("404 "+rel); log(req,404); return;
  }

  // за пределы папки не выпускаем
  const file=path.normalize(path.join(ROOT,rel));
  if(!file.startsWith(ROOT)){ res.writeHead(403).end("forbidden"); return; }

  /* Файл читается целиком, а не потоком, и длина берётся у прочитанного,
     а не у fs.stat. Причина житейская: папка проекта лежит в ~/Documents,
     который синхронизируется с облаком, и система вытесняет содержимое,
     оставляя пустышку (в ls она помечена dataless). Потоковое чтение такой
     файл не подтягивает и молча отдаёт ноль байт — наружу уходят заголовки
     без тела, а Cloudflare показывает 520. Чтение целиком материализует
     файл и заодно не даёт длине разойтись с телом. */
  /* Файл может оказаться выгруженным в облако: размер числится, а чтение
     возвращает ноль байт. Чтение целиком его не подтягивает — подтягивает
     только brctl download. Поэтому короткое чтение не отдаём наружу, а
     сначала просим систему вернуть содержимое и читаем ещё раз. */
  const readReal=function(cb,retried){
    fs.stat(file,function(e1,st){
      if(e1){ cb(e1); return; }
      fs.readFile(file,function(e2,buf){
        if(e2){ cb(e2); return; }
        if(buf.length>=st.size || retried){ cb(null,buf,st); return; }
        console.log("  "+rel+" выгружен в облако — подтягиваю");
        execFile("brctl",["download",file],{timeout:20000},function(){
          readReal(cb,true);
        });
      });
    });
  };
  readReal(function(err,buf,st){
    if(err){
      const code=(err.code==="ENOENT"||err.code==="EISDIR")?404:500;
      res.writeHead(code,{"Content-Type":"text/plain; charset=utf-8"});
      res.end(code+" "+rel+(code===500?" ("+err.code+")":""));
      log(req,code);
      return;
    }
    if(buf.length<st.size){
      res.writeHead(503,{"Content-Type":"text/plain; charset=utf-8"});
      res.end("503 "+rel+": файл выгружен в облако и не вернулся ("+buf.length+
              " из "+st.size+" байт). Выполни: npm run thaw");
      log(req,503);
      return;
    }
    res.writeHead(200,{
      "Content-Type":TYPES[path.extname(file).toLowerCase()]||"application/octet-stream",
      "Content-Length":buf.length,
      // правки видно сразу: браузер ничего не кэширует
      "Cache-Control":"no-store, must-revalidate"
    });
    res.end(buf);
    log(req,200);
  });
});
function log(req,code){
  const t=new Date().toTimeString().slice(0,8);
  console.log("  "+t+"  "+code+"  "+req.method+" "+req.url);
}

/* Порт проверяется по обоим стекам. Занять 127.0.0.1:8080, когда на ::1:8080
   уже сидит чужой сервер, вполне удаётся — и браузер уходит к нему, а не к нам. */
function busy(port){
  return Promise.all(["127.0.0.1","::1"].map(function(host){
    return new Promise(function(res){
      const c=net.connect({host:host,port:port});
      const done=function(v){ c.destroy(); res(v); };
      c.setTimeout(250);
      c.once("connect",function(){ done(true); });
      c.once("timeout",function(){ done(false); });
      c.once("error",function(){ done(false); });
    });
  })).then(function(r){ return r[0]||r[1]; });
}
function listen(port,left){
  if(left<=0){ console.error("свободного порта не нашлось"); process.exit(1); }
  busy(port).then(function(taken){
    if(taken){
      console.log("  порт "+port+" занят, беру следующий");
      listen(port+1,left-1);
      return;
    }
    start(port,left);
  });
}
function start(port,left){
  server.once("error",function(e){
    if(e.code==="EADDRINUSE"&&left>0){ listen(port+1,left-1); return; }
    console.error("не поднялся: "+e.message); process.exit(1);
  });
  server.listen(port,"127.0.0.1",function(){
    const base="http://localhost:"+port;
    console.log("ZH — конфигуратор");
    console.log("  "+base+"/            обычный режим, с автопроверкой WebGL");
    console.log("  "+base+"/?soft=1     сразу программный рендер, WebGL не трогается");
    console.log("  "+base+"/api/*        заявки, проксируются в "+API);
    console.log("  Ctrl+C — остановить\n");
  });
}
listen(START,12);
