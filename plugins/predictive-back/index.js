const { withAndroidManifest } = require("@expo/config-plugins");

// Expo's generated manifest disables the Android 13+ predictive back
// gesture by default. react-native-screens already renders the native
// peek/scale animation for it once this flag is on.
module.exports = function withPredictiveBack(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;
    application.$["android:enableOnBackInvokedCallback"] = "true";
    return config;
  });
};
