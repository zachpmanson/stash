// Actual TSX handlers, controlled hooks/native widgets; no renderer/device or real app data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ dev = true, optIn = false, platform = 'android', effects = false } = {}) {
  let states = [], refs = [], cursor = 0, refCursor = 0, current = null;
  const calls = [], navigation = [], modules = new Map();
  let effectCursor = 0, effectSlots = [], pendingEffects = [], cleanups = [];
  const reject = name => async () => { calls.push(name); throw Error('Restored data is read-only until a full merge with the sync server completes. Connect in Settings.'); };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: value => ({ current: refCursor < refs.length ? refs[refCursor++] : value }),
    useCallback: fn => fn, useMemo: fn => fn(), useEffect(fn, deps) {
      const i = effectCursor++;
      if (effects && (!effectSlots[i] || deps?.some((value, j) => value !== effectSlots[i][j]))) {
        effectSlots[i] = deps; pendingEffects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
      }
    },
  };
  const modal = { showModal: config => { current = config; }, useModalStore: selector => selector({ current, dismiss: () => { current = null; } }) };
  const db = Object.fromEntries(['archiveItem','archiveFolder','updateItemListenedPercent','updateFolderName','updateFolderIcon','updateFolderLayout','addItemToFolder','removeItemFromFolder','createFolder','updateItemTitle','unarchiveItem','createTextSubstitution','updateTextSubstitution','deleteTextSubstitution'].map(name => [name, reject(name)]));
  const mocks = {
    react: { __esModule: true, default: react, ...react },
    'react-native': { ...Object.fromEntries(['View','Text','TextInput','Pressable','ScrollView','Modal','KeyboardAvoidingView','Switch','FlatList','Image','ActivityIndicator','RefreshControl'].map(name => [name,name])), StyleSheet: { create: value => value }, Platform: { OS: platform }, NativeModules: {}, useWindowDimensions: () => ({ width: 360, height: 400 }) },
    'expo-router': { useLocalSearchParams: () => ({ id: 'id', folderName: 'Folder', folderIcon: 'F' }), useRouter: () => ({ back: () => navigation.push('back'), push: route => navigation.push(route) }), useFocusEffect() {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    'unicode-segmenter/grapheme': { countGraphemes: value => value.length },
    'src/utils/nativeShareIntent': { isShareLaunch: () => false }, 'src/utils/randomId': { randomId: () => 'id' },
    'src/state/modalState': modal, '../state/modalState': modal,
    '../db/items': db, '../db/folders': db, '../db/textSubstitutions': db,
    '../db/database': {}, '../db/syncReplica': {}, '../db/syncClient': {}, '../db/syncLogin': {}, '../db/syncReplicaSmoke': {},
    '../utils/backup': {}, '../utils/randomId': { randomId: () => 'id' },
    '../state/settingsState': { useSettingsStore: selector => selector({ auRecipe: false }) },
    '../state/voiceState': { useVoiceStore: selector => selector({ voices: [] }) },
    '../state/folderState': { useFolderStore: () => ({ refresh: async () => {} }) },
    'src/state/scrollTopState': { useScrollTopState: selector => selector({ setHandler() {} }) },
    'src/state/snackbarState': { showSnackbar() {} },
    '../hooks/useArticle': { useArticle: () => ({ state: { kind: 'loading' } }) },
    '../utils/readability': {}, '../utils/speech': {}, '../utils/recipe': {}, '../utils/auRecipe': {}, '../state/recipeCheckState': {},
    'expo-clipboard': {}, 'expo-file-system/legacy': {}, 'expo-intent-launcher': {}, 'expo-sharing': {},
    'react-native-render-html': {},
  };
  function load(file, extra = '') {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8') + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, URL, __DEV__: dev, process: { env: { EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS: optIn ? '1' : undefined } }, require: spec => {
      if (spec in mocks) return mocks[spec];
      if (spec === 'src/state/folderState') return mocks['../state/folderState'];
      if (/components\//.test(spec) || spec.startsWith('./FolderGrid')) return { __esModule: true, default: spec };
      if (spec.includes('theme')) return load('src/theme/index.ts');
      if (spec === './syncIdentity') return load('src/db/syncIdentity.ts');
      if (spec === '../utils/uiAction') return load('src/utils/uiAction.ts');
      if (spec === '../utils/syncBuildGate') return load('src/utils/syncBuildGate.ts');
      throw Error(`Unexpected import ${spec} in ${file}`);
    } }, { filename: file });
    return module.exports;
  }
  const render = (file, values = [], refValues = [], name = 'default', props = {}) => {
    states = values; refs = refValues; cursor = 0; refCursor = 0; effectCursor = 0;
    return load(file, file.endsWith('TextSubstitutionsScreen.tsx') ? '\nexport { SubstitutionModal };' : '')[name](props);
  };
  return { render, calls, navigation, mocks, load,
    flushEffects() { const queued = pendingEffects; pendingEffects = []; queued.forEach(fn => fn()); },
    unmount() { cleanups.forEach(fn => fn?.()); cleanups = []; effectSlots = []; pendingEffects = []; },
    states: () => states, current: () => current,
    async pressModal(text) {
      const host = render('src/components/ModalHost.tsx', [], [], 'ModalHost');
      const button = nodes(host).find(node => node.type === 'Pressable' && words(node) === text);
      assert.ok(button, `modal button ${text}`); await button.props.onPress();
    },
  };
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...(typeof root.type === 'function' ? nodes(root.type(root.props)) : []), ...nodes(root.props?.children), ...nodes(root.props?.buttons)];
}
function words(root) {
  if (typeof root === 'string') return root;
  if (Array.isArray(root)) return root.map(words).join('');
  return root?.props ? words(root.props.children) : '';
}
function button(tree, text) { const found = nodes(tree).find(n => n.type === 'Pressable' && words(n) === text); assert.ok(found, `button ${text}`); return found; }
function recoveryMessage(h, call) { assert.ok(h.calls.includes(call)); assert.equal(h.current().title, 'Action not completed'); assert.match(h.current().message, /read-only.*full merge.*Settings/); assert.deepEqual(h.navigation, []); }

test('actual folder edit Save and keyboard submit consume read-only rejections without navigating', async () => {
  for (const keyboard of [false,true]) {
    const h = harness(), tree = h.render('src/screens/EditFolderScreen.tsx');
    if (keyboard) await nodes(tree).find(n => n.type === 'TextInput').props.onSubmitEditing();
    else await button(tree,'Save').props.onPress();
    recoveryMessage(h,'updateFolderName');
  }
});

for (const remove of [false,true]) test(`actual move membership handler catches ${remove ? 'remove' : 'add'} rejection without toggling selection`, async () => {
  const h = harness(), selected = new Set(remove ? ['a','b'] : ['b']);
  const tree = h.render('src/screens/MoveItemScreen.tsx', [[],selected]);
  const list = nodes(tree).find(n => n.type === 'FlatList');
  await list.props.renderItem({ item: { id:'a',name:'A' } }).props.onPress();
  recoveryMessage(h,remove ? 'removeItemFromFolder' : 'addItemToFolder'); assert.equal(h.states()[1],selected);
});

test('actual item bookmark action catches recovery error and does not claim success', async () => {
  const h = harness();
  const item = { id:'id',type:'url',uri:'https://example.test' };
  const tree = h.render('src/screens/ItemDetailScreen.tsx',[item,false,true,false,false,false,600,100,true], [null,null,{start:1,end:2}]);
  const bookmark = nodes(tree).find(n => n.props?.children?.some(c => c?.props?.name === 'bookmark-add'));
  assert.ok(bookmark); await bookmark.props.onPress(); recoveryMessage(h,'updateItemListenedPercent');
});

for (const target of ['folder','folder-item','item']) test(`actual ${target} archive confirmation is caught by actual ModalHost`, async () => {
  const h = harness();
  if (target === 'item') {
    const tree = h.render('src/screens/ItemDetailScreen.tsx',[{id:'id',type:'image'}]);
    const archive = nodes(tree).find(n => n.props?.children?.some(c => c?.props?.name === 'archive'));
    archive.props.onPress();
  } else {
    const tree = h.render('src/screens/FolderScreen.tsx');
    if (target === 'folder-item') nodes(tree).find(n => n.props?.onLongPress).props.onLongPress({id:'id'});
    else nodes(tree).find(n => n.props?.children?.some(c => c?.props?.name === 'archive')).props.onPress();
  }
  await h.pressModal('Archive'); recoveryMessage(h,target === 'folder' ? 'archiveFolder' : 'archiveItem');
});

for (const mode of ['create','update','delete']) test(`actual substitution ${mode} handler displays rejection and resets busy state`, async () => {
  const h = harness(); let saved = false;
  const tree = h.render('src/screens/TextSubstitutionsScreen.tsx',['find','replace',false,false],[],'SubstitutionModal',{target:mode === 'create' ? 'new' : {id:'id'},onClose(){},onSaved(){saved=true;} });
  await button(tree,mode === 'delete' ? 'Delete' : 'Save').props.onPress();
  recoveryMessage(h,`${mode}TextSubstitution`); assert.equal(saved,false); assert.equal(h.states()[3],false);
});

test('actual home and folder-selector create handlers catch pending errors', async () => {
  let h = harness();
  let tree = h.render('src/screens/HomeScreen.tsx',[true,'New folder']);
  const input = nodes(tree).find(n => n.type === 'TextInput');
  await input.props.onSubmitEditing(); recoveryMessage(h,'createFolder');
  h = harness(); tree = h.render('src/components/FolderSelector.tsx',['New folder',false],[],'default',{folders:[],selectedIds:new Set(),onToggle(){},onFolderCreated(){assert.fail('must not claim created');}});
  await nodes(tree).find(n => n.type === 'TextInput').props.onSubmitEditing(); recoveryMessage(h,'createFolder'); assert.equal(h.states()[1],false);
});

test('actual archive direct unarchive submit catches rejection', async () => {
  const h = harness();
  const tree = h.render('src/screens/ArchiveScreen.tsx',[[],[],false,{id:'id',title:'old'},'new']);
  const input = nodes(tree).find(n => n.type === 'TextInput');
  await input.props.onSubmitEditing(); recoveryMessage(h,'updateItemTitle');
});


const settingsFile = 'src/screens/SettingsScreen.tsx';
const syncFile = 'src/screens/SyncSettingsScreen.tsx';
const inputs = tree => nodes(tree).filter(n => n.type === 'TextInput');
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const builds = [
  {dev:false,optIn:false,platform:'android',allowed:false},
  {dev:false,optIn:true,platform:'android',allowed:true},
  {dev:true,optIn:false,platform:'android',allowed:true},
  {dev:true,optIn:true,platform:'ios',allowed:false},
  {dev:false,optIn:true,platform:'ios',allowed:false},
];
for (const build of builds) test(`actual Settings row and direct Sync page obey shared build gate: ${JSON.stringify(build)}`, () => {
  const h = harness(build), tree = h.render(settingsFile,[null,true,false]);
  const row = nodes(tree).find(n => n.type === 'Pressable' && words(n) === 'Sync');
  assert.equal(!!row, build.allowed);
  assert.equal(inputs(tree).length,0);
  assert.ok(!words(tree).includes('Prepare this install'));
  assert.ok(!words(tree).includes('Connect and sync'));
  const banner = nodes(tree).find(n => n.type === 'Text' && words(n).includes('Restored locally'));
  assert.match(words(banner),build.allowed ? /Settings → Sync/ : /Recovery requires an Android/);
  assert.ok(banner.props.style.color);
  if (row) { row.props.onPress(); assert.deepEqual(h.navigation,['/settings/sync']); }
  // Effects are disabled in this gate-only case; inject the subscribed signed-out state.
  const page = h.render(syncFile,[false,false,'','','',{phase:'stopped'}]);
  assert.equal(inputs(page).length,build.allowed ? 3 : 0);
  assert.equal(!!nodes(page).find(n => n.type === 'Pressable' && words(n) === 'Connect and sync'),build.allowed);
  const scroll = nodes(page).find(n => n.type === 'ScrollView');
  assert.ok(scroll.props.contentContainerStyle); assert.equal(scroll.props.keyboardShouldPersistTaps,'handled');
});

// Most legacy recovery tests deliberately do not run effects. These Sync tests explicitly
// mount/flush the actual subscription effect and clean it up on remount, with a fake
// status source. Re-renders are manual; this is not a React renderer or a device test.
function syncUi(initial = {phase:'stopped'}) {
  const h = harness({effects:true}); let status = initial, listener, attempts = 0;
  class PreparationRequired extends Error {}
  let connect = async () => { attempts++; publish({phase:'syncing',account:{username:'stored-user',serverUrl:'https://sync.example/'}}); };
  let disconnect = async () => { publish({phase:'stopped'}); };
  const publish = next => { status = next; listener?.(next); };
  h.mocks['../db/database'] = { withAppDb: async () => false, isRestorePendingOwned() {} };
  h.mocks['../db/syncClient'] = {
    StashSyncPreparationRequiredError: PreparationRequired,
    subscribeStashSyncStatus: fn => { listener = fn; fn(status); return () => { listener = null; }; },
    connectStashSync: (...args) => connect(...args),
    disconnectStashSyncAndWait: () => disconnect(),
  };
  h.mocks['../db/syncLogin'] = {
    subscribeSavedStashLogin: fn => { fn({busy:false}); return () => {}; },
    signInStashSync: (...args) => connect(...args),
    forgetSavedStashLogin: () => disconnect(),
    retrySavedStashLogin: async () => {},
  };
  function render(values = h.states()) { return h.render(syncFile,values); }
  render([]); h.flushEffects();
  return { h, render, publish, PreparationRequired, status:()=>status, attempts: () => attempts,
    setConnect(fn) { connect = fn; }, setDisconnect(fn) { disconnect = fn; } };
}

test('actual Sync page signs in, clears password, and retains subscribed account through sync/error and reopening', async () => {
  const u = syncUi(), {h} = u;
  let tree = u.render(); assert.equal(inputs(tree).length,3);
  inputs(tree)[0].props.onChangeText('https://typed.example/');
  inputs(tree)[1].props.onChangeText('typed-user');
  inputs(tree)[2].props.onChangeText('secret');
  await button(u.render(),'Connect and sync').props.onPress(); await tick();
  assert.equal(h.states()[4],'');
  const account = {username:'stored-user',serverUrl:'https://sync.example/'};
  for (const phase of ['syncing','synced','error']) {
    u.publish({phase,account,message: phase === 'error' ? 'Temporary network failure' : phase});
    tree = u.render(); assert.equal(inputs(tree).length,0);
    assert.match(words(tree),/Signed in as stored-user/); assert.match(words(tree),/https:\/\/sync.example\//);
    assert.ok(!words(tree).includes('typed-user')); assert.ok(!words(tree).includes('Connect and sync'));
    assert.ok(!words(tree).includes('Prepare this install')); button(tree,'Sign out');
  }
  h.unmount(); const opening = u.render([]);
  assert.equal(inputs(opening).length,0); assert.match(words(opening),/Checking sync status/);
  h.flushEffects(); tree = u.render();
  assert.equal(inputs(tree).length,0); assert.match(words(tree),/Signed in as stored-user/);
  assert.match(words(tree),/Temporary network failure/);
});

for (const preparation of [true,false]) test(`actual Sync failed ${preparation ? 'preparation' : 'auth'} remains retryable with visible inputs`, async () => {
  const u = syncUi(); let attempts=0;
  u.setConnect(async () => { attempts++; u.publish({phase:preparation ? 'stopped' : 'error',message:'failure'}); throw preparation ? new u.PreparationRequired('Prepare local sync replica before connecting') : Error('HTTP 401'); });
  for (let i=0;i<2;i++) {
    const connect = button(u.render(),'Connect and sync'); assert.equal(connect.props.disabled,false);
    connect.props.onPress(); await tick();
    assert.equal(u.h.current().title,preparation ? 'Prepare sync first' : 'Stash sync sign-in issue');
    assert.equal(inputs(u.render()).length,3);
    assert.equal(u.h.states()[1],false);
  }
  assert.equal(attempts,2);
});

for (const cancel of [false,true]) test(`actual Sync ${cancel ? 'cancel' : 'sign out'} waits for drain before revealing fields and clears password`, async () => {
  const account = {username:'stored-user',serverUrl:'https://sync.example/'};
  const u = syncUi(cancel ? {phase:'connecting'} : {phase:'synced',account});
  // Simulate an in-flight attempt whose connect promise is still unresolved.
  u.h.states()[4]='secret';
  const gate = deferred();
  u.setDisconnect(async () => { u.publish({phase:'stopped'}); await gate.promise; });
  const tree = u.render();
  if (cancel) { assert.ok(inputs(tree).every(n => n.props.editable === false)); assert.equal(button(tree,'Connect and sync').props.disabled,true); }
  button(tree,cancel ? 'Cancel' : 'Sign out').props.onPress();
  await tick(); let pending = u.render();
  assert.equal(inputs(pending).length,0); assert.match(words(pending),/Signing out/);
  assert.ok(!words(pending).includes('Connect and sync'));
  gate.resolve(); await tick();
  assert.equal(inputs(u.render()).length,3); assert.equal(u.h.states()[4],'');
  assert.equal(button(u.render(),'Connect and sync').props.disabled,false);
});

test('actual Sync teardown failure is not shown as successful sign out or an enabled reconnect', async () => {
  const u = syncUi({phase:'synced',account:{username:'stored-user',serverUrl:'https://sync.example/'}});
  u.setDisconnect(async () => { u.publish({phase:'stopped',restartRequired:true}); throw Error('Sync could not stop safely. Restart the app before reconnecting.'); });
  button(u.render(),'Sign out').props.onPress(); await tick();
  const tree=u.render(); assert.equal(inputs(tree).length,0);
  assert.match(words(tree),/Sign out could not finish.*Restart the app/);
  assert.ok(!words(tree).includes('Connect and sync'));
  assert.equal(u.h.current().title,'Sign out failed');
});

test('actual Sync page keeps preparation hidden during recovery and moves preparation/smoke handlers off main Settings', async () => {
  const u=syncUi(); let prepared=0, smoked=0;
  u.h.mocks['../db/syncReplica'].prepareCurrentStashReplica=async () => { prepared++; return {seeded:true}; };
  u.h.mocks['../db/syncReplicaSmoke'].runSyncReplicaSmoke=async () => { smoked++; return {ok:true}; };
  button(u.render(),"Prepare this install's local sync replica").props.onPress(); await tick();
  assert.equal(prepared,1); assert.equal(u.h.current().title,'Local sync replica prepared');
  button(u.render(),'Run isolated sync migration smoke').props.onPress(); await tick();
  assert.equal(smoked,1); assert.equal(u.h.current().title,'Sync migration smoke passed');
  u.h.states()[0]=true;
  const pending=u.render(); assert.match(words(pending),/read-only until a full server merge/);
  assert.ok(!words(pending).includes('Prepare this install')); button(pending,'Connect and sync');
});

test('actual Sync cancellation keeps fields hidden even if connect resolves before the teardown drain', async () => {
  const u=syncUi(), connectGate=deferred(), drainGate=deferred();
  u.setConnect(async () => { u.publish({phase:'connecting'}); await connectGate.promise; });
  button(u.render(),'Connect and sync').props.onPress();
  let tree=u.render(); assert.equal(button(tree,'Connect and sync').props.disabled,true);
  assert.ok(inputs(tree).every(input => input.props.editable === false));
  u.setDisconnect(async () => { u.publish({phase:'stopped',disconnecting:true}); await drainGate.promise; u.publish({phase:'stopped'}); });
  button(tree,'Cancel').props.onPress(); connectGate.resolve(); await tick();
  assert.equal(u.h.states()[1],false); // Connect's finally has already run.
  assert.equal(inputs(u.render()).length,0);
  drainGate.resolve(); await tick(); assert.equal(inputs(u.render()).length,3);
});

for (const failed of [false,true]) test(`actual Sync remount respects subscribed ${failed ? 'restart-required failure' : 'pending drain'} instead of showing login`, () => {
  const u=syncUi({phase:'stopped',...(failed ? {restartRequired:true} : {disconnecting:true}),message:'Sync disconnected.'});
  let tree=u.render(); assert.equal(inputs(tree).length,0);
  assert.ok(!words(tree).includes('Connect and sync'));
  assert.match(words(tree),failed ? /Sign out could not finish.*Restart the app/ : /Signing out/);
  u.h.unmount(); tree=u.render([]); assert.equal(inputs(tree).length,0);
  u.h.flushEffects(); tree=u.render(); assert.equal(inputs(tree).length,0);
  assert.match(words(tree),failed ? /Restart the app/ : /Signing out/);
  if (!failed) { u.publish({phase:'stopped'}); assert.equal(inputs(u.render()).length,3); }
});

test('actual Sync preparation action failure resets busy without hiding retryable auth controls', async () => {
  const u=syncUi(); u.h.mocks['../db/syncReplica'].prepareCurrentStashReplica=async () => { throw Error('preparation failed'); };
  button(u.render(),"Prepare this install's local sync replica").props.onPress(); await tick();
  assert.equal(u.h.current().title,'Local sync replica failed'); assert.equal(u.h.states()[1],false);
  assert.equal(inputs(u.render()).length,3); assert.equal(button(u.render(),'Connect and sync').props.disabled,false);
});

// Compose actual Settings handlers with the actual saved-login owner, not just action spies.
function savedUi() {
  const u=syncUi(),{h}=u,options={};let record;
  const manager=h.load('src/db/savedSyncLogin.ts').createSavedSyncLogin({
    storage:{
      read:async()=>{if(options.readError)throw Error('secure read');return record??null;},
      write:async value=>{record=value;if(options.writeError)throw Error('secure write');},
      remove:async()=>{if(options.removeError)throw Error('secure remove');record=undefined;},
    },
    connect:async login=>{await h.mocks['../db/syncClient'].connectStashSync(login.serverUrl,login);return u.status().account;},
    disconnect:()=>h.mocks['../db/syncClient'].disconnectStashSyncAndWait(),
  });
  u.setConnect(async(serverUrl,credentials)=>u.publish({phase:'syncing',account:{serverUrl,username:credentials.username}}));
  Object.assign(h.mocks['../db/syncLogin'],{
    subscribeSavedStashLogin:manager.subscribe,signInStashSync:manager.login,
    forgetSavedStashLogin:manager.forget,retrySavedStashLogin:manager.retry,
  });
  h.unmount();u.render([]);h.flushEffects();
  return {...u,manager,options,seed(){record={version:1,serverUrl:'https://saved.example/',username:'saved-user',password:'synthetic-secret'};},record:()=>record};
}

test('actual Settings + saved owner: offline cold login shows saved identity, explicit retry then signout forgets it',async()=>{
  const u=savedUi();u.seed();u.setConnect(async()=>{throw Error('Offline');});await u.manager.bootstrap();
  let tree=u.render();assert.match(words(tree),/Saved login for saved-user/);assert.match(words(tree),/retained/);assert.equal(inputs(tree).length,0);
  button(tree,'Retry saved login');button(tree,'Forget saved login');
  u.setConnect(async(serverUrl,credentials)=>u.publish({phase:'syncing',account:{serverUrl,username:credentials.username}}));
  await button(tree,'Retry saved login').props.onPress();await tick();
  tree=u.render();assert.match(words(tree),/Signed in as saved-user/);
  await button(tree,'Sign out').props.onPress();await tick();
  assert.equal(u.record(),undefined);assert.equal(inputs(u.render()).length,3);assert.match(words(u.render()),/Saved login forgotten/);
});

test('actual Settings + secure write failure shows session-only state and clears typed password',async()=>{
  const u=savedUi();u.options.writeError=true;
  const fields=inputs(u.render());fields[0].props.onChangeText('https://sync.example/');fields[1].props.onChangeText('alice');fields[2].props.onChangeText('synthetic-secret');
  await button(u.render(),'Connect and sync').props.onPress();await tick();
  const tree=u.render();assert.match(words(tree),/Connected for this session.*could not be confirmed/);assert.equal(u.h.states()[4],'');
  assert.equal(u.h.current().title,'Stash sync sign-in issue');assert.ok(!words(tree).includes('synthetic-secret'));
  await button(tree,'Sign out').props.onPress();await tick();assert.equal(u.record(),undefined);
});

test('actual Settings + secure removal failure never claims successful forgetting and offers retry',async()=>{
  const u=savedUi();u.seed();await u.manager.bootstrap();u.options.removeError=true;
  await button(u.render(),'Sign out').props.onPress();await tick();
  let tree=u.render();assert.match(words(tree),/Could not erase.*may reconnect after restart/);assert.ok(!words(tree).includes('Saved login forgotten'));
  assert.equal(u.h.current().title,'Sign out failed');button(tree,'Forget saved login');
  u.options.removeError=false;await button(tree,'Forget saved login').props.onPress();await tick();assert.equal(u.record(),undefined);
});

test('actual Settings + invalid credentials clear saved account and expose corrective login without retrying',async()=>{
  const u=savedUi();u.seed();await u.manager.bootstrap();u.manager.authenticationRejected();await tick();
  const tree=u.render();assert.equal(inputs(tree).length,3);assert.match(words(tree),/Login rejected.*sign in again/);assert.equal(u.record(),undefined);
});
