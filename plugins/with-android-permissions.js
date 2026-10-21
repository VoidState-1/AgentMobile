const path = require('node:path');
const { AndroidConfig, withDangerousMod } = require('expo/config-plugins');

// Expo's debug manifests outrank the main manifest and can otherwise restore
// SYSTEM_ALERT_WINDOW despite android.blockedPermissions.
module.exports = function withAndroidPermissionPolicy(config) {
  return withDangerousMod(config, [
    'android',
    async mod => {
      const blocked = mod.android?.blockedPermissions ?? [];
      for (const variant of ['debug', 'debugOptimized']) {
        const file = path.join(
          mod.modRequest.platformProjectRoot,
          'app/src',
          variant,
          'AndroidManifest.xml',
        );
        let manifest;
        try {
          manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        AndroidConfig.Manifest.ensureToolsAvailable(manifest);
        AndroidConfig.Permissions.addBlockedPermissions(manifest, blocked);
        await AndroidConfig.Manifest.writeAndroidManifestAsync(file, manifest);
      }
      return mod;
    },
  ]);
};
