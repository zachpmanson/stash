const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.resolve(__dirname, '../plugins/text-selection-module');

test('tracked TextSelection plugin copies Kotlin and registers exactly once for clean Expo templates', async t => {
  assert.ok(require('../app.json').expo.plugins.includes('./plugins/text-selection-module'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-selection-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const template of ['val packages = PackageList(this).packages', 'val packages = PackageList(this).packages.apply {\n  add(OtherPackage())\n}']) {
    let dangerous, application;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(directory, 'index.js'), 'utf8'), {
      module, __dirname: directory, require: spec => spec === '@expo/config-plugins' ? {
        withDangerousMod: (config, [, action]) => { dangerous = action; return config; },
        withMainApplication: (config, action) => { application = action; return config; },
      } : require(spec),
    });
    const config = { android: { package: 'com.example.reader' }, modRequest: { platformProjectRoot: root }, modResults: { contents: template } };
    module.exports(config); await dangerous(config); application(config); application(config);
    assert.equal(config.modResults.contents.match(/add\(TextSelectionPackage\(\)\)/g).length, 1);
    if (template.includes('OtherPackage')) assert.match(config.modResults.contents, /OtherPackage/);
    for (const file of ['TextSelectionModule.kt', 'TextSelectionPackage.kt']) {
      const generated = fs.readFileSync(path.join(root, 'app/src/main/java/com/example/reader', file), 'utf8');
      assert.equal(generated, fs.readFileSync(path.join(directory, file), 'utf8').replace('__PACKAGE__', 'com.example.reader'));
    }
    const kotlin = fs.readFileSync(path.join(directory, 'TextSelectionModule.kt'), 'utf8');
    assert.match(kotlin, /UiThreadUtil.runOnUiThread/); assert.match(kotlin, /activity\?\.window\?\.decorView\?\.rootView/);
    assert.match(kotlin, /findTextViewWithSelection\(view.getChildAt\(i\)\)/);
    assert.equal((kotlin.match(/surfaceTag/g) ?? []).length, 1, 'existing whole-activity selection semantics unchanged');
  }
});
