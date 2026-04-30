const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withMainApplication,
  withAndroidManifest,
  withAppBuildGradle,
} = require("@expo/config-plugins");

const KOTLIN_FILES = [
  "MediaSessionModule.kt",
  "MediaSessionPackage.kt",
  "MediaPlaybackService.kt",
];

function copyKotlinSources(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const pkg = config.android?.package;
      if (!pkg) throw new Error("withMediaSessionModule: android.package is required");

      const pkgDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/java",
        pkg.replace(/\./g, "/"),
      );
      fs.mkdirSync(pkgDir, { recursive: true });

      for (const filename of KOTLIN_FILES) {
        const src = fs.readFileSync(path.join(__dirname, filename), "utf8");
        fs.writeFileSync(path.join(pkgDir, filename), src.replace("__PACKAGE__", pkg));
      }
      return config;
    },
  ]);
}

function registerPackageInMainApplication(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    if (src.includes("MediaSessionPackage()")) return config;

    const applyBlockRegex = /PackageList\(this\)\.packages\s*\.apply\s*\{([\s\S]*?)\}/;
    if (applyBlockRegex.test(src)) {
      src = src.replace(applyBlockRegex, (_, body) =>
        `PackageList(this).packages.apply {${body.replace(/\s*$/, "")}\n          add(MediaSessionPackage())\n        }`,
      );
    } else {
      src = src.replace(
        /PackageList\(this\)\.packages/,
        "PackageList(this).packages.apply {\n          add(MediaSessionPackage())\n        }",
      );
    }
    config.modResults.contents = src;
    return config;
  });
}

const SERVICE_NAME = ".MediaPlaybackService";

function registerService(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;

    const existing = application.service ?? [];
    const filtered = existing.filter((s) => s.$?.["android:name"] !== SERVICE_NAME);
    filtered.push({
      $: {
        "android:name": SERVICE_NAME,
        "android:exported": "false",
        "android:foregroundServiceType": "mediaPlayback",
      },
    });
    application.service = filtered;
    return config;
  });
}

const MEDIA_DEP = "implementation 'androidx.media:media:1.7.0'";

function addMediaDependency(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(MEDIA_DEP)) return config;
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*\{/,
      `dependencies {\n    ${MEDIA_DEP}`,
    );
    return config;
  });
}

module.exports = function withMediaSessionModule(config) {
  config = copyKotlinSources(config);
  config = registerPackageInMainApplication(config);
  config = registerService(config);
  config = addMediaDependency(config);
  return config;
};
