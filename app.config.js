const IS_DEV = process.env.APP_VARIANT === 'development';
export default {
  "expo": {
    "name": IS_DEV ? "cosm (Development)" : "cosm",
    "slug": "cosm",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "cosm",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": IS_DEV ? "dev.tmcl.cosm.dev" : "dev.tmcl.cosm",
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription": "This program is intended to help you map on-the-go.",
      }
    },
    "android": {
        "edgeToEdgeEnabled": true,
      "adaptiveIcon": {

        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": IS_DEV ? "dev.tmcl.cosm.dev" : "dev.tmcl.cosm"
    },
    "plugins": [
      "expo-router",
			"expo-web-browser",
			["expo-dev-client", {"addGeneratedScheme": !IS_DEV}],
      ["expo-sqlite", {
        "customBuildFlags": "-DSQLITE_ENABLE_RTREE=1"
      }],
      "@maplibre/maplibre-react-native",
        [
            "expo-location",
          {
                      "locationWhenInUsePermission": "Allow $(PRODUCT_NAME) to use your location.",
            "isAndroidForegroundServiceEnabled": true,
          }
        ],
      [
        "expo-asset",
        {
          "assets": [
            "assets/proj.db"
          ]
        }
      ],
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      ["expo-font", {
        
      }],
      [
        "expo-build-properties",
        {
          "ios": {
            "deploymentTarget": "15.1",
            "extraPods": [
              {
                "name": "libspatialite",
                "version": "5.1.0",
                "source": "git+https://git.tmcl.dev/tristan/cocoapods.git"
              }
            ]
          }
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
};
