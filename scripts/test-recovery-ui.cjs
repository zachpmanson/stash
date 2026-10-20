// Actual TSX handlers, controlled hooks/native widgets; no renderer/device or real app data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ dev = true, optIn = false, platform = 'android' } = {}) {
  let states = [], refs = [], cursor = 0, refCursor = 0, current = null;
  const calls = [], navigation = [], modules = new Map();
  const reject = name => async () => { calls.push(name); throw Error('Restored data is read-only until a full merge with the sync server completes. Connect in Settings.'); };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: value => ({ current: refCursor < refs.length ? refs[refCursor++] : value }),
    useCallback: fn => fn, useMemo: fn => fn(), useEffect() {},
  };
  const modal = { showModal: config => { current = config; }, useModalStore: selector => selector({ current, dismiss: () => { current = null; } }) };
  const db = Object.fromEntries(['archiveItem','archiveFolder','updateItemListenedPercent','updateFolderName','updateFolderIcon','updateFolderLayout','addItemToFolder','removeItemFromFolder','createFolder','updateItemTitle','unarchiveItem','createTextSubstitution','updateTextSubstitution','deleteTextSubstitution'].map(name => [name, reject(name)]));
  const mocks = {
    react: { __esModule: true, default: react, ...react },
    'react-native': { ...Object.fromEntries(['View','Text','TextInput','Pressable','ScrollView','Modal','KeyboardAvoidingView','Switch','FlatList','Image','ActivityIndicator','RefreshControl'].map(name => [name,name])), StyleSheet: { create: value => value }, Platform: { OS: platform }, NativeModules: {}, useWindowDimensions: () => ({ width: 360, height: 400 }) },
    'expo-router': { useLocalSearchParams: () => ({ id: 'id', folderName: 'Folder', folderIcon: 'F' }), useRouter: () => ({ back: () => navigation.push('back'), push() {} }), useFocusEffect() {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    'unicode-segmenter/grapheme': { countGraphemes: value => value.length },
    'src/utils/nativeShareIntent': { isShareLaunch: () => false }, 'src/utils/randomId': { randomId: () => 'id' },
    'src/state/modalState': modal, '../state/modalState': modal,
    '../db/items': db, '../db/folders': db, '../db/textSubstitutions': db,
    '../db/database': {}, '../db/syncReplica': {}, '../db/syncClient': {}, '../db/syncReplicaSmoke': {},
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
    vm.runInNewContext(code, { module, exports: module.exports, console, __DEV__: dev, process: { env: { EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS: optIn ? '1' : undefined } }, require: spec => {
      if (spec in mocks) return mocks[spec];
      if (spec === 'src/state/folderState') return mocks['../state/folderState'];
      if (/components\//.test(spec) || spec.startsWith('./FolderGrid')) return { __esModule: true, default: spec };
      if (spec.includes('theme')) return load('src/theme/index.ts');
      if (spec === '../utils/uiAction') return load('src/utils/uiAction.ts');
      if (spec === '../utils/syncBuildGate') return load('src/utils/syncBuildGate.ts');
      throw Error(`Unexpected import ${spec} in ${file}`);
    } }, { filename: file });
    return module.exports;
  }
  const render = (file, values = [], refValues = [], name = 'default', props = {}) => {
    states = values; refs = refValues; cursor = 0; refCursor = 0;
    return load(file, file.endsWith('TextSubstitutionsScreen.tsx') ? '\nexport { SubstitutionModal };' : '')[name](props);
  };
  return { render, calls, navigation, mocks, states: () => states, current: () => current,
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
  return [root, ...nodes(root.props?.children), ...nodes(root.props?.buttons)];
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

for (const build of [
  {dev:false,optIn:false,platform:'android',allowed:false},
  {dev:false,optIn:true,platform:'android',allowed:true},
  {dev:true,optIn:false,platform:'android',allowed:true},
  {dev:true,optIn:true,platform:'ios',allowed:false},
]) test(`actual pending Settings never authorizes Connect outside shared build gate: ${JSON.stringify(build)}`, () => {
  const h = harness(build), tree = h.render('src/screens/SettingsScreen.tsx',[null,true,false,'','','',{phase:'stopped'}]);
  const all = nodes(tree), connect = all.find(n => n.type === 'Pressable' && words(n) === 'Connect and sync');
  assert.equal(!!connect,build.allowed);
  const scroll = all.find(n => n.type === 'ScrollView'); assert.ok(scroll.props.contentContainerStyle); assert.equal(scroll.props.keyboardShouldPersistTaps,'handled');
  const banner = all.find(n => n.type === 'Text' && words(n).includes('Restored locally')); assert.ok(banner.props.style.color);
  if (build.allowed) { assert.equal(all.filter(n => n.type === 'TextInput').length,3); assert.ok(all.find(n => n.type === 'Pressable' && words(n) === 'Disconnect')); }
});

test('actual Settings explains missing preparation and keeps Connect retryable', async () => {
  const h = harness();
  class PreparationRequired extends Error {}
  let attempts = 0;
  h.mocks['../db/syncClient'] = {
    StashSyncPreparationRequiredError: PreparationRequired,
    connectStashSync: async () => { attempts++; throw new PreparationRequired("Prepare this install's local sync replica before connecting."); },
  };
  let tree = h.render('src/screens/SettingsScreen.tsx', [null,false,false,'http://localhost/','x','x',{phase:'stopped'}]);
  for (let i = 0; i < 2; i++) {
    const connect = button(tree,'Connect and sync');
    assert.equal(connect.props.disabled,false);
    connect.props.onPress();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.current().title,'Prepare sync first');
    assert.match(h.current().message,/Prepare.*local sync replica before connecting/);
    assert.equal(h.states()[2],false);
    assert.equal(h.states()[6].phase,'stopped');
    tree = h.render('src/screens/SettingsScreen.tsx',h.states());
  }
  assert.equal(attempts,2);
});
