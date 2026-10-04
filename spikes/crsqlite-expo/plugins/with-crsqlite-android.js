const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

module.exports = function withCrsqliteAndroid(config) {
  return withDangerousMod(config, ["android", async (modConfig) => {
    const source = path.resolve(modConfig.modRequest.projectRoot, "native/arm64-v8a/libcrsqlite.so");
    if (!fs.existsSync(source)) {
      throw new Error("CR-SQLite Android binary missing; run scripts/prepare-android-crsqlite.sh first");
    }

    const destination = path.join(
      modConfig.modRequest.platformProjectRoot,
      "app/src/main/jniLibs/arm64-v8a/libcrsqlite.so",
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return modConfig;
  }]);
};
