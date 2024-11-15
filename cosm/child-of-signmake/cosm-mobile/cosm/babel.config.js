module.exports = function (api) {
  api.cache(true);
  return {
      presets: [
          ['babel-preset-expo', { jsxImportSource: "nativewind" }],
          "nativewind/babel"
      ],

      env: {
          production: {
          },
      },

      plugins: [["module-resolver", {
          root: ["./"],

          alias: {
              "@": "./",
              "tailwind.config": "./tailwind.config.js"
          }
      }]]
  };
};
