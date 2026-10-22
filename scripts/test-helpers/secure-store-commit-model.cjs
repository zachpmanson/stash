// Synthetic SharedPreferences memory/disk boundary, NOT Android/Keystore execution.
// Bind the modeled control flow to installed Kotlin and reconstruct the exact
// upstream negative control by reversing our version-pinned patch. Crypto is not
// modeled; test records stand in for encrypted values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const relativeSource = 'android/src/main/java/expo/modules/securestore/SecureStoreModule.kt';
const packageRoot = path.dirname(require.resolve('expo-secure-store/package.json'));
const installed = fs.readFileSync(path.join(packageRoot, relativeSource), 'utf8');
const patch = path.join(root, 'patches/expo-secure-store@55.0.18.patch');
assert.equal(require(path.join(packageRoot, 'package.json')).version, '55.0.18');
assert.match(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'), /expo-secure-store@55\.0\.18: patches\/expo-secure-store@55\.0\.18\.patch/);
const hash = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8').match(/expo-secure-store@55\.0\.18: ([a-f0-9]{64})/)[1];
assert.ok(fs.realpathSync(packageRoot).includes(`patch_hash=${hash}`), 'installed dependency must use the locked patch');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-secure-store-source-'));
let upstream;
try {
  fs.mkdirSync(path.dirname(path.join(temporary, relativeSource)), { recursive: true });
  fs.writeFileSync(path.join(temporary, relativeSource), installed);
  execFileSync('git', ['apply', '--reverse', patch], { cwd: temporary });
  upstream = fs.readFileSync(path.join(temporary, relativeSource), 'utf8');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

function policy(source, patched) {
  const get = source.split('private suspend fun getItemImpl(')[1].split('private suspend fun readJSONEncodedItem(')[0];
  assert.match(get, /prefs\.contains\(keychainAwareKey\)/);
  assert.match(get, /prefs\.contains\(key\)/);
  assert.doesNotMatch(get, /legacyPrefs|getDefaultSharedPreferences/);
  const set = source.split('private suspend fun setItemImpl(')[1].split('private fun saveEncryptedItem(')[0];
  const save = source.split('private fun saveEncryptedItem(')[1].split('private fun deleteItemImpl(')[0];
  const remove = source.split('private fun deleteItemImpl(')[1].split('private fun removeKeyFromKeystore(')[0];
  assert.match(save, /return prefs\.edit\(\)\.putString\(key, encryptedItemString\)\.commit\(\)/);
  assert.match(remove, /if \(!success\) \{\s*throw DeleteException\(/);
  assert.doesNotMatch(remove, /\.clear\(/);
  if (patched) {
    assert.match(set, /if \(!saveEncryptedItem\(encryptedItem, prefs, keychainAwareKey, options\.requireAuthentication, options\.keychainService\)\) \{\s*throw WriteException\(/);
    assert.doesNotMatch(remove, /\.contains\(/);
    assert.match(remove, /var success = prefs\.edit\(\)\.remove\(keychainAwareKey\)\.remove\(key\)\.commit\(\)/);
    assert.match(remove, /success = legacyPrefs\.edit\(\)\.remove\(key\)\.commit\(\) && success/);
    assert.equal((remove.match(/\.commit\(\)/g) || []).length, 2);
    return { checksSave: true, groups: [['current', ['aware', 'raw']], ['legacy', ['raw']]], gated: false };
  }
  assert.match(set, /\n      saveEncryptedItem\(encryptedItem, prefs, keychainAwareKey, options\.requireAuthentication, options\.keychainService\)\n/);
  for (const [prefs, key] of [['prefs', 'keychainAwareKey'], ['prefs', 'key'], ['legacyPrefs', 'key']]) {
    assert.ok(remove.includes(`if (${prefs}.contains(${key})) {\n      success = ${prefs}.edit().remove(${key}).commit()`));
  }
  assert.equal((remove.match(/\.commit\(\)/g) || []).length, 3);
  return { checksSave: false, groups: [['current', ['aware']], ['current', ['raw']], ['legacy', ['raw']]], gated: true };
}
const policies = { installed: policy(installed, true), upstream: policy(upstream, false) };

function secureStoreCommitModel({ original = false, disk = { current: new Map(), legacy: new Map() } } = {}) {
  const control = policies[original ? 'upstream' : 'installed'];
  const memory = { current: new Map(disk.current), legacy: new Map(disk.legacy) };
  const failures = { current: 0, legacy: 0, write: 0 }, commits = [];
  const keys = (key, options) => ({ aware: `${options.keychainService}-${key}`, raw: key });
  function commit(store, removals, write) {
    for (const key of removals) memory[store].delete(key);
    if (write) memory[store].set(...write);
    // Like AOSP, memory changes BEFORE a disk commit can return false.
    const failureKind = write ? 'write' : store;
    const success = failures[failureKind] === 0;
    if (!success) failures[failureKind]--;
    else { disk[store].clear(); for (const [key, value] of memory[store]) disk[store].set(key, value); }
    commits.push({ store, removals, success });
    return success;
  }
  return {
    disk, memory, failures, commits,
    seed(login, location = 'aware') {
      const key = location === 'aware' ? 'stash.sync.login-stash.sync.login.v1' : 'stash.sync.login.v1';
      const store = location === 'legacy' ? 'legacy' : 'current';
      disk[store].set(key, JSON.stringify(login)); memory[store].set(key, JSON.stringify(login));
    },
    native: {
      async getItemAsync(key, options) {
        const { aware } = keys(key, options);
        // This pinned version reads current/old-format SecureStore keys only;
        // delete also cleans default legacy preferences, but get does not read them.
        return memory.current.get(aware) ?? memory.current.get(key) ?? null;
      },
      async setItemAsync(key, value, options) {
        const success = commit('current', [], [keys(key, options).aware, value]);
        if (!success && control.checksSave) throw Error('WriteException: synthetic-secret');
      },
      async deleteItemAsync(key, options) {
        const names = keys(key, options); let success = true;
        for (const [store, namesToRemove] of control.groups) {
          const removals = namesToRemove.map(name => names[name]);
          if (!control.gated || memory[store].has(removals[0])) success = commit(store, removals) && success;
        }
        if (!success) throw Error('DeleteException: synthetic-secret');
      },
    },
  };
}
module.exports = { secureStoreCommitModel };
