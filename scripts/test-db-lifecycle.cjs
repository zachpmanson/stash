// Run with: direnv exec . node --test scripts/test-db-lifecycle.cjs
// Real ownership/sync lifecycle code; native SQLite, HTTP and ws-client are mocked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: spec => {
      if (!(spec in mocks)) throw new Error(`Unexpected import ${spec} in ${file}`);
      return mocks[spec];
    },
    console, Uint8Array, URL, AbortController, Response, setTimeout, clearTimeout,
    btoa: value => Buffer.from(value).toString('base64'),
    fetch: (...args) => mocks.fetch(...args),
  }, { filename });
  return module.exports;
}
function databaseHarness() {
  const events = [], handles = [];
  const options = {};
  const sqlite = {
    bundledExtensions: { crsqlite: { libPath: 'crsqlite', entryPoint: 'sqlite3_crsqlite_init' } },
    openDatabaseAsync: async () => {
      const id = handles.length;
      events.push(`open:${id}`);
      if (options.openGate) await options.openGate.promise;
      const db = {
        databasePath: '/stash.db',
        execAsync: async sql => {
          if (sql.includes('crsql_finalize')) {
            events.push(`finalize:${id}`);
            if (options.finalizeError) throw options.finalizeError;
          } else if (options.initError) throw options.initError;
        },
        getAllAsync: async sql => options.read ? options.read(sql) : [],
        getFirstAsync: async (sql, ...args) => args.includes("restore_merge_pending") ? null : sql.includes('sqlite_master') ? { present: 1 } : sql.includes('crsql_site_id')
          ? { site_id: new Uint8Array(16) } : sql.includes('metadata') ? { value: '1' } : { count: 1 },
        runAsync: async () => {},
        withTransactionAsync: async task => task(),
        loadExtensionAsync: async () => events.push(`load:${id}`),
        closeAsync: async () => {
          events.push(`close:${id}`);
          if (options.closeError) throw options.closeError;
        },
      };
      handles.push(db);
      return db;
    },
    addDatabaseChangeListener: () => ({ remove: () => events.push('unsubscribe') }),
  };
  const api = load('src/db/database.ts', { 'expo-sqlite': sqlite, 'react-native': { Platform: { OS: 'android' } }, 'expo-file-system': { File: class { exists = false; }, Paths: {} } });
  return { api, sqlite, options, events, handles };
}
function syncHarness() {
  const h = databaseHarness();
  let replica, statusSignal, startGate, stopError, healthGate;
  let transports = 0, stops = 0;
  const api = load('src/db/syncClient.ts', {
    'expo-sqlite': h.sqlite, './database': h.api,
    './syncIdentity': load('src/db/syncIdentity.ts', {}),
    './restoreMerge': { assertRecoveryConfigurationOwned: async () => {} },
    '../state/settingsState': { useSettingsStore: { getState: () => ({ setAuRecipe() {} }) } },
    './syncReplica': {
      SYNC_CRR_SCHEMA_NAME: 'test', SYNC_CRR_SCHEMA_VERSION: 1n, SYNC_INITIALIZED_KEY: 'seed',
      beginSyncCycleOwned: async () => {}, markSyncSnapshotCompleteOwned: async () => {},
      projectSyncReplicaToLocalOwned: async () => {},
    },
    '@vlcn.io/ws-client': {
      defaultConfig: { transportProvider: () => {} },
      createSyncedDB: async config => {
        replica = await config.dbProvider();
        transports++;
        return {
          start: async () => { if (startGate) await startGate.promise; if (h.options.startError) throw h.options.startError; },
          // Intentionally omit replica.close(): verify app fallback cleanup.
          stop: () => { stops++; if (stopError) throw stopError; },
        };
      },
    },
    fetch: async (url, options) => {
      const { signal } = options;
      if (url.pathname.includes('/api/folders/')) {
        if (!h.options.feedResponse) throw Error('Unexpected feed request');
        return h.options.feedResponse(url, options);
      }
      if (url.pathname.endsWith('healthz')) {
        if (healthGate) await healthGate.promise;
        if (h.options.healthError) throw h.options.healthError;
        return { ok: !h.options.healthStatus, status: h.options.healthStatus || 200, json: async () => ({ schema: 'test', schemaVersion: '1' }) };
      }
      statusSignal = signal;
      if (h.options.statusResponse) return h.options.statusResponse(url, signal);
      return new Promise((_, reject) => {
        const abort = () => reject(new Error('aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
  });
  return {
    ...h, sync: api,
    connect: onStatus => api.connectStashSync('http://localhost/', { username: 'test', password: 'test' }, onStatus),
    get replica() { return replica; }, get transports() { return transports; }, get stops() { return stops; },
    get statusSignal() { return statusSignal; },
    set startGate(value) { startGate = value; }, set stopError(value) { stopError = value; },
    set healthGate(value) { healthGate = value; },
  };
}

test('replacement waits for opening and the entire owning callback, then blocks readers through afterOpen', async () => {
  const h = databaseHarness(), opening = deferred(), operation = deferred(), afterOpen = deferred();
  h.options.openGate = opening;
  const owner = h.api.withAppDb(async db => { h.events.push('owner'); await operation.promise; return db.databasePath; });
  const replacement = h.api.withAppDbReplacement(async () => h.events.push('replace'), async () => {
    h.events.push('afterOpen'); await afterOpen.promise;
  });
  const reader = h.api.withAppDb(async () => h.events.push('reader'));
  await tick();
  assert.deepEqual(h.events, ['open:0']);
  opening.resolve(); await tick();
  assert.equal(h.events.includes('replace'), false);
  operation.resolve(); await owner; await tick();
  assert.deepEqual(h.events, ['open:0', 'load:0', 'owner', 'finalize:0', 'close:0', 'replace', 'open:1', 'load:1', 'afterOpen']);
  afterOpen.resolve(); await replacement; await reader;
  assert.equal(h.events.at(-1), 'reader');
});

test('a rejected owner releases the queue without poisoning the open DB', async () => {
  const h = databaseHarness();
  await assert.rejects(h.api.withAppDb(async () => { throw new Error('statement failed'); }), /statement failed/);
  await h.api.withAppDb(async db => assert.equal(db, h.handles[0]));
  assert.equal(h.handles.length, 1);
});

for (const phase of ['finalize', 'close', 'replace', 'afterOpen']) {
  test(`failed ${phase} poisons DB access and forbids later replacement until restart`, async () => {
    const h = databaseHarness(), failure = new Error(`${phase} failed`);
    await h.api.withAppDb(async () => {});
    if (phase === 'finalize') h.options.finalizeError = failure;
    if (phase === 'close') h.options.closeError = failure;
    let replacements = 0;
    await assert.rejects(h.api.withAppDbReplacement(async () => {
      replacements++; if (phase === 'replace') throw failure;
    }, async () => { if (phase === 'afterOpen') throw failure; }), error => error === failure);
    await assert.rejects(h.api.withAppDb(async () => assert.fail('poisoned callback ran')), error => error === failure);
    await assert.rejects(h.api.withAppDbReplacement(async () => assert.fail('poisoned replacement ran'), async () => {}), error => error === failure);
    assert.equal(replacements, ['replace', 'afterOpen'].includes(phase) ? 1 : 0);
  });
}

test('schema initialization failure closes the provisional handle and allows retry', async () => {
  const h = databaseHarness();
  h.options.initError = new Error('schema failed');
  await assert.rejects(h.api.withAppDb(async () => assert.fail()), /schema failed/);
  assert.deepEqual(h.events, ['open:0', 'close:0']);
  h.options.initError = null;
  await h.api.withAppDb(async () => {});
  assert.equal(h.handles.length, 2);
});

test('failed provisional-handle cleanup poisons subsequent access', async () => {
  const h = databaseHarness();
  h.options.initError = new Error('schema failed'); h.options.closeError = new Error('cleanup failed');
  await assert.rejects(h.api.withAppDb(async () => {}), /cleanup failed/);
  await assert.rejects(h.api.withAppDb(async () => {}), /cleanup failed/);
  assert.equal(h.handles.length, 1);
});

test('restore cancels setup queued behind an app owner without opening a transport', async () => {
  const h = syncHarness(), gate = deferred();
  const owner = h.api.withAppDb(async () => gate.promise);
  const connect = h.connect();
  await tick(); // Let deferred setup enqueue behind the held DB owner.
  const restore = h.sync.withStashSyncRestoreLock(async () => h.events.push('restore'));
  await assert.rejects(h.connect(), /restore is in progress/);
  gate.resolve(); await owner; await connect; await restore;
  assert.equal(h.transports, 0);
  assert.equal(h.events.at(-1), 'restore');
});

test('connecting observer can synchronously start restore without escaping exclusion', async () => {
  const h = syncHarness(), gate = deferred(); let restore, restored = false;
  await h.connect(status => {
    if (status.phase === 'connecting') {
      restore = h.sync.withStashSyncRestoreLock(async () => { restored = true; await gate.promise; });
    }
  });
  await tick();
  assert.equal(restored, true);
  assert.equal(h.transports, 0);
  await assert.rejects(h.connect(), /restore is in progress/);
  gate.resolve(); await restore;
});

test('throwing status observers cannot strand an attempt or interrupt teardown', async () => {
  const h = syncHarness(), phases = [];
  const disconnect = await h.connect(status => { phases.push(status.phase); throw new Error('observer failed'); });
  assert.equal(typeof disconnect.stop, 'function');
  await h.sync.disconnectStashSyncAndWait();
  assert.deepEqual(phases, ['connecting', 'syncing', 'stopped']);
  assert.equal(h.stops, 1);
  assert.equal(h.events.includes('unsubscribe'), true);
  await h.sync.withStashSyncRestoreLock(async () => {});
});

test('throwing subscribed observer cannot prevent other notifications or restore', async () => {
  const h = syncHarness(), statuses = [];
  const unsubscribe = h.sync.subscribeStashSyncStatus(() => { throw new Error('subscriber failed'); });
  h.sync.subscribeStashSyncStatus(status => statuses.push(status));
  await h.connect();
  await h.sync.withStashSyncRestoreLock(async () => {});
  // Shared subscribers get one additional stopped update when draining completes;
  // custom phase callbacks above retain their original sequence.
  assert.deepEqual(statuses.map(status => status.phase), ['stopped', 'connecting', 'syncing', 'stopped', 'stopped']);
  assert.equal(statuses.at(-2).disconnecting,true);
  assert.equal(statuses.at(-1).disconnecting,undefined);
  unsubscribe();
});

test('throwing connected observer cannot bypass draining of a replica read', async () => {
  const h = syncHarness(), gate = deferred(); let read, restored = false;
  h.options.read = async sql => { if (sql.includes('crsql_changes')) await gate.promise; return []; };
  await h.connect(status => {
    if (status.phase === 'syncing') {
      read = h.replica.pullChangeset([0n, 0], [], false);
      throw new Error('connected observer failed');
    }
  });
  const restore = h.sync.withStashSyncRestoreLock(async () => { restored = true; });
  await tick(); assert.equal(restored, false);
  gate.resolve(); await read; await restore;
  assert.equal(restored, true);
  assert.equal(h.stops, 1);
});

test('connected observer can reenter restore and throw without exposing placeholder completion', async () => {
  const h = syncHarness(), gate = deferred(); let read, restore, restored = false;
  h.options.read = async sql => { if (sql.includes('crsql_changes')) await gate.promise; return []; };
  await h.connect(status => {
    if (status.phase === 'syncing') {
      read = h.replica.pullChangeset([0n, 0], [], false);
      restore = h.sync.withStashSyncRestoreLock(async () => { restored = true; });
      throw new Error('reentrant observer failed');
    }
  });
  await tick(); assert.equal(restored, false);
  gate.resolve(); await read; await restore;
  assert.equal(restored, true);
  assert.equal(h.stops, 1);
});

test('restore cancels health-check setup and ignores its delayed success', async () => {
  const h = syncHarness(), health = deferred(); h.healthGate = health;
  const connect = h.connect(); await tick();
  let restored = false;
  const restore = h.sync.withStashSyncRestoreLock(async () => { restored = true; });
  await tick(); assert.equal(restored, false);
  health.resolve(); await connect; await restore;
  assert.equal(h.transports, 0);
});

test('restore waits for startup cancellation cleanup before replacing the DB', async () => {
  const h = syncHarness(), start = deferred(); h.startGate = start;
  const connect = h.connect(); await tick();
  assert.equal(h.transports, 1);
  let restored = false;
  const restore = h.sync.withStashSyncRestoreLock(async () => { restored = true; });
  await tick(); assert.equal(restored, false);
  start.resolve(); await connect; await restore;
  assert.equal(h.stops, 1);
  assert.equal(h.events.includes('unsubscribe'), true);
  assert.equal(restored, true);
});

test('restore drains pending replica reads and inbound applies; closed replica cannot touch replacement DB', async () => {
  const h = syncHarness(); await h.connect();
  const gate = deferred(); let pulls = 0;
  h.options.read = async sql => { if (sql.includes('crsql_changes')) { pulls++; await gate.promise; } return []; };
  const read = h.replica.pullChangeset([0n, 0], [], false);
  const apply = h.replica.applyChangesetAndSetLastSeen([], new Uint8Array(16), [1n, 0]);
  let restored = false;
  const restore = h.sync.withStashSyncRestoreLock(() => h.api.withAppDbReplacement(async () => {
    assert.equal(h.statusSignal.aborted, true); h.events.push('replace');
  }, async () => { restored = true; }));
  await tick(); assert.equal(restored, false);
  gate.resolve(); await read; await apply; await restore;
  assert.equal(restored, true);
  assert.equal(h.events.indexOf('unsubscribe') < h.events.indexOf('replace'), true);
  await h.replica.pullChangeset([0n, 0], [], false);
  await h.replica.applyChangesetAndSetLastSeen([], new Uint8Array(16), [2n, 0]);
  assert.equal(pulls, 1);
});

test('teardown failure closes replica but blocks restore and reconnection', async () => {
  const h = syncHarness(); await h.connect(); h.stopError = new Error('transport failed');
  await assert.rejects(h.sync.withStashSyncRestoreLock(async () => assert.fail('unsafe restore')), /transport failed/);
  assert.equal(h.events.includes('unsubscribe'), true);
  await assert.rejects(h.connect(), /transport failed/);
  await assert.rejects(h.sync.disconnectStashSyncAndWait(), /transport failed/);
});

test('pre-close restore preparation failure leaves current handle usable and invalidates prepared saves', async () => {
  const h = databaseHarness();
  await h.api.withAppDb(async () => {});
  const generation = h.api.getAppDbGeneration();
  await assert.rejects(h.api.withAppDbReplacement(async () => assert.fail('replace ran'), async () => assert.fail('reopened'), async db => {
    assert.equal(db, h.handles[0]); throw Error('prepare failed');
  }), /prepare failed/);
  await h.api.withAppDb(async db => {
    assert.equal(db, h.handles[0]);
    assert.throws(() => h.api.assertAppDbGenerationOwned(generation), /replaced/);
  });
  assert.equal(h.events.some(event => event.startsWith('close:')), false);
});

test('temporary extension cleanup attempts close even when finalization rejects', async () => {
  const h = databaseHarness();
  const temp = await h.sqlite.openDatabaseAsync();
  await h.api.ensureCrsqliteLoaded(temp);
  h.options.finalizeError = Error('temporary finalize failure');
  await assert.rejects(h.api.closeTemporaryDatabase(temp),/temporary finalize failure/);
  assert.ok(h.events.includes('close:0'));
});

test('subscribed account is sanitized, immediate on remount, retained across syncing/synced/poll errors, and removed at stop', {timeout:6000}, async () => {
  const h=syncHarness(), statuses=[], observedError=deferred();
  const account={username:'alice',serverUrl:'https://sync.example/base/'};
  let polls=0;
  h.options.statusResponse=async () => {
    polls++;
    if (polls >= 3) throw Error('temporary status outage');
    return {ok:true,json:async () => ({schema:'test',schemaVersion:'1',serverSiteId:'11'.repeat(16),clientSiteId:'00'.repeat(16),serverVersion:polls === 1 ? '1' : '0',clientSeenVersion:'0'})};
  };
  const unsubscribe=h.sync.subscribeStashSyncStatus(status => {
    statuses.push(status);
    if (status.phase === 'error' && /temporary status outage/.test(status.message)) observedError.resolve();
  });
  try {
    await assert.rejects(h.sync.connectStashSync('https://embedded:secret@sync.example/base/',{username:'alice',password:'password'}), /without embedded credentials/);
    statuses.length = 0;
    await h.sync.connectStashSync('https://sync.example/base/?token=secret#fragment',{username:' alice ',password:'password'});
    let remounted;
    const unmount=h.sync.subscribeStashSyncStatus(status => { remounted=status; });
    assert.deepEqual(JSON.parse(JSON.stringify(remounted.account)),account);
    unmount();
    await observedError.promise;
    assert.ok(statuses.some(s => s.phase === 'synced' && typeof s.projectedAt === 'number'));
    assert.ok(statuses.some(s => /Waiting for both/.test(s.message)));
    for (const status of statuses) {
      if (['syncing','synced','error'].includes(status.phase)) assert.deepEqual(JSON.parse(JSON.stringify(status.account)),account);
      else assert.equal(status.account,undefined);
      assert.doesNotMatch(JSON.stringify(status),/secret|password|embedded|Authorization|Basic/);
    }
    let errorOnRemount;
    const unmountError=h.sync.subscribeStashSyncStatus(status => { errorOnRemount=status; });
    assert.equal(errorOnRemount.phase,'error');
    assert.deepEqual(JSON.parse(JSON.stringify(errorOnRemount.account)),account);
    unmountError();
    await h.sync.disconnectStashSyncAndWait();
    assert.equal(statuses.at(-1).phase,'stopped'); assert.equal(statuses.at(-1).account,undefined);
    let stoppedOnRemount;
    h.sync.subscribeStashSyncStatus(status => { stoppedOnRemount=status; })();
    assert.equal(stoppedOnRemount.account,undefined);
  } finally { unsubscribe(); await h.sync.disconnectStashSyncAndWait(); }
});

for (const failure of ['preparation','auth','startup']) test(`account is never exposed on failed initial ${failure} and retry can establish it`, async () => {
  const h=syncHarness(), statuses=[];
  h.sync.subscribeStashSyncStatus(status => statuses.push(status));
  let originalFirst;
  if (failure === 'preparation') await h.api.withAppDb(async db => {
    originalFirst=db.getFirstAsync;
    db.getFirstAsync=async (sql,...args) => sql.includes('sqlite_master') ? {present:0} : originalFirst(sql,...args);
  });
  if (failure === 'auth') h.options.healthError=Error('HTTP 401');
  if (failure === 'startup') h.options.startError=Error('start failed');
  await assert.rejects(h.connect(),failure === 'preparation' ? /Prepare/ : failure === 'auth' ? /401/ : /start failed/);
  assert.ok(statuses.every(status => !status.account));
  assert.equal(statuses.at(-1).phase,failure === 'preparation' ? 'stopped' : 'error');
  if (originalFirst) await h.api.withAppDb(async db => { db.getFirstAsync=originalFirst; });
  h.options.healthError=null; h.options.startError=null;
  await h.connect();
  assert.equal(statuses.at(-1).account.username,'test');
  await h.sync.disconnectStashSyncAndWait();
  assert.equal(statuses.at(-1).account,undefined);
});

for (const phase of ['health','startup']) test(`account is absent throughout cancelled ${phase} and immediately on resubscription`, async () => {
  const h=syncHarness(), gate=deferred(), statuses=[];
  h.sync.subscribeStashSyncStatus(status => statuses.push(status));
  if (phase === 'health') h.healthGate=gate; else h.startGate=gate;
  const connect=h.connect(); await tick();
  const cancel=h.sync.disconnectStashSyncAndWait();
  gate.resolve(); await connect; await cancel;
  assert.ok(statuses.every(status => !status.account));
  assert.equal(statuses.at(-1).phase,'stopped');
  let immediate;
  h.sync.subscribeStashSyncStatus(status => { immediate=status; })();
  assert.equal(immediate.account,undefined); assert.equal(immediate.phase,'stopped');
});

for (const fail of [false,true]) test(`fresh subscription sees ${fail ? 'failed' : 'pending/completed'} session drain without a usable account`, {timeout:5000}, async () => {
  const h=syncHarness(), gate=deferred();
  const connection=await h.connect();
  h.options.read=async sql => { if (sql.includes('crsql_changes')) await gate.promise; return []; };
  const read=h.replica.pullChangeset([0n,0],[],false);
  if (fail) h.stopError=Error('teardown failed');
  connection.stop();
  let fresh;
  const unsubscribe=h.sync.subscribeStashSyncStatus(status => { fresh=status; });
  assert.equal(fresh.phase,'stopped'); assert.equal(fresh.disconnecting,true); assert.equal(fresh.account,undefined);
  let drained=false;
  const drain=h.sync.disconnectStashSyncAndWait().then(() => { drained=true; }, error => { assert.match(error.message,/teardown failed/); });
  await tick(); assert.equal(drained,false);
  gate.resolve(); await read; await drain;
  unsubscribe();
  h.sync.subscribeStashSyncStatus(status => { fresh=status; })();
  assert.equal(fresh.account,undefined); assert.equal(fresh.disconnecting,undefined);
  assert.equal(fresh.restartRequired,fail ? true : undefined);
  if (fail) await assert.rejects(h.connect(),/teardown failed/);
  else { assert.equal(drained,true); await h.connect(); await h.sync.disconnectStashSyncAndWait(); }
});

for (const phase of ['health','startup']) test(`cancelled ${phase} advertises teardown across remount until attempt drain completes`, async () => {
  const h=syncHarness(), gate=deferred();
  if (phase === 'health') h.healthGate=gate; else h.startGate=gate;
  const connect=h.connect(); await tick();
  const cancel=h.sync.disconnectStashSyncAndWait();
  let fresh;
  const unsubscribe=h.sync.subscribeStashSyncStatus(status => { fresh=status; });
  assert.equal(fresh.disconnecting,true); assert.equal(fresh.account,undefined);
  gate.resolve(); await connect; await cancel;
  assert.equal(fresh.phase,'stopped'); assert.equal(fresh.disconnecting,undefined); assert.equal(fresh.restartRequired,undefined);
  unsubscribe();
});

for (const wait of [false,true]) test(`cancel before deferred setup leaves fresh subscribers stopped and reconnectable (await drain=${wait})`, async () => {
  const h=syncHarness();
  const pending=h.connect();
  const cancelling=wait ? h.sync.disconnectStashSyncAndWait() : h.sync.disconnectStashSync();
  await pending; await cancelling;
  let fresh; h.sync.subscribeStashSyncStatus(status => { fresh=status; })();
  assert.equal(h.transports,0);
  assert.equal(fresh.phase,'stopped'); assert.equal(fresh.account,undefined);
  assert.equal(fresh.disconnecting,undefined); assert.equal(fresh.restartRequired,undefined);
  await h.connect(); await h.sync.disconnectStashSyncAndWait();
  assert.equal(h.transports,1);
});

test('reentrant stop never delivers a superseded account snapshot to later subscribers during drain', async () => {
  const h=syncHarness(), gate=deferred(); let read, triggered=false, mounted;
  h.options.read=async sql => { if (sql.includes('crsql_changes')) await gate.promise; return []; };
  const first=h.sync.subscribeStashSyncStatus(status => {
    if (status.account && !triggered) {
      triggered=true;
      read=h.replica.pullChangeset([0n,0],[],false);
      h.sync.disconnectStashSync();
    }
  });
  const second=h.sync.subscribeStashSyncStatus(status => { mounted=status; });
  await h.connect(); await tick();
  let fresh; h.sync.subscribeStashSyncStatus(status => { fresh=status; })();
  const duringDrain=mounted;
  let finished=false;
  const draining=h.sync.disconnectStashSyncAndWait().then(() => { finished=true; });
  await tick(); const stillPending=!finished;
  gate.resolve(); await read; await draining;
  first(); second();
  assert.equal(stillPending,true);
  assert.equal(duringDrain.phase,fresh.phase);
  assert.equal(duringDrain.phase,'stopped'); assert.equal(duringDrain.account,undefined);
  assert.equal(duringDrain.disconnecting,true); assert.equal(fresh.disconnecting,true);
});

test('cancelled startup teardown failure is restart-required for fresh subscribers', async () => {
  const h=syncHarness(), gate=deferred(); h.startGate=gate; h.stopError=Error('cancel cleanup failed');
  const connect=h.connect(); await tick();
  const cancel=h.sync.disconnectStashSyncAndWait();
  gate.resolve();
  await assert.rejects(connect,/cancel cleanup failed/);
  await assert.rejects(cancel,/cancel cleanup failed/);
  let fresh; h.sync.subscribeStashSyncStatus(status => { fresh=status; })();
  assert.equal(fresh.restartRequired,true); assert.equal(fresh.account,undefined); assert.equal(fresh.disconnecting,undefined);
});

test('teardown metadata observers can reenter disconnect without bypassing drain or duplicating custom phases', async () => {
  const h=syncHarness(), gate=deferred(), phases=[]; let reentrantDrain;
  const connection=await h.connect(status => phases.push(status.phase));
  h.options.read=async sql => { if (sql.includes('crsql_changes')) await gate.promise; return []; };
  const read=h.replica.pullChangeset([0n,0],[],false);
  const unsubscribe=h.sync.subscribeStashSyncStatus(status => {
    if (status.disconnecting && !reentrantDrain) reentrantDrain=h.sync.disconnectStashSyncAndWait();
  });
  connection.stop(); await tick();
  assert.ok(reentrantDrain);
  let completed=false; void reentrantDrain.then(() => { completed=true; });
  await tick(); assert.equal(completed,false);
  gate.resolve(); await read; await reentrantDrain;
  assert.equal(completed,true); assert.deepEqual(phases,['connecting','syncing','stopped']);
  unsubscribe();
});

function feedReadyHarness() {
  const h=syncHarness();
  h.options.statusResponse=async () => ({ok:true,json:async()=>({schema:'test',schemaVersion:'1',serverSiteId:'11'.repeat(16),clientSiteId:'00'.repeat(16),serverVersion:'0',clientSeenVersion:'0'})});
  return h;
}
test('actual session feed helper requires completed sync, scopes credentials and blocks unuploaded enable', async () => {
  const h=feedReadyHarness(), calls=[];
  await assert.rejects(h.sync.requestStashFolderFeed('f','status'),/Connect/);
  h.options.feedResponse=async(url,opts)=>{calls.push({url,opts});return new Response('{"enabled":false}',{headers:{'Content-Type':'application/json'}});};
  await h.connect(); await tick();
  try {
    const response=await h.sync.requestStashFolderFeed('folder/slash','status');
    assert.equal((await response.json()).enabled,false);
    assert.equal(calls[0].url.toString(),'http://localhost/api/folders/folder%2Fslash/feed');
    assert.equal(calls[0].opts.headers.Authorization,'Basic '+Buffer.from('test:test').toString('base64'));
    assert.equal(calls[0].opts.redirect,'error');
    await h.sync.requestStashFolderFeed('f',true);
    assert.equal(calls[1].opts.method,'PUT');assert.deepEqual(JSON.parse(calls[1].opts.body),{enabled:true});
    await h.sync.requestStashFolderFeed('f','preview');assert.match(calls[2].url.pathname,/\/feed\/preview$/);
    await h.api.withAppDb(async db=>{const first=db.getFirstAsync;db.getFirstAsync=async(sql,...args)=>sql.includes('FROM crsql_changes')?{version:5}:first(sql,...args);});
    await assert.rejects(h.sync.requestStashFolderFeed('f',true),/finish syncing/);
    assert.equal(calls.length,3,'no enable command before outbound barrier');
  } finally {await h.sync.disconnectStashSyncAndWait();}
  await assert.rejects(h.sync.requestStashFolderFeed('f',false),/Connect/);
});
test('signout aborts and drains actual feed body reads; late success cannot cross into next session', async () => {
  const h=feedReadyHarness(), body=deferred();let signal;
  h.options.feedResponse=async(_url,opts)=>{signal=opts.signal;return {status:200,headers:new Headers(),text:()=>body.promise};};
  await h.connect();await tick();
  const request=h.sync.requestStashFolderFeed('f',true);const rejected=assert.rejects(request,/cancelled|Session changed/);
  await tick();let done=false;const stop=h.sync.disconnectStashSyncAndWait().then(()=>{done=true;});
  await tick();assert.equal(signal.aborted,true);assert.equal(done,false);
  body.resolve('{"enabled":true}');await rejected;await stop;assert.equal(done,true);
  await h.connect();await tick();
  h.options.feedResponse=async()=>new Response('{"enabled":false}');
  assert.equal((await (await h.sync.requestStashFolderFeed('f','status')).json()).enabled,false);
  await h.sync.disconnectStashSyncAndWait();
});
test('same-signature recovery after a transient outage restores feed controls without reprojection', {timeout:7000}, async () => {
  const h=feedReadyHarness(), first=h.options.statusResponse, outage=deferred(), recovered=deferred();
  let polls=0, synced=0, projections=0;
  h.sync.subscribeStashSyncProjection(()=>projections++);
  h.options.statusResponse=async()=>{polls++;if(polls===2)throw Error('temporary feed outage');return first();};
  h.options.feedResponse=async()=>new Response('{}');
  const unsubscribe=h.sync.subscribeStashSyncStatus(s=>{
    if(s.phase==='error' && /temporary feed outage/.test(s.message))outage.resolve();
    if(s.phase==='synced' && ++synced===2)recovered.resolve();
  });
  try {
    await h.connect();await outage.promise;
    await assert.rejects(h.sync.requestStashFolderFeed('f','status'),/unavailable|incomplete/);
    await recovered.promise;
    assert.equal((await h.sync.requestStashFolderFeed('f','status')).status,200);
    assert.equal(projections,1);
  } finally {unsubscribe();await h.sync.disconnectStashSyncAndWait();}
});

function savedClientHarness(h) {
  const records=new Map();
  const identity=load('src/db/syncIdentity.ts',{});
  const core=load('src/db/savedSyncLogin.ts',{'./syncIdentity':identity});
  const storage=load('src/db/syncLoginStorage.ts',{
    './syncIdentity':identity,
    'expo-secure-store':{
      getItemAsync:async key=>records.get(key)??null,
      setItemAsync:async(key,value)=>records.set(key,value),
      deleteItemAsync:async key=>records.delete(key),
    },
  });
  const login=load('src/db/syncLogin.ts',{
    './syncClient':h.sync,'./savedSyncLogin':core,'./syncLoginStorage':storage,
    '../utils/syncBuildGate':{STASH_SYNC_DEV_TOOLS:true},
  });
  return {login,records,seed(){records.set('stash.sync.login.v1',JSON.stringify({version:1,serverUrl:'https://sync.example/',username:'alice',password:'synthetic'}));}};
}
for(const code of [401,403]) test(`actual health HTTP ${code} never starts transport, never persists a rejected login`,async()=>{
  const h=syncHarness(),s=savedClientHarness(h);h.options.healthStatus=code;
  await s.login.signInStashSync('https://sync.example/','alice','synthetic');await tick();
  assert.equal(h.transports,0);assert.equal(s.records.size,0);
  let saved;s.login.subscribeSavedStashLogin(next=>{saved=next;})();assert.match(saved.message,/rejected.*cleared/);
});

test('actual poll invalid auth stops/drains native transport, clears saved login, and never retries bad credentials',async()=>{
  const h=syncHarness(),s=savedClientHarness(h),rejected=deferred();s.seed();
  h.options.statusResponse=async()=>({ok:false,status:401});
  h.sync.subscribeStashSyncStatus(status=>{if(status.authenticationRequired)rejected.resolve();});
  await s.login.bootstrapSavedStashLogin();await rejected.promise;await tick();
  await h.sync.disconnectStashSyncAndWait();assert.equal(s.records.size,0);assert.equal(h.stops,1);
  await s.login.bootstrapSavedStashLogin();assert.equal(h.transports,1);
  await assert.rejects(h.sync.requestStashFolderFeed('folder','status'),/Connect in Settings/);
});

for(const phase of ['health','startup']) test(`actual saved bootstrap signout during delayed ${phase} cannot revive old session or write credentials`,async()=>{
  const h=syncHarness(),s=savedClientHarness(h),gate=deferred();s.seed();
  if(phase==='health')h.healthGate=gate;else h.startGate=gate;
  const boot=s.login.bootstrapSavedStashLogin();await tick();
  const stop=s.login.forgetSavedStashLogin();await tick();gate.resolve();await boot;await stop;
  assert.equal(s.records.size,0);let status;h.sync.subscribeStashSyncStatus(next=>{status=next;})();assert.equal(status.account,undefined);
  assert.equal(h.transports,phase==='health'?0:1);assert.equal(h.stops,phase==='health'?0:1);
});

test('actual account replacement cancels a delayed restored health check before starting the new account',async()=>{
  const h=syncHarness(),s=savedClientHarness(h),gate=deferred();s.seed();h.healthGate=gate;
  const boot=s.login.bootstrapSavedStashLogin();await tick();
  const next=s.login.signInStashSync('https://other.example/','bob','other-synthetic');await tick();
  h.healthGate=null;gate.resolve();await boot;await next;
  assert.equal(h.transports,1);assert.equal(JSON.parse([...s.records.values()][0]).username,'bob');
  let status;h.sync.subscribeStashSyncStatus(next=>{status=next;})();assert.equal(status.account.username,'bob');
  await s.login.forgetSavedStashLogin();assert.equal(h.stops,1);assert.equal(s.records.size,0);
});
