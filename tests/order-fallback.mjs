import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('source/index.html',root));
let reply={status:502,body:{ok:false}};
let posts=0;
const server=createServer(async(req,res)=>{
 if(req.url==='/api/orders'){posts++;res.writeHead(reply.status,{'Content-Type':'application/json'});res.end(JSON.stringify(reply.body));return;}
 if(req.url.startsWith('/vendor/') || req.url.startsWith('/textures/')){
   res.end(await readFile(new URL('source'+req.url,root)));return;
 }
 res.setHeader('Content-Type','text/html');res.end(html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const results=[];
try{
 for(const scenario of ['offline','unconfirmed','confirmed','blocked-clipboard']){
  reply=scenario==='confirmed'?{status:201,body:{ok:true,ref:'ZH-TEST'}}:scenario==='unconfirmed'?{status:200,body:{}}:{status:502,body:{ok:false}};
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(scenario==='blocked-clipboard') await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('blocked'))}}));
  await page.goto(origin);await page.locator('.sw').first().waitFor();
  await page.locator('#ordName').fill('Test');await page.locator('#ordMail').fill('test@example.com');
  await page.locator('#ordSend').click();
  await page.waitForFunction(()=>!document.getElementById('ordSend').disabled);
  if(scenario==='confirmed'){
   assert.match(await page.locator('#ordStatus').innerText(),/^Sent\./);
   assert.equal(await page.locator('#ordName').inputValue(),'');
  }else{
   assert.equal(await page.locator('#ordSend').innerText(),'COPY CONFIGURATION');
   assert.match(await page.locator('#ordStatus').innerText(),/No confirmation was received/);
   assert.equal(await page.locator('#ordName').inputValue(),'Test');
   const beforePosts=posts;await page.locator('#ordSend').click();
   await page.waitForFunction(()=>!document.getElementById('ordStatus').textContent.startsWith('No confirmation'));
   assert.equal(posts,beforePosts);
   const status=await page.locator('#ordStatus').innerText();
   assert.match(status,scenario==='blocked-clipboard'?/blocked copying/:/Configuration copied/);
   if(scenario!=='blocked-clipboard') assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/product: ZH/);
   await page.screenshot({path:new URL('artifacts/order-'+scenario+'.png',root).pathname,fullPage:true});
  }
  assert.deepEqual(errors,[]);results.push({scenario,passed:true});await context.close();
 }
 await writeFile(new URL('artifacts/order-report.json',root),JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close();await new Promise(r=>server.close(r));}
