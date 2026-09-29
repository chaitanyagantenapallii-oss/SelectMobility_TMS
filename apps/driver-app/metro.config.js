/**
 * Metro configuration.
 *
 * This app is self-contained: its dependencies live in ./node_modules. Without
 * this file Metro walks up the directory tree looking for a workspace root and
 * finds apps/package.json and the repository root instead, which makes it
 * resolve modules from the wrong place and fail to bundle.
 *
 * Pinning the root here is what lets the app be built directly from this
 * folder - no copy into a separate build tree, no manual syncing.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Metro must treat this folder as the project, not a package inside a workspace.
config.projectRoot = projectRoot;
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
