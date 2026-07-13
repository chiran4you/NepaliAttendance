const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot;

      const sourceFile = path.join(
        projectRoot,
        "assets",
        "adi-registration.properties"
      );

      if (!fs.existsSync(sourceFile)) {
        throw new Error(
          "Google Play verification file not found:\n" +
          sourceFile +
          "\n\nExpected location:\nassets/adi-registration.properties"
        );
      }

      const assetsDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "assets"
      );

      fs.mkdirSync(assetsDir, { recursive: true });

      const destinationFile = path.join(
        assetsDir,
        "adi-registration.properties"
      );

      fs.copyFileSync(sourceFile, destinationFile);

      console.log(
        "✓ Copied adi-registration.properties into Android assets."
      );

      return config;
    },
  ]);
};