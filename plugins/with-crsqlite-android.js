const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

module.exports = function withCrsqliteAndroid(config) {
  return withDangerousMod(config, ["android", async (modConfig) => {
    const sourceRoot = path.resolve(modConfig.modRequest.projectRoot, "native-libs/crsqlite");
    const jniLibs = path.join(modConfig.modRequest.platformProjectRoot, "app/src/main/jniLibs");
    const abis = ["arm64-v8a", "x86_64"];
    const installed = [];

    for (const abi of abis) {
      const source = path.join(sourceRoot, abi, "libcrsqlite.so");
      if (!fs.existsSync(source)) {
        throw new Error(`Missing pinned CR-SQLite Android library for ${abi}: ${source}`);
      }
      const destination = path.join(jniLibs, abi, "libcrsqlite.so");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      installed.push(abi);
    }

    if (installed.length !== abis.length) {
      throw new Error(`Expected CR-SQLite for ${abis.join(" and ")}; found ${installed.join(", ")}`);
    }
    return modConfig;
  }]);
};
