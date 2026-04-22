const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withMainApplication,
  withAndroidManifest,
  AndroidConfig,
} = require("@expo/config-plugins");

const KOTLIN_FILES = ["ShareIntentModule.kt", "ShareIntentPackage.kt"];

function copyKotlinSources(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const pkg = config.android?.package;
      if (!pkg) throw new Error("withShareIntentModule: android.package is required");

      const pkgDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/java",
        pkg.replace(/\./g, "/")
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
    if (src.includes("ShareIntentPackage()")) return config;

    // Insert `.apply { add(ShareIntentPackage()) }` onto `PackageList(this).packages`.
    // Handles both the bare form and an existing `.apply { ... }` block.
    const applyBlockRegex = /PackageList\(this\)\.packages\s*\.apply\s*\{([\s\S]*?)\}/;
    if (applyBlockRegex.test(src)) {
      src = src.replace(applyBlockRegex, (_, body) =>
        `PackageList(this).packages.apply {${body.replace(/\s*$/, "")}\n          add(ShareIntentPackage())\n        }`
      );
    } else {
      src = src.replace(
        /PackageList\(this\)\.packages/,
        "PackageList(this).packages.apply {\n          add(ShareIntentPackage())\n        }"
      );
    }
    config.modResults.contents = src;
    return config;
  });
}

function setMainActivityLaunchMode(config) {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivity(config.modResults);
    if (mainActivity) {
      mainActivity.$["android:launchMode"] = "singleTask";
    }
    return config;
  });
}

module.exports = function withShareIntentModule(config) {
  config = copyKotlinSources(config);
  config = registerPackageInMainApplication(config);
  config = setMainActivityLaunchMode(config);
  return config;
};
