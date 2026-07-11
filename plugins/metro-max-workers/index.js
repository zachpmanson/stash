const { withAppBuildGradle } = require("@expo/config-plugins");

// Node 24's fs internals race with Metro's worker pool during release
// bundling, crashing createBundleReleaseJsAndAssets with EBADF. Forcing a
// single Metro worker avoids the race.
const EXTRA_ARGS = 'extraPackagerArgs = ["--max-workers", "1"]';

module.exports = function withMetroMaxWorkers(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(EXTRA_ARGS)) return config;
    config.modResults.contents = config.modResults.contents.replace(
      /react\s*\{/,
      `react {\n    ${EXTRA_ARGS}`,
    );
    return config;
  });
};
