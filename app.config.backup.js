const config = require("./app.json");

module.exports = {
  ...config.expo,
  plugins: [
    "expo-font",
	"expo-web-browser",
    "./plugins/withAdiRegistration",
    ...config.expo.plugins,
  ],
};