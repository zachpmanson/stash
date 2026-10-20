import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { launch, waitFor } from './web-helpers.mjs';
// Opt-in disposable browser test: no real credentials, live service or network.
// STASH_TEST_SERVER_ENTRY optionally selects the exact built service package.
const req=createRequire(new URL('../package.json', import.meta.url));
const {encode,decode,tags}=await import(req.resolve('@vlcn.io/ws-common'));
const caddyBin=process.env.CADDY_BIN;
const chromeBin=process.env.CHROMIUM_BIN;
assert.ok(caddyBin && chromeBin, 'Set CADDY_BIN and CHROMIUM_BIN to installed binaries');
const cleanup=[]; let caddy,chrome,attacker;
async function freePort(){ const s=createServer().listen(0,'127.0.0.1');await once(s,'listening'); const p=s.address().port;await new Promise(r=>s.close(r));return p; }
try {
 const {base,json,port}=await launch({after:fn=>cleanup.push(fn)});
 const created=await json('/items','POST',{type:'text',content:'security-synthetic-only'});
 const health=await (await fetch(base+'/healthz')).json();
 const dir=await mkdtemp('/tmp/stash-security-browser-');cleanup.push(()=>rm(dir,{recursive:true,force:true}));
 const proxyPort=await freePort();const password='synthetic-review-only';
 const hash=spawnSync(caddyBin,['hash-password','--plaintext',password],{encoding:'utf8'});assert.equal(hash.status,0,hash.stderr);
 const config=`{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:${proxyPort} {\n bind 127.0.0.1\n log {\n output stdout\n format json\n }\n basic_auth {\n review ${hash.stdout.trim()}\n }\n reverse_proxy 127.0.0.1:${port} {\n header_up X-Auth-User web-test-owner\n }\n}\n`;
 await writeFile(dir+'/Caddyfile',config);
 caddy=spawn(caddyBin,['run','--config',dir+'/Caddyfile','--adapter','caddyfile'],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'},stdio:['ignore','pipe','pipe']});let caddyLogs='';caddy.stderr.on('data',x=>caddyLogs+=x);caddy.stdout.on('data',x=>caddyLogs+=x);
 cleanup.push(async()=>{if(caddy.exitCode===null){caddy.kill('SIGTERM');await once(caddy,'exit');}});
 await waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${proxyPort}/`)).status===401;}catch{return false;}});
 attacker=createServer((_req,res)=>res.end('<html><title>Synthetic attacker</title></html>')).listen(0,'127.0.0.1');await once(attacker,'listening');const attackerPort=attacker.address().port;cleanup.push(()=>new Promise(r=>attacker.close(r)));
 chrome=spawn(chromeBin,['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-pipe',`--user-data-dir=${dir}/profile`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--metrics-recording-only','--safebrowsing-disable-auto-update','--disable-default-apps','--disable-quic','--disable-features=OptimizationHints,MediaRouter,CertificateTransparencyComponentUpdater','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost;[::1]','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 let chromeLogs='';chrome.stderr.on('data',x=>chromeLogs+=x);cleanup.push(async()=>{if(chrome.exitCode===null){chrome.kill('SIGTERM');await once(chrome,'exit');}});
 let next=0,buf='',pending=new Map();chrome.stdio[4].on('data',chunk=>{buf+=chunk;for(;;){let pos=buf.indexOf('\0');if(pos<0)break;let frame=buf.slice(0,pos);buf=buf.slice(pos+1);if(!frame)continue;const msg=JSON.parse(frame);if(msg.id&&pending.has(msg.id)){const [resolve,reject,timer]=pending.get(msg.id);pending.delete(msg.id);clearTimeout(timer);msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result);}}});
 function cdp(method,params={},sessionId){return new Promise((resolve,reject)=>{let id=++next;let timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method+' '+chromeLogs));},5000);pending.set(id,[resolve,reject,timer]);chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
 await cdp('Page.enable',{},sessionId);
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 console.log('LOGIN_NAV '+JSON.stringify(await cdp('Page.navigate',{url:`http://review:${password}@127.0.0.1:${proxyPort}/`},sessionId)));
 await waitFor(async()=>await evaluate(`location.port==='${proxyPort}' && document.readyState==='complete'`));
 console.log('LOGIN_DOC '+JSON.stringify(await evaluate('({href:location.href,text:document.body.innerText.slice(0,200)})')));
 await cdp('Page.navigate',{url:`http://127.0.0.1:${proxyPort}/`},sessionId);
 await waitFor(async()=>await evaluate(`location.port==='${proxyPort}' && document.readyState==='complete'`));
 const same=await evaluate(`fetch('http://127.0.0.1:${proxyPort}/api/items/${created.id}').then(async r=>({status:r.status,body:await r.text()}))`);assert.equal(same.status,200,JSON.stringify(same));console.log('PASS real Chromium + real Caddy synthetic Basic login and authenticated API GET');
 // Exercise the actual static React bundle and browser FormData, not only mocked components.
 await waitFor(async()=>await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='New item')`));
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='New item').click()`);
 await waitFor(async()=>await evaluate(`!!document.querySelector('textarea[name=content]')`));
 await evaluate(`(()=>{const form=document.querySelector('textarea[name=content]').form;form.elements.title.value='Browser made';form.elements.content.value='Original browser body';form.requestSubmit()})()`);
 await waitFor(async()=>await evaluate(`document.querySelector('.reader h2')?.textContent==='Browser made'`));
 const browserItem=await evaluate(`fetch('/api/items').then(r=>r.json()).then(p=>p.items.find(i=>i.title==='Browser made'))`);
 assert.ok(browserItem?.id);
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Edit item').click()`);
 await json(`/items/${browserItem.id}`,'PATCH',{content:'Concurrent synthetic phone content'});
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh').click()`);
 await waitFor(async()=>await evaluate(`!document.querySelector('[role=status]').textContent.includes('Loading')`));
 assert.equal(await evaluate(`document.querySelector('textarea[name=content]').value`),'Original browser body');
 await evaluate(`(()=>{const form=document.querySelector('textarea[name=content]').form;form.elements.title.value='Browser renamed';form.requestSubmit()})()`);
 await waitFor(async()=>await evaluate(`document.querySelector('.reader h2')?.textContent==='Browser renamed'`));
 const saved=await json(`/items/${browserItem.id}`);
 assert.equal(saved.content,'Concurrent synthetic phone content');
 console.log('PASS real static React create/edit; untouched concurrent field survives refresh and browser FormData submission');
 const protocol=Buffer.from('room=stash-backend').toString('base64').replace(/=+$/,'');
 const announced=Buffer.from(encode({_tag:tags.AnnouncePresence,sender:new Uint8Array(16).fill(42),lastSeens:[],schemaName:health.schema,schemaVersion:BigInt(health.schemaVersion)})).toString('base64');
 const wsExpr=`new Promise(resolve=>{const w=new WebSocket('ws://127.0.0.1:${proxyPort}/sync','${protocol}');w.binaryType='arraybuffer';const frames=[];let opened=false;const timer=setTimeout(()=>{w.close();resolve({opened,frames,timeout:true})},1500);w.onopen=()=>{opened=true;w.send(Uint8Array.from(atob('${announced}'),x=>x.charCodeAt(0)))};w.onmessage=e=>{frames.push(Array.from(new Uint8Array(e.data)));if(frames.length>=2){clearTimeout(timer);w.close();resolve({opened,frames})}};w.onerror=()=>{clearTimeout(timer);resolve({opened,frames,error:true})}})`;
 const sameWs=await evaluate(wsExpr);assert.equal(sameWs.opened,true,JSON.stringify(sameWs));assert.ok(sameWs.frames.map(f=>decode(Uint8Array.from(f))).some(m=>m._tag===tags.Changes&&m.changes.some(c=>c[3]==='security-synthetic-only')));console.log('PASS same-origin browser WebSocket uses cached Basic auth and replicates');
 await cdp('Page.navigate',{url:`http://localhost:${attackerPort}/`},sessionId);
 await waitFor(async()=>await evaluate(`location.port==='${attackerPort}' && document.readyState==='complete'`));
 const evil=await evaluate(wsExpr);console.log('CROSS_SITE_RESULT '+JSON.stringify({opened:evil.opened,frameCount:evil.frames.length,error:evil.error??false}));
 await delay(200);
 const access=caddyLogs.split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}}).filter(entry=>entry.request?.uri==='/sync');
 console.log('CADDY_WS_HANDSHAKES '+JSON.stringify(access.map(entry=>({status:entry.status,origin:entry.request.headers.Origin,fetchSite:entry.request.headers['Sec-Fetch-Site']}))));
 assert.equal(evil.opened,false,'Cross-site browser WebSocket must not authenticate with cached Basic credentials');
 assert.equal(evil.frames.length,0,'No replicated data may reach attacker origin');
 assert.ok(access.some(entry=>entry.status===101));
 assert.ok(access.some(entry=>entry.status===401));
 console.log('PASS cross-site browser WebSocket rejected; no private synthetic frames disclosed');
} finally {for(const fn of cleanup.reverse())await fn();}
