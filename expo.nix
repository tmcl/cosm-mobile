{
  overlay = final: prev: {
    gradle-unwrapped = final.callPackage (((import "${prev.path}/pkgs/development/tools/build-managers/gradle") {
        jdk17 = final.openjdk17;
        jdk21 = final.openjdk21;
        jdk23 = final.openjdk23;
      }).gen {
        version = "8.10.2";
        hash = "sha256-McVXE+QCM6gwOCfOtCykikcmegrUurkXcSMSHnFSTCY=";
        defaultJava = final.openjdk17;
      }) {};
  };
  buildOutputs = {
    root_path,
    root_relative,
    pkgs,
    buildGradlePackage,
    buildMavenRepo,
    gradle2nix,
    android-sdk,
  }: let
    expo-major="53";
    management-root-fileset =
      pkgs.lib.fileset.fileFilter (
        file:
          file.type == "regular"
      )
      root_path;
    development-inputs-simplest = pkgs.lib.fileset.toSource {
      root = root_path;
      fileset = management-root-fileset;
    };
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
    buildMavenRepo = args: buildMavenRepo (pkgs.lib.getAttrs ["lockFile" "overrides"] args);
    ANDROID_SDK_ROOT = "${android-sdk}/share/android-sdk";
    GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${ANDROID_SDK_ROOT}/build-tools/34.0.0/aapt2";
    multioutput-combiner = originalDerivation:
      pkgs.stdenv.mkDerivation {
        name = "${originalDerivation.name}-all-out";

        src = originalDerivation;
        fixupPhase = "true";
        buildPhase = ''
          mkdir -p $out
          ${builtins.concatStringsSep "\n" (map (
              output: "ln -s ${originalDerivation.${output}} $out/${output}"
            )
            originalDerivation.outputs)}
        '';

        installPhase = "true";
      };
    web = pkgs.stdenv.mkDerivation {
      name = "interpret";
      APP_VARIANT="production";
      src = root_path;
      buildInputs = [
        pkgs.nodejs
        pkgs.yarn
      ];
      buildPhase = ''
        export HOME=$(mktemp -d)
        #cp -a ${node_modules}/node_modules node_modules
        ln -s ${node_modules}/node_modules node_modules
        #ls -ld node_modules
        #ls -l node_modules
        yarn --offline build
      '';
      installPhase = ''
        mkdir -p $out/dist
        cp -r dist/* $out/dist/
      '';
    };
    package_json = pkgs.writeText "package.json" (builtins.toJSON (package_json_info ));
    package_json_info = let
      bare = builtins.removeAttrs (builtins.fromJSON (builtins.readFile "${root_path}/package.json")) ["scripts"];
      filter = if "development" == "production" then x: builtins.removeAttrs x ["expo-drizzle-studio-plugin"] else x: x;
      in bare // { dependencies = filter bare.dependencies; };
    node_modules = pkgs.mkYarnModules {
      pname = "interpret-nodemodules";
      version = "1.0.0";
      packageJSON = package_json;
      yarnLock = /${root_path}/yarn.lock;
    };
    android-build = mode: src:
      (let
        variant =
          if mode == "production"
          then "release"
          else if mode == "development"
          then "debug"
          else throw "unknown mode ${mode}";
        Variant =
          if mode == "production"
          then "Release"
          else if mode == "development"
          then "Debug"
          else throw "unknown mode ${mode}";
        task =
          if mode == "production"
          then ["app:package${Variant}Bundle" "app:assemble${Variant}"]
          else if mode == "development"
          then ["bundle${Variant}" "assemble${Variant}"]
          else throw "unknown mode ${mode}";
        autoLockStandard = builtins.fromJSON (builtins.readFile ./gradle-lock/${mode}/gradle.lock.json);
        autoLockLintVitalRelease = builtins.fromJSON (builtins.readFile ./gradle-lock/${mode}/gradle.lock.app.lintvitalrelease.json);
        #aapt2bundle = pkgs.stdenv.mkDerivation {
        #  name = "aapt2bundle";
        #  src = builtins.fetchurl {
        #    url = "https://dl.google.com/dl/android/maven2/com/android/tools/build/aapt2/8.6.0-11315950/aapt2-8.6.0-11315950-linux.jar";
        #    sha256 = "sha256-aCkmzxAfAhpQY5Ee0squwUCMF8xJaD/QNVIkUYeGQ5U=";
        #  };

        #  # Specify build inputs if needed
        #  nativeBuildInputs = [pkgs.coreutils pkgs.unzip pkgs.zip];
        #  android_sdk = android-sdk;

        #  # The build phase where we run our commands
        #  unpackPhase = "cp $src ./aapt2-8.6.0-11315950-linux.jar";
        #  buildPhase = ''
        #    ls
        #    echo $src
        #    ls $src
        #    mkdir build
        #    unzip aapt2-8.6.0-11315950-linux.jar -d build
        #    cp $android_sdk/share/android-sdk/build-tools/34.0.0/aapt2 build
        #    cd build
        #    zip aapt2-8.6.0-11315950-linux.jar * */*
        #    cd ..
        #  '';

        #  installPhase = ''
        #    install build/aapt2-8.6.0-11315950-linux.jar $out
        #  '';
        #};
        #standardise-dates = pkgs.writeScriptBin "standardise-dates" ''
        #  #!${pkgs.bash}/bin/bash
        #  first_part=$(mktemp)
        #  second_part=$(mktemp)
        #  second_part_1=$(mktemp)
        #  sed -e 's/^\([^\t]*\)\t\(.*\)$/\1\t/' $1 > $first_part
        #  sed -e 's/^\([^\t]*\)\t\(.*\)$/\2/' $1 > $second_part
        #  echo first_part $first_part
        #  cat $first_part
        #  echo second_part $second_part
        #  cat $second_part
        #  ${pkgs.jq}/bin/jq -c '
        #    .metadata.resHeaders.date = .metadata.resHeaders."last-modified" |
        #    .time = (.metadata.resHeaders."last-modified" |  strptime("%a, %d %b %Y %H:%M:%S GMT") | mktime * 1000) |
        #    .metadata.time = (.metadata.resHeaders."last-modified" |  strptime("%a, %d %b %Y %H:%M:%S GMT") | mktime * 1000)
        #  ' $second_part > $second_part_1
        #  echo "2e13823e23f3c0db9c9d228418c894d4005a107a\t" > $first_part
        #  (tr -d '\n' < $first_part; cat $second_part_1) > $1
        #  cat $1
        #  rm $first_part $second_part $second_part_1
        #'';
        npm-cache = ./npm-cache;
        #npm-cache = pkgs.stdenv.mkDerivation rec {
        #  name = "npm-cache";

        #  # Use a fixed-output derivation
        #  outputHashMode = "recursive";
        #  outputHashAlgo = "sha256";
        #  outputHash = "sha256-ldZVpM2ht8xuj73W34InTRu5ug1aZJCqV4AC6OWEkmA=";

        #  nativeBuildInputs = [ pkgs.nodejs ];

        #  # Fetch the npm package
        #  buildCommand = ''
        #    set -exu
        #    export NODE_EXTRA_CA_CERTS="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        #    export HOME=$TMPDIR
        #    mkdir -p $out
        #    cd $out
        #    export NPM_CONFIG_CACHE=$out
        #    export npm_config_registry=https://registry.yarnpkg.com
        #    npm view expo-template-bare-minimum@sdk-${expo-major} dist --json
        #    find $out/_cacache/index-v5 -type f -print -exec cat '{}' ';' -exec ${standardise-dates}/bin/standardise-dates '{}' ';'
        #    npm cache verify --loglevel=verbose
        #    ls -l
        #    rm -rf _logs
        #    rm _update-notifier-last-checked
        #  '';

        #};
        extrasLock = builtins.fromJSON (builtins.readFile ./gradle-lock/${mode}/gradle.lock.extra.json);
        lockFile = pkgs.writeText "gradle.lock" (builtins.toJSON (extrasLock // autoLockLintVitalRelease // autoLockStandard));
        #  sqlfiles = pkgs.stdenv.mkDerivation {
        #      name = "sqlfiles";
        #      src = ./frontend/sql;
        #      # Specify build inputs if needed
        #      nativeBuildInputs = [ pkgs.coreutils pkgs.haskellPackages.read-src-asset pkgs.sqlite ];

        #      # The build phase where we run our commands
        #      buildPhase = ''
        #        read-src-asset --out=$out --schema=schema .
        #      '';
        #};
        js_package_name = package_json_info.name;
      in {
        gradle = pkgs.gradle-unwrapped;
        pname = "android-expo-${js_package_name}-${mode}";
        version = "0.1.0";
        inherit lockFile src;
        overrides = {
          "com.android.tools.build:aapt2:8.8.2-12006047" = {
            "aapt2-8.8.2-12006047-linux.jar" = src:
              pkgs.runCommandCC src.name {
                nativeBuildInputs = [pkgs.openjdk17 pkgs.autoPatchelfHook];
                buildInputs = [pkgs.glibc pkgs.stdenv pkgs.gcc];
                dontAutoPatchelf = true;
              } ''
                cp ${src} aapt2.jar
                jar xf aapt2.jar aapt2
                cp ${android-sdk}/share/android-sdk/build-tools/34.0.0/aapt2 aapt2
                chmod +x aapt2
                jar uf aapt2.jar aapt2
                cp aapt2.jar $out
              '';
          };
        };
        NODE_ENV = "production";
        nativeBuildInputs = [pkgs.nodejs android-sdk pkgs.openjdk17];
        prePatchHooks = ["export HOME=$(mktemp -d); echo $HOME; cp ${package_json} package.json && chmod +w package.json; set -x"];
        preBuildHooks = [
          "trap 'echo \"Exit code: $?\"' DEBUG;"
          "if find /path/to/dir -type f \\( -name \"*.ts\" -o -name \"*.tsx\" \\) -print -quit | grep -q .; then tsc --noEmit; fi"
          ];
        outputs = ["out" "info"];
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
            ls -l
            find sql -type f -name '*.sql' -exec sh -c '
              for file do
                ${pkgs.jq}/bin/jq -Rs . "$file" > "$file.json"
              done
            ' sh {} + || true
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
      });
  in rec {
    inherit GRADLE_OPTS;
    inherit ANDROID_SDK_ROOT;
    inherit web node_modules;
    maven-repo = buildMavenRepo (android-build "development" development-inputs);
    android-production =
      multioutput-combiner ((buildGradlePackage (android-build "production" root_path)).overrideAttrs (
      finalAttrs: prevAttrs:
      {
        gradleInitScript = pkgs.substitute {
      src = ./init.gradle;
          substitutions = [
            "--replace"
            "@mavenRepo@"
            "${prevAttrs.passthru.offlineRepo}"
          ];
        }
        ;
      }));

    android-development =
      multioutput-combiner ((buildGradlePackage (android-build "development" development-inputs)).overrideAttrs (
                                                                                                     finalAttrs: prevAttrs:
                                                                                                     {
                                                                                                       gradleInitScript = pkgs.substitute {
                                                                                                     src = ./init.gradle;
                                                                                                         substitutions = [
                                                                                                           "--replace"
                                                                                                           "@mavenRepo@"
                                                                                                           "${prevAttrs.passthru.offlineRepo}"
                                                                                                         ];
                                                                                                       }
                                                                                                       ;
                                                                                                     }));

    update-gradle-lock = pkgs.writeScriptBin "update-gradle-lock" ''
      #!${pkgs.bash}/bin/bash
      if  [[ "$1" == "development"  ]]; then
         Variant=Debug
      elif [[ "$1" == "production" ]]; then
         Variant=Release
      else
         echo "usage: update-grade-lock <mode>" >&2
         echo "please provide the mode - production or development" >&2
         exit 1
      fi
      set -eu
      git_root=$(${pkgs.git}/bin/git rev-parse --show-toplevel)

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
    update-gradle-lock-app = let
    in {
      type = "app";
      program = "${update-gradle-lock}/bin/update-gradle-lock";
    };
  };
}
