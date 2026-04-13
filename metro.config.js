const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      // whisper.rn publishes an "exports" map ("./*" → "src/*" for react-native)
      // but Metro doesn't reliably resolve it. Rewrite subpath imports so they
      // point at the package's source directory, which is what the exports map
      // would resolve to for the "react-native" condition.
      if (
        moduleName.startsWith('whisper.rn/') &&
        !moduleName.startsWith('whisper.rn/src/')
      ) {
        return context.resolveRequest(
          context,
          moduleName.replace('whisper.rn/', 'whisper.rn/src/'),
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
