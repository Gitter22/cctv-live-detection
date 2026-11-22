// Adds settings to app.json that depend on the build environment.
// google-services.json (Firebase, needed for Android push) is gitignored. On EAS it comes from
// the GOOGLE_SERVICES_JSON file variable (eas env:create ... --type file); locally from the file.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
