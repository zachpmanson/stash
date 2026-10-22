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
  const listeners = new Set(), nav = [], requests = [], reads = [], scroll = [], writes = [], modules = new Map();
  const mocks = {
    react: React,
    'react-native': {
      ...Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'FlatList'].map(x => [x, x])),
      Platform: { OS: platform, Version: 35 }, StyleSheet: { create: x => x },
      useWindowDimensions: () => ({ width: 360, height: 640 }),
    },
    'expo-router': {
      Stack: { Screen: ({ options }) => options?.headerRight?.() ?? null },
      useLocalSearchParams: () => ({ id: folderId, folderName: 'Synthetic folder', folderIcon: 'F' }),
      useRouter: () => ({ push: route => nav.push(route), back: () => nav.push('back') }),
      useFocusEffect: callback => React.useEffect(callback, [callback]),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@react-navigation/elements': { PlatformPressable: 'PlatformPressable' },
    'unicode-segmenter/grapheme': { countGraphemes: x => x.length },
    '../db/folders': {
      getFolderById: async id => { reads.push(id); return { id, layout: 'grid' }; },
      ...Object.fromEntries(['archiveFolder', 'updateFolderName', 'updateFolderIcon', 'updateFolderLayout'].map(x => [x, async (...args) => writes.push([x, ...args])])),
    },
    '../db/items': { getItemsInFolder: async () => [{ id: 'item', lat: 1, lng: 2 }], archiveItem: async () => assert.fail('unexpected mutation') },
    'src/state/modalState': { showModal: () => assert.fail('unexpected modal') },
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
        if (spec === '../components/TopbarButton') return load('src/components/TopbarButton.tsx');
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
  const links = () => renderer.root.findAllByType('Pressable').filter(x => x.props.accessibilityLabel === 'Atom feed');
  const click = async () => { assert.equal(links().length, 1); await act(async () => links()[0].props.onPress()); };
  return {
    nav, requests, reads, scroll, writes, text, links, click, publish,
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
  assert.equal(h.links().length, 0); assert.doesNotMatch(h.text(), /Atom feed|feed URL/);
  assert.deepEqual(h.nav, []); assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});

for (const phase of ['synced', 'syncing', 'error']) test(`FolderScreen shows a labelled read-only link for established ${phase}, not confirmation`, async t => {
  const h = await harness(t, { initial: active(phase) });
  assert.equal(h.links().length, 1); assert.match(h.text(), /Atom feed/); assert.match(h.text(), /read-only/);
  assert.doesNotMatch(h.text(), /Available —|confirmed feed|https:\/\/|synthetic-owner/);
  assert.match(h.links()[0].props.accessibilityHint, /availability must be confirmed/);
  const icon = h.links()[0].findByType('MaterialIcons'); assert.equal(icon.props.name, 'rss-feed'); assert.ok(icon.props.color);
  assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
  await h.click(); assert.deepEqual(JSON.parse(JSON.stringify(h.nav)), [{ pathname: '/folder-feed/[id]', params: { id: 'folder-a' } }]);
  await h.folder('folder/β'); await h.click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.nav.at(-1))), { pathname: '/folder-feed/[id]', params: { id: 'folder/β' } });
  assert.deepEqual(h.counts(), { subscriptions: 1, unsubscribed: 0, listeners: 1 });
  await h.toggleMap(); assert.equal(h.links().length, 1); assert.match(h.text(), /FolderMap/);
});

for (const config of [
  { dev: false, optIn: false, platform: 'android', allowed: false },
  { dev: false, optIn: true, platform: 'android', allowed: true },
  { dev: true, optIn: false, platform: 'ios', allowed: false },
  { dev: false, optIn: true, platform: 'ios', allowed: false },
]) test(`FolderScreen build gate ${JSON.stringify(config)}`, async t => {
  const h = await harness(t, { ...config, initial: active() });
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
    await h.publish(state); assert.equal(h.links().length, 0);
  }
  await h.unmount(); assert.deepEqual(h.counts(), { subscriptions: 1, unsubscribed: 1, listeners: 0 });
  assert.equal(h.scroll.at(-1), null);
  await h.publish(active('synced', { restartRequired: true })); await h.remount(); assert.equal(h.links().length, 0);
  await h.publish(active('error')); assert.equal(h.links().length, 1);
  await h.unmount(); assert.deepEqual(h.counts(), { subscriptions: 2, unsubscribed: 2, listeners: 0 });
  await h.publish({ phase: 'stopped', disconnecting: true }); await h.remount(); assert.equal(h.links().length, 0);
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

for (const initial of [{ phase: 'stopped' }, active(), active('synced', { disconnecting: true }), active('synced', { restartRequired: true })]) test(`EditFolderScreen has no redundant Feed setting ${JSON.stringify(initial)}`, async t => {
  const h = await harness(t, { initial, edit: true });
  assert.doesNotMatch(h.text(), /Feed|feed|Atom|automatically/);
  assert.match(h.text(), /Name/); assert.match(h.text(), /Icon/); assert.match(h.text(), /Layout/); assert.match(h.text(), /Save/);
  assert.equal(h.counts().subscriptions, 0); assert.deepEqual(h.nav, []); assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});
