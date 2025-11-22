import type {Config} from 'jest'

const config: Config = {
  // ... other jest config
  //transformIgnorePatterns: [
  //  "/node_modules/(?!array-from-async).+\\.js$"
  //],
  // If using Babel
  extensionsToTreatAsEsm: [".ts"],
  transform: {
     "^.+\\.[t|j]sx?$": "babel-jest"
  }
};

export default config