// Metro must also watch packages/shared (linked via file:, lives outside this app folder).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../packages/shared')];
module.exports = config;
