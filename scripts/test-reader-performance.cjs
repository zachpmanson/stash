// Actual ItemDetailScreen/useArticle/sentence utilities; synthetic native, extraction and DB boundaries.
// Run: nix develop --command node --test scripts/test-reader-performance.cjs
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

const HTML = '<p>First sentence. Second sentence.</p><blockquote>Quoted words.</blockquote>';
const RECIPE = { name: 'Soup', recipeIngredient: ['1 cup water'], recipeInstructions: [{ text: 'Boil water.' }] };
const plain = html => html.replace(/<[^>]*>/g, ' ').trim();
const json = value => JSON.parse(JSON.stringify(value));

async function harness(t, { screen = false, item: itemOverrides = {}, hookArgs } = {}) {
  let item = { id: 'article-1', type: 'url', uri: 'https://example.test/article', title: 'Article',
    created_at: 1, article_html: HTML, article_text: null, recipe_json: null, ...itemOverrides };
  let renderer, output, args = hookArgs ?? [item.uri, item.id, item.article_text, item.article_html, item.recipe_json, false, false];
  let width = 400, selection = null, poll, commits = 0, bookmark = null;
  let itemRead, bookmarkRead, saveError, navigationTimerId = 0, engine;
  const navigationTimers = new Map();
  const Engine = React.createContext({}), Config = React.createContext({});
  const modules = new Map(), renders = [], reads = [], writes = [], fetches = [], nav = [], snackbars = [], modals = [], scrolls = [];
  const parsing = { blocks: 0, splitBlocks: 0, splitText: 0 };
  let reply = { title: 'Refreshed', html: '<p>Fresh first. Fresh second.</p>', recipe: null };
  let fetchError, fetchReply;
  const recipeStore = { checked: {}, toggleChecked() {}, resetRecipe() {} };
  const mocks = {
    react: React,
    'react-native': {
      ...Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'RefreshControl', 'Image', 'ActivityIndicator'].map(x => [x, x])),
      StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width, height: 600, fontScale: 1 }),
      NativeModules: { TextSelection: { getSelection: async () => selection } }, findNodeHandle: () => 1,
      Linking: { openURL: async () => {} }, Share: { share: async () => {} },
    },
    '@shopify/flash-list': {
      FlashList: React.forwardRef((props, ref) => {
        const [first, setFirst] = React.useState(0);
        const state = React.useRef({ layouts: new Map(), y: 0, pending: null, header: 300 }).current;
        engine = state;
        React.useImperativeHandle(ref, () => ({
          scrollToIndex: value => {
            scrolls.push({ index: value.index }); setFirst(value.index);
            return new Promise(resolve => {
              state.pending = { index: value.index, resolve };
              if (state.layouts.get(value.index)?.isHeightMeasured) { state.pending = null; resolve(); }
            });
          },
          scrollToOffset: value => { assert.equal(value.skipFirstItemOffset, true); state.y = value.offset; scrolls.push(value); },
          getLayout: index => state.layouts.get(index), getFirstItemOffset: () => state.header,
          getAbsoluteLastScrollOffset: () => state.y,
          getFirstVisibleIndex: () => {
            for (const [index, cell] of state.layouts) if (state.y >= state.header + cell.y && state.y < state.header + cell.y + cell.height) return index;
            return state.y < state.header ? 0 : -1;
          },
        }), []);
        React.useEffect(() => { props.onLoad(); }, []);
        // This boundary models the installed v2 contract, not its native engine:
        // dynamic layout is data-relative; headers live outside that container.
        return React.createElement('FlashList', props, props.ListHeaderComponent,
          props.data.slice(first, first + 3).map((item, offset) => React.createElement(React.Fragment,
            { key: props.keyExtractor(item) }, props.renderItem({ item, index: first + offset, target: 'Cell' }))));
      }),
    },
    'react-native-render-html': {
      TRenderEngineProvider: ({ children, ...props }) => React.createElement(Engine.Provider, { value: React.useMemo(() => props, [props.baseStyle, props.tagsStyles, props.systemFonts]) }, children),
      RenderHTMLConfigProvider: ({ children, ...props }) => React.createElement(Config.Provider, { value: React.useMemo(() => props, [props.defaultTextProps]) }, children),
      RenderHTMLSource: props => { const all = { ...React.useContext(Engine), ...React.useContext(Config), ...props }; renders.push(all); return React.createElement('RenderedHtml', all); },
    },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    'expo-router': {
      useLocalSearchParams: () => ({ id: item.id }),
      useRouter: () => ({ push: route => nav.push(route), back() {} }),
      useFocusEffect: callback => React.useEffect(callback, [callback]),
    },
    'expo-clipboard': { setStringAsync: async () => {} },
    'expo-file-system/legacy': {}, 'expo-intent-launcher': {}, 'expo-sharing': {},
    '../components/Screen': { __esModule: true, default: ({ buttons, children }) => React.createElement('Screen', null, buttons, children) },
    'src/components/TopbarButton': { __esModule: true, default: 'TopbarButton' },
    'src/components/OverflowMenu': { __esModule: true, default: 'OverflowMenu' },
    'src/state/modalState': { showModal: value => modals.push(value) },
    'src/state/snackbarState': { showSnackbar: value => snackbars.push(value) },
    '../utils/uiAction': { runUiAction: action => action() },
    '../utils/speech': { estimateReadLabel: () => '1 min read' },
    '../utils/recipe': { recipeCookLabel: () => '10 min cook' },
    '../utils/auRecipe': { convertToAustralian: x => x, convertVolumeUnits: x => `metric ${x}` },
    '../state/settingsState': { useSettingsStore: selector => selector({ auRecipe: false }) },
    '../state/recipeCheckState': { useRecipeCheckStore: selector => selector(recipeStore) },
    '../db/items': {
      getItemById: async id => { reads.push(id); return itemRead ? itemRead(id) : item; }, archiveItem: async () => {},
      updateItemListenedPercent: async (id, percent) => { writes.push(['bookmark', id, percent]); item = { ...item, listened_percent: percent }; },
      updateItemArticleHtml: async (...values) => writes.push(['html', ...values]),
      updateItemRecipeJson: async (...values) => writes.push(['recipe', ...values]),
    },
    '../db/readerBookmarks': {
      getReaderBookmark: async id => bookmarkRead ? bookmarkRead(id) : bookmark,
      saveReaderBookmark: async (id, value) => { if (saveError) throw saveError; bookmark = value; writes.push(['bookmark', id, value]); },
    },
    '../utils/readability': {
      htmlToText: plain, findRecipe: () => null,
      htmlToBlocks: html => {
        parsing.blocks++;
        return [...html.matchAll(/<(p|blockquote)>(.*?)<\/\1>/g)].map(m => ({ text: m[2], mode: m[1] === 'blockquote' ? 'quote' : 'primary' }));
      },
      fetchArticle: async (url, options) => { fetches.push({ url, options }); if (fetchError) throw fetchError; return fetchReply ? fetchReply(url) : reply; },
      archiveIsUrl: url => `https://archive.is/${url}`, archiveOrgUrl: url => `https://web.archive.org/${url}`,
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console,
      setTimeout: file === 'src/utils/readerNavigation.ts' ? fn => { const id = ++navigationTimerId; navigationTimers.set(id, fn); return id; } : setTimeout,
      clearTimeout: file === 'src/utils/readerNavigation.ts' ? id => navigationTimers.delete(id) : clearTimeout,
      setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { poll = undefined; },
      require: spec => {
        if (spec in mocks) return mocks[spec];
        if (spec === 'linkedom') return require('linkedom');
        if (spec === '../components/VirtualArticle') return load('src/components/VirtualArticle.tsx');
        if (['../utils/readerChunks', '../utils/readerNavigation'].includes(spec)) return load('src/utils/' + path.basename(spec) + '.ts');
        if (spec === '../theme') return load('src/theme/index.ts');
        if (spec === '../hooks/useArticle') return load('src/hooks/useArticle.ts');
        if (spec === 'src/utils/sentences') {
          const actual = load('src/utils/sentences.ts');
          return { ...actual,
            splitSentences: (...a) => { parsing.splitText++; return actual.splitSentences(...a); },
            splitSentencesFromBlocks: (...a) => { parsing.splitBlocks++; return actual.splitSentencesFromBlocks(...a); },
          };
        }
        throw Error(`Unexpected import ${spec} in ${file}`);
      },
    }, { filename: file });
    return module.exports;
  }
  const useArticle = load('src/hooks/useArticle.ts').useArticle;
  const Component = screen ? load('src/screens/ItemDetailScreen.tsx').default : function Probe() { output = useArticle(...args); return null; };
  const tree = () => React.createElement(React.Profiler, { id: 'reader', onRender: () => { commits++; } }, React.createElement(Component));
  await act(async () => { renderer = create(tree(), { createNodeMock: () => ({ scrollTo: value => scrolls.push(value), scrollToIndex: value => scrolls.push({ index: value.index }), scrollToOffset: value => scrolls.push(value) }) }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const root = () => renderer.root;
  const scroll = () => root().findAllByType('FlashList')[0] ?? root().findByType('ScrollView');
  return {
    parsing, renders, writes, fetches, nav, snackbars, modals, reads, scrolls,
    list: () => root().findByType('FlashList'),
    expireNavigation: async () => { await act(async () => {
      for (const [id, callback] of [...navigationTimers]) { navigationTimers.delete(id); callback(); }
    }); },
    measure: async (index, y, height) => {
      await act(async () => {
        engine.layouts.set(index, { x: 0, width: 400, y: y - engine.header, height, isHeightMeasured: true });
        if (engine.pending?.index === index) { engine.pending.resolve(); engine.pending = null; }
        scroll().props.onCommitLayoutEffect();
      }); },
    changeItem: async next => { item = { ...item, ...next }; await act(async () => renderer.update(tree())); },
    deferReads: (readItem, readBookmark) => { itemRead = readItem; bookmarkRead = readBookmark; },
    rejectSave: error => { saveError = error; },
    gesture: async () => { await act(async () => scroll().props.onScrollBeginDrag()); },
    output: () => output, commits: () => commits, text: () => JSON.stringify(renderer.toJSON(), (key, value) => ['refreshControl', 'ListHeaderComponent'].includes(key) ? undefined : value),
    update: async next => { args = next; await act(async () => renderer.update(tree())); },
    resize: async next => { width = next; await act(async () => renderer.update(tree())); },
    deferFetch: callback => { fetchReply = callback; },
    reply: next => { reply = next; }, fail: () => { fetchError = Error('Synthetic extraction failure'); },
    select: async next => { selection = next; await act(async () => { await poll(); }); },
    scroll: async y => { await act(async () => { if (engine) engine.y = y; scroll().props.onScroll({ nativeEvent: { contentOffset: { y } } }); }); },
    height: async h => { await act(async () => scroll().props.onContentSizeChange(400, h)); },
    viewport: async height => { await act(async () => scroll().props.onLayout({ nativeEvent: { layout: { height } } })); },
    bookmarkHandler: () => root().findAllByType('TopbarButton').find(n => n.findAllByType('MaterialIcons').some(i => i.props.name === 'bookmark-add'))?.props.onPress,
    menu: async title => {
      const entry = root().findByType('OverflowMenu').props.items.find(x => x.title === title);
      assert.ok(entry, `menu entry ${title}`); await act(async () => entry.onPress());
    },
    action: async label => {
      const button = root().findAllByType('Pressable').find(n => n.findAllByType('Text').some(x => x.props.children === label));
      assert.ok(button, `action ${label}`); await act(async () => button.props.onPress());
    },
    refresh: async () => { await act(async () => scroll().props.refreshControl.props.onRefresh()); },
    run: async action => { await act(async () => action()); },
  };
}

test('useArticle default retains Listen sentence text/quote modes and plain-text normalization', async t => {
  const h = await harness(t, { hookArgs: ['https://example.test', 'id', null, HTML] });
  assert.deepEqual(json(h.output().sentences), [
    { text: 'First sentence.', mode: 'primary' }, { text: 'Second sentence.', mode: 'primary' }, { text: 'Quoted words.', mode: 'quote' },
  ]);
  await h.update(['https://example.test', 'id', 'Curly “words”. Another sentence.', null]);
  assert.deepEqual(json(h.output().sentences), [
    { text: 'Curly "words".', mode: 'primary' }, { text: 'Another sentence.', mode: 'primary' },
  ]);
  assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0);
});

test('sentence demand skips parsing, toggles without fetching, and uses refreshed/archive content', async t => {
  const h = await harness(t);
  assert.equal(h.output().state.kind, 'ready'); assert.equal(h.output().sentences, undefined);
  assert.deepEqual(h.parsing, { blocks: 0, splitBlocks: 0, splitText: 0 });
  const state = h.output().state, refresh = h.output().refresh;
  const args = ['https://example.test/article', 'article-1', null, HTML, null, false];
  await h.update([...args, true]);
  assert.equal(h.output().state, state); assert.equal(h.output().refresh, refresh);
  assert.equal(h.parsing.blocks, 1); assert.equal(h.output().sentences.length, 3);
  await h.update([...args, false]);
  await h.run(() => h.output().refresh());
  assert.equal(h.output().sentences, undefined); assert.equal(h.parsing.blocks, 1);
  h.reply({ title: 'Archive', html: '<blockquote>Archive quote.</blockquote>', recipe: RECIPE });
  await h.run(() => h.output().loadFrom('https://archive.test'));
  assert.equal(h.parsing.blocks, 1); assert.equal(h.output().refreshing, false);
  await h.update([...args, true]);
  assert.deepEqual(json(h.output().sentences), [{ text: 'Archive quote.', mode: 'quote' }]);
  assert.equal(h.fetches.length, 2); assert.equal(h.fetches[1].url, 'https://archive.test');
  assert.ok(h.writes.some(x => x[0] === 'recipe'));
  assert.equal(h.output().state.recipe.name, 'Soup');
});

test('disabled plain-text demand and error states never split', async t => {
  const h = await harness(t, { hookArgs: ['https://example.test', 'id', 'Plain sentence.', null, null, false, false] });
  assert.equal(h.parsing.splitText, 0);
  h.fail(); await h.run(() => h.output().refresh());
  assert.equal(h.output().state.kind, 'error'); assert.equal(h.output().refreshing, false);
  await h.update(['https://example.test', 'id', 'Plain sentence.', null, null, false, true]);
  assert.equal(h.output().sentences, undefined); assert.equal(h.parsing.splitText, 0);
});

test('native list is the only formatted scroller; no frame commits and a saved callback captures measured latest row', async t => {
  const h = await harness(t, { screen: true });
  const list = h.list().props;
  assert.equal(list.maxItemsInRecyclePool, 0); assert.equal(list.drawDistance, 500);
  assert.equal(list.maintainVisibleContentPosition.disabled, true);
  for (const prop of ['getItemLayout', 'initialScrollIndex', 'initialNumToRender', 'onScrollToIndexFailed', 'CellRendererComponent']) assert.equal(list[prop], undefined);
  await h.measure(0, 300, 200); await h.measure(1, 500, 400);
  await h.select({ start: 1, end: 12, length: 12 });
  const mark = h.bookmarkHandler(); assert.ok(mark);
  const commits = h.commits(), renders = h.renders.length;
  for (const y of [10, 100, 200, 350, 720]) await h.scroll(y);
  assert.equal(h.commits(), commits); assert.equal(h.renders.length, renders);
  await h.run(mark);
  assert.equal(h.writes.at(-1)[0], 'bookmark');
  const saved = h.writes.at(-1)[2]; assert.equal(saved.kind, 'article'); assert.equal(saved.offset, .55);
  assert.equal(saved.blockKey, list.data[1].key); assert.equal(h.reads.length, 1);
  assert.equal(h.snackbars.at(-1), 'Reading bookmark saved');
  await h.action('Bookmark'); assert.deepEqual(json(h.scrolls.slice(-2)), [{ index: 1 }, { offset: 720, animated: false, skipFirstItemOffset: true }]);
  await h.select(null); assert.equal(h.bookmarkHandler(), undefined);
  const count = h.writes.length; await h.run(mark);
  assert.equal(h.writes.length, count); assert.equal(h.modals.at(-1).title, 'Select text first');
});

async function freshDeepBookmarkHarness(t) {
  const html = Array.from({ length: 1000 }, (_, i) => `<p>Row ${i} with a <a href="https://example.test/${i}">link</a>.</p>`).join('');
  const h = await harness(t, { screen: true, item: { article_html: html } });
  await h.measure(0, 300, 200); await h.scroll(350); await h.select({ start: 1, end: 3, length: 3 });
  await h.run(h.bookmarkHandler());
  const saved = { ...h.writes.at(-1)[2], blockKey: h.list().props.data[950].key, offset: .5 };
  h.deferReads(undefined, async () => saved);
  await h.changeItem({ id: 'reopened-article' });
  return h;
}

test('fresh deep bookmark delegates precise acquisition to the engine with no remount, then follows measured late layouts', async t => {
  const h = await freshDeepBookmarkHarness(t), old = h.list();
  const renders = h.renders.length;
  await h.action('Bookmark');
  assert.equal(h.list(), old, 'no seeded list remount');
  assert.deepEqual(json(h.scrolls.at(-1)), { index: 950 });
  assert.equal(h.renders.length - renders, 3, 'mock engine engages only a bounded destination window');
  await h.measure(950, 20000, 800); assert.deepEqual(json(h.scrolls.at(-1)), { offset: 20400, animated: false, skipFirstItemOffset: true });
  await h.height(23000); assert.equal(h.scrolls.at(-1).offset, 20400);
  await h.measure(950, 20200, 1200); assert.equal(h.scrolls.at(-1).offset, 20800);
  const count = h.scrolls.length; await h.gesture(); await h.measure(950, 20300, 1400); await h.height(24000);
  await h.expireNavigation(); assert.equal(h.scrolls.length, count);
  assert.doesNotMatch(h.snackbars.at(-1), /Couldn't reach/);
});

test('unacquired deep bookmark surfaces snackbar once; gesture, geometry change and unmount cancel acquisition', async t => {
  const h = await freshDeepBookmarkHarness(t);
  await h.action('Bookmark'); await h.expireNavigation();
  assert.match(h.snackbars.at(-1), /Couldn't reach this reading bookmark/);
  const count = h.snackbars.length; await h.expireNavigation(); assert.equal(h.snackbars.length, count);
  const scrolls = h.scrolls.length; await h.measure(950, 20000, 800); assert.equal(h.scrolls.length, scrolls);
  // Reopen a fresh list so the next request has no measured target.
  const stale = h.list().props;
  await h.resize(500); await h.action('Bookmark'); await h.gesture(); await h.expireNavigation();
  const afterCancel = h.scrolls.length;
  await h.measure(950, 20000, 800); assert.equal(h.scrolls.length, afterCancel);
  await h.run(() => {
    stale.onLoad(); stale.onCommitLayoutEffect(); stale.onContentSizeChange(400, 25000);
    stale.onScroll({ nativeEvent: { contentOffset: { y: 99999 } } }); stale.onScrollBeginDrag();
  });
  assert.equal(h.scrolls.length, afterCancel, 'disposed list callbacks cannot revive acquisition');
  assert.equal(h.snackbars.length, count);
  await h.action('Bookmark'); await h.resize(600); await h.expireNavigation(); assert.equal(h.snackbars.length, count);
  await h.action('Bookmark'); await h.menu('Show plain text'); await h.expireNavigation(); assert.equal(h.snackbars.length, count);
});

test('formatted rows skip selection/layout updates and retain shared config on geometry reset', async t => {
  const h = await harness(t, { screen: true });
  const initial = h.renders.at(-1), count = h.renders.length;
  assert.equal(initial.defaultTextProps.selectable, true);
  await h.select({ start: 0, end: 5, length: 5 }); await h.height(2000);
  await h.select(null);
  assert.equal(h.renders.length, count);
  assert.deepEqual(h.parsing, { blocks: 0, splitBlocks: 0, splitText: 0 });
  await h.resize(800);
  const resized = h.renders.at(-1); assert.equal(h.renders.length, count * 2);
  assert.equal(resized.contentWidth - initial.contentWidth, 400);
  for (const prop of ['baseStyle', 'tagsStyles', 'systemFonts', 'defaultTextProps']) assert.equal(resized[prop], initial[prop], prop);
  await h.refresh();
  assert.notEqual(h.renders.at(-1).source, initial.source);
  assert.match(h.renders.at(-1).source.html, /Fresh first/);
  assert.equal(h.parsing.blocks, 0); assert.equal(h.fetches.length, 1);
});

test('plain/raw/split toggles, refresh, extraction/archive and Listen preserve their behavior', async t => {
  const h = await harness(t, { screen: true });
  await h.menu('Show plain text'); assert.doesNotMatch(h.text(), /RenderedHtml/);
  assert.match(h.text(), /First sentence/); assert.equal(h.parsing.blocks, 0);
  await h.menu('Split by sentence'); assert.equal(h.parsing.blocks, 1);
  assert.match(h.text(), /italic/); assert.match(h.text(), /Quoted words/);
  await h.menu('Show raw HTML'); assert.match(h.text(), /<blockquote>/);
  await h.menu('Hide raw HTML'); assert.match(h.text(), /italic/);
  await h.menu('Unsplit sentences'); await h.menu('Show formatted');
  assert.match(h.text(), /RenderedHtml/);
  await h.menu('Aggressive extraction'); assert.equal(h.fetches.at(-1).options.useLargestTextBlock, true);
  await h.menu('Load from archive.is'); assert.match(h.fetches.at(-1).url, /^https:\/\/archive.is\//);
  await h.action('Listen'); assert.deepEqual(h.nav, ['/listen/article-1']);
  await h.menu('Split by sentence');
  // Raw mode without HTML must still fall back to split text after refresh.
  await h.menu('Show raw HTML'); h.reply({ title: null, html: null, recipe: null });
  await h.refresh(); assert.doesNotMatch(h.text(), /RenderedHtml/);
  assert.equal(h.parsing.splitText, 0); // Empty text has no sentences, as before.
});

test('URL articles without HTML defer plain-text splitting until requested', async t => {
  const h = await harness(t, { screen: true, item: { article_html: null, article_text: 'Plain first. Plain second.' } });
  assert.equal(h.parsing.splitText, 0); assert.match(h.text(), /Plain first/);
  await h.menu('Split by sentence');
  assert.equal(h.parsing.splitText, 1); assert.match(h.text(), /Plain second/);
  assert.equal(h.fetches.length, 0); assert.equal(h.writes.length, 0);
  await h.menu('Unsplit sentences'); assert.equal(h.parsing.splitText, 1);
});

test('recipe and standalone text still render with their actions', async t => {
  const recipe = await harness(t, { screen: true, item: { recipe_json: JSON.stringify(RECIPE) } });
  assert.match(recipe.text(), /Soup|Boil water/); assert.doesNotMatch(recipe.text(), /RenderedHtml/);
  assert.equal(recipe.parsing.blocks, 0);
  await recipe.menu('Convert volumes to metric'); assert.match(recipe.text(), /metric 1 cup water/);
  await recipe.action('Listen'); assert.deepEqual(recipe.nav, ['/listen/article-1']);
  const text = await harness(t, { screen: true, item: { type: 'text', uri: 'Standalone note.', article_html: null } });
  assert.match(text.text(), /Standalone note/); assert.equal(text.renders.length, 0);
  await text.action('Listen'); assert.deepEqual(text.nav, ['/listen/article-1']);
});

test('separate plain bookmark restores mode before fraction, follows image layout, then cancels on gesture/width', async t => {
  const h = await harness(t, { screen: true, item: { listened_percent: 61 } });
  await h.menu('Show plain text'); await h.viewport(600); await h.height(1600);
  await h.select({ start: 1, end: 3, length: 3 }); const save = h.bookmarkHandler();
  const commits = h.commits(); await h.scroll(720); assert.equal(h.commits(), commits);
  await h.run(save);
  assert.deepEqual(json(h.writes.at(-1)), ['bookmark', 'article-1', { version: 1, kind: 'scroll', mode: 'plain', fraction: .72 }]);
  assert.match(h.text(), /61% listened/);
  await h.menu('Show formatted'); await h.action('Bookmark');
  assert.doesNotMatch(h.text(), /RenderedHtml/);
  await h.viewport(600); await h.height(1600); assert.equal(h.scrolls.at(-1).y, 720);
  await h.height(2600); assert.equal(h.scrolls.at(-1).y, 1440);
  await h.gesture(); const count = h.scrolls.length; await h.height(3600); assert.equal(h.scrolls.length, count);
  await h.action('Bookmark'); await h.resize(500); const afterResize = h.scrolls.length;
  await h.height(4000); assert.equal(h.scrolls.length, afterResize);
});

test('article anchors restore through plain-mode transition, reject changed revision, cancel pending geometry work on resize', async t => {
  const h = await harness(t, { screen: true });
  await h.measure(0, 300, 200); await h.scroll(350); await h.select({ start: 1, end: 3, length: 3 });
  await h.run(h.bookmarkHandler()); await h.menu('Show plain text');
  await h.action('Bookmark'); assert.match(h.text(), /RenderedHtml/); assert.equal(h.list().props.initialScrollIndex, undefined);
  await h.measure(0, 400, 400); assert.equal(h.scrolls.at(-1).offset, 500);
  await h.gesture(); const afterGesture = h.scrolls.length;
  await h.measure(0, 450, 500); assert.equal(h.scrolls.length, afterGesture);
  await h.action('Bookmark');
  await h.resize(500); const count = h.scrolls.length; await h.measure(0, 500, 600); assert.equal(h.scrolls.length, count);
  await h.refresh(); await h.action('Bookmark'); assert.equal(h.scrolls.length, count);
  assert.match(h.snackbars.at(-1), /different article revision/);
});

test('item and bookmark loading races cannot leak a previous item or its navigation into a new screen', async t => {
  const h = await harness(t, { screen: true });
  let resolveItem, resolveBookmark;
  h.deferReads(() => new Promise(resolve => { resolveItem = resolve; }), () => new Promise(resolve => { resolveBookmark = resolve; }));
  await h.changeItem({ id: 'article-2', title: 'Second' });
  const oldItem = resolveItem, oldBookmark = resolveBookmark;
  await h.changeItem({ id: 'article-3', title: 'Third' });
  await h.run(async () => {
    resolveItem({ id: 'article-3', type: 'url', title: 'Third', uri: 'https://third.test', created_at: 1, article_html: HTML });
    resolveBookmark(null);
  });
  await h.run(async () => {
    oldItem({ id: 'article-2', type: 'url', title: 'Second', uri: 'https://second.test', created_at: 1 });
    oldBookmark({ version: 1, kind: 'scroll', mode: 'raw', fraction: .9 });
  });
  assert.match(h.text(), /Third/); assert.doesNotMatch(h.text(), /"Second"|https:\/\/second.test/);
  assert.match(h.text(), /RenderedHtml/); assert.equal(h.scrolls.length, 0);
  assert.doesNotMatch(h.text(), /"Bookmark"/);
});

test('actual useArticle suppresses stale initial/refresh/archive completions and obsolete callbacks across item changes', async t => {
  const h = await harness(t);
  let resolve;
  h.deferFetch(() => new Promise(done => { resolve = done; }));
  const oldRefresh = h.output().refresh, oldArchive = h.output().loadFrom;
  let work; await h.run(() => { work = oldRefresh(); });
  await h.update(['https://next.test', 'next', null, '<p>Next document.</p>', null, false, false]);
  await h.run(async () => { resolve({ title: 'Old', html: '<p>Wrong old document.</p>', recipe: RECIPE }); await work; });
  assert.match(h.output().state.html, /Next document/); assert.equal(h.output().refreshing, false); assert.equal(h.writes.length, 0);
  const fetches = h.fetches.length; await h.run(oldRefresh); await h.run(() => oldArchive('https://old.archive'));
  assert.equal(h.fetches.length, fetches);
  await h.run(() => { work = h.output().loadFrom('https://next.archive'); });
  const oldResolve = resolve;
  await h.update(['https://third.test', 'third', null, '<p>Third document.</p>', null, false, false]);
  await h.run(async () => { oldResolve({ title: 'Wrong archive', html: '<p>Wrong archive.</p>', recipe: null }); await work; });
  assert.match(h.output().state.html, /Third document/); assert.equal(h.writes.length, 0);
  // An initial fetch cannot overwrite a subsequent stored document either.
  await h.update(['https://fetch.test', 'fetch', null, null, null, false, false]); const initialResolve = resolve;
  await h.update(['https://stored.test', 'stored', null, '<p>Stored.</p>', null, false, false]);
  await h.run(async () => { initialResolve({ title: 'Late', html: '<p>Late.</p>', recipe: null }); });
  assert.match(h.output().state.html, /Stored/); assert.equal(h.writes.length, 0);
});
