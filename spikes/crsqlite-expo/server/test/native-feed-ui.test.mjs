// Actual Android TSX/hooks/handlers with native widgets and authenticated session
// transport controlled. Not a physical-device or accessibility-engine claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settings=(enabled=false,backend='https://feeds.example')=>new Response(JSON.stringify({version:1,enabled,backend,url:backend+'/feeds/folders/f.atom',limit:50}),{headers:{'Content-Type':'application/json'}});
const active=(serverUrl='https://feeds.example/')=>({phase:'synced',account:{username:'owner',serverUrl}});
async function harness(t,{dev=true,optIn=false,platform='android',initial={phase:'stopped'}}={}) {
  let listener; const calls=[],copies=[],nav=[];
  const req=async(id,action,signal)=>{const d=deferred(); calls.push({id,action,signal,...d});return d.promise;};
  const mock={
    react:React,
    'react-native':{Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',Platform:{OS:platform},StyleSheet:{create:x=>x}},
    'expo-router':{useLocalSearchParams:()=>({id:'f'}),useRouter:()=>({push:x=>nav.push(x)})},
    'expo-clipboard':{setStringAsync:async x=>copies.push(x)},
    '../components/Screen':{__esModule:true,default:'Screen'},
    '../theme':{Colors:{},Spacing:{},Typography:{}},
    '../db/syncClient':{requestStashFolderFeed:req,subscribeStashSyncStatus:fn=>{listener=fn;fn(initial);return()=>{listener=null;}}},
  };
  const root=path.resolve(import.meta.dirname,'../../../..');
  function load(file) {
    const module={exports:{}};
    const code=ts.transpileModule(readFileSync(root+'/'+file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,URL,AbortController,console,__DEV__:dev,process:{env:{EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS:optIn?'1':undefined}},require:spec=>{
      if(spec==='../utils/syncBuildGate')return load('src/utils/syncBuildGate.ts');
      if(spec in mock)return mock[spec];throw Error(spec);
    }});return module.exports;
  }
  const Screen=load('src/screens/FolderFeedScreen.tsx').default;
  let renderer;await act(async()=>{renderer=create(React.createElement(Screen));});
  t.after(async()=>act(()=>renderer.unmount()));
  const text=()=>JSON.stringify(renderer.toJSON());
  function button(label){const buttons=renderer.root.findAllByType('Pressable');const found=buttons.find(b=>b.findByType('Text').props.children===label);assert.ok(found,label);return found;}
  const click=async label=>{await act(async()=>{button(label).props.onPress();});};
  const status=async s=>{await act(async()=>listener?.(s));};
  const reply=async(response,n=calls.length-1)=>{await act(async()=>{calls[n].resolve(response);});};
  return {calls,copies,nav,text,button,click,status,reply};
}
for(const config of [{dev:false,optIn:false,platform:'android'},{dev:true,platform:'ios'}]) test('feed controls preserve sync build gate '+JSON.stringify(config),async t=>{
  const h=await harness(t,{...config,initial:active()});
  assert.match(h.text(),/requires? an Android|require an Android/); assert.equal(h.calls.length,0);
  assert.equal(h.button('Preview (does not enable)').props.disabled,true);
  await h.click('Settings → Sync');assert.deepEqual(h.nav,['/settings/sync']);
});
test('actual handlers: unavailable, status pending, disabled, explicit enable success, clean copy and non-WebView preview',async t=>{
  const h=await harness(t);
  assert.match(h.text(),/Unavailable/); assert.equal(h.calls.length,0);
  await h.status(active()); assert.match(h.text(),/Pending/); assert.equal(h.calls[0].action,'status');
  await h.reply(settings()); assert.match(h.text(),/Disabled/); assert.equal(h.calls.length,1,'opening never publishes');
  await h.click('Enable feed');assert.equal(h.calls[1].action,true);assert.match(h.text(),/Pending/); assert.equal(h.button('Enable feed').props.disabled,true);
  await h.reply(settings(true));assert.match(h.text(),/Enabled/);
  await h.click('Copy Atom URL');assert.deepEqual(h.copies,['https://feeds.example/feeds/folders/f.atom']);
  await h.click('Preview (does not enable)');assert.equal(h.calls[2].action,'preview');
  await h.reply(new Response('<feed>preview &lt;text&gt;</feed>',{headers:{'Content-Type':'application/atom+xml; charset=utf-8'}}));
  assert.match(h.text(),/plaintext XML/);assert.match(h.text(),/preview &lt;text&gt;/);assert.doesNotMatch(h.text(),/"type":"WebView"/);
  assert.match(h.text(),/reader caches cannot be recalled/);
});
test('backend errors/unsupported are truthful and retryable; enabling is not optimistic',async t=>{
  const h=await harness(t,{initial:active()});await h.reply(settings());
  await h.click('Enable feed');await h.reply(new Response('{}',{status:503}));
  assert.match(h.text(),/Unavailable/);assert.match(h.text(),/not configured/);assert.doesNotMatch(h.text(),/"Enabled"/);
  await h.click('Refresh / Retry');await h.reply(new Response('{}',{status:404}));assert.match(h.text(),/backend lacks feed controls/);
  await h.click('Refresh / Retry');await h.reply(new Response(JSON.stringify({version:99})));assert.match(h.text(),/incompatible/);
  await h.click('Refresh / Retry');await h.reply(settings());assert.match(h.text(),/Disabled/);
});
for(const next of [{phase:'stopped'},{phase:'syncing',account:active().account},{phase:'error',account:active().account},{...active(),disconnecting:true},{...active(),restartRequired:true},active('https://new.example/')]) test('late responses cannot publish UI after stop/recovery/offline/teardown/server switch '+JSON.stringify(next),async t=>{
  const h=await harness(t,{initial:active()});await h.reply(settings(true));
  await h.click('Disable feed');const pending=h.calls.length-1;
  await h.status(next);assert.equal(h.calls[pending].signal.aborted,true);
  await h.reply(settings(false),pending);assert.doesNotMatch(h.text(),/"Disabled"|"Enabled"/);
  if(next.account?.serverUrl==='https://new.example/') {
    assert.equal(h.calls.at(-1).action,'status');await h.reply(settings(false,'https://new.example'));assert.match(h.text(),/Disabled/);assert.doesNotMatch(h.text(),/feeds.example\/feeds/);
  }
});
test('unsafe URL is never copied, shown or sent to WebView',async t=>{
  const h=await harness(t,{initial:active()});
  await h.reply(new Response(JSON.stringify({version:1,limit:50,enabled:true,backend:'https://feeds.example',url:'https://user:password@feeds.example/feeds/folders/f.atom'})));
  assert.match(h.text(),/unsafe feed URL/);assert.doesNotMatch(h.text(),/user:password/);assert.equal(h.copies.length,0);
});
