// Run in the root devshell: node --test scripts/test-media-save-lifecycle.cjs
// Actual database/items/share/fileUtils code; native SQLite/filesystem/location
// and network are modeled in memory. No services, devices or real app data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console, URL, Uint8Array, DataView, setTimeout, clearTimeout,
    require: spec => {
      if (!(spec in mocks)) throw new Error(`Unexpected import ${spec} in ${file}`);
      return mocks[spec];
    },
  }, { filename });
  return module.exports;
}
function harness() {
  const files = new Map([['file:///source/image.jpg', 'source-image']]);
  const dirs = new Set(['file:///doc', 'file:///cache', 'file:///source']);
  const events = [], options = {};
  let rows = [], memberships = [], folders = new Set(['target']);
  let sequence = 0;
  const uriOf = parts => parts.map(part => typeof part === 'string' ? part : part.uri).join('/');
  class Directory {
    constructor(...parts) { this.uri = uriOf(parts); }
    get exists() { return dirs.has(this.uri); }
    create(opts = {}) {
      if (this.exists && !opts.idempotent) throw new Error('directory exists');
      dirs.add(this.uri);
    }
    delete() {
      events.push(`delete-dir:${this.uri}`);
      for (const uri of files.keys()) if (uri.startsWith(this.uri + '/')) files.delete(uri);
      for (const uri of dirs) if (uri === this.uri || uri.startsWith(this.uri + '/')) dirs.delete(uri);
    }
  }
  class File {
    constructor(...parts) { this.uri = uriOf(parts); }
    get exists() { return files.has(this.uri); }
    copy(dest) {
      if (!this.exists) throw new Error('source missing');
      events.push(`copy:${dest.uri}`);
      // Model a native API that CAN overwrite, so the production collision guard matters.
      files.set(dest.uri, files.get(this.uri));
      if (options.copyError && dest.uri.startsWith('file:///doc/stash/')) throw new Error('copy failed');
    }
    info() { return { exists: this.exists }; }
    delete() { events.push(`delete-file:${this.uri}`); files.delete(this.uri); }
    bytesSync() { return new Uint8Array([0, 1]); }
    static async downloadFileAsync(url, dest) {
      files.set(dest.uri, 'thumbnail');
      if (options.downloadGate) await options.downloadGate.promise;
      return dest;
    }
  }
  const filesystem = { Directory, File, Paths: { document: 'file:///doc', cache: 'file:///cache' } };
  const database = load('src/db/database.ts', {
    'expo-file-system': filesystem,
    'react-native': { Platform: { OS: 'android' } },
    'expo-sqlite': { openDatabaseAsync: async () => ({
      execAsync: async () => {}, getAllAsync: async () => [],
      getFirstAsync: async sql => sql.includes('metadata') ? null : { count: folders.size },
      closeAsync: async () => events.push('close'),
      runAsync: async (sql, args) => {
        if (sql.includes('INSERT INTO items')) {
          if (options.insertGate) await options.insertGate.promise;
          if (options.insertError) throw new Error('insert failed');
          if (rows.some(row => row.id === args[0])) throw new Error('duplicate item');
          rows.push({ id: args[0], type: args[1], uri: args[2], thumbnail_path: args[6] });
          events.push('insert');
        } else if (sql.includes('INSERT OR IGNORE INTO item_folders')) {
          if (!folders.has(args[1])) throw new Error('foreign key failed');
          memberships.push([args[0], args[1]]);
        } else if (sql.includes('UPDATE folders SET last_used_at') && options.updateError) {
          throw new Error('folder update failed');
        }
      },
      withTransactionAsync: async task => {
        const beforeRows = rows.slice(), beforeMemberships = memberships.slice();
        try { await task(); } catch (error) {
          rows = beforeRows; memberships = beforeMemberships; throw error;
        }
      },
    }) },
  });
  const items = load('src/db/items.ts', {
    './database': database,
    './syncReplica': { mirrorLocalItemOwned: async () => {}, mirrorLocalMembershipOwned: async () => {} },
  });
  const utils = load('src/utils/fileUtils.ts', { 'expo-file-system': filesystem });
  const exif = load('src/utils/exif.ts', { 'expo-file-system': filesystem });
  const shares = load('src/utils/shareHandler.ts', {
    'expo-file-system': filesystem, '../db/database': database, '../db/items': items,
    './fileUtils': utils, './exif': exif,
    './randomId': { randomId: () => options.fixedId || `id-${++sequence}` },
    'expo-location': {
      Accuracy: { Balanced: 1 },
      requestForegroundPermissionsAsync: async () => {
        events.push('permission');
        if (options.permissionGate) await options.permissionGate.promise;
        return { status: options.permissionStatus || 'granted' };
      },
      getCurrentPositionAsync: async () => ({ coords: { latitude: 1, longitude: 2 } }),
    },
    './linkPreview': { fetchLinkPreview: async () => {
      if (options.previewGate) await options.previewGate.promise;
      return { title: 'preview', description: null, favicon: null, image: options.previewImage };
    } },
    './readability': { fetchArticle: async () => {
      if (options.articleGate) await options.articleGate.promise;
      return { html: '<p>article</p>' };
    } },
  });
  return {
    database, items, shares, files, dirs, events, options,
    get rows() { return rows; }, get memberships() { return memberships; },
    replace: (restored = {}) => database.withAppDbReplacement(async () => {
      events.push('replace');
      new Directory('file:///doc/stash').delete();
      rows = []; memberships = []; folders = new Set(['target']); // target survives restore!
      for (const [uri, bytes] of Object.entries(restored)) files.set(uri, bytes);
    }, async () => {}),
    assertNoStaging: () => {
      assert.equal([...files.keys(), ...dirs].some(uri => uri.startsWith('file:///cache/stash-save-')), false);
    },
  };
}
const incoming = { shareType: 'image', contentUri: 'file:///source/image.jpg', contentMimeType: 'image/jpeg' };
const manual = { type: 'image', localUri: 'file:///source/image.jpg', mimeType: 'image/jpeg', captureLocation: true };
const startImage = (h, caller) => caller === 'share'
  ? h.shares.processAndSaveShare(incoming, ['target'], { captureLocation: true })
  : h.shares.saveManualItem(manual, ['target']);

for (const caller of ['share', 'manual']) {
  test(`${caller}: deferred permission allows replacement, then rejects stale save and cleans cache`, { timeout: 10000 }, async () => {
    const h = harness(), gate = deferred(); h.options.permissionGate = gate;
    const save = startImage(h, caller);
    await tick();
    assert.ok(h.events.includes('permission'));
    assert.equal([...h.files.keys()].some(uri => uri.startsWith('file:///doc/stash/')), false);
    await h.replace({ 'file:///doc/stash/id-1.jpg': 'restored-image' });
    const rejected = assert.rejects(save, /replaced while saving.*retry/);
    gate.resolve(); await rejected;
    assert.equal(h.rows.length, 0);
    assert.equal(h.files.get('file:///doc/stash/id-1.jpg'), 'restored-image');
    h.assertNoStaging();
    // Explicit retry gets the new generation and a live file.
    const retried = await startImage(h, caller);
    assert.equal(h.files.get(retried.uri), 'source-image');
    assert.equal(h.rows.length, 1);
  });

  test(`${caller}: ordinary successful image save has matching file, thumbnail and membership`, async () => {
    const h = harness(); const item = await startImage(h, caller);
    assert.equal(h.files.get(item.uri), 'source-image');
    assert.equal(item.thumbnail_path, item.uri);
    assert.equal(item.lat, 1);
    assert.equal(h.rows[0].uri, item.uri);
    assert.equal(h.memberships[0][1], 'target');
    h.assertNoStaging();
  });
}

test('promotion and insertion hold one ownership window; replacement cannot delete bytes mid-save', { timeout: 10000 }, async () => {
  const h = harness(), insert = deferred(); h.options.insertGate = insert;
  const save = startImage(h, 'manual'); await tick();
  assert.ok(h.files.has('file:///doc/stash/id-1.jpg'));
  const replacement = h.replace(); await tick();
  assert.equal(h.events.includes('replace'), false);
  insert.resolve();
  const item = await save;
  assert.ok(h.events.indexOf('insert') < h.events.indexOf('replace') || !h.events.includes('replace'));
  await replacement;
  assert.equal(h.rows.length, 0); // replacement consistently removed row AND file
  assert.equal(h.files.has(item.uri), false);
  h.assertNoStaging();
});

for (const failure of ['insertError', 'updateError', 'copyError']) {
  test(`${failure}: failed save rolls back row and removes only its newly promoted media`, async () => {
    const h = harness(); h.options[failure] = true;
    h.files.set('file:///doc/stash/existing.jpg', 'existing-image');
    await assert.rejects(startImage(h, 'manual'), /failed/);
    assert.equal(h.rows.length, 0);
    assert.equal(h.memberships.length, 0);
    assert.equal(h.files.has('file:///doc/stash/id-1.jpg'), false);
    assert.equal(h.files.get('file:///doc/stash/existing.jpg'), 'existing-image');
    h.assertNoStaging();
  });
}

test('same-name restored media is neither overwritten nor removed on failed save', async () => {
  const h = harness();
  await h.replace({ 'file:///doc/stash/id-1.jpg': 'restored-image' });
  await assert.rejects(startImage(h, 'share'), /already exists/);
  assert.equal(h.rows.length, 0);
  assert.equal(h.files.get('file:///doc/stash/id-1.jpg'), 'restored-image');
  assert.equal(h.events.includes('delete-file:file:///doc/stash/id-1.jpg'), false);
  h.assertNoStaging();
});

test('DB failure cleanup finishes under ownership before restore installs same-name media', async () => {
  const h = harness(), insert = deferred(); h.options.insertGate = insert; h.options.insertError = true;
  const save = startImage(h, 'share'); await tick();
  const replacement = h.replace({ 'file:///doc/stash/id-1.jpg': 'restored-image' });
  const rejected = assert.rejects(save, /insert failed/);
  insert.resolve(); await rejected; await replacement;
  assert.equal(h.files.get('file:///doc/stash/id-1.jpg'), 'restored-image');
  assert.ok(h.events.indexOf('delete-file:file:///doc/stash/id-1.jpg') < h.events.indexOf('replace'));
  h.assertNoStaging();
});

for (const phase of ['preview', 'article', 'download']) {
  for (const caller of ['share', 'manual']) {
    test(`${caller} URL: replacement during ${phase} rejects stale target and cleans thumbnail staging`, async () => {
      const h = harness(), gate = deferred(); h.options[`${phase}Gate`] = gate;
      h.options.previewImage = 'https://example.test/thumb.jpg';
      const save = caller === 'share'
        ? h.shares.processAndSaveShare({ shareType: 'url', value: 'https://example.test' }, ['target'])
        : h.shares.saveManualItem({ type: 'url', value: 'https://example.test' }, ['target']);
      await tick(); await h.replace();
      const rejected = assert.rejects(save, /replaced while saving/);
      gate.resolve(); await rejected;
      assert.equal(h.rows.length, 0);
      h.assertNoStaging();
    });
  }
}

for (const caller of ['share', 'manual', 'public']) {
  test(`${caller} text: queued pre-replacement save cannot commit into retained folder`, async () => {
    const h = harness(), gate = deferred();
    const owner = h.database.withAppDb(async () => gate.promise);
    const replacement = h.replace();
    const save = caller === 'share'
      ? h.shares.processAndSaveShare({ shareType: 'text', value: 'hello' }, ['target'])
      : caller === 'manual'
        ? h.shares.saveManualItem({ type: 'text', value: 'hello' }, ['target'])
        : h.items.saveItem({ id: 'direct', type: 'text', uri: 'hello' }, ['target']);
    const rejected = assert.rejects(save, /replaced while saving/);
    gate.resolve(); await owner; await replacement; await rejected;
    assert.equal(h.rows.length, 0); h.assertNoStaging();
  });
}

test('normal text, URL with thumbnail, incoming file and public API saves succeed', async () => {
  const h = harness();
  await h.shares.saveManualItem({ type: 'text', value: 'hello' }, ['target']);
  h.options.previewImage = 'https://example.test/thumb.jpg';
  const url = await h.shares.saveManualItem({ type: 'url', value: ' https://example.test ' }, ['target']);
  assert.equal(url.uri, 'https://example.test');
  assert.equal(h.files.get(url.thumbnail_path), 'thumbnail');
  const file = await h.shares.processAndSaveShare({ ...incoming, contentMimeType: 'application/pdf' }, ['target']);
  assert.equal(file.type, 'file'); assert.equal(file.thumbnail_path, null);
  assert.equal(h.files.get(file.uri), 'source-image');
  await h.items.saveItem({ id: 'direct', type: 'text', uri: 'direct' }, ['target']);
  assert.equal(h.rows.length, 4);
});

test('denied permission is not save cancellation; saves safely without GPS and cleans staging', async () => {
  const h = harness(); h.options.permissionStatus = 'denied';
  const item = await startImage(h, 'manual');
  assert.equal(item.lat, null); assert.equal(item.lng, null);
  assert.equal(h.files.get(item.uri), 'source-image'); h.assertNoStaging();
});

test('missing source leaves current files/DB untouched and cleans temporary directory', async () => {
  const h = harness(); h.files.delete('file:///source/image.jpg');
  await assert.rejects(startImage(h, 'share'), /source missing/);
  assert.equal(h.rows.length, 0); h.assertNoStaging();
});

test('failed URL DB save cleans downloaded thumbnail and its private staging', async () => {
  const h = harness(); h.options.previewImage = 'https://example.test/thumb.jpg'; h.options.insertError = true;
  await assert.rejects(h.shares.saveManualItem({ type: 'url', value: 'https://example.test' }, ['target']), /insert failed/);
  assert.equal(h.rows.length, 0); h.assertNoStaging();
});

test('cache directory collision fails without deleting unrelated existing bytes', async () => {
  const h = harness(); h.options.fixedId = 'collision';
  h.dirs.add('file:///cache/stash-save-collision');
  h.files.set('file:///cache/stash-save-collision/existing.jpg', 'existing-image');
  await assert.rejects(startImage(h, 'manual'), /directory exists/);
  assert.equal(h.rows.length, 0);
  assert.equal(h.files.get('file:///cache/stash-save-collision/existing.jpg'), 'existing-image');
  assert.equal(h.events.includes('delete-dir:file:///cache/stash-save-collision'), false);
});

test('replacement failure remains fail-closed and pending media preparation cleans up', async () => {
  const h = harness(), gate = deferred(); h.options.permissionGate = gate;
  const save = startImage(h, 'manual'); await tick();
  await assert.rejects(h.database.withAppDbReplacement(async () => { throw new Error('replace failed'); }, async () => {}), /replace failed/);
  const rejected = assert.rejects(save, /replace failed/);
  gate.resolve(); await rejected;
  await assert.rejects(h.database.withAppDb(async () => assert.fail('poisoned DB accessed')), /replace failed/);
  assert.equal(h.rows.length, 0); h.assertNoStaging();
  assert.equal([...h.files.keys()].some(uri => uri.startsWith('file:///doc/stash/')), false);
});
