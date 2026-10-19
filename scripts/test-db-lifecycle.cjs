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
    console, Uint8Array, URL, AbortController, setTimeout, clearTimeout,
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
        getFirstAsync: async sql => sql.includes('crsql_site_id')
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
  const api = load('src/db/database.ts', { 'expo-sqlite': sqlite, 'react-native': { Platform: { OS: 'android' } } });
  return { api, sqlite, options, events, handles };
}
function syncHarness() {
  const h = databaseHarness();
  let replica, statusSignal, startGate, stopError, healthGate;
  let transports = 0, stops = 0;
  const api = load('src/db/syncClient.ts', {
    'expo-sqlite': h.sqlite, './database': h.api,
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
          start: async () => { if (startGate) await startGate.promise; },
          // Intentionally omit replica.close(): verify app fallback cleanup.
          stop: () => { stops++; if (stopError) throw stopError; },
        };
      },
    },
    fetch: async (url, { signal }) => {
      if (url.pathname.endsWith('healthz')) {
        if (healthGate) await healthGate.promise;
        return { ok: true, json: async () => ({ schema: 'test', schemaVersion: '1' }) };
      }
      statusSignal = signal;
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
  const h = syncHarness(), phases = [];
  const unsubscribe = h.sync.subscribeStashSyncStatus(() => { throw new Error('subscriber failed'); });
  h.sync.subscribeStashSyncStatus(status => phases.push(status.phase));
  await h.connect();
  await h.sync.withStashSyncRestoreLock(async () => {});
  assert.deepEqual(phases, ['stopped', 'connecting', 'syncing', 'stopped']);
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
