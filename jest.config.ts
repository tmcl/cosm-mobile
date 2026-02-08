import type { Config } from "jest";

const config: Config = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|kdbush|geokdbush|tinyqueue))",
  ],
};

export default config;
