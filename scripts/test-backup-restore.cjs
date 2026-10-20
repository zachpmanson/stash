// Root devshell: node --test scripts/test-backup-restore.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createNativeHarness } = require('./restore-test-harness.cjs');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function fixture(h, { seeded = true, media = false, configure } = {}) {
  const directory = new h.Directory(h.Paths.cache, 'selected-backup'); directory.create();
  const api = h.load('src/db/database.ts'), replica = h.load('src/db/syncReplica.ts');
  const db = await h.sqlite.openDatabaseAsync('stash.db', { useNewConnection: true }, directory.uri);
  await api.initSchema(db, false);
  await db.runAsync("INSERT INTO folders VALUES ('backup-folder', 'Backup', 'B', 1, 2, NULL, 'grid')");
  await db.runAsync("INSERT INTO items (id,type,uri,created_at) VALUES ('backup-only','text','backup content',1)");
  await db.runAsync("INSERT INTO item_folders VALUES ('backup-only','backup-folder',1)");
  if (media) {
    for (const nested of ['a', 'b']) {
      const file = new h.File(directory, 'stash', nested, 'same.jpg');
      file.create({ intermediates: true }); file.write(nested);
      await db.runAsync("INSERT INTO items (id,type,uri,thumbnail_path,created_at) VALUES (?,'image',?, 'file:///old/cache/missing.jpg',1)", nested, `file:///old/package/stash/${nested}/same.jpg`);
    }
  }
  let site;
  if (seeded) {
    await api.ensureCrsqliteLoaded(db); await replica.seedSyncReplicaOwned(db, true);
    await db.runAsync("INSERT INTO sync_items(id,type,content) VALUES ('tombstone','text','gone')");
    await db.runAsync("DELETE FROM sync_items WHERE id='tombstone'");
    site = (await db.getFirstAsync('SELECT hex(crsql_site_id()) AS id')).id;
  }
  if (configure) await configure(db);
  await api.closeTemporaryDatabase(db);
  const manifest = new h.File(directory, 'manifest.json'); manifest.create();
  manifest.write(JSON.stringify({ app: 'stash', format: 1, itemCount: media ? 3 : 1, folderCount: 1 }));
  return { directory, site, hash: digest(path.join(h.localPath(directory.uri), 'stash.db')) };
}
async function currentData(h) {
  return h.load('src/db/database.ts').withAppDb(async db => {
    await db.runAsync("INSERT INTO items(id,type,uri,created_at) VALUES ('current-unsynced','text','keep in rollback',1)");
  });
}

test('actual backup restore builds fresh seeded identities, retains rollback/media, persists read-only pending across reopen', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, { media: true }); await currentData(h);
    const existing = new h.File(h.Paths.document, 'stash', 'a', 'same.jpg'); existing.create({ intermediates: true }); existing.write('device variant');
    const api = h.load('src/db/database.ts'), backup = h.load('src/utils/backup.ts');
    const identities = [];
    for (let restore = 0; restore < 2; restore++) {
      const result = await backup.restoreBackup(source.directory.uri); assert.equal(result.recoveryPending, true);
      await api.withAppDb(async db => {
        identities.push((await db.getFirstAsync('SELECT hex(crsql_site_id()) AS id')).id);
        assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM crsql_tracked_peers')).n, 0);
        assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM sync_items WHERE id='tombstone'")).n, 0);
        assert.ok((await db.getAllAsync("SELECT * FROM crsql_changes WHERE cid='-1'")).length > 0);
        assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM sync_item_folders')).n, 1);
        assert.equal(await api.isRestorePendingOwned(db), true);
        assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM items WHERE id='current-unsynced'")).n, 0);
        for (const id of ['a','b']) {
          const item = await db.getFirstAsync('SELECT uri,thumbnail_path FROM items WHERE id=?', id);
          assert.equal(new h.File(item.uri).bytesSync().toString(), id); assert.equal(item.thumbnail_path, null);
        }
      });
      await assert.rejects(api.withAppDbMutation(async () => assert.fail('must not mutate')), /read-only/);
      await assert.rejects(h.load('src/db/items.ts').updateItemTitle('backup-only', 'stale edit'), /read-only/);
      await assert.rejects(h.load('src/db/syncReplica.ts').prepareCurrentStashReplica(), /read-only/);
      await assert.rejects(api.withAppDb(db => h.load('src/db/syncReplica.ts').mirrorLocalItemOwned(db, 'backup-only')), /read-only/);
      // Close/reopen without any projection or exchange: marker must survive.
      await api.withAppDbReplacement(async () => {}, async db => assert.equal(await api.isRestorePendingOwned(db), true));
    }
    assert.notEqual(identities[0], source.site); assert.notEqual(identities[1], source.site); assert.notEqual(identities[0], identities[1]);
    await h.restart();
    await h.load('src/db/database.ts').withAppDb(async db => assert.equal(await h.load('src/db/database.ts').isRestorePendingOwned(db), true));
    await assert.rejects(h.load('src/db/items.ts').deleteItem('backup-only'), /read-only/);
    assert.equal(existing.bytesSync().toString(), 'device variant');
    assert.equal(digest(path.join(h.localPath(source.directory.uri), 'stash.db')), source.hash);
    const rollbacks = new h.Directory(h.Paths.document).list().filter(entry => entry.name.startsWith('stash-rollback-'));
    assert.equal(rollbacks.length, 2);
    const old = await h.sqlite.openDatabaseAsync('stash.db', {}, rollbacks[0].uri);
    assert.equal((await old.getFirstAsync("SELECT uri FROM items WHERE id='current-unsynced'")).uri, 'keep in rollback');
    await old.closeAsync();
    assert.ok(h.events.filter(event => event.startsWith('finalize:')).length >= 6);
  } finally { await h.cleanup(); }
});

test('local-only restore uses fresh local DB without CRR identity, normal offline mutations remain enabled', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, { seeded: false }); await currentData(h);
    assert.equal((await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri)).recoveryPending, false);
    await h.load('src/db/items.ts').updateItemTitle('backup-only', 'offline editing');
    await h.load('src/db/database.ts').withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT title FROM items WHERE id='backup-only'")).title, 'offline editing');
      assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='crsql_site_id'")).n, 0);
      assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM folders WHERE id='inbox'")).n, 0);
    });
  } finally { await h.cleanup(); }
});

for (const [name, configure, expected] of [
  ['partial CRR', db => db.execAsync('DROP TABLE sync_items__crsql_clock'), /Partial|unsupported/i],
  ['newer app schema', db => db.execAsync('ALTER TABLE items ADD COLUMN future_column TEXT'), /Unsupported/],
  ['newer CRR schema', db => db.execAsync('ALTER TABLE sync_items ADD COLUMN future_column TEXT'), /Unsupported/],
  ['unknown seed', db => db.runAsync("UPDATE stash_sync_metadata SET value='99' WHERE key='stash_sync_seed_version'"), /Unsupported/],
  ['nonzero config', db => db.execAsync("SELECT crsql_config_set('merge-equal-values',1)"), /merge-equal-values/],
  ['unsafe media', db => db.runAsync("UPDATE items SET uri='file:///old/stash/a/../bad.jpg' WHERE id='a'"), /Unsafe/],
  ['missing media', db => db.runAsync("UPDATE items SET uri='file:///old/stash/missing.jpg' WHERE id='a'"), /unavailable/],
]) test(`staging rejection: ${name}; source and current database remain intact/usable`, async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, { media: true, configure }); await currentData(h);
    await assert.rejects(h.load('src/utils/backup.ts').restoreBackup(source.directory.uri), expected);
    await h.load('src/db/database.ts').withAppDb(async db => assert.equal((await db.getFirstAsync("SELECT uri FROM items WHERE id='current-unsynced'")).uri, 'keep in rollback'));
    assert.equal(digest(path.join(h.localPath(source.directory.uri), 'stash.db')), source.hash);
    assert.equal(new h.File(h.Paths.document, 'stash-restore-install.json').exists, false);
    const stagedHandles = h.handles.filter(db => db.databasePath.includes('/cache/stash-restore-'));
    assert.equal(stagedHandles.length, h.events.filter(event => event.startsWith('close:') && event.includes('/cache/stash-restore-')).length);
  } finally { await h.cleanup(); }
});

for (const phase of ['prepare', 'install', 'reopen']) test(`${phase} interruption retains rollback; post-close failures fail closed`, async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h); await currentData(h);
    if (phase === 'prepare') h.options.writeFailure = uri => uri.includes('/install/stash.db');
    if (phase === 'install') h.options.copyFailure = uri => uri.endsWith('/document/SQLite/stash.db');
    if (phase === 'reopen') h.options.openFailure = file => file.endsWith('/document/SQLite/stash.db');
    await assert.rejects(h.load('src/utils/backup.ts').restoreBackup(source.directory.uri), /injected.*Private pre-restore rollback/);
    const api = h.load('src/db/database.ts');
    if (phase === 'prepare') await api.withAppDb(async db => assert.ok(await db.getFirstAsync("SELECT * FROM items WHERE id='current-unsynced'")));
    else {
      await assert.rejects(api.withAppDb(async () => assert.fail()), /injected/);
      await h.restart();
      await assert.rejects(h.load('src/db/database.ts').withAppDb(async () => assert.fail()), /interrupted restore/);
    }
    assert.equal(new h.File(h.Paths.document, 'stash-restore-install.json').exists, phase !== 'prepare');
    assert.ok(new h.Directory(h.Paths.document).list().some(entry => entry.name.startsWith('stash-rollback-')));
    assert.equal(digest(path.join(h.localPath(source.directory.uri), 'stash.db')), source.hash);
  } finally { await h.cleanup(); }
});


test('current-only media resources survive replacement without unioning current CRR/app history; remote-only missing bytes stay deferred', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h);
    const file = new h.File(h.Paths.document,'stash','device.jpg'); file.create({intermediates:true}); file.write('device bytes');
    const api = h.load('src/db/database.ts'), replica = h.load('src/db/syncReplica.ts');
    await api.withAppDb(async db => {
      await db.runAsync("INSERT INTO items(id,type,uri,created_at) VALUES ('device-media','image',?,1)",file.uri);
      await db.runAsync("INSERT INTO folders VALUES ('backup-folder','Current','C',1,999,NULL,'list')");
    });
    await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri);
    await api.withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT last_used_at FROM folders WHERE id='backup-folder'")).last_used_at,999);
      assert.equal(await db.getFirstAsync("SELECT * FROM items WHERE id='device-media'"),null);
      assert.equal(await db.getFirstAsync("SELECT * FROM sync_items WHERE id='device-media'"),null);
    });
    // A backup made while recovery is pending must preserve these unprojected
    // resource mappings across yet another fresh identity/install.
    const pendingBackup = await h.load('src/utils/backup.ts').createBackup();
    await h.load('src/utils/backup.ts').restoreBackup(pendingBackup);
    await api.withAppDb(async db => {
      // Model these replicated server rows arriving, not old app projections being seeded.
      await db.runAsync("INSERT INTO sync_items(id,type,media_id) VALUES ('device-media','image','device-media'), ('remote-missing','image','remote-missing')");
      await replica.markSyncSnapshotCompleteOwned(db); await replica.projectSyncReplicaToLocalOwned(db);
      const restoredUri = (await db.getFirstAsync("SELECT uri FROM items WHERE id='device-media'")).uri;
      assert.equal(new h.File(restoredUri).bytesSync().toString(),'device bytes');
      assert.equal(await db.getFirstAsync("SELECT * FROM items WHERE id='remote-missing'"),null);
      assert.ok(await db.getFirstAsync("SELECT * FROM sync_items WHERE id='remote-missing'"));
    });
    assert.equal(file.bytesSync().toString(),'device bytes');
  } finally { await h.cleanup(); }
});

test('unsupported active config rejects before closure and leaves the source/current state intact', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h); await currentData(h);
    const api = h.load('src/db/database.ts');
    await api.withAppDb(async db => {
      await api.ensureCrsqliteLoaded(db); await h.load('src/db/syncReplica.ts').seedSyncReplicaOwned(db,false);
      await db.execAsync("SELECT crsql_config_set('merge-equal-values',1)");
    });
    await assert.rejects(h.load('src/utils/backup.ts').restoreBackup(source.directory.uri),/merge-equal-values/);
    await api.withAppDb(async db => assert.ok(await db.getFirstAsync("SELECT * FROM items WHERE id='current-unsynced'")));
    assert.equal(digest(path.join(h.localPath(source.directory.uri),'stash.db')),source.hash);
  } finally { await h.cleanup(); }
});

test('projection failure rolls back app view and preserves pending across restart', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, { configure: db => db.runAsync("UPDATE sync_items SET type='unsupported' WHERE id='backup-only'") });
    await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri);
    const api = h.load('src/db/database.ts'), replica = h.load('src/db/syncReplica.ts');
    await api.withAppDb(async db => {
      await replica.markSyncSnapshotCompleteOwned(db);
      await assert.rejects(replica.projectSyncReplicaToLocalOwned(db),/unsupported item type/);
      assert.equal(await api.isRestorePendingOwned(db),true);
      assert.equal((await db.getFirstAsync("SELECT type FROM items WHERE id='backup-only'")).type,'text');
    });
    await h.restart();
    await h.load('src/db/database.ts').withAppDb(async db => assert.equal(await h.load('src/db/database.ts').isRestorePendingOwned(db),true));
  } finally { await h.cleanup(); }
});


test('URI-encoded safe nested paths retain distinct readable names', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, { media: true });
    const file = new h.File(source.directory, 'stash', 'a', 'stash', 'encoded % name.jpg'); file.create({intermediates:true}); file.write('encoded bytes');
    const db = await h.sqlite.openDatabaseAsync('stash.db', {}, source.directory.uri);
    await db.runAsync("UPDATE items SET uri='file:///old/stash/a/stash/encoded%20%25%20name.jpg' WHERE id='a'");
    await db.closeAsync();
    await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri);
    await h.load('src/db/database.ts').withAppDb(async db => {
      const item = await db.getFirstAsync("SELECT uri FROM items WHERE id='a'");
      assert.equal(new h.File(item.uri).bytesSync().toString(),'encoded bytes');
    });
  } finally { await h.cleanup(); }
});

for (const invalid of ['manifest','database']) test(`invalid ${invalid} leaves source/current state untouched`, async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, {seeded:false}); await currentData(h);
    if (invalid === 'manifest') new h.File(source.directory,'manifest.json').write('{bad JSON');
    else new h.File(source.directory,'stash.db').delete();
    await assert.rejects(h.load('src/utils/backup.ts').restoreBackup(source.directory.uri));
    await h.load('src/db/database.ts').withAppDb(async db => assert.ok(await db.getFirstAsync("SELECT * FROM items WHERE id='current-unsynced'")));
    assert.equal(new h.File(source.directory,'manifest.json').exists,true);
  } finally { await h.cleanup(); }
});


test('supported local-only migrations do not require original SQLite column ordering', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, {seeded:false, configure: db => db.execAsync('ALTER TABLE folders DROP COLUMN icon')});
    assert.equal((await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri)).recoveryPending,false);
    await h.load('src/db/database.ts').withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT icon FROM folders WHERE id='backup-folder'")).icon,'📁');
    });
    assert.equal(digest(path.join(h.localPath(source.directory.uri),'stash.db')),source.hash);
  } finally { await h.cleanup(); }
});

for (const build of [
  { dev: false, optIn: false, platform: 'android' },
  { dev: false, optIn: true, platform: 'ios' },
  { dev: true, optIn: false, platform: 'web' },
]) test(`seeded restore rejects unsupported build before touching active sync/DB/media: ${JSON.stringify(build)}`, async () => {
  const h = await createNativeHarness();
  let sync;
  try {
    const source = await fixture(h); await currentData(h);
    const api = h.load('src/db/database.ts');
    await api.withAppDb(async db => { await api.ensureCrsqliteLoaded(db); await h.load('src/db/syncReplica.ts').seedSyncReplicaOwned(db, false); });
    Object.assign(h.options, build);
    let stops = 0;
    h.options.createSyncedDB = async config => { const replica = await config.dbProvider(); return { start: async () => {}, stop() { stops++; replica.close(false); } }; };
    // Keep the status poll pending, but abortable, so restore cannot incidentally project.
    h.options.fetch = async (url, { signal }) => url.pathname.endsWith('/healthz') ? { ok: true, json: async () => ({ schema: h.load('src/db/syncReplica.ts').SYNC_CRR_SCHEMA_NAME, schemaVersion: h.load('src/db/syncReplica.ts').SYNC_CRR_SCHEMA_VERSION.toString() }) } : new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
    sync = h.load('src/db/syncClient.ts');
    await sync.connectStashSync('http://localhost/', { username: 'x', password: 'x' });
    const media = new h.File(h.Paths.document, 'stash', 'keep.jpg'); media.create({ intermediates: true }); media.write('unchanged');
    const before = await api.withAppDb(async db => Buffer.from(await db.serializeAsync()));
    const closes = h.events.filter(event => event.includes('/document/SQLite') && event.startsWith('close:')).length;
    await assert.rejects(h.load('src/utils/backup.ts').restoreBackup(source.directory.uri), /Android|android|opted-in/);
    assert.equal(stops, 0);
    assert.deepEqual(await api.withAppDb(async db => Buffer.from(await db.serializeAsync())), before);
    assert.equal(h.events.filter(event => event.includes('/document/SQLite') && event.startsWith('close:')).length, closes);
    assert.equal(media.bytesSync().toString(), 'unchanged');
    assert.equal(digest(path.join(h.localPath(source.directory.uri), 'stash.db')), source.hash);
    assert.equal(new h.Directory(h.Paths.document).list().some(entry => entry.name.startsWith('stash-rollback-')), false);
    assert.equal(new h.File(h.Paths.document, 'stash-restore-install.json').exists, false);
  } finally { if (sync) await sync.disconnectStashSyncAndWait(); await h.cleanup(); }
});

test('explicitly opted-in Android release supports seeded recovery; non-opt-in release supports local-only restore', async () => {
  for (const [seeded, platform] of [[false, 'android'], [false, 'ios'], [true, 'android']]) {
    const h = await createNativeHarness();
    try {
      const source = await fixture(h, { seeded });
      h.options.dev = false; h.options.optIn = seeded; h.options.platform = platform;
      assert.equal((await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri)).recoveryPending, seeded);
    } finally { await h.cleanup(); }
  }
});

test('native copy avoids JS media buffers and refuses collisions without changing bytes; failures propagate', async () => {
  const h = await createNativeHarness();
  try {
    const source = await fixture(h, { media: true });
    const backup = h.load('src/utils/backup.ts', '\nexport { copyFileContents };');
    h.options.noBytes = true;
    await backup.restoreBackup(source.directory.uri);
    await backup.createBackup();
    assert.ok(h.events.some(event => event.startsWith('copy:')));
    const src = new h.File(source.directory, 'stash', 'a', 'same.jpg'), dest = new h.File(h.Paths.cache, 'collision.jpg');
    dest.create(); dest.write('keep');
    assert.throws(() => backup.copyFileContents(src, dest), /overwrite/);
    assert.equal(fs.readFileSync(h.localPath(dest.uri), 'utf8'), 'keep');
    dest.delete(); h.options.copyFailure = () => true;
    assert.throws(() => backup.copyFileContents(src, dest), /injected copy/);
    assert.equal(dest.exists, false);
  } finally { await h.cleanup(); }
});

test('actual settings hydration repairs commit-before-callback restart; ordinary offline change survives another restart', async () => {
  const h = await createNativeHarness({ actualSettings: true });
  try {
    const source = await fixture(h);
    h.storage.set('settings-state', JSON.stringify({ state: { auRecipe: false }, version: 0 }));
    await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri);
    const api = h.load('src/db/database.ts'), replica = h.load('src/db/syncReplica.ts');
    await api.withAppDb(async db => {
      await replica.markSyncSnapshotCompleteOwned(db); await replica.projectSyncReplicaToLocalOwned(db);
      assert.equal(await api.isRestorePendingOwned(db), false);
      assert.equal((await db.getFirstAsync("SELECT value FROM stash_sync_metadata WHERE key='projected_au_recipe'")).value, '1');
    }); // Process stops here, before syncClient updates Zustand/AsyncStorage.
    await h.restart();
    let release; h.options.hydrationGate = new Promise(resolve => { release = resolve; });
    let settings = h.load('src/state/settingsState.ts');
    const init = settings.initializeSettingsFromDatabase();
    assert.equal(init, settings.initializeSettingsFromDatabase()); // no duplicate hydration/DB writes
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settings.useSettingsStore.getState().auRecipe, false);
    release(); await init; delete h.options.hydrationGate;
    assert.equal(settings.useSettingsStore.getState().auRecipe, true);
    assert.equal(JSON.parse(h.storage.get('settings-state')).state.auRecipe, true);
    await settings.changeAuRecipeSetting(false);
    assert.equal(settings.useSettingsStore.getState().auRecipe, false);
    await h.restart(); settings = h.load('src/state/settingsState.ts');
    await settings.initializeSettingsFromDatabase();
    assert.equal(settings.useSettingsStore.getState().auRecipe, false);
    assert.equal(JSON.parse(h.storage.get('settings-state')).state.auRecipe, false);
    await h.load('src/db/database.ts').withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT value FROM stash_sync_metadata WHERE key='projected_au_recipe'")).value, '0');
      assert.equal((await db.getFirstAsync("SELECT au_recipe FROM sync_user_settings WHERE id='local-user'")).au_recipe, 0);
    });
  } finally { await h.cleanup(); }
});

test('hydration reads authoritative metadata after waiting, not a stale projection captured before hydration', async () => {
  const h = await createNativeHarness({ actualSettings: true });
  try {
    const source = await fixture(h); await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri);
    const api = h.load('src/db/database.ts'), replica = h.load('src/db/syncReplica.ts');
    await api.withAppDb(async db => { await replica.markSyncSnapshotCompleteOwned(db); await replica.projectSyncReplicaToLocalOwned(db); });
    h.storage.set('settings-state', JSON.stringify({ state: { auRecipe: true }, version: 0 }));
    let release; h.options.hydrationGate = new Promise(resolve => { release = resolve; });
    const settings = h.load('src/state/settingsState.ts'), init = settings.initializeSettingsFromDatabase();
    await replica.mirrorAuRecipeSetting(false); // a newer DB commit while hydration is waiting
    release(); await init;
    assert.equal(settings.useSettingsStore.getState().auRecipe, false);
    const writes = [];
    const unsubscribe = settings.useSettingsStore.subscribe(state => writes.push(state.auRecipe));
    await Promise.all([settings.changeAuRecipeSetting(true), settings.changeAuRecipeSetting(false)]);
    unsubscribe(); assert.deepEqual(writes, [true, false]);
    assert.equal(JSON.parse(h.storage.get('settings-state')).state.auRecipe, false);
  } finally { await h.cleanup(); }
});

test('ordinary settings mutation boundary cannot change the hydrated store or SQLite during pending recovery', async () => {
  const h = await createNativeHarness({ actualSettings: true });
  try {
    const source = await fixture(h); await h.load('src/utils/backup.ts').restoreBackup(source.directory.uri);
    h.storage.set('settings-state', JSON.stringify({ state: { auRecipe: false }, version: 0 }));
    const settings = h.load('src/state/settingsState.ts');
    await settings.initializeSettingsFromDatabase();
    await assert.rejects(settings.changeAuRecipeSetting(true), /read-only/);
    assert.equal(settings.useSettingsStore.getState().auRecipe, false);
    assert.equal(JSON.parse(h.storage.get('settings-state')).state.auRecipe, false);
    await h.load('src/db/database.ts').withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT au_recipe FROM sync_user_settings WHERE id='local-user'")).au_recipe, 1);
      assert.equal(await db.getFirstAsync("SELECT value FROM stash_sync_metadata WHERE key='projected_au_recipe'"), null);
    });
  } finally { await h.cleanup(); }
});
