import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { launch, waitFor } from './web-helpers.mjs';

test('real disposable Caddy Basic boundary and actual feedparser fetcher, no credential URLs', {timeout:30000}, async t=>{
  const h=await launch(t,{FEED_BASE_URL:'https://feeds.example'});
  const {id:f}=await h.json('/folders','POST',{name:'Private feed'});
  const {id:i}=await h.json('/items','POST',{type:'text',content:'Synthetic Basic parser note'});
  await h.json(`/items/${i}/folders/${f}`,'PUT',{present:true});
  const listener=createServer().listen(0,'127.0.0.1'); await once(listener,'listening');
  const port=listener.address().port; await new Promise(r=>listener.close(r));
  const caddy=process.env.CADDY_BIN || 'caddy';
  const password='synthetic-feed-reader-only';
  const hash=spawnSync(caddy,['hash-password','--plaintext',password],{encoding:'utf8'});
  assert.equal(hash.status,0,hash.stderr || hash.error?.message);
  const file=h.tmp+'/Caddyfile';
  await writeFile(file,`{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:${port} {\n bind 127.0.0.1\n basic_auth {\n reader ${hash.stdout.trim()}\n }\n reverse_proxy 127.0.0.1:${h.port} {\n header_up X-Auth-User web-test-owner\n }\n}\n`);
  const proxy=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env:{...process.env,HOME:h.tmp,XDG_DATA_HOME:h.tmp+'/caddy-data',XDG_CONFIG_HOME:h.tmp+'/caddy-config'},stdio:['ignore','pipe','pipe']});
  let logs='';proxy.stderr.on('data',v=>logs+=v);proxy.stdout.on('data',v=>logs+=v);
  const stop=async()=>{if(proxy.exitCode===null && proxy.signalCode===null){const exit=once(proxy,'exit');proxy.kill('SIGTERM');await exit;}};
  t.after(stop);
  const url=`http://127.0.0.1:${port}/feeds/folders/${f}.atom`;
  await waitFor(async()=>{if(proxy.exitCode!==null)throw Error(logs);try{return (await fetch(url)).status===401;}catch{return false;}});
  for(const suffix of [`${f}.atom`,'missing.atom']) {
    for(const auth of [undefined,'Basic '+Buffer.from('reader:wrong').toString('base64')]) {
      const response=await fetch(`http://127.0.0.1:${port}/feeds/folders/${suffix}`,{headers:{...(auth?{Authorization:auth}:{}),'X-Auth-User':'web-test-owner','If-None-Match':'*'}});
      assert.equal(response.status,401);
    }
  }
  const credentials=Buffer.from('reader:'+password).toString('base64');
  const response=await fetch(url,{headers:{Authorization:'Basic '+credentials,'X-Auth-User':'spoofed'}});
  assert.equal(response.status,200,'Caddy overwrites incoming identity');
  const reader=spawnSync('python3',['-c',`import urllib.request, feedparser, sys, json
request=urllib.request.Request(sys.argv[1],headers={'Authorization':'Basic '+sys.argv[2]})
with urllib.request.urlopen(request, timeout=5) as response:
 feed=feedparser.parse(response.read())
assert not feed.bozo, str(feed.get('bozo_exception'))
assert feed.version == 'atom10', feed.version
assert len(feed.entries) == 1
assert feed.entries[0].content[0].type == 'text/plain'
assert feed.entries[0].content[0].value == 'Synthetic Basic parser note'
print(json.dumps({'version':feed.version,'entries':len(feed.entries)}))`,url,credentials],{encoding:'utf8',timeout:10000});
  assert.equal(reader.status,0,reader.stderr||reader.error?.message);
  assert.equal(JSON.parse(reader.stdout).version,'atom10');
  assert.equal((await h.api(`/folders/${f}/feed`,'PUT',{enabled:false})).status,409);
  assert.equal((await fetch(url,{headers:{Authorization:'Basic '+credentials,'If-None-Match':response.headers.get('etag')}})).status,304);
  await h.json(`/folders/${f}`,'PATCH',{archived:true});
  assert.equal((await fetch(url,{headers:{Authorization:'Basic '+credentials,'If-None-Match':response.headers.get('etag')}})).status,404);
  await stop();
});
