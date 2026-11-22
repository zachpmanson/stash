const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeHarness } = require('./restore-test-harness.cjs');

const logPath = h => new h.File(h.Paths.cache, 'stash-app-events-v1.json');

test('app log survives restart, keeps the newest 200 events, and rejects private fields', async t => {
  const h = await createNativeHarness(); t.after(() => h.cleanup());
  const { recordAppEvent } = h.load('src/utils/appLogs.ts');
  h.options.now = 1000;
  recordAppEvent('backup.created');
  for (let i = 0; i < 199; i++) recordAppEvent('sync.connecting');
  recordAppEvent('https://secret.example/');
  recordAppEvent('image.upload_failed', 415);
  recordAppEvent('image.download_failed', 'secret filename');
  assert.ok(logPath(h).size < 24 * 1024);
  await h.restart();
  const output = h.load('src/utils/appLogs.ts').formatAppLog();
  assert.equal(output.trimEnd().split('\n').length, 200);
  assert.match(output, /1970-01-01T00:00:01\.000Z  image\.upload_failed  HTTP 415/);
  assert.match(output, /image\.download_failed\n$/);
  assert.doesNotMatch(output, /backup\.created|secret/);
});

test('invalid persisted entries are never exported and cache write failures do not prevent in-memory export', async t => {
  const h = await createNativeHarness(); t.after(() => h.cleanup());
  const file = logPath(h); file.create();
  file.write(JSON.stringify([[500, 'app.started'], [600, 'secret'], [700, 'sync.error', 'secret'],
    [800, 'image.upload_failed', 800], [900, 'sync.synced', 200, 'secret'], [9e15, 'backup.failed']]));
  const { recordAppEvent, formatAppLog } = h.load('src/utils/appLogs.ts');
  h.options.writeFailure = () => true;
  assert.doesNotThrow(() => recordAppEvent('restore.completed'));
  assert.match(formatAppLog(), /app\.started\n.*restore\.completed\n$/);
  assert.doesNotMatch(formatAppLog(), /secret|sync\.|backup\.|HTTP/);
});

test('export shares only a plain-text snapshot and permits retry if native sharing fails', async t => {
  const h = await createNativeHarness(); t.after(() => h.cleanup());
  const { exportAppLogs } = h.load('src/utils/appLogExport.ts');
  h.load('src/utils/appLogs.ts').recordAppEvent('app.started');
  h.options.sharingAvailable = false;
  await assert.rejects(exportAppLogs(), /unavailable/);
  h.options.sharingAvailable = true;
  const uris = new Set();
  h.options.shareAsync = async (uri, options) => {
    assert.ok(!uris.has(uri), 'each export has a fresh URI');
    uris.add(uri);
    assert.match(uri, /\/stash-logs-\d+-[\w-]+\.txt$/);
    assert.notEqual(uri, logPath(h).uri);
    assert.equal(options.mimeType, 'text/plain');
    assert.match(new h.File(uri).textSync(), /^Stash 1\.0\.0 \(android\)\nExported .*\n\n.*app\.started\n$/);
    if (uris.size === 1) throw Error('chooser failed');
  };
  await assert.rejects(exportAppLogs(), /chooser failed/);
  await Promise.all([exportAppLogs(), exportAppLogs()]);
  assert.equal(uris.size, 2, 'only one chooser per simultaneous attempt');
  for (let i = 0; i < 8; i++) await exportAppLogs();
  assert.equal(new h.Directory(h.Paths.cache, 'stash-log-exports').list().length, 8);
});
