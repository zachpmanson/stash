const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createNativeHarness } = require('./restore-test-harness.cjs');
// Synthetic bytes; filesystem/crypto adapters are actual production functions,
// with only Expo native/network boundaries bridged to disposable Node fixtures.
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/pkAAAAASUVORK5CYII=', 'base64');
const sha = createHash('sha256').update(bytes).digest('hex');
const descriptor = { state: 'available', sha256: sha, bytes: bytes.length, mime: 'image/png' };
const vm = require('node:vm');
const ts = require('typescript');
const normalizationModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../node_modules/expo/src/winter/fetch/RequestUtils.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: normalizationModule, exports: normalizationModule.exports, Uint8Array, ArrayBuffer, Blob, URLSearchParams, ReadableStream, TextEncoder, Headers,
  require: () => ({ blobToArrayBufferAsync: async blob => blob.arrayBuffer() }),
});
const normalizeBody = normalizationModule.exports.normalizeBodyInitAsync;
const base = new URL('https://synthetic.example/');
const authorization = 'Basic c3ludGhldGljOnRlc3Q=';
async function setup(h, id = 'remote-image') {
  const app = h.load('src/db/database.ts'); const replica = h.load('src/db/syncReplica.ts');
  await app.withAppDb(async db => {
    await app.ensureCrsqliteLoaded(db); await replica.seedSyncReplicaOwned(db, false);
    await db.runAsync("INSERT INTO sync_items(id,type,media_id) VALUES (?,'image',?)", id, id);
  });
  return { app, replica, queue: h.load('src/db/mediaQueue.ts') };
}
function response(body = bytes, digest = sha) {
  return new Response(body, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'X-Stash-Content-SHA256': digest } });
}

test('actual durable queue verifies downloads before local promotion/projection, survives restart, retries without duplicate items and preserves native backup originals', async () => {
  const h = await createNativeHarness();
  try {
    let { app, replica, queue } = await setup(h);
    h.options.fetch = async (_url, options) => { assert.equal(options.headers.Authorization, authorization); return Response.json(descriptor); };
    h.options.nativeFetch = async (_url, options) => { assert.equal(options.headers.Authorization, authorization); return response(Buffer.alloc(bytes.length)); };
    let result = await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    assert.equal(result.status.pending, 1); assert.equal(result.projected, false);
    assert.equal(await app.withAppDb(async db => (await db.getFirstAsync('SELECT COUNT(*) AS n FROM stash_media_local_v1')).n), 0);
    assert.deepEqual(new h.Directory(h.Paths.document, 'stash').list(), [], 'failed download leaves no promoted/partial original');
    await h.restart();
    app = h.load('src/db/database.ts'); replica = h.load('src/db/syncReplica.ts'); queue = h.load('src/db/mediaQueue.ts');
    assert.equal(await app.withAppDb(async db => (await db.getFirstAsync('SELECT attempts FROM stash_media_queue_v1')).attempts), 1);
    h.options.nativeFetch = async () => response();
    await queue.retryStashImages();
    result = await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    assert.equal(result.status.pending, 0); assert.equal(result.projected, true);
    await app.withAppDb(async db => { await replica.markSyncSnapshotCompleteOwned(db); await replica.projectSyncReplicaToLocalOwned(db); });
    const item = await h.load('src/db/items.ts').getItemById('remote-image');
    assert.deepEqual(fs.readFileSync(h.localPath(item.uri)), bytes);
    assert.match(item.uri, /\/stash\/synced-/);
    assert.equal(await app.withAppDb(async db => (await db.getFirstAsync('SELECT COUNT(*) AS n FROM items')).n), 1);
    // Real ZIP backup/restore builder and resource retargeting, synthetic files.
    const backup = await h.load('src/utils/backup.ts').createBackup();
    const restored = await h.load('src/utils/backup.ts').restoreBackup(backup);
    assert.equal(restored.recoveryPending, true);
    await assert.rejects(queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal), /read-only/);
    const mapping = await app.withAppDb(db => db.getFirstAsync('SELECT uri FROM stash_restore_media WHERE id=?', 'remote-image'));
    assert.deepEqual(fs.readFileSync(h.localPath(mapping.uri)), bytes);
    assert.deepEqual(fs.readFileSync(h.localPath(item.uri)), bytes, 'restore never deletes the retained original');
  } finally { await h.cleanup(); }
});

test('persisted retry deadlines automatically resume after restart without a manual Retry action', async () => {
  const h=await createNativeHarness();
  try {
    h.options.now=10000;
    let {app,queue}=await setup(h);let requests=0;
    h.options.fetch=async()=>Response.json(descriptor);
    h.options.nativeFetch=async()=>{requests++;return new Response(null,{status:503});};
    await queue.runStashMediaCycle(base,'synthetic',authorization,new AbortController().signal);
    assert.equal(await app.withAppDb(async db=>(await db.getFirstAsync('SELECT next_retry FROM stash_media_queue_v1')).next_retry),12000);
    await h.restart();app=h.load('src/db/database.ts');queue=h.load('src/db/mediaQueue.ts');
    h.options.now=11999;h.options.nativeFetch=async()=>{requests++;return response();};
    await queue.runStashMediaCycle(base,'synthetic',authorization,new AbortController().signal);
    assert.equal(requests,1,'restart does not spin or ignore retained backoff');
    h.options.now=12001;
    const result=await queue.runStashMediaCycle(base,'synthetic',authorization,new AbortController().signal);
    assert.equal(requests,2);assert.equal(result.projected,true);assert.equal(result.status.pending,0);
  } finally {await h.cleanup();}
});

test('actual upload backfills existing identity, persists unsupported errors truthfully, and reconnect retries remain idempotent', async () => {
  const h = await createNativeHarness();
  try {
    const { app, queue } = await setup(h, 'phone-image');
    const directory = new h.Directory(h.Paths.document, 'stash'); directory.create();
    const file = new h.File(directory, 'synthetic.png'); file.create(); file.write(bytes);
    await h.load('src/db/items.ts').saveItem({ id: 'phone-image', type: 'image', uri: file.uri, created_at: 1, folder_ids: [] }, []);
    h.options.fetch = async () => Response.json({ state: 'pending' });
    let uploads = 0; let failure = 415;
    h.options.nativeFetch = async (_url, options) => {
      uploads++; assert.equal(options.headers.Authorization, authorization);
      const normalized = await normalizeBody(options.body);
      assert.equal(normalized.overriddenHeaders, undefined, 'actual Expo SDK body normalization must not override binary Content-Type');
      assert.deepEqual(Buffer.from(normalized.body), bytes);
      assert.equal(options.headers['X-Stash-Content-SHA256'], sha); assert.ok(ArrayBuffer.isView(options.body), 'typed bytes must preserve octet-stream under actual Expo normalization'); assert.deepEqual(Buffer.from(options.body), bytes);
      return new Response(null, { status: failure || 200 });
    };
    let result = await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    assert.equal(result.status.errors, 1); assert.match(result.status.message, /unsupported.*original retained/);
    await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    assert.equal(uploads, 1, 'unsupported original is not retried in a tight loop');
    failure = 0; await queue.retryStashImages();
    result = await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    assert.equal(result.status.pending, 0);
    await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal, true);
    assert.equal(uploads, 3, 'new session safely rechecks completed local originals after backend restore');
    assert.equal(await app.withAppDb(async db => (await db.getFirstAsync('SELECT media_id FROM sync_items WHERE id=?', 'phone-image')).media_id), 'phone-image');
    assert.deepEqual(file.bytesSync(), bytes);
  } finally { await h.cleanup(); }
});

test('disk failure, cancellation and delete-during-download never expose incomplete local paths or resurrect metadata', async () => {
  const h = await createNativeHarness();
  try {
    const { app, queue } = await setup(h);
    h.options.fetch = async () => Response.json(descriptor);
    h.options.nativeFetch = async () => response();
    h.options.writeFailure = uri => uri.endsWith('.partial');
    let result = await queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    assert.equal(result.status.pending, 1);
    assert.deepEqual(new h.Directory(h.Paths.document, 'stash').list(), []);
    delete h.options.writeFailure; await queue.retryStashImages();
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    h.options.nativeFetch = async () => response(new ReadableStream({ async start(c) { c.enqueue(bytes.subarray(0, 10)); started(); await gate; c.enqueue(bytes.subarray(10)); c.close(); } }));
    const pending = queue.runStashMediaCycle(base, 'synthetic', authorization, new AbortController().signal);
    await ready; await app.withAppDb(db => db.runAsync("DELETE FROM sync_items WHERE id='remote-image'")); release();
    result = await pending;
    assert.equal(result.projected, false);
    assert.equal(await app.withAppDb(async db => (await db.getFirstAsync('SELECT COUNT(*) AS n FROM stash_media_local_v1')).n), 0);
    assert.equal(await app.withAppDb(async db => (await db.getFirstAsync('SELECT COUNT(*) AS n FROM sync_items')).n), 0);
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(queue.runStashMediaCycle(base, 'synthetic', authorization, stopped.signal), /cancelled/);
  } finally { await h.cleanup(); }
});

test('cancelling active verified-download I/O drains the reader and retains a retryable job without publishing paths', async () => {
  const h=await createNativeHarness();
  try {
    const {app,queue}=await setup(h); h.options.fetch=async()=>Response.json(descriptor);
    let started;const ready=new Promise(resolve=>{started=resolve;});
    let cancelled=false;
    h.options.nativeFetch=async(_url,options)=>response(new ReadableStream({
      start(c){c.enqueue(bytes.subarray(0,10));started();options.signal.addEventListener('abort',()=>{cancelled=true;c.error(Error('synthetic native stream cancelled'));},{once:true});},
    }));
    const controller=new AbortController();
    const active=queue.runStashMediaCycle(base,'synthetic',authorization,controller.signal);
    const rejected=assert.rejects(active,/cancelled/);await ready;controller.abort();await rejected;
    assert.equal(cancelled,true);
    assert.deepEqual(new h.Directory(h.Paths.document,'stash').list(),[]);
    assert.equal(await app.withAppDb(async db=>(await db.getFirstAsync('SELECT COUNT(*) AS n FROM stash_media_local_v1')).n),0);
    assert.equal(await app.withAppDb(async db=>(await db.getFirstAsync('SELECT state FROM stash_media_queue_v1')).state),'queued');
    // A different account gets its own durable work row; no old Authorization
    // or saved credential is persisted as queue state or published by a late I/O.
    h.options.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Basic synthetic-bob');return Response.json(descriptor);};
    h.options.nativeFetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Basic synthetic-bob');return response();};
    assert.equal((await queue.runStashMediaCycle(base,'bob','Basic synthetic-bob',new AbortController().signal)).status.pending,0);
    const rows=await app.withAppDb(db=>db.getAllAsync('SELECT account,state,message FROM stash_media_queue_v1'));
    assert.equal(rows.length,2);assert.ok(!JSON.stringify(rows).includes('Basic'));
  } finally {await h.cleanup();}
});
