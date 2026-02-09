{
  description = "moo";

  inputs = {
    #my-wkt-geom.url = "git+https://git.tmcl.dev/tristan/wkt-geom";
    #my-wkt-geom.flake = false;

    servant-foreign.url = "/home/tristan/src/current-projects/signs-alt/tmp/servant/servant-foreign";
    servant-foreign.flake = false;

    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    #nixpkgsold.url = "github:NixOS/nixpkgs?rev=ae92f312bf0f80b0e22a177152d54254349d010e";

    flake-utils.url = "github:numtide/flake-utils";

    android.url = "github:tadfisher/android-nixpkgs/stable";
    android.inputs.nixpkgs.follows = "nixpkgs";

    libspatialite.url = "git+ssh://gitea@git.tmcl.dev/tristan/libspatialite-git?ref=refs/tags/5.1.0-cosm4";
    libspatialite.flake = false;

    gradle2nix = {
      url = "github:tadfisher/gradle2nix?ref=v2";
      inputs.nixpkgs.follows = "nixpkgs";
    };

  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }@inputs:

    let

      overlay = import ./overlay.nix {
        inherit inputs;
        #native-qemu = pkgs.qemu;
      };

      expo = import ./expo.nix;

    in
    {
      inherit overlay;
    }
    // flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-darwin" "aarch64-linux" ] (system: rec {
      pkgs = (
        import nixpkgs {
          inherit system;
          overlays = [
            overlay
            expo.overlay
          ];
          config.allowUnfreePredicate =
            pkg:
            builtins.elem (pkgs.lib.getName pkg) [
              "android-studio-stable"
              "vscode"
              "webstorm"
              "google-chrome"
              "android-ndk"
              "ndk"
              "android-sdk-ndk"
              "android-sdk-platform-tools"
              "platform-tools"
              "aarch64-unknown-linux-android-ndk-toolchain-wrapper"
              "aarch64-unknown-linux-android-ndk-toolchain"
            ];
        }
      );
      #oldpkgs = (import nixpkgsold {
      #inherit system ;
      #});

      packages =
        let
          android-sdk = inputs.android.sdk.${system} (
            sdkPkgs: with sdkPkgs; [
              cmdline-tools-latest
              cmake-3-22-1
              build-tools-35-0-0
              build-tools-36-0-0
              platform-tools
              platforms-android-36
              ndk-27-1-12297006
              ndk-27-0-12077973
            ]
          );
          mkExpo =
            system: pkgs:
            expo.buildOutputs rec {
              root_relative = ".";
              root_path = ./.;
              inherit pkgs;
              inherit (inputs.gradle2nix.builders."${system}") buildGradlePackage buildMavenRepo;
              inherit (inputs.gradle2nix.packages."${system}") gradle2nix;
              inherit android-sdk;
            };
          expo_ = mkExpo system pkgs;
        in
        {
          inherit android-sdk;
          android-spatialite = pkgs.pkgsCross.aarch64-android-prebuilt.libspatialite;

          update-gradle-lock = expo_.update-gradle-lock;
          update-gradle-lock-app = expo_.update-gradle-lock-app;
          shell-build-app = expo_.shell-build-app;
          android = {
            node_modules = expo_.node-modules;

            development = expo_.android-development;
            production = expo_.android-production;
            buildMavenRepo = expo_.buildMavenRepo;
          };

          all = pkgs.stdenv.mkDerivation {
            name = "everything";
            phases = [ "buildPhase" ];
            pkgs = pkgs.lib.attrValues (packages // { all = null; });
            buildPhase = ''
              mkdir $out
              for i in $pkgs; do
                ln -s $i $out
              done;
            '';
          };
        };
      prepush = {
        check-hs-lint-format = pkgs.stdenv.mkDerivation {
          name = "hs-lint-format";
          src = ./.;
          phases = [ "installPhase" ];
          depsBuildBuild = [ pkgs.haskellPackages.ormolu ];
          installPhase = ''
            find $src -iname '*.hs' -print0 \
              | xargs -0 ormolu -m check \
              && touch $out
          '';
        };
        check-nix-lint-format = pkgs.stdenv.mkDerivation {
          name = "nix-lint-format";
          src = ./.;
          phases = [ "installPhase" ];
          depsBuildBuild = [ pkgs.nixfmt ];
          installPhase = ''
            find $src -iname \*.nix -print0 \
              | xargs -0 nixfmt -w80 -c \
              && touch $out
          '';
        };
      };

      apps.shell-build = packages.shell-build-app;
      apps.update-gradle-lock = packages.update-gradle-lock-app;
      apps.setup-android = {
        type = "app";
        program = pkgs.lib.getExe (
          pkgs.writeShellScriptBin {
            name = "setup-android";
            text = ''
              cp -f $LIB_SPATIALITE/lib/mod_spatialite.so android/app/src/main/jniLibs/arm64-v8a/mod_spatialite.so
              cp -f $LIB_UNISTRING/lib/libunistring.so android/app/src/main/jniLibs/arm64-v8a/libunistring.so
            '';
          }
        );
      };

      buildToolsVersion = "36.0.0";
      devShell =
        let

          envars =
            if system != "x84_64-linux" then
              { }
            else
              {
                #MY_SPATIALITE = "${pkgs.libspatialite}";
                #LIB_GEOS = "${pkgs.pkgsCross.aarch64-android-prebuilt.geos}";
                #LIB_PROJ = "${pkgs.pkgsCross.aarch64-android-prebuilt.proj}";
                #LIB_SPATIALITE = "${pkgs.pkgsCross.aarch64-android-prebuilt.libspatialite}";
                #LIB_UNISTRING = "${pkgs.pkgsCross.aarch64-android-prebuilt.libunistring}";
                #LIB_ICONV = "${pkgs.pkgsCross.aarch64-android-prebuilt.libiconv}";
                JAVA_HOME = pkgs.jdk17.home;
              };

        in
        pkgs.mkShell (
          envars
          // rec {
            shellHook =
              if system != "x84_64-linux" then
                ""
              else
                ''
                  set -euxo pipefail
                  gitroot=$(git rev-parse --show-toplevel)
                  exec ${pkgs.zsh}/bin/zsh -l
                '';

            motd = ''
              Entered Cosm development environment.
            '';
            ANDROID_HOME = "${pkgs.android-sdk}/share/android-sdk";
            ANDROID_SDK_ROOT = "${pkgs.android-sdk}/share/android-sdk";
            ANDROID_AVD_HOME = "/home/tristan/.config/.android/avd";
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${ANDROID_SDK_ROOT}/build-tools/${buildToolsVersion}/aapt2";

            nativeBuildInputs = [
              pkgs.ghostscript_headless
              pkgs.gradle_8
              pkgs.nodejs
              pkgs.typescript
              pkgs.fontforge
              pkgs.nixfmt
              pkgs.qemu
              pkgs.yarn
              pkgs.sqlite-interactive
              pkgs.android-sdk
              pkgs.aapt
              (inputs.gradle2nix.packages."${system}".gradle2nix)
            ]
            ++ (
              if system == "x86_64-linux" then
                [
                  pkgs.jdk17
                ]
              else
                [ ]
            );
          }
        );
    });
}
