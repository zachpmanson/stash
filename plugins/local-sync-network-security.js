const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Stash sync only permits plain HTTP for loopback endpoints. Android otherwise
// blocks cleartext by default, so mirror that policy at the platform layer too.
module.exports = function withLocalSyncNetworkSecurity(config) {
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) throw new Error("Android manifest has no application element");
    application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return config;
  });

  config = withDangerousMod(config, [
    "android",
    (config) => {
      const resourceDir = path.join(
        config.modRequest.projectRoot,
        "android",
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      fs.mkdirSync(resourceDir, { recursive: true });
      fs.writeFileSync(
        path.join(resourceDir, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`,
      );
      return config;
    },
  ]);

  return config;
};
