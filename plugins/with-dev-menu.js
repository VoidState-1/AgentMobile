const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

// Expo SDK 57's default floating developer button covers our compact settings
// control. Keep the developer menu accessible by the standard keyboard/shake
// gestures without placing a button over the product UI.
module.exports = function withUnobstructedDevMenu(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, 'EXDevMenuShowFloatingActionButton', 'false');
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, 'EXDevMenuShowsAtLaunch', 'false');
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.EXDevMenuShowFloatingActionButton = false;
    mod.modResults.EXDevMenuShowsAtLaunch = false;
    return mod;
  });
};
