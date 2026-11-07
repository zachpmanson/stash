// Execute the actual policy module, not a mocked availability constant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(readFileSync(path.join(__dirname, '../src/utils/syncBuildGate.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

for (const platform of ['android', 'ios', 'web']) {
  for (const dev of [false, true]) {
    for (const flag of [undefined, '0', '1']) {
      test(`sync availability: platform=${platform}, __DEV__=${dev}, legacy flag=${flag}`, () => {
        const module = { exports: {} };
        vm.runInNewContext(code, {
          module, exports: module.exports, __DEV__: dev,
          process: { env: flag === undefined ? {} : { EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS: flag } },
          require: spec => {
            assert.equal(spec, 'react-native');
            return { Platform: { OS: platform } };
          },
        });
        assert.equal(module.exports.STASH_SYNC_DEV_TOOLS, platform === 'android');
      });
    }
  }
}

test('availability needs no development or environment globals', () => {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: () => ({ Platform: { OS: 'android' } }),
  });
  assert.equal(module.exports.STASH_SYNC_DEV_TOOLS, true);
});
