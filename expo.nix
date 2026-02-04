{
  overlay = final: prev: {
    gradle-unwrapped = prev.gradle-unwrapped.override {
      java = prev.openjdk17;
      javaToolchains = [ prev.openjdk17 ];
    };
  };
  buildOutputs =
    {
      root_path,
      root_relative,
      pkgs,
      buildGradlePackage,
      buildMavenRepo,
      gradle2nix,
      android-sdk,
    }:
    let
      expo-major = "54";
      build-tools-version = "36.0.0";
      development-inputs = pkgs.lib.fileset.toSource {
        root = root_path;
        fileset = pkgs.lib.fileset.unions [
          #management-root-fileset
          /${root_path}/.eslintrc.js
          /${root_path}/.gitignore
          /${root_path}/app.config.js
          /${root_path}/babel.config.js
          /${root_path}/metro.config.js
          /${root_path}/README.md
          /${root_path}/tsconfig.json
          /${root_path}/yarn.lock
          /${root_path}/assets/images/adaptive-icon.png
          /${root_path}/assets/images/icon.png
          /${root_path}/assets/images/splash-icon.png
          /${root_path}/assets/proj.db
        ];
      };
      buildMavenRepo = args: buildMavenRepo (pkgs.lib.getAttrs [ "lockFile" "overrides" ] args);
      ANDROID_SDK_ROOT = "${android-sdk}/share/android-sdk";
      GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${ANDROID_SDK_ROOT}/build-tools/${build-tools-version}/aapt2";
      mk_package_json = mode: pkgs.writeText "package.json" (builtins.toJSON (mk_package_json_info mode));
      mk_package_json_info = mode:
        let
          package.json = (builtins.fromJSON (builtins.readFile "${root_path}/package.json"));
          bare =   package.json
           // {
             version = 
             scripts = {
               android = "expo run:android";
               ios = "expo run:ios";
               test = package.json.scripts.test;
             };
           };
          filter =
            if mode == "production" then
              x: builtins.removeAttrs x [ "expo-drizzle-studio-plugin" ]
            else
              x: x;
        in
        bare // { dependencies = filter bare.dependencies; };
      mk_node_modules = mode: pkgs.mkYarnModules {
        pname = "${(mk_package_json_info mode).name}-nodemodules";
        version = "1.0.0";
        packageJSON = mk_package_json mode;
        yarnLock = /${root_path}/yarn.lock;
      };
      android-build =
        mode: src:
        (
          let
            variant =
              if mode == "production" then
                "release"
              else if mode == "development" then
                "debug"
              else
                throw "unknown mode ${mode}";
            Variant =
              if mode == "production" then
                "Release"
              else if mode == "development" then
                "Debug"
              else
                throw "unknown mode ${mode}";
            task =
              if mode == "production" then
                [
                  "app:package${Variant}Bundle"
                  "app:assemble${Variant}"
                ]
              else if mode == "development" then
                [
                  "bundle${Variant}"
                  "assemble${Variant}"
                ]
              else
                throw "unknown mode ${mode}";
            autoLockStandard = builtins.fromJSON (builtins.readFile ./gradle-lock/${mode}/gradle.lock.json);
            autoLockLintVitalRelease = builtins.fromJSON (
              builtins.readFile ./gradle-lock/${mode}/gradle.lock.app.lintvitalrelease.json
            );
            npm-cache = ./npm-cache;
            extrasLock = builtins.fromJSON (builtins.readFile ./gradle-lock/${mode}/gradle.lock.extra.json);
            lockFile = pkgs.writeText "gradle.lock" (
              builtins.toJSON (extrasLock // autoLockLintVitalRelease // autoLockStandard)
            );
            js_package_name = package_json_info.name;
            package_json_info = mk_package_json_info mode;
            package_json = mk_package_json mode;
            node_modules = mk_node_modules mode;
          in
          {
            gradle = pkgs.gradle-unwrapped;
            pname = "android-expo-${js_package_name}-${mode}";
            version = "0.1.0";
            inherit lockFile src;
            overrides = {
              "com.android.tools.build:aapt2:8.11.0-12782657" = {
                "aapt2-8.11.0-12782657-linux.jar" =
                  src:
                  pkgs.runCommandCC src.name
                    {
                      nativeBuildInputs = [
                        pkgs.openjdk17
                        pkgs.autoPatchelfHook
                      ];
                      buildInputs = [
                        pkgs.glibc
                        pkgs.stdenv
                        pkgs.gcc
                      ];
                      dontAutoPatchelf = true;
                    }
                    ''
                      cp ${src} aapt2.jar
                      jar xf aapt2.jar aapt2
                      cp ${android-sdk}/share/android-sdk/build-tools/${build-tools-version}/aapt2 aapt2
                      chmod +x aapt2
                      jar uf aapt2.jar aapt2
                      cp aapt2.jar $out
                    '';
              };
            };
            NODE_ENV = "production";
            nativeBuildInputs = [
              pkgs.nodejs
              android-sdk
              pkgs.openjdk17
            ];
            prePatchHooks = [
              "export HOME=$(mktemp -d); echo $HOME; cp ${package_json} package.json && chmod +w package.json"
            ];
            preBuildHooks = [
              "trap 'echo \"Exit code: $?\"' DEBUG;"
              (if mode == "development" then "echo skipping tsc on development" else "echo tsc; npx tsc --noEmit; echo \"tsc $?\"")
            ];
            outputs = [
              "out"
              "info"
            ];
            postPatchHooks = [
              ''
                ls -la $TMP
                echo $HOME
                export APP_VARIANT=${mode}
                export NODE_ENV=${mode}
                cp -R ${node_modules}/node_modules node_modules
                chmod -R +w node_modules
                ls -l
                cp -Rv ${npm-cache} ~/.npm
                chmod -cR +rw ~/.npm
                find ~/.npm -exec touch '{}' ';'
                cp -av ${./expo-prebuild-template-cache} ~/.expo
                export NPM_CONFIG_OFFLINE=true
                npm view expo-template-bare-minimum@sdk-${expo-major} dist --json
                EXPO_OFFLINE=1 ${pkgs.yarn}/bin/yarn --offline expo prebuild  --no-install
                cat android/gradle.properties
                ls -l
                find sql -type f -name '*.sql' -exec sh -c '
                  for file do
                    ${pkgs.jq}/bin/jq -Rs . "$file" > "$file.json"
                  done
                ' sh {} + || true
                ls -l
                cat package.json
                ${pkgs.yarn}/bin/yarn --offline run test
                cd android
              ''
            ];
            gradleBuildFlags = task;
            installPhase = ''
              mkdir -p $out $info
              cp -R app/build $info
              cp -R app/build/intermediates/intermediary_bundle/${variant}/package${Variant}Bundle/intermediary-bundle.aab $out/unsigned-${variant}-bundle.aab
              cp -R app/build/outputs/bundle/${variant}/app-${variant}.aab $out/fake-signed-${variant}-bundle.aab || true
              cp -R app/build/outputs/apk/${variant}/app-${variant}.apk $out/fake-signed-${variant}-apk.apk
              cp -R app/build/outputs/apk/${variant}/app-${variant}.apk $out/unsigned-${variant}-apk.apk
              ${pkgs.zip}/bin/zip -d $out/unsigned-${variant}-apk.apk 'META-INF/*'
            '';
            #gradleBuildFlags = [ ":expo-dev-launcher:compileReleaseLibraryResources" "--no-daemon" "--warning-mode=all" "--info" "--debug"  ];
            JAVA_HOME = pkgs.openjdk17.home;
            inherit GRADLE_OPTS;
            inherit ANDROID_SDK_ROOT;
          }
        );
    in
    rec {
      inherit GRADLE_OPTS;
      inherit ANDROID_SDK_ROOT;
      maven-repo = buildMavenRepo (android-build "development" development-inputs);
      android-production =  (
        (buildGradlePackage (android-build "production" root_path)).overrideAttrs (
          finalAttrs: prevAttrs: {
            gradleInitScript = pkgs.substitute {
              src = ./init.gradle;
              substitutions = [
                "--replace"
                "@mavenRepo@"
                "${prevAttrs.passthru.offlineRepo}"
              ];
            };
          }
        )
      );

      android-development =  (
        (buildGradlePackage (android-build "development" development-inputs)).overrideAttrs (
          finalAttrs: prevAttrs: {
            gradleInitScript = pkgs.substitute {
              src = ./init.gradle;
              substitutions = [
                "--replace"
                "@mavenRepo@"
                "${prevAttrs.passthru.offlineRepo}"
              ];
            };
          }
        )
      );

      update-gradle-lock = pkgs.writeScriptBin "update-gradle-lock" ''
        #!${pkgs.bash}/bin/bash
        set -eu
        export PATH=${pkgs.yarn}/bin:$PATH
        export JAVA_HOME=${pkgs.jdk17.home};
        export ANDROID_HOME="${pkgs.android-sdk}/share/android-sdk";
        export ANDROID_SDK_ROOT="${pkgs.android-sdk}/share/android-sdk";
        export ANDROID_AVD_HOME="/home/tristan/.config/.android/avd";
        git_root=$(${pkgs.git}/bin/git rev-parse --show-toplevel)
        if [[ -e $git_root/android ]]; then
          if  [[ "$1" == "--force"  ]]; then
             echo "working despite android directory" >&2
             shift
          else
             echo "android directory identified" >&2
             echo "you should probably remove it, but if you know better use --force" >&2
             exit 1
          fi
        fi
        if  [[ "$1" == "development"  ]]; then
           Variant=Debug
        elif [[ "$1" == "production" ]]; then
           Variant=Release
        else
           echo "usage: update-grade-lock <mode>" >&2
           echo "please provide the mode - production or development" >&2
           exit 1
        fi

        (
          export NPM_CONFIG_CACHE=$git_root/npm-cache
          rm -rf $NPM_CONFIG_CACHE
          mkdir -p $NPM_CONFIG_CACHE
          npm view expo-template-bare-minimum@sdk-${expo-major} dist --json
          export npm_config_registry=https://registry.yarnpkg.com
          npm view expo-template-bare-minimum@sdk-${expo-major} dist --json
          rm -rf $NPM_CONFIG_CACHE/_logs
        )

        expo_root=$git_root/${root_relative}
        export NODE_ENV=$1
        export APP_VARIANT=$1
        cd $expo_root
        $git_root/expo-prebuild-template-cache/refresh.sh
        cd $expo_root/android
        export GRADLE2NIX_OPTS="${GRADLE_OPTS}"
        mkdir -p $git_root/gradle-lock/$1/
        # ${gradle2nix}/bin/gradle2nix -t :app:build"$Variant"PreBundle -l $git_root/gradle-lock/$1/gradle.lock.rrcp.json
        if [[ $Variant == Debug ]]; then
         ${gradle2nix}/bin/gradle2nix -t :expo:extractDebugAnnotations -l $git_root/gradle-lock/$1/gradle.lock.app.lintvitalrelease.json
        else
         ${gradle2nix}/bin/gradle2nix -t :app:lintVital$Variant -l $git_root/gradle-lock/$1/gradle.lock.app.lintvitalrelease.json
         ${gradle2nix}/bin/gradle2nix -t lintVital$Variant -l $git_root/gradle-lock/$1/gradle.lock.lintvitalrelease.json
        fi
        ${gradle2nix}/bin/gradle2nix -l $git_root/gradle-lock/$1/gradle.lock.json
      '';
      update-gradle-lock-app =
        {
          type = "app";
          program = "${update-gradle-lock}/bin/update-gradle-lock";
        };
    };
}
