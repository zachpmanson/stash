const fs = require("fs");
const path = require("path");
const { withDangerousMod, withMainApplication } = require("@expo/config-plugins");

module.exports = function withTextSelectionModule(config) {
  config = withDangerousMod(config, ["android", async config => {
    const pkg = config.android?.package;
    if (!pkg) throw new Error("withTextSelectionModule: android.package is required");
    const directory = path.join(config.modRequest.platformProjectRoot, "app/src/main/java", pkg.replace(/\./g, "/"));
    fs.mkdirSync(directory, { recursive: true });
    for (const file of ["TextSelectionModule.kt", "TextSelectionPackage.kt"]) {
      fs.writeFileSync(path.join(directory, file), fs.readFileSync(path.join(__dirname, file), "utf8").replace("__PACKAGE__", pkg));
    }
    return config;
  }]);
  return withMainApplication(config, config => {
    const source = config.modResults.contents;
    if (source.includes("TextSelectionPackage()")) return config;
    const apply = /PackageList\(this\)\.packages\s*\.apply\s*\{([\s\S]*?)\}/;
    if (apply.test(source)) {
      config.modResults.contents = source.replace(apply, (_, body) =>
        `PackageList(this).packages.apply {${body.replace(/\s*$/, "")}\n          add(TextSelectionPackage())\n        }`);
    } else {
      if (!/PackageList\(this\)\.packages/.test(source)) throw new Error("Cannot register TextSelectionPackage in MainApplication");
      config.modResults.contents = source.replace(/PackageList\(this\)\.packages/,
        "PackageList(this).packages.apply {\n          add(TextSelectionPackage())\n        }");
    }
    return config;
  });
};
