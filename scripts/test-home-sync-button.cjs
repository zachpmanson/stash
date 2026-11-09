// Actual HomeScreen + shortcut + presentation code; synthetic status/router/native widgets.
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

const account = { username: 'synthetic-owner', serverUrl: 'https://sync.example/' };
const active = (phase = 'synced', extra = {}) => ({ phase, account, media: { pending: 0, errors: 0 }, ...extra });

async function harness(t, { initial = { phase: 'stopped' }, saved = { busy: false }, dev = false, optIn = false, platform = 'android', share = false } = {}) {
  let status = initial, login = saved, renderer;
  const listeners = new Set(), loginListeners = new Set(), nav = [];
  const subscriptions = { status: 0, login: 0, statusCleanups: 0, loginCleanups: 0 };
  const animation = { starts: 0, stops: 0, timings: [], resets: [], interpolations: [] };
  const linear = value => value;
  const modules = new Map();
  const setHandler = () => {}, refresh = async () => {};
  const mocks = {
    react: React,
    'react-native': {
      ...Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'FlatList', 'Modal', 'KeyboardAvoidingView'].map(name => [name, name])),
      Platform: { OS: platform }, StyleSheet: { create: styles => styles },
      Easing: { linear },
      Animated: {
        View: 'Animated.View',
        Value: class {
          setValue(value) { animation.resets.push(value); }
          interpolate(config) { animation.interpolations.push(config); return 'rotation'; }
        },
        timing: (value, config) => { animation.timings.push(config); return {}; },
        loop: () => ({ start: () => animation.starts++, stop: () => animation.stops++ }),
      },
    },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    'expo-router': { useRouter: () => ({ push: route => nav.push(route) }), useFocusEffect: callback => React.useEffect(callback, [callback]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../db/syncClient': { subscribeStashSyncStatus: listener => {
      subscriptions.status++; listeners.add(listener); listener(status);
      return () => { subscriptions.statusCleanups++; listeners.delete(listener); };
    } },
    '../db/syncLogin': { subscribeSavedStashLogin: listener => {
      subscriptions.login++; loginListeners.add(listener); listener(login);
      return () => { subscriptions.loginCleanups++; loginListeners.delete(listener); };
    } },
    '../db/folders': {},
    'src/state/modalState': { showModal: () => assert.fail('Shortcut must not open mutation dialogs') },
    '../state/modalState': { showModal: () => assert.fail('Shortcut must not open mutation dialogs') },
    'src/state/folderState': { useFolderStore: () => ({ refresh }) },
    'src/state/scrollTopState': { useScrollTopState: selector => selector({ setHandler }) },
    'src/utils/nativeShareIntent': { isShareLaunch: () => share },
    'src/utils/randomId': { randomId: () => assert.fail('Shortcut must not create records') },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console, __DEV__: dev,
      process: { env: { EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS: optIn ? '1' : undefined } },
      require: spec => {
        if (spec in mocks) return mocks[spec];
        if (spec === '../components/HomeSyncButton') return load('src/components/HomeSyncButton.tsx');
        if (spec === '../utils/syncStatusIndicator') return load('src/utils/syncStatusIndicator.ts');
        if (spec === '../utils/syncBuildGate') return load('src/utils/syncBuildGate.ts');
        if (spec === '../utils/uiAction') return load('src/utils/uiAction.ts');
        if (spec === '../theme') return load('src/theme/index.ts');
        if (/components\//.test(spec)) return { __esModule: true, default: spec };
        throw Error(`Unexpected import ${spec} in ${file}`);
      },
    }, { filename: file });
    return module.exports;
  }
  const Home = load('src/screens/HomeScreen.tsx').default;
  const mount = async () => { await act(async () => { renderer = create(React.createElement(Home)); }); };
  await mount();
  const unmount = async () => { await act(async () => { renderer.unmount(); renderer = null; }); };
  t.after(async () => { if (renderer) await unmount(); });
  const buttons = () => renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.startsWith('Sync settings: '));
  const indicator = () => {
    const button = buttons()[0]; assert.ok(button, 'home bar sync button');
    const style = Object.assign({}, ...button.props.style({ pressed: false }).filter(Boolean));
    const icon = button.findByType('MaterialIcons');
    assert.equal(icon.props.accessible, false);
    assert.equal(icon.props.importantForAccessibility, 'no');
    return { label: button.props.accessibilityLabel, color: style.backgroundColor, icon: icon.props.name };
  };
  return {
    nav, subscriptions, buttons, indicator, animation, linear,
    publish: async next => { status = next; await act(async () => { for (const listener of listeners) listener(next); }); },
    saved: async next => { login = next; await act(async () => { for (const listener of loginListeners) listener(next); }); },
    press: async () => { await act(async () => { buttons()[0].props.onPress(); }); },
    unmount, mount, listeners: () => listeners.size + loginListeners.size,
    tree: () => renderer.toJSON(),
  };
}

const expected = {
  signedOut: { label: 'Sync settings: Not logged in', color: '#8080a0', icon: 'cloud-off' },
  notSynced: { label: 'Sync settings: Not synced', color: '#fbbf24', icon: 'sync-problem' },
  syncing: { label: 'Sync settings: Syncing', color: '#60a5fa', icon: 'sync' },
  synced: { label: 'Sync settings: Fully synced', color: '#4ade80', icon: 'cloud-done' },
};
for (const [name, status, state] of [
  ['signed out', { phase: 'stopped' }, 'signedOut'],
  ['failed sign-in without account', { phase: 'error' }, 'signedOut'],
  ['connecting before identity is established', { phase: 'connecting' }, 'syncing'],
  ['metadata exchange', active('syncing'), 'syncing'],
  ['established account offline', active('error'), 'notSynced'],
  ['stopped established account', active('stopped'), 'notSynced'],
  ['metadata complete but image scan unconfirmed', active('synced', { media: undefined }), 'syncing'],
  ['image queue pending', active('synced', { media: { pending: 2, errors: 0 } }), 'syncing'],
  ['image retry/failure', active('synced', { media: { pending: 2, errors: 1 } }), 'notSynced'],
  ['image error even with zero pending', active('synced', { media: { pending: 0, errors: 1 } }), 'notSynced'],
  ['metadata and supported images complete', active(), 'synced'],
  ['synced without an established identity', active('synced', { account: undefined }), 'signedOut'],
  ['disconnect drain cannot stay green', active('synced', { disconnecting: true }), 'notSynced'],
  ['restart required cannot stay green', active('synced', { restartRequired: true }), 'notSynced'],
  ['auth rejection cannot stay green', active('synced', { authenticationRequired: true }), 'signedOut'],
  ['auth rejection overrides connecting', active('connecting', { authenticationRequired: true }), 'signedOut'],
]) test(`home sync indicator: ${name}`, async t => {
  const h = await harness(t, { initial: status });
  assert.deepEqual(h.indicator(), expected[state]);
  await h.press(); assert.deepEqual(h.nav, ['/settings/sync']);
});

test('sync icon spins continuously through metadata and image sync, stops on completion and restarts on retry', async t => {
  const h = await harness(t);
  assert.equal(h.animation.starts, 0);
  await h.publish(active('connecting'));
  assert.equal(h.animation.starts, 1);
  const timing = h.animation.timings[0];
  assert.equal(timing.toValue, 1);
  assert.equal(timing.duration, 1000);
  assert.equal(timing.easing, h.linear);
  assert.equal(timing.useNativeDriver, true);
  assert.equal(timing.isInteraction, false);
  const interpolation = h.animation.interpolations.at(-1);
  assert.deepEqual(Array.from(interpolation.inputRange), [0, 1]);
  assert.deepEqual(Array.from(interpolation.outputRange), ['0deg', '-360deg'], 'spin must follow the sync glyph arrows');
  await h.publish(active('syncing'));
  await h.publish(active('synced', { media: { pending: 2, errors: 0 } }));
  assert.equal(h.animation.starts, 1, 'status updates must not restart the loop');
  assert.equal(h.animation.stops, 0);
  await h.press(); assert.deepEqual(h.nav, ['/settings/sync']);
  await h.publish(active());
  assert.equal(h.animation.stops, 1);
  assert.deepEqual(h.animation.resets, [0]);
  await h.publish(active('syncing'));
  assert.equal(h.animation.starts, 2);
  await h.publish(active('error'));
  assert.equal(h.animation.stops, 2);
  await h.publish(active('syncing'));
  await h.unmount();
  assert.equal(h.animation.stops, 3, 'unmount must stop the native animation');
  assert.deepEqual(h.animation.resets, [0, 0, 0]);
});

test('saved credentials alone are not convergence; offline retry/auth/signout update the actual home button', async t => {
  const h = await harness(t, { saved: { busy: false, account } });
  assert.deepEqual(h.indicator(), expected.notSynced);
  await h.saved({ busy: true, account }); assert.deepEqual(h.indicator(), expected.syncing);
  await h.publish(active('syncing')); assert.deepEqual(h.indicator(), expected.syncing);
  await h.saved({ busy: false, account });
  await h.publish(active()); assert.deepEqual(h.indicator(), expected.synced);
  await h.publish(active('error')); assert.deepEqual(h.indicator(), expected.notSynced);
  await h.publish(active('synced', { authenticationRequired: true })); assert.deepEqual(h.indicator(), expected.signedOut);
  await h.publish({ phase: 'stopped', disconnecting: true }); assert.deepEqual(h.indicator(), expected.notSynced);
  await h.saved({ busy: false }); await h.publish({ phase: 'stopped' }); assert.deepEqual(h.indicator(), expected.signedOut);
  assert.deepEqual(h.subscriptions, { status: 1, login: 1, statusCleanups: 0, loginCleanups: 0 });
  assert.deepEqual(h.nav, []);
});

test('home shortcut cleans up both subscriptions, remounts fresh and never displays account details', async t => {
  const h = await harness(t, { initial: active(), saved: { busy: false, account } });
  assert.deepEqual(h.indicator(), expected.synced);
  assert.doesNotMatch(JSON.stringify(h.tree()), /synthetic-owner|sync\.example/);
  await h.unmount(); assert.equal(h.listeners(), 0);
  await h.publish(active('error')); await h.mount();
  assert.deepEqual(h.indicator(), expected.notSynced);
  assert.deepEqual(h.subscriptions, { status: 2, login: 2, statusCleanups: 1, loginCleanups: 1 });
});

for (const config of [
  { dev: false, optIn: false, platform: 'android', visible: true },
  { dev: false, optIn: true, platform: 'android', visible: true },
  { dev: true, optIn: false, platform: 'android', visible: true },
  { dev: true, optIn: false, platform: 'ios', visible: false },
  { dev: false, optIn: true, platform: 'ios', visible: false },
  { dev: true, optIn: true, platform: 'web', visible: false },
  { dev: true, optIn: false, platform: 'android', share: true, visible: false },
]) test(`home shortcut respects build/platform/share gates ${JSON.stringify(config)}`, async t => {
  const h = await harness(t, { ...config, initial: active() });
  assert.equal(h.buttons().length, config.visible ? 1 : 0);
  assert.equal(h.subscriptions.status, config.visible ? 1 : 0);
  assert.equal(h.subscriptions.login, config.visible ? 1 : 0);
  await h.unmount(); assert.equal(h.listeners(), 0);
});
