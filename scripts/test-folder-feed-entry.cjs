// Actual native screen composition/hooks, synthetic status/DB/router boundaries.
// Reuse the isolated server's matching React + renderer; no new root dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const serverRequire = createRequire(path.resolve(__dirname, '../spikes/crsqlite-expo/server/package.json'));
const React = serverRequire('react');
const { create, act } = serverRequire('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const account = { username: 'synthetic-owner', serverUrl: 'https://feeds.example/' };
const active = (phase = 'synced', extra = {}) => ({ phase, account, ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function harness(t, { initial = { phase: 'stopped' }, dev = true, optIn = false, platform = 'android', edit = false } = {}) {
  let status = initial, folderId = 'folder-a', subscriptions = 0, unsubscribed = 0, renderer;
  const listeners = new Set(), nav = [], requests = [], reads = [], scroll = [], writes = [], modals = [], modules = new Map();
  const PaperMenu = ({ visible, anchor, onDismiss, children }) => React.createElement('PaperMenu', { visible, onDismiss }, anchor, visible ? children : null);
  PaperMenu.Item = props => React.createElement('PaperMenuItem', props, props.title);
  const mocks = {
    react: React,
    'react-native': {
      ...Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'FlatList'].map(x => [x, x])),
      Platform: { OS: platform, Version: 35 }, StyleSheet: { create: x => x },
      useWindowDimensions: () => ({ width: 360, height: 640 }),
    },
    'expo-router': {
      Stack: { Screen: ({ options }) => React.createElement('StackHeader', null, options?.headerRight?.() ?? null) },
      useLocalSearchParams: () => ({ id: folderId, folderName: 'Synthetic folder', folderIcon: 'F' }),
      useRouter: () => ({ push: route => nav.push(route), back: () => nav.push('back') }),
      useFocusEffect: callback => React.useEffect(callback, [callback]),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@react-navigation/elements': { PlatformPressable: 'PlatformPressable' },
    'react-native-paper': { Menu: PaperMenu },
    'unicode-segmenter/grapheme': { countGraphemes: x => x.length },
    '../db/folders': {
      getFolderById: async id => { reads.push(id); return { id, layout: 'grid' }; },
      ...Object.fromEntries(['archiveFolder', 'updateFolderName', 'updateFolderIcon', 'updateFolderLayout'].map(x => [x, async (...args) => writes.push([x, ...args])])),
    },
    '../db/items': { getItemsInFolder: async () => [{ id: 'item', lat: 1, lng: 2 }], archiveItem: async () => assert.fail('unexpected mutation') },
    'src/state/modalState': { showModal: config => modals.push(config) },
    'src/state/scrollTopState': { useScrollTopState: selector => selector({ setHandler: setScroll }) },
    '../state/scrollTopState': { triggerScrollToTop() {} },
    '../db/syncClient': {
      subscribeStashSyncStatus: fn => {
        subscriptions++; listeners.add(fn); fn(status);
        return () => { unsubscribed++; listeners.delete(fn); };
      },
      requestStashFolderFeed: (id, action, signal) => {
        const d = deferred(); requests.push({ id, action, signal, ...d }); return d.promise;
      },
    },
    'expo-clipboard': { setStringAsync: async () => assert.fail('unexpected clipboard access') },
  };
  function setScroll(value) { scroll.push(value); }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console, URL, AbortController, __DEV__: dev,
      process: { env: { EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS: optIn ? '1' : undefined } },
      require: spec => {
        if (spec in mocks) return mocks[spec];
        if (spec === '../theme') return load('src/theme/index.ts');
        if (spec === '../utils/syncBuildGate') return load('src/utils/syncBuildGate.ts');
        if (spec === '../utils/uiAction') return load('src/utils/uiAction.ts');
        if (spec === '../state/modalState') return mocks['src/state/modalState'];
        if (spec === '../components/Screen') return load('src/components/Screen.tsx');
        if (spec === '../components/TopbarButton' || spec === './TopbarButton') return load('src/components/TopbarButton.tsx');
        if (spec === '../components/OverflowMenu') return load('src/components/OverflowMenu.tsx');
        if (/components\//.test(spec)) return { __esModule: true, default: spec };
        throw Error(`Unexpected import ${spec} in ${file}`);
      },
    }, { filename: file });
    return module.exports;
  }
  const Folder = load(`src/screens/${edit ? 'EditFolderScreen' : 'FolderScreen'}.tsx`).default;
  const Feed = load('src/screens/FolderFeedScreen.tsx').default;
  const tree = page => React.createElement(page === 'feed' ? Feed : Folder);
  await act(async () => { renderer = create(tree()); });
  t.after(async () => { if (renderer) await act(() => { renderer.unmount(); renderer = null; }); });
  const publish = async next => { status = next; await act(async () => { for (const fn of [...listeners]) fn(next); }); };
  const text = () => JSON.stringify(renderer.toJSON());
  const menu = () => renderer.root.findByType('PaperMenu');
  const openMenu = async () => {
    if (!menu().props.visible) {
      const trigger = renderer.root.findByProps({ accessibilityLabel: 'Folder actions', accessibilityRole: 'button' });
      await act(async () => trigger.props.onPress());
    }
  };
  const links = () => renderer.root.findAllByType('PaperMenuItem').filter(x => x.props.title === 'Atom feed');
  const select = async title => { await openMenu(); const entry = renderer.root.findAllByType('PaperMenuItem').find(x => x.props.title === title); assert.ok(entry); await act(async () => entry.props.onPress()); };
  const click = () => select('Atom feed');
  return {
    nav, requests, reads, scroll, writes, modals, text, links, click, publish, openMenu, select,
    menuVisible: () => menu().props.visible,
    menuTitles: () => renderer.root.findAllByType('PaperMenuItem').map(x => x.props.title),
    headerIcons: () => renderer.root.findByType('StackHeader').findAllByType('MaterialIcons').map(x => x.props.name),
    dismissMenu: async () => { await act(async () => menu().props.onDismiss()); },
    confirmArchive: async () => { const config = modals.at(-1); assert.equal(config.title, 'Archive folder?'); await act(async () => config.buttons.find(x => x.text === 'Archive').onPress()); },
    cancelArchive: async () => { const config = modals.at(-1); assert.equal(config.title, 'Archive folder?'); const button = config.buttons.find(x => x.text === 'Cancel'); assert.equal(button.style, 'cancel'); await act(async () => button.onPress?.()); },
    editFolder: async () => { const button = renderer.root.findAllByType('PlatformPressable').find(x => x.findAllByType('MaterialIcons').some(i => i.props.name === 'edit')); assert.ok(button); await act(async () => button.props.onPress()); },

    counts: () => ({ subscriptions, unsubscribed, listeners: listeners.size }),
    folder: async id => { folderId = id; await act(async () => renderer.update(tree())); },
    openFeed: async () => { assert.equal(nav.at(-1)?.pathname, '/folder-feed/[id]'); folderId = nav.at(-1).params.id; await act(async () => renderer.update(tree('feed'))); },
    reply: async (value, n = requests.length - 1) => { await act(async () => requests[n].resolve(value)); },
    toggleMap: async () => {
      const button = renderer.root.findAllByType('PlatformPressable').find(x => x.findAllByType('MaterialIcons').some(i => i.props.name === 'map'));
      assert.ok(button); await act(async () => button.props.onPress());
    },
    unmount: async () => { await act(() => { renderer.unmount(); renderer = null; }); },
    remount: async () => { await act(async () => { renderer = create(tree()); }); },
  };
}

for (const state of [
  { phase: 'stopped' }, { phase: 'connecting' }, { phase: 'syncing' }, { phase: 'synced' }, { phase: 'error' },
  active('connecting'), active('stopped'), active('synced', { disconnecting: true }),
  active('syncing', { disconnecting: true }), active('synced', { restartRequired: true }),
  active('error', { authenticationRequired: true }), active('synced', { authenticationRequired: true }),
]) test(`FolderScreen hides contextual feed for ineligible status ${JSON.stringify(state)}`, async t => {
  const h = await harness(t, { initial: state });
  await h.openMenu();
  assert.equal(h.links().length, 0); assert.doesNotMatch(h.text(), /Atom feed|feed URL/);
  assert.deepEqual(h.nav, []); assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});

for (const phase of ['synced', 'syncing', 'error']) test(`FolderScreen shows a labelled read-only link for established ${phase}, not confirmation`, async t => {
  const h = await harness(t, { initial: active(phase) });
  assert.equal(h.menuVisible(), false); assert.equal(h.links().length, 0);
  await h.openMenu();
  assert.equal(h.links().length, 1); assert.match(h.text(), /Atom feed/);
  assert.doesNotMatch(h.text(), /Available —|confirmed feed|https:\/\/|synthetic-owner|View URL and preview/);
  assert.deepEqual(h.headerIcons(), ['map', 'edit', 'more-vert']);
  assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
  await h.click(); assert.deepEqual(JSON.parse(JSON.stringify(h.nav)), [{ pathname: '/folder-feed/[id]', params: { id: 'folder-a' } }]);
  await h.folder('folder/β'); await h.click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.nav.at(-1))), { pathname: '/folder-feed/[id]', params: { id: 'folder/β' } });
  assert.deepEqual(h.counts(), { subscriptions: 1, unsubscribed: 0, listeners: 1 });
  await h.toggleMap(); await h.openMenu(); assert.equal(h.links().length, 1); assert.match(h.text(), /FolderMap/);
});

for (const config of [
  { dev: false, optIn: false, platform: 'android', allowed: false },
  { dev: false, optIn: true, platform: 'android', allowed: true },
  { dev: true, optIn: false, platform: 'ios', allowed: false },
  { dev: false, optIn: true, platform: 'ios', allowed: false },
]) test(`FolderScreen build gate ${JSON.stringify(config)}`, async t => {
  const h = await harness(t, { ...config, initial: active() });
  await h.openMenu();
  assert.equal(h.links().length, config.allowed ? 1 : 0);
  assert.equal(h.counts().subscriptions, config.allowed ? 1 : 0);
  assert.deepEqual(h.requests, []);
  await h.unmount(); assert.equal(h.counts().listeners, 0);
});

test('FolderScreen account changes, signout/drain/restart/auth rejection and remount follow subscription with cleanup', async t => {
  const h = await harness(t);
  assert.equal(h.links().length, 0);
  await h.publish(active()); await h.click();
  await h.publish(active('synced', { account: { username: 'second-owner', serverUrl: 'https://second.example/' } }));
  await h.folder('second-folder'); await h.click(); assert.equal(h.nav.at(-1).params.id, 'second-folder');
  for (const state of [active('synced', { disconnecting: true }), { phase: 'stopped', disconnecting: true }, { phase: 'stopped', restartRequired: true }, active('error', { authenticationRequired: true }), { phase: 'stopped' }, { phase: 'connecting' }]) {
    await h.publish(state); await h.openMenu(); assert.equal(h.links().length, 0);
  }
  await h.unmount(); assert.deepEqual(h.counts(), { subscriptions: 1, unsubscribed: 1, listeners: 0 });
  assert.equal(h.scroll.at(-1), null);
  await h.publish(active('synced', { restartRequired: true })); await h.remount(); await h.openMenu(); assert.equal(h.links().length, 0);
  await h.publish(active('error')); await h.openMenu(); assert.equal(h.links().length, 1);
  await h.unmount(); assert.deepEqual(h.counts(), { subscriptions: 2, unsubscribed: 2, listeners: 0 });
  await h.publish({ phase: 'stopped', disconnecting: true }); await h.remount(); await h.openMenu(); assert.equal(h.links().length, 0);
});

for (const phase of ['syncing', 'error']) test(`FolderScreen → actual FolderFeedScreen for ${phase} cannot confirm until full exchange and backend response`, async t => {
  const h = await harness(t, { initial: active(phase) });
  await h.click(); await h.openFeed();
  assert.deepEqual(h.counts(), { subscriptions: 2, unsubscribed: 1, listeners: 1 });
  assert.match(h.text(), /Unavailable — status not confirmed/); assert.match(h.text(), /wait for a complete exchange/);
  assert.equal(h.requests.length, 0); assert.doesNotMatch(h.text(), /Available — private|Copy Atom URL/);
  await h.publish(active()); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].id, 'folder-a'); assert.equal(h.requests[0].action, 'status');
  assert.match(h.text(), /Pending — waiting for backend confirmation/);
  await h.reply(new Response(JSON.stringify({ version: 1, policy: 'always-on', enabled: true, backend: 'https://feeds.example', url: 'https://feeds.example/feeds/folders/folder-a.atom', limit: 50 })));
  assert.match(h.text(), /Available — private authenticated feed/); assert.match(h.text(), /Copy Atom URL/);
  await h.publish(active('synced', { disconnecting: true }));
  assert.match(h.text(), /Unavailable — status not confirmed/); assert.doesNotMatch(h.text(), /Copy Atom URL/);
  await h.unmount(); assert.equal(h.counts().listeners, 0);
});

test('folder actions is the rightmost labelled header control; menu selection and dismissal close it', async t => {
  const h = await harness(t, { initial: active() });
  assert.deepEqual(h.headerIcons(), ['map', 'edit', 'more-vert']);
  assert.equal(h.menuVisible(), false); assert.deepEqual(h.menuTitles(), []);
  assert.doesNotMatch(h.text(), /View URL and preview|availability must be confirmed/);
  await h.openMenu(); assert.deepEqual(h.menuTitles(), ['Atom feed', 'Archive']);
  await h.dismissMenu(); assert.equal(h.menuVisible(), false); assert.deepEqual(h.nav, []);
  await h.click(); assert.equal(h.menuVisible(), false);
  assert.equal(h.nav.at(-1).pathname, '/folder-feed/[id]');
  assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []); assert.deepEqual(h.modals, []);
});

test('signed-out folder keeps Archive in overflow without a direct archive or feed button', async t => {
  const h = await harness(t);
  assert.deepEqual(h.headerIcons(), ['map', 'edit', 'more-vert']);
  await h.openMenu(); assert.deepEqual(h.menuTitles(), ['Archive']);
  await h.dismissMenu(); await h.toggleMap(); assert.deepEqual(h.headerIcons(), ['grid-view', 'edit', 'more-vert']);
  assert.equal(h.menuVisible(), false); await h.editFolder();
  assert.equal(h.nav.at(-1).pathname, '/edit-folder/[id]'); assert.equal(h.nav.at(-1).params.id, 'folder-a');
  assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});

test('open menu resets on folder, account and eligibility changes without executing a stale action', async t => {
  const h = await harness(t, { initial: active() });
  await h.openMenu(); await h.publish(active('error')); assert.equal(h.menuVisible(), true, 'same established account may be offline');
  await h.publish(active('synced', { account: { username: 'other', serverUrl: 'https://other.example/' } }));
  assert.equal(h.menuVisible(), false);
  await h.openMenu(); await h.folder('new-folder'); assert.equal(h.menuVisible(), false);
  await h.openMenu(); await h.publish({ phase: 'stopped' }); assert.equal(h.menuVisible(), false);
  await h.openMenu(); assert.deepEqual(h.menuTitles(), ['Archive']);
  await h.publish(active()); assert.equal(h.menuVisible(), false);
  for (const state of [active('synced', { disconnecting: true }), active('synced', { restartRequired: true }), active('error', { authenticationRequired: true })]) {
    await h.publish(active()); await h.openMenu(); await h.publish(state);
    assert.equal(h.menuVisible(), false); await h.openMenu(); assert.deepEqual(h.menuTitles(), ['Archive']);
  }
  assert.deepEqual(h.nav, []); assert.deepEqual(h.writes, []); assert.deepEqual(h.modals, []);
});

test('overflow Archive closes before the existing confirmation; Cancel is inert and confirmation targets current folder', async t => {
  const h = await harness(t);
  await h.select('Archive'); assert.equal(h.menuVisible(), false);
  assert.match(h.modals.at(-1).message, /Synthetic folder.*archive/);
  await h.cancelArchive(); assert.deepEqual(h.writes, []); assert.deepEqual(h.nav, []);
  await h.folder('folder/β'); await h.select('Archive'); await h.confirmArchive();
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [['archiveFolder', 'folder/β']]);
  assert.deepEqual(h.nav, ['back']); assert.deepEqual(h.requests, []);
});

for (const initial of [{ phase: 'stopped' }, active(), active('synced', { disconnecting: true }), active('synced', { restartRequired: true })]) test(`EditFolderScreen has no redundant Feed setting ${JSON.stringify(initial)}`, async t => {
  const h = await harness(t, { initial, edit: true });
  assert.doesNotMatch(h.text(), /Feed|feed|Atom|automatically/);
  assert.match(h.text(), /Name/); assert.match(h.text(), /Icon/); assert.match(h.text(), /Layout/); assert.match(h.text(), /Save/);
  assert.equal(h.counts().subscriptions, 0); assert.deepEqual(h.nav, []); assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});
