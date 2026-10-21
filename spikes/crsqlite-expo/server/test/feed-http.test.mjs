import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';
import { extensionPath } from '@vlcn.io/crsqlite';
import { launch } from './web-helpers.mjs';
const config={FEED_BASE_URL:'https://feeds.example'};
async function populate(h) {
  const {id:f}=await h.json('/folders','POST',{name:'Synthetic feed'});
  const {id:i}=await h.json('/items','POST',{type:'text',content:'Synthetic note & <xml>'});
  await h.json(`/items/${i}/folders/${f}`,'PUT',{present:true});
  return {f,i,route:`/folders/${f}/feed`,url:`${h.base}/feeds/folders/${f}.atom`};
}
test('HTTP management/auth/cache/HEAD/preview, strict validation and lifecycle', async t=>{
  const h=await launch(t,config), {f,i,route,url}=await populate(h);
  const fetchFeed=(extra={},method='GET')=>fetch(url,{method,headers:{'X-Auth-User':'web-test-owner',...extra}});
  assert.equal((await h.json(route)).enabled,false);
  assert.equal((await fetchFeed()).status,404);
  assert.equal((await h.api(route+'/preview')).status,200);
  assert.equal((await h.json(route)).enabled,false);
  for(const target of [url,h.base+'/feeds/folders/missing.atom',h.base+'/feeds/unknown',h.base+'/api/folders/missing/feed',h.base+'/api/folders/missing/feed/preview']) {
    for(const identity of [null,'attacker']) {
      const r=await fetch(target,{headers:{...(identity?{'X-Auth-User':identity}:{}),'If-None-Match':'*'}});
      assert.equal(r.status,401);
    }
  }
  for(const data of [{enabled:1},{enabled:'true'},{enabled:true,token:'x'},{},[],null]) assert.equal((await h.api(route,'PUT',data)).status,400);
  assert.equal((await h.api(route,'PUT',{enabled:true},{'X-Stash-Request':''})).status,403);
  assert.equal((await h.api(route,'PUT',{enabled:true},{Origin:'https://evil.example'})).status,403);
  assert.equal((await h.api(route+'?limit=99','PUT',{enabled:true})).status,400);
  assert.equal((await h.api(route,'PUT',{enabled:true,padding:'x'.repeat(70000)})).status,413);
  const setting=await h.json(route,'PUT',{enabled:true});
  assert.equal(setting.url,`https://feeds.example/feeds/folders/${f}.atom`);
  const response=await fetchFeed(), xml=await response.text();
  assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'application/atom+xml; charset=utf-8');
  assert.equal(response.headers.get('cache-control'),'private, no-cache'); assert.equal(response.headers.get('vary'),'Authorization');
  const etag=response.headers.get('etag'); assert.ok(etag); assert.ok(response.headers.get('last-modified'));
  assert.equal((await fetchFeed({'If-None-Match':etag})).status,304);
  assert.equal((await fetchFeed({'If-None-Match':`W/${etag}`})).status,304);
  const head=await fetchFeed({},'HEAD'); assert.equal(head.status,200); assert.equal(await head.text(),''); assert.equal(head.headers.get('etag'),etag);
  await h.json(`/folders/${f}`,'PATCH',{name:'Renamed'});
  assert.notEqual((await fetchFeed({'If-None-Match':etag})).status,304);
  await h.json(`/items/${i}`,'PATCH',{content:'Updated note'});
  assert.match(await (await fetchFeed()).text(),/Updated note/);
  await h.json(route,'PUT',{enabled:false}); assert.equal((await fetchFeed({'If-None-Match':etag})).status,404);
  await h.json(route,'PUT',{enabled:true}); assert.equal((await h.json(route)).url,setting.url);
  await h.json(`/folders/${f}`,'PATCH',{archived:true}); assert.equal((await fetchFeed({'If-None-Match':'*'})).status,404);
  assert.equal((await h.api(route,'PUT',{enabled:true})).status,404);
  await h.json(`/folders/${f}`,'PATCH',{archived:false}); assert.equal((await h.json(route)).enabled,false);
  assert.doesNotMatch(xml,/Authorization|Basic |password/);
});
test('unconfigured backend returns unavailable, not optimistic publish', async t=>{
  const h=await launch(t,{FEED_BASE_URL:''}), {route,url}=await populate(h);
  assert.equal((await h.api(route)).status,503); assert.equal((await h.api(route,'PUT',{enabled:true})).status,503);
  assert.equal((await fetch(url)).status,401);
});
test('restart retains IDs/times/settings; private backup preserves metadata and recovery disables enablement', async t=>{
  const h=await launch(t,config), {route,url,f}=await populate(h);
  await h.json(route,'PUT',{enabled:true});
  const before=await (await fetch(url,{headers:{'X-Auth-User':'web-test-owner'}})).text();
  const exit=once(h.child,'exit'); h.child.kill('SIGTERM'); assert.equal((await exit)[0],0);
  const restarted=await launch(t,{...config,DATA_DIR:h.tmp,SCHEMA_DIR:path.join(h.tmp,'schemas')});
  assert.equal((await restarted.json(route)).enabled,true);
  assert.equal(await (await fetch(`${restarted.base}/feeds/folders/${f}.atom`,{headers:{'X-Auth-User':'web-test-owner'}})).text(),before);
  const stop=once(restarted.child,'exit'); restarted.child.kill('SIGTERM'); await stop;
  const source=process.env.STASH_TEST_SERVER_ENTRY;
  const script=source?path.resolve(path.dirname(source),'../../scripts/db-admin.mjs'):path.resolve('scripts/db-admin.mjs');
  const backup=path.join(restarted.tmp,'snapshot.sqlite');
  const admin=(command,arg)=>{
    const result=spawnSync(process.execPath,[script,command,arg],{encoding:'utf8',env:{...process.env,DATA_DIR:h.tmp,SCHEMA_DIR:path.join(h.tmp,'schemas')}});
    assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout);
  };
  admin('backup',backup);
  const snapshot=new Database(backup,{readonly:true});
  const settings=snapshot.prepare('SELECT * FROM folder_feeds').all(), entries=snapshot.prepare('SELECT * FROM feed_entries').all();
  assert.equal(settings[0].enabled,1); assert.equal(entries.length,1); snapshot.close();
  admin('restore',backup);
  const restored=new Database(path.join(h.tmp,'stash-backend')); restored.loadExtension(extensionPath);
  assert.deepEqual(restored.prepare('SELECT * FROM feed_entries').all(),entries);
  assert.deepEqual(restored.prepare('SELECT * FROM folder_feeds').all(),settings.map(s=>({...s,enabled:0})));
  restored.prepare('SELECT crsql_finalize()').get(); restored.close();
  const recovered=await launch(t,{...config,DATA_DIR:h.tmp,SCHEMA_DIR:path.join(h.tmp,'schemas')});
  assert.equal((await recovered.json(route)).enabled,false);
  await recovered.json(route,'PUT',{enabled:true});
  assert.equal(await (await fetch(`${recovered.base}/feeds/folders/${f}.atom`,{headers:{'X-Auth-User':'web-test-owner'}})).text(),before);
});
