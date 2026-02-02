import type { Config } from "jest";

const config: Config = {
  transformIgnorePatterns: [
    "/node_modules/(?!kdbush|geokdbush|tinyqueue).+\\.js$"
  ],
  // If using Babel
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.[t|j]sx?$": "babel-jest",
  },
};

export default config;
