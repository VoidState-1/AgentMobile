const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const gitDirectory = path.dirname(require.resolve('isomorphic-git'));
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@earendil-works/pi-ai') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'src/adapters/agent/pi-ai-mobile.ts') };
  }
  if (moduleName === 'isomorphic-git') {
    // Official browser bundle avoids Node stream/crypto dependencies in sha.js.
    return { type: 'sourceFile', filePath: path.join(gitDirectory, 'index.umd.min.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
