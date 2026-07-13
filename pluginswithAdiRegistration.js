const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot;

      const source = path.join(projectRoot, "assets", "adi-registration.properties");

      const destinationDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "assets"
      );

      const destination = path.join(
        destinationDir,
        "adi-registration.properties"
      );

      fs.mkdirSync(destinationDir, { recursive: true });
      fs.copyFileSync(source, destination);

      console.log("Copied adi-registration.properties into Android assets.");

      return config;
    },
  ]);
};