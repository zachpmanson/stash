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
  let width = 400, selection = null, poll, commits = 0;
  const modules = new Map(), renders = [], reads = [], writes = [], fetches = [], nav = [], snackbars = [], modals = [], scrolls = [];
  const parsing = { blocks: 0, splitBlocks: 0, splitText: 0 };
  let reply = { title: 'Refreshed', html: '<p>Fresh first. Fresh second.</p>', recipe: null };
  let fetchError;
  const recipeStore = { checked: {}, toggleChecked() {}, resetRecipe() {} };
  const mocks = {
    react: React,
    'react-native': {
      ...Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'RefreshControl', 'Image', 'ActivityIndicator'].map(x => [x, x])),
      StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width, height: 600 }),
      NativeModules: { TextSelection: { getSelection: async () => selection } }, findNodeHandle: () => 1,
      Linking: { openURL: async () => {} }, Share: { share: async () => {} },
    },
    'react-native-render-html': { __esModule: true, default: props => {
      renders.push(props); return React.createElement('RenderedHtml', props);
    } },
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
      getItemById: async id => { reads.push(id); return item; }, archiveItem: async () => {},
      updateItemListenedPercent: async (id, percent) => { writes.push(['bookmark', id, percent]); item = { ...item, listened_percent: percent }; },
      updateItemArticleHtml: async (...values) => writes.push(['html', ...values]),
      updateItemRecipeJson: async (...values) => writes.push(['recipe', ...values]),
    },
    '../utils/readability': {
      htmlToText: plain, findRecipe: () => null,
      htmlToBlocks: html => {
        parsing.blocks++;
        return [...html.matchAll(/<(p|blockquote)>(.*?)<\/\1>/g)].map(m => ({ text: m[2], mode: m[1] === 'blockquote' ? 'quote' : 'primary' }));
      },
      fetchArticle: async (url, options) => { fetches.push({ url, options }); if (fetchError) throw fetchError; return reply; },
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
      setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { poll = undefined; },
      require: spec => {
        if (spec in mocks) return mocks[spec];
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
  await act(async () => { renderer = create(tree(), { createNodeMock: () => ({ scrollTo: value => scrolls.push(value) }) }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const root = () => renderer.root;
  const scroll = () => root().findByType('ScrollView');
  return {
    parsing, renders, writes, fetches, nav, snackbars, modals, reads, scrolls,
    output: () => output, commits: () => commits, text: () => JSON.stringify(renderer.toJSON(), (key, value) => key === 'refreshControl' ? undefined : value),
    update: async next => { args = next; await act(async () => renderer.update(tree())); },
    resize: async next => { width = next; await act(async () => renderer.update(tree())); },
    reply: next => { reply = next; }, fail: () => { fetchError = Error('Synthetic extraction failure'); },
    select: async next => { selection = next; await act(async () => { await poll(); }); },
    scroll: async y => { await act(async () => scroll().props.onScroll({ nativeEvent: { contentOffset: { y } } })); },
    height: async h => { await act(async () => scroll().props.onContentSizeChange(400, h)); },
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

test('scroll does not commit React updates; a pre-scroll bookmark callback reads latest offset and clamps', async t => {
  const h = await harness(t, { screen: true });
  await h.height(1600);
  await h.select({ start: 1, end: 12, length: 12 });
  const mark = h.bookmarkHandler(); assert.ok(mark);
  const commits = h.commits(), renders = h.renders.length;
  for (const y of [10, 100, 200, 350, 720]) await h.scroll(y);
  assert.equal(h.commits(), commits); assert.equal(h.renders.length, renders);
  await h.run(mark);
  assert.deepEqual(h.writes.at(-1), ['bookmark', 'article-1', 72]);
  assert.equal(h.snackbars.at(-1), 'Bookmark saved at 72%');
  await h.scroll(5000); await h.run(mark); assert.equal(h.writes.at(-1)[2], 99);
  await h.scroll(-10); await h.run(mark); assert.equal(h.writes.at(-1)[2], 1);
  await h.height(500); await h.run(h.bookmarkHandler()); assert.equal(h.writes.at(-1)[2], 50);
  await h.select(null); assert.equal(h.bookmarkHandler(), undefined);
  const count = h.writes.length; await h.run(mark);
  assert.equal(h.writes.length, count); assert.equal(h.modals.at(-1).title, 'Select text first');
  await h.action('Bookmark'); assert.equal(h.scrolls.length, 1);
});

test('formatted renderer skips selection/layout updates and preserves source/config identities on resize', async t => {
  const h = await harness(t, { screen: true });
  const initial = h.renders.at(-1), count = h.renders.length;
  assert.equal(initial.defaultTextProps.selectable, true);
  await h.select({ start: 0, end: 5, length: 5 }); await h.height(2000);
  await h.select(null);
  assert.equal(h.renders.length, count);
  assert.deepEqual(h.parsing, { blocks: 0, splitBlocks: 0, splitText: 0 });
  await h.resize(800);
  const resized = h.renders.at(-1); assert.equal(h.renders.length, count + 1);
  assert.equal(resized.contentWidth - initial.contentWidth, 400);
  for (const prop of ['source', 'baseStyle', 'tagsStyles', 'systemFonts', 'defaultTextProps']) assert.equal(resized[prop], initial[prop], prop);
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
