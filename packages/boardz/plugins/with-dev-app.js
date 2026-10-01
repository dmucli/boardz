// Debug builds install as a second app, "Boardz Dev", beside the release build:
// its own bundle id and name, and only it answers the dev client's URL scheme.
// Build settings carry the difference, so one native project serves both, and
// the build configuration (Xcode's scheme, or `--configuration`) picks the app.
const { withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const DEV_SUFFIX = '.dev';

function withDevApp(config) {
  const releaseId = config.ios?.bundleIdentifier;
  if (!releaseId) throw new Error('with-dev-app needs ios.bundleIdentifier');
  const devClientScheme = `exp+${config.slug}`;

  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    plist.CFBundleDisplayName = '$(BOARDZ_DISPLAY_NAME)';
    plist.CFBundleURLTypes = (plist.CFBundleURLTypes ?? []).map((urlType) => ({
      ...urlType,
      CFBundleURLSchemes: (urlType.CFBundleURLSchemes ?? []).map((scheme) => {
        if (scheme === releaseId) return '$(PRODUCT_BUNDLE_IDENTIFIER)';
        if (scheme === devClientScheme) return '$(BOARDZ_DEV_CLIENT_SCHEME)';
        return scheme;
      }),
    }));
    return mod;
  });

  return withXcodeProject(config, (mod) => {
    const configurations = mod.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      const settings = entry?.buildSettings;
      // Only the app target's configurations carry a bundle id.
      if (!settings?.PRODUCT_BUNDLE_IDENTIFIER) continue;
      const dev = entry.name === 'Debug';
      settings.PRODUCT_BUNDLE_IDENTIFIER = dev ? `${releaseId}${DEV_SUFFIX}` : releaseId;
      settings.BOARDZ_DISPLAY_NAME = dev ? `"${config.name} Dev"` : `"${config.name}"`;
      // A release build has no dev client, so it just repeats the app's own scheme.
      settings.BOARDZ_DEV_CLIENT_SCHEME = dev ? `"${devClientScheme}"` : `"${config.scheme}"`;
    }
    return mod;
  });
}

module.exports = withDevApp;
