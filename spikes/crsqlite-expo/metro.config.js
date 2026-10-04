const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoNodeModules = path.resolve(projectRoot, "../../node_modules");
const config = getDefaultConfig(projectRoot);
config.projectRoot = projectRoot;
config.watchFolders = [repoNodeModules];
config.resolver.nodeModulesPaths = [repoNodeModules];

module.exports = config;
