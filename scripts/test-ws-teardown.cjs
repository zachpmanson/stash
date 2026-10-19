// Run with: direnv exec . node --test scripts/test-ws-teardown.cjs
// Exercise both the package's TypeScript sources and the dist files Metro loads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.WS_CLIENT_ROOT || path.dirname(path.dirname(require.resolve('@vlcn.io/ws-client')));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(tree) {
  const cache = new Map();
  const timers = new Map();
  let timerId = 0;
  const common = {
    tags: { AnnouncePresence: 1, Changes: 2, StartStreaming: 3, RejectChanges: 4 },
    encode: x => x, decode: x => x,
    bytesToHex: bytes => Buffer.from(bytes).toString('hex'),
  };
  class Socket {
    static OPEN = 1;
    static CLOSED = 3;
    static instances = [];
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    listeners = {};
    constructor(...args) { this.args = args; Socket.instances.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    send(msg) { this.sent.push(msg); }
    close() { this.readyState = Socket.CLOSED; this.closeCount = (this.closeCount || 0) + 1; }
  }
  const schedule = fn => { timers.set(++timerId, fn); return timerId; };
  function load(relative) {
    let filename = path.join(root, tree, relative);
    filename = filename.replace(/\.(js|ts)$/, tree === 'src' ? '.ts' : '.js');
    if (!path.extname(filename)) filename += tree === 'src' ? '.ts' : '.js';
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: filename.replace(/\.js$/, '.ts'),
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports,
      require: spec => {
        if (spec === '@vlcn.io/ws-common') return common;
        return load(path.relative(path.join(root, tree), path.resolve(path.dirname(filename), spec)));
      },
      WebSocket: Socket, btoa: value => Buffer.from(value).toString('base64'),
      Uint8Array, console,
      setTimeout: schedule, setInterval: schedule,
      clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    }, { filename });
    return module.exports;
  }
  return { load, Socket, timers };
}

for (const tree of ['src', 'dist']) {
  test(`${tree}: closed transport never reopens or invokes stale callbacks`, () => {
    const h = harness(tree);
    const Transport = h.load('transport/WebSocketTransport').default;
    const transport = new Transport({ url: 'ws://test', room: 'test', headers: { Authorization: 'test' } });
    let ready = 0;
    transport.start(() => ready++);
    const first = h.Socket.instances[0];
    assert.equal(first.args[2].headers.Authorization, 'test');
    first.readyState = h.Socket.OPEN;
    first.onopen();
    assert.equal(ready, 1);
    first.close();
    const retry = [...h.timers.values()][0];
    retry();
    assert.equal(h.Socket.instances.length, 2);
    const second = h.Socket.instances[1];
    first.onopen();
    first.listeners.message({ data: new ArrayBuffer(0) }); // stale event must not decode
    assert.equal(ready, 1);
    transport.close();
    transport.close();
    second.onopen();
    second.listeners.message({ data: new ArrayBuffer(0) });
    transport.start(() => ready++);
    retry(); // already queued interval callback
    assert.equal(ready, 1);
    assert.equal(h.Socket.instances.length, 2);
    assert.equal(second.closeCount, 1);
    assert.equal(h.timers.size, 0);
    assert.equal(transport.sendChanges({}), 'reconnecting');
    transport.announcePresence({});
    transport.rejectChanges({});
    assert.equal(second.sent.length, 0);
  });

  test(`${tree}: stop discards an in-flight outbound pull and captured listener`, async () => {
    const h = harness(tree);
    const Outbound = h.load('streams/OutboundStream').default;
    const pull = deferred();
    let listener, disposed = 0, pulls = 0, sent = 0;
    const stream = new Outbound({
      onChange: fn => { listener = fn; return () => disposed++; },
      pullChangeset: () => { pulls++; return pull.promise; },
    }, { sendChanges: () => { sent++; return 'sent'; } });
    await stream.startStreaming({ since: [0n, 0], excludeSites: [], localOnly: false });
    stream.stop();
    stream.stop();
    listener();
    pull.resolve([[null, null, null, null, null, 1n]]);
    await tick();
    assert.equal(pulls, 1);
    assert.equal(sent, 0);
    assert.equal(disposed, 1);
    assert.equal(h.timers.size, 0);
  });

  test(`${tree}: stop cancels outbound reconnect retry`, async () => {
    const h = harness(tree);
    const Outbound = h.load('streams/OutboundStream').default;
    let sent = 0;
    const stream = new Outbound({
      onChange: () => () => {},
      pullChangeset: async () => [[null, null, null, null, null, 1n]],
    }, { sendChanges: () => { sent++; return 'reconnecting'; } });
    await stream.startStreaming({ since: [0n, 0], excludeSites: [], localOnly: false });
    await tick();
    assert.equal(h.timers.size, 1);
    const retry = [...h.timers.values()][0];
    stream.stop();
    retry();
    await tick();
    assert.equal(sent, 1);
    assert.equal(h.timers.size, 0);
  });

  for (const phase of ['last-seens', 'schema', 'ready']) {
    test(`${tree}: stop during ${phase} prevents delayed startup`, async () => {
      const h = harness(tree);
      const gate = deferred();
      let starts = 0, announced = 0, closed = 0, dbClosed = 0, ready;
      const transport = {
        start: fn => { starts++; ready = fn; },
        announcePresence: () => announced++, close: () => closed++,
      };
      const database = {
        siteid: new Uint8Array([1]), onChange: () => () => {},
        getLastSeens: () => phase === 'last-seens' ? gate.promise : Promise.resolve([]),
        getSchemaNameAndVersion: () => phase === 'schema' ? gate.promise : Promise.resolve(['test', 1]),
        close: () => dbClosed++,
      };
      const synced = await h.load('SyncedDB').createSyncedDB({
        dbProvider: async () => database, transportProvider: () => transport,
      }, 'test', {});
      const starting = synced.start();
      await tick();
      assert.equal(synced.stop(), true);
      assert.equal(synced.stop(), false);
      gate.resolve(phase === 'last-seens' ? [] : ['test', 1]);
      await starting;
      if (ready) ready();
      await synced.start();
      assert.equal(starts, phase === 'ready' ? 1 : 0);
      assert.equal(announced, 0);
      assert.equal(closed, 1);
      assert.equal(dbClosed, 1);
      assert.equal(transport.onChangesReceived, null);
      assert.equal(transport.onStartStreaming, null);
      assert.equal(transport.onResetStream, null);
    });
  }

  test(`${tree}: cleanup continues when listener disposal throws`, async () => {
    const h = harness(tree);
    let closed = 0, dbClosed = 0;
    const synced = await h.load('SyncedDB').createSyncedDB({
      dbProvider: async () => ({
        onChange: () => () => { throw new Error('dispose failed'); }, close: () => dbClosed++,
      }),
      transportProvider: () => ({ close: () => closed++ }),
    }, 'test', {});
    assert.throws(() => synced.stop(), /dispose failed/);
    assert.equal(closed, 1);
    assert.equal(dbClosed, 1);
    assert.equal(synced.stop(), false);
  });
}
