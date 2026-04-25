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

const SHARE_ALIAS_NAME = ".ShareActivity";
const SHARE_THEME_NAME = "Theme.ShareTransparent";

function addShareActivityAlias(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;

    const intentFilter = (action) => ({
      $: { "android:autoVerify": "false" },
      action: [{ $: { "android:name": action } }],
      data: [{ $: { "android:mimeType": "image/*" } }],
      category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
    });

    const alias = {
      $: {
        "android:name": SHARE_ALIAS_NAME,
        "android:targetActivity": ".MainActivity",
        "android:taskAffinity": "com.zachmanson.stash.share",
        "android:launchMode": "singleInstancePerTask",
        "android:excludeFromRecents": "true",
        "android:exported": "true",
        "android:theme": `@style/${SHARE_THEME_NAME}`,
      },
      "intent-filter": [
        intentFilter("android.intent.action.SEND"),
        intentFilter("android.intent.action.SEND_MULTIPLE"),
      ],
    };

    const existing = application["activity-alias"] ?? [];
    const filtered = existing.filter((a) => a.$?.["android:name"] !== SHARE_ALIAS_NAME);
    application["activity-alias"] = [...filtered, alias];

    return config;
  });
}

const { withAndroidStyles } = require("@expo/config-plugins");

function addShareTransparentStyle(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style ?? [];
    const filtered = styles.filter((s) => s.$?.name !== SHARE_THEME_NAME);
    filtered.push({
      $: { name: SHARE_THEME_NAME, parent: "AppTheme" },
      item: [
        { $: { name: "android:windowIsTranslucent" }, _: "true" },
        { $: { name: "android:windowBackground" }, _: "@android:color/transparent" },
        { $: { name: "android:colorBackgroundCacheHint" }, _: "@null" },
        { $: { name: "android:windowNoTitle" }, _: "true" },
        { $: { name: "android:windowAnimationStyle" }, _: "@android:style/Animation" },
      ],
    });
    config.modResults.resources.style = filtered;
    return config;
  });
}

module.exports = function withShareIntentModule(config) {
  config = copyKotlinSources(config);
  config = registerPackageInMainApplication(config);
  config = setMainActivityLaunchMode(config);
  config = addShareActivityAlias(config);
  config = addShareTransparentStyle(config);
  return config;
};
