// Actual secure-store, saved-session and bootstrap adapters; native keychain/network are synthetic.
// Run: nix develop --command node --test scripts/test-saved-sync-login.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const login = {version:1,serverUrl:'https://sync.example/base/',username:'alice',password:'synthetic-secret'};
const identity = ({serverUrl,username}) => ({serverUrl,username});
test('Android autolinking builds patched SecureStore from source instead of a prebuilt artifact', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.deepEqual(manifest.expo?.autolinking?.android?.buildFromSource, ['expo-secure-store']);
});
function harness({ allowed = true, disk = new Map() } = {}) {
  const cache = new Map(), calls = [], options = {}, listeners = new Set();
  let status = {phase:'stopped'}, saved;
  const publish = next => { status=next; for (const fn of listeners) fn(next); };
  const secure = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'this-device-only',
    async getItemAsync(key, opts) { calls.push(['read',key,opts]); if(options.readGate) await options.readGate.promise; if(options.readError) throw Error(login.password); return disk.get(key) ?? null; },
    async setItemAsync(key, value, opts) { calls.push(['write',key,opts]); if(options.writeGate) await options.writeGate.promise; disk.set(key,value); if(options.writeError) throw Error(login.password); },
    async deleteItemAsync(key, opts) { calls.push(['remove',key,opts]); if(options.removeError) throw Error(login.password); disk.delete(key); },
  };
  const client = {
    subscribeStashSyncStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); },
    async connectStashSync(serverUrl, credentials) {
      calls.push(['connect',serverUrl,credentials.username]); publish({phase:'connecting'});
      if(options.connect) return options.connect(serverUrl,credentials);
      if(options.connectError) throw Error('Offline');
      publish({phase:'syncing',account:{serverUrl,username:credentials.username}});
    },
    async disconnectStashSyncAndWait() {
      calls.push(['disconnect']); publish({phase:'stopped'});
      if(options.drainGate) await options.drainGate.promise;
      if(options.drainError) throw Error('native shutdown');
    },
  };
  const mocks = {
    'expo-secure-store': secure,
    'src/db/syncClient.ts': client,
    'src/utils/syncBuildGate.ts': {STASH_SYNC_DEV_TOOLS:allowed},
  };
  function load(file, extra='') {
    if(file in mocks) return mocks[file];
    if(cache.has(file)) return cache.get(file).exports;
    const module={exports:{}}; cache.set(file,module);
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8')+extra,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,URL,console,require:spec=>{
      if(spec in mocks) return mocks[spec];
      if(spec.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),spec))+'.ts');
      throw Error(`Unexpected import ${spec}`);
    }},{filename:file});
    return module.exports;
  }
  const api=load('src/db/syncLogin.ts'); api.subscribeSavedStashLogin(next => {saved=next;});
  return { api, disk, calls, options, publish, load, mocks, saved:()=>saved, status:()=>status,
    seed(value=login) {disk.set('stash.sync.login.v1',JSON.stringify(value));},
    count(name) {return calls.filter(call=>call[0]===name).length;},
    assertPublic() {assert.doesNotMatch(JSON.stringify(saved),/synthetic-secret|password|Authorization|Basic/);},
  };
}

test('verified login alone is normalized and saved; fresh process restores once, without a Settings mount',async()=>{
  const h=harness();
  await h.api.signInStashSync(' HTTPS://SYNC.EXAMPLE/base///?discard=1#ignored ',' alice ',login.password);
  assert.equal(h.count('write'),1); assert.deepEqual(JSON.parse([...h.disk.values()][0]),login); h.assertPublic();
  for(const call of h.calls.filter(c=>['read','write','remove'].includes(c[0]))) {
    assert.equal(call[2].requireAuthentication,false); assert.equal(call[2].keychainAccessible,'this-device-only'); assert.equal(call[2].keychainService,'stash.sync.login');
  }
  const cold=harness({disk:h.disk});
  await Promise.all([cold.api.bootstrapSavedStashLogin(),cold.api.bootstrapSavedStashLogin()]);
  assert.equal(cold.count('read'),1);assert.equal(cold.count('connect'),1);assert.equal(cold.count('write'),0);
  assert.deepEqual(JSON.parse(JSON.stringify(cold.saved().account)),identity(login));cold.assertPublic();
  await cold.api.forgetSavedStashLogin();assert.equal(cold.disk.size,0);
  const next=harness({disk:h.disk});await next.api.bootstrapSavedStashLogin();assert.equal(next.count('connect'),0);
});

test('build gate blocks both startup and actual sign-in/retry adapters, without reading secure storage',async()=>{
  const h=harness({allowed:false});h.seed();await h.api.bootstrapSavedStashLogin();
  await assert.rejects(h.api.signInStashSync(login.serverUrl,login.username,login.password),/not enabled/);
  await assert.rejects(h.api.retrySavedStashLogin(),/not enabled/);assert.equal(h.calls.length,0);
});

for(const serverUrl of ['http://sync.example/','https://alice:password@sync.example/','file:///tmp/private']) test(`unsafe server identity is never stored or connected: ${serverUrl}`,async()=>{
  const h=harness();assert.throws(()=>h.api.signInStashSync(serverUrl,login.username,login.password));assert.equal(h.calls.length,0);
});

test('failed or mismatching login is never saved as verified; replacement forgets previous account first',async()=>{
  const h=harness();h.seed();h.options.connectError=true;
  await assert.rejects(h.api.signInStashSync(login.serverUrl,'bob',login.password),/Offline/);
  assert.equal(h.disk.size,0);assert.equal(h.count('write'),0);assert.equal(h.saved().account,undefined);
  h.options.connectError=false;h.options.connect=async()=>h.publish({phase:'syncing',account:{serverUrl:login.serverUrl,username:'wrong'}});
  await assert.rejects(h.api.signInStashSync(login.serverUrl,'bob',login.password),/did not establish/);
  assert.equal(h.count('write'),0);h.assertPublic();
});

test('offline restart retains login, does not spin, and explicit retry succeeds',async()=>{
  const h=harness();h.seed();h.options.connectError=true;await h.api.bootstrapSavedStashLogin();
  assert.equal(h.count('connect'),1);assert.equal(h.disk.size,1);assert.equal(h.saved().account.username,'alice');assert.match(h.saved().message,/retained/);
  await tick();assert.equal(h.count('connect'),1);h.options.connectError=false;await h.api.retrySavedStashLogin();
  assert.equal(h.count('connect'),2);assert.equal(h.saved().busy,false);h.assertPublic();
});

test('definitive auth rejection clears corrective state, forgets credentials and has no automatic retry',async()=>{
  const h=harness();h.seed();await h.api.bootstrapSavedStashLogin();
  h.publish({phase:'error',authenticationRequired:true,message:'Login rejected'});await tick();
  assert.equal(h.disk.size,0);assert.equal(h.saved().account,undefined);assert.match(h.saved().message,/rejected.*cleared/);
  await h.api.bootstrapSavedStashLogin();assert.equal(h.count('connect'),1);h.assertPublic();
});

for(const kind of ['read','write','remove']) test(`secure ${kind} failure is sanitized and honest, and retry/forget remain possible`,async()=>{
  const h=harness();h.options[`${kind}Error`]=true;
  if(kind==='read') {h.seed();await h.api.bootstrapSavedStashLogin();assert.equal(h.count('connect'),0);assert.match(h.saved().message,/Could not read/);}
  if(kind==='write') {await assert.rejects(h.api.signInStashSync(login.serverUrl,login.username,login.password),/could not be confirmed/);assert.equal(h.status().account.username,'alice');assert.equal(h.disk.size,1);}
  if(kind==='remove') {h.seed();await assert.rejects(h.api.forgetSavedStashLogin(),/may reconnect after restart/);assert.equal(h.disk.size,1);assert.equal(h.count('disconnect'),1);}
  assert.equal(h.saved().storageError,true);h.assertPublic();
  h.options[`${kind}Error`]=false;await h.api.forgetSavedStashLogin();assert.equal(h.disk.size,0);assert.equal(h.saved().storageError,undefined);
});

test('malformed saved data is never submitted, and failed removal blocks account switching',async()=>{
  const h=harness();h.seed({...login,serverUrl:'https://embedded:secret@sync.example/'});await h.api.bootstrapSavedStashLogin();
  assert.equal(h.count('connect'),0);assert.equal(h.saved().storageError,true);h.assertPublic();
  h.options.removeError=true;
  await assert.rejects(h.api.signInStashSync(login.serverUrl,'bob',login.password),/Could not erase/);assert.equal(h.count('connect'),0);
});

test('signout still erases secure login when native session drain fails',async()=>{
  const h=harness();h.seed();h.options.drainError=true;
  await assert.rejects(h.api.forgetSavedStashLogin(),/Restart the app/);assert.equal(h.disk.size,0);assert.match(h.saved().message,/Restart the app/);
});

for(const phase of ['read','connect','write']) test(`late ${phase} completion cannot resurrect signed-out login; remove follows pending storage`,async()=>{
  const h=harness(),gate=deferred();let pending;
  if(phase==='read') {h.seed();h.options.readGate=gate;pending=h.api.bootstrapSavedStashLogin();}
  if(phase==='connect') {
    h.options.connect=async(serverUrl,credentials)=>{await gate.promise;h.publish({phase:'syncing',account:{serverUrl,username:credentials.username}});};
    pending=h.api.signInStashSync(login.serverUrl,login.username,login.password);
  }
  if(phase==='write') {h.options.writeGate=gate;pending=h.api.signInStashSync(login.serverUrl,login.username,login.password);}
  await tick();const stopped=h.api.forgetSavedStashLogin();assert.ok(h.count('disconnect')>=1);
  gate.resolve();await pending;await stopped;
  assert.equal(h.disk.size,0);assert.equal(h.saved().account,undefined);assert.equal(h.saved().busy,false);
  if(phase!=='write')assert.equal(h.count('write'),0);h.assertPublic();
});

test('switch during old login establishment persists only the new verified identity',async()=>{
  const h=harness(),gate=deferred();
  h.options.connect=async(serverUrl,credentials)=>{if(credentials.username==='alice')await gate.promise;h.publish({phase:'syncing',account:{serverUrl,username:credentials.username}});};
  const first=h.api.signInStashSync(login.serverUrl,'alice',login.password);await tick();
  const next=h.api.signInStashSync('https://other.example/','bob','other-synthetic');await tick();gate.resolve();await first;await next;
  assert.equal(h.count('write'),1);assert.equal(JSON.parse([...h.disk.values()][0]).username,'bob');assert.equal(h.saved().account.serverUrl,'https://other.example/');
});

test('duplicate startup/retry during delayed storage read coalesces to a single connection',async()=>{
  const h=harness(),gate=deferred();h.seed();h.options.readGate=gate;
  const starting=h.api.bootstrapSavedStashLogin();await tick();const retry=h.api.retrySavedStashLogin();
  gate.resolve();await Promise.all([starting,retry]);assert.equal(h.count('read'),1);assert.equal(h.count('connect'),1);
});

test('actual root startup effect restores saved login without opening Settings and is idempotent on remount',async()=>{
  const h=harness(),effects=[];h.seed();
  const react={createElement:()=>null,useEffect:fn=>effects.push(fn),useRef:()=>({current:null})};
  Object.assign(h.mocks,{
    react:{__esModule:true,default:react,...react},
    'react-native':{},'expo-router':{useRouter:()=>({}),Stack:()=>null},
    'react-native-safe-area-context':{},'@react-navigation/native':{DarkTheme:{colors:{}}},'react-native-paper':{MD3DarkTheme:{colors:{}}},
    'expo-sharing':{useIncomingShare:()=>({resolvedSharedPayloads:[]})},
    '../src/theme':{Colors:{}},'../src/components/SnackbarHost':{},'../src/components/ModalHost':{},
    '../src/utils/nativeShareIntent':{isShareLaunch:()=>false},
    '../src/state/folderState':{},'../src/state/settingsState':{initializeSettingsFromDatabase:async()=>{}},
  });
  h.mocks['src/db/syncClient.ts'].subscribeStashSyncProjection=()=>()=>{};
  const root=h.load('app/_layout.tsx','\nexport { RootLayout };');
  root.RootLayout();root.RootLayout();for(const fn of effects)fn();await tick();
  assert.equal(h.count('read'),1);assert.equal(h.count('connect'),1);assert.equal(h.saved().account.username,'alice');
});

test('native config retains debug identity/bundling and excludes SecureStore from both Android backup paths',()=>{
  const config=require('../app.json');assert.ok(config.expo.plugins.includes('expo-secure-store'));
  assert.ok(config.expo.plugins.includes('./plugins/debug-variant'));
  const debug=fs.readFileSync(path.join(__dirname,'../plugins/debug-variant/index.js'),'utf8');
  assert.match(debug,/applicationIdSuffix "\.debug"/);assert.match(debug,/debuggableVariants = \[\]/);
  const nativeRoot=path.join(path.dirname(require.resolve('expo-secure-store/package.json')),'android/src/main/res/xml');
  for(const name of ['secure_store_backup_rules.xml','secure_store_data_extraction_rules.xml']) {
    const rules=fs.readFileSync(path.join(nativeRoot,name),'utf8');assert.match(rules,/<exclude domain="sharedpref" path="SecureStore"\/>/);
    if(name.includes('extraction')) {assert.match(rules,/<cloud-backup>/);assert.match(rules,/<device-transfer>/);}
  }
});

test('auth rejection during an in-flight secure save removes its late write once, without teardown republish loops',async()=>{
  const h=harness(),gate=deferred();h.options.writeGate=gate;
  const saving=h.api.signInStashSync(login.serverUrl,login.username,login.password);await tick();
  const before=h.count('remove');
  h.publish({phase:'error',authenticationRequired:true,disconnecting:true});
  h.publish({phase:'error',authenticationRequired:true}); // same attempt, teardown metadata update
  gate.resolve();await saving;await tick();
  assert.equal(h.disk.size,0);assert.equal(h.count('remove'),before+1);assert.equal(h.saved().account,undefined);
});
