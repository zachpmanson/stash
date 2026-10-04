const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

module.exports = function withCrsqliteAndroid(config) {
  return withDangerousMod(config, ["android", async (modConfig) => {
    const nativeRoot = path.resolve(modConfig.modRequest.projectRoot, "native");
    const jniLibs = path.join(modConfig.modRequest.platformProjectRoot, "app/src/main/jniLibs");
    const abis = ["arm64-v8a", "x86_64"];
    const installed = [];

    for (const abi of abis) {
      const source = path.join(nativeRoot, abi, "libcrsqlite.so");
      if (!fs.existsSync(source)) continue;

      const destination = path.join(jniLibs, abi, "libcrsqlite.so");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      installed.push(abi);
    }

    if (installed.length === 0) {
      throw new Error("CR-SQLite Android binary missing; run the spike's native preparation scripts first");
    }
    return modConfig;
  }]);
};
