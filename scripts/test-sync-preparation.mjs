// First-run Connect must not initialize or damage a local-only database.
// Run in the server devshell for the pinned native SQLite ABI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHarness } from './restore-test-harness.cjs';

for (const metadataExists of [false, true]) {
  test(`unprepared Connect is non-destructive and retryable; metadata table=${metadataExists}`, async () => {
    const h = await createNativeHarness();
    try {
      const dbApi = h.load('src/db/database.ts');
      const sync = h.load('src/db/syncClient.ts');
      let before;
      await dbApi.withAppDb(async db => {
        await db.runAsync("INSERT INTO items(id,type,uri,created_at) VALUES ('preserve','text','keep local data',1)");
        if (metadataExists) await db.execAsync('CREATE TABLE stash_sync_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        before = Buffer.from(await db.serializeAsync());
      });
      let networkCalls = 0, transports = 0;
      h.options.fetch = async () => { networkCalls++; throw Error('must not contact a server'); };
      h.options.createSyncedDB = async () => { transports++; throw Error('must not create transport'); };
      const phases = [];
      await assert.rejects(
        sync.connectStashSync('http://localhost/', { username:'x',password:'x' }, status => phases.push(status.phase)),
        error => error instanceof sync.StashSyncPreparationRequiredError && /Prepare.*local sync replica before connecting/.test(error.message),
      );
      assert.deepEqual(phases,['connecting','stopped']);
      assert.equal(networkCalls,0); assert.equal(transports,0);
      await dbApi.withAppDb(async db => {
        assert.deepEqual(Buffer.from(await db.serializeAsync()),before);
        assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='crsql_master'")).n,0,'Connect must not load CR-SQLite into an unprepared local DB');
        assert.equal((await db.getFirstAsync("SELECT uri FROM items WHERE id='preserve'")).uri,'keep local data');
      });
      const replicaApi = h.load('src/db/syncReplica.ts');
      await replicaApi.prepareCurrentStashReplica(false);
      h.options.fetch = async (url,{signal}) => {
        networkCalls++;
        if (url.pathname.endsWith('healthz')) return {ok:true,json:async()=>({schema:replicaApi.SYNC_CRR_SCHEMA_NAME,schemaVersion:replicaApi.SYNC_CRR_SCHEMA_VERSION.toString()})};
        return new Promise((_,reject)=>{
          const abort=()=>reject(Error('aborted'));
          if(signal.aborted) abort(); else signal.addEventListener('abort',abort,{once:true});
        });
      };
      h.options.createSyncedDB = async config => {
        transports++;
        const replica = await config.dbProvider();
        return {start:async()=>{},stop:()=>replica.close(false)};
      };
      const connection = await sync.connectStashSync('http://localhost/',{username:'x',password:'x'});
      assert.equal(transports,1);
      connection.stop();
      await sync.disconnectStashSyncAndWait();
      assert.ok(networkCalls>=1);
    } finally { await h.cleanup(); }
  });
}
