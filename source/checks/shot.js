/* Снимок страницы настоящим браузером — чтобы видеть свою работу, а не
   сдавать вслепую. Умеет ровно одно: снять локальный адрес в PNG.

   node checks/shot.js [путь] [файл.png] [ширина] [высота] [секунды]

   Chrome снимает по готовности страницы, а у конфигуратора бесконечный
   цикл кадров — «готово» не наступает никогда. Поэтому ждём появления
   файла и закрываем браузер сами.
*/
const {spawn} = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const PORT = process.env.PORT || 5310;
const target = process.argv[2] || "/";
const out = path.resolve(process.argv[3] || "/tmp/zh-shot.png");
const W = +(process.argv[4] || 1440), H = +(process.argv[5] || 1600);
const WAIT = +(process.argv[6] || 25);

const url = new URL(target, "http://localhost:" + PORT);
/* просим страницу показать готовый кадр сразу: без этого браузер снимает
   середину проявления, а бесконечный цикл кадров не даёт ему остановиться */
if (!/[?&]shot\b/.test(url.search)) url.searchParams.set("shot", "1");
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  console.error("снимаются только локальные адреса, а не " + url.hostname);
  process.exit(1);
}
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium"].find(p => fs.existsSync(p));
if (!CHROME) { console.error("Chrome не найден"); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zh-shot-"));
try { fs.unlinkSync(out); } catch (e) {}

const ch = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--user-data-dir=" + profile,
  "--window-size=" + W + "," + H,
  "--force-device-scale-factor=2",
  /* без виртуального времени: оно не тикает, пока страница считает кожу,
     и снимок делается до того, как чехол вообще появится */
  "--screenshot=" + out,
  url.href
], {stdio: ["ignore", "ignore", "ignore"], detached: false});

const t0 = Date.now();
let done = false;
const finish = (okMsg, code) => {
  if (done) return; done = true;
  try { ch.kill("SIGKILL"); } catch (e) {}
  try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {}
  console.log(okMsg);
  process.exit(code);
};

/* Файл появляется до того, как Chrome сообразит закрыться; ждём, пока
   его размер перестанет расти, — значит снимок дописан. */
let last = -1, stable = 0;
const tick = setInterval(() => {
  let size = -1;
  try { size = fs.statSync(out).size; } catch (e) {}
  if (size > 0) {
    stable = (size === last) ? stable + 1 : 0;
    last = size;
    if (stable >= 2) {
      clearInterval(tick);
      finish("снято: " + url.href + " → " + out + "  " +
             (size / 1024).toFixed(0) + " КБ  " + W + "×" + H +
             " (×2)  за " + ((Date.now() - t0) / 1000).toFixed(1) + " с", 0);
    }
  }
  if ((Date.now() - t0) / 1000 > WAIT) {
    clearInterval(tick);
    finish("снимок не получился за " + WAIT + " с", 1);
  }
}, 400);
