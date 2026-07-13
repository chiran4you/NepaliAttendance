const config = require("./app.json");

module.exports = {
  ...config.expo,
  plugins: [
    "./plugins/withAdiRegistration",
    ...config.expo.plugins,
  ],
};