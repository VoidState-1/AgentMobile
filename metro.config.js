const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const gitDirectory = path.dirname(require.resolve('isomorphic-git'));
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@earendil-works/pi-ai') {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'src/adapters/agent/pi-ai-mobile.ts'),
    };
  }
  if (moduleName === '@modelcontextprotocol/client/_shims') {
    // Use the SDK's interpreter-based schema validator on Hermes and Web.
    return {
      type: 'sourceFile',
      filePath: path.join(
        path.dirname(require.resolve('@modelcontextprotocol/client')),
        'shimsBrowser.mjs',
      ),
    };
  }
  if (moduleName === 'pkce-challenge') {
    // The package only declares browser/node conditions; Hermes uses its browser entry.
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'node_modules/pkce-challenge/dist/index.browser.js'),
    };
  }
  if (moduleName === 'isomorphic-git') {
    // Official browser bundle avoids Node stream/crypto dependencies in sha.js.
    return { type: 'sourceFile', filePath: path.join(gitDirectory, 'index.umd.min.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
