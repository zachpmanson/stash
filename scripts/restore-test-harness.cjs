// Real app source + pinned native SQLite; only Expo/filesystem/transport boundaries are controlled.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { createRequire } = require('node:module');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(project, 'spikes/crsqlite-expo/server/package.json'));
exports.createNativeHarness = async ({ actualSettings = false } = {}) => {
  const Database = serverRequire('better-sqlite3');
  const { extensionPath } = await import(pathToFileURL(serverRequire.resolve('@vlcn.io/crsqlite')));
  const { cryb64 } = await import(pathToFileURL(serverRequire.resolve('@vlcn.io/ws-common')));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-restore-test-'));
  const handles = [], events = [], options = { dev: true, platform: "android", optIn: false }, modules = new Map();
  const storage = new Map();
  const localPath = uri => uri.startsWith('file:') ? fileURLToPath(uri) : uri;
  const join = parts => path.join(...parts.map(part => localPath(typeof part === 'string' ? part : part.uri)));
  class File {
    constructor(...parts) { this.uri = pathToFileURL(join(parts)).href; this.name = path.basename(localPath(this.uri)); }
    get exists() { return fs.existsSync(localPath(this.uri)); }
    create({ overwrite = false, intermediates = false } = {}) {
      if (intermediates) fs.mkdirSync(path.dirname(localPath(this.uri)), { recursive: true });
      fs.writeFileSync(localPath(this.uri), '', { flag: overwrite ? 'w' : 'wx' });
    }
    write(bytes) {
      if (options.writeFailure?.(this.uri)) throw Error('injected write failure');
      fs.writeFileSync(localPath(this.uri), bytes);
    }
    bytesSync() { if (options.noBytes) throw Error("JS media buffering forbidden"); return fs.readFileSync(localPath(this.uri)); }
    async text() { return fs.readFileSync(localPath(this.uri), 'utf8'); }
    copy(dest) {
      if (options.copyFailure?.(dest.uri)) throw Error("injected copy failure");
      events.push(`copy:${dest.uri}`);
      fs.copyFileSync(localPath(this.uri), localPath(dest.uri));
    }
    delete() { fs.rmSync(localPath(this.uri), { force: true }); }
  }
  class Directory {
    constructor(...parts) { this.uri = pathToFileURL(join(parts)).href; this.name = path.basename(localPath(this.uri)); }
    get exists() { return fs.existsSync(localPath(this.uri)); }
    create({ intermediates = false, idempotent = false } = {}) {
      if (this.exists && idempotent) return;
      fs.mkdirSync(localPath(this.uri), { recursive: intermediates });
    }
    list() { return fs.readdirSync(localPath(this.uri), { withFileTypes: true }).map(entry => new (entry.isDirectory() ? Directory : File)(this, entry.name)); }
    delete() { fs.rmSync(localPath(this.uri), { recursive: true, force: true }); }
  }
  const Paths = { document: pathToFileURL(path.join(root, 'document')).href, cache: pathToFileURL(path.join(root, 'cache')).href };
  fs.mkdirSync(localPath(Paths.document)); fs.mkdirSync(localPath(Paths.cache));
  const params = args => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  function bridge(native, databasePath) {
    let closed = false;
    const db = {
      native, databasePath,
      getAllAsync: async (sql, ...args) => native.prepare(sql).all(...params(args)),
      getFirstAsync: async (sql, ...args) => native.prepare(sql).get(...params(args)) ?? null,
      runAsync: async (sql, ...args) => native.prepare(sql).run(...params(args)),
      execAsync: async sql => { if (sql.includes('crsql_finalize')) events.push(`finalize:${databasePath}`); native.exec(sql); },
      withTransactionAsync: async fn => { native.exec('BEGIN'); try { await fn(); native.exec('COMMIT'); } catch (error) { native.exec('ROLLBACK'); throw error; } },
      loadExtensionAsync: async () => native.loadExtension(extensionPath),
      serializeAsync: async () => native.serialize(),
      closeAsync: async () => { if (!closed) { native.close(); closed = true; events.push(`close:${databasePath}`); } },
    };
    handles.push(db); return db;
  }
  const sqlite = {
    openDatabaseAsync: async (name, _options, directory = new Directory(Paths.document, 'SQLite').uri) => {
      const filename = join([directory, name]); fs.mkdirSync(path.dirname(filename), { recursive: true });
      if (options.openFailure?.(filename)) throw Error('injected open failure');
      return bridge(new Database(filename), filename);
    },
    addDatabaseChangeListener: () => ({ remove() {} }),
  };
  let recipe = false;
  const mocks = {
    'expo-sqlite': sqlite, 'react-native': { Platform: { get OS() { return options.platform; } } },
    'expo-file-system': { File, Directory, Paths },
    'expo-file-system/legacy': { copyAsync: async ({ from, to }) => fs.copyFileSync(localPath(from), localPath(to)) },
    'expo-sharing': {},
    'react-native-zip-archive': { zip: async (from, to) => { fs.cpSync(localPath(from), localPath(to), { recursive: true }); return to; }, unzip: async (from, to) => fs.cpSync(localPath(from), localPath(to), { recursive: true }) },
    '@vlcn.io/ws-common': { cryb64 }, '@vlcn.io/ws-client': { createSyncedDB: (...args) => options.createSyncedDB(...args), defaultConfig: { transportProvider() {} } },
    'src/state/settingsState.ts': { useSettingsStore: { getState: () => ({ setAuRecipe: value => { recipe = value; } }) } },
    'src/utils/randomId.ts': { randomId: () => require('node:crypto').randomUUID() },
  };
  if (actualSettings) {
    delete mocks['src/state/settingsState.ts'];
    mocks['zustand'] = require('zustand');
    mocks['zustand/middleware'] = require('zustand/middleware');
    mocks['@react-native-async-storage/async-storage'] = { __esModule: true, default: {
      getItem: async key => { const value = storage.get(key) ?? null; if (options.hydrationGate) await options.hydrationGate; return value; },
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async key => storage.delete(key),
    } };
  }
  function load(file, extra = '') {
    if (modules.has(file)) return modules.get(file).exports;
    if (file in mocks) return mocks[file];
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(project, file), 'utf8') + (file === 'src/db/syncClient.ts' ? '\nexport { StashReplica, requireRecoveryCapability, isExchanged };' : '') + extra, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console, Uint8Array, URL, AbortController,
      __DEV__: options.dev, process: { env: { EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS: options.optIn ? "1" : undefined } }, setTimeout: (fn, ms) => setTimeout(fn, options.fastTimers ? Math.min(ms, 10) : ms), clearTimeout,
      btoa: value => Buffer.from(value).toString('base64'),
      fetch: (...args) => options.fetch(...args),
      require: spec => {
        if (spec in mocks) return mocks[spec];
        if (spec.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) + '.ts');
        throw Error(`Unexpected module ${spec}`);
      },
    }, { filename: file });
    return module.exports;
  }
  return {
    root, options, events, handles, File, Directory, Paths, localPath, sqlite, load, serverRequire, bridge, storage,
    get recipe() { return recipe; },
    async restart() {
      const api = load('src/db/database.ts');
      for (const db of handles) { try { await api.closeTemporaryDatabase(db); } catch {} }
      modules.clear();
    },
    async cleanup() {
      const api = load('src/db/database.ts');
      for (const db of handles.reverse()) { try { await api.closeTemporaryDatabase(db); } catch {} }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
};
