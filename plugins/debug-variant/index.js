const {
  withAppBuildGradle,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Debug builds get their own app label and applicationId suffix so they can
// be installed and identified alongside the release build:
//   - label:   "Stash (debug)"   (via a debug source-set manifest overlay)
//   - app id:  com.zachmanson.stash.debug
// Both edits live in the generated android/ dir, so they must be re-applied
// by this plugin on every `expo prebuild`.
module.exports = function withDebugVariant(config) {
  // 1. Write android/app/src/debug/AndroidManifest.xml — the Android build
  //    system merges this overlay into debug builds only, overriding the label.
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const debugSrc = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "debug",
      );
      fs.mkdirSync(debugSrc, { recursive: true });
      const manifest = path.join(debugSrc, "AndroidManifest.xml");
      const content = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:tools="http://schemas.android.com/tools">
  <application android:label="Stash (debug)" tools:replace="android:label" />
</manifest>
`;
      fs.writeFileSync(manifest, content);
      return config;
    },
  ]);

  // 2. Add applicationIdSuffix ".debug" to the debug buildType in build.gradle.
  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('applicationIdSuffix ".debug"')) {
      const updated = contents.replace(
        /(\s*debug\s*\{[^}]*?)(\})/,
        (match, head) => {
          // avoid double-application if the block already has it
          if (head.includes("applicationIdSuffix")) return match;
          return `${head}            applicationIdSuffix ".debug"\n        }`;
        },
      );
      if (updated !== contents) {
        config.modResults.contents = updated;
      }
    }
    return config;
  });

  return config;
};
