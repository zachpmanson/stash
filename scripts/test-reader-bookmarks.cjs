const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');
const { createNativeHarness } = require('./restore-test-harness.cjs');
const json = value => JSON.parse(JSON.stringify(value));
function load(file, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require, console, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const { chunkArticle } = load('src/utils/readerChunks.ts');
const { parseReaderBookmark } = load('src/utils/readerBookmark.ts');
const article = '<div id="readability-page-1"><article><div><p>One &amp; two <a href="/a"><em>linked</em><img src="a.jpg"></a> tail.</p><ul><li>First<ul><li>Nested</li></ul></li></ul><blockquote><p>Quote</p><p>Still quote</p></blockquote><table><tr><td>Cell</td></tr></table><pre> code\n  indent</pre><figure><a href="/b"><img src="b.jpg"></a><figcaption>Caption</figcaption></figure><div>Mixed <a href="/c">link</a><img src="c.jpg"> tail<p>Inner block</p></div><unknown><p>Unknown block</p><img src="d.jpg"></unknown><p>Last &lt;end&gt; &#169;</p></div></article></div>';
function signature(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  // Preserve exact semantic order of text, images and links, ignoring inter-block formatting whitespace.
  const result = [];
  function walk(node) {
    if (node.nodeType === 3) {
      if (result.at(-1)?.[0] === 'text') result.at(-1)[1] += node.textContent;
      else result.push(['text', node.textContent]);
    }
    if (node.nodeType === 1 && node.tagName === 'IMG') result.push(['image', node.getAttribute('src')]);
    if (node.nodeType === 1 && node.tagName === 'A') result.push(['link', node.getAttribute('href'), node.innerHTML]);
    for (const child of node.childNodes) walk(child);
  }
  walk(document.body); return result;
}

test('conservative chunks preserve mixed text/entities/links/image order and opaque semantic subtrees', () => {
  const doc = chunkArticle(article), joined = doc.blocks.map(block => block.html).join('');
  assert.equal(doc.blocks.length, 9);
  assert.deepEqual(signature(joined), signature(article));
  for (const tag of ['ul', 'blockquote', 'table', 'pre', 'figure', 'unknown']) {
    assert.equal(doc.blocks.filter(block => block.html.includes(`<${tag}`)).length, 1, tag);
  }
  assert.ok(doc.blocks.every(block => block.html.startsWith('<div id="readability-page-1"><article><div>')));
  assert.equal(new Set(doc.blocks.map(block => block.key)).size, doc.blocks.length);
  assert.deepEqual(json(chunkArticle(article)), json(doc));
  assert.notEqual(chunkArticle(article + 'revision').revision, doc.revision);
  assert.equal(chunkArticle('Text &amp; <a href="/inline">link<img src="inline.jpg"></a> tail').blocks.length, 1);
});

test('representative large wrapped article becomes many useful bounded rows, without splitting atomic figures', () => {
  const html = '<div id="readability-page-1"><article><section>' + Array.from({ length: 400 }, (_, i) =>
    `<p>Paragraph ${i} ${'text &amp; words '.repeat(30)}<a href="/${i}">link</a>.</p>` +
    (i % 10 === 0 ? `<figure><img src="${i}.jpg"><figcaption>Caption ${i}</figcaption></figure>` : '')).join('') + '</section></article></div>';
  const doc = chunkArticle(html);
  assert.equal(doc.blocks.length, 440); assert.ok(Math.max(...doc.blocks.map(block => block.html.length)) < 1000);
  assert.deepEqual(signature(doc.blocks.map(block => block.html).join('')), signature(html));
});

test('bookmark parser rejects malformed/versioned/nonfinite/unbounded/missing anchors and normalizes valid JSON', () => {
  const good = { version: 1, kind: 'article', revision: 'rev', blockKey: 'block', offset: .25 };
  assert.deepEqual(json(parseReaderBookmark(JSON.stringify({ ...good, extra: true }))), good);
  for (const value of [null, {}, { ...good, version: 2 }, { ...good, offset: -1 }, { ...good, offset: 2 }, { ...good, offset: null }, { ...good, blockKey: '' }, { ...good, revision: 'r'.repeat(257) }, { version: 1, kind: 'scroll', mode: 'formatted', fraction: .5 }])
    assert.equal(parseReaderBookmark(JSON.stringify(value)), null);
  assert.equal(parseReaderBookmark('{bad'), null);
  for (const mode of ['plain', 'raw', 'sentences', 'recipe']) assert.equal(parseReaderBookmark(JSON.stringify({ version: 1, kind: 'scroll', mode, fraction: 1 })).mode, mode);
});

function navigationHarness(blockCount = 20) {
  const timers = new Map(), layouts = new Map(), operations = []; let seq = 0, now = 0, y = 0, header = 300, visible = 0;
  const { ReaderNavigation } = load('src/utils/readerNavigation.ts', {
    setTimeout: (fn, delay) => { const id = ++seq; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const doc = chunkArticle(Array.from({ length: blockCount }, (_, i) => '<p>Block ' + i + '</p>').join(''));
  const calls = [];
  const list = {
    scrollToIndex: value => { calls.push(['index', value.index]); return new Promise((resolve, reject) => operations.push({ resolve, reject })); },
    scrollToOffset: value => { calls.push(['offset', value.offset]); assert.equal(value.skipFirstItemOffset, true); },
    getLayout: index => layouts.get(index), getFirstItemOffset: () => header,
    getAbsoluteLastScrollOffset: () => y, getFirstVisibleIndex: () => visible,
  };
  const navigation = new ReaderNavigation(doc, () => list, () => calls.push(['failure']));
  return { navigation, calls, doc, timers, operations,
    anchor: (index, offset) => ({ version: 1, kind: 'article', revision: doc.revision, blockKey: doc.blocks[index].key, offset }),
    measure: (index, y, height, measured = true) => { layouts.set(index, { x: 0, width: 400, y, height, isHeightMeasured: measured }); navigation.align(); },
    viewport: (index, offset) => { visible = index; y = offset; },
    header: value => { header = value; navigation.align(); },
    finish: async (index = operations.length - 1) => { operations[index].resolve(); await Promise.resolve(); },
    advance: milliseconds => { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

test('capture uses engine native-measured geometry and adds the actual header exactly once', async () => {
  const h = navigationHarness(), n = h.navigation;
  assert.equal(n.capture(), null); n.onLoad();
  h.measure(0, 0, 200); h.measure(1, 200, 800); h.viewport(0, 100);
  assert.deepEqual(json(n.capture()), h.anchor(0, 0));
  h.viewport(1, 700); assert.deepEqual(json(n.capture()), h.anchor(1, .25));
  assert.equal(n.restore(n.capture()), true); assert.deepEqual(h.calls, [['index', 1]]);
  await h.finish(); assert.deepEqual(h.calls.at(-1), ['offset', 700]);
  h.measure(1, 300, 1000); assert.deepEqual(h.calls.at(-1), ['offset', 850]);
  h.header(400); assert.deepEqual(h.calls.at(-1), ['offset', 950]);
  h.advance(10000); h.measure(1, 400, 1200); assert.deepEqual(h.calls.at(-1), ['offset', 1100]);
  h.measure(1, 400, 1200, false); assert.equal(n.capture(), null);
  n.cancel(); assert.equal(h.timers.size, 0);
});

test('cold deep restore waits for load and engine completion, never aligns provisional prefix estimates', async () => {
  const h = navigationHarness(1000), n = h.navigation;
  n.restore(h.anchor(950, .5)); assert.deepEqual(h.calls, []);
  n.onLoad(); assert.deepEqual(h.calls, [['index', 950]]);
  h.measure(950, 190000, 200, false); n.align(); assert.equal(h.calls.length, 1);
  h.measure(950, 20000, 600); assert.equal(h.calls.length, 1, 'engine acquisition owns the scroll');
  await h.finish(); assert.deepEqual(h.calls.at(-1), ['offset', 20600]);
  assert.equal(h.timers.size, 0);
  h.advance(10000); h.measure(950, 20200, 1000); assert.deepEqual(h.calls.at(-1), ['offset', 21000]);
  n.cancel(); const count = h.calls.length; h.measure(950, 20300, 1200); assert.equal(h.calls.length, count);
  h.viewport(949, 20400); h.measure(949, 20000, 200);
  assert.deepEqual(json(n.capture()), h.anchor(949, .5), 'backscroll captures the current row, not the restore target');
});

test('unacquired or unmeasured destinations fail once; late promises and layouts cannot revive them', async () => {
  for (const complete of [false, true]) {
    const h = navigationHarness(), n = h.navigation; n.onLoad();
    n.restore(h.anchor(19, .2)); h.measure(19, 2000, 200, false);
    if (complete) await h.finish();
    h.advance(4000); assert.deepEqual(h.calls, [['index', 19], ['failure']]);
    if (!complete) await h.finish();
    h.measure(19, 2200, 800); h.advance(10000); n.align(); assert.equal(h.calls.length, 2);
  }
});

test('cancel/dispose and superseding requests guard asynchronous completions and layout callbacks', async () => {
  const h = navigationHarness(), n = h.navigation; n.onLoad();
  n.restore(h.anchor(0, 0)); n.restore(h.anchor(19, 1));
  h.measure(0, 0, 200); h.measure(19, 2200, 800);
  await h.finish(0); assert.equal(h.calls.length, 2);
  await h.finish(1); assert.deepEqual(h.calls.at(-1), ['offset', 3300]);
  n.restore(h.anchor(15, .5)); n.cancel(); const cancelled = h.calls.length;
  await h.finish(); h.measure(15, 2000, 200); h.advance(5000); assert.equal(h.calls.length, cancelled);
  n.restore(h.anchor(3, .7)); n.dispose(); const disposed = h.calls.length;
  await h.finish(); n.onLoad(); h.measure(3, 500, 500); h.advance(5000); assert.equal(h.calls.length, disposed);
  assert.equal(n.restore(h.anchor(0, 0)), false); assert.equal(n.capture(), null);
});

test('revision/anchor validation rejects unrelated jumps and engine rejection reports failure', async () => {
  const h = navigationHarness(), n = h.navigation; n.onLoad();
  for (const bad of [{ ...h.anchor(1, .5), revision: 'changed' }, { ...h.anchor(1, .5), blockKey: 'missing' }, { ...h.anchor(1, .5), offset: NaN }]) assert.equal(n.restore(bad), false);
  assert.equal(h.calls.length, 0); n.restore(h.anchor(10, .1));
  h.operations[0].reject(Error('engine failure')); await Promise.resolve();
  assert.deepEqual(h.calls, [['index', 10], ['failure']]); h.advance(5000); assert.equal(h.calls.length, 2);
});

test('actual bookmark DB API is independent of listening/sync, validates JSON, uses ownership and recovery guards', async () => {
  const h = await createNativeHarness();
  try {
    const dbApi = h.load('src/db/database.ts'), bookmarks = h.load('src/db/readerBookmarks.ts');
    await dbApi.withAppDb(async db => {
      await db.runAsync("INSERT INTO items(id,type,uri,created_at,listened_percent) VALUES ('article','url','https://example.test',1,73)");
      await dbApi.initSchema(db, false); // idempotent
    });
    const saved = { version: 1, kind: 'article', revision: 'rev', blockKey: 'key', offset: .2 };
    await bookmarks.saveReaderBookmark('article', saved);
    assert.deepEqual(json(await bookmarks.getReaderBookmark('article')), saved);
    await assert.rejects(bookmarks.saveReaderBookmark('article', { ...saved, offset: 99 }), /Invalid/);
    await dbApi.withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT listened_percent FROM items WHERE id='article'")).listened_percent, 73);
      assert.ok((await db.getFirstAsync("SELECT updated_at FROM reader_bookmarks WHERE item_id='article'")).updated_at > 0);
      await db.execAsync("CREATE TABLE stash_sync_metadata (key TEXT PRIMARY KEY, value TEXT); INSERT INTO stash_sync_metadata VALUES ('restore_merge_pending','1')");
    });
    await assert.rejects(bookmarks.saveReaderBookmark('article', { ...saved, offset: .9 }), /read-only/);
    assert.equal((await bookmarks.getReaderBookmark('article')).offset, .2);
    await dbApi.withAppDb(async db => { await db.runAsync("UPDATE reader_bookmarks SET bookmark_json='invalid' WHERE item_id='article'"); });
    assert.equal(await bookmarks.getReaderBookmark('article'), null);
    assert.equal(await bookmarks.getReaderBookmark('missing'), null);
  } finally { await h.cleanup(); }
});

for (const seeded of [false, true]) for (const old of [false, true]) test(`restore builder copies optional bookmarks: seeded=${seeded}, old=${old}`, async () => {
  const h = await createNativeHarness();
  try {
    const api = h.load('src/db/database.ts'), merge = h.load('src/db/restoreMerge.ts');
    const source = await h.sqlite.openDatabaseAsync('source.db', {}, h.Paths.cache);
    const fresh = await h.sqlite.openDatabaseAsync('fresh.db', {}, h.Paths.cache);
    await api.initSchema(source, false);
    await source.runAsync("INSERT INTO items(id,type,uri,created_at,listened_percent) VALUES ('article','url','https://example.test',1,73)");
    const saved = { version: 1, kind: 'article', revision: 'rev', blockKey: 'key', offset: .2 };
    await source.runAsync('INSERT INTO reader_bookmarks VALUES (?,?,?)', 'article', JSON.stringify(saved), 123);
    if (seeded) { await api.ensureCrsqliteLoaded(source); await h.load('src/db/syncReplica.ts').seedSyncReplicaOwned(source, false); }
    if (old) await source.execAsync('DROP TABLE reader_bookmarks');
    assert.equal((await merge.buildFreshRestoreOwned(source, fresh)).recoveryPending, seeded);
    const rows = await fresh.getAllAsync('SELECT * FROM reader_bookmarks');
    assert.equal(rows.length, old ? 0 : 1);
    if (!old) { assert.deepEqual(JSON.parse(rows[0].bookmark_json), saved); assert.equal(rows[0].updated_at, 123); }
    assert.equal((await fresh.getFirstAsync("SELECT listened_percent FROM items WHERE id='article'")).listened_percent, 73);
    if (seeded) assert.equal((await fresh.getAllAsync("SELECT * FROM crsql_changes WHERE \"table\"='reader_bookmarks'")).length, 0);
  } finally { await h.cleanup(); }
});

test('bookmark save prepared before queued database replacement is rejected under ownership', async () => {
  const h = await createNativeHarness();
  try {
    const api = h.load('src/db/database.ts'), bookmarks = h.load('src/db/readerBookmarks.ts');
    let release, entered;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const owner = api.withAppDb(async () => { entered(); await gate; });
    await enteredPromise;
    const replacement = api.withAppDbReplacement(async () => {}, async () => {});
    const save = bookmarks.saveReaderBookmark('article', { version: 1, kind: 'scroll', mode: 'plain', fraction: .5 });
    const rejected = assert.rejects(save, /data was replaced/);
    release(); await owner; await replacement; await rejected;
    assert.equal(await bookmarks.getReaderBookmark('article'), null);
  } finally { await h.cleanup(); }
});
