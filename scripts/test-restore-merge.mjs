// Pinned native CRSQLite + actual changed backup/builder/app adapter + installed server DB adapter.
// Run: nix develop ./spikes/crsqlite-expo/server --command node --test scripts/test-restore-merge.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativeHarness } from './restore-test-harness.cjs';

for (const remoteOrigins of [false, true]) for (const inboundFirst of [false, true]) {
  test(`v3 backup -> old identity serverSeen4 -> actual fresh restore -> full merge/new upload; server origins=${remoteOrigins}, inbound first=${inboundFirst}`, async () => {
    const h = await createNativeHarness(); let server;
    try {
      const { internal } = await import(pathToFileURL(h.serverRequire.resolve('@vlcn.io/ws-server')));
      const api = h.load('src/db/database.ts'), replicaApi = h.load('src/db/syncReplica.ts');
      const { StashReplica } = h.load('src/db/syncClient.ts');
      const backupApi = h.load('src/utils/backup.ts');
      const schemaDirectory = path.join(h.root, 'server-schemas'); fs.mkdirSync(schemaDirectory);
      fs.writeFileSync(path.join(schemaDirectory, replicaApi.SYNC_CRR_SCHEMA_NAME), replicaApi.SYNC_SCHEMA_SQL);
      server = new internal.DB({ dbFolder: h.root, schemaFolder: schemaDirectory }, null, 'server', replicaApi.SYNC_CRR_SCHEMA_NAME, replicaApi.SYNC_CRR_SCHEMA_VERSION);
      assert.equal(server.getDB().prepare("SELECT crsql_config_get('merge-equal-values')").pluck().get(), 0);
      const identity = () => api.withAppDb(async db => (await db.getFirstAsync('SELECT crsql_site_id() AS id')).id);
      const adapter = async () => new StashReplica('app', await identity());
      const send = async replica => {
        const changes = await replica.pullChangeset(server.getLastSeen(replica.siteid), [server.siteId], false);
        if (changes.length) await server.applyChangesetAndSetLastSeen(changes, replica.siteid, [changes.reduce((v,c) => c[5] > v ? c[5] : v, 0n), 0]);
      };
      const receive = async replica => {
        const seen = (await replica.getLastSeens()).find(([site]) => Buffer.from(site).equals(Buffer.from(server.siteId)))?.[1] ?? [0n, 0];
        const changes = server.pullChangeset(seen, replica.siteid);
        if (changes.length) await replica.applyChangesetAndSetLastSeen(changes, server.siteId, [changes.reduce((v,c) => c[5] > v ? c[5] : v, 0n), 0]);
      };
      const exchange = async replica => {
        if (inboundFirst) { await receive(replica); await send(replica); }
        else { await send(replica); await receive(replica); }
        await send(replica); await receive(replica);
      };
      await api.withAppDb(async db => {
        await api.ensureCrsqliteLoaded(db); await replicaApi.seedSyncReplicaOwned(db, true); // version 1
        await db.runAsync("INSERT INTO sync_items(id,type,content) VALUES ('shared','text','alpha')"); // version 2
        await db.runAsync("INSERT INTO sync_items(id,type,content) VALUES ('server-deleted','text','stale live')"); // version 3
        assert.equal((await db.getFirstAsync('SELECT crsql_db_version() AS v')).v, 3);
      });
      const old = await adapter(); await send(old);
      if (remoteOrigins) {
        server.getDB().prepare("INSERT INTO sync_items(id,type,content) VALUES ('remote-before-backup','text','remote initial')").run();
        await receive(old);
        const snapshot = await api.withAppDb(db => h.load('src/db/restoreMerge.ts').exportRestoreChangesOwned(db));
        assert.ok(snapshot.some(row => Buffer.from(row.site_id).equals(Buffer.from(server.siteId))), 'saved snapshot must include filtered server origins');
      }
      const backup = await backupApi.createBackup();
      const oldSite = Buffer.from(old.siteid).toString('hex');
      const savedVersion = await api.withAppDb(async db => (await db.getFirstAsync('SELECT crsql_db_version() AS v')).v);
      await api.withAppDb(async db => {
        await db.runAsync("INSERT INTO sync_items(id,type,content) VALUES ('post-backup','text','must survive')");
        assert.equal((await db.getFirstAsync('SELECT crsql_db_version() AS v')).v, savedVersion + 1);
      });
      await send(old);
      assert.equal(Number(server.getLastSeen(old.siteid)[0]), savedVersion + 1);
      // A clone of the backup would reuse savedVersion+1 and be skipped here.
      server.getDB().prepare("DELETE FROM sync_items WHERE id='server-deleted'").run();
      server.getDB().prepare("INSERT INTO sync_items(id,type,content) VALUES ('server-only','text','new server row')").run();
      if (remoteOrigins) server.getDB().prepare("UPDATE sync_items SET content='new remote value' WHERE id='remote-before-backup'").run();
      // Real equal-clock unequal scalar value + identical values from another origin.
      const competitor = await h.sqlite.openDatabaseAsync('competitor.db', {}, h.Paths.cache);
      await api.ensureCrsqliteLoaded(competitor); await replicaApi.initializeEmptySyncReplicaOwned(competitor);
      await competitor.runAsync("INSERT INTO sync_items(id,type,content) VALUES ('shared','text','zulu')");
      const rows = await replicaApiExport(competitor, h);
      const competitorSite = (await competitor.getFirstAsync('SELECT crsql_site_id() AS id')).id;
      await server.applyChangesetAndSetLastSeen(rows.map(row => [row.table,row.pk,row.cid,row.val,BigInt(row.col_version),BigInt(row.db_version),null,BigInt(row.cl),row.seq]), competitorSite, [1n,0]);
      await api.closeTemporaryDatabase(competitor); old.close(false);
      const sites = [];
      for (const restore of ['b', 'c']) {
        assert.equal((await backupApi.restoreBackup(backup)).recoveryPending, true);
        const fresh = await adapter(); sites.push(Buffer.from(fresh.siteid).toString('hex'));
        assert.notEqual(sites.at(-1), oldSite); assert.equal((await fresh.getLastSeens()).length, 0);
        await assert.rejects(h.load('src/db/items.ts').updateItemTitle('shared','stale projection'), /read-only/);
        await exchange(fresh);
        await api.withAppDb(async db => {
          assert.equal((await db.getFirstAsync("SELECT content FROM sync_items WHERE id='shared'")).content, 'zulu');
          assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM sync_items WHERE id='server-deleted'")).n, 0);
          assert.ok(await db.getFirstAsync("SELECT * FROM sync_items WHERE id='post-backup'"));
          if (remoteOrigins) assert.equal((await db.getFirstAsync("SELECT content FROM sync_items WHERE id='remote-before-backup'")).content, 'new remote value');
          await replicaApi.markSyncSnapshotCompleteOwned(db);
          await replicaApi.projectSyncReplicaToLocalOwned(db);
          assert.equal(await api.isRestorePendingOwned(db), false);
          assert.equal((await db.getFirstAsync("SELECT value FROM stash_sync_metadata WHERE key='projected_au_recipe'")).value, '1');
        });
        await h.load('src/db/items.ts').saveItem({ id: `fresh-${restore}`,type:'text',uri:`new write ${restore}`,created_at:1,folder_ids:[] }, []);
        await exchange(fresh);
        const local = await api.withAppDb(db => db.getAllAsync('SELECT id,content FROM sync_items ORDER BY id'));
        assert.deepEqual(local, server.getDB().prepare('SELECT id,content FROM sync_items ORDER BY id').all());
        assert.ok(server.getDB().prepare('SELECT * FROM sync_items WHERE id=?').get(`fresh-${restore}`));
        fresh.close(false);
      }
      assert.notEqual(sites[0], sites[1]);
    } finally { server?.close(); await h.cleanup(); }
  });
}
async function replicaApiExport(db, h) { return h.load('src/db/restoreMerge.ts').exportRestoreChangesOwned(db); }

async function makeRecovery(h) {
  const api = h.load('src/db/database.ts'), replica = h.load('src/db/syncReplica.ts');
  await api.withAppDb(async db => {
    await db.runAsync("INSERT INTO items(id,type,uri,created_at) VALUES ('local','text','backup local',1)");
    await api.ensureCrsqliteLoaded(db); await replica.seedSyncReplicaOwned(db, true);
  });
  const backup = await h.load('src/utils/backup.ts').createBackup();
  await h.load('src/utils/backup.ts').restoreBackup(backup);
}

for (const capability of [undefined, { version:1, mergeEqualValues:1 }, { version:99, mergeEqualValues:0 }]) {
  test(`actual connect refuses unsupported recovery capability ${JSON.stringify(capability)} before transport`, async () => {
    const h = await createNativeHarness();
    try {
      await makeRecovery(h);
      const replicaApi = h.load('src/db/syncReplica.ts'), api = h.load('src/db/database.ts');
      const id = await api.withAppDb(async db => (await db.getFirstAsync('SELECT lower(hex(crsql_site_id())) AS id')).id);
      let transports = 0;
      h.options.createSyncedDB = async () => { transports++; throw Error('must not create transport'); };
      h.options.fetch = async url => ({ ok:true, json:async () => ({ schema:replicaApi.SYNC_CRR_SCHEMA_NAME, schemaVersion:replicaApi.SYNC_CRR_SCHEMA_VERSION.toString(), clientSiteId:id, serverSiteId:'a'.repeat(32), serverVersion:'0', clientSeenVersion:'0', restoreMerge:capability }) });
      const phases = [];
      await assert.rejects(h.load('src/db/syncClient.ts').connectStashSync('http://localhost/', { username:'x',password:'x' }, status => phases.push(status.phase)), /does not support safe restore/);
      assert.equal(transports, 0); assert.ok(!phases.includes('synced'));
      await h.restart();
      await h.load('src/db/database.ts').withAppDb(async db => assert.equal(await h.load('src/db/database.ts').isRestorePendingOwned(db), true));
    } finally { await h.cleanup(); }
  });
}

test('actual connect partial exchange failure/restart retains pending; full two-way exchange projects settings then enables offline writes', async () => {
  const h = await createNativeHarness(); let server;
  try {
    await makeRecovery(h);
    const { internal } = await import(pathToFileURL(h.serverRequire.resolve('@vlcn.io/ws-server')));
    const replicaApi = h.load('src/db/syncReplica.ts');
    const schemaDirectory = path.join(h.root,'schemas'); fs.mkdirSync(schemaDirectory);
    fs.writeFileSync(path.join(schemaDirectory,replicaApi.SYNC_CRR_SCHEMA_NAME),replicaApi.SYNC_SCHEMA_SQL);
    server = new internal.DB({ dbFolder:h.root, schemaFolder:schemaDirectory },null,'server',replicaApi.SYNC_CRR_SCHEMA_NAME,replicaApi.SYNC_CRR_SCHEMA_VERSION);
    server.getDB().prepare("INSERT INTO sync_items(id,type,content) VALUES ('remote','text','from server')").run();
    let fail = true, transports = 0;
    const phases = [];
    h.options.fastTimers = true;
    h.options.createSyncedDB = async config => {
      const replica = await config.dbProvider(); transports++;
      return {
        async start() {
          const incoming = server.pullChangeset([0n,0],replica.siteid);
          await replica.applyChangesetAndSetLastSeen(incoming,server.siteId,[incoming.at(-1)[5],0]);
          if (fail) throw Error('injected exchange interruption');
          const outgoing = await replica.pullChangeset(server.getLastSeen(replica.siteid),[server.siteId],false);
          await server.applyChangesetAndSetLastSeen(outgoing,replica.siteid,[outgoing.reduce((v,c) => c[5]>v?c[5]:v,0n),0]);
        },
        stop() { replica.close(false); },
      };
    };
    h.options.fetch = async url => ({ ok:true, json:async () => {
      const id = url.searchParams.get('clientSiteId');
      const client = id ? Buffer.from(id,'hex') : Buffer.alloc(16);
      const max = server.getDB().prepare('SELECT COALESCE(MAX(db_version),0) AS v FROM crsql_changes WHERE site_id IS NOT ?').get(client).v;
      return { schema:replicaApi.SYNC_CRR_SCHEMA_NAME,schemaVersion:replicaApi.SYNC_CRR_SCHEMA_VERSION.toString(), serverSiteId:Buffer.from(server.siteId).toString('hex'),serverVersion:String(max),clientSiteId:id,clientSeenVersion:String(server.getLastSeen(client)[0]),restoreMerge:{version:1,mergeEqualValues:0} };
    } });
    await assert.rejects(h.load('src/db/syncClient.ts').connectStashSync('http://localhost/',{username:'x',password:'x'},status=>phases.push(status.phase)), /exchange interruption/);
    assert.ok(!phases.includes('synced'));
    await h.restart();
    const api = h.load('src/db/database.ts');
    await assert.rejects(h.load('src/db/items.ts').updateItemTitle('local','stale'), /read-only/);
    await api.withAppDb(async db => {
      assert.equal(await api.isRestorePendingOwned(db),true);
      assert.ok((await db.getAllAsync('SELECT * FROM crsql_tracked_peers')).length > 0);
      assert.equal(await db.getFirstAsync("SELECT * FROM items WHERE id='remote'"),null); // still unprojected
    });
    fail = false;
    let resolveSynced;
    const synced = new Promise(resolve => { resolveSynced = resolve; });
    const connection = await h.load('src/db/syncClient.ts').connectStashSync('http://localhost/',{username:'x',password:'x'},status=>{
      phases.push(status.phase); if(status.phase==='synced') resolveSynced();
    });
    await Promise.race([synced, new Promise((_,reject)=>setTimeout(()=>reject(Error('sync deadline')),2000))]);
    assert.equal(h.recipe,true); assert.equal(transports,2);
    connection.stop(); await h.load('src/db/syncClient.ts').disconnectStashSyncAndWait();
    await api.withAppDb(async db => {
      assert.equal(await api.isRestorePendingOwned(db),false);
      assert.equal((await db.getFirstAsync("SELECT uri FROM items WHERE id='remote'")).uri,'from server');
    });
    await h.load('src/db/items.ts').updateItemTitle('local','ordinary offline edit');
  } finally { server?.close(); await h.cleanup(); }
});

test('backup-only tombstones/membership generations survive real replay; add-wins repairs stay pending until uploaded', async () => {
  const h = await createNativeHarness(); let server;
  try {
    const { internal } = await import(pathToFileURL(h.serverRequire.resolve('@vlcn.io/ws-server')));
    const api = h.load('src/db/database.ts'), r = h.load('src/db/syncReplica.ts');
    const schemaDirectory = path.join(h.root,'schemas'); fs.mkdirSync(schemaDirectory);
    fs.writeFileSync(path.join(schemaDirectory,r.SYNC_CRR_SCHEMA_NAME),r.SYNC_SCHEMA_SQL);
    server = new internal.DB({dbFolder:h.root,schemaFolder:schemaDirectory},null,'server',r.SYNC_CRR_SCHEMA_NAME,r.SYNC_CRR_SCHEMA_VERSION);
    await api.withAppDb(async db => {
      for (const id of ['survivor','deleted-in-backup']) {
        await db.runAsync("INSERT INTO items(id,type,uri,created_at) VALUES (?,'text','initial',1)",id);
        await db.runAsync("INSERT INTO item_folders VALUES (?,'inbox',1)",id);
      }
      await api.ensureCrsqliteLoaded(db); await r.seedSyncReplicaOwned(db,false);
    });
    const { StashReplica } = h.load('src/db/syncClient.ts');
    const makeAdapter = async () => new StashReplica('app',await api.withAppDb(async db => (await db.getFirstAsync('SELECT crsql_site_id() AS id')).id));
    const transfer = async replica => {
      const changes = await replica.pullChangeset(server.getLastSeen(replica.siteid),[server.siteId],false);
      if(changes.length) await server.applyChangesetAndSetLastSeen(changes,replica.siteid,[changes.reduce((v,c)=>c[5]>v?c[5]:v,0n),0]);
      const seen = (await replica.getLastSeens()).find(([site])=>Buffer.from(site).equals(Buffer.from(server.siteId)))?.[1]??[0n,0];
      const incoming = server.pullChangeset(seen,replica.siteid);
      if(incoming.length) await replica.applyChangesetAndSetLastSeen(incoming,server.siteId,[incoming.reduce((v,c)=>c[5]>v?c[5]:v,0n),0]);
    };
    const old = await makeAdapter(); await transfer(old);
    await h.load('src/db/items.ts').deleteItem('deleted-in-backup');
    await h.load('src/db/items.ts').removeItemFromFolder('survivor','inbox');
    await h.load('src/db/items.ts').updateItemTitle('survivor','backup-only title');
    await h.load('src/db/items.ts').saveItem({id:'backup-only',type:'text',uri:'unsent row',created_at:1,folder_ids:['inbox']},['inbox']);
    const originalGenerations = await api.withAppDb(db=>db.getAllAsync('SELECT membership_id FROM sync_item_folders ORDER BY membership_id'));
    const backup = await h.load('src/utils/backup.ts').createBackup(); old.close(false);
    server.getDB().prepare("UPDATE sync_items SET description='server-only field',content='new server content' WHERE id='survivor'").run();
    server.getDB().prepare("UPDATE sync_items SET content='newer server content' WHERE id='survivor'").run();
    // Concurrent add generation unseen by the stale delete survives and revives its parent.
    server.getDB().prepare("INSERT INTO sync_item_folders VALUES ('server-new-generation','survivor','inbox',99)").run();
    server.getDB().prepare("UPDATE sync_folders SET deleted=1 WHERE id='inbox'").run();
    await h.load('src/utils/backup.ts').restoreBackup(backup);
    const restored = await makeAdapter();
    await api.withAppDb(async db => assert.deepEqual(await db.getAllAsync('SELECT membership_id FROM sync_item_folders ORDER BY membership_id'),originalGenerations));
    await transfer(restored);
    await api.withAppDb(async db => {
      assert.equal(await db.getFirstAsync("SELECT * FROM sync_items WHERE id='deleted-in-backup'"),null);
      assert.equal((await db.getFirstAsync("SELECT content,title,description FROM sync_items WHERE id='survivor'")).content,'newer server content');
      assert.equal((await db.getFirstAsync("SELECT title FROM sync_items WHERE id='survivor'")).title,'backup-only title');
      assert.equal((await db.getFirstAsync("SELECT description FROM sync_items WHERE id='survivor'")).description,'server-only field');
      assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM sync_item_folders WHERE item_id='survivor'")).n,1);
      await r.markSyncSnapshotCompleteOwned(db); await r.projectSyncReplicaToLocalOwned(db);
      assert.equal(await api.isRestorePendingOwned(db),true,'repair must be uploaded before completion');
      assert.equal((await db.getFirstAsync("SELECT deleted FROM sync_folders WHERE id='inbox'")).deleted,0);
    });
    await transfer(restored);
    await api.withAppDb(async db => {
      await r.markSyncSnapshotCompleteOwned(db); await r.projectSyncReplicaToLocalOwned(db);
      assert.equal(await api.isRestorePendingOwned(db),false);
      assert.deepEqual(await db.getAllAsync('SELECT id,content,title,description FROM sync_items ORDER BY id'),server.getDB().prepare('SELECT id,content,title,description FROM sync_items ORDER BY id').all());
      assert.deepEqual(await db.getAllAsync('SELECT membership_id FROM sync_item_folders ORDER BY membership_id'),server.getDB().prepare('SELECT membership_id FROM sync_item_folders ORDER BY membership_id').all());
    });
    // A later intentional live generation beats the backed-up hard tombstone;
    // restore must not invent a generation or pin the row permanently deleted.
    server.getDB().prepare("INSERT INTO sync_items(id,type,content) VALUES ('deleted-in-backup','text','intentional resurrection')").run();
    await transfer(restored);
    await api.withAppDb(async db => {
      assert.equal((await db.getFirstAsync("SELECT content FROM sync_items WHERE id='deleted-in-backup'")).content,'intentional resurrection');
      assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM sync_item_folders WHERE item_id='deleted-in-backup'")).n,0);
    });
    restored.close(false);
  } finally { server?.close(); await h.cleanup(); }
});

test('tombstone-only empty restored account has history but no phantom Inbox, membership or setting row', async () => {
  const h = await createNativeHarness();
  try {
    const api = h.load('src/db/database.ts'), r = h.load('src/db/syncReplica.ts');
    await api.withAppDb(async db => {
      await api.ensureCrsqliteLoaded(db); await r.seedSyncReplicaOwned(db,false);
      await db.runAsync('DELETE FROM sync_folders'); await db.runAsync('DELETE FROM sync_user_settings');
      await db.runAsync('DELETE FROM folders');
    });
    const backup = await h.load('src/utils/backup.ts').createBackup();
    await h.load('src/utils/backup.ts').restoreBackup(backup);
    await api.withAppDb(async db => {
      assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM folders')).n,0);
      assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM sync_folders')).n,0);
      assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM sync_user_settings')).n,0);
      assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM sync_item_folders')).n,0);
      assert.ok((await db.getFirstAsync('SELECT COUNT(*) AS n FROM crsql_changes')).n>0);
    });
  } finally { await h.cleanup(); }
});
